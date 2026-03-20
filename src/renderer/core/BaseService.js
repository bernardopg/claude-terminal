/**
 * BaseService — Base class for renderer-side services.
 *
 * Provides access to ApiProvider (IPC) and ServiceContainer (other services).
 * Subclasses use this.api.git, this.api.terminal, etc. instead of window.electron_api.
 */
class BaseService {
  /**
   * @param {import('./ApiProvider').ApiProvider} api
   * @param {import('./ServiceContainer').ServiceContainer} container
   */
  constructor(api, container) {
    if (!api) throw new Error(`${this.constructor.name}: ApiProvider is required`);
    this.api = api;
    this.container = container;
  }

  /**
   * Resolve another service by name.
   * @param {string} name
   * @returns {object}
   */
  getService(name) {
    return this.container.resolve(name);
  }
}

module.exports = { BaseService };
