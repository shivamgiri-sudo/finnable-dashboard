'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { config } = require('../config');
const { checkDatabase } = require('../db/pool');
const { login, requireAuth } = require('../middleware/auth');
const dashboard = require('../services/dashboardService');
const repository = require('../repositories/auditRepository');

const router = express.Router();

function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please try again later.' }
});

router.get('/health', asyncHandler(async (_req, res) => {
  const db = await checkDatabase();
  res.json({
    success: true,
    service: 'Finnable Intelligence API',
    databaseConnected: db.connected,
    databaseLatencyMs: db.elapsedMs
  });
}));

router.get('/bootstrap', (_req, res) => {
  res.json({
    title: 'Finnable Sales & Quality Intelligence Command Center',
    pinConfigured: Boolean(config.dashboardPin),
    defaultClientId: config.defaultClientId,
    source: 'Node API Pool — db_external.CallDetails'
  });
});

router.post('/auth/login', loginLimiter, (req, res, next) => {
  try {
    res.json(login(req.body && req.body.pin));
  } catch (error) {
    next(error);
  }
});

router.use(requireAuth);

router.post('/dashboard', asyncHandler(async (req, res) => {
  res.json(await dashboard.getDashboard(req.body.filters || {}, Boolean(req.body.forceRefresh)));
}));

router.post('/insights/calls', asyncHandler(async (req, res) => {
  res.json(await dashboard.getCallsForInsight(
    req.body.filters || {},
    req.body.dimension,
    req.body.value,
    req.body.page,
    req.body.pageSize
  ));
}));

router.post('/calls/explorer', asyncHandler(async (req, res) => {
  res.json(await dashboard.getCallExplorer(req.body.filters || {}, req.body.page, req.body.pageSize));
}));

router.post('/analysts/cockpit', asyncHandler(async (req, res) => {
  res.json(await dashboard.getAnalystCockpit(req.body.agentName, req.body.filters || {}));
}));

router.get('/calls/:callId', asyncHandler(async (req, res) => {
  res.json(await dashboard.getCallDetail(req.params.callId, req.query.clientId || config.defaultClientId));
}));

router.post('/cache/refresh', asyncHandler(async (req, res) => {
  const clientId = String(req.body.clientId || config.defaultClientId);
  dashboard.invalidateClientCache(clientId);
  res.json({ success: true, clientId });
}));

router.get('/diagnostics/call/:callId', asyncHandler(async (req, res) => {
  const clientId = String(req.query.clientId || config.defaultClientId);
  const started = Date.now();
  const detail = await repository.fetchCallDetail(clientId, req.params.callId);
  const explain = await repository.explainCallDetail(clientId, req.params.callId);
  res.json({
    success: true,
    clientId,
    callId: req.params.callId,
    returned: Boolean(detail.row),
    detailSqlMs: detail.elapsedMs,
    totalDiagnosticMs: Date.now() - started,
    explain
  });
}));

module.exports = router;
