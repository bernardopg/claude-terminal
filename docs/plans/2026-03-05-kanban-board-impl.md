# Kanban Board Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the flat task list in the project dashboard with a full Kanban board featuring drag & drop, customizable columns, labels, and card descriptions.

**Architecture:** New `KanbanPanel.js` renders the board with custom mouse-event drag & drop. State lives in `projects.state.js` (columns + labels + updated tasks). The dashboard gets a sub-tab switcher (Overview | Kanban) inside `#dashboard-content`.

**Tech Stack:** Vanilla JS (no new dependencies), esbuild bundle, CSS custom properties, Jest/jsdom for tests.

**Design doc:** `docs/plans/2026-03-05-kanban-board-design.md`

---

## Task 1: Update task data model in `projects.state.js`

**Files:**
- Modify: `src/renderer/state/projects.state.js`

### Step 1: Add column/label ID generators after `generateTaskId` (line ~43)

```js
function generateColumnId() {
  return `col-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function generateLabelId() {
  return `lbl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

const DEFAULT_COLUMNS = [
  { id: 'col-todo',       title: 'To Do',       color: '#3b82f6', order: 0 },
  { id: 'col-inprogress', title: 'In Progress',  color: '#f59e0b', order: 1 },
  { id: 'col-done',       title: 'Done',         color: '#22c55e', order: 2 },
];
```

### Step 2: Update `addTask` (line ~893) — replace `status` with new fields

```js
function addTask(projectId, taskData) {
  if (!getProject(projectId)) return null;
  const columns = getKanbanColumns(projectId);
  const defaultColumn = columns[0];
  const now = Date.now();
  const task = {
    id: generateTaskId(),
    title: taskData.title,
    description: taskData.description || '',
    labels: taskData.labels || [],
    columnId: taskData.columnId || defaultColumn?.id || 'col-todo',
    sessionId: taskData.sessionId || null,
    order: taskData.order ?? getTasks(projectId).filter(t => t.columnId === (taskData.columnId || defaultColumn?.id)).length,
    createdAt: now,
    updatedAt: now,
  };
  const tasks = [...getTasks(projectId), task];
  updateProject(projectId, { tasks });
  return task;
}
```

### Step 3: Add `moveTask` after `deleteTask`

```js
function moveTask(projectId, taskId, targetColumnId, targetOrder) {
  const tasks = getTasks(projectId);
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  // Remove from old position, recalculate orders in source column
  const sourceCol = task.columnId;
  let updated = tasks.map(t => {
    if (t.id === taskId) return { ...t, columnId: targetColumnId, order: targetOrder, updatedAt: Date.now() };
    // Shift items in source column after the moved task
    if (t.columnId === sourceCol && t.order > task.order) return { ...t, order: t.order - 1 };
    // Shift items in target column at or after target position
    if (t.columnId === targetColumnId && t.id !== taskId && t.order >= targetOrder) return { ...t, order: t.order + 1 };
    return t;
  });
  updateProject(projectId, { tasks: updated });
}
```

### Step 4: Add column CRUD functions after `moveTask`

```js
function getKanbanColumns(projectId) {
  const project = getProject(projectId);
  if (!project) return [...DEFAULT_COLUMNS];
  if (!project.kanbanColumns || project.kanbanColumns.length === 0) {
    // Initialize with defaults on first access
    updateProject(projectId, { kanbanColumns: [...DEFAULT_COLUMNS] });
    return [...DEFAULT_COLUMNS];
  }
  return [...project.kanbanColumns].sort((a, b) => a.order - b.order);
}

function addKanbanColumn(projectId, { title, color = '#888' }) {
  const columns = getKanbanColumns(projectId);
  const col = { id: generateColumnId(), title, color, order: columns.length };
  updateProject(projectId, { kanbanColumns: [...columns, col] });
  return col;
}

function updateKanbanColumn(projectId, columnId, updates) {
  const columns = getKanbanColumns(projectId);
  const updated = columns.map(c => c.id === columnId ? { ...c, ...updates } : c);
  updateProject(projectId, { kanbanColumns: updated });
}

function deleteKanbanColumn(projectId, columnId) {
  const tasks = getTasks(projectId);
  const hasTasks = tasks.some(t => t.columnId === columnId);
  if (hasTasks) return false; // Can't delete non-empty column
  const columns = getKanbanColumns(projectId).filter(c => c.id !== columnId);
  // Reorder
  const reordered = columns.map((c, i) => ({ ...c, order: i }));
  updateProject(projectId, { kanbanColumns: reordered });
  return true;
}
```

### Step 5: Add label CRUD functions

```js
function getKanbanLabels(projectId) {
  const project = getProject(projectId);
  return project?.kanbanLabels || [];
}

function addKanbanLabel(projectId, { name, color }) {
  const labels = getKanbanLabels(projectId);
  const label = { id: generateLabelId(), name, color };
  updateProject(projectId, { kanbanLabels: [...labels, label] });
  return label;
}

function updateKanbanLabel(projectId, labelId, updates) {
  const labels = getKanbanLabels(projectId).map(l => l.id === labelId ? { ...l, ...updates } : l);
  updateProject(projectId, { kanbanLabels: labels });
}

function deleteKanbanLabel(projectId, labelId) {
  const labels = getKanbanLabels(projectId).filter(l => l.id !== labelId);
  // Remove label from all tasks
  const tasks = getTasks(projectId).map(t => ({
    ...t,
    labels: (t.labels || []).filter(id => id !== labelId)
  }));
  updateProject(projectId, { kanbanLabels: labels, tasks });
}
```

### Step 6: Add migration function

```js
function migrateTasksToKanban(projectId) {
  const project = getProject(projectId);
  if (!project) return;
  if (project.kanbanColumns && project.kanbanColumns.length > 0) return; // Already migrated
  const statusToColumnId = {
    'todo': 'col-todo',
    'in_progress': 'col-inprogress',
    'done': 'col-done',
  };
  const tasks = (project.tasks || []).map((t, i) => ({
    ...t,
    columnId: statusToColumnId[t.status] || 'col-todo',
    description: t.description || '',
    labels: t.labels || [],
    order: i,
  }));
  updateProject(projectId, { kanbanColumns: [...DEFAULT_COLUMNS], kanbanLabels: [], tasks });
}
```

### Step 7: Export all new functions (add to `module.exports` around line 1029)

```js
// Kanban
generateColumnId,
generateLabelId,
getKanbanColumns,
addKanbanColumn,
updateKanbanColumn,
deleteKanbanColumn,
getKanbanLabels,
addKanbanLabel,
updateKanbanLabel,
deleteKanbanLabel,
moveTask,
migrateTasksToKanban,
```

### Step 8: Commit

```bash
git add src/renderer/state/projects.state.js
git commit -m "feat(kanban): update task model with columns, labels, migration"
```

---

## Task 2: Update tests for new task schema

**Files:**
- Modify: `tests/state/projects.state.test.js`

### Step 1: Update imports at top of test file

Add new exports to the import list:
```js
const {
  // ... existing ...
  generateColumnId,
  generateLabelId,
  getKanbanColumns,
  addKanbanColumn,
  updateKanbanColumn,
  deleteKanbanColumn,
  getKanbanLabels,
  addKanbanLabel,
  updateKanbanLabel,
  deleteKanbanLabel,
  moveTask,
  migrateTasksToKanban,
} = require('../../src/renderer/state/projects.state');
```

### Step 2: Update existing task tests to use new schema

Find the `describe('tasks', ...)` block (~line 650) and update:

```js
test('addTask creates task with correct defaults', () => {
  const task = addTask('p1', { title: 'Fix bug' });
  expect(task.id).toMatch(/^task-/);
  expect(task.title).toBe('Fix bug');
  expect(task.columnId).toBe('col-todo'); // default first column
  expect(task.description).toBe('');
  expect(task.labels).toEqual([]);
  expect(task.sessionId).toBeNull();
  expect(task.order).toBe(0);
  expect(typeof task.createdAt).toBe('number');
  expect(typeof task.updatedAt).toBe('number');
  expect(task.createdAt).toBe(task.updatedAt);
});

test('updateTask changes columnId', () => {
  const task = addTask('p1', { title: 'Test' });
  jest.advanceTimersByTime(100);
  updateTask('p1', task.id, { columnId: 'col-inprogress' });
  const updated = getTasks('p1')[0];
  expect(updated.columnId).toBe('col-inprogress');
  expect(updated.updatedAt).toBeGreaterThan(updated.createdAt);
});
```

Remove or update any tests that use `task.status`.

### Step 3: Add column CRUD tests

```js
describe('kanban columns', () => {
  beforeEach(() => {
    resetState({ projects: [{ id: 'p1', name: 'A', path: '/a', folderId: null }] });
  });

  test('getKanbanColumns returns 3 defaults when none set', () => {
    const cols = getKanbanColumns('p1');
    expect(cols).toHaveLength(3);
    expect(cols[0].id).toBe('col-todo');
    expect(cols[1].id).toBe('col-inprogress');
    expect(cols[2].id).toBe('col-done');
  });

  test('addKanbanColumn adds column and returns it', () => {
    addKanbanColumn('p1', { title: 'Review', color: '#ff0' });
    const cols = getKanbanColumns('p1');
    expect(cols).toHaveLength(4);
    expect(cols[3].title).toBe('Review');
  });

  test('updateKanbanColumn changes title', () => {
    updateKanbanColumn('p1', 'col-todo', { title: 'Backlog' });
    const col = getKanbanColumns('p1').find(c => c.id === 'col-todo');
    expect(col.title).toBe('Backlog');
  });

  test('deleteKanbanColumn removes empty column', () => {
    const result = deleteKanbanColumn('p1', 'col-done');
    expect(result).toBe(true);
    expect(getKanbanColumns('p1')).toHaveLength(2);
  });

  test('deleteKanbanColumn refuses to delete non-empty column', () => {
    addTask('p1', { title: 'T', columnId: 'col-todo' });
    const result = deleteKanbanColumn('p1', 'col-todo');
    expect(result).toBe(false);
    expect(getKanbanColumns('p1')).toHaveLength(3);
  });
});
```

### Step 4: Add label CRUD tests

```js
describe('kanban labels', () => {
  beforeEach(() => {
    resetState({ projects: [{ id: 'p1', name: 'A', path: '/a', folderId: null }] });
  });

  test('getKanbanLabels returns empty by default', () => {
    expect(getKanbanLabels('p1')).toEqual([]);
  });

  test('addKanbanLabel adds label', () => {
    const label = addKanbanLabel('p1', { name: 'bug', color: '#f00' });
    expect(label.id).toMatch(/^lbl-/);
    expect(getKanbanLabels('p1')).toHaveLength(1);
  });

  test('deleteKanbanLabel removes label from tasks', () => {
    const label = addKanbanLabel('p1', { name: 'bug', color: '#f00' });
    addTask('p1', { title: 'T', labels: [label.id] });
    deleteKanbanLabel('p1', label.id);
    expect(getTasks('p1')[0].labels).toEqual([]);
  });
});
```

### Step 5: Add moveTask test

```js
test('moveTask changes columnId and recalculates order', () => {
  const t1 = addTask('p1', { title: 'T1', columnId: 'col-todo' });
  moveTask('p1', t1.id, 'col-inprogress', 0);
  const moved = getTasks('p1').find(t => t.id === t1.id);
  expect(moved.columnId).toBe('col-inprogress');
  expect(moved.order).toBe(0);
});
```

### Step 6: Add migration test

```js
test('migrateTasksToKanban maps status to columnId', () => {
  // Create project with legacy tasks
  resetState({
    projects: [{
      id: 'p1', name: 'A', path: '/a', folderId: null,
      tasks: [
        { id: 't1', title: 'T1', status: 'in_progress', sessionId: null, createdAt: 1, updatedAt: 1 },
        { id: 't2', title: 'T2', status: 'done', sessionId: null, createdAt: 1, updatedAt: 1 },
      ]
    }]
  });
  migrateTasksToKanban('p1');
  const tasks = getTasks('p1');
  expect(tasks.find(t => t.id === 't1').columnId).toBe('col-inprogress');
  expect(tasks.find(t => t.id === 't2').columnId).toBe('col-done');
  expect(getKanbanColumns('p1')).toHaveLength(3);
});
```

### Step 7: Run tests

```bash
npm test -- --testPathPattern=projects.state
```

Expected: all tests PASS.

### Step 8: Commit

```bash
git add tests/state/projects.state.test.js
git commit -m "test(kanban): update task tests, add column/label/move/migrate tests"
```

---

## Task 3: Add i18n keys

**Files:**
- Modify: `src/renderer/i18n/locales/fr.json`
- Modify: `src/renderer/i18n/locales/en.json`

### Step 1: Add `kanban` key block to `fr.json` (before the closing `}`)

```json
"kanban": {
  "tab": "Kanban",
  "overview": "Aperçu",
  "addColumn": "+ Colonne",
  "manageLabels": "Labels",
  "addCard": "+ Ajouter",
  "noCards": "Aucune carte",
  "editCard": "Modifier la carte",
  "cardTitle": "Titre",
  "cardTitlePlaceholder": "Titre de la carte...",
  "cardDescription": "Description",
  "cardDescriptionPlaceholder": "Description (optionnel)...",
  "cardLabels": "Labels",
  "cardSession": "Session Claude",
  "cardSessionLink": "Lier session",
  "cardSessionOpen": "Ouvrir la session",
  "columnTitle": "Titre de la colonne",
  "columnTitlePlaceholder": "Nom de la colonne...",
  "deleteColumn": "Supprimer la colonne",
  "deleteColumnDisabled": "Videz la colonne avant de la supprimer",
  "deleteColumnConfirm": "Supprimer la colonne \"{title}\" ?",
  "addColumnTitle": "Nouvelle colonne",
  "labelName": "Nom du label",
  "labelNamePlaceholder": "Ex: bug, feature...",
  "labelColor": "Couleur",
  "addLabel": "+ Label",
  "deleteLabel": "Supprimer",
  "manageLabelsTitle": "Gérer les labels",
  "save": "Enregistrer",
  "cancel": "Annuler",
  "delete": "Supprimer",
  "confirmDeleteCard": "Supprimer la carte \"{title}\" ?"
}
```

### Step 2: Add same keys to `en.json` (translated)

```json
"kanban": {
  "tab": "Kanban",
  "overview": "Overview",
  "addColumn": "+ Column",
  "manageLabels": "Labels",
  "addCard": "+ Add",
  "noCards": "No cards",
  "editCard": "Edit card",
  "cardTitle": "Title",
  "cardTitlePlaceholder": "Card title...",
  "cardDescription": "Description",
  "cardDescriptionPlaceholder": "Description (optional)...",
  "cardLabels": "Labels",
  "cardSession": "Claude Session",
  "cardSessionLink": "Link session",
  "cardSessionOpen": "Open session",
  "columnTitle": "Column title",
  "columnTitlePlaceholder": "Column name...",
  "deleteColumn": "Delete column",
  "deleteColumnDisabled": "Empty the column before deleting",
  "deleteColumnConfirm": "Delete column \"{title}\"?",
  "addColumnTitle": "New column",
  "labelName": "Label name",
  "labelNamePlaceholder": "E.g: bug, feature...",
  "labelColor": "Color",
  "addLabel": "+ Label",
  "deleteLabel": "Delete",
  "manageLabelsTitle": "Manage labels",
  "save": "Save",
  "cancel": "Cancel",
  "delete": "Delete",
  "confirmDeleteCard": "Delete card \"{title}\"?"
}
```

### Step 3: Commit

```bash
git add src/renderer/i18n/locales/fr.json src/renderer/i18n/locales/en.json
git commit -m "feat(kanban): add i18n keys for kanban board"
```

---

## Task 4: Create `styles/kanban.css`

**Files:**
- Create: `styles/kanban.css`

### Step 1: Write the CSS file

```css
/* ── Kanban Board ── */

/* Sub-tab switcher inside dashboard-main */
.dashboard-view-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 16px 0;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.dashboard-view-tab {
  padding: 6px 14px;
  font-size: var(--font-sm);
  color: var(--text-secondary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  transition: color 0.15s, border-color 0.15s;
}

.dashboard-view-tab:hover { color: var(--text-primary); }
.dashboard-view-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

/* Board container */
.kanban-board {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.kanban-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.btn-kanban-add-col,
.btn-kanban-labels {
  padding: 5px 12px;
  font-size: var(--font-xs);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.btn-kanban-add-col:hover,
.btn-kanban-labels:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* Columns scroll area */
.kanban-columns {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  overflow-x: auto;
  flex: 1;
  align-items: flex-start;
}

/* Individual column */
.kanban-column {
  display: flex;
  flex-direction: column;
  width: 240px;
  min-width: 240px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  border: 1px solid var(--border-color);
  max-height: 100%;
  overflow: hidden;
}

.kanban-column-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.kanban-column-color {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.kanban-column-title {
  flex: 1;
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--text-primary);
  cursor: default;
  outline: none;
  border: none;
  background: none;
  padding: 0;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kanban-column-title[contenteditable="true"] {
  background: var(--bg-tertiary);
  border-radius: 3px;
  padding: 1px 4px;
  cursor: text;
}

.kanban-column-count {
  font-size: var(--font-xs);
  color: var(--text-muted);
  flex-shrink: 0;
}

.btn-kanban-col-delete {
  display: none;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  line-height: 1;
}

.kanban-column-header:hover .btn-kanban-col-delete { display: block; }
.btn-kanban-col-delete:hover { color: var(--danger); background: rgba(239,68,68,0.1); }

/* Cards list */
.kanban-cards {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  overflow-y: auto;
  flex: 1;
}

/* Drag placeholder */
.kanban-drag-placeholder {
  height: 68px;
  border: 2px dashed var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent-dim);
  pointer-events: none;
  flex-shrink: 0;
}

/* Card */
.kanban-card {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  cursor: pointer;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 5px;
  transition: border-color 0.15s, box-shadow 0.15s;
  user-select: none;
}

.kanban-card:hover {
  border-color: var(--bg-hover);
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}

.kanban-card.dragging {
  opacity: 0.4;
}

.kanban-card-drag-handle {
  position: absolute;
  left: 4px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  font-size: 14px;
  cursor: grab;
  opacity: 0;
  transition: opacity 0.15s;
  line-height: 1;
}

.kanban-card:hover .kanban-card-drag-handle { opacity: 1; }

.kanban-card-title {
  font-size: var(--font-sm);
  color: var(--text-primary);
  line-height: 1.4;
  padding-left: 14px;
  word-break: break-word;
}

.kanban-card-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-left: 14px;
}

.kanban-label-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 10px;
  font-size: var(--font-2xs);
  font-weight: 500;
  color: #fff;
  white-space: nowrap;
}

.kanban-card-session {
  font-size: var(--font-2xs);
  color: var(--text-muted);
  padding-left: 14px;
  font-family: monospace;
}

.kanban-card-delete {
  position: absolute;
  top: 4px;
  right: 4px;
  display: none;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  line-height: 1;
}

.kanban-card:hover .kanban-card-delete { display: block; }
.kanban-card-delete:hover { color: var(--danger); background: rgba(239,68,68,0.1); }

/* Add card button */
.btn-kanban-add-card {
  width: 100%;
  padding: 6px 12px;
  background: none;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: var(--font-xs);
  cursor: pointer;
  text-align: left;
  transition: color 0.15s, border-color 0.15s;
  flex-shrink: 0;
  margin: 0 8px 8px;
  width: calc(100% - 16px);
}

.btn-kanban-add-card:hover {
  color: var(--text-primary);
  border-color: var(--accent);
}

/* Inline add-card form */
.kanban-add-card-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 8px 8px;
}

.kanban-add-card-input {
  background: var(--bg-primary);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: var(--font-sm);
  padding: 6px 8px;
  width: 100%;
  outline: none;
}

.kanban-add-card-actions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}

.kanban-add-card-confirm {
  padding: 4px 10px;
  background: var(--accent);
  border: none;
  border-radius: var(--radius-sm);
  color: #fff;
  font-size: var(--font-xs);
  cursor: pointer;
}

.kanban-add-card-cancel {
  padding: 4px 8px;
  background: none;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--font-xs);
  cursor: pointer;
}

/* Floating drag clone */
.kanban-drag-clone {
  position: fixed;
  pointer-events: none;
  z-index: 9999;
  opacity: 0.9;
  transform: rotate(2deg) scale(1.03);
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  width: 224px;
  background: var(--bg-tertiary);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
}

/* Card edit modal specifics */
.kanban-modal-label-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.kanban-modal-label-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 10px;
  font-size: var(--font-xs);
  cursor: pointer;
  color: #fff;
  border: 2px solid transparent;
  transition: opacity 0.15s, border-color 0.15s;
}

.kanban-modal-label-chip.selected {
  border-color: #fff;
}

.kanban-modal-label-chip:not(.selected) {
  opacity: 0.5;
}

/* Labels manager modal */
.kanban-labels-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 12px;
}

.kanban-label-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.kanban-label-color-swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
}

.kanban-label-name-input {
  flex: 1;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: var(--font-sm);
  padding: 4px 8px;
}

.btn-kanban-delete-label {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: 12px;
}

.btn-kanban-delete-label:hover { color: var(--danger); }

.kanban-color-presets {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.kanban-color-preset {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.15s;
}

.kanban-color-preset:hover,
.kanban-color-preset.active { border-color: var(--text-primary); }

.btn-kanban-add-label {
  margin-top: 8px;
  padding: 6px 14px;
  background: var(--bg-tertiary);
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--font-xs);
  cursor: pointer;
  width: 100%;
}

.btn-kanban-add-label:hover {
  color: var(--text-primary);
  border-color: var(--accent);
}
```

### Step 2: Commit

```bash
git add styles/kanban.css
git commit -m "feat(kanban): add kanban board CSS"
```

---

## Task 5: Create `KanbanPanel.js`

**Files:**
- Create: `src/renderer/ui/panels/KanbanPanel.js`

This is the main panel. It handles rendering, drag & drop, and modals.

### Step 1: Write the file

```js
'use strict';

const { t } = require('../../i18n');
const { escapeHtml } = require('../../utils/dom');
const {
  getTasks, addTask, updateTask, deleteTask, moveTask,
  getKanbanColumns, addKanbanColumn, updateKanbanColumn, deleteKanbanColumn,
  getKanbanLabels, addKanbanLabel, updateKanbanLabel, deleteKanbanLabel,
  migrateTasksToKanban,
} = require('../../state');

const LABEL_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#6b7280'];

const api = window.electron_api;

/**
 * Render the kanban board into a container element.
 * @param {HTMLElement} container
 * @param {Object} project
 * @param {Object} options
 * @param {Function} options.onSessionOpen  (project, sessionId) => void
 */
function render(container, project, options = {}) {
  migrateTasksToKanban(project.id);
  container.innerHTML = buildBoardHtml(project);
  attachEvents(container, project, options);
}

// ── HTML builders ────────────────────────────────────────────

function buildBoardHtml(project) {
  const cols = getKanbanColumns(project.id);
  return `
    <div class="kanban-board">
      <div class="kanban-toolbar">
        <button class="btn-kanban-labels" id="kanban-btn-labels">⚙ ${t('kanban.manageLabels')}</button>
        <button class="btn-kanban-add-col" id="kanban-btn-add-col">${t('kanban.addColumn')}</button>
      </div>
      <div class="kanban-columns" id="kanban-columns">
        ${cols.map(col => buildColumnHtml(project, col)).join('')}
      </div>
    </div>
  `;
}

function buildColumnHtml(project, col) {
  const tasks = getTasks(project.id)
    .filter(t => t.columnId === col.id)
    .sort((a, b) => a.order - b.order);

  return `
    <div class="kanban-column" data-col-id="${escapeHtml(col.id)}">
      <div class="kanban-column-header">
        <span class="kanban-column-color" style="background:${escapeHtml(col.color)}"></span>
        <span class="kanban-column-title" title="${t('kanban.columnTitle')}">${escapeHtml(col.title)}</span>
        <span class="kanban-column-count">${tasks.length}</span>
        <button class="btn-kanban-col-delete" data-col-id="${escapeHtml(col.id)}" title="${t('kanban.deleteColumn')}">✕</button>
      </div>
      <div class="kanban-cards" data-col-id="${escapeHtml(col.id)}">
        ${tasks.map(task => buildCardHtml(project, task)).join('')}
      </div>
      <button class="btn-kanban-add-card" data-col-id="${escapeHtml(col.id)}">${t('kanban.addCard')}</button>
    </div>
  `;
}

function buildCardHtml(project, task) {
  const labels = getKanbanLabels(project.id);
  const labelsHtml = (task.labels || []).map(lid => {
    const lbl = labels.find(l => l.id === lid);
    if (!lbl) return '';
    return `<span class="kanban-label-chip" style="background:${escapeHtml(lbl.color)}">${escapeHtml(lbl.name)}</span>`;
  }).join('');

  const sessionHtml = task.sessionId
    ? `<span class="kanban-card-session" data-session="${escapeHtml(task.sessionId)}">${task.sessionId.slice(0, 8)}…</span>`
    : '';

  return `
    <div class="kanban-card" data-task-id="${escapeHtml(task.id)}" data-col-id="${escapeHtml(task.columnId)}">
      <span class="kanban-card-drag-handle">⠿</span>
      <span class="kanban-card-title">${escapeHtml(task.title)}</span>
      ${labelsHtml ? `<div class="kanban-card-labels">${labelsHtml}</div>` : ''}
      ${sessionHtml}
      <button class="kanban-card-delete" data-task-id="${escapeHtml(task.id)}" title="${t('kanban.delete')}">✕</button>
    </div>
  `;
}

// ── Events ───────────────────────────────────────────────────

function attachEvents(container, project, options) {
  const board = container.querySelector('.kanban-board');
  if (!board) return;

  // Add column
  board.querySelector('#kanban-btn-add-col')?.addEventListener('click', () => {
    showAddColumnModal(container, project);
  });

  // Manage labels
  board.querySelector('#kanban-btn-labels')?.addEventListener('click', () => {
    showLabelsModal(container, project);
  });

  // Column delete
  board.addEventListener('click', (e) => {
    const delColBtn = e.target.closest('.btn-kanban-col-delete');
    if (delColBtn) {
      const colId = delColBtn.dataset.colId;
      const col = getKanbanColumns(project.id).find(c => c.id === colId);
      if (!col) return;
      const tasks = getTasks(project.id).filter(t => t.columnId === colId);
      if (tasks.length > 0) {
        alert(t('kanban.deleteColumnDisabled'));
        return;
      }
      if (confirm(t('kanban.deleteColumnConfirm').replace('{title}', col.title))) {
        deleteKanbanColumn(project.id, colId);
        render(container, project, options);
      }
    }

    // Column title double-click to rename is handled separately

    // Add card button
    const addCardBtn = e.target.closest('.btn-kanban-add-card');
    if (addCardBtn) {
      showInlineAddCard(container, project, addCardBtn.dataset.colId, options);
      return;
    }

    // Card delete
    const delCardBtn = e.target.closest('.kanban-card-delete');
    if (delCardBtn) {
      e.stopPropagation();
      const taskId = delCardBtn.dataset.taskId;
      const task = getTasks(project.id).find(t => t.id === taskId);
      if (!task) return;
      if (confirm(t('kanban.confirmDeleteCard').replace('{title}', task.title))) {
        deleteTask(project.id, taskId);
        render(container, project, options);
      }
      return;
    }

    // Card session badge click
    const sessionBadge = e.target.closest('.kanban-card-session');
    if (sessionBadge) {
      e.stopPropagation();
      const sessionId = sessionBadge.dataset.session;
      if (options.onSessionOpen) options.onSessionOpen(project, sessionId);
      return;
    }

    // Card click → edit modal
    const card = e.target.closest('.kanban-card');
    if (card && !e.target.closest('.kanban-card-drag-handle')) {
      const taskId = card.dataset.taskId;
      showEditCardModal(container, project, taskId, options);
    }
  });

  // Column title rename (double-click)
  board.addEventListener('dblclick', (e) => {
    const title = e.target.closest('.kanban-column-title');
    if (!title) return;
    const colEl = title.closest('.kanban-column');
    const colId = colEl?.dataset.colId;
    if (!colId) return;
    startRenameColumn(title, project, colId, container, options);
  });

  // Drag & drop
  initDragDrop(board, container, project, options);
}

// ── Column rename ─────────────────────────────────────────────

function startRenameColumn(titleEl, project, colId, container, options) {
  const original = titleEl.textContent;
  titleEl.contentEditable = 'true';
  titleEl.focus();
  // Select all
  const range = document.createRange();
  range.selectNodeContents(titleEl);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  const commit = () => {
    titleEl.contentEditable = 'false';
    const newTitle = titleEl.textContent.trim();
    if (newTitle && newTitle !== original) {
      updateKanbanColumn(project.id, colId, { title: newTitle });
    } else {
      titleEl.textContent = original;
    }
  };

  titleEl.addEventListener('blur', commit, { once: true });
  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
    if (e.key === 'Escape') { titleEl.textContent = original; titleEl.blur(); }
  }, { once: true });
}

// ── Inline add card form ──────────────────────────────────────

function showInlineAddCard(container, project, colId, options) {
  const colEl = container.querySelector(`.kanban-column[data-col-id="${colId}"]`);
  if (!colEl) return;
  // Remove existing add buttons and show form
  const addBtn = colEl.querySelector('.btn-kanban-add-card');
  if (addBtn) addBtn.style.display = 'none';

  const form = document.createElement('div');
  form.className = 'kanban-add-card-form';
  form.innerHTML = `
    <input class="kanban-add-card-input" placeholder="${t('kanban.cardTitlePlaceholder')}" maxlength="120">
    <div class="kanban-add-card-actions">
      <button class="kanban-add-card-cancel">${t('kanban.cancel')}</button>
      <button class="kanban-add-card-confirm">${t('kanban.save')}</button>
    </div>
  `;
  colEl.insertBefore(form, colEl.querySelector('.btn-kanban-add-card')?.nextSibling || null);
  const input = form.querySelector('input');
  input.focus();

  const cancel = () => {
    form.remove();
    if (addBtn) addBtn.style.display = '';
  };

  const confirm = () => {
    const title = input.value.trim();
    if (!title) { cancel(); return; }
    addTask(project.id, { title, columnId: colId });
    render(container, project, options);
  };

  form.querySelector('.kanban-add-card-cancel').addEventListener('click', cancel);
  form.querySelector('.kanban-add-card-confirm').addEventListener('click', confirm);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirm();
    if (e.key === 'Escape') cancel();
  });
}

// ── Add column modal ──────────────────────────────────────────

function showAddColumnModal(container, project) {
  const { Modal } = require('../components/Modal');
  const colors = LABEL_COLORS;
  let selectedColor = colors[4]; // blue default

  const content = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div>
        <label style="font-size:var(--font-xs);color:var(--text-secondary)">${t('kanban.columnTitle')}</label>
        <input id="kanban-new-col-title" class="kanban-add-card-input" style="margin-top:4px;display:block;width:100%"
          placeholder="${t('kanban.columnTitlePlaceholder')}" maxlength="40">
      </div>
      <div>
        <label style="font-size:var(--font-xs);color:var(--text-secondary)">${t('kanban.labelColor')}</label>
        <div class="kanban-color-presets" id="kanban-col-colors" style="margin-top:6px">
          ${colors.map(c => `<div class="kanban-color-preset${c === selectedColor ? ' active' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}
        </div>
      </div>
    </div>
  `;

  Modal.show({
    title: t('kanban.addColumnTitle'),
    content,
    size: 'small',
    confirmText: t('kanban.save'),
    cancelText: t('kanban.cancel'),
    onConfirm: (modalEl) => {
      const title = modalEl.querySelector('#kanban-new-col-title')?.value.trim();
      if (!title) return false;
      addKanbanColumn(project.id, { title, color: selectedColor });
      render(container, project, {});
      return true;
    },
    onMount: (modalEl) => {
      modalEl.querySelector('#kanban-col-colors')?.addEventListener('click', (e) => {
        const preset = e.target.closest('.kanban-color-preset');
        if (!preset) return;
        selectedColor = preset.dataset.color;
        modalEl.querySelectorAll('.kanban-color-preset').forEach(p => p.classList.toggle('active', p === preset));
      });
      modalEl.querySelector('#kanban-new-col-title')?.focus();
    }
  });
}

// ── Edit card modal ───────────────────────────────────────────

function showEditCardModal(container, project, taskId, options) {
  const { Modal } = require('../components/Modal');
  const task = getTasks(project.id).find(t => t.id === taskId);
  if (!task) return;
  const labels = getKanbanLabels(project.id);
  let selectedLabels = [...(task.labels || [])];

  const labelsHtml = labels.length > 0
    ? labels.map(lbl => `
        <span class="kanban-modal-label-chip${selectedLabels.includes(lbl.id) ? ' selected' : ''}"
              data-label-id="${escapeHtml(lbl.id)}"
              style="background:${escapeHtml(lbl.color)}">
          ${escapeHtml(lbl.name)}
        </span>
      `).join('')
    : `<span style="font-size:var(--font-xs);color:var(--text-muted)">—</span>`;

  const content = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div>
        <label style="font-size:var(--font-xs);color:var(--text-secondary)">${t('kanban.cardTitle')}</label>
        <input id="kanban-edit-title" class="kanban-add-card-input" style="margin-top:4px;display:block;width:100%"
          value="${escapeHtml(task.title)}" maxlength="120">
      </div>
      <div>
        <label style="font-size:var(--font-xs);color:var(--text-secondary)">${t('kanban.cardDescription')}</label>
        <textarea id="kanban-edit-desc" class="kanban-add-card-input" style="margin-top:4px;display:block;width:100%;resize:vertical;min-height:70px"
          placeholder="${t('kanban.cardDescriptionPlaceholder')}">${escapeHtml(task.description || '')}</textarea>
      </div>
      ${labels.length > 0 ? `
      <div>
        <label style="font-size:var(--font-xs);color:var(--text-secondary)">${t('kanban.cardLabels')}</label>
        <div class="kanban-modal-label-picker" id="kanban-label-picker" style="margin-top:6px">
          ${labelsHtml}
        </div>
      </div>
      ` : ''}
      ${task.sessionId ? `
      <div>
        <label style="font-size:var(--font-xs);color:var(--text-secondary)">${t('kanban.cardSession')}</label>
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
          <code style="font-size:var(--font-xs);color:var(--text-muted)">${escapeHtml(task.sessionId)}</code>
          <button id="kanban-edit-open-session" class="btn-kanban-add-label" style="width:auto;padding:4px 10px">
            ${t('kanban.cardSessionOpen')}
          </button>
        </div>
      </div>
      ` : ''}
    </div>
  `;

  Modal.show({
    title: t('kanban.editCard'),
    content,
    size: 'medium',
    confirmText: t('kanban.save'),
    cancelText: t('kanban.cancel'),
    onConfirm: (modalEl) => {
      const title = modalEl.querySelector('#kanban-edit-title')?.value.trim();
      if (!title) return false;
      const description = modalEl.querySelector('#kanban-edit-desc')?.value || '';
      updateTask(project.id, taskId, { title, description, labels: selectedLabels });
      render(container, project, options);
      return true;
    },
    onMount: (modalEl) => {
      // Label toggle
      modalEl.querySelector('#kanban-label-picker')?.addEventListener('click', (e) => {
        const chip = e.target.closest('.kanban-modal-label-chip');
        if (!chip) return;
        const lid = chip.dataset.labelId;
        if (selectedLabels.includes(lid)) {
          selectedLabels = selectedLabels.filter(id => id !== lid);
          chip.classList.remove('selected');
        } else {
          selectedLabels.push(lid);
          chip.classList.add('selected');
        }
      });
      // Open session
      modalEl.querySelector('#kanban-edit-open-session')?.addEventListener('click', () => {
        if (options.onSessionOpen) options.onSessionOpen(project, task.sessionId);
      });
      modalEl.querySelector('#kanban-edit-title')?.focus();
    }
  });
}

