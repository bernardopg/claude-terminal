/**
 * Web App Wizard hooks
 * Custom fields for project creation, scaffold templates, and framework detection
 */

const SCAFFOLD_TEMPLATES = [
  { id: 'react', name: 'React', color: '#61dafb',
    icon: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 10.11c1.03 0 1.87.84 1.87 1.89 0 1-.84 1.85-1.87 1.85S10.13 13 10.13 12c0-1.05.84-1.89 1.87-1.89M7.37 20c.63.38 2.01-.2 3.6-1.7-.52-.59-1.03-1.23-1.51-1.9a22.7 22.7 0 0 1-2.4-.36c-.51 2.14-.32 3.61.31 3.96m.71-5.74l-.29-.51c-.11.29-.22.58-.29.86.27.06.57.11.88.16l-.3-.51m6.54-.76l.81-1.5-.81-1.5c-.3-.53-.62-1-.91-1.47C13.17 9 12.6 9 12 9c-.6 0-1.17 0-1.71.03-.29.47-.61.94-.91 1.47L8.57 12l.81 1.5c.3.53.62 1 .91 1.47.54.03 1.11.03 1.71.03.6 0 1.17 0 1.71-.03.29-.47.61-.94.91-1.47M12 6.78c-.19.22-.39.45-.59.72h1.18c-.2-.27-.4-.5-.59-.72m0 10.44c.19-.22.39-.45.59-.72h-1.18c.2.27.4.5.59.72M16.62 4c-.62-.38-2 .2-3.59 1.7.52.59 1.03 1.23 1.51 1.9.82.08 1.63.2 2.4.36.51-2.14.32-3.61-.32-3.96m-.7 5.74l.29.51c.11-.29.22-.58.29-.86-.27-.06-.57-.11-.88-.16l.3.51m1.45-7.05c1.47.84 1.63 3.05 1.01 5.63 2.54.75 4.37 1.99 4.37 3.68 0 1.69-1.83 2.93-4.37 3.68.62 2.58.46 4.79-1.01 5.63-1.46.84-3.45-.12-5.37-1.95-1.92 1.83-3.91 2.79-5.38 1.95-1.46-.84-1.62-3.05-1-5.63-2.54-.75-4.37-1.99-4.37-3.68 0-1.69 1.83-2.93 4.37-3.68-.62-2.58-.46-4.79 1-5.63 1.47-.84 3.46.12 5.38 1.95 1.92-1.83 3.91-2.79 5.37-1.95M17.08 12c.34.75.64 1.5.89 2.26 2.1-.63 3.28-1.53 3.28-2.26 0-.73-1.18-1.63-3.28-2.26-.25.76-.55 1.51-.89 2.26M6.92 12c-.34-.75-.64-1.5-.89-2.26-2.1.63-3.28 1.53-3.28 2.26 0 .73 1.18 1.63 3.28 2.26.25-.76.55-1.51.89-2.26m9 2.26l-.3.51c.31-.05.61-.1.88-.16-.07-.28-.18-.57-.29-.86l-.29.51m-2.89 4.04c1.59 1.5 2.97 2.08 3.59 1.7.64-.35.83-1.82.32-3.96-.77.16-1.58.28-2.4.36-.48.67-.99 1.31-1.51 1.9M8.08 9.74l.3-.51c-.31.05-.61.1-.88.16.07.28.18.57.29.86l.29-.51m2.89-4.04C9.38 4.2 8 3.62 7.37 4c-.63.35-.82 1.82-.31 3.96a22.7 22.7 0 0 0 2.4-.36c.48-.67.99-1.31 1.51-1.9z"/></svg>',
    cmd: (name) => `npm create vite@latest "${name}" -- --template react-ts` },
  { id: 'nextjs', name: 'Next.js', color: '#e0e0e0',
    icon: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1.5 15V9l7 8h-2.5L10.5 12v5h-2z"/></svg>',
    cmd: (name) => `npx create-next-app@latest "${name}" --ts --eslint --app --src-dir --no-tailwind --import-alias "@/*" --yes` },
  { id: 'vue', name: 'Vue', color: '#42b883',
    icon: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M2 3h3.5L12 14.5 18.5 3H22L12 21 2 3zm7 0h2.5L12 4.5 13.5 3H16l-4 7-4-7z"/></svg>',
    cmd: (name) => `npm create vite@latest "${name}" -- --template vue-ts` },
  { id: 'svelte', name: 'SvelteKit', color: '#ff3e00',
    icon: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M20.68 3.17a7.26 7.26 0 0 0-9.93-1.06L6.28 5.7a6.36 6.36 0 0 0-2.83 4.24 6.62 6.62 0 0 0 .67 4.29 6.28 6.28 0 0 0-.95 2.37 6.68 6.68 0 0 0 1.15 5.08 7.26 7.26 0 0 0 9.93 1.06l4.47-3.59a6.36 6.36 0 0 0 2.83-4.24 6.62 6.62 0 0 0-.67-4.29 6.28 6.28 0 0 0 .95-2.37 6.68 6.68 0 0 0-1.15-5.08zM10.39 20.48a4.35 4.35 0 0 1-4.68-1.73 4 4 0 0 1-.69-3.04 3.77 3.77 0 0 1 .19-.7l.12-.31.3.22a7.2 7.2 0 0 0 2.2 1.13l.2.06-.02.2a1.2 1.2 0 0 0 .22.79 1.3 1.3 0 0 0 1.41.52 1.23 1.23 0 0 0 .35-.15l4.47-3.59a1.15 1.15 0 0 0 .43-.76 1.2 1.2 0 0 0-.21-.91 1.3 1.3 0 0 0-1.41-.52 1.23 1.23 0 0 0-.35.15l-1.71 1.37a4.23 4.23 0 0 1-1.16.51 4.35 4.35 0 0 1-4.68-1.73 4 4 0 0 1-.69-3.04 3.82 3.82 0 0 1 1.44-2.53l4.47-3.59a4.23 4.23 0 0 1 1.16-.51 4.35 4.35 0 0 1 4.68 1.73 4 4 0 0 1 .69 3.04 3.77 3.77 0 0 1-.19.7l-.12.31-.3-.22a7.2 7.2 0 0 0-2.2-1.13l-.2-.06.02-.2a1.2 1.2 0 0 0-.22-.79 1.3 1.3 0 0 0-1.41-.52 1.23 1.23 0 0 0-.35.15L9.3 10.73a1.15 1.15 0 0 0-.43.76 1.2 1.2 0 0 0 .21.91 1.3 1.3 0 0 0 1.41.52 1.23 1.23 0 0 0 .35-.15l1.71-1.37a4.23 4.23 0 0 1 1.16-.51 4.35 4.35 0 0 1 4.68 1.73 4 4 0 0 1 .69 3.04 3.82 3.82 0 0 1-1.44 2.53l-4.47 3.59a4.23 4.23 0 0 1-1.16.51z"/></svg>',
    cmd: (name) => `npm create vite@latest "${name}" -- --template svelte-ts` },
  { id: 'nuxt', name: 'Nuxt', color: '#00dc82',
    icon: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M13.46 19.5h6.04c.38 0 .75-.1 1.08-.3.33-.19.6-.47.78-.8.19-.34.28-.72.28-1.1 0-.39-.1-.77-.28-1.1L16 7.5a2.14 2.14 0 0 0-.78-.8 2.12 2.12 0 0 0-2.16 0c-.33.2-.6.47-.78.8l-1.14 1.98L9 6.2a2.14 2.14 0 0 0-.78-.8 2.12 2.12 0 0 0-2.16 0c-.33.2-.6.47-.78.8L.64 16.2c-.19.33-.28.71-.28 1.1 0 .38.1.76.28 1.1.18.33.45.61.78.8.33.2.7.3 1.08.3h3.78c1.68 0 2.93-.74 3.77-2.16l2.81-4.9 1.14-1.98L16 14.5h-4l1.14-1.98L13.46 19.5zM6.14 17.5H2.5L7.14 9.5l2.32 4-1.62 2.82c-.53.88-1.12 1.18-1.7 1.18z"/></svg>',
    cmd: (name) => `npx nuxi@latest init "${name}" --no-install` },
  { id: 'astro', name: 'Astro', color: '#bc52ee',
    icon: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M16.074 16.86c-.72.616-2.157 1.035-3.812 1.035-2.032 0-3.735-.632-4.187-1.483-.161.488-.198 1.046-.198 1.402 0 0-.106 1.75 1.111 2.968 0-.632.513-1.145 1.145-1.145 1.083 0 1.082.945 1.081 1.712v.069c0 1.164.711 2.161 1.723 2.581a2.347 2.347 0 0 1-.125-.764c0-1.198.759-1.644 1.637-2.159.725-.425 1.533-.9 2.06-1.857a4.1 4.1 0 0 0 .435-1.834 4.14 4.14 0 0 0-.87-2.525zM15.551 2.2c.259.464.363 1.004.363 1.547 0 1.097-.546 2.12-1.463 3.247l-2.18 2.678-.02.024c-.652.8-1.204 1.478-1.204 2.494a1.585 1.585 0 0 0 1.582 1.589h.006a1.585 1.585 0 0 0 1.588-1.583c0-.543-.142-1.013-.523-1.558l6.632-1.96S22.136 5.265 17.1 2.2h-1.549z"/></svg>',
    cmd: (name) => `npm create astro@latest "${name}" -- --template minimal --skip-houston --no-install --no-git` },
];

