'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const apiRouter = require('./routes/api');
const { config, validateRuntimeConfig } = require('./config');
const { warmPool, shutdownPool } = require('./db/pool');

validateRuntimeConfig();

const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api/')) {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });
  next();
});

app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.nodeEnv === 'production' ? '1h' : 0 }));
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = Number(error.statusCode || 500);
  res.status(status).json({
    message: status >= 500 ? `Server error: ${error.message}` : error.message
  });
});

const server = app.listen(config.port, async () => {
  try {
    const warmed = await warmPool();
    console.log(`Finnable Intelligence dashboard running at http://localhost:${config.port}`);
    console.log(`MySQL pool warmed with ${warmed} connection(s). Source: ${config.database.name}.${config.database.auditTable}; client ${config.defaultClientId}.`);
  } catch (error) {
    console.error('Server started, but database pool warm-up failed:', error.message);
  }
});

async function shutdown(signal) {
  console.log(`${signal} received. Closing server and MySQL pool.`);
  server.close(async () => {
    await shutdownPool();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
