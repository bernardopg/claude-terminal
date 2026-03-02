const express = require('express');
const path = require('path');
const config = require('./config');
const { initDatabase, getDb } = require('./db/database');
const { rateLimitMiddleware } = require('./middleware/rateLimit');
const { validatePingPayload, validateBatchPayload } = require('./middleware/validate');
const pingRoute = require('./routes/ping');
const batchRoute = require('./routes/batch');
const statsRoute = require('./routes/stats');

const app = express();

// Trust proxy (nginx/caddy) for correct IP detection
// Set TRUST_PROXY to number of proxy hops (e.g. 2 for gateway+nginx), or 'true' for all proxies
const _tp = config.TRUST_PROXY;
if (_tp === 'true') {
  app.set('trust proxy', true);
} else {
  const _tpNum = parseInt(_tp);
  if (!isNaN(_tpNum) && _tpNum > 0) {
    app.set('trust proxy', _tpNum);
  }
}

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// CORS - only allow Electron app (no browser origin) and dashboard
app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Electron app sends no origin header; dashboard is same-origin
  if (!origin) return next();
  // Block cross-origin requests from unknown browsers
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Parse JSON with size limit
app.use(express.json({ limit: '10kb' }));

// Rate limiting
app.use(rateLimitMiddleware);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Telemetry ping
app.post('/api/v1/ping', validatePingPayload, pingRoute);

// Telemetry batch
app.post('/api/v1/batch', validateBatchPayload, batchRoute);

// Admin stats
app.get('/api/v1/stats', statsRoute);

// Admin dashboard
app.use('/dashboard', express.static(path.join(__dirname, 'public')));

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('[Server] Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start
let server;
try {
  initDatabase();
  server = app.listen(config.PORT, config.HOST, () => {
    console.log(`[Server] Telemetry server listening on ${config.HOST}:${config.PORT}`);
    if (!process.env.ADMIN_TOKEN) {
      console.log(`[Server] Dev admin token: ${config.ADMIN_TOKEN}`);
    }
  });
} catch (err) {
  console.error('[Server] Failed to start:', err.message);
  process.exit(1);
}

// Graceful shutdown
function shutdown(signal) {
  console.log(`[Server] ${signal} received, shutting down...`);
  if (server) {
    server.close(() => {
      try { getDb().close(); } catch (_) {}
      console.log('[Server] Shutdown complete');
      process.exit(0);
    });
    // Force exit after 5s if connections hang
    setTimeout(() => process.exit(1), 5000);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
