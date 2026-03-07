/**
 * ParallelTaskPanel
 * Full-page visual board for orchestrating parallel Claude coding tasks on isolated git worktrees.
 * Flow: describe goal → Claude decomposes → tasks run in parallel worktrees → merge assistance
 */

'use strict';

const { escapeHtml } = require('../../utils');
const { t } = require('../../i18n');
const { getSetting, setSetting } = require('../../state/settings.state');
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

  const savedMaxTasks = getSetting('parallelMaxAgents') || 3;

  container.innerHTML = `
    <div class="parallel-panel">

      <!-- Form view (shown when no active run) -->
      <div class="parallel-form-view" id="parallel-form-view">

        <!-- Header -->
        <div class="parallel-header">
          <div class="parallel-header-left">
            <div class="parallel-header-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <h1 class="parallel-header-title">${t('parallel.title')}</h1>
              <p class="parallel-header-subtitle">${t('parallel.subtitle')}</p>
            </div>
          </div>
        </div>

        <!-- Form content -->
        <div class="parallel-form-content">

          <!-- Left: Goal input -->
          <div class="parallel-form-main">
            <div class="parallel-field">
              <label class="parallel-label" for="parallel-project-select">${t('parallel.form.projectLabel')}</label>
              <select id="parallel-project-select" class="parallel-select parallel-select--full"></select>
            </div>

            <div class="parallel-field parallel-field--grow">
              <label class="parallel-label" for="parallel-goal-input">${t('parallel.form.goalLabel')}</label>
              <textarea
                id="parallel-goal-input"
                class="parallel-goal-input"
                placeholder="${t('parallel.form.goalPlaceholder')}"
              ></textarea>
            </div>
          </div>

          <!-- Right: Config sidebar -->
          <div class="parallel-form-sidebar">

            <div class="parallel-config-card">
              <div class="parallel-config-section">
                <label class="parallel-label">${t('parallel.form.maxTasksLabel')}</label>
                <div class="parallel-agents-control">
                  <input
                    type="range"
                    id="parallel-agents-slider"
                    class="parallel-agents-slider"
                    min="1"
                    max="10"
                    value="${escapeHtml(String(savedMaxTasks))}"
                    step="1"
                  />
                  <div class="parallel-agents-display">
                    <span id="parallel-agents-value" class="parallel-agents-value">${savedMaxTasks}</span>
                    <span class="parallel-agents-unit">agents</span>
                  </div>
                </div>
                <div class="parallel-agents-ticks">
                  <span>1</span><span>3</span><span>5</span><span>7</span><span>10</span>
                </div>
              </div>

              <div class="parallel-config-section">
                <label class="parallel-label" for="parallel-model-select">${t('parallel.form.modelLabel')}</label>
                <select id="parallel-model-select" class="parallel-select parallel-select--full">
                  <option value="claude-haiku-4-5-20251001">Haiku 4.5 — Fastest</option>
                  <option value="claude-sonnet-4-6" selected>Sonnet 4.6 — Balanced</option>
                  <option value="claude-opus-4-6">Opus 4.6 — Most capable</option>
                </select>
              </div>

              <div class="parallel-config-section">
                <label class="parallel-label" for="parallel-effort-select">${t('parallel.form.effortLabel')}</label>
                <select id="parallel-effort-select" class="parallel-select parallel-select--full">
                  <option value="low">${t('parallel.effort.low')}</option>
                  <option value="medium">${t('parallel.effort.medium')}</option>
                  <option value="high" selected>${t('parallel.effort.high')}</option>
                </select>
              </div>

              <button id="parallel-start-btn" class="parallel-start-btn">
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d="M8 5v14l11-7z"/>
                </svg>
                ${t('parallel.form.startBtn')}
              </button>
            </div>

            <!-- Info card -->
            <div class="parallel-info-card">
              <h4 class="parallel-info-title">How it works</h4>
              <ol class="parallel-info-steps">
                <li>Claude decomposes your goal into independent sub-tasks</li>
                <li>Each sub-task runs in an isolated git worktree on its own branch</li>
                <li>All agents run in parallel, independently</li>
                <li>Review diffs and merge each branch when ready</li>
              </ol>
            </div>

          </div>
        </div>
      </div>

      <!-- Board view (shown during / after active run) -->
      <div class="parallel-board-view" id="parallel-board-view" style="display:none">

        <!-- Board header -->
        <div class="parallel-board-header" id="parallel-board-header">
          <div class="parallel-board-header-left">
            <div class="parallel-phase-dot" id="parallel-phase-dot"></div>
            <div class="parallel-board-header-info">
              <span class="parallel-board-phase-label" id="parallel-phase-label"></span>
              <span class="parallel-board-goal-label" id="parallel-board-goal-label"></span>
            </div>
          </div>
          <div class="parallel-board-header-right">
            <button class="parallel-header-action-btn parallel-header-action-btn--danger" id="parallel-cancel-btn" style="display:none">
              <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M18 6L6 18M6 6l12 12"/></svg>
              ${t('parallel.cancelBtn')}
            </button>
            <button class="parallel-header-action-btn" id="parallel-cleanup-btn" style="display:none">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
              ${t('parallel.cleanupBtn')}
            </button>
            <button class="parallel-header-action-btn" id="parallel-new-run-btn" style="display:none">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              ${t('parallel.newRunBtn')}
            </button>
          </div>
        </div>

        <!-- Progress bar -->
        <div class="parallel-progress-bar-wrapper" id="parallel-progress-wrapper" style="display:none">
          <div class="parallel-progress-bar" id="parallel-progress-bar"></div>
        </div>

        <!-- Task grid -->
        <div class="parallel-task-grid" id="parallel-kanban"></div>

        <!-- Merge section -->
        <div class="parallel-merge-section" id="parallel-merge-section" style="display:none"></div>
      </div>

    </div>
  `;

  _wireEvents();
}