const FRAMEWORK_SIGNATURES = [
  { deps: ['next'],           name: 'Next.js',    icon: '▲' },
  { deps: ['nuxt'],           name: 'Nuxt',       icon: '💚' },
  { deps: ['@sveltejs/kit'],  name: 'SvelteKit',  icon: '🔶' },
  { deps: ['astro'],          name: 'Astro',       icon: '🚀' },
  { deps: ['@angular/core'],  name: 'Angular',     icon: '🔴' },
  { deps: ['svelte'],         name: 'Svelte',      icon: '🔶' },
  { deps: ['vue'],            name: 'Vue',         icon: '🟢' },
  { deps: ['react'],          name: 'React',       icon: '⚛️' },
  { deps: ['solid-js'],       name: 'Solid',       icon: '💠' },
  { deps: ['preact'],         name: 'Preact',      icon: '⚛️' },
];

function detectFramework(packageJsonContent) {
  const allDeps = { ...packageJsonContent.dependencies, ...packageJsonContent.devDependencies };
  for (const sig of FRAMEWORK_SIGNATURES) {
    if (sig.deps.some(d => d in allDeps)) {
      const version = allDeps[sig.deps[0]] || '';
      return { name: sig.name, icon: sig.icon, version: version.replace(/[\^~>=<]/g, '') };
    }
  }
  return null;
}

