'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const repo = require('../repositories/trendRepository');
const { getDateRange } = require('../engine/trendEngine');
const { buildTNI, buildProcessTNI, buildParameterHeatmap } = require('../engine/tniEngine');
const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function resolveDates(body) {
  const preset = String(body.preset || '');
  if (['D1', 'WTD', 'MTD'].includes(preset)) {
    const r = getDateRange(preset); return { from: r.from, to: r.to };
  }
  return { from: body.from || '', to: body.to || '' };
}

router.use(requireAuth);

router.post('/', asyncHandler(async (req, res) => {
  const { from, to } = resolveDates(req.body);
  const started = Date.now();
  const [tniRows, paramRows] = await Promise.all([
    repo.fetchTNIRows(from, to),
    repo.fetchParameterTrend(from, to)
  ]);
  const analystTNI = buildTNI(tniRows);
  const processTNI = buildProcessTNI(analystTNI);
  const heatmap = buildParameterHeatmap(paramRows);

  const priorityCounts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  analystTNI.forEach(r => { priorityCounts[r.priority] = (priorityCounts[r.priority] || 0) + 1; });

  res.json({
    analystTNI: analystTNI.slice(0, 200),
    processTNI,
    heatmap,
    prioritySummary: priorityCounts,
    totalAnalystRows: analystTNI.length,
    dateRange: { from, to },
    queryMs: Date.now() - started
  });
}));

module.exports = router;
