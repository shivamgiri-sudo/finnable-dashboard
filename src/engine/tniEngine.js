'use strict';

const PARAM_NAMES = ['Opening', 'Discovery', 'Pitch', 'Journey', 'Objection', 'Compliance', 'Closing'];

function parseParameterScores(context) {
  const result = {};
  String(context || '').split('|').forEach(part => {
    const m = part.match(/^\s*([^:]+):\s*(NA|(\d+)\s*\/\s*(\d+))/i);
    if (!m) return;
    const name = m[1].trim();
    if (String(m[2]).toUpperCase() === 'NA') {
      result[name] = { score: null, max: null, pct: null };
    } else {
      const score = Number(m[3]), max = Number(m[4]);
      result[name] = { score, max, pct: max > 0 ? Math.round(score / max * 100) : null };
    }
  });
  return result;
}

function buildParameterHeatmap(rows) {
  const params = {};
  (rows || []).forEach(r => {
    const scores = parseParameterScores(r.FeedbackContext);
    PARAM_NAMES.forEach(name => {
      if (!params[name]) params[name] = { name, total: 0, scored: 0, sumPct: 0, low: 0, zero: 0 };
      const p = scores[name];
      params[name].total++;
      if (p && p.pct !== null) {
        params[name].scored++;
        params[name].sumPct += p.pct;
        if (p.pct < 70) params[name].low++;
        if (p.pct === 0) params[name].zero++;
      }
    });
  });
  return Object.values(params).map(p => ({
    name: p.name,
    avgPct: p.scored > 0 ? Math.round(p.sumPct / p.scored * 10) / 10 : null,
    scoredCalls: p.scored,
    lowPctCalls: p.low,
    zeroCalls: p.zero,
    failRate: p.scored > 0 ? Math.round(p.low / p.scored * 100) : null
  })).sort((a, b) => (a.avgPct || 100) - (b.avgPct || 100));
}

function tniPriority(fatalCount, defectCount) {
  if (fatalCount > 0) return 'Critical';
  if (defectCount >= 3) return 'High';
  if (defectCount === 2) return 'Medium';
  return 'Low';
}

function buildTNI(rows) {
  const grouped = {};
  (rows || []).forEach(r => {
    const cat = String(r.Category || '').trim();
    const sub = String(r.SubCategory || '').trim();
    const agent = String(r.AgentName || '').trim();
    const isFatal = ['Critical', 'High'].includes(String(r.Snapmint_Pitch || ''));
    const key = `${agent}||${cat}||${sub}`;
    if (!grouped[key]) grouped[key] = {
      agentName: agent, category: cat, subCategory: sub,
      defectCount: 0, fatalCount: 0,
      coachingNeed: String(r.AreaForImprovement || '').trim() || 'Review required',
      lastDate: r.CallDate
    };
    grouped[key].defectCount++;
    if (isFatal) grouped[key].fatalCount++;
    if (String(r.CallDate || '') > String(grouped[key].lastDate || '')) {
      grouped[key].lastDate = r.CallDate;
      if (r.AreaForImprovement) grouped[key].coachingNeed = String(r.AreaForImprovement).trim();
    }
  });

  return Object.values(grouped)
    .filter(g => g.defectCount > 0 && g.category)
    .map(g => ({
      agentName: g.agentName,
      category: g.category,
      subCategory: g.subCategory,
      defectCount: g.defectCount,
      fatalCount: g.fatalCount,
      priority: tniPriority(g.fatalCount, g.defectCount),
      coachingNeed: g.coachingNeed,
      lastDate: String(g.lastDate || '').slice(0, 10)
    }))
    .sort((a, b) => {
      const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
      return (rank[a.priority] || 9) - (rank[b.priority] || 9) || b.defectCount - a.defectCount;
    });
}

function buildProcessTNI(tniRows) {
  const grouped = {};
  (tniRows || []).forEach(r => {
    const key = `${r.category}||${r.subCategory}`;
    if (!grouped[key]) grouped[key] = { category: r.category, subCategory: r.subCategory, defectCount: 0, fatalCount: 0, agents: new Set(), lastDate: '' };
    grouped[key].defectCount += r.defectCount;
    grouped[key].fatalCount += r.fatalCount;
    grouped[key].agents.add(r.agentName);
    if (r.lastDate > grouped[key].lastDate) grouped[key].lastDate = r.lastDate;
  });
  return Object.values(grouped).map(g => ({
    category: g.category,
    subCategory: g.subCategory,
    defectCount: g.defectCount,
    fatalCount: g.fatalCount,
    affectedAnalysts: g.agents.size,
    priority: tniPriority(g.fatalCount, g.defectCount),
    lastDate: g.lastDate
  })).sort((a, b) => b.defectCount - a.defectCount);
}

module.exports = { parseParameterScores, buildParameterHeatmap, buildTNI, buildProcessTNI, tniPriority };
