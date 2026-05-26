'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const repo = require('../repositories/trendRepository');
const { getDateRange, buildDayTrend } = require('../engine/trendEngine');
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

router.post('/leaderboard', asyncHandler(async (req, res) => {
  const { from, to } = resolveDates(req.body);
  const started = Date.now();
  const rows = await repo.fetchAnalystSummary(from, to);
  const leaderboard = rows.map((r) => ({
    agentName: r.AgentName,
    totalCalls: Number(r.totalCalls),
    scoredCalls: Number(r.scoredCalls),
    avgScore: r.avgScore ? Math.round(Number(r.avgScore) * 10) / 10 : null,
    pitchAttempts: Number(r.pitchAttempts),
    strongPitch: Number(r.strongPitch),
    opportunities: Number(r.opportunities),
    highRiskCount: Number(r.highRiskCount),
    disbursals: Number(r.disbursals),
    pitchAttemptRate: Number(r.opportunities) > 0
      ? Math.round(Number(r.pitchAttempts) / Number(r.opportunities) * 1000) / 10
      : 0,
    lastCallDate: String(r.lastCallDate || '').slice(0, 10)
  }));
  leaderboard.sort((a, b) => (a.avgScore || 0) - (b.avgScore || 0));
  leaderboard.forEach((r, i) => { r.rank = i + 1; });
  res.json({ leaderboard, dateRange: { from, to }, queryMs: Date.now() - started });
}));

router.post('/:agentName/trend', asyncHandler(async (req, res) => {
  const { from, to } = resolveDates(req.body);
  const agent = decodeURIComponent(req.params.agentName);
  const rows = await repo.fetchRowsForTrend(from, to, agent);
  const trend = buildDayTrend(rows);
  res.json({ agentName: agent, trend, totalRows: rows.length, dateRange: { from, to } });
}));

module.exports = router;