// ── Labels manager modal ──────────────────────────────────────

function showLabelsModal(container, project) {
  const { Modal } = require('../components/Modal');

  const renderLabelsList = (modalEl) => {
    const labels = getKanbanLabels(project.id);
    const listEl = modalEl.querySelector('#kanban-labels-list');
    if (!listEl) return;
    listEl.innerHTML = labels.map(lbl => `
      <div class="kanban-label-row" data-label-id="${escapeHtml(lbl.id)}">
        <input type="color" class="kanban-label-color-swatch" value="${escapeHtml(lbl.color)}"
               data-label-id="${escapeHtml(lbl.id)}">
        <input class="kanban-label-name-input" value="${escapeHtml(lbl.name)}" maxlength="30"
               data-label-id="${escapeHtml(lbl.id)}" placeholder="${t('kanban.labelNamePlaceholder')}">
        <button class="btn-kanban-delete-label" data-label-id="${escapeHtml(lbl.id)}" title="${t('kanban.deleteLabel')}">✕</button>
      </div>
    `).join('');
  };

  const content = `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="kanban-labels-list" id="kanban-labels-list"></div>
      <button class="btn-kanban-add-label" id="kanban-btn-add-label">${t('kanban.addLabel')}</button>
    </div>
  `;

  Modal.show({
    title: t('kanban.manageLabelsTitle'),
    content,
    size: 'medium',
    confirmText: t('kanban.save'),
    cancelText: t('kanban.cancel'),
    onConfirm: (modalEl) => {
      // Save all edits
      modalEl.querySelectorAll('.kanban-label-row').forEach(row => {
        const lid = row.dataset.labelId;
        const name = row.querySelector('.kanban-label-name-input')?.value.trim();
        const color = row.querySelector('.kanban-label-color-swatch')?.value;
        if (name) updateKanbanLabel(project.id, lid, { name, color });
      });
      render(container, project, {});
      return true;
    },
    onMount: (modalEl) => {
      renderLabelsList(modalEl);
      // Add label
      modalEl.querySelector('#kanban-btn-add-label')?.addEventListener('click', () => {
        const colors = LABEL_COLORS;
        const color = colors[getKanbanLabels(project.id).length % colors.length];
        addKanbanLabel(project.id, { name: t('kanban.labelNamePlaceholder'), color });
        renderLabelsList(modalEl);
      });
      // Delete label (delegated)
      modalEl.querySelector('#kanban-labels-list')?.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.btn-kanban-delete-label');
        if (!delBtn) return;
        deleteKanbanLabel(project.id, delBtn.dataset.labelId);
        renderLabelsList(modalEl);
      });
    }
  });
}

