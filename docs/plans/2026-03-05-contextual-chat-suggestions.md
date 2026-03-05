# Contextual Chat Suggestions — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Afficher des suggestions contextuelles (TODOs, git changes) comme placeholder dynamique dans la textarea du chat — Tab pour accepter, rotation automatique si plusieurs suggestions.

**Architecture:** Module `ContextSuggestions` inline dans `ChatView.js`. Scan parallèle via `api.project.scanTodos` et `api.git.statusDetailed`. Hooks dans `setStreaming()`, `inputEl.input`, et `inputEl.keydown`. Rotation via `setInterval`.

**Tech Stack:** Vanilla JS, `window.electron_api.project.scanTodos`, `window.electron_api.git.statusDetailed`, i18n `t()`.

---

### Task 1: Ajouter les clés i18n

**Files:**
- Modify: `src/renderer/i18n/locales/fr.json`
- Modify: `src/renderer/i18n/locales/en.json`

**Step 1: Ajouter les clés FR**

Dans `src/renderer/i18n/locales/fr.json`, dans l'objet `"chat"`, ajouter après `"placeholder"` :

```json
"suggestTodos": "Tu as {count} TODO(s), les traiter ? [Tab]",
"suggestGit": "Tu as {count} fichier(s) non commités, les reviewer ? [Tab]",
```

**Step 2: Ajouter les clés EN**

Dans `src/renderer/i18n/locales/en.json`, dans l'objet `"chat"`, ajouter après `"placeholder"` :

```json
"suggestTodos": "You have {count} TODO(s), handle them? [Tab]",
"suggestGit": "You have {count} uncommitted file(s), review them? [Tab]",
```

**Step 3: Vérifier la syntaxe JSON**

```bash
node -e "require('./src/renderer/i18n/locales/fr.json'); console.log('FR OK')"
node -e "require('./src/renderer/i18n/locales/en.json'); console.log('EN OK')"
```
Expected: `FR OK` et `EN OK`

**Step 4: Commit**

```bash
git add src/renderer/i18n/locales/fr.json src/renderer/i18n/locales/en.json
git commit -m "feat(i18n): add contextual chat suggestion keys"
```

---

### Task 2: Implémenter le module ContextSuggestions dans ChatView.js

**Files:**
- Modify: `src/renderer/ui/components/ChatView.js`

**Contexte important :**
- `createChatView(wrapperEl, project, options)` commence à la ligne ~127
- `const inputEl` est défini à la ligne ~219
- `setStreaming(streaming)` est défini à la ligne ~2866 ; quand `streaming=false`, ligne ~2875 fait `inputEl.placeholder = t('chat.placeholder')`
- `inputEl.addEventListener('input', ...)` est à la ligne ~460
- `inputEl.addEventListener('keydown', ...)` est à la ligne ~490
- Après `initEffortSelector()` à la ligne ~378

**Step 1: Ajouter le module ContextSuggestions**

Trouver la ligne qui commence par `// ── Tool Icons ──` (autour de la ligne 96-98, avant `function getToolIcon`). Insérer le bloc suivant **juste avant** cette ligne :

```js
// ── Context Suggestions ──

function createContextSuggestions(project, inputEl, getDefaultPlaceholder) {
  const CACHE_TTL = 30_000;
  const ROTATION_INTERVAL = 4_000;

  let suggestions = [];
  let currentIndex = 0;
  let rotationTimer = null;
  let cache = null; // { suggestions: string[], timestamp: number }

  function buildSuggestions(todos, gitStatus) {
    const result = [];
    const todoCount = Array.isArray(todos) ? todos.length : 0;
    const gitCount = gitStatus
      ? (gitStatus.modified?.length || 0) + (gitStatus.staged?.length || 0) + (gitStatus.untracked?.length || 0)
      : 0;
    if (todoCount > 0) result.push(t('chat.suggestTodos', { count: todoCount }));
    if (gitCount > 0) result.push(t('chat.suggestGit', { count: gitCount }));
    return result;
  }

  async function refresh() {
    if (!project?.path) return;
    const now = Date.now();
    if (cache && now - cache.timestamp < CACHE_TTL) {
      suggestions = cache.suggestions;
      _start();
      return;
    }
    try {
      const [todos, gitStatus] = await Promise.all([
        api.project.scanTodos(project.path).catch(() => []),
        api.git.statusDetailed({ projectPath: project.path }).catch(() => null),
      ]);
      suggestions = buildSuggestions(todos, gitStatus);
      cache = { suggestions, timestamp: Date.now() };
    } catch {
      suggestions = [];
    }
    _start();
  }

  function _start() {
    stop();
    if (!suggestions.length) return;
    currentIndex = 0;
    _apply();
    if (suggestions.length > 1) {
      rotationTimer = setInterval(() => {
        if (inputEl.value !== '') { stop(); return; }
        currentIndex = (currentIndex + 1) % suggestions.length;
        _apply();
      }, ROTATION_INTERVAL);
    }
  }

  function _apply() {
    // Don't overwrite if user has typed something
    if (inputEl.value !== '') return;
    inputEl.placeholder = suggestions[currentIndex] || getDefaultPlaceholder();
  }

  function stop() {
    if (rotationTimer) { clearInterval(rotationTimer); rotationTimer = null; }
  }

  function reset() {
    stop();
    suggestions = [];
    inputEl.placeholder = getDefaultPlaceholder();
  }

  function handleTab(event) {
    if (inputEl.value !== '' || !suggestions.length) return false;
    event.preventDefault();
    // Strip the " [Tab]" hint from the raw i18n string and insert clean text
    const raw = suggestions[currentIndex] || '';
    const clean = raw.replace(/\s*\[Tab\]\s*$/, '');
    inputEl.value = clean;
    inputEl.selectionStart = inputEl.selectionEnd = clean.length;
    reset();
    return true;
  }

  return { refresh, stop, reset, handleTab };
}
```

