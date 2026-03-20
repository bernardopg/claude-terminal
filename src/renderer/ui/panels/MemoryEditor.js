/**
 * MemoryEditor Panel
 * CLAUDE.md editor with templates, markdown preview, and search
 * Extracted from renderer.js — migrated to BasePanel OOP pattern
 */

const { BasePanel } = require('../../core/BasePanel');
const { escapeHtml } = require('../../utils');
const { t } = require('../../i18n');
const { projectsState } = require('../../state');

// ── Module-level constants (no instance state) ──

const MEMORY_TEMPLATES = {
  minimal: {
    name: 'Minimal',
    icon: '\u{1F4DD}',
    content: `# {PROJECT_NAME}

## Description
Decrivez votre projet ici.

## Instructions
- Preferez TypeScript a JavaScript
- Utilisez des noms de variables explicites
`
  },
  fullstack: {
    name: 'Fullstack',
    icon: '\u{1F680}',
    content: `# {PROJECT_NAME}

## Architecture
- Frontend: React/Vue/Svelte
- Backend: Node.js/Express
- Database: PostgreSQL/MongoDB

## Conventions de code
- Utilisez ESLint et Prettier
- Commits en francais avec emojis
- Tests unitaires obligatoires

## Structure des dossiers
\`\`\`
src/
  components/   # Composants UI
  services/     # Logique metier
  utils/        # Fonctions utilitaires
  types/        # Types TypeScript
\`\`\`

## Commandes utiles
\`\`\`bash
npm run dev     # Developpement
npm run build   # Production
npm run test    # Tests
\`\`\`
`
  },
  fivem: {
    name: 'FiveM Resource',
    icon: '\u{1F3AE}',
    content: `# {PROJECT_NAME}

## Type de Resource
Resource FiveM (client/server/shared)

## Framework
- ESX / QBCore / Standalone

## Structure
\`\`\`
client/     # Code client (NUI, events)
server/     # Code serveur (database, callbacks)
shared/     # Code partage (config, utils)
html/       # Interface NUI (HTML/CSS/JS)
\`\`\`

## Conventions FiveM
- Prefixer les events: \`{resource}:{event}\`
- Utiliser les callbacks pour les requetes serveur
- Optimiser les threads (pas de Wait(0) sans raison)
- Nettoyer les entities au stop de la resource

## Database
- Utiliser oxmysql pour les requetes async
- Preparer les statements pour eviter les injections
`
  },
  api: {
    name: 'API REST',
    icon: '\u{1F50C}',
    content: `# {PROJECT_NAME}

## Type
API REST

## Endpoints
Document your endpoints here:
- \`GET /api/v1/...\`
- \`POST /api/v1/...\`

## Authentication
- JWT / API Keys / OAuth2

## Conventions
- Versionning des endpoints (/v1/, /v2/)
- Reponses JSON standardisees
- Gestion des erreurs coherente
- Rate limiting

## Documentation
Generer la doc Swagger/OpenAPI
`
  },
  library: {
    name: 'Librairie/Package',
    icon: '\u{1F4E6}',
    content: `# {PROJECT_NAME}

## Type
Package NPM / Librairie

## Installation
\`\`\`bash
npm install {PROJECT_NAME}
\`\`\`

## API publique
Documentez les fonctions exportees ici.

## Conventions
- Exports nommes preferes aux exports default
- Types TypeScript inclus
- Tests avec couverture > 80%
- Changelog maintenu
- Semver respecte
`
  }
};

// ── Module-level pure functions (no state dependency) ──