// ── Drag & Drop ───────────────────────────────────────────────

function initDragDrop(board, container, project, options) {
  let dragging = null; // { taskId, colId, cardEl, clone, placeholder }

  board.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.kanban-card-drag-handle');
    if (!handle) return;
    e.preventDefault();

    const card = handle.closest('.kanban-card');
    const taskId = card?.dataset.taskId;
    const colId = card?.dataset.colId;
    if (!taskId) return;

    const rect = card.getBoundingClientRect();

    // Create floating clone
    const clone = document.createElement('div');
    clone.className = 'kanban-drag-clone';
    clone.innerHTML = card.innerHTML;
    clone.style.left = rect.left + 'px';
    clone.style.top = rect.top + 'px';
    document.body.appendChild(clone);

    // Create placeholder
    const placeholder = document.createElement('div');
    placeholder.className = 'kanban-drag-placeholder';
    card.parentNode.insertBefore(placeholder, card.nextSibling);

    card.classList.add('dragging');

    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    dragging = { taskId, colId, cardEl: card, clone, placeholder, offsetX, offsetY };
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const { clone, placeholder, offsetX, offsetY } = dragging;

    clone.style.left = (e.clientX - offsetX) + 'px';
    clone.style.top = (e.clientY - offsetY) + 'px';

    // Find target column
    const targetColEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.kanban-cards');
    if (!targetColEl) return;

    const cards = [...targetColEl.querySelectorAll('.kanban-card:not(.dragging)')];
    let insertBefore = null;

    for (const c of cards) {
      const cRect = c.getBoundingClientRect();
      if (e.clientY < cRect.top + cRect.height / 2) {
        insertBefore = c;
        break;
      }
    }

    // Remove placeholder from old position
    if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);

    if (insertBefore) {
      targetColEl.insertBefore(placeholder, insertBefore);
    } else {
      targetColEl.appendChild(placeholder);
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    const { taskId, cardEl, clone, placeholder } = dragging;
    dragging = null;

    clone.remove();
    cardEl.classList.remove('dragging');

    // Determine target col and order from placeholder position
    const targetColEl = placeholder.parentNode;
    const targetColId = targetColEl?.dataset.colId;

    if (targetColEl && targetColId) {
      const siblings = [...targetColEl.querySelectorAll('.kanban-card:not(.dragging)')];
      const phIdx = [...targetColEl.children].indexOf(placeholder);
      // Count cards before placeholder (excluding placeholder itself)
      let order = 0;
      for (const child of targetColEl.children) {
        if (child === placeholder) break;
        if (child.classList.contains('kanban-card')) order++;
      }
      moveTask(project.id, taskId, targetColId, order);
    }

    placeholder.remove();
    render(container, project, options);
  });

  // Cancel drag on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dragging) {
      const { cardEl, clone, placeholder } = dragging;
      dragging = null;
      clone.remove();
      placeholder.remove();
      cardEl.classList.remove('dragging');
    }
  });
}

