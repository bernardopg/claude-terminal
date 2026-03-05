/**
 * Session Replay Panel
 * Interactive audit trail: replay any Claude session as a chronological timeline
 * of tool calls, file edits, prompts, and estimated token usage.
 */

const { escapeHtml } = require('../../utils/dom');
const { t } = require('../../i18n');

let container = null;
let projectsState = null;

// ── Panel state ───────────────────────────────────────────────────────────────
let currentProjectPath = null;
let currentSessionId = null;
let currentSteps = [];
let currentSummary = {};
let selectedStepIndex = -1;

// ── DOM refs ──────────────────────────────────────────────────────────────────
let projectSelect = null;
let sessionSelect = null;
let loadBtn = null;
let summaryBar = null;
let timeline = null;

// ── Tool category helpers ─────────────────────────────────────────────────────
const TOOL_CATEGORIES = {
  file:    ['Read', 'Write', 'Edit', 'NotebookEdit'],
  terminal:['Bash'],
  search:  ['Glob', 'Grep'],
  web:     ['WebFetch', 'WebSearch'],
  agent:   ['Task'],
  plan:    ['ExitPlanMode', 'AskUserQuestion', 'EnterPlanMode', 'TodoWrite'],
};

function getToolCategory(toolName) {
  for (const [cat, tools] of Object.entries(TOOL_CATEGORIES)) {
    if (tools.includes(toolName)) return cat;
  }
  return 'other';
}

function getToolIcon(toolName) {
  const cat = getToolCategory(toolName);
  switch (cat) {
    case 'file': return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>`;
    case 'terminal': return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10zM6 10h2v2H6zm0 4h8v2H6zm10 0h2v2h-2zm-6-4h8v2h-8z"/></svg>`;
    case 'search': return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`;
    case 'web': return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`;
    case 'agent': return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2.05v2.02c3.95.49 7 3.85 7 7.93s-3.05 7.44-7 7.93v2.02c5.05-.5 9-4.76 9-9.95S18.05 2.55 13 2.05zM11 2.05C5.95 2.55 2 6.81 2 12s3.95 9.45 9 9.95v-2.02C7.05 19.44 4 16.08 4 12s3.05-7.44 7-7.93V2.05zM12 6l-5 5h3v6h4v-6h3z"/></svg>`;
    case 'plan': return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>`;
    default: return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93V18c0-.55-.45-1-1-1s-1 .45-1 1v1.93C7.06 19.44 4.56 16.94 4.07 14H6c.55 0 1-.45 1-1s-.45-1-1-1H4.07C4.56 8.06 7.06 5.56 11 5.07V7c0 .55.45 1 1 1s1-.45 1-1V5.07C16.94 5.56 19.44 8.06 19.93 11H18c-.55 0-1 .45-1 1s.45 1 1 1h1.93c-.49 3.94-2.99 6.44-6.93 6.93z"/></svg>`;
  }
}

function getStepIcon(step) {
  if (step.type === 'prompt') {
    return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`;
  }
  if (step.type === 'response') {
    return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>`;
  }
  if (step.type === 'thinking') {
    return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.5 2C6.81 2 3 5.81 3 10.5S6.81 19 11.5 19h.5v3c4.86-2.34 8-7 8-11.5C20 5.81 16.19 2 11.5 2zm1 14.5h-2v-2h2v2zm0-4h-2c0-3.25 3-3 3-5 0-1.1-.9-2-2-2s-2 .9-2 2h-2c0-2.21 1.79-4 4-4s4 1.79 4 4c0 2.5-3 2.75-3 5z"/></svg>`;
  }
  return getToolIcon(step.toolName);
}

function formatTokens(n) {
  if (n >= 1000) return `~${(n / 1000).toFixed(1)}k tok`;
  return `~${n} tok`;
}

function getStepTokens(step) {
  if (step.type === 'tool') {
    return (step.estimatedInputTokens || 0) + (step.estimatedOutputTokens || 0);
  }
  return step.estimatedTokens || 0;
}