function parseMarkdownToHtml(md) {
  const { marked } = require('marked');
  const DOMPurify = require('dompurify');

  const renderer = {
    code({ text, lang }) {
      return `<pre class="code-block"><code class="lang-${lang || ''}">${text}</code></pre>`;
    },
    codespan({ text }) {
      return `<code class="inline-code">${text}</code>`;
    },
    link({ href, text }) {
      return `<a href="${href}" class="memory-link">${text}</a>`;
    },
    table({ header, rows }) {
      const headerHtml = header.map(h => `<th>${h.text}</th>`).join('');
      const rowsHtml = rows.map(row => `<tr>${row.map(cell => `<td>${cell.text}</td>`).join('')}</tr>`).join('');
      return `<table class="memory-table"><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
    },
    listitem({ text }) {
      return `<li>${text}</li>\n`;
    }
  };

  marked.use({ renderer, gfm: true, breaks: false });
  const rawHtml = marked.parse(md);
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','strong','em','code','pre',
                   'ul','ol','li','a','table','thead','tbody','tr','th','td','mark',
                   'blockquote','hr','span','div'],
    ALLOWED_ATTR: ['href', 'class'],
    ALLOW_DATA_ATTR: false
  });
}

function calculateMemoryStats(content, source) {
  if (source === 'settings' || source === 'commands') {
    try {
      const json = JSON.parse(content);
      const keys = Object.keys(json).length;
      return `<span class="memory-stat"><span class="stat-value">${keys}</span> ${t('memory.keys')}</span>`;
    } catch {
      return '';
    }
  }

  const lines = content.split('\n').length;
  const words = content.split(/\s+/).filter(w => w.length > 0).length;
  const sections = (content.match(/^##\s/gm) || []).length;
  const codeBlocks = (content.match(/```/g) || []).length / 2;

  let html = `
    <span class="memory-stat"><span class="stat-value">${lines}</span> ${t('memory.lines')}</span>
    <span class="memory-stat"><span class="stat-value">${words}</span> ${t('memory.words')}</span>
  `;

  if (sections > 0) {
    html += `<span class="memory-stat"><span class="stat-value">${sections}</span> ${t('memory.sections')}</span>`;
  }
  if (codeBlocks > 0) {
    html += `<span class="memory-stat"><span class="stat-value">${Math.floor(codeBlocks)}</span> ${t('memory.codeBlocks')}</span>`;
  }

  return html;
}

// ── MemoryEditor class ──

class MemoryEditor extends BasePanel {
  /**
   * @param {HTMLElement} el
   * @param {object} options
   * @param {import('../../core/ApiProvider').ApiProvider} options.api
   * @param {import('../../core/ServiceContainer').ServiceContainer} options.container
   * @param {Function} options.showModal
   * @param {Function} options.closeModal
   * @param {Function} options.showToast
   */
  constructor(el, options = {}) {
    super(el, options);
    this._showModal = options.showModal || null;
    this._closeModal = options.closeModal || null;
    this._showToast = options.showToast || null;
    this._state = {
      currentSource: 'global',
      currentProject: null,
      content: '',
      isEditing: false,
      listenersAttached: false,
      fileExists: false,
      searchQuery: ''
    };
  }

  // ── Path helpers ──

  _getClaudeDir() {
    return this.api.path.join(this.api.os.homedir(), '.claude');
  }

  _getGlobalClaudeMd() {
    return this.api.path.join(this._getClaudeDir(), 'CLAUDE.md');
  }

  _getClaudeSettingsJson() {
    return this.api.path.join(this._getClaudeDir(), 'settings.json');
  }

  // ── Public entry points ──

  async loadMemory() {
    this.renderMemorySources();
    await this.loadMemoryContent('global');
    this.setupMemoryEventListeners();
    this.initMemorySidebarResizer();
  }

  // ── Sidebar resizer ──

