'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { pool } = require('../db/pool');
const { config } = require('../config');
const { getDateRange } = require('../engine/trendEngine');
const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = v => {
    const s = String(v === null || v === undefined ? '' : v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(','))
  ].join('\n');
}

router.use(requireAuth);

router.post('/csv', asyncHandler(async (req, res) => {
  const preset = String(req.body.preset || '');
  let from = req.body.from || '';
  let to = req.body.to || '';
  if (['D1', 'WTD', 'MTD'].includes(preset)) {
    const range = getDateRange(preset);
    from = range.from; to = range.to;
  }
  const agent = req.body.agent || '';
  const TABLE = `\`${config.database.name}\`.\`${config.database.auditTable}\``;

  const params = [String(config.defaultClientId)];
  let sql = `SELECT id, AgentName, CallDate, ConsumptionType, AgeofConsumption,
    Feedback_Category, UpsellingEfforts, PrepaidPitch, CustomerObjectionCategory,
    ObjectionHandling, Snapmint_Pitch, SensitiveWordUsed, SaleDone, CallDisposition,
    Pricing_and_Discount_Structure, Further_Assistance, Category, SubCategory,
    AreaForImprovement, Feedback
    FROM ${TABLE} WHERE client_id = ?`;
  if (from) { sql += ' AND CallDate >= ?'; params.push(from); }
  if (to)   { sql += ' AND CallDate <= ?'; params.push(to); }
  if (agent) { sql += ' AND AgentName = ?'; params.push(agent); }
  sql += ' ORDER BY CallDate DESC LIMIT 5000';

  const [rows] = await pool.execute(sql, params);
  const filename = `finnable_audit_${from || 'all'}_to_${to || 'all'}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCSV(rows));
}));

module.exports = router;
