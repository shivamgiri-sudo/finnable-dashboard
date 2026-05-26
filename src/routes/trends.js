'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const repo = require('../repositories/trendRepository');
const { getDateRange, buildDayTrend, buildScoreBands } = require('../engine/trendEngine');
const { buildParameterHeatmap } = require('../engine/tniEngine');
const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function resolveDates(body) {
  const preset = String(body.preset || '');
  if (['D1', 'WTD', 'MTD'].includes(preset)) {
    const range = getDateRange(preset);
    return { from: range.from, to: range.to };
  }
  return { from: body.from || '', to: body.to || '' };
}

router.use(requireAuth);

router.post('/quality', asyncHandler(async (req, res) => {
  const { from, to } = resolveDates(req.body);
  const agentName = req.body.agent || '';
  const started = Date.now();
  const rows = await repo.fetchRowsForTrend(from, to, agentName);
  const trend = buildDayTrend(rows);
  const bands = buildScoreBands(rows);
  res.json({
    trend,
    scoreBands: bands,
    totalRows: rows.length,
    dateRange: { from, to },
    queryMs: Date.now() - started
  });
}));

router.post('/parameters', asyncHandler(async (req, res) => {
  const { from, to } = resolveDates(req.body);
  const rows = await repo.fetchParameterTrend(from, to);
  res.json({ heatmap: buildParameterHeatmap(rows), totalRows: rows.length });
}));

module.exports = router;