  initMemorySidebarResizer() {
    const resizer = document.getElementById('memory-sidebar-resizer');
    const panel = document.querySelector('.memory-sidebar');
    if (!resizer || !panel) return;

    let startX, startWidth;

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startWidth = panel.offsetWidth;
      resizer.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMouseMove = (ev) => {
        const newWidth = Math.min(500, Math.max(150, startWidth + (ev.clientX - startX)));
        panel.style.width = newWidth + 'px';
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        resizer.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        const { settingsState, saveSettingsImmediate } = require('../../state/settings.state');
        settingsState.setProp('memorySidebarWidth', panel.offsetWidth);
        saveSettingsImmediate();
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  // ── Source list rendering ──

  renderMemorySources(filter = '') {
    const projectsList = document.getElementById('memory-projects-list');
    const projects = projectsState.get().projects;
    const searchQuery = filter.toLowerCase();

    if (projects.length === 0) {
      projectsList.innerHTML = `<div class="memory-no-projects">${t('memory.noProjects')}</div>`;
      return;
    }

    const filteredProjects = projects.map((p, i) => ({ ...p, index: i }))
      .filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery));

    if (filteredProjects.length === 0) {
      projectsList.innerHTML = `<div class="memory-no-projects">${t('memory.noResults', { query: escapeHtml(filter) })}</div>`;
      return;
    }

    projectsList.innerHTML = filteredProjects.map(p => {
      const claudeMdPath = this.api.path.join(p.path, 'CLAUDE.md');
      const hasClaudeMd = this.api.fs.existsSync(claudeMdPath);
      const claudeIgnorePath = this.api.path.join(p.path, '.claudeignore');
      const hasClaudeIgnore = this.api.fs.existsSync(claudeIgnorePath);
      const localClaudeDir = this.api.path.join(p.path, '.claude');
      const hasLocalSettings = this.api.fs.existsSync(this.api.path.join(localClaudeDir, 'settings.json'));

      return `
        <div class="memory-source-item ${this._state.currentSource === 'project' && this._state.currentProject === p.index ? 'active' : ''}"
             data-source="project" data-project="${p.index}">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/>
          </svg>
          <span>${escapeHtml(p.name)}</span>
          <div class="memory-source-badges">
            ${hasClaudeMd ? '<span class="memory-badge" title="CLAUDE.md">MD</span>' : ''}
            ${hasClaudeIgnore ? '<span class="memory-badge ignore" title=".claudeignore">IG</span>' : ''}
            ${hasLocalSettings ? '<span class="memory-badge settings" title="Settings locaux">\u2699</span>' : ''}
          </div>
        </div>
      `;
    }).join('');

    // Update active states for global, settings, and commands
    document.querySelectorAll('#memory-sources-list > .memory-source-item').forEach(item => {
      const source = item.dataset.source;
      const isActive = source === this._state.currentSource &&
        (this._state.currentSource !== 'project' || parseInt(item.dataset.project) === this._state.currentProject);
      item.classList.toggle('active', isActive);
    });
  }

  // ── Content loading ──

