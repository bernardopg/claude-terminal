# Smart Session Recap — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** After each Claude session, automatically generate a readable summary ("Implemented OAuth, fixed 3 API bugs") and display it in the project dashboard.

**Architecture:** A new `SessionRecapService` (renderer) subscribes to `SESSION_END`, sends enriched session context (tool counts + user prompts) to the main process via IPC, which calls the GitHub Models API (gpt-4o-mini, same as commit messages). The result is persisted to `~/.claude-terminal/session-recaps/{projectId}.json` (max 5 entries) and displayed in a new dashboard section.

**Tech Stack:** Electron IPC, GitHub Models API (`models.inference.ai.azure.com`), EventBus (hooks-only), `fs.writeFileSync` for persistence, Jest for tests.

---

## Task 1: Add `generateSessionRecap` to commitMessageGenerator.js

**Files:**
- Modify: `src/main/utils/commitMessageGenerator.js`
- Test: `tests/utils/commitMessageGenerator.test.js` (create)

### Step 1: Add the helper function `formatDurationMs` at the bottom of the constants section (after line 10, before `SYSTEM_PROMPT`)

```js
function formatDurationMs(ms) {
  if (!ms || ms < 0) ms = 0;
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}
```

### Step 2: Add `buildSessionRecapSystemPrompt` and `generateSessionRecap` functions before the `groupFiles` function (around line 216)

```js
// ============================================================
// Session Recap (AI summary of a Claude session)
// ============================================================

function buildSessionRecapSystemPrompt(isRich) {
  if (isRich) {
    return `Summarize this Claude Code session in 2-3 bullet points starting with "•".
Focus on what was ACCOMPLISHED. Imperative mood. No quotes. No trailing punctuation.
Output ONLY the bullet points, nothing else.`;
  }
  return `Summarize this Claude Code session in ONE short sentence (max 15 words).
Focus on what was ACCOMPLISHED. Imperative mood. No quotes. No trailing punctuation.
Output ONLY the sentence, nothing else.`;
}

function generateSessionRecapHeuristic(ctx) {
  const entries = Object.entries(ctx.toolCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, count]) => `${name} ×${count}`)
    .join(', ');
  return entries || `${ctx.toolCount || 0} tool uses`;
}

/**
 * Generate a session recap summary via GitHub Models API, with heuristic fallback.
 * @param {{ toolCounts: Object, prompts: string[], durationMs: number, toolCount: number }} ctx
 * @param {string|null} githubToken
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<{ summary: string, source: 'ai'|'heuristic' }>}
 */
async function generateSessionRecap(ctx, githubToken, timeoutMs = 5000) {
  if (!ctx) return { summary: '', source: 'heuristic' };

  const isRich = ctx.toolCount > 10 || (ctx.prompts && ctx.prompts.length > 2);
  const systemPrompt = buildSessionRecapSystemPrompt(isRich);

  const toolList = Object.entries(ctx.toolCounts || {})
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} ×${count}`)
    .join(', ') || 'none';

  const promptList = (ctx.prompts || []).join(' | ') || 'unknown';
  const durationStr = formatDurationMs(ctx.durationMs || 0);

  const userMessage = `User requests: ${promptList}\nTools used: ${toolList}\nDuration: ${durationStr}`;

  if (githubToken) {
    const body = JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 150,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    });

    const result = await new Promise((resolve) => {
      const options = {
        hostname: 'models.inference.ai.azure.com',
        path: '/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${githubToken}`,
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: timeoutMs
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.message?.content?.trim();
            resolve(content || null);
          } catch (e) {
            resolve(null);
          }
        });
      });
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.on('error', () => resolve(null));
      req.write(body);
      req.end();
    });

    if (result) return { summary: result, source: 'ai' };
  }

  return { summary: generateSessionRecapHeuristic(ctx), source: 'heuristic' };
}
```

### Step 3: Export the new functions — update the `module.exports` at the bottom of the file

```js
module.exports = { generateCommitMessage, generateSessionRecap, generateSessionRecapHeuristic };
```

### Step 4: Write tests

Create `tests/utils/commitMessageGenerator.test.js`:

```js
const { generateSessionRecapHeuristic } = require('../../src/main/utils/commitMessageGenerator');