module.exports = { render };
```

### Step 2: Run the app to verify no syntax errors

```bash
npm run build:renderer
```

Expected: build completes without errors.

### Step 3: Commit

```bash
git add src/renderer/ui/panels/KanbanPanel.js
git commit -m "feat(kanban): add KanbanPanel with drag&drop, modals, labels"
```

---

## Task 6: Check `Modal.js` API

**Files:**
- Read: `src/renderer/ui/components/Modal.js`

### Step 1: Read the Modal component

Check that `Modal.show()` supports `onMount` and `onConfirm` callbacks. If the API differs, adapt `KanbanPanel.js` to match the actual Modal API.

Look for: how the modal is shown, what callbacks it accepts, how to get the modal DOM element in callbacks.

### Step 2: Adapt if needed

If `Modal.show()` has a different signature (e.g., it uses a different method or event system), update `showAddColumnModal`, `showEditCardModal`, and `showLabelsModal` in `KanbanPanel.js` accordingly.

---

## Task 7: Wire KanbanPanel into DashboardService

**Files:**
- Modify: `src/renderer/services/DashboardService.js`

### Step 1: Add `require` at top of file

After the existing requires, add:
```js
const KanbanPanel = require('../ui/panels/KanbanPanel');
```

### Step 2: Add sub-tab switcher to `renderDashboardHtml` (line ~1405)

After the opening of `container.innerHTML = \`...`, and before the `dashboard-project-header`, add:

