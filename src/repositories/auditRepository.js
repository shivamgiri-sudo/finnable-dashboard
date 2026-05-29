'use strict';

const { pool } = require('../db/pool');
const { config, safeIdentifier } = require('../config');

const SUMMARY_COLUMNS = [
  'id', 'client_id', 'AgentName', 'CallDate', 'MobileNo', 'ConsumptionType',
  'AgeofConsumption', 'UpsellingEfforts', 'Feedback_Category', 'Feedback',
  'FeedbackContext', 'AreaForImprovement', 'Category', 'SubCategory',
  'PrepaidPitch', 'CustomerObjectionCategory', 'CustomerObjectionSubCategory',
  'ObjectionHandling', 'SensitiveWordUsed', 'Snapmint_Pitch',
  'Pricing_and_Discount_Structure', 'CallDisposition', 'SaleDone',
  'Further_Assistance', 'Order_Consent', 'Call_Closing', 'Product_Appreciation'
];

const DETAIL_COLUMNS = [
  'id', 'client_id', 'AgentName', 'CallDate', 'MobileNo', 'ConsumptionType',
  'AgeofConsumption', 'UpsellingEfforts', 'Feedback_Category', 'Feedback',
  'FeedbackContext', 'AreaForImprovement', 'Category', 'SubCategory',
  'PrepaidPitch', 'PrepaidPitchContext', 'OfferedPitchContext',
  'CustomerObjectionCategory', 'CustomerObjectionSubCategory',
  'ObjectionHandling', 'ObjectionHandlingContext', 'SensitiveWordUsed',
  'SensitiveWordContext', 'Snapmint_Pitch', 'Pricing_and_Discount_Structure',
  'Sale_Pitch_Discount_Structure', 'CallDisposition', 'SaleDone',
  'Further_Assistance', 'Order_Consent', 'Call_Closing', 'Product_Appreciation',
  'TranscribeText'
];

function quoteIdentifier(identifier) {
  safeIdentifier(identifier, 'SQL identifier');
  return identifier.split('.').map((part) => `\`${part}\``).join('.');
}

function tableName() {
  return `${quoteIdentifier(config.database.name)}.${quoteIdentifier(config.database.auditTable)}`;
}

function columnList(columns) {
  return columns.map(quoteIdentifier).join(', ');
}

async function fetchSummaryRows(clientId) {
  const sql = `
    SELECT ${columnList(SUMMARY_COLUMNS)}
    FROM ${tableName()}
    WHERE \`client_id\` = ?
    ORDER BY \`CallDate\` DESC
    LIMIT ${config.maxSummaryRows}
  `;
  const started = Date.now();
  const [rows] = await pool.execute(sql, [String(clientId)]);
  return { rows, elapsedMs: Date.now() - started };
}

async function fetchCallDetail(clientId, callId) {
  const sql = `
    SELECT ${columnList(DETAIL_COLUMNS)}
    FROM ${tableName()}
    WHERE \`id\` = ? AND \`client_id\` = ?
    LIMIT 1
  `;
  const started = Date.now();
  const [rows] = await pool.execute(sql, [String(callId), String(clientId)]);
  return { row: rows[0] || null, elapsedMs: Date.now() - started };
}

async function fetchMappingRows(clientId) {
  if (!config.database.mappingTable) return { rows: [], elapsedMs: 0 };
  const mappingObject = config.database.mappingTable.includes('.')
    ? quoteIdentifier(config.database.mappingTable)
    : `${quoteIdentifier(config.database.name)}.${quoteIdentifier(config.database.mappingTable)}`;
  const sql = `SELECT * FROM ${mappingObject} WHERE \`client_id\` = ? LIMIT 10000`;
  const started = Date.now();
  const [rows] = await pool.execute(sql, [String(clientId)]);
  return { rows, elapsedMs: Date.now() - started };
}

async function countClientRows(clientId) {
  const sql = `SELECT COUNT(*) AS total FROM ${tableName()} WHERE \`client_id\` = ?`;
  const started = Date.now();
  const [rows] = await pool.execute(sql, [String(clientId)]);
  return { total: Number(rows[0].total || 0), elapsedMs: Date.now() - started };
}

async function fetchAgentNameMap() {
  try {
    const [rows] = await pool.execute(
      'SELECT employee_code, agent_name FROM Shivamgiri.ci_agent_master WHERE active_status = 1'
    );
    const map = {};
    rows.forEach(r => {
      if (r.employee_code && r.agent_name && r.agent_name !== r.employee_code) {
        map[String(r.employee_code).trim()] = String(r.agent_name).trim();
      }
    });
    return map;
  } catch (err) {
    return {};
  }
}

async function explainCallDetail(clientId, callId) {
  const sql = `
    EXPLAIN SELECT ${columnList(['id', 'client_id', 'AgentName', 'CallDate', 'TranscribeText', 'FeedbackContext'])}
    FROM ${tableName()}
    WHERE \`id\` = ? AND \`client_id\` = ?
    LIMIT 1
  `;
  const [rows] = await pool.execute(sql, [String(callId), String(clientId)]);
  return rows;
}

module.exports = {
  SUMMARY_COLUMNS,
  DETAIL_COLUMNS,
  fetchSummaryRows,
  fetchCallDetail,
  fetchMappingRows,
  fetchAgentNameMap,
  countClientRows,
  explainCallDetail
};
