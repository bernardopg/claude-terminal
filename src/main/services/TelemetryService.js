/**
 * TelemetryService
 * Anonymous usage tracking with opt-in consent.
 * Batches pings and flushes to the telemetry backend. Silent failure — never blocks the app.
 */

const https = require('https');
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');
const { settingsFile, projectsFile } = require('../utils/paths');

const TELEMETRY_URL = process.env.TELEMETRY_URL || 'https://telemetry.claudeterminal.dev';
const PING_PATH = '/api/v1/ping';
const BATCH_PATH = '/api/v1/batch';
const TIMEOUT = 5000;
const FLUSH_INTERVAL = 5 * 1000; // 5s

// Client-side rate limit: 1 ping per event_type per minute
const lastPingTimes = new Map();
const ONE_MINUTE = 60 * 1000;

// Session tracking
const sessionStartTime = Date.now();

// ── Settings cache ──

let cachedSettings = null;
let settingsMtime = 0;

function loadSettings() {
  try {
    if (!fs.existsSync(settingsFile)) return null;
    const stat = fs.statSync(settingsFile);
    if (cachedSettings && stat.mtimeMs === settingsMtime) return cachedSettings;
    cachedSettings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    settingsMtime = stat.mtimeMs;
    return cachedSettings;
  } catch {
    return null;
  }
}

function saveSetting(key, value) {
  try {
    const settings = loadSettings() || {};
    settings[key] = value;
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    cachedSettings = settings;
  } catch {
    // silent
  }
}

// ── Path stripping for error privacy ──

function stripUserPaths(str) {
  if (!str) return '';
  return str
    .replace(/[A-Z]:\\Users\\[^\\]+\\/gi, '<home>\\')
    .replace(/\/home\/[^/]+\//g, '<home>/')
    .replace(/\/Users\/[^/]+\//g, '<home>/');
}

// ── Project type counting ──

function getProjectTypeCounts() {
  try {
    if (!fs.existsSync(projectsFile)) return {};
    const data = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
    const projects = data.projects || [];
    const counts = {};
    for (const p of projects) {
      const type = p.type || 'general';
      counts[type] = (counts[type] || 0) + 1;
    }
    return counts;
  } catch {
    return {};
  }
}

// ── Batching ──

const eventBuffer = [];
let flushTimer = null;

function startFlushTimer() {
  if (flushTimer) return;
  flushTimer = setInterval(() => flushBuffer(), FLUSH_INTERVAL);
  if (flushTimer.unref) flushTimer.unref();
}

function flushBuffer() {
  if (eventBuffer.length === 0) return;

  const settings = loadSettings();
  if (!settings || !settings.telemetryEnabled) {
    eventBuffer.length = 0;
    return;
  }

  let uuid = settings.telemetryUuid;
  if (!uuid) {
    uuid = randomUUID();
    saveSetting('telemetryUuid', uuid);
  }

  const commonFields = {
    uuid,
    app_version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    os_version: `${os.type()} ${os.release()}`,
    locale: settings.language || app.getLocale() || 'en',
    first_seen_version: settings.firstSeenVersion || app.getVersion()
  };

  const events = eventBuffer.splice(0);

  // Try batch endpoint first, fall back to individual pings
  const payload = JSON.stringify({
    ...commonFields,
    events: events.map(e => ({ event_type: e.eventType, metadata: e.metadata, ts: e.ts }))
  });

  const url = new URL(TELEMETRY_URL);

  const req = https.request({
    hostname: url.hostname,
    port: url.port || 443,
    path: BATCH_PATH,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'User-Agent': `ClaudeTerminal/${app.getVersion()}`
    },
    timeout: TIMEOUT
  }, (res) => {
    res.resume();
    if (res.statusCode === 404) {
      // Batch endpoint not available, send individually
      for (const event of events) {
        sendSingle(commonFields, event.eventType, event.metadata);
      }
    }
  });

  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
  req.write(payload);
  req.end();
}

function sendSingle(commonFields, eventType, metadata) {
  try {
    const payload = JSON.stringify({ ...commonFields, event_type: eventType, metadata });
    const url = new URL(TELEMETRY_URL);

    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: PING_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': `ClaudeTerminal/${commonFields.app_version}`
      },
      timeout: TIMEOUT
    }, (res) => {
      res.resume();
    });

    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.write(payload);
    req.end();
  } catch {
    // silent
  }
}

// ── Core ──

function canSend(eventType) {
  const now = Date.now();
  const last = lastPingTimes.get(eventType);
  if (last && (now - last) < ONE_MINUTE) return false;
  return true;
}

/**
 * Queue a telemetry ping (batched, flushed every 5s).
 * @param {string} eventType - e.g. "app:start", "features:terminal:create"
 * @param {Object} [metadata={}]
 */
function sendPing(eventType, metadata = {}) {
  try {
    const settings = loadSettings();
    if (!settings || !settings.telemetryEnabled) return;

    // Check category
    const category = eventType.split(':')[0];
    const categories = settings.telemetryCategories || { app: true, features: true, errors: true };
    if (!categories[category]) return;

    // Client rate limit
    if (!canSend(eventType)) return;
    lastPingTimes.set(eventType, Date.now());

    eventBuffer.push({ eventType, metadata, ts: Date.now() });
    startFlushTimer();
  } catch {
    // silent
  }
}

function sendStartupPing() {
  // Ensure first_seen_version is persisted
  const settings = loadSettings();
  if (settings && !settings.firstSeenVersion) {
    saveSetting('firstSeenVersion', app.getVersion());
  }

  sendPing('app:start', {
    project_types: getProjectTypeCounts()
  });
  // Flush immediately so app:start is never lost
  flushBuffer();
}

function sendQuitPing() {
  const durationMs = Date.now() - sessionStartTime;
  const durationMin = Math.round(durationMs / 60000);
  sendPing('app:quit', { session_duration_min: durationMin });
  // Flush immediately on quit — don't lose the event
  flushBuffer();
}

function sendFeaturePing(feature, metadata = {}) {
  sendPing(`features:${feature}`, metadata);
}

function sendErrorPing(error) {
  sendPing('errors:uncaught', {
    message: stripUserPaths(error?.message || String(error)),
    stack: stripUserPaths(error?.stack?.split('\n')[0] || '')
  });
}

function getStatus() {
  const settings = loadSettings();
  return {
    enabled: settings?.telemetryEnabled || false,
    uuid: settings?.telemetryUuid || null,
    categories: settings?.telemetryCategories || { app: true, features: true, errors: true }
  };
}

module.exports = {
  sendPing,
  sendStartupPing,
  sendQuitPing,
  sendFeaturePing,
  sendErrorPing,
  getStatus
};