```js
// Track current view per project (module-level map)
const _dashViews = new Map(); // projectId → 'overview' | 'kanban'
```

Add this at the top of the file (module level, after requires).

Then modify `renderDashboardHtml` to prepend the view tab bar and conditionally render kanban:

```js
function renderDashboardHtml(container, project, data, options, isRefreshing = false) {
  const currentView = _dashViews.get(project.id) || 'overview';

  if (currentView === 'kanban') {
    container.innerHTML = buildDashViewTabsHtml(project.id, 'kanban');
    const kanbanContainer = document.createElement('div');
    kanbanContainer.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column';
    container.appendChild(kanbanContainer);
    KanbanPanel.render(kanbanContainer, project, {
      onSessionOpen: options.onTaskSessionOpen,
    });
    attachViewTabEvents(container, project, data, options, isRefreshing);
    return;
  }

  // ... existing overview rendering ...
```

### Step 3: Add helper functions

```js
function buildDashViewTabsHtml(projectId, activeView) {
  return `
    <div class="dashboard-view-tabs">
      <button class="dashboard-view-tab${activeView === 'overview' ? ' active' : ''}" data-view="overview">
        ${t('dashboard.title')}
      </button>
      <button class="dashboard-view-tab${activeView === 'kanban' ? ' active' : ''}" data-view="kanban">
        ${t('kanban.tab')}
      </button>
    </div>
  `;
}

function attachViewTabEvents(container, project, data, options, isRefreshing) {
  container.querySelectorAll('.dashboard-view-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      _dashViews.set(project.id, view);
      renderDashboardHtml(container, project, data, options, isRefreshing);
    });
  });
}
```

