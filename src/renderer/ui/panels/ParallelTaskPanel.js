/**
 * ParallelTaskPanel
 * Visual Kanban board for orchestrating parallel Claude coding tasks on isolated git worktrees.
 * Flow: describe goal → Claude decomposes → tasks run in parallel worktrees → merge assistance
 */

'use strict';

const { escapeHtml } = require('../../utils');
const { t } = require('../../i18n');
const {
  parallelTaskState,
  getActiveRun,
  setActiveRun,
  clearActiveRun,
  setHistory,
  initParallelListeners,
} = require('../../state/parallelTask.state');

// ─── Module state ─────────────────────────────────────────────────────────────

let ctx = null;
let _initialized = false;
let _unsubscribe = null;

// ─── Init & Load ──────────────────────────────────────────────────────────────

function init(context) {
  ctx = context;
}

async function load() {
  if (!_initialized) {
    _render();
    initParallelListeners();
    _unsubscribe = parallelTaskState.subscribe(() => _updateBoard());
    _initialized = true;
  }

  // Refresh project selector
  _populateProjectSelector();

  // Load run history for the currently opened project
  _loadHistory();
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function _render() {
  const container = document.getElementById('tab-tasks');
  if (!container) return;

  container.innerHTML = `
    <div class="parallel-panel">

      <!-- Form (shown when no active run) -->
      <div class="parallel-form" id="parallel-form">
        <div class="parallel-form-header">
          <h2 class="parallel-title">${t('parallel.title')}</h2>
          <p class="parallel-subtitle">${t('parallel.subtitle')}</p>
        </div>

        <div class="parallel-form-body">
          <div class="parallel-field">
            <label class="parallel-label" for="parallel-project-select">${t('parallel.form.projectLabel')}</label>
            <select id="parallel-project-select" class="parallel-select"></select>
          </div>

          <div class="parallel-field">
            <label class="parallel-label" for="parallel-goal-input">${t('parallel.form.goalLabel')}</label>
            <textarea
              id="parallel-goal-input"
              class="parallel-goal-input"
              placeholder="${t('parallel.form.goalPlaceholder')}"
              rows="4"
            ></textarea>
          </div>

          <div class="parallel-options-row">
            <div class="parallel-option-group">
              <label class="parallel-label">${t('parallel.form.maxTasksLabel')}</label>
              <div class="parallel-btn-group" id="parallel-maxtasks-group">
                <button class="parallel-opt-btn" data-value="2">2</button>
                <button class="parallel-opt-btn active" data-value="3">3</button>
                <button class="parallel-opt-btn" data-value="4">4</button>
              </div>
            </div>

            <div class="parallel-option-group">
              <label class="parallel-label" for="parallel-model-select">${t('parallel.form.modelLabel')}</label>
              <select id="parallel-model-select" class="parallel-select parallel-select--sm">
                <option value="claude-haiku-4-5-20251001">Haiku</option>
                <option value="claude-sonnet-4-6" selected>Sonnet</option>
                <option value="claude-opus-4-6">Opus</option>
              </select>
            </div>

            <div class="parallel-option-group">
              <label class="parallel-label" for="parallel-effort-select">${t('parallel.form.effortLabel')}</label>
              <select id="parallel-effort-select" class="parallel-select parallel-select--sm">
                <option value="low">${t('parallel.effort.low')}</option>
                <option value="medium">${t('parallel.effort.medium')}</option>
                <option value="high" selected>${t('parallel.effort.high')}</option>
              </select>
            </div>

            <button id="parallel-start-btn" class="parallel-start-btn btn-accent">
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M8 5v14l11-7z"/>
              </svg>
              ${t('parallel.form.startBtn')}
            </button>
          </div>
        </div>
      </div>

      <!-- Board (shown when active run exists) -->
      <div class="parallel-board" id="parallel-board" style="display:none">

        <div class="parallel-phase-bar" id="parallel-phase-bar">
          <div class="parallel-phase-left">
            <div class="parallel-phase-dot" id="parallel-phase-dot"></div>
            <span class="parallel-phase-label" id="parallel-phase-label"></span>
          </div>
          <div class="parallel-phase-right">
            <button class="parallel-action-btn" id="parallel-cancel-btn" style="display:none">
              ✕ ${t('parallel.cancelBtn')}
            </button>
            <button class="parallel-action-btn parallel-action-btn--secondary" id="parallel-cleanup-btn" style="display:none">
              🧹 ${t('parallel.cleanupBtn')}
            </button>
            <button class="parallel-action-btn parallel-action-btn--secondary" id="parallel-new-run-btn" style="display:none">
              + ${t('parallel.newRunBtn')}
            </button>
          </div>
        </div>

        <div class="parallel-kanban" id="parallel-kanban"></div>

        <div class="parallel-merge-section" id="parallel-merge-section" style="display:none"></div>
      </div>

    </div>
  `;

  _wireEvents();
}

function _wireEvents() {
  // Max tasks toggle buttons
  document.getElementById('parallel-maxtasks-group')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.parallel-opt-btn');
    if (!btn) return;
    document.querySelectorAll('#parallel-maxtasks-group .parallel-opt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  // Start run
  document.getElementById('parallel-start-btn')?.addEventListener('click', _handleStart);

  // Cancel run
  document.getElementById('parallel-cancel-btn')?.addEventListener('click', async () => {
    const run = getActiveRun();
    if (!run) return;
    await ctx.api.parallel.cancelRun({ runId: run.id });
  });

  // Cleanup worktrees
  document.getElementById('parallel-cleanup-btn')?.addEventListener('click', async () => {
    const run = getActiveRun();
    if (!run) return;
    const result = await ctx.api.parallel.cleanupRun({ runId: run.id, projectPath: run.projectPath });
    if (result.success) {
      clearActiveRun();
      _showBoard(false);
      _showForm(true);
      _showToast(t('parallel.cleanup.success'), 'success');
    } else {
      _showToast(result.error || t('parallel.cleanup.error'), 'error');
    }
  });

  // New run button (after completion)
  document.getElementById('parallel-new-run-btn')?.addEventListener('click', () => {
    clearActiveRun();
    _showBoard(false);
    _showForm(true);
  });

  // Event delegation for task card buttons
  document.getElementById('parallel-kanban')?.addEventListener('click', async (e) => {
    const diffBtn = e.target.closest('.parallel-btn-diff');
    if (diffBtn) {
      const taskId = diffBtn.dataset.taskId;
      await _handleViewDiff(taskId);
      return;
    }

    const termBtn = e.target.closest('.parallel-btn-terminal');
    if (termBtn) {
      const worktreePath = termBtn.dataset.worktreePath;
      if (worktreePath && ctx.openTerminalAtPath) {
        ctx.openTerminalAtPath(worktreePath);
      }
      return;
    }
  });

  // Same delegation for merge section
  document.getElementById('parallel-merge-section')?.addEventListener('click', async (e) => {
    const diffBtn = e.target.closest('.parallel-btn-diff');
    if (diffBtn) {
      await _handleViewDiff(diffBtn.dataset.taskId);
    }
  });
}

// ─── Start handler ────────────────────────────────────────────────────────────

async function _handleStart() {
  const goal = document.getElementById('parallel-goal-input')?.value?.trim();
  if (!goal) {
    _showToast(t('parallel.errors.noGoal'), 'error');
    return;
  }

  const projectSelect = document.getElementById('parallel-project-select');
  const projectPath = projectSelect?.value;
  if (!projectPath) {
    _showToast(t('parallel.errors.noProject'), 'error');
    return;
  }

  const maxTasks = parseInt(
    document.querySelector('#parallel-maxtasks-group .parallel-opt-btn.active')?.dataset.value || '3',
    10
  );
  const model = document.getElementById('parallel-model-select')?.value || 'claude-sonnet-4-6';
  const effort = document.getElementById('parallel-effort-select')?.value || 'high';

  // Get current branch
  const branchResult = await ctx.api.git.currentBranch({ projectPath }).catch(() => null);
  const mainBranch = (branchResult?.branch || branchResult) || 'main';

  const btn = document.getElementById('parallel-start-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = t('parallel.form.startingBtn');
  }

  const result = await ctx.api.parallel.startRun({ projectPath, mainBranch, goal, maxTasks, model, effort });

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z"/></svg> ${t('parallel.form.startBtn')}`;
  }

  if (!result.success) {
    _showToast(result.error || t('parallel.errors.startFailed'), 'error');
    return;
  }

  // Create initial run object in state (main process will send events to update it)
  setActiveRun({
    id: result.runId,
    projectPath,
    mainBranch,
    goal,
    model,
    effort,
    phase: 'decomposing',
    tasks: [],
    startedAt: Date.now(),
    endedAt: null,
    error: null
  });

  _showForm(false);
  _showBoard(true);
  _updateBoard();
}

// ─── Board update (called on every state change) ──────────────────────────────

function _updateBoard() {
  const run = getActiveRun();
  if (!run) return;

  _updatePhaseBar(run);
  _updateKanban(run);
  _updateMergeSection(run);
}

function _updatePhaseBar(run) {
  const phaseLabel = document.getElementById('parallel-phase-label');
  const phaseDot = document.getElementById('parallel-phase-dot');
  const cancelBtn = document.getElementById('parallel-cancel-btn');
  const cleanupBtn = document.getElementById('parallel-cleanup-btn');
  const newRunBtn = document.getElementById('parallel-new-run-btn');

  const done = (run.tasks || []).filter(t => t.status === 'done').length;
  const total = (run.tasks || []).length;

  let label = t(`parallel.phase.${run.phase}`, { done, total });
  if (run.phase === 'running' && total > 0) {
    label = t('parallel.phase.running', { done, total });
  }
  if (phaseLabel) phaseLabel.textContent = label;

  const isRunning = run.phase === 'decomposing' || run.phase === 'creating-worktrees' || run.phase === 'running';
  const isFinished = run.phase === 'done' || run.phase === 'failed' || run.phase === 'cancelled';

  if (phaseDot) {
    phaseDot.className = 'parallel-phase-dot';
    if (isRunning) phaseDot.classList.add('running');
    else if (run.phase === 'done') phaseDot.classList.add('done');
    else if (run.phase === 'failed') phaseDot.classList.add('failed');
  }

  if (cancelBtn) cancelBtn.style.display = isRunning ? '' : 'none';
  if (cleanupBtn) cleanupBtn.style.display = isFinished ? '' : 'none';
  if (newRunBtn) newRunBtn.style.display = isFinished ? '' : 'none';
}

function _updateKanban(run) {
  const kanban = document.getElementById('parallel-kanban');
  if (!kanban) return;

  const tasks = run.tasks || [];

  if (tasks.length === 0) {
    if (run.phase === 'decomposing') {
      kanban.innerHTML = `
        <div class="parallel-empty-state">
          <div class="parallel-spinner"></div>
          <p>${t('parallel.phase.decomposing')}</p>
        </div>
      `;
    }
    return;
  }

  // Build or update each task card
  tasks.forEach(task => {
    let card = kanban.querySelector(`[data-task-id="${task.id}"]`);
    if (!card) {
      card = document.createElement('div');
      card.className = 'parallel-task-card';
      card.dataset.taskId = task.id;
      kanban.appendChild(card);
      card.innerHTML = _buildTaskCard(task);
    } else {
      // Targeted updates — avoid full re-render for performance
      _patchTaskCard(card, task);
    }
  });

  // Remove cards for tasks that no longer exist (edge case)
  kanban.querySelectorAll('[data-task-id]').forEach(card => {
    if (!tasks.find(t => t.id === card.dataset.taskId)) {
      card.remove();
    }
  });
}

function _buildTaskCard(task) {
  const outputLines = _formatOutput(task.output);
  const statusLabel = t(`parallel.status.${task.status}`) || task.status;
  const isFinished = task.status === 'done' || task.status === 'failed';

  return `
    <div class="parallel-task-header">
      <span class="parallel-task-title">${escapeHtml(task.title || task.id)}</span>
      <span class="parallel-task-badge badge-${task.status}">${statusLabel}</span>
    </div>
    ${task.branch ? `
      <div class="parallel-task-branch">
        <svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11">
          <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 019 8.5H7.5a1 1 0 000 2h1.25a2.25 2.25 0 110 1.5H7.5a2.5 2.5 0 01-2.5-2.5v-2A2.25 2.25 0 110 5.5a2.25 2.25 0 012.25 2.25v.5h4.25V5.25A2.25 2.25 0 019.5 3.25z"/>
        </svg>
        <code>${escapeHtml(task.branch)}</code>
      </div>
    ` : ''}
    ${task.description ? `<p class="parallel-task-desc">${escapeHtml(task.description)}</p>` : ''}
    <div class="parallel-task-output" id="output-${task.id}"><pre>${escapeHtml(outputLines)}</pre></div>
    ${task.error ? `<div class="parallel-task-error">${escapeHtml(task.error)}</div>` : ''}
    <div class="parallel-task-footer" id="footer-${task.id}" style="${isFinished ? '' : 'display:none'}">
      <button class="parallel-btn-sm parallel-btn-diff" data-task-id="${task.id}">
        ${t('parallel.card.viewDiff')}
      </button>
      <button class="parallel-btn-sm parallel-btn-terminal" data-worktree-path="${escapeHtml(task.worktreePath || '')}">
        ${t('parallel.card.openTerminal')}
      </button>
    </div>
  `;
}

function _patchTaskCard(card, task) {
  // Update status badge
  const badge = card.querySelector('.parallel-task-badge');
  if (badge) {
    badge.textContent = t(`parallel.status.${task.status}`) || task.status;
    badge.className = `parallel-task-badge badge-${task.status}`;
  }

  // Update card border class
  card.className = `parallel-task-card status-${task.status}`;

  // Append new output (more efficient than full replace)
  const outputEl = card.querySelector(`#output-${task.id} pre`);
  if (outputEl) {
    const formatted = _formatOutput(task.output);
    outputEl.textContent = formatted;
    // Auto-scroll output box
    const outputBox = card.querySelector(`#output-${task.id}`);
    if (outputBox) outputBox.scrollTop = outputBox.scrollHeight;
  }

  // Show footer when finished
  const footer = card.querySelector(`#footer-${task.id}`);
  if (footer) {
    const isFinished = task.status === 'done' || task.status === 'failed';
    footer.style.display = isFinished ? '' : 'none';
  }

  // Show error
  let errorEl = card.querySelector('.parallel-task-error');
  if (task.error) {
    if (!errorEl) {
      errorEl = document.createElement('div');
      errorEl.className = 'parallel-task-error';
      card.querySelector('.parallel-task-footer')?.before(errorEl);
    }
    errorEl.textContent = task.error;
  } else if (errorEl) {
    errorEl.remove();
  }
}

function _updateMergeSection(run) {
  const mergeSection = document.getElementById('parallel-merge-section');
  if (!mergeSection) return;

  if (run.phase !== 'done') {
    mergeSection.style.display = 'none';
    return;
  }

  const doneTasks = (run.tasks || []).filter(t => t.status === 'done');
  if (doneTasks.length === 0) {
    mergeSection.style.display = 'none';
    return;
  }

  mergeSection.style.display = '';
  mergeSection.innerHTML = `
    <h3 class="parallel-merge-title">${t('parallel.merge.title')}</h3>
    <p class="parallel-merge-hint">${t('parallel.merge.hint', { mainBranch: escapeHtml(run.mainBranch) })}</p>
    <div class="parallel-merge-list">
      ${doneTasks.map(task => `
        <div class="parallel-merge-item">
          <div class="parallel-merge-branch-row">
            <code class="parallel-merge-branch">${escapeHtml(task.branch)}</code>
            <button class="parallel-btn-sm parallel-btn-diff" data-task-id="${task.id}">
              ${t('parallel.merge.viewDiff')}
            </button>
          </div>
          <div class="parallel-merge-cmds">
            <code class="parallel-merge-cmd">git checkout ${escapeHtml(run.mainBranch)}</code>
            <code class="parallel-merge-cmd">git merge ${escapeHtml(task.branch)}</code>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ─── View diff ────────────────────────────────────────────────────────────────

async function _handleViewDiff(taskId) {
  const run = getActiveRun();
  if (!run) return;

  const task = (run.tasks || []).find(t => t.id === taskId);
  if (!task || !task.branch) return;

  const result = await ctx.api.git.worktreeDiff({
    projectPath: run.projectPath,
    branch1: run.mainBranch,
    branch2: task.branch
  });

  if (!result.success || !result.diff) {
    _showToast(result.error || t('parallel.errors.noDiff'), 'error');
    return;
  }

  const diffHtml = _renderDiff(result.diff);
  ctx.showModal(
    `${t('parallel.diff.title')} — ${task.branch}`,
    `<div class="parallel-diff-modal"><pre class="diff-view">${diffHtml}</pre></div>`,
    `<button onclick="document.getElementById('modal-overlay').click()">${t('parallel.diff.close')}</button>`
  );
}

function _renderDiff(diff) {
  return diff
    .split('\n')
    .map(line => {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        return `<span class="diff-add">${escapeHtml(line)}</span>`;
      }
      if (line.startsWith('-') && !line.startsWith('---')) {
        return `<span class="diff-del">${escapeHtml(line)}</span>`;
      }
      if (line.startsWith('@@')) {
        return `<span class="diff-hunk">${escapeHtml(line)}</span>`;
      }
      return escapeHtml(line);
    })
    .join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _showForm(visible) {
  const el = document.getElementById('parallel-form');
  if (el) el.style.display = visible ? '' : 'none';
}

function _showBoard(visible) {
  const el = document.getElementById('parallel-board');
  if (el) el.style.display = visible ? '' : 'none';
}

function _populateProjectSelector() {
  const select = document.getElementById('parallel-project-select');
  if (!select || !ctx) return;

  const projects = ctx.projectsState?.get()?.projects || [];
  const openedId = ctx.projectsState?.get()?.openedProjectId;

  select.innerHTML = projects
    .filter(p => p.path)
    .map(p => `<option value="${escapeHtml(p.path)}" ${p.id === openedId ? 'selected' : ''}>${escapeHtml(p.name || p.path)}</option>`)
    .join('');
}

async function _loadHistory() {
  if (!ctx?.api?.parallel) return;
  const projectPath = ctx.projectsState?.get()?.openedProjectId
    ? ctx.projectsState?.get()?.projects?.find(p => p.id === ctx.projectsState?.get()?.openedProjectId)?.path
    : null;
  const result = await ctx.api.parallel.getHistory({ projectPath });
  if (result.success) setHistory(result.runs || []);
}

function _formatOutput(output) {
  if (!output) return '';
  // Show last 15 lines
  const lines = output.split('\n');
  return lines.slice(-15).join('\n');
}

function _showToast(msg, type) {
  if (ctx?.showToast) ctx.showToast(msg, type);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { init, load };
