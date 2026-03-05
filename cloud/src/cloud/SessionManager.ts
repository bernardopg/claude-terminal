import { v4 as uuid } from 'uuid';
import path from 'path';
import fs from 'fs';
import { WebSocket } from 'ws';
import { store, UserSession } from '../store/store';
import { config } from '../config';
import { projectManager } from './ProjectManager';
import { FileWatcher } from './FileWatcher';
import type { RelayServer } from '../relay/RelayServer';

interface ActiveSession {
  id: string;
  userName: string;
  projectName: string;
  abortController: AbortController;
  messageQueue: ReturnType<typeof createMessageQueue>;
  streamClients: Set<WebSocket>;
  status: 'running' | 'idle' | 'error';
  changedFiles: Set<string>;
  fileWatcher: FileWatcher;
}

function createMessageQueue(onIdle?: () => void) {
  const queue: any[] = [];
  let waitResolve: ((val: any) => void) | null = null;
  let done = false;
  let pullCount = 0;

  const iterable = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          pullCount++;
          if (pullCount > 1 && onIdle) onIdle();
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false });
          }
          if (done) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise<any>(resolve => { waitResolve = resolve; });
        },
        return() {
          done = true;
          return Promise.resolve({ value: undefined, done: true });
        }
      };
    }
  };

  return {
    push(message: any) {
      if (waitResolve) {
        const resolve = waitResolve;
        waitResolve = null;
        resolve({ value: message, done: false });
      } else {
        queue.push(message);
      }
    },
    close() {
      done = true;
      if (waitResolve) {
        const resolve = waitResolve;
        waitResolve = null;
        resolve({ value: undefined, done: true });
      }
    },
    iterable
  };
}

export class SessionManager {
  private sessions: Map<string, ActiveSession> = new Map();
  private sdk: any = null;
  private relayServer: RelayServer | null = null;

  setRelayServer(relay: RelayServer): void {
    this.relayServer = relay;
  }

  private async loadSDK() {
    if (!this.sdk) {
      this.sdk = await import('@anthropic-ai/claude-agent-sdk');
    }
    return this.sdk;
  }

  private getSdkCliPath(): string {
    return require.resolve('@anthropic-ai/claude-agent-sdk/cli.js');
  }

  async createSession(userName: string, projectName: string, prompt: string, model?: string, effort?: string): Promise<string> {
    // Check project exists
    const exists = await projectManager.projectExists(userName, projectName);
    if (!exists) throw new Error(`Project "${projectName}" does not exist`);

    // Check session limit
    const running = Array.from(this.sessions.values()).filter(s => s.status === 'running');
    if (running.length >= config.maxSessions) {
      throw new Error(`Max concurrent sessions reached (${config.maxSessions})`);
    }

    // Verify user has Claude credentials
    const userHome = store.userHomePath(userName);
    const credPath = path.join(userHome, '.claude', '.credentials.json');
    if (!fs.existsSync(credPath)) {
      throw new Error(`User "${userName}" has not authenticated Claude. Run: docker exec -it ct-cloud node dist/cli.js user setup ${userName}`);
    }

    const sdk = await this.loadSDK();
    const sessionId = uuid();
    const cwd = store.getProjectPath(userName, projectName);

    const messageQueue = createMessageQueue(() => {
      this.broadcastToStream(sessionId, { type: 'idle', sessionId });
    });

    // Push initial prompt
    messageQueue.push({
      type: 'user',
      message: { role: 'user', content: prompt },
      parent_tool_use_id: null,
      session_id: sessionId,
    });

    const abortController = new AbortController();

    // Start file watcher to capture all filesystem changes
    const fileWatcher = new FileWatcher(cwd);
    fileWatcher.start();

    const activeSession: ActiveSession = {
      id: sessionId,
      userName,
      projectName,
      abortController,
      messageQueue,
      streamClients: new Set(),
      status: 'running',
      changedFiles: new Set(),
      fileWatcher,
    };
    this.sessions.set(sessionId, activeSession);

    // Update user.json
    await this.persistSessionMeta(userName, sessionId, projectName, 'running', model);

    // Start SDK query in background with per-user environment
    const options: any = {
      cwd,
      abortController,
      maxTurns: 100,
      includePartialMessages: true,
      permissionMode: 'bypassPermissions',
      pathToClaudeCodeExecutable: this.getSdkCliPath(),
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      stderr: (data: string) => { console.error(`[Session ${sessionId}] ${data}`); },
      env: {
        ...process.env,
        HOME: userHome,
        GIT_CONFIG_GLOBAL: path.join(userHome, '.gitconfig'),
      },
    };

    if (model) options.model = model;
    if (effort) options.effort = effort;

    console.log(`[Session ${sessionId}] Creating session for user="${userName}" project="${projectName}" model="${model || 'default'}" cwd="${cwd}"`);

    let queryStream: AsyncIterable<any>;
    try {
      queryStream = sdk.query({
        prompt: messageQueue.iterable,
        options,
      });
      console.log(`[Session ${sessionId}] SDK query started`);
    } catch (err: any) {
      console.error(`[Session ${sessionId}] SDK query failed to start:`, err.message);
      throw err;
    }

    this.processStream(sessionId, queryStream);

    // Touch project activity
    await projectManager.touchProject(userName, projectName);

    return sessionId;
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    console.log(`[Session ${sessionId}] Received message: "${message.slice(0, 100)}"`);

    session.messageQueue.push({
      type: 'user',
      message: { role: 'user', content: message },
      parent_tool_use_id: null,
      session_id: sessionId,
    });
  }