describe('generateSessionRecapHeuristic', () => {
  test('formats tool counts sorted by frequency', () => {
    const ctx = { toolCounts: { Write: 4, Edit: 3, Bash: 1 }, toolCount: 8, prompts: [] };
    const result = generateSessionRecapHeuristic(ctx);
    expect(result).toBe('Write ×4, Edit ×3, Bash ×1');
  });

  test('limits to 4 tools', () => {
    const ctx = { toolCounts: { Write: 5, Edit: 4, Bash: 3, Read: 2, Glob: 1 }, toolCount: 15 };
    const result = generateSessionRecapHeuristic(ctx);
    expect(result).not.toContain('Glob');
    expect(result.split(',').length).toBe(4);
  });

  test('falls back to tool count when no toolCounts', () => {
    const ctx = { toolCounts: {}, toolCount: 5, prompts: [] };
    const result = generateSessionRecapHeuristic(ctx);
    expect(result).toBe('5 tool uses');
  });

  test('handles empty context gracefully', () => {
    const result = generateSessionRecapHeuristic({});
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
```

### Step 5: Run tests to verify they pass

```bash
npm test -- --testPathPattern=commitMessageGenerator
```

Expected: 4 tests PASS

### Step 6: Commit

```bash
git add src/main/utils/commitMessageGenerator.js tests/utils/commitMessageGenerator.test.js
git commit -m "feat(recap): add generateSessionRecap to commitMessageGenerator"
```

---

## Task 2: Add IPC handler + preload bridge

**Files:**
- Modify: `src/main/ipc/git.ipc.js` (around line 220, after the `git-generate-commit-message` handler)
- Modify: `src/main/preload.js` (around line 257, inside the `github` namespace... actually the `git` namespace around line 200)

### Step 1: Import `generateSessionRecap` in git.ipc.js

The existing import on line 8 is:
```js
const { generateCommitMessage } = require('../utils/commitMessageGenerator');
```

Update it to:
```js
const { generateCommitMessage, generateSessionRecap } = require('../utils/commitMessageGenerator');
```

### Step 2: Add the IPC handler after the `git-generate-commit-message` handler block (around line 228)

```js
  // Generate session recap via GitHub Models API
  ipcMain.handle('git-generate-session-recap', async (_event, context) => {
    try {
      const githubToken = await GitHubAuthService.getToken();
      const result = await generateSessionRecap(context, githubToken);
      return result || { summary: null, source: 'heuristic' };
    } catch (e) {
      console.error('[GitIPC] Session recap generation failed:', e.message);
      return { summary: null, source: 'error' };
    }
  });
```

### Step 3: Add preload bridge in src/main/preload.js

Find the `git` namespace block. After the last `git.*` method (search for the closing of the git block), add before the closing `},`:

```js
    generateSessionRecap: (context) => ipcRenderer.invoke('git-generate-session-recap', context),
```

The git namespace ends around line 248. The new line goes inside the `git: {` block.

### Step 4: Commit

```bash
git add src/main/ipc/git.ipc.js src/main/preload.js
git commit -m "feat(recap): add git-generate-session-recap IPC handler and preload bridge"
```

---

## Task 3: Add `sessionRecapsDir` to paths.js

**Files:**
- Modify: `src/renderer/utils/paths.js`

### Step 1: Add the constant after `timeTrackingDir` (line 20)

```js
const sessionRecapsDir = path.join(dataDir, 'session-recaps');
```

### Step 2: Add it to `ensureDirectories()` — update the array in the function (line 34)

```js
function ensureDirectories() {
  [dataDir, skillsDir, agentsDir, timeTrackingDir, sessionRecapsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}
```

### Step 3: Export it at the bottom — add to `module.exports`

```js
module.exports = {
  homeDir, dataDir, claudeDir,
  projectsFile, settingsFile, legacyMcpsFile,
  archivesDir, timeTrackingFile, timeTrackingDir,
  sessionRecapsDir,  // ← add
  contextPacksFile, promptTemplatesFile,
  claudeSettingsFile, claudeConfigFile,
  skillsDir, agentsDir,
  ensureDirectories, getAssetsDir
};
```

### Step 4: Commit

```bash
git add src/renderer/utils/paths.js
git commit -m "feat(recap): add sessionRecapsDir to paths"
```

---

## Task 4: Create SessionRecapService.js

**Files:**
- Create: `src/renderer/services/SessionRecapService.js`

### Step 1: Create the file

```js
/**
 * SessionRecapService
 * Generates and persists AI summaries of Claude sessions.
 *
 * Called by events/index.js after SESSION_END.
 * Persists to ~/.claude-terminal/session-recaps/{projectId}.json (max 5 entries).
 */

const api = window.electron_api;
const { fs, path } = window.electron_nodeModules;
const { sessionRecapsDir } = require('../utils/paths');
const { formatDuration } = require('../utils/format');

const MAX_RECAPS = 5;

// ============================================================
// Persistence
// ============================================================

function getRecapFilePath(projectId) {
  return path.join(sessionRecapsDir, `${projectId}.json`);
}

/**
 * Get recaps for a project (synchronous, safe to call in HTML builders).
 * @param {string} projectId
 * @returns {Array}
 */
function getRecaps(projectId) {
  if (!projectId) return [];
  try {
    const filePath = getRecapFilePath(projectId);
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.recaps) ? parsed.recaps : [];
  } catch (e) {
    return [];
  }
}

function saveRecaps(projectId, recaps) {
  try {
    const filePath = getRecapFilePath(projectId);
    fs.writeFileSync(filePath, JSON.stringify({ _version: 1, recaps }, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[SessionRecap] Failed to save recaps:', e.message);
  }
}

// ============================================================
// Heuristic fallback (no API)
// ============================================================

function buildHeuristicSummary(ctx) {
  const entries = Object.entries(ctx.toolCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, count]) => `${name} ×${count}`)
    .join(', ');
  return entries || `${ctx.toolCount || 0} tool uses`;
}

// ============================================================
// Main entry point
// ============================================================

/**
 * Handle end of a Claude session: generate recap, persist, signal dashboard.
 * @param {string} projectId
 * @param {{ toolCounts: Object, prompts: string[], durationMs: number, toolCount: number }} ctx
 */
async function handleSessionEnd(projectId, ctx) {
  if (!projectId || !ctx) return;

  let summary = null;
  let source = 'heuristic';

  // Try AI summary via IPC (5s timeout enforced in IPC handler too)
  try {
    const result = await Promise.race([
      api.git.generateSessionRecap({
        toolCounts: ctx.toolCounts,
        prompts: ctx.prompts,
        durationMs: ctx.durationMs,
        toolCount: ctx.toolCount
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('client-timeout')), 6000))
    ]);
    if (result && result.summary) {
      summary = result.summary;
      source = result.source || 'ai';
    }
  } catch (e) {
    console.warn('[SessionRecap] AI summary failed:', e.message);
  }

  if (!summary) {
    summary = buildHeuristicSummary(ctx);
    source = 'heuristic';
  }

  const isRich = ctx.toolCount > 10 || (ctx.prompts && ctx.prompts.length > 2);

  const recap = {
    timestamp: Date.now(),
    summary,
    durationMs: ctx.durationMs || 0,
    toolCount: ctx.toolCount || 0,
    isRich,
    source
  };

  // Prepend new recap, cap to MAX_RECAPS (FIFO: newest first)
  const existing = getRecaps(projectId);
  const updated = [recap, ...existing].slice(0, MAX_RECAPS);
  saveRecaps(projectId, updated);

  console.debug(`[SessionRecap] Saved recap for project ${projectId} (source: ${source})`);

  // Signal dashboard to refresh the session recaps section
  window.dispatchEvent(new CustomEvent('session-recap-updated', { detail: { projectId } }));
}

module.exports = { handleSessionEnd, getRecaps };
```

### Step 2: Commit

```bash
git add src/renderer/services/SessionRecapService.js
git commit -m "feat(recap): create SessionRecapService with AI + heuristic fallback"
```

---

## Task 5: Enrich sessionContext and wire consumer in events/index.js

**Files:**
- Modify: `src/renderer/events/index.js`

### Step 1: Enrich the sessionContext initialization in `wireNotificationConsumer`

Find the `SESSION_START` listener inside `wireNotificationConsumer` (around line 62):
```js
sessionContext.set(e.projectId, { toolCount: 0, toolNames: new Set(), lastToolName: null, startTime: Date.now(), notified: false });
```

Replace with:
```js
sessionContext.set(e.projectId, { toolCount: 0, toolNames: new Set(), toolCounts: new Map(), prompts: [], lastToolName: null, startTime: Date.now(), notified: false });
```

### Step 2: Also update the auto-init inside the `TOOL_START` listener (around line 68)

Find the auto-init inside the TOOL_START listener:
```js
sessionContext.set(e.projectId, { toolCount: 0, toolNames: new Set(), lastToolName: null, startTime: Date.now(), notified: false });
```

Replace with:
```js
sessionContext.set(e.projectId, { toolCount: 0, toolNames: new Set(), toolCounts: new Map(), prompts: [], lastToolName: null, startTime: Date.now(), notified: false });
```

### Step 3: Update the `TOOL_START` listener to track `toolCounts` Map

Inside the TOOL_START listener, after `ctx.toolNames.add(e.data.toolName)` (around line 74), add:

```js
      const toolName = e.data?.toolName;
      if (toolName) {
        ctx.toolCounts.set(toolName, (ctx.toolCounts.get(toolName) || 0) + 1);
      }
```

### Step 4: Add `wireSessionRecapConsumer` function before `wireDebugListener` (around line 335)

```js
// ── Consumer: Session Recap (hooks-only — generates AI summary after session ends) ──
function wireSessionRecapConsumer() {
  consumerUnsubscribers.push(
    // Collect user prompts into session context
    eventBus.on(EVENT_TYPES.PROMPT_SUBMIT, (e) => {
      if (e.source !== 'hooks' || !e.projectId) return;
      const ctx = sessionContext.get(e.projectId);
      if (!ctx) return;
      const prompt = e.data?.prompt;
      if (prompt && ctx.prompts.length < 5) {
        ctx.prompts.push(prompt);
      }
    }),

    // On session end: generate recap if session was meaningful
    eventBus.on(EVENT_TYPES.SESSION_END, (e) => {
      if (e.source !== 'hooks' || !e.projectId) return;
      const ctx = sessionContext.get(e.projectId);
      // Skip trivial sessions (< 2 tool uses)
      if (!ctx || ctx.toolCount < 2) return;

      const durationMs = Date.now() - (ctx.startTime || Date.now());
      const enrichedCtx = {
        toolCounts: Object.fromEntries(ctx.toolCounts),
        prompts: ctx.prompts || [],
        durationMs,
        toolCount: ctx.toolCount
      };

      // Non-blocking async call
      try {
        const SessionRecapService = require('../services/SessionRecapService');
        SessionRecapService.handleSessionEnd(e.projectId, enrichedCtx).catch(err => {
          console.warn('[Events] SessionRecap error:', err.message);
        });
      } catch (err) {
        console.warn('[Events] SessionRecapService not available:', err.message);
      }
    })
  );
}
```

### Step 5: Wire the consumer in `initClaudeEvents` — add after `wireTabRenameConsumer()` (around line 403)

```js
  wireSessionRecapConsumer();
```

### Step 6: Commit

```bash
git add src/renderer/events/index.js
git commit -m "feat(recap): wire session recap consumer in EventBus"
```

---

## Task 6: Add `buildSessionRecapsHtml` to DashboardService.js

**Files:**
- Modify: `src/renderer/services/DashboardService.js`

### Step 1: Add the builder function before `buildStatsHtml` (around line 746)

```js
/**
 * Build session recaps section HTML
 * @param {string} projectId
 * @returns {string}
 */
function buildSessionRecapsHtml(projectId) {
  try {
    const { getRecaps } = require('./SessionRecapService');
    const { formatDuration } = require('../utils/format');

    const recaps = getRecaps(projectId);
    if (!recaps || recaps.length === 0) return '';

    const itemsHtml = recaps.map(recap => {
      const ageMs = Date.now() - (recap.timestamp || 0);
      const ageMins = Math.floor(ageMs / 60000);
      const ageHours = Math.floor(ageMins / 60);
      const ageDays = Math.floor(ageHours / 24);

      let timeLabel;
      if (ageMins < 1) timeLabel = t('dashboard.sessionRecaps.ago.justNow');
      else if (ageMins < 60) timeLabel = t('dashboard.sessionRecaps.ago.minutes', { n: ageMins });
      else if (ageDays === 1) timeLabel = t('dashboard.sessionRecaps.ago.yesterday');
      else if (ageDays > 1) timeLabel = t('dashboard.sessionRecaps.ago.days', { n: ageDays });
      else timeLabel = t('dashboard.sessionRecaps.ago.hours', { n: ageHours });

      const duration = formatDuration(recap.durationMs || 0);

      let summaryHtml;
      if (recap.isRich && recap.summary && recap.summary.includes('•')) {
        const bullets = recap.summary.split('\n')
          .filter(line => line.trim())
          .map(line => `<li>${escapeHtml(line.replace(/^•\s*/, ''))}</li>`)
          .join('');
        summaryHtml = `<ul class="session-recap-bullets">${bullets}</ul>`;
      } else {
        summaryHtml = `<p class="session-recap-text">${escapeHtml(recap.summary || '')}</p>`;
      }

      return `
        <div class="session-recap-item">
          <div class="session-recap-meta">
            <span class="session-recap-time">${escapeHtml(timeLabel)}</span>
            <span class="session-recap-sep">·</span>
            <span class="session-recap-duration">${escapeHtml(duration)}</span>
          </div>
          ${summaryHtml}
        </div>`;
    }).join('');

    return `
      <div class="dashboard-section session-recaps-section">
        <h3>
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
          ${t('dashboard.sessionRecaps.title')}
        </h3>
        <div class="session-recaps-list">
          ${itemsHtml}
        </div>
      </div>`;
  } catch (e) {
    console.warn('[Dashboard] buildSessionRecapsHtml error:', e.message);
    return '';
  }
}
```

### Step 2: Inject into the dashboard template

Find this block in `renderProjectDashboard` (around line 1422-1426):
```js
      <div class="dashboard-col">
        ${buildStatsHtml(stats, gitInfo)}
        ${buildClaudeActivityHtml()}
        ${gitInfo.isGitRepo ? buildContributorsHtml(gitInfo.contributors) : ''}
      </div>
```

Replace with:
```js
      <div class="dashboard-col">
        ${buildSessionRecapsHtml(project.id)}
        ${buildStatsHtml(stats, gitInfo)}
        ${buildClaudeActivityHtml()}
        ${gitInfo.isGitRepo ? buildContributorsHtml(gitInfo.contributors) : ''}
      </div>
```

### Step 3: Add live-update listener after `container.innerHTML = html` assignment

Find where the dashboard HTML is assigned to the container (somewhere after line 1430). After the assignment and before the first `querySelectorAll` call, add:

```js
  // Live-update session recaps section when a new recap arrives
  const onRecapUpdated = (e) => {
    if (e.detail?.projectId !== project.id) return;
    const existing = container.querySelector('.session-recaps-section');
    const newHtml = buildSessionRecapsHtml(project.id);
    if (!newHtml) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = newHtml;
    const newSection = tmp.firstElementChild;
    if (existing) {
      existing.replaceWith(newSection);
    } else {
      // Inject before stats section if not present yet
      const statsSection = container.querySelector('.dashboard-col:last-child');
      if (statsSection) statsSection.prepend(newSection);
    }
  };
  window.addEventListener('session-recap-updated', onRecapUpdated);
```

### Step 4: Commit

```bash
git add src/renderer/services/DashboardService.js
git commit -m "feat(recap): add session recaps section to project dashboard"
```

---

## Task 7: Add i18n keys

**Files:**
- Modify: `src/renderer/i18n/locales/fr.json`
- Modify: `src/renderer/i18n/locales/en.json`

### Step 1: Add keys to fr.json — in the `"dashboard"` section, add a `"sessionRecaps"` sub-object

```json
"sessionRecaps": {
  "title": "Sessions récentes",
  "ago": {
    "justNow": "À l'instant",
    "minutes": "Il y a {n} min",
    "hours": "Il y a {n}h",
    "yesterday": "Hier",
    "days": "Il y a {n} jours"
  }
}
```

### Step 2: Add keys to en.json

```json
"sessionRecaps": {
  "title": "Recent sessions",
  "ago": {
    "justNow": "Just now",
    "minutes": "{n} min ago",
    "hours": "{n}h ago",
    "yesterday": "Yesterday",
    "days": "{n} days ago"
  }
}
```

### Step 3: Commit

```bash
git add src/renderer/i18n/locales/fr.json src/renderer/i18n/locales/en.json
git commit -m "feat(recap): add i18n keys for session recaps section"
```

---

## Task 8: Add CSS styles

**Files:**
- Modify: `styles/dashboard.css`

### Step 1: Add styles at the end of `dashboard.css`

```css
/* ── Session Recaps ─────────────────────────────────── */

.session-recaps-section .session-recaps-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.session-recap-item {
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color);
}

.session-recap-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.session-recap-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: var(--font-xs);
  color: var(--text-secondary);
}

.session-recap-sep {
  opacity: 0.5;
}

.session-recap-duration {
  color: var(--accent);
  font-weight: 500;
}

.session-recap-text {
  margin: 0;
  font-size: var(--font-sm);
  color: var(--text-primary);
  line-height: 1.4;
}

.session-recap-bullets {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.session-recap-bullets li {
  font-size: var(--font-sm);
  color: var(--text-primary);
  line-height: 1.4;
  padding-left: 12px;
  position: relative;
}

.session-recap-bullets li::before {
  content: '•';
  position: absolute;
  left: 0;
  color: var(--accent);
}
```

### Step 2: Commit

```bash
git add styles/dashboard.css
git commit -m "feat(recap): add CSS styles for session recaps section"
```

---

## Task 9: Build renderer and verify

### Step 1: Build the renderer bundle

```bash
npm run build:renderer
```

Expected: no errors, `dist/renderer.bundle.js` updated.

### Step 2: Run the full test suite

```bash
npm test
```

Expected: all existing tests pass + the 4 new commitMessageGenerator tests pass.

### Step 3: Start the app and manual smoke test

```bash
npm start
```

Manual verification checklist:
- Open a project with hooks enabled
- Start a Claude session in terminal mode
- Run a few commands (Claude uses `Write`, `Edit`, `Bash`)
- When Claude session ends, check `~/.claude-terminal/session-recaps/{projectId}.json` — should contain a recap entry
- Switch to another project and back — session recaps section should appear in dashboard
- Check that the recap summary is readable (either AI-generated or heuristic fallback)

### Step 4: Final commit

```bash
git add -p  # review any pending changes
git commit -m "feat(recap): smart session recap — auto-summary after each Claude session"
```

---

## Notes for Implementer

- **Hooks-only feature**: Session recaps only work when `hooksEnabled` is true (Settings → Hooks). No hooks = no `SESSION_END` event = no recap generated. This is by design.
- **Session threshold**: Sessions with `toolCount < 2` are skipped (too trivial).
- **GitHub token required for AI**: If the user hasn't connected their GitHub account, the heuristic fallback runs automatically. The result is labeled `source: 'heuristic'` in the JSON but not shown differently in the UI.
- **Timing**: The AI call happens *after* `SESSION_END`. The `sessionContext` is cleaned up by `wireNotificationConsumer` on `SESSION_END`. Make sure `wireSessionRecapConsumer` reads the context *before* it's deleted — it does, because `sessionContext.delete(e.projectId)` only happens inside `wireNotificationConsumer`, and both listeners receive the same event in the same tick.
- **Live update**: The `session-recap-updated` event fires after the AI call completes (several seconds after session end). The listener in `renderProjectDashboard` handles this gracefully.
