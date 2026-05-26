'use strict';

const path = require('path');
require('dotenv').config({ path: process.env.ENV_FILE || path.resolve(process.cwd(), '.env') });

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function booleanEnv(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'y'].includes(String(value).toLowerCase());
}

function safeIdentifier(value, label) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+){0,2}$/.test(text)) {
    throw new Error(`${label} contains invalid characters.`);
  }
  return text;
}

const config = {
  port: positiveInt(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  dashboardPin: String(process.env.DASHBOARD_PIN || ''),
  jwtSecret: String(process.env.JWT_SECRET || ''),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  defaultClientId: String(process.env.DEFAULT_CLIENT_ID || '497'),
  database: {
    host: String(process.env.DB_HOST || '').trim(),
    port: positiveInt(process.env.DB_PORT, 3306),
    user: String(process.env.DB_USER || '').trim(),
    password: String(process.env.DB_PASSWORD || ''),
    name: safeIdentifier(process.env.DB_DATABASE || 'db_external', 'DB_DATABASE'),
    auditTable: safeIdentifier(process.env.DB_AUDIT_TABLE || 'CallDetails', 'DB_AUDIT_TABLE'),
    mappingTable: process.env.DB_MAPPING_TABLE ? safeIdentifier(process.env.DB_MAPPING_TABLE, 'DB_MAPPING_TABLE') : '',
    connectionLimit: positiveInt(process.env.DB_CONNECTION_LIMIT, 10),
    queueLimit: Math.max(0, Number(process.env.DB_QUEUE_LIMIT || 0)),
    connectTimeoutMs: positiveInt(process.env.DB_CONNECT_TIMEOUT_MS, 10000),
    ssl: booleanEnv(process.env.DB_SSL, false),
    sslRejectUnauthorized: booleanEnv(process.env.DB_SSL_REJECT_UNAUTHORIZED, true),
    warmConnections: positiveInt(process.env.DB_WARM_CONNECTIONS, 2)
  },
  maxSummaryRows: Math.min(positiveInt(process.env.MAX_SUMMARY_ROWS, 50000), 100000),
  summaryCacheTtlMs: Math.max(0, positiveInt(process.env.SUMMARY_CACHE_TTL_MS, 15000)),
  mappingCacheTtlMs: Math.max(0, positiveInt(process.env.MAPPING_CACHE_TTL_MS, 300000))
};

function validateRuntimeConfig() {
  const missing = [];
  if (!config.dashboardPin) missing.push('DASHBOARD_PIN');
  if (!config.jwtSecret || config.jwtSecret.length < 32) missing.push('JWT_SECRET (minimum 32 characters)');
  if (!config.database.host) missing.push('DB_HOST');
  if (!config.database.user) missing.push('DB_USER');
  if (!config.database.password) missing.push('DB_PASSWORD');
  if (missing.length) {
    throw new Error(`Missing or invalid environment configuration: ${missing.join(', ')}`);
  }
}

module.exports = { config, validateRuntimeConfig, safeIdentifier };