  async loadMemoryContent(source, projectIndex = null) {
    this._state.currentSource = source;
    this._state.currentProject = projectIndex;
    this._state.isEditing = false;

    const titleEl = document.getElementById('memory-title');
    const pathEl = document.getElementById('memory-path');
    const contentEl = document.getElementById('memory-content');
    const statsEl = document.getElementById('memory-stats');
    const editBtn = document.getElementById('btn-memory-edit');
    const createBtn = document.getElementById('btn-memory-create');
    const templateBtn = document.getElementById('btn-memory-template');

    let filePath = '';
    let title = '';
    let content = '';
    let fileExists = false;

    try {
      if (source === 'global') {
        filePath = this._getGlobalClaudeMd();
        title = t('memory.globalMemory');
        fileExists = this.api.fs.existsSync(filePath);
        if (fileExists) {
          content = await this.api.fs.promises.readFile(filePath, 'utf8');
        } else {
          content = '';
        }
      } else if (source === 'settings') {
        filePath = this._getClaudeSettingsJson();
        title = t('memory.claudeSettings');
        fileExists = this.api.fs.existsSync(filePath);
        if (fileExists) {
          const jsonContent = JSON.parse(await this.api.fs.promises.readFile(filePath, 'utf8'));
          content = JSON.stringify(jsonContent, null, 2);
        } else {
          content = '{}';
        }
      } else if (source === 'commands') {
        filePath = this._getClaudeSettingsJson();
        title = t('memory.allowedCommands');
        fileExists = this.api.fs.existsSync(filePath);
        if (fileExists) {
          const jsonContent = JSON.parse(await this.api.fs.promises.readFile(filePath, 'utf8'));
          content = JSON.stringify(jsonContent.allowedCommands || jsonContent.permissions || {}, null, 2);
        } else {
          content = '{}';
        }
      } else if (source === 'project' && projectIndex !== null) {
        const project = projectsState.get().projects[projectIndex];
        if (project) {
          filePath = this.api.path.join(project.path, 'CLAUDE.md');
          title = project.name;
          fileExists = this.api.fs.existsSync(filePath);
          if (fileExists) {
            content = await this.api.fs.promises.readFile(filePath, 'utf8');
          } else {
            content = '';
          }
        }
      }
    } catch (e) {
      content = t('memory.errorLoading', { message: e.message });
    }

    this._state.content = content;
    this._state.fileExists = fileExists;

    titleEl.textContent = title;
    pathEl.textContent = filePath.replace(this.api.os.homedir(), '~');

    // Show/hide buttons based on context
    const isMarkdownSource = source === 'global' || source === 'project';
    editBtn.style.display = (isMarkdownSource && fileExists) ? 'flex' : 'none';
    createBtn.style.display = (isMarkdownSource && !fileExists) ? 'flex' : 'none';
    templateBtn.style.display = (isMarkdownSource && this._state.isEditing) ? 'flex' : 'none';

    if (isMarkdownSource) {
      editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg> ${t('memory.edit')}`;
    }

    // Render stats
    if (fileExists && content) {
      const stats = calculateMemoryStats(content, source);
      statsEl.innerHTML = stats;
      statsEl.style.display = 'flex';
    } else {
      statsEl.style.display = 'none';
    }

    this.renderMemoryContent(content, source, fileExists);
    this.renderMemorySources(this._state.searchQuery);
  }

  // ── Content rendering ──

  renderMemoryContent(content, source, fileExists = true) {
    const contentEl = document.getElementById('memory-content');

    if (!fileExists) {
      const isProject = source === 'project';
      const projectName = isProject && this._state.currentProject !== null
        ? projectsState.get().projects[this._state.currentProject]?.name || 'Projet'
        : 'Global';

      contentEl.innerHTML = `
        <div class="memory-empty-state">
          <div class="memory-empty-icon">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
          </div>
          <h3>${t('memory.noClaudeMd')}</h3>
          <p>${t('memory.createHint', { name: escapeHtml(projectName) })}</p>
          <div class="memory-empty-templates">
            <p class="template-hint">${t('memory.chooseTemplate')}</p>
            <div class="template-grid">
              ${Object.entries(MEMORY_TEMPLATES).map(([key, tpl]) => `
                <button class="template-card" data-template="${key}">
                  <span class="template-icon">${tpl.icon}</span>
                  <span class="template-name">${tpl.name}</span>
                </button>
              `).join('')}
            </div>
          </div>
        </div>
      `;

      contentEl.querySelectorAll('.template-card').forEach(card => {
        card.onclick = async () => await this.createMemoryFromTemplate(card.dataset.template);
      });
      return;
    }

    if (source === 'settings' || source === 'commands') {
      contentEl.innerHTML = `<pre class="memory-json">${escapeHtml(content)}</pre>`;
      return;
    }

    // Parse markdown and render with search highlighting
    let html = parseMarkdownToHtml(content);

    // Highlight search terms if any
    if (this._state.searchQuery) {
      const regex = new RegExp(`(${escapeHtml(this._state.searchQuery)})`, 'gi');
      html = html.replace(regex, '<mark class="search-highlight">$1</mark>');
    }

    contentEl.innerHTML = `<div class="memory-markdown">${html}</div>`;
  }

  // ── Template creation ──

  async createMemoryFromTemplate(templateKey) {
    const template = MEMORY_TEMPLATES[templateKey];
    if (!template) return;

    let projectName = 'Mon Projet';
    if (this._state.currentSource === 'project' && this._state.currentProject !== null) {
      const project = projectsState.get().projects[this._state.currentProject];
      if (project) projectName = project.name;
    } else if (this._state.currentSource === 'global') {
      projectName = 'Instructions Globales Claude';
    }

    const content = template.content.replace(/\{PROJECT_NAME\}/g, projectName);

    let filePath = '';
    if (this._state.currentSource === 'global') {
      filePath = this._getGlobalClaudeMd();
      const claudeDir = this._getClaudeDir();
      if (!this.api.fs.existsSync(claudeDir)) {
        this.api.fs.mkdirSync(claudeDir, { recursive: true });
      }
    } else if (this._state.currentSource === 'project' && this._state.currentProject !== null) {
      const project = projectsState.get().projects[this._state.currentProject];
      if (project) filePath = this.api.path.join(project.path, 'CLAUDE.md');
    }

    if (filePath) {
      try {
        this.api.fs.writeFileSync(filePath, content, 'utf8');
        await this.loadMemoryContent(this._state.currentSource, this._state.currentProject);
      } catch (e) {
        if (this._showToast) this._showToast({ type: 'error', title: t('memory.errorCreating', { message: e.message }) });
      }
    }
  }

  // ── Event listeners ──

  setupMemoryEventListeners() {
    if (this._state.listenersAttached) return;
    this._state.listenersAttached = true;

    const searchInput = document.getElementById('memory-search-input');
    if (searchInput) {
      searchInput.oninput = (e) => {
        this._state.searchQuery = e.target.value;
        this.renderMemorySources(e.target.value);
        if (this._state.fileExists) {
          this.renderMemoryContent(this._state.content, this._state.currentSource, this._state.fileExists);
        }
      };
    }

    document.getElementById('memory-sources-list').onclick = async (e) => {
      const item = e.target.closest('.memory-source-item');
      if (!item) return;

      const source = item.dataset.source;
      const projectIndex = item.dataset.project !== undefined ? parseInt(item.dataset.project) : null;
      await this.loadMemoryContent(source, projectIndex);
    };

    document.getElementById('btn-memory-refresh').onclick = async () => {
      await this.loadMemoryContent(this._state.currentSource, this._state.currentProject);
    };

    document.getElementById('btn-memory-open').onclick = () => {
      let filePath = '';
      if (this._state.currentSource === 'global') {
        filePath = this._getGlobalClaudeMd();
      } else if (this._state.currentSource === 'settings' || this._state.currentSource === 'commands') {
        filePath = this._getClaudeSettingsJson();
      } else if (this._state.currentSource === 'project' && this._state.currentProject !== null) {
        const project = projectsState.get().projects[this._state.currentProject];
        if (project) filePath = this.api.path.join(project.path, 'CLAUDE.md');
      }

      if (filePath) {
        if (!this.api.fs.existsSync(filePath)) {
          filePath = this.api.path.dirname(filePath);
        }
        this.api.dialog.openInExplorer(filePath);
      }
    };

    document.getElementById('btn-memory-create').onclick = async () => {
      await this.createMemoryFromTemplate('minimal');
    };

    document.getElementById('btn-memory-template').onclick = () => {
      this.showTemplateModal();
    };

    document.getElementById('btn-memory-edit').onclick = () => {
      if (this._state.currentSource === 'settings' || this._state.currentSource === 'commands') {
        const filePath = this._getClaudeSettingsJson();
        if (this.api.fs.existsSync(filePath)) {
          this.api.dialog.openInExplorer(filePath);
        }
        return;
      }

      if (this._state.isEditing) {
        this.saveMemoryEdit();
      } else {
        this.enterMemoryEditMode();
      }
    };
  }

  // ── Template modal ──

  showTemplateModal() {
    const templatesHtml = Object.entries(MEMORY_TEMPLATES).map(([key, tpl]) => `
      <div class="template-option" data-template="${key}">
        <span class="template-icon">${tpl.icon}</span>
        <div class="template-info">
          <div class="template-name">${tpl.name}</div>
          <div class="template-preview">${tpl.content.split('\n').slice(0, 3).join(' ').substring(0, 80)}...</div>
        </div>
      </div>
    `).join('');

    this._showModal(t('memory.insertTemplate'), `
      <p style="margin-bottom: 16px; color: var(--text-secondary);">${t('memory.templateInsertHint')}</p>
      <div class="template-list">${templatesHtml}</div>
    `);

    document.querySelectorAll('.template-option').forEach(opt => {
      opt.onclick = () => {
        const template = MEMORY_TEMPLATES[opt.dataset.template];
        if (template) {
          const editor = document.getElementById('memory-editor');
          if (editor) {
            const pos = editor.selectionStart;
            const before = editor.value.substring(0, pos);
            const after = editor.value.substring(pos);
            editor.value = before + template.content + after;
            editor.focus();
          }
        }
        this._closeModal();
      };
    });
  }

  // ── Edit mode ──

  enterMemoryEditMode() {
    this._state.isEditing = true;
    const contentEl = document.getElementById('memory-content');
    const editBtn = document.getElementById('btn-memory-edit');

    contentEl.innerHTML = `
      <textarea class="memory-editor" id="memory-editor">${escapeHtml(this._state.content)}</textarea>
    `;

    editBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      ${t('memory.save')}
    `;

    const editor = document.getElementById('memory-editor');
    editor.addEventListener('input', () => {
      const isDirty = editor.value !== this._state.content;
      editBtn.classList.toggle('memory-dirty', isDirty);
    });
    editor.focus();
  }

  saveMemoryEdit() {
    const editor = document.getElementById('memory-editor');
    if (!editor) return;

    const newContent = editor.value;
    let filePath = '';

    if (this._state.currentSource === 'global') {
      filePath = this._getGlobalClaudeMd();
      const claudeDir = this._getClaudeDir();
      if (!this.api.fs.existsSync(claudeDir)) {
        this.api.fs.mkdirSync(claudeDir, { recursive: true });
      }
    } else if (this._state.currentSource === 'project' && this._state.currentProject !== null) {
      const project = projectsState.get().projects[this._state.currentProject];
      if (project) filePath = this.api.path.join(project.path, 'CLAUDE.md');
    }

    if (filePath) {
      try {
        this.api.fs.writeFileSync(filePath, newContent, 'utf8');
        this._state.content = newContent;
        // Push global CLAUDE.md changes to cloud sync
        if (this._state.currentSource === 'global' && window.electron_api?.sync?.pushEntity) {
          window.electron_api.sync.pushEntity('memory');
        }
      } catch (e) {
        if (this._showToast) this._showToast({ type: 'error', title: t('memory.errorSaving', { message: e.message }) });
        return;
      }
    }

    this._state.isEditing = false;
    const editBtn = document.getElementById('btn-memory-edit');
    editBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
      ${t('memory.edit')}
    `;

    this.renderMemoryContent(newContent, this._state.currentSource);
  }
}

// ── Lazy singleton + legacy exports ──

let _instance = null;

function _ensureInstance(context) {
  if (!_instance) {
    const { getApiProvider, getContainer } = require('../../core');
    _instance = new MemoryEditor(null, {
      api: getApiProvider(),
      container: getContainer(),
      showModal: context.showModal,
      closeModal: context.closeModal,
      showToast: context.showToast
    });
  }
  return _instance;
}

module.exports = {
  MemoryEditor,
  init: (context) => {
    _ensureInstance(context);
    // Update modal/toast references in case they changed
    _instance._showModal = context.showModal;
    _instance._closeModal = context.closeModal;
    _instance._showToast = context.showToast;
  },
  loadMemory: () => {
    if (_instance) return _instance.loadMemory();
  }
};