function getTemplateGridHtml(t) {
  return `
    <div class="scaffold-templates" style="display:none;">
      <label class="wizard-label">${t('newProject.selectTemplate')}</label>
      <div class="wizard-type-grid scaffold-grid">
        ${SCAFFOLD_TEMPLATES.map((tpl, i) => `
          <div class="wizard-type-card scaffold-card" data-template="${tpl.id}" style="animation-delay:${i * 60}ms; --type-color: ${tpl.color}">
            <div class="wizard-type-card-icon">${tpl.icon}</div>
            <span class="wizard-type-card-name">${tpl.name}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function getWizardFields() {
  return `
    <div class="webapp-config" style="display:none;">
      <div class="wizard-field">
        <label class="wizard-label" data-i18n="newProject.devCommand">Dev command</label>
        <input type="text" id="webapp-dev-command" placeholder="npm run dev" class="wizard-input" />
        <small style="color: var(--text-secondary); margin-top: 4px; display: block; font-size: 11px;">
          Leave empty to auto-detect from package.json
        </small>
      </div>
    </div>
  `;
}

function onWizardTypeSelected(form, isSelected) {
  const config = form.querySelector('.webapp-config');
  if (config) {
    config.style.display = isSelected ? 'block' : 'none';
  }
}

function bindWizardEvents(form, api) {
  // No special events needed for webapp wizard
}

function getWizardConfig(form) {
  const devCommand = form.querySelector('#webapp-dev-command')?.value?.trim() || '';
  return {
    devCommand: devCommand || undefined
  };
}

module.exports = {
  getWizardFields,
  onWizardTypeSelected,
  bindWizardEvents,
  getWizardConfig,
  SCAFFOLD_TEMPLATES,
  detectFramework,
  getTemplateGridHtml
};