function truncate(str, max = 120) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.slice(0, max) + '…';
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderSummary(summary) {
  if (!summary || !summary.totalSteps) {
    summaryBar.innerHTML = '';
    return;
  }
  const topTools = Object.entries(summary.toolBreakdown || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => `<span class="sr-badge sr-badge--tool">${escapeHtml(name)} <strong>${count}</strong></span>`)
    .join('');

  summaryBar.innerHTML = `
    <div class="sr-summary-items">
      <span class="sr-summary-item">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z"/></svg>
        <strong>${summary.totalSteps}</strong> ${t('sessionReplay.steps')}
      </span>
      <span class="sr-summary-item">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/></svg>
        <strong>${formatTokens(summary.totalEstimatedTokens)}</strong> ${t('sessionReplay.estimated')}
      </span>
      ${summary.uniqueFileCount > 0 ? `
      <span class="sr-summary-item">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
        <strong>${summary.uniqueFileCount}</strong> ${t('sessionReplay.files')}
      </span>` : ''}
      ${topTools ? `<span class="sr-summary-sep">·</span>${topTools}` : ''}
    </div>`;
}

function renderTimeline(steps) {
  if (!steps || steps.length === 0) {
    timeline.innerHTML = `<div class="sr-empty">${t('sessionReplay.noSteps')}</div>`;
    return;
  }

  timeline.innerHTML = steps.map((step, i) => {
    const tokens = getStepTokens(step);
    const cat = step.type === 'tool' ? getToolCategory(step.toolName) : step.type;
    const subtitle = buildStepSubtitle(step);

    return `
    <div class="sr-step sr-step--${escapeHtml(step.type)} sr-step--cat-${escapeHtml(cat)}"
         data-step-index="${i}" tabindex="0" role="button" aria-expanded="false">
      <div class="sr-step-connector">
        <div class="sr-step-line"></div>
        <div class="sr-step-dot"></div>
      </div>
      <div class="sr-step-card">
        <div class="sr-step-header">
          <div class="sr-step-icon">${getStepIcon(step)}</div>
          <div class="sr-step-meta">
            <span class="sr-step-label">${escapeHtml(getStepLabel(step))}</span>
            ${subtitle ? `<span class="sr-step-subtitle" title="${escapeHtml(subtitle)}">${escapeHtml(truncate(subtitle, 80))}</span>` : ''}
          </div>
          <div class="sr-step-right">
            ${tokens > 0 ? `<span class="sr-step-tokens">${formatTokens(tokens)}</span>` : ''}
            <svg class="sr-step-chevron" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>
          </div>
        </div>
        <div class="sr-step-body" style="display:none">
          ${buildStepBody(step)}
        </div>
      </div>
    </div>`;
  }).join('');

  // Attach click handlers
  timeline.querySelectorAll('.sr-step').forEach(el => {
    el.addEventListener('click', () => toggleStep(el));
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleStep(el); }
      if (e.key === 'ArrowDown') { e.preventDefault(); focusStep(+el.dataset.stepIndex + 1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); focusStep(+el.dataset.stepIndex - 1); }
    });
  });
}

function getStepLabel(step) {
  if (step.type === 'prompt') return t('sessionReplay.stepPrompt');
  if (step.type === 'response') return t('sessionReplay.stepResponse');
  if (step.type === 'thinking') return t('sessionReplay.stepThinking');
  return step.toolName || t('sessionReplay.stepTool');
}

function buildStepSubtitle(step) {
  if (step.type === 'prompt' || step.type === 'response') return truncate(step.text, 100);
  if (step.type === 'thinking') return t('sessionReplay.hiddenThinking');
  if (step.filePath) return step.filePath;
  if (step.type === 'tool' && step.toolInput) {
    if (step.toolInput.command) return truncate(step.toolInput.command, 80);
    if (step.toolInput.query) return truncate(step.toolInput.query, 80);
    if (step.toolInput.pattern) return truncate(step.toolInput.pattern, 80);
    if (step.toolInput.prompt) return truncate(step.toolInput.prompt, 80);
  }
  return '';
}

