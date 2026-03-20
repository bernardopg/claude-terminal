/**
 * ServiceContainer — Simple service registry.
 *
 * Services register by name; consumers resolve by name.
 * Supports lazy instantiation via factories.
 */
class ServiceContainer {
  constructor() {
    this._services = new Map();
    this._factories = new Map();
  }

  /**
   * Register a service instance.
   * @param {string} name
   * @param {object} instance
   */
  register(name, instance) {
    this._services.set(name, instance);
  }

  /**
   * Register a factory for lazy instantiation.
   * @param {string} name
   * @param {(container: ServiceContainer) => object} factory
   */
  registerFactory(name, factory) {
    this._factories.set(name, factory);
  }

  /**
   * Resolve a service by name.
   * Factories are invoked once, then cached.
   * @param {string} name
   * @returns {object}
   */
  resolve(name) {
    if (this._services.has(name)) {
      return this._services.get(name);
    }
    if (this._factories.has(name)) {
      const factory = this._factories.get(name);
      const instance = factory(this);
      this._services.set(name, instance);
      this._factories.delete(name);
      return instance;
    }
    throw new Error(`[ServiceContainer] Service not found: ${name}`);
  }

  /**
   * Check if a service is registered (instance or factory).
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._services.has(name) || this._factories.has(name);
  }

  /**
   * Get all registered service names.
   * @returns {string[]}
   */
  keys() {
    return [...new Set([...this._services.keys(), ...this._factories.keys()])];
  }
}

module.exports = { ServiceContainer };
