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
