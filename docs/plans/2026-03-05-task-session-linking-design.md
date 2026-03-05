# Design : Task-Session Linking

**Date :** 2026-03-05
**Branch :** feat/task-list
**Statut :** Approuvé

## Contexte

Ajouter une liste de tâches légère par projet dans Claude Terminal, où chaque tâche peut être liée à une session Claude. Périmètre minimal : `todo / in_progress / done`, pas de Kanban, pas de priorités.

## Décisions architecturales

### Stockage : Renderer-only (pattern QuickActions)

Les tâches sont stockées dans `~/.claude-terminal/projects.json` sous chaque projet, via les fonctions renderer existantes. Pas de nouvel IPC handler — même pattern que les `quickActions`.

**Raison :** Évite la duplication de la logique d'écriture entre main et renderer. L'IPC est réservé aux opérations qui nécessitent réellement le main process.

### Capture du sessionId : Manuelle

Le bouton "Lier session" lie manuellement la session Claude active à la tâche en cours. Pas d'auto-capture.

### Ouverture de Claude : Selon `defaultTerminalMode`

Le bouton "Démarrer" respecte les préférences de l'utilisateur (terminal ou chat intégré).

## Modèle de données

Extension du schéma projet dans `projects.json` :

```json
{
  "id": "proj_123",
  "name": "MonProjet",
  "tasks": [
    {
      "id": "task-1234567890-abc123",
      "title": "Implémenter l'auth",
      "status": "done",
      "sessionId": "uuid-de-session",
      "createdAt": 1234567890000,
      "updatedAt": 1234567890001
    }
  ]
}
```

**Champs :**
- `id` : `task-{Date.now()}-{random9chars}`
- `status` : `"todo"` | `"in_progress"` | `"done"`
- `sessionId` : string | null — lié manuellement
- `sessionRecap` : réservé pour implémentation future (non inclus dans cette version)
- `createdAt` / `updatedAt` : timestamps ms

## Architecture renderer

### projects.state.js — nouvelles fonctions

```js
function generateTaskId()
// → "task-{Date.now()}-{Math.random().toString(36).substr(2, 9)}"

function getTasks(projectId)
// → project.tasks || []

function addTask(projectId, { title })
// Crée tâche status=todo, id/createdAt/updatedAt auto
// Appelle updateProject() → saveProjects()

function updateTask(projectId, taskId, updates)
// Met à jour champs + updatedAt automatique
// Appelle updateProject() → saveProjects()

function deleteTask(projectId, taskId)
// Retire la tâche du tableau
// Appelle updateProject() → saveProjects()
```

## UI — Dashboard

### Emplacement

Section `buildTasksHtml(project)` insérée en tête de la colonne gauche du dashboard (avant `buildGitStatusHtml`).

### Structure HTML

```
┌─ Tâches ──────────────────────────── [+ Ajouter] ─┐
│ ○  À faire      Implémenter l'auth    [▶]      [🗑] │
│ ●  En cours     Écrire les tests      [✓][🔗]  [🗑] │
│ ✓  Terminé      Setup CI              [🔗 session]  │
│                                                     │
│ [input inline quand on clique Ajouter]              │
└─────────────────────────────────────────────────────┘
```

### Interactions

| Action | Comportement |
|--------|-------------|
| `[+ Ajouter]` | Input inline + confirm/cancel. `addTask()` au submit |
| `[▶]` Démarrer | `updateTask(status='in_progress')` + ouvre Claude selon `defaultTerminalMode` |
| `[✓]` Terminer | `updateTask(status='done')` |
| `[🗑]` Supprimer | `deleteTask()` après confirmation |
| `[🔗]` Lier session | Récupère le sessionId de la session active, `updateTask(sessionId=...)` |
| Clic sur sessionId | Toast avec le sessionId (recap différé) |

### Classes CSS (dashboard.css)

```css
.task-list { }
.task-item { }
.task-item.todo { }
.task-item.in-progress { }
.task-item.done { }
.task-item-status { }
.task-item-title { }
.task-item-actions { }
.task-add-form { }
.task-add-input { }
```

## i18n

Clés ajoutées sous `tasks.*` dans `fr.json` et `en.json` :

```json
"tasks": {
  "title": "Tâches",
  "add": "Ajouter",
  "addPlaceholder": "Titre de la tâche...",
  "noTasks": "Aucune tâche",
  "statusTodo": "À faire",
  "statusInProgress": "En cours",
  "statusDone": "Terminé",
  "start": "Démarrer",
  "complete": "Terminer",
  "delete": "Supprimer",
  "linkSession": "Lier session",
  "sessionLinked": "Session liée : {sessionId}",
  "noActiveSession": "Aucune session active à lier"
}
```

## Fichiers modifiés

| Fichier | Changement |
|---------|-----------|
| `src/renderer/state/projects.state.js` | +`generateTaskId`, `getTasks`, `addTask`, `updateTask`, `deleteTask` + exports |
| `src/renderer/services/DashboardService.js` | +`buildTasksHtml()`, intégré dans la colonne gauche |
| `styles/dashboard.css` | +styles section tasks |
| `src/renderer/i18n/locales/fr.json` | +namespace `tasks` |
| `src/renderer/i18n/locales/en.json` | +namespace `tasks` |

**Aucun nouveau fichier IPC, aucune modification du preload.js.**

## Hors périmètre (cette version)

- Kanban drag & drop
- Session recap automatique (`sessionRecap`)
- Priorités / labels / assignees
- IPC dédié pour les tâches
