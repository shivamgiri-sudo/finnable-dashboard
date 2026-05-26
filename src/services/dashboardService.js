'use strict';

const { config } = require('../config');
const repository = require('../repositories/auditRepository');
const engine = require('../engine/analyticsEngine');

const summaryCache = new Map();
const mappingCache = new Map();

function readCache(cache, key, ttlMs) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.savedAt > ttlMs) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function writeCache(cache, key, value) {
  cache.set(key, { savedAt: Date.now(), value });
}

async function getSummaryRows(clientId, forceRefresh = false) {
  const key = String(clientId);
  if (!forceRefresh) {
    const cached = readCache(summaryCache, key, config.summaryCacheTtlMs);
    if (cached) return { ...cached, cacheHit: true };
  }
  const query = await repository.fetchSummaryRows(key);
  const value = { rows: query.rows, queryMs: query.elapsedMs };
  writeCache(summaryCache, key, value);
  return { ...value, cacheHit: false };
}

function rowsToMapping(rows) {
  const output = {};
  (rows || []).forEach((row) => {
    const active = String(row.ActiveStatus || '').trim().toLowerCase();
    if (active && !['active', 'yes', 'y', '1', 'true'].includes(active)) return;
    const agent = String(row.AgentName || '').trim();
    if (!agent) return;
    output[agent] = {
      analystName: String(row.AnalystName || agent).trim(),
      tlName: String(row.TLName || '').trim(),
      teamName: String(row.TeamName || '').trim(),
      branch: String(row.Branch || '').trim()
    };
  });
  return output;
}

async function getMappings(clientId) {
  if (!config.database.mappingTable) return {};
  const key = String(clientId);
  const cached = readCache(mappingCache, key, config.mappingCacheTtlMs);
  if (cached) return cached;
  const query = await repository.fetchMappingRows(key);
  const mapping = rowsToMapping(query.rows);
  writeCache(mappingCache, key, mapping);
  return mapping;
}

async function getDashboard(filters, forceRefresh = false) {
  const started = Date.now();
  const f = engine.cleanFilters_(filters);
  const source = await getSummaryRows(f.clientId, forceRefresh);
  const allRows = engine.enrichRows_(source.rows);
  const rows = engine.applyFiltersToEnriched_(allRows, f);
  const mappings = await getMappings(f.clientId);
  const summary = engine.buildSummary_(rows);
  const sales = engine.buildSales_(rows);
  const journey = engine.buildJourney_(rows);
  const quality = engine.buildQuality_(rows);
  const compliance = engine.buildCompliance_(rows);
  const analysts = engine.buildAnalysts_(rows, mappings);
  const actions = engine.buildActions_(rows, mappings);

  return {
    source: 'Node API Pool — db_external.CallDetails / Finnable 497',
    clientId: f.clientId,
    refreshedAt: new Date().toISOString(),
    filters: f,
    filterOptions: engine.buildFilterOptions_(allRows),
    summary,
    sales,
    journey,
    quality,
    compliance,
    analysts,
    actions: actions.slice(0, 150),
    callouts: engine.buildCallouts_(summary, sales, journey, quality, compliance, analysts),
    performance: {
      sqlQueryMs: source.queryMs,
      cacheHit: source.cacheHit,
      totalApiMs: Date.now() - started
    }
  };
}

async function getCallsForInsight(filters, dimension, value, page, pageSize) {
  const f = engine.cleanFilters_(filters);
  const source = await getSummaryRows(f.clientId, false);
  const filtered = engine.applyFiltersToEnriched_(engine.enrichRows_(source.rows), f);
  const all = filtered
    .filter((row) => engine.insightMatches_(row, String(dimension || ''), String(value || '')))
    .sort(engine.sortNewest_);
  const size = engine.clamp_(Number(pageSize) || 20, 5, 100);
  const currentPage = Math.max(1, Number(page) || 1);
  const start = (currentPage - 1) * size;

  return {
    dimension,
    value,
    title: engine.drilldownTitle_(dimension, value),
    totalRows: all.length,
    page: currentPage,
    pageSize: size,
    totalPages: Math.max(1, Math.ceil(all.length / size)),
    records: all.slice(start, start + size).map(engine.lightRecord_),
    performance: { sqlQueryMs: source.queryMs, cacheHit: source.cacheHit }
  };
}

