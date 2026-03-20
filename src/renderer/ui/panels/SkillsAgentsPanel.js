/**
 * SkillsAgentsPanel
 * Skills & Agents browsing, rendering, and management
 */

const { BasePanel } = require('../../core/BasePanel');
const { escapeHtml } = require('../../utils');
const { t } = require('../../i18n');
const { showConfirm } = require('../components/Modal');

class SkillsAgentsPanel extends BasePanel {
  constructor(el, options = {}) {
    super(el, options);
    this._state = {
      skills: [],
      agents: [],
      activeSubTab: 'local',
      initialized: false
    };
    this._marketplaceSearchTimeout = null;
    this._skillsDir = options.skillsDir;
    this._agentsDir = options.agentsDir;
    this._getSetting = options.getSetting;
    this._loadMarketplaceContent = options.loadMarketplaceContent;
    this._searchMarketplace = options.searchMarketplace;
    this._loadMarketplaceFeatured = options.loadMarketplaceFeatured;
    this._setMarketplaceSearchQuery = options.setMarketplaceSearchQuery;
  }

  async loadSkills() {
    if (!this._state.initialized) {
      this._state.initialized = true;
      this._setupSkillsSubTabs();
    }

    if (this._state.activeSubTab === 'local') {
      await this._loadLocalSkills();
    } else {
      await this._loadMarketplaceContent();
    }
  }

  async loadAgents() {
    this._state.agents = [];
    try {
      await this.api.fs.promises.access(this._agentsDir);
      const items = await this.api.fs.promises.readdir(this._agentsDir);
      for (const item of items) {
        const itemPath = this.api.path.join(this._agentsDir, item);
        try {
          const stat = await this.api.fs.promises.stat(itemPath);

          if (stat.isFile() && item.endsWith('.md')) {
            const content = await this.api.fs.promises.readFile(itemPath, 'utf8');
            const parsed = _parseAgentMd(content);
            const id = item.replace(/\.md$/, '');
            this._state.agents.push({
              id, name: parsed.name || id,
              description: parsed.description || t('common.noDescription'),
              tools: parsed.tools || [], sections: parsed.sections || [],
              path: itemPath, filePath: itemPath
            });
          } else if (stat.isDirectory()) {
            const agentFile = this.api.path.join(itemPath, 'AGENT.md');
            try {
              const content = await this.api.fs.promises.readFile(agentFile, 'utf8');
              const parsed = _parseAgentMd(content);
              this._state.agents.push({
                id: item, name: parsed.name || item,
                description: parsed.description || t('common.noDescription'),
                tools: parsed.tools || [], sections: parsed.sections || [],
                path: itemPath, filePath: agentFile
              });
            } catch { /* AGENT.md not found, skip */ }
          }
        } catch { /* can't stat, skip */ }
      }
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('Error loading agents:', e);
    }
    this._renderAgents();
  }

  // ── Private ──

  async _loadLocalSkills() {
    this._state.skills = [];
    try {
      await this.api.fs.promises.access(this._skillsDir);
      const items = await this.api.fs.promises.readdir(this._skillsDir);
      for (const item of items) {
        const itemPath = this.api.path.join(this._skillsDir, item);
        try {
          const stat = await this.api.fs.promises.stat(itemPath);
          if (stat.isDirectory()) {
            const skillFile = this.api.path.join(itemPath, 'SKILL.md');
            try {
              const content = await this.api.fs.promises.readFile(skillFile, 'utf8');
              const parsed = _parseSkillMd(content);
              this._state.skills.push({
                id: item, name: parsed.name || item,
                description: parsed.description || t('common.noDescription'),
                sections: parsed.sections || [],
                path: itemPath, filePath: skillFile
              });
            } catch { /* SKILL.md not found, skip */ }
          }
        } catch { /* can't stat, skip */ }
      }
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('Error loading skills:', e);
    }
    this._renderSkills();
  }

