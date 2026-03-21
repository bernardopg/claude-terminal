import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config';

// ── Types ──

interface SyncState {
  settings: Record<string, { value: any; updatedAt: number }>;
  projects: Record<string, { data: any; updatedAt: number }>;
  timeTracking: any;
  conversations: Record<string, { lines: number; updatedAt: number }>;
  skills: Record<string, { files: Record<string, string>; hash: string; updatedAt: number }>;
  agents: Record<string, { files: Record<string, string>; hash: string; updatedAt: number }>;
  mcpConfigs: Record<string, { value: any; updatedAt: number }>;
  keybindings: { value: any; hash: string; updatedAt: number } | null;
  memory: { value: any; hash: string; updatedAt: number } | null;
  hooksConfig: { value: any; hash: string; updatedAt: number } | null;
  timeTrackingArchives: Record<string, { data: any; hash: string; updatedAt: number }>;
  installedPlugins: { value: any; hash: string; updatedAt: number } | null;
}

const VALID_ENTITY_TYPES = new Set([
  'settings', 'projects', 'timeTracking', 'conversations',
  'skills', 'agents', 'mcpConfigs', 'keybindings',
  'memory', 'hooksConfig', 'timeTrackingArchives', 'installedPlugins',
]);

// Entity types where push stores { value, updatedAt }
const VALUE_WRAPPED = new Set(['settings', 'mcpConfigs']);
// Entity types where push stores { data, updatedAt }
const DATA_WRAPPED = new Set(['projects', 'timeTrackingArchives']);
// Entity types where push stores { files, hash, updatedAt }
const FILES_WRAPPED = new Set(['skills', 'agents']);
// Entity types stored as whole-file { value, hash, updatedAt }
const WHOLE_FILE = new Set(['keybindings', 'memory', 'hooksConfig', 'installedPlugins']);
// Entity types stored as raw data (no wrapping)
const RAW_DATA = new Set(['timeTracking']);

const MAX_CONVERSATION_SIZE = 50 * 1024 * 1024; // 50 MB
const SAFE_ID_RE = /^[a-zA-Z0-9_.\-/]+$/;

function emptyState(): SyncState {
  return {
    settings: {},
    projects: {},
    timeTracking: null,
    conversations: {},
    skills: {},
    agents: {},
    mcpConfigs: {},
    keybindings: null,
    memory: null,
    hooksConfig: null,
    timeTrackingArchives: {},
    installedPlugins: null,
  };
}

async function writeAtomic(filePath: string, data: string): Promise<void> {
  const tmpPath = filePath + '.tmp.' + crypto.randomBytes(4).toString('hex');
  await fs.promises.writeFile(tmpPath, data, 'utf-8');
  await fs.promises.rename(tmpPath, filePath);
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

class SyncManager {

  // ── Paths ──

  private syncDir(userName: string): string {
    return path.join(config.usersDir, userName, 'sync');
  }

  private statePath(userName: string): string {
    return path.join(this.syncDir(userName), 'state.json');
  }

  private convoDir(userName: string): string {
    return path.join(this.syncDir(userName), 'conversations');
  }

  private convoPath(userName: string, id: string): string {
    return path.join(this.convoDir(userName), `${id}.jsonl`);
  }

  // ── Ensure dirs ──

  private async ensureSyncDir(userName: string): Promise<void> {
    await fs.promises.mkdir(this.syncDir(userName), { recursive: true });
  }

  private async ensureConvoDir(userName: string): Promise<void> {
    await fs.promises.mkdir(this.convoDir(userName), { recursive: true });
  }

  // ── State ──

  async getState(userName: string): Promise<SyncState> {
    const state = await readJson<SyncState>(this.statePath(userName));
    if (!state) return emptyState();
    // Ensure all fields exist (backward compat)
    const base = emptyState();
    return { ...base, ...state };
  }

  async pushEntity(
    userName: string,
    entityType: string,
    entityId: string | null,
    data: any,
    hash: string,
    timestamp: number,
  ): Promise<void> {
    if (!VALID_ENTITY_TYPES.has(entityType)) {
      throw new Error(`Invalid entity type: ${entityType}`);
    }

    await this.ensureSyncDir(userName);
    const state = await this.getState(userName);

    if (VALUE_WRAPPED.has(entityType)) {
      // settings, mcpConfigs → keyed by entityId
      if (!entityId) throw new Error(`${entityType} requires entityId`);
      const section = state[entityType as 'settings' | 'mcpConfigs'] as Record<string, any>;
      section[entityId] = { value: data, updatedAt: timestamp };
    } else if (DATA_WRAPPED.has(entityType)) {
      if (entityType === 'projects') {
        if (!entityId) throw new Error('projects requires entityId');
        state.projects[entityId] = { data, updatedAt: timestamp };
      } else if (entityType === 'timeTrackingArchives') {
        if (!entityId) throw new Error('timeTrackingArchives requires entityId');
        state.timeTrackingArchives[entityId] = { data, hash, updatedAt: timestamp };
      }
    } else if (FILES_WRAPPED.has(entityType)) {
      // skills, agents → keyed by entityId
      if (!entityId) throw new Error(`${entityType} requires entityId`);
      const section = state[entityType as 'skills' | 'agents'] as Record<string, any>;
      section[entityId] = { files: data, hash, updatedAt: timestamp };
    } else if (WHOLE_FILE.has(entityType)) {
      // keybindings, memory, hooksConfig, installedPlugins → whole replacement
      (state as any)[entityType] = { value: data, hash, updatedAt: timestamp };
    } else if (RAW_DATA.has(entityType)) {
      // timeTracking → raw data, no wrapper
      (state as any)[entityType] = data;
    }

    await writeAtomic(this.statePath(userName), JSON.stringify(state, null, 2));
  }

  // ── Conversations ──

  async getConversation(userName: string, id: string): Promise<string | null> {
    if (!SAFE_ID_RE.test(id)) return null;

    const filePath = this.convoPath(userName, id);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return content;
    } catch {
      return null;
    }
  }

  async appendConversation(
    userName: string,
    id: string,
    lines: string,
    totalLineCount: number,
  ): Promise<void> {
    if (!SAFE_ID_RE.test(id)) {
      throw new Error('Invalid conversation ID');
    }

    await this.ensureConvoDir(userName);
    const filePath = this.convoPath(userName, id);

    // Check file size limit
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > MAX_CONVERSATION_SIZE) {
        throw new Error('Conversation file exceeds 50MB limit');
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    // Append lines
    const content = lines.endsWith('\n') ? lines : lines + '\n';
    await fs.promises.appendFile(filePath, content, 'utf-8');

    // Update conversation metadata in state
    await this.ensureSyncDir(userName);
    const state = await this.getState(userName);
    state.conversations[id] = {
      lines: totalLineCount,
      updatedAt: Date.now(),
    };
    await writeAtomic(this.statePath(userName), JSON.stringify(state, null, 2));
  }
}

export const syncManager = new SyncManager();