### Step 4: Prepend the tab bar to the overview rendering too

At the start of the `container.innerHTML = \`...\`` template in `renderDashboardHtml`, prepend:
```
${buildDashViewTabsHtml(project.id, 'overview')}
```

And call `attachViewTabEvents` at the end of `renderDashboardHtml` (after attaching all other listeners).

### Step 5: Remove `buildTasksHtml` from `renderDashboardHtml`

Remove the line:
```js
${buildTasksHtml(project)}
```
from the dashboard grid HTML (around line 1482).

### Step 6: Remove `attachTaskListeners` call and related options

Remove `onTaskSessionOpen` and `onTaskRender` from options destructuring (lines 1393-1394) and the `attachTaskListeners` call (lines 1567-1568).

### Step 7: Build and smoke-test

```bash
npm run build:renderer
npm start
```

Navigate to a project dashboard. Verify the "Overview | Kanban" tabs appear. Click Kanban. Verify the board renders.

### Step 8: Commit

```bash
git add src/renderer/services/DashboardService.js
git commit -m "feat(kanban): wire KanbanPanel into dashboard, add view switcher"
```

---

## Task 8: Link CSS and clean up old styles

**Files:**
- Modify: `index.html`
- Modify: `styles/dashboard.css`

### Step 1: Add kanban.css link in `index.html`

