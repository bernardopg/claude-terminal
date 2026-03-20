const { BaseComponent } = require('./BaseComponent');

/**
 * BasePanel — Base class for sidebar tab panels.
 *
 * Extends BaseComponent with panel-specific lifecycle:
 *   onActivate()   — called when the panel's tab becomes active
 *   onDeactivate() — called when navigating away
 *
 * Also provides access to ApiProvider and ServiceContainer.
 */
class BasePanel extends BaseComponent {
  /**
   * @param {HTMLElement} el
   * @param {object} options
   * @param {import('./ApiProvider').ApiProvider} options.api
   * @param {import('./ServiceContainer').ServiceContainer} options.container
   */
  constructor(el, options = {}) {
    super(el, options);
    this.api = options.api;
    this.container = options.container;
    this._active = false;
  }

  /**
   * Called when this panel's tab is selected.
   * Default: marks as active and calls render().
   */
  onActivate() {
    this._active = true;
    this.render();
  }

  /**
   * Called when navigating away from this panel.
   * Override to pause polling, hide modals, etc.
   */
  onDeactivate() {
    this._active = false;
  }

  /** Whether this panel is currently active. */
  get isActive() {
    return this._active;
  }

  /**
   * Resolve a service from the container.
   * @param {string} name
   * @returns {object}
   */
  getService(name) {
    return this.container.resolve(name);
  }
}

module.exports = { BasePanel };
