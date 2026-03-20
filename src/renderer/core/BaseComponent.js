/**
 * BaseComponent — Base class for UI components.
 *
 * Lifecycle:
 *   constructor(el, options) → render() → destroy()
 *
 * Subclasses override render() and optionally destroy() (call super.destroy()).
 *
 * Built-in helpers:
 *   this.on(el, event, handler)      — tracked addEventListener, auto-removed on destroy
 *   this.subscribe(state, handler)   — tracked state subscription, auto-removed on destroy
 *   this.html(template)              — set innerHTML on this.el
 *   this.$(selector)                 — querySelector scoped to this.el
 *   this.$$(selector)                — querySelectorAll scoped to this.el
 */
class BaseComponent {
  /**
   * @param {HTMLElement} el - Container element
   * @param {object} [options] - Component options
   */
  constructor(el, options = {}) {
    this.el = el;
    this.options = options;
    this._listeners = [];
    this._subscriptions = [];
    this._children = [];
    this._destroyed = false;
  }

  /**
   * Tracked addEventListener — auto-removed on destroy().
   * @param {EventTarget} target
   * @param {string} event
   * @param {Function} handler
   * @param {object|boolean} [opts]
   */
  on(target, event, handler, opts) {
    target.addEventListener(event, handler, opts);
    this._listeners.push({ target, event, handler, opts });
  }

  /**
   * Tracked state subscription — auto-unsubscribed on destroy().
   * @param {object} state - Any object with a subscribe(fn) method returning an unsubscribe fn
   * @param {Function} handler
   */
  subscribe(state, handler) {
    const unsub = state.subscribe(handler);
    this._subscriptions.push(unsub);
  }

  /**
   * Register a child component — auto-destroyed on parent destroy().
   * @param {BaseComponent} child
   */
  addChild(child) {
    this._children.push(child);
  }

  /**
   * Set innerHTML on this.el.
   * @param {string} html
   */
  html(html) {
    this.el.innerHTML = html;
  }

  /**
   * querySelector scoped to this.el.
   * @param {string} selector
   * @returns {HTMLElement|null}
   */
  $(selector) {
    return this.el.querySelector(selector);
  }

  /**
   * querySelectorAll scoped to this.el.
   * @param {string} selector
   * @returns {NodeListOf<HTMLElement>}
   */
  $$(selector) {
    return this.el.querySelectorAll(selector);
  }

  /**
   * Override in subclass to update the DOM.
   */
  render() {
    // Subclass responsibility
  }

  /**
   * Cleanup all tracked listeners, subscriptions, and child components.
   * Subclasses should call super.destroy() at the end.
   */
  destroy() {
    this._destroyed = true;

    // Remove tracked event listeners
    for (const { target, event, handler, opts } of this._listeners) {
      target.removeEventListener(event, handler, opts);
    }
    this._listeners = [];

    // Unsubscribe from state
    for (const unsub of this._subscriptions) {
      try { unsub(); } catch (_) {}
    }
    this._subscriptions = [];

    // Destroy child components
    for (const child of this._children) {
      try { child.destroy(); } catch (_) {}
    }
    this._children = [];
  }
}

module.exports = { BaseComponent };
