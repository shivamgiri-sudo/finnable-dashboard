'use strict';

const mysql = require('mysql2/promise');
const { config } = require('../config');

const pool = mysql.createPool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
  waitForConnections: true,
  connectionLimit: config.database.connectionLimit,
  maxIdle: config.database.connectionLimit,
  idleTimeout: 60000,
  queueLimit: config.database.queueLimit,
  connectTimeout: config.database.connectTimeoutMs,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  dateStrings: true,
  ssl: config.database.ssl ? { rejectUnauthorized: config.database.sslRejectUnauthorized } : undefined
});

async function warmPool() {
  const count = Math.min(config.database.warmConnections, config.database.connectionLimit);
  const connections = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const connection = await pool.getConnection();
      connections.push(connection);
    }
    await Promise.all(connections.map((connection) => connection.query('SELECT 1 AS ready')));
    return count;
  } finally {
    connections.forEach((connection) => connection.release());
  }
}

async function checkDatabase() {
  const started = Date.now();
  const [rows] = await pool.query('SELECT 1 AS connected');
  return { connected: rows[0].connected === 1, elapsedMs: Date.now() - started };
}

async function shutdownPool() {
  await pool.end();
}

module.exports = { pool, warmPool, checkDatabase, shutdownPool };
