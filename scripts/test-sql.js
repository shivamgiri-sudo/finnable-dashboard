'use strict';

const { validateRuntimeConfig, config } = require('../src/config');
const { warmPool, shutdownPool } = require('../src/db/pool');
const repository = require('../src/repositories/auditRepository');

async function main() {
  validateRuntimeConfig();
  const warmStarted = Date.now();
  const warmCount = await warmPool();
  const warmMs = Date.now() - warmStarted;
  const count = await repository.countClientRows(config.defaultClientId);
  const summary = await repository.fetchSummaryRows(config.defaultClientId);
  const latestCallId = summary.rows[0] ? summary.rows[0].id : '';
  const detail = latestCallId ? await repository.fetchCallDetail(config.defaultClientId, latestCallId) : { elapsedMs: 0, row: null };

  console.log(JSON.stringify({
    success: true,
    source: `${config.database.name}.${config.database.auditTable}`,
    clientId: config.defaultClientId,
    warmConnections: warmCount,
    poolWarmupMs: warmMs,
    clientRowCount: count.total,
    countQueryMs: count.elapsedMs,
    summaryReturnedRows: summary.rows.length,
    summaryQueryMs: summary.elapsedMs,
    latestCallId,
    detailReturned: Boolean(detail.row),
    detailQueryMs: detail.elapsedMs
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await shutdownPool();
  });