Find the existing CSS `<link>` tags and add:
```html
<link rel="stylesheet" href="styles/kanban.css">
```

### Step 2: Remove old task CSS from `dashboard.css`

Search for and remove the entire block of `.tasks-*` and `.task-*` and `.btn-task-*` rules (approximately lines 2325–2530 in `dashboard.css`).

Grep first to find exact lines:
```bash
grep -n "\.tasks-\|\.task-\|\.btn-task-" styles/dashboard.css
```

Then remove those blocks.

### Step 3: Build

```bash
npm run build:renderer
```

Expected: no errors.

### Step 4: Commit

```bash
git add index.html styles/dashboard.css
git commit -m "feat(kanban): link kanban.css, remove old task-list styles"
```

---

## Task 9: Final smoke test

### Step 1: Run all tests

```bash
npm test
```

Expected: all suites PASS.

### Step 2: Start the app and test manually

```bash
npm start
```

Verify:
- Dashboard shows "Overview | Kanban" tabs
- Clicking Kanban shows 3 default columns
- Can add a card (inline form), see it appear
- Can click a card to open the edit modal (title, description, labels)
- Can drag a card from one column to another
- Can add a new column (+ Colonne button)
- Can rename a column (double-click on title)
- Can delete an empty column
- Can manage labels (⚙ Labels button)
- Existing tasks from before (migrated) appear in correct columns
- Switching back to Overview still works

### Step 3: Commit final

```bash
git add -A
git commit -m "feat(kanban): complete kanban board implementation"
```
