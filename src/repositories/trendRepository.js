'use strict';

const { pool } = require('../db/pool');
const { config } = require('../config');

const TABLE = `\`${config.database.name}\`.\`${config.database.auditTable}\``;
const CLIENT = String(config.defaultClientId);

async function fetchRowsForTrend(from, to, agentName) {
  const params = [CLIENT];
  let sql = `SELECT AgentName, CallDate, Feedback_Category, ConsumptionType,
    PrepaidPitch, Snapmint_Pitch, UpsellingEfforts, SaleDone, CallDisposition,
    FeedbackContext, Category, SubCategory, AreaForImprovement
    FROM ${TABLE}
    WHERE client_id = ?`;
  if (from) { sql += ' AND CallDate >= ?'; params.push(from); }
  if (to)   { sql += ' AND CallDate <= ?'; params.push(to); }
  if (agentName) { sql += ' AND AgentName = ?'; params.push(agentName); }
  sql += ' ORDER BY CallDate ASC';
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function fetchAnalystSummary(from, to) {
  const params = [CLIENT];
  let sql = `
    SELECT
      AgentName,
      COUNT(*) AS totalCalls,
      SUM(CASE WHEN Feedback_Category REGEXP '^[0-9]+(\\.[0-9]+)?$' AND CAST(Feedback_Category AS DECIMAL) > 0 THEN 1 ELSE 0 END) AS scoredCalls,
      AVG(CASE WHEN Feedback_Category REGEXP '^[0-9]+(\\.[0-9]+)?$' AND CAST(Feedback_Category AS DECIMAL) > 0 THEN CAST(Feedback_Category AS DECIMAL) ELSE NULL END) AS avgScore,
      SUM(CASE WHEN PrepaidPitch = '1' THEN 1 ELSE 0 END) AS pitchAttempts,
      SUM(CASE WHEN UpsellingEfforts = 'Strong' THEN 1 ELSE 0 END) AS strongPitch,
      SUM(CASE WHEN Snapmint_Pitch IN ('High','Critical') THEN 1 ELSE 0 END) AS highRiskCount,
      SUM(CASE WHEN ConsumptionType IN ('Sales','Mixed') THEN 1 ELSE 0 END) AS opportunities,
      SUM(CASE WHEN SaleDone = '1' THEN 1 ELSE 0 END) AS disbursals,
      MAX(CallDate) AS lastCallDate
    FROM ${TABLE}
    WHERE client_id = ?`;
  if (from) { sql += ' AND CallDate >= ?'; params.push(from); }
  if (to)   { sql += ' AND CallDate <= ?'; params.push(to); }
  sql += ' GROUP BY AgentName ORDER BY avgScore ASC';
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function fetchParameterTrend(from, to) {
  const params = [CLIENT];
  let sql = `SELECT FeedbackContext, AgentName, CallDate FROM ${TABLE} WHERE client_id = ? AND FeedbackContext IS NOT NULL AND FeedbackContext != ''`;
  if (from) { sql += ' AND CallDate >= ?'; params.push(from); }
  if (to)   { sql += ' AND CallDate <= ?'; params.push(to); }
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function fetchTNIRows(from, to) {
  const params = [CLIENT];
  let sql = `SELECT AgentName, CallDate, Category, SubCategory, AreaForImprovement,
    ConsumptionType, Snapmint_Pitch, FeedbackContext, Feedback_Category
    FROM ${TABLE} WHERE client_id = ?`;
  if (from) { sql += ' AND CallDate >= ?'; params.push(from); }
  if (to)   { sql += ' AND CallDate <= ?'; params.push(to); }
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function fetchRiskRows(from, to) {
  const params = [CLIENT];
  let sql = `SELECT id, AgentName, CallDate, Snapmint_Pitch, SensitiveWordUsed,
    Feedback_Category, ConsumptionType, AreaForImprovement, Feedback, MobileNo
    FROM ${TABLE}
    WHERE client_id = ? AND Snapmint_Pitch IN ('High','Critical','Medium')`;
  if (from) { sql += ' AND CallDate >= ?'; params.push(from); }
  if (to)   { sql += ' AND CallDate <= ?'; params.push(to); }
  sql += ' ORDER BY CallDate DESC LIMIT 500';
  const [rows] = await pool.execute(sql, params);
  return rows;
}

module.exports = { fetchRowsForTrend, fetchAnalystSummary, fetchParameterTrend, fetchTNIRows, fetchRiskRows };