  async interruptSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.abortController.abort();
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.abortController.abort();
    session.messageQueue.close();
    session.fileWatcher.stop();

    // Merge watcher changes into session before closing
    for (const f of session.fileWatcher.getChangedFiles()) {
      session.changedFiles.add(f);
    }
    if (session.changedFiles.size > 0) {
      await this.persistChangedFiles(session);
    }

    // Close all WS stream clients
    for (const ws of session.streamClients) {
      ws.close(1000, 'Session closed');
    }

    this.sessions.delete(sessionId);

    // Update user.json
    const user = await store.getUser(session.userName);
    if (user) {
      user.sessions = user.sessions.filter(s => s.id !== sessionId);
      await store.saveUser(session.userName, user);
    }
  }

  addStreamClient(sessionId: string, ws: WebSocket): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.log(`[Stream] Client tried to connect to unknown session ${sessionId}`);
      return false;
    }
    session.streamClients.add(ws);
    console.log(`[Stream] Client connected to session ${sessionId} (${session.streamClients.size} clients)`);
    ws.on('close', () => {
      session.streamClients.delete(ws);
      console.log(`[Stream] Client disconnected from session ${sessionId} (${session.streamClients.size} clients)`);
    });
    return true;
  }

  listUserSessions(userName: string): Array<{ id: string; projectName: string; status: string; createdAt: number | null; lastActivity: number | null; model: string | null }> {
    const result: Array<{ id: string; projectName: string; status: string; createdAt: number | null; lastActivity: number | null; model: string | null }> = [];
    for (const [, session] of this.sessions) {
      if (session.userName === userName) {
        // Look up persisted metadata for createdAt / lastActivity / model
        const meta = this._getUserSessionMeta(userName, session.id);
        result.push({
          id: session.id,
          projectName: session.projectName,
          status: session.status,
          createdAt: meta?.createdAt ?? null,
          lastActivity: meta?.lastActivity ?? null,
          model: meta?.model ?? null,
        });
      }
    }
    return result;
  }

  private _getUserSessionMeta(userName: string, sessionId: string): import('../store/store').UserSession | null {
    try {
      const user = store.getUserSync(userName);
      return user?.sessions.find(s => s.id === sessionId) ?? null;
    } catch {
      return null;
    }
  }

  isUserSession(sessionId: string, userName: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.userName === userName;
  }

  private async processStream(sessionId: string, queryStream: AsyncIterable<any>): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      let eventCount = 0;
      for await (const event of queryStream) {
        if (!this.sessions.has(sessionId)) break;
        eventCount++;
        if (eventCount <= 3 || eventCount % 50 === 0) {
          console.log(`[Session ${sessionId}] Event #${eventCount}: type=${event?.type}`);
        }
        this.trackFileChanges(session, event);
        this.broadcastToStream(sessionId, { type: 'event', sessionId, event });
      }
      console.log(`[Session ${sessionId}] Stream ended after ${eventCount} events, status=idle`);
      if (session) session.status = 'idle';
      this.broadcastToStream(sessionId, { type: 'done', sessionId });
    } catch (err: any) {
      console.error(`[Session ${sessionId}] Stream error:`, err.message);
      if (session) session.status = 'error';
      this.broadcastToStream(sessionId, { type: 'error', sessionId, error: err.message });
    }

    // Stop watcher and merge its changes
    if (session) {
      session.fileWatcher.stop();
      for (const f of session.fileWatcher.getChangedFiles()) {
        session.changedFiles.add(f);
      }
    }

    // Persist changed files for sync
    if (session && session.changedFiles.size > 0) {
      await this.persistChangedFiles(session);
    }

    // Update meta
    if (session) {
      await this.persistSessionMeta(session.userName, sessionId, session.projectName, session.status);
    }
  }

  private trackFileChanges(session: ActiveSession, event: any): void {
    // SDK assistant messages contain tool_use blocks with file paths
    if (event?.type === 'assistant' && event?.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'tool_use' && (block.name === 'Write' || block.name === 'Edit')) {
          const filePath = block.input?.file_path;
          if (filePath) {
            const cwd = store.getProjectPath(session.userName, session.projectName);
            const resolved = path.resolve(cwd, filePath);
            const relative = path.relative(cwd, resolved);
            // Only track files inside the project directory
            if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
              session.changedFiles.add(relative);
            }
          }
        }
      }
    }
  }

  private async persistChangedFiles(session: ActiveSession): Promise<void> {
    const projectPath = store.getProjectPath(session.userName, session.projectName);
    const changesDir = path.join(projectPath, '.ct-cloud');
    await fs.promises.mkdir(changesDir, { recursive: true });

    const changesFile = path.join(changesDir, `changes-${session.id}.json`);
    await fs.promises.writeFile(changesFile, JSON.stringify({
      sessionId: session.id,
      projectName: session.projectName,
      changedFiles: Array.from(session.changedFiles),
      completedAt: Date.now(),
      synced: false,
    }), 'utf-8');
  }

  private broadcastToStream(sessionId: string, data: any): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const msg = JSON.stringify(data);

    // Send to direct WS stream clients
    for (const ws of session.streamClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }

    // Also send via relay WS to mobile clients (avoids needing a 2nd WS on iOS Safari)
    if (this.relayServer) {
      const room = this.relayServer.getRoomForUser(session.userName);
      if (room) {
        room.broadcastToMobiles({ type: 'stream', sessionId, data });
      }
    }
  }

  private async persistSessionMeta(userName: string, sessionId: string, projectName: string, status: string, model?: string): Promise<void> {
    const user = await store.getUser(userName);
    if (!user) return;

    const existing = user.sessions.findIndex(s => s.id === sessionId);
    const entry: UserSession = {
      id: sessionId,
      projectName,
      status: status as 'idle' | 'running' | 'error',
      model: model || 'claude-sonnet-4-6',
      createdAt: existing >= 0 ? user.sessions[existing].createdAt : Date.now(),
      lastActivity: Date.now(),
    };

    if (existing >= 0) {
      user.sessions[existing] = entry;
    } else {
      user.sessions.push(entry);
    }
    await store.saveUser(userName, user);
  }
}

export const sessionManager = new SessionManager();