  _setupSkillsSubTabs() {
    document.querySelectorAll('.skills-sub-tab').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.skills-sub-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._state.activeSubTab = btn.dataset.subtab;

        const newSkillBtn = document.getElementById('btn-new-skill');
        const searchContainer = document.getElementById('skills-marketplace-search');

        if (btn.dataset.subtab === 'local') {
          newSkillBtn.style.display = '';
          searchContainer.style.display = 'none';
        } else {
          newSkillBtn.style.display = 'none';
          searchContainer.style.display = 'flex';
        }

        this.loadSkills();
      };
    });

    const input = document.getElementById('marketplace-search-input');
    if (input) {
      input.addEventListener('input', () => {
        clearTimeout(this._marketplaceSearchTimeout);
        const query = input.value.trim();
        this._setMarketplaceSearchQuery(query);

        this._marketplaceSearchTimeout = setTimeout(() => {
          if (query.length >= 2) {
            this._searchMarketplace(query);
          } else if (query.length === 0) {
            this._loadMarketplaceFeatured();
          }
        }, 300);
      });
    }
  }

  _renderSkillCard(s, isPlugin) {
    const desc = (s.description && s.description !== '---' && s.description !== t('common.noDescription')) ? escapeHtml(s.description) : '';
    const initial = escapeHtml((s.name || '?').charAt(0).toUpperCase());
    const cardClass = isPlugin ? 'list-card plugin-card' : 'list-card';
    const badge = isPlugin
      ? `<div class="list-card-badge plugin">Plugin</div>`
      : `<div class="list-card-badge">${t('skillsAgents.skill')}</div>`;
    const filePath = s.filePath ? s.filePath.replace(/"/g, '&quot;') : '';

    return `
    <div class="${cardClass}" data-path="${s.path.replace(/"/g, '&quot;')}" data-file-path="${filePath}" data-is-plugin="${isPlugin}">
      <div class="card-initial">${initial}</div>
      <div class="list-card-header">
        <div class="list-card-title">${escapeHtml(s.name)}</div>
        ${badge}
      </div>
      ${desc ? `<div class="list-card-desc">${desc}</div>` : ''}
      <div class="list-card-footer">
        ${!isPlugin && filePath ? `<button class="btn-sm btn-accent btn-edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          ${t('common.edit')}
        </button>` : ''}
        <button class="btn-sm btn-secondary btn-open">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          ${t('marketplace.openFolder')}
        </button>
        ${!isPlugin ? `<button class="btn-sm btn-delete btn-del" title="${t('common.delete')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>` : ''}
      </div>
    </div>`;
  }

  _renderSkills() {
    const list = document.getElementById('skills-list');
    if (this._state.skills.length === 0) {
      list.innerHTML = `<div class="empty-list"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg><h3>${t('skillsAgents.noSkills')}</h3><p>${t('skillsAgents.createFirstSkill')}</p></div>`;
      return;
    }

    const localSkills = this._state.skills.filter(s => !s.isPlugin);
    const pluginSkills = this._state.skills.filter(s => s.isPlugin);

    const pluginsBySource = {};
    pluginSkills.forEach(s => {
      if (!pluginsBySource[s.sourceLabel]) pluginsBySource[s.sourceLabel] = [];
      pluginsBySource[s.sourceLabel].push(s);
    });

    let html = '';

    if (localSkills.length > 0) {
      html += `<div class="list-section">
        <div class="list-section-title">${t('skillsAgents.local')} <span class="list-section-count">${localSkills.length}</span></div>
        <div class="list-section-grid">`;
      html += localSkills.map(s => this._renderSkillCard(s, false)).join('');
      html += `</div></div>`;
    }

    Object.entries(pluginsBySource).forEach(([source, skills]) => {
      html += `<div class="list-section">
        <div class="list-section-title"><span class="plugin-badge">Plugin</span> ${escapeHtml(source)} <span class="list-section-count">${skills.length}</span></div>
        <div class="list-section-grid">`;
      html += skills.map(s => this._renderSkillCard(s, true)).join('');
      html += `</div></div>`;
    });

    list.innerHTML = html;

    list.querySelectorAll('.list-card').forEach(card => {
      card.querySelector('.btn-open').onclick = () => this.api.dialog.openInExplorer(card.dataset.path);
      const editBtn = card.querySelector('.btn-edit');
      if (editBtn) {
        editBtn.onclick = () => {
          const fp = card.dataset.filePath;
          if (fp) this.api.dialog.openInEditor({ editor: this._getSetting('editor') || 'code', path: fp });
        };
      }
      const delBtn = card.querySelector('.btn-del');
      if (delBtn) {
        delBtn.onclick = async () => {
          const ok = await showConfirm({ title: t('skillsAgents.deleteSkill') || 'Delete skill', message: t('skillsAgents.confirmDeleteSkill'), confirmLabel: t('common.delete'), danger: true });
          if (ok) { await this.api.fs.promises.rm(card.dataset.path, { recursive: true, force: true }); this.loadSkills(); }
        };
      }
    });
  }

  _renderAgents() {
    const list = document.getElementById('agents-list');
    if (this._state.agents.length === 0) {
      list.innerHTML = `<div class="empty-list"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM8 17.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM9.5 8c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5S9.5 9.38 9.5 8zm6.5 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg><h3>${t('skillsAgents.noAgents')}</h3><p>${t('skillsAgents.createFirstAgent')}</p></div>`;
      return;
    }

    let html = `<div class="list-section">
      <div class="list-section-title">${t('skillsAgents.agents')} <span class="list-section-count">${this._state.agents.length}</span></div>
      <div class="list-section-grid">`;
    html += this._state.agents.map(a => {
      const desc = (a.description && a.description !== '---' && a.description !== t('common.noDescription')) ? escapeHtml(a.description) : '';
      const initial = escapeHtml((a.name || '?').charAt(0).toUpperCase());
      const filePath = a.filePath ? a.filePath.replace(/"/g, '&quot;') : '';
      const toolChips = (a.tools && a.tools.length > 0)
        ? `<div class="skill-sections agent-tools">${a.tools.slice(0, 5).map(tool => `<span class="skill-section-chip agent-tool-chip">${escapeHtml(tool)}</span>`).join('')}</div>`
        : '';
      return `
      <div class="list-card agent-card" data-path="${a.path.replace(/"/g, '&quot;')}" data-file-path="${filePath}">
        <div class="card-initial">${initial}</div>
        <div class="list-card-header">
          <div class="list-card-title">${escapeHtml(a.name)}</div>
          <div class="list-card-badge agent">${t('skillsAgents.agent')}</div>
        </div>
        ${desc ? `<div class="list-card-desc">${desc}</div>` : ''}
        ${toolChips}
        <div class="list-card-footer">
          ${filePath ? `<button class="btn-sm btn-accent btn-edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            ${t('common.edit')}
          </button>` : ''}
          <button class="btn-sm btn-secondary btn-open">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
            ${t('marketplace.openFolder')}
          </button>
          <button class="btn-sm btn-delete btn-del" title="${t('common.delete')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </div>`;
    }).join('');
    html += `</div></div>`;

    list.innerHTML = html;

    list.querySelectorAll('.list-card').forEach(card => {
      card.querySelector('.btn-open').onclick = () => this.api.dialog.openInExplorer(card.dataset.path);
      const editBtn = card.querySelector('.btn-edit');
      if (editBtn) {
        editBtn.onclick = () => {
          const fp = card.dataset.filePath;
          if (fp) this.api.dialog.openInEditor({ editor: this._getSetting('editor') || 'code', path: fp });
        };
      }
      card.querySelector('.btn-del').onclick = async () => {
        const ok = await showConfirm({ title: t('skillsAgents.deleteAgent') || 'Delete agent', message: t('skillsAgents.confirmDeleteAgent'), confirmLabel: t('common.delete'), danger: true });
        if (ok) { await this.api.fs.promises.rm(card.dataset.path, { recursive: true, force: true }); this.loadAgents(); }
      };
    });
  }
}

