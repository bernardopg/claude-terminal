/**
 * Parallel Task IPC Handlers
 * Bridges renderer Parallel Task Manager with ParallelTaskService.
 */

'use strict';

const { ipcMain } = require('electron');
const parallelTaskService = require('../services/ParallelTaskService');

function registerParallelHandlers(mainWindow) {
  parallelTaskService.setMainWindow(mainWindow);

  // Start a new parallel run (async — returns runId immediately)
  ipcMain.handle('parallel-run-start', async (_e, { projectPath, mainBranch, goal, maxTasks, autoTasks, model, effort }) => {
    try {
      return parallelTaskService.startRun({ projectPath, mainBranch, goal, maxTasks, autoTasks, model, effort });
    } catch (err) {
      console.error('[parallel-run-start]', err.message);
      return { success: false, error: err.message };
    }
  });

  // Cancel an active run
  ipcMain.handle('parallel-run-cancel', async (_e, { runId }) => {
    try {
      return parallelTaskService.cancelRun(runId);
    } catch (err) {
      console.error('[parallel-run-cancel]', err.message);
      return { success: false, error: err.message };
    }
  });

  // Remove all worktrees for a finished run
  ipcMain.handle('parallel-run-cleanup', async (_e, { runId, projectPath }) => {
    try {
      return parallelTaskService.cleanupRun(runId, projectPath);
    } catch (err) {
      console.error('[parallel-run-cleanup]', err.message);
      return { success: false, error: err.message };
    }
  });

  // Confirm proposed tasks and proceed to execution
  ipcMain.handle('parallel-run-confirm', async (_e, { runId, tasks }) => {
    try {
      return parallelTaskService.confirmRun(runId, tasks);
    } catch (err) {
      console.error('[parallel-run-confirm]', err.message);
      return { success: false, error: err.message };
    }
  });

  // Request re-decomposition with user feedback
  ipcMain.handle('parallel-run-refine', async (_e, { runId, feedback }) => {
    try {
      return parallelTaskService.refineRun(runId, feedback);
    } catch (err) {
      console.error('[parallel-run-refine]', err.message);
      return { success: false, error: err.message };
    }
  });

  // Remove a run from disk history
  ipcMain.handle('parallel-history-remove', async (_e, { runId }) => {
    try {
      return parallelTaskService.removeFromHistory(runId);
    } catch (err) {
      console.error('[parallel-history-remove]', err.message);
      return { success: false, error: err.message };
    }
  });

  // Load run history for a project
  ipcMain.handle('parallel-history', async (_e, { projectPath } = {}) => {
    try {
      const runs = parallelTaskService.getHistory(projectPath);
      return { success: true, runs };
    } catch (err) {
      console.error('[parallel-history]', err.message);
      return { success: false, error: err.message };
    }
  });

  console.log('[ParallelIPC] Handlers registered');
}

module.exports = { registerParallelHandlers };