function buildStepBody(step) {
  if (step.type === 'prompt' || step.type === 'response') {
    return `<div class="sr-body-text">${escapeHtml(step.text || '')}</div>`;
  }
  if (step.type === 'thinking') {
    return `<div class="sr-body-text sr-body-text--thinking">${escapeHtml(step.text || '')}</div>`;
  }
  // Tool step
  const parts = [];
  if (step.toolInput && !step.toolInput._truncated) {
    const inputStr = JSON.stringify(step.toolInput, null, 2);
    parts.push(`<div class="sr-body-section">
      <div class="sr-body-label">${t('sessionReplay.input')}</div>
      <pre class="sr-code">${escapeHtml(inputStr)}</pre>
    </div>`);
  } else if (step.toolInput?._truncated) {
    parts.push(`<div class="sr-body-section">
      <div class="sr-body-label">${t('sessionReplay.input')}</div>
      <pre class="sr-code">${escapeHtml(step.toolInput._preview)}</pre>
      <span class="sr-truncated">${t('sessionReplay.truncated')}</span>
    </div>`);
  }
  if (step.toolOutput !== null && step.toolOutput !== undefined) {
    parts.push(`<div class="sr-body-section">
      <div class="sr-body-label">${t('sessionReplay.output')}</div>
      <pre class="sr-code">${escapeHtml(step.toolOutput || '(empty)')}</pre>
    </div>`);
  } else {
    parts.push(`<div class="sr-body-section">
      <span class="sr-truncated">${t('sessionReplay.noOutput')}</span>
    </div>`);
  }
  return parts.join('');
}

function toggleStep(el) {
  const body = el.querySelector('.sr-step-body');
  const chevron = el.querySelector('.sr-step-chevron');
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  el.setAttribute('aria-expanded', String(!isOpen));
  chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  const idx = +el.dataset.stepIndex;
  selectedStepIndex = isOpen ? -1 : idx;
  // Deselect others
  timeline.querySelectorAll('.sr-step').forEach(other => {
    if (other !== el) {
      other.querySelector('.sr-step-body').style.display = 'none';
      other.querySelector('.sr-step-chevron').style.transform = '';
      other.setAttribute('aria-expanded', 'false');
    }
  });
}

function focusStep(idx) {
  const els = timeline.querySelectorAll('.sr-step');
  if (idx >= 0 && idx < els.length) {
    els[idx].focus();
  }
}

// ── Session loading ───────────────────────────────────────────────────────────

async function loadSessions(projectPath) {
  sessionSelect.innerHTML = `<option value="">${t('sessionReplay.loadingSessions')}</option>`;
  sessionSelect.disabled = true;
  loadBtn.disabled = true;
  try {
    const sessions = await window.electron_api.claude.sessions(projectPath);
    if (!sessions || sessions.length === 0) {
      sessionSelect.innerHTML = `<option value="">${t('sessionReplay.noSessions')}</option>`;
      return;
    }
    sessionSelect.innerHTML = `<option value="">${t('sessionReplay.selectSession')}</option>` +
      sessions.map(s => {
        const label = s.summary || truncate(s.firstPrompt, 70) || s.sessionId;
        const date = s.modified ? new Date(s.modified).toLocaleDateString() : '';
        return `<option value="${escapeHtml(s.sessionId)}">${escapeHtml(label)} — ${escapeHtml(date)}</option>`;
      }).join('');
    sessionSelect.disabled = false;
  } catch (e) {
    sessionSelect.innerHTML = `<option value="">${t('sessionReplay.errorLoadingSessions')}</option>`;
  }
}