function _wireEvents() {
  // Agents slider
  const slider = document.getElementById('parallel-agents-slider');
  const valueDisplay = document.getElementById('parallel-agents-value');
  if (slider && valueDisplay) {
    slider.addEventListener('input', () => {
      const val = parseInt(slider.value, 10);
      valueDisplay.textContent = val;
      setSetting('parallelMaxAgents', val);
    });
  }

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
      _showBoardView(false);
      _showFormView(true);
      _showToast(t('parallel.cleanup.success'), 'success');
    } else {
      _showToast(result.error || t('parallel.cleanup.error'), 'error');
    }
  });

  // New run button (after completion)
  document.getElementById('parallel-new-run-btn')?.addEventListener('click', () => {
    clearActiveRun();
    _showBoardView(false);
    _showFormView(true);
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
    document.getElementById('parallel-agents-slider')?.value || '3',
    10
  );
  const model = document.getElementById('parallel-model-select')?.value || 'claude-sonnet-4-6';
  const effort = document.getElementById('parallel-effort-select')?.value || 'high';

  // Persist the chosen max tasks
  setSetting('parallelMaxAgents', maxTasks);

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
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg> ${t('parallel.form.startBtn')}`;
  }

  if (!result.success) {
    _showToast(result.error || t('parallel.errors.startFailed'), 'error');
    return;
  }

  // Create initial run object in state
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

  _showFormView(false);
  _showBoardView(true);
  _updateBoard();
}

// ─── Board update (called on every state change) ──────────────────────────────

function _updateBoard() {
  const run = getActiveRun();
  if (!run) return;

  _updateBoardHeader(run);
  _updateProgressBar(run);
  _updateKanban(run);
  _updateMergeSection(run);
}

function _updateBoardHeader(run) {
  const phaseLabel = document.getElementById('parallel-phase-label');
  const goalLabel = document.getElementById('parallel-board-goal-label');
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
  if (run.error) {
    label = run.error;
  }

  if (phaseLabel) phaseLabel.textContent = label;
  if (goalLabel) {
    goalLabel.textContent = run.goal ? `"${run.goal.slice(0, 80)}${run.goal.length > 80 ? '...' : ''}"` : '';
  }

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

function _updateProgressBar(run) {
  const wrapper = document.getElementById('parallel-progress-wrapper');
  const bar = document.getElementById('parallel-progress-bar');
  if (!wrapper || !bar) return;

  const tasks = run.tasks || [];
  const total = tasks.length;

  if (total === 0 || run.phase === 'decomposing') {
    wrapper.style.display = 'none';
    return;
  }

  wrapper.style.display = '';
  const done = tasks.filter(t => t.status === 'done' || t.status === 'failed' || t.status === 'cancelled').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  bar.style.width = `${pct}%`;
  bar.className = 'parallel-progress-bar';
  if (run.phase === 'done') bar.classList.add('done');
  else if (run.phase === 'failed') bar.classList.add('failed');
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
          <div class="parallel-empty-state-text">
            <p class="parallel-empty-state-title">${t('parallel.phase.decomposing')}</p>
            <p class="parallel-empty-state-hint">Claude is analyzing your goal and creating independent sub-tasks...</p>
          </div>
        </div>
      `;
    } else if (run.phase === 'failed' && run.error) {
      kanban.innerHTML = `
        <div class="parallel-empty-state parallel-empty-state--error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div class="parallel-empty-state-text">
            <p class="parallel-empty-state-title">Run failed</p>
            <p class="parallel-empty-state-error">${escapeHtml(run.error)}</p>
          </div>
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
      card.className = `parallel-task-card status-${task.status}`;
      card.dataset.taskId = task.id;
      kanban.appendChild(card);
      card.innerHTML = _buildTaskCard(task);
    } else {
      _patchTaskCard(card, task);
    }
  });

  // Remove cards for tasks that no longer exist
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
  const isRunning = task.status === 'running';

  return `
    <div class="parallel-task-card-header">
      <span class="parallel-task-title">${escapeHtml(task.title || task.id)}</span>
      <span class="parallel-task-badge badge-${task.status}">${statusLabel}</span>
    </div>
    ${task.description ? `<p class="parallel-task-desc">${escapeHtml(task.description)}</p>` : ''}
    ${task.branch ? `
      <div class="parallel-task-branch">
        <svg viewBox="0 0 16 16" fill="currentColor" width="10" height="10">
          <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 019 8.5H7.5a1 1 0 000 2h1.25a2.25 2.25 0 110 1.5H7.5a2.5 2.5 0 01-2.5-2.5v-2A2.25 2.25 0 110 5.5a2.25 2.25 0 012.25 2.25v.5h4.25V5.25A2.25 2.25 0 019.5 3.25z"/>
        </svg>
        <code>${escapeHtml(task.branch)}</code>
      </div>
    ` : ''}
    <div class="parallel-task-output-wrap" id="output-wrap-${task.id}">
      ${isRunning ? '<div class="parallel-task-running-indicator"><span></span><span></span><span></span></div>' : ''}
      <div class="parallel-task-output" id="output-${task.id}"><pre>${escapeHtml(outputLines)}</pre></div>
    </div>
    ${task.error ? `<div class="parallel-task-error">${escapeHtml(task.error)}</div>` : ''}
    <div class="parallel-task-footer" id="footer-${task.id}" style="${isFinished ? '' : 'display:none'}">
      <button class="parallel-btn-sm parallel-btn-diff" data-task-id="${task.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>
        ${t('parallel.card.viewDiff')}
      </button>
      <button class="parallel-btn-sm parallel-btn-terminal" data-worktree-path="${escapeHtml(task.worktreePath || '')}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><polyline points="4,17 10,11 4,5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
        ${t('parallel.card.openTerminal')}
      </button>
    </div>
  `;
}

function _patchTaskCard(card, task) {
  // Update card border status class
  card.className = `parallel-task-card status-${task.status}`;

  // Update status badge
  const badge = card.querySelector('.parallel-task-badge');
  if (badge) {
    badge.textContent = t(`parallel.status.${task.status}`) || task.status;
    badge.className = `parallel-task-badge badge-${task.status}`;
  }

  // Update running indicator
  const outputWrap = card.querySelector(`#output-wrap-${task.id}`);
  if (outputWrap) {
    const runningInd = outputWrap.querySelector('.parallel-task-running-indicator');
    const isRunning = task.status === 'running';
    if (isRunning && !runningInd) {
      const ind = document.createElement('div');
      ind.className = 'parallel-task-running-indicator';
      ind.innerHTML = '<span></span><span></span><span></span>';
      outputWrap.prepend(ind);
    } else if (!isRunning && runningInd) {
      runningInd.remove();
    }
  }

  // Update output content
  const outputEl = card.querySelector(`#output-${task.id} pre`);
  if (outputEl) {
    const formatted = _formatOutput(task.output);
    outputEl.textContent = formatted;
    const outputBox = card.querySelector(`#output-${task.id}`);
    if (outputBox) outputBox.scrollTop = outputBox.scrollHeight;
  }

  // Show/hide footer
  const footer = card.querySelector(`#footer-${task.id}`);
  if (footer) {
    const isFinished = task.status === 'done' || task.status === 'failed';
    footer.style.display = isFinished ? '' : 'none';
  }

  // Show/update error
  let errorEl = card.querySelector('.parallel-task-error');
  if (task.error) {
    if (!errorEl) {
      errorEl = document.createElement('div');
      errorEl.className = 'parallel-task-error';
      const footer = card.querySelector('.parallel-task-footer');
      if (footer) footer.before(errorEl);
      else card.appendChild(errorEl);
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
    <div class="parallel-merge-inner">
      <div class="parallel-merge-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
          <path d="M6 9v6"/><path d="M18 9V6a2 2 0 00-2-2H8"/><path d="M18 15v3"/>
        </svg>
        <h3 class="parallel-merge-title">${t('parallel.merge.title')}</h3>
      </div>
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

function _showFormView(visible) {
  const el = document.getElementById('parallel-form-view');
  if (el) el.style.display = visible ? '' : 'none';
}

function _showBoardView(visible) {
  const el = document.getElementById('parallel-board-view');
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
  // Show last 20 lines
  const lines = output.split('\n');
  return lines.slice(-20).join('\n');
}

function _showToast(msg, type) {
  if (ctx?.showToast) ctx.showToast(msg, type);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { init, load };
