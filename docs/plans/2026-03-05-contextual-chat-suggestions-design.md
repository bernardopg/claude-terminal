# Design — Suggestions contextuelles dans le chat

**Date :** 2026-03-05
**Branche :** `feat/suggest-chat`
**Statut :** Approuvé

## Objectif

Afficher des suggestions contextuelles dans le placeholder de la textarea du chat, basées sur l'état courant du projet (TODOs, modifications git non commitées). L'utilisateur peut appuyer sur Tab pour accepter la suggestion et l'insérer comme texte réel.

## Comportement

### Déclenchement
- Au chargement du chat (si textarea vide)
- Après chaque envoi de message (quand la textarea redevient vide)

### Sources de données
| Source | API | Condition | Message |
|---|---|---|---|
| TODOs | `api.project.scanTodos(path)` | `count >= 1` | `"Tu as {n} TODO(s), les traiter ?"` |
| Git changes | `api.git.statusDetailed({ projectPath })` | `modified + staged + untracked >= 1` | `"Tu as {n} fichier(s) non commités, les reviewer ?"` |

### Affichage
- **0 suggestions détectées** → placeholder par défaut (`t('chat.placeholder')`)
- **1 suggestion** → `inputEl.placeholder = "<suggestion>  [Tab]"`
- **≥ 2 suggestions** → rotation automatique toutes les 4 secondes

### Tab pour accepter
- `keydown Tab` + `inputEl.value === ''` + suggestion active → `event.preventDefault()`, insère le texte de la suggestion (sans le hint `[Tab]`)
- Curseur positionné en fin de texte

### Annulation de la rotation
- Dès que `inputEl.value !== ''` → stop rotation + placeholder par défaut restauré

### Cache
- Résultats des scans mis en cache 30 secondes pour éviter des appels répétés
- Les deux scans s'exécutent en parallèle via `Promise.all`

## Architecture

### Module `ContextSuggestions` (inline dans ChatView.js)

```js
// Encapsule tout l'état et la logique des suggestions
const ContextSuggestions = {
  suggestions: [],      // string[] — liste courante
  currentIndex: 0,      // index de la suggestion affichée
  rotationTimer: null,  // setInterval handle
  cache: null,          // { todos, git, timestamp }
  CACHE_TTL: 30000,
  ROTATION_INTERVAL: 4000,

  async refresh(project) { ... },   // scan + rebuild suggestions
  start(inputEl, defaultPlaceholder) { ... },  // active la rotation
  stop(inputEl, defaultPlaceholder) { ... },   // désactive
  handleTab(inputEl, event) { ... } // acceptation Tab
}
```

### Hooks dans ChatView

| Point d'accroche | Action |
|---|---|
| Après `initModelSelector()` | `ContextSuggestions.refresh()` + `.start()` |
| `sendBtn click` (après envoi) | `ContextSuggestions.refresh()` puis `.start()` avec délai 300ms |
| `inputEl input` (si value non vide) | `ContextSuggestions.stop()` |
| `inputEl keydown Tab` | `ContextSuggestions.handleTab()` |

## Fichiers modifiés

| Fichier | Nature du changement |
|---|---|
| `src/renderer/ui/components/ChatView.js` | Ajout module `ContextSuggestions` + hooks |
| `src/renderer/i18n/locales/fr.json` | Nouvelles clés `chat.suggestTodos`, `chat.suggestGit` |
| `src/renderer/i18n/locales/en.json` | Mêmes clés EN |

## Hors périmètre

- Pas de changement CSS
- Pas de nouvelles sources (erreurs terminal, sessions récentes)
- Pas de persistance de l'état des suggestions
