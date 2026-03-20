const { ApiProvider } = require('./ApiProvider');
const { ServiceContainer } = require('./ServiceContainer');
const { BaseService } = require('./BaseService');
const { BaseComponent } = require('./BaseComponent');
const { BasePanel } = require('./BasePanel');

// ── Singleton instances (created once at bootstrap) ──

let apiProvider = null;
let container = null;

/**
 * Initialize core infrastructure.
 * Called once from src/renderer/index.js during bootstrap.
 */
function initCore(electronApi, nodeModules) {
  apiProvider = new ApiProvider(electronApi, nodeModules);
  container = new ServiceContainer();
  container.register('api', apiProvider);
  return { apiProvider, container };
}

/**
 * Get the singleton ApiProvider.
 * @returns {ApiProvider}
 */
function getApiProvider() {
  return apiProvider;
}

/**
 * Get the singleton ServiceContainer.
 * @returns {ServiceContainer}
 */
function getContainer() {
  return container;
}

module.exports = {
  // Classes
  ApiProvider,
  ServiceContainer,
  BaseService,
  BaseComponent,
  BasePanel,

  // Bootstrap
  initCore,

  // Singleton accessors
  getApiProvider,
  getContainer,
};