// ── Static parsing helpers ──

function _parseSkillMd(content) {
  let name = null;
  let description = null;

  const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (yamlMatch) {
    const yaml = yamlMatch[1];
    const descMatch = yaml.match(/description\s*:\s*["']?(.+?)["']?\s*$/m);
    if (descMatch) description = descMatch[1].trim();
    const nameMatch = yaml.match(/name\s*:\s*["']?(.+?)["']?\s*$/m);
    if (nameMatch) name = nameMatch[1].trim();
  }

  const titleMatch = content.match(/^#\s+(.+)/m);
  if (titleMatch && !name) name = titleMatch[1].trim();

  if (!description) {
    let body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
    const afterTitle = body.replace(/^#\s+.+\n/, '');
    const untilNextSection = afterTitle.split(/\n##\s/)[0];
    const paragraphs = untilNextSection.split(/\n\n+/);
    for (const p of paragraphs) {
      const cleaned = p.trim();
      if (cleaned && !cleaned.startsWith('#') && !cleaned.startsWith('```') && cleaned.length > 10) {
        description = cleaned.split('\n')[0].trim();
        break;
      }
    }
  }

  const sections = [];
  const sectionMatches = content.matchAll(/^#{2,3}\s+(.+)/mg);
  for (const m of sectionMatches) {
    const title = m[1].trim();
    if (title && sections.length < 6) sections.push(title);
  }

  return { name, description, sections };
}

function _parseAgentMd(content) {
  let name = null;
  let description = null;
  let tools = [];

  const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (yamlMatch) {
    const yaml = yamlMatch[1];
    const descMatch = yaml.match(/description\s*:\s*["']?(.+?)["']?\s*$/m);
    if (descMatch) description = descMatch[1].trim();
    const nameMatch = yaml.match(/name\s*:\s*["']?(.+?)["']?\s*$/m);
    if (nameMatch) name = nameMatch[1].trim();
    const toolsMatch = yaml.match(/tools\s*:\s*\[([^\]]+)\]/);
    if (toolsMatch) tools = toolsMatch[1].split(',').map(t => t.trim().replace(/["']/g, ''));
  }

  const titleMatch = content.match(/^#\s+(.+)/m);
  if (titleMatch && !name) name = titleMatch[1].trim();

  if (!description) {
    const descInBody = content.match(/description\s*:\s*["']([^"']+)["']/i) ||
                       content.match(/description\s*:\s*(.+)$/im);
    if (descInBody) description = descInBody[1].trim().replace(/^["']|["']$/g, '');
  }

  if (tools.length === 0) {
    const toolsInBody = content.match(/tools\s*:\s*\[([^\]]+)\]/i);
    if (toolsInBody) tools = toolsInBody[1].split(',').map(t => t.trim().replace(/["']/g, ''));
  }

  if (!description) {
    let body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
    const afterTitle = body.replace(/^#\s+.+\n/, '');
    const untilNextSection = afterTitle.split(/\n##\s/)[0];
    const paragraphs = untilNextSection.split(/\n\n+/);
    for (const p of paragraphs) {
      const cleaned = p.trim();
      if (cleaned && !cleaned.startsWith('#') && !cleaned.startsWith('```') && !cleaned.match(/^\w+\s*:/) && cleaned.length > 10) {
        description = cleaned.split('\n')[0].trim();
        break;
      }
    }
  }

  const sections = [];
  const sectionMatches = content.matchAll(/^#{2,3}\s+(.+)/mg);
  for (const m of sectionMatches) {
    const title = m[1].trim();
    if (title && sections.length < 6) sections.push(title);
  }

  return { name, description, tools, sections };
}

// ── Lazy singleton + legacy exports ──

let _instance = null;

function init(context) {
  const { getApiProvider, getContainer } = require('../../core');
  _instance = new SkillsAgentsPanel(null, {
    api: getApiProvider(),
    container: getContainer(),
    skillsDir: context.skillsDir,
    agentsDir: context.agentsDir,
    getSetting: context.getSetting,
    loadMarketplaceContent: context.loadMarketplaceContent,
    searchMarketplace: context.searchMarketplace,
    loadMarketplaceFeatured: context.loadMarketplaceFeatured,
    setMarketplaceSearchQuery: context.setMarketplaceSearchQuery
  });
}

module.exports = {
  SkillsAgentsPanel,
  init,
  loadSkills: (...a) => _instance.loadSkills(...a),
  loadAgents: (...a) => _instance.loadAgents(...a)
};
