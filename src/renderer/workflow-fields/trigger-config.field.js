/**
 * trigger-config field renderer
 * Renders the full trigger configuration UI:
 * - triggerType select (manual / cron / hook / on_workflow / webhook)
 * - Conditional cron expression input
 * - Conditional hookType select
 * - Conditional workflow source select
 * - Conditional webhook URL display
 */
const { escapeHtml, escapeAttr } = require('./_registry');

const HOOK_TYPES = [
  { value: 'PreToolUse',       label: 'Pre Tool Use — Avant chaque appel outil' },
  { value: 'PostToolUse',      label: 'Post Tool Use — Après chaque appel outil' },
  { value: 'UserPromptSubmit', label: 'User Prompt — À chaque message' },
  { value: 'Notification',     label: 'Notification — Sur notification Claude' },
  { value: 'Stop',             label: 'Stop — Quand Claude termine' },
];

function _getCloudSettings() {
  try {
    const fs = window.electron_nodeModules?.fs;
    const os = window.electron_nodeModules?.os;
    const path = window.electron_nodeModules?.path;
    if (!fs || !os || !path) return {};
    const settingsPath = path.join(os.homedir(), '.claude-terminal', 'settings.json');
    if (!fs.existsSync(settingsPath)) return {};
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch { return {}; }
}

function _buildWebhookUrl(workflowId) {
  const settings = _getCloudSettings();
  const cloudUrl = (settings.cloudServerUrl || '').replace(/\/$/, '');
  if (!cloudUrl || !workflowId) return '';
  return `${cloudUrl}/api/webhook/${workflowId}`;
}

function _renderWebhookSection(workflowId, esc) {
  const settings = _getCloudSettings();
  const cloudUrl = (settings.cloudServerUrl || '').replace(/\/$/, '');
  const webhookUrl = _buildWebhookUrl(workflowId);
  let noCloudHtml = '';
  if (!cloudUrl) {
    noCloudHtml = `<span class="wf-field-hint wf-webhook-no-cloud">Relais cloud non configuré — connectez-vous dans l'onglet Cloud</span>`;
  } else if (!workflowId) {
    noCloudHtml = `<span class="wf-field-hint wf-webhook-no-cloud">Sauvegardez le workflow pour obtenir l'URL</span>`;
  }
  return `<div class="wf-step-edit-field">
  <label class="wf-step-edit-label">Webhook URL</label>
  <span class="wf-field-hint">POST avec Authorization: Bearer &lt;votre-api-key&gt;</span>
  ${webhookUrl
    ? `<div class="wf-webhook-url-row">
        <input class="wf-step-edit-input wf-field-mono wf-webhook-url-input" readonly
          value="${esc(webhookUrl)}" />
        <button class="wf-webhook-copy-btn" type="button" data-url="${esc(webhookUrl)}">Copier</button>
      </div>
      <span class="wf-field-hint" style="margin-top:6px">Le body de la requête est disponible via <code>$trigger.payload</code></span>`
    : noCloudHtml
  }
</div>`;
}

function _bindWebhookCopyBtn(root) {
  root.querySelectorAll('.wf-webhook-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      if (url && navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => {
          btn.textContent = 'Copié !';
          setTimeout(() => { btn.textContent = 'Copier'; }, 2000);
        });
      }
    });
  });
}