async function getCallExplorer(filters, page, pageSize) {
  return getCallsForInsight(filters, '', '', page, pageSize);
}

async function getAnalystCockpit(agentName, filters) {
  const f = engine.cleanFilters_(filters);
  const source = await getSummaryRows(f.clientId, false);
  const allRows = engine.enrichRows_(source.rows);
  const processRows = engine.applyFiltersToEnriched_(allRows, { ...f, agent: '' });
  const selectedAgent = String(agentName || '').trim();
  const rows = processRows.filter((row) => row.AgentName === selectedAgent);
  const mappings = await getMappings(f.clientId);
  const analyst = engine.buildSingleAnalyst_(selectedAgent, rows, mappings);

  return {
    analyst,
    summary: engine.buildSummary_(rows),
    processSummary: engine.buildSummary_(processRows),
    sales: engine.buildSales_(rows),
    quality: engine.buildQuality_(rows),
    compliance: engine.buildCompliance_(rows),
    actions: engine.buildActions_(rows, mappings).slice(0, 40),
    calls: rows.slice().sort(engine.sortNewest_).slice(0, 50).map(engine.lightRecord_),
    performance: { sqlQueryMs: source.queryMs, cacheHit: source.cacheHit }
  };
}

async function getCallDetail(callId, clientId) {
  const started = Date.now();
  const id = String(callId || '').trim();
  const client = String(clientId || config.defaultClientId).trim();
  if (!id) throw new Error('Call ID is required.');

  const query = await repository.fetchCallDetail(client, id);
  if (!query.row) throw new Error('Selected call was not found.');

  const row = engine.enrich_(query.row);
  const trace = engine.buildDetailedEvidencePackage_(row);
  const detail = engine.lightRecord_(row);
  detail.qualityBreakup = row.FeedbackContext;
  detail.pitchEvidence = row.PrepaidPitchContext;
  detail.offerEvidence = row.OfferedPitchContext;
  detail.objectionEvidence = row.ObjectionHandlingContext;
  detail.sensitiveEvidence = row.SensitiveWordContext;
  detail.auditInsight = row.Feedback;
  detail.actionRecommendation = row.AreaForImprovement;
  detail.pricingEvidence = row.Sale_Pitch_Discount_Structure;
  detail.parameterEvidence = trace.parameterEvidence;
  detail.evidenceHighlights = trace.highlights;
  detail.highlightRanges = trace.highlightRanges;
  detail.evidenceEngineVersion = 'Node API Pool V1.0 Exact Range Evidence';
  detail.evidenceHighlightCount = trace.highlightRanges.length;
  detail.parameterTraceCount = trace.parameterEvidence.length;
  detail.classificationReason = engine.buildClassificationReason_(row, trace);
  detail.highlightInstruction = 'Only exact transcript wording that supports an audit decision is highlighted. Where marks were lost because a required behaviour was absent, the trace states Not evidenced and no false highlight is applied.';
  detail.transcript = engine.maskTranscriptPreservePositions_(row.TranscribeText);

  return {
    source: 'Node API Pool — Call Detail Evidence',
    record: detail,
    performance: { detailSqlMs: query.elapsedMs, totalApiMs: Date.now() - started }
  };
}

function invalidateClientCache(clientId) {
  summaryCache.delete(String(clientId || config.defaultClientId));
}

module.exports = {
  getDashboard,
  getCallsForInsight,
  getCallExplorer,
  getAnalystCockpit,
  getCallDetail,
  invalidateClientCache
};
