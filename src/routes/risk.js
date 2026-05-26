'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const repo = require('../repositories/trendRepository');
const { getDateRange } = require('../engine/trendEngine');
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

function riskAction(row) {
  const pitch = String(row.Snapmint_Pitch || '');
  const score = Number(row.Feedback_Category);
  if (pitch === 'Critical') return { priority: 'P1 Critical', action: 'Same-day compliance review + coaching', trigger: 'Confirmed critical violation: ' + String(row.SensitiveWordUsed || '') };
  if (pitch === 'High')     return { priority: 'P1 Validate', action: 'Validate transcript phrase, same-day coaching', trigger: 'High risk trigger: ' + String(row.SensitiveWordUsed || '') };
  if (pitch === 'Medium')   return { priority: 'P2 Coach',    action: '24-hour coaching session + transcript review', trigger: 'Medium transparency flag: ' + String(row.SensitiveWordUsed || '') };
  if (!isNaN(score) && score === 0) return { priority: 'P1 Zero Score', action: 'Investigate zero-score and approve corrective plan', trigger: 'Zero quality score' };
  if (!isNaN(score) && score < 70)  return { priority: 'P2 Low Score',  action: 'Schedule coaching and re-audit', trigger: `Score ${score} below 70% threshold` };
  return { priority: 'Monitor', action: 'Weekly TL review', trigger: 'Medium flag' };
}

router.use(requireAuth);

router.post('/', asyncHandler(async (req, res) => {
  const { from, to } = resolveDates(req.body);
  const started = Date.now();
  const rows = await repo.fetchRiskRows(from, to);

  const actions = rows.map(r => {
    const ra = riskAction(r);
    return {
      callId: String(r.id),
      agentName: String(r.AgentName || ''),
      callDate: String(r.CallDate || '').slice(0, 10),
      riskLevel: String(r.Snapmint_Pitch || ''),
      sensitiveWord: String(r.SensitiveWordUsed || ''),
      score: Number(r.Feedback_Category) || null,
      callType: String(r.ConsumptionType || ''),
      insight: String(r.Feedback || ''),
      coachingNeed: String(r.AreaForImprovement || ''),
      priority: ra.priority,
      recommendedAction: ra.action,
      trigger: ra.trigger
    };
  }).sort((a, b) => {
    const rank = { 'P1 Critical': 0, 'P1 Validate': 1, 'P1 Zero Score': 1, 'P2 Coach': 2, 'P2 Low Score': 2, 'Monitor': 9 };
    return (rank[a.priority] || 5) - (rank[b.priority] || 5);
  });

  const summary = {
    total: actions.length,
    p1Count: actions.filter(a => a.priority.startsWith('P1')).length,
    p2Count: actions.filter(a => a.priority.startsWith('P2')).length,
    criticalCount: actions.filter(a => a.riskLevel === 'Critical').length,
    highCount: actions.filter(a => a.riskLevel === 'High').length,
    uniqueAgents: new Set(actions.map(a => a.agentName)).size
  };

  res.json({ actions: actions.slice(0, 200), summary, dateRange: { from, to }, queryMs: Date.now() - started });
}));

module.exports = router;