async function loadReplay() {
  const projectPath = projectSelect.value;
  const sessionId = sessionSelect.value;
  if (!projectPath || !sessionId) return;

  loadBtn.disabled = true;
  loadBtn.textContent = t('sessionReplay.loading');
  timeline.innerHTML = `<div class="sr-loading"><div class="sr-spinner"></div>${t('sessionReplay.parsing')}</div>`;
  summaryBar.innerHTML = '';

  try {
    const result = await window.electron_api.claude.sessionReplay({ projectPath, sessionId });
    if (!result.success) throw new Error(result.error || 'Unknown error');
    currentSteps = result.steps || [];
    currentSummary = result.summary || {};
    currentProjectPath = projectPath;
    currentSessionId = sessionId;
    selectedStepIndex = -1;
    renderSummary(currentSummary);
    renderTimeline(currentSteps);
  } catch (e) {
    timeline.innerHTML = `<div class="sr-empty sr-empty--error">${t('sessionReplay.errorLoading')}: ${escapeHtml(e.message)}</div>`;
  } finally {
    loadBtn.disabled = false;
    loadBtn.textContent = t('sessionReplay.load');
  }
}

// ── Initialization ────────────────────────────────────────────────────────────

function buildHtml() {
  return `
    <div class="sr-panel">
      <div class="sr-header">
        <div class="sr-title">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
          <span>${t('sessionReplay.title')}</span>
        </div>
        <div class="sr-controls">
          <select class="sr-select" id="sr-project-select">
            <option value="">${t('sessionReplay.selectProject')}</option>
          </select>
          <select class="sr-select" id="sr-session-select" disabled>
            <option value="">${t('sessionReplay.selectSession')}</option>
          </select>
          <button class="sr-load-btn" id="sr-load-btn" disabled>${t('sessionReplay.load')}</button>
        </div>
      </div>
      <div class="sr-summary" id="sr-summary"></div>
      <div class="sr-timeline" id="sr-timeline">
        <div class="sr-empty">${t('sessionReplay.selectToStart')}</div>
      </div>
    </div>
  `;
}

function init(containerEl, opts = {}) {
  container = containerEl;
  projectsState = opts.projectsState || null;
  container.innerHTML = buildHtml();

  // Bind DOM refs
  projectSelect = container.querySelector('#sr-project-select');
  sessionSelect = container.querySelector('#sr-session-select');
  loadBtn = container.querySelector('#sr-load-btn');
  summaryBar = container.querySelector('#sr-summary');
  timeline = container.querySelector('#sr-timeline');

  // Populate project list
  if (projectsState) {
    const state = projectsState.get();
    const projects = state.projects || [];
    projectSelect.innerHTML = `<option value="">${t('sessionReplay.selectProject')}</option>` +
      projects.map(p => `<option value="${escapeHtml(p.path)}">${escapeHtml(p.name || p.path)}</option>`).join('');

    // Default to open project
    const openedId = opts.openedProjectId || state.openedProjectId;
    if (openedId) {
      const openedProject = projects.find(p => p.id === openedId);
      if (openedProject) {
        projectSelect.value = openedProject.path;
        loadSessions(openedProject.path);
      }
    }
  }

  // Event listeners
  projectSelect.addEventListener('change', () => {
    const path = projectSelect.value;
    sessionSelect.innerHTML = `<option value="">${t('sessionReplay.selectSession')}</option>`;
    sessionSelect.disabled = true;
    loadBtn.disabled = true;
    timeline.innerHTML = `<div class="sr-empty">${t('sessionReplay.selectToStart')}</div>`;
    summaryBar.innerHTML = '';
    currentSteps = [];
    if (path) loadSessions(path);
  });

  sessionSelect.addEventListener('change', () => {
    loadBtn.disabled = !sessionSelect.value;
  });

  loadBtn.addEventListener('click', loadReplay);
}

function cleanup() {
  // Reset state when leaving the tab
  currentSteps = [];
  currentSummary = {};
  selectedStepIndex = -1;
}

module.exports = { init, cleanup };
