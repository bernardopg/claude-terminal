'use strict';

module.exports = {
  type:  'webhook',
  label: 'Webhook',
  desc:  'Triggered by an external HTTP POST via the cloud relay',

  /**
   * Webhook triggers are push-based (delivered via cloud relay → RemoteServer),
   * so shouldFire is never called by the scheduler.
   */
  shouldFire(_config, _context) {
    return false;
  },

  /**
   * No setup needed — webhook delivery is event-driven via WebSocket,
   * not polled by the scheduler.
   */
  setup(_config, _onFire) {
    return () => {};
  },
};