**Step 2: Instancier ContextSuggestions dans createChatView**

Chercher la ligne `initEffortSelector();` (autour de la ligne 378). Juste **après**, ajouter :

```js
  // ── Context suggestions ──
  const contextSuggestions = createContextSuggestions(project, inputEl, () => t('chat.placeholder'));
  // Defer initial scan to let the component finish mounting
  setTimeout(() => { if (project?.path) contextSuggestions.refresh(); }, 500);
```

**Step 3: Hook dans inputEl.addEventListener('input', ...)**

Chercher le bloc existant (ligne ~460) :
```js
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
```

Ajouter une ligne juste après `inputEl.style.height = Math.min(...)` :
```js
    if (inputEl.value !== '') contextSuggestions.stop();
```

**Step 4: Hook Tab dans inputEl.addEventListener('keydown', ...)**

Chercher la fin du bloc de navigation keydown (après le bloc `if (slashDropdown...)` et juste avant le bloc `if (e.key === 'Enter' && !shiftHeld...)`). Le texte à trouver est :
```js
    if (e.key === 'Enter' && !shiftHeld && !e.shiftKey && !e.getModifierState('Shift')) {
```

Insérer **juste avant** cette ligne :
```js
    // Context suggestion — Tab to accept
    if (e.key === 'Tab' && mentionDropdown.style.display === 'none' && slashDropdown.style.display === 'none') {
      if (contextSuggestions.handleTab(e)) return;
    }

```

**Step 5: Hook dans setStreaming()**

Chercher le bloc `setStreaming` (ligne ~2866) :
```js
    } else {
      inputEl.placeholder = t('chat.placeholder');
      setStatus('idle', t('chat.ready') || 'Ready');
      inputEl.focus();
    }
```

Remplacer `inputEl.placeholder = t('chat.placeholder');` par :
```js
      // Refresh contextual suggestions after streaming ends
      setTimeout(() => contextSuggestions.refresh(), 300);
```

**Step 6: Cleanup dans destroy()**

Chercher la fonction `destroy()` dans le return de `createChatView`. Elle fait `unsubscribers.forEach(fn => fn())`. Ajouter `contextSuggestions.reset()` dans cette fonction.

Pour trouver la ligne exacte, chercher `unsubscribers.forEach` dans ChatView.js.

**Step 7: Rebuild le renderer**

```bash
npm run build:renderer
```
Expected: succès sans erreur

**Step 8: Commit**

```bash
git add src/renderer/ui/components/ChatView.js
git commit -m "feat(chat): add contextual suggestions as dynamic placeholder with Tab-to-accept"
```

---

### Task 3: Vérification manuelle

**Step 1: Lancer l'app**

```bash
npm start
```

**Step 2: Vérifier les suggestions**

1. Ouvrir un projet qui a des TODOs ou des fichiers git modifiés
2. Ouvrir le chat
3. Vérifier que le placeholder affiche "Tu as X TODO(s)..." ou "Tu as X fichier(s)..."
4. Appuyer sur Tab → le texte doit se mettre dans la textarea
5. Envoyer un message → après la réponse, le placeholder doit se réactualiser
6. Si le projet n'a pas de TODOs ni de changements git → placeholder par défaut normal

**Step 3: Vérifier la rotation**

1. Créer un projet avec à la fois des TODOs et des fichiers git modifiés
2. Vérifier que les suggestions alternent toutes les 4 secondes

**Step 4: Commit final si tout est OK**

Si des ajustements mineurs ont été faits, committer :
```bash
git add -p
git commit -m "fix(chat): adjust contextual suggestion behavior"
```