module.exports = {
  type: 'trigger-config',

  render(field, value, node) {
    const props = node.properties || {};
    const triggerType = props.triggerType || 'manual';
    const workflows =
      (typeof window !== 'undefined' && window._workflowsListCache) || [];

    const cronSection = triggerType === 'cron' ? `
<div class="wf-step-edit-field">
  <label class="wf-step-edit-label">Expression cron</label>
  <span class="wf-field-hint">min heure jour mois jour-semaine</span>
  <input class="wf-step-edit-input wf-node-prop wf-field-mono" data-key="triggerValue"
    value="${escapeAttr(props.triggerValue || '')}"
    placeholder="*/5 * * * *" />
</div>` : '';

    const hookSection = triggerType === 'hook' ? `
<div class="wf-step-edit-field">
  <label class="wf-step-edit-label">Type de hook</label>
  <span class="wf-field-hint">Événement Claude qui déclenche le workflow</span>
  <select class="wf-step-edit-input wf-node-prop" data-key="hookType">
    ${HOOK_TYPES.map(h =>
      `<option value="${escapeAttr(h.value)}"${props.hookType === h.value ? ' selected' : ''}>${escapeHtml(h.label)}</option>`
    ).join('')}
  </select>
</div>` : '';

    const onWorkflowSection = triggerType === 'on_workflow' ? `
<div class="wf-step-edit-field">
  <label class="wf-step-edit-label">Workflow source</label>
  <span class="wf-field-hint">Se déclenche après la fin de ce workflow</span>
  <select class="wf-step-edit-input wf-node-prop" data-key="triggerValue">
    <option value=""${!props.triggerValue ? ' selected' : ''}>Sélectionner un workflow…</option>
    ${workflows
      .filter(w => w.id !== (node.properties._workflowId || ''))
      .map(w => `<option value="${escapeAttr(w.id)}"${props.triggerValue === w.id ? ' selected' : ''}>${escapeHtml(w.name)}</option>`)
      .join('')}
  </select>
</div>` : '';

    const webhookSection = triggerType === 'webhook'
      ? _renderWebhookSection(node.properties._workflowId || '', escapeAttr)
      : '';

    return `<div class="wf-field-group" data-key="triggerType">
<div class="wf-step-edit-field">
  <label class="wf-step-edit-label">Déclencheur</label>
  <span class="wf-field-hint">Comment ce workflow démarre</span>
  <select class="wf-step-edit-input wf-trigger-type-select wf-node-prop" data-key="triggerType">
    <option value="manual"${triggerType === 'manual' ? ' selected' : ''}>Manuel (bouton play)</option>
    <option value="cron"${triggerType === 'cron' ? ' selected' : ''}>Planifié (cron)</option>
    <option value="hook"${triggerType === 'hook' ? ' selected' : ''}>Hook Claude</option>
    <option value="on_workflow"${triggerType === 'on_workflow' ? ' selected' : ''}>Après un workflow</option>
    <option value="webhook"${triggerType === 'webhook' ? ' selected' : ''}>Webhook (HTTP POST)</option>
  </select>
</div>
<div class="wf-trigger-conditional">
  ${cronSection}${hookSection}${onWorkflowSection}${webhookSection}
</div>
</div>`;
  },

  bind(container, field, node, onChange) {
    const typeSelect = container.querySelector('.wf-trigger-type-select');
    if (!typeSelect) return;

    // Bind copy button for initial render (if webhook is already selected)
    _bindWebhookCopyBtn(container);

    typeSelect.addEventListener('change', () => {
      node.properties.triggerType = typeSelect.value;
      onChange(typeSelect.value);

      // Re-render conditional section
      const condDiv = container.querySelector('.wf-trigger-conditional');
      if (!condDiv) return;

      const t = typeSelect.value;
      const props = node.properties || {};
      const workflows =
        (typeof window !== 'undefined' && window._workflowsListCache) || [];

      function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

      let html = '';
      if (t === 'cron') {
        html = `<div class="wf-step-edit-field">
  <label class="wf-step-edit-label">Expression cron</label>
  <span class="wf-field-hint">min heure jour mois jour-semaine</span>
  <input class="wf-step-edit-input wf-node-prop wf-field-mono" data-key="triggerValue"
    value="${esc(props.triggerValue || '')}" placeholder="*/5 * * * *" />
</div>`;
      } else if (t === 'hook') {
        const HOOK_TYPES_INNER = [
          { value: 'PreToolUse',       label: 'Pre Tool Use — Avant chaque appel outil' },
          { value: 'PostToolUse',      label: 'Post Tool Use — Après chaque appel outil' },
          { value: 'UserPromptSubmit', label: 'User Prompt — À chaque message' },
          { value: 'Notification',     label: 'Notification — Sur notification Claude' },
          { value: 'Stop',             label: 'Stop — Quand Claude termine' },
        ];
        html = `<div class="wf-step-edit-field">
  <label class="wf-step-edit-label">Type de hook</label>
  <span class="wf-field-hint">Événement Claude qui déclenche le workflow</span>
  <select class="wf-step-edit-input wf-node-prop" data-key="hookType">
    ${HOOK_TYPES_INNER.map(h =>
      `<option value="${esc(h.value)}"${props.hookType === h.value ? ' selected' : ''}>${esc(h.label)}</option>`
    ).join('')}
  </select>
</div>`;
      } else if (t === 'on_workflow') {
        html = `<div class="wf-step-edit-field">
  <label class="wf-step-edit-label">Workflow source</label>
  <span class="wf-field-hint">Se déclenche après la fin de ce workflow</span>
  <select class="wf-step-edit-input wf-node-prop" data-key="triggerValue">
    <option value="">Sélectionner un workflow…</option>
    ${workflows.map(w => `<option value="${esc(w.id)}"${props.triggerValue === w.id ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}
  </select>
</div>`;
      } else if (t === 'webhook') {
        html = _renderWebhookSection(node.properties._workflowId || '', esc);
      }

      condDiv.innerHTML = html;

      // Re-bind the new inputs
      condDiv.querySelectorAll('.wf-node-prop').forEach(el => {
        const key = el.dataset.key;
        if (!key) return;
        el.addEventListener('change', () => { node.properties[key] = el.value; });
        el.addEventListener('input', () => { node.properties[key] = el.value; });
      });

      // Bind copy button for webhook
      _bindWebhookCopyBtn(condDiv);
    });
  },
};
