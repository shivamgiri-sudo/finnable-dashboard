'use strict';

/**
 * Preserved Finnable Sales & Quality Intelligence calculation/evidence engine.
 * Ported from the working Apps Script V5.3.7 backend without changing scoring,
 * evidence-range, risk bucket, leakage, action, KPI or transcript-mask logic.
 */
const DEFAULT_CLIENT_ID = process.env.DEFAULT_CLIENT_ID || '497';

function cleanFilters_(filters) {
  const f = filters || {};
  return {
    clientId: String(f.clientId || DEFAULT_CLIENT_ID).trim(),
    recordId: String(f.recordId || '').trim(),
    fromDate: String(f.fromDate || '').trim(),
    toDate: String(f.toDate || '').trim(),
    agent: String(f.agent || '').trim(),
    callType: String(f.callType || '').trim(),
    journeyStage: String(f.journeyStage || '').trim(),
    pitchStrength: String(f.pitchStrength || '').trim(),
    riskBucket: String(f.riskBucket || '').trim(),
    actionPriority: String(f.actionPriority || '').trim(),
    search: String(f.search || '').trim().toLowerCase()
  };
}

function applyFiltersToEnriched_(enrichedRows, filters) {
  const f = cleanFilters_(filters);
  return (enrichedRows || []).filter(function(row) {
    if (f.clientId && row.client_id !== f.clientId) return false;
    if (f.recordId && row.id !== f.recordId) return false;
    if (f.agent && row.AgentName !== f.agent) return false;
    if (f.callType && row.callType !== f.callType) return false;
    if (f.journeyStage && row.journeyStage !== f.journeyStage) return false;
    if (f.pitchStrength && row.pitchStrength !== f.pitchStrength) return false;
    if (f.riskBucket && row.riskBucket !== f.riskBucket) return false;
    if (f.actionPriority && row.action.priority !== f.actionPriority) return false;
    const date = parseDate_(row.CallDate);
    if (f.fromDate && date && date < new Date(f.fromDate + 'T00:00:00')) return false;
    if (f.toDate && date && date > new Date(f.toDate + 'T23:59:59')) return false;
    if (f.search) {
      const target = [row.id, row.AgentName, row.Feedback, row.Category, row.SubCategory, row.callType, row.journeyStage].join(' ').toLowerCase();
      if (target.indexOf(f.search) < 0) return false;
    }
    return true;
  });
}

function enrichRows_(rawRows) {
  return (rawRows || []).map(enrich_);
}

function filterEnrichedRows_(rawRows, filters) {
  return applyFiltersToEnriched_(enrichRows_(rawRows), filters);
}

function insightMatches_(row, dimension, value) {
  if (!dimension) return true;
  if (dimension === 'risk') return row.riskBucket === value;
  if (dimension === 'leakage') return row.salesLeakage === value;
  if (dimension === 'journey') return row.journeyStage === value;
  if (dimension === 'support') return row.supportStatus === value;
  if (dimension === 'callType') return row.callType === value;
  if (dimension === 'pitch') return row.pitchStrength === value;
  if (dimension === 'qualityType') return row.callType === value;
  if (dimension === 'action') return row.action.priority === value;
  if (dimension === 'funnel') {
    if (value === 'Sales / Mixed Opportunities') return row.opportunity;
    if (value === 'Pitch Attempted') return row.opportunity && row.PrepaidPitch === '1';
    if (value === 'Strong Pitch') return row.opportunity && row.pitchStrength === 'Strong';
    if (value === 'Customer Progressed') return row.opportunity && row.progressed;
    if (value === 'Disbursal Signal') return row.opportunity && row.disbursal;
  }
  return true;
}

function drilldownTitle_(dimension, value) {
  if (!dimension) return 'All Filtered Calls';
  const prefixes = {
    risk: 'Risk Evidence',
    leakage: 'Sales Leakage Evidence',
    journey: 'Journey Stage Evidence',
    support: 'Support Status Evidence',
    callType: 'Call Type Evidence',
    pitch: 'Pitch Strength Evidence',
    qualityType: 'Quality Cohort Evidence',
    action: 'Action Queue Evidence',
    funnel: 'Funnel Stage Evidence'
  };
  return (prefixes[dimension] || 'Evidence') + ': ' + value;
}

/* ------------------------ Derivation logic ------------------------------ */

function enrich_(raw) {
  const row = Object.assign({}, raw);
  row.id = String(row.id || '').trim();
  row.callType = value_(row.ConsumptionType);
  row.journeyStage = value_(row.AgeofConsumption);
  row.pitchStrength = value_(row.UpsellingEfforts);
  row.score = numeric_(row.Feedback_Category);
  row.nonAssessable = row.callType === 'No Meaningful Interaction';
  row.qualityBand = qualityBand_(row);
  row.opportunity = ['Sales', 'Mixed'].indexOf(row.callType) >= 0;
  row.progressed = ['Interested But Pending', 'Application In Progress', 'Application Completed - Verification Pending', 'Customer Agreed To Proceed'].indexOf(row.CallDisposition) >= 0;
  row.disbursal = row.SaleDone === '1';
  row.riskBucket = riskBucket_(row);
  row.supportStatus = value_(row.Further_Assistance);
  row.salesLeakage = salesLeakage_(row);
  // Transcript evidence is calculated only after an authorised call-detail click.
  // Summary/KPI reads intentionally omit transcripts for SQL safety and performance.
  row.evidenceHighlights = row.TranscribeText && row.TranscribeText !== 'None' ? buildEvidenceHighlights_(row) : [];
  row.action = actionFor_(row);
  return row;
}

function numeric_(value) {
  const text = String(value || '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

function qualityBand_(row) {
  if (row.nonAssessable) return 'Non-Assessable';
  if (row.score === null) return 'Limited Evidence';
  if (row.score >= 90) return 'Excellent';
  if (row.score >= 80) return 'Good';
  if (row.score >= 70) return 'Improvement Required';
  if (row.score >= 60) return 'High Risk';
  return 'Critical Coaching';
}

function riskBucket_(row) {
  if (row.Snapmint_Pitch === 'Critical') return 'Confirmed Critical Violation';
  if (row.Snapmint_Pitch === 'High') return 'High Priority Risk Trigger';
  if (row.Snapmint_Pitch === 'Medium') return 'Medium Transparency / Sensitive Flag';
  if (/Self-Entry Guidance|Safe OTP/i.test(String(row.SensitiveWordUsed || ''))) return 'Safe / Guided Self-Entry';
  return 'No Risk Flag';
}

function salesLeakage_(row) {
  if (!row.opportunity) return 'Not Applicable';
  if (row.PrepaidPitch !== '1') return 'No Pitch Attempted';
  if (row.pitchStrength === 'Weak') return 'Weak Pitch';
  if (['Potentially Misleading', 'Incorrect or Unsafe', 'Partial Disclosure', 'Not Discussed'].indexOf(row.Pricing_and_Discount_Structure) >= 0) return 'Pricing Disclosure Gap';
  if (row.CustomerObjectionCategory !== 'None' && row.ObjectionHandling !== '1') return 'Objection Not Resolved';
  if (['Support Pending', 'Callback Required', 'Escalation Required'].indexOf(row.Further_Assistance) >= 0) return 'Journey Blocker';
  if (row.Order_Consent !== '1' && !row.progressed && !row.disbursal) return 'Consent Gap';
  if (['Weak Closing', 'Missing Closing', 'Misleading Closing'].indexOf(row.Call_Closing) >= 0) return 'Closing Gap';
  return 'No Major Leakage';
}

function actionFor_(row) {
  if (row.riskBucket === 'Confirmed Critical Violation') return {priority: 'P1 Confirmed', owner: 'Compliance | QA', sla: 'Same Day', reason: row.SensitiveWordUsed};
  if (row.riskBucket === 'High Priority Risk Trigger') return {priority: 'P1 Validate', owner: 'QA | Compliance', sla: 'Same Day', reason: row.SensitiveWordUsed};
  if (row.riskBucket === 'Medium Transparency / Sensitive Flag') return {priority: 'P2 Coach / Validate', owner: 'QA | TL', sla: '24 Hours', reason: row.SensitiveWordUsed};
  if (row.opportunity && ['No Pitch Attempted', 'Weak Pitch', 'Pricing Disclosure Gap'].indexOf(row.salesLeakage) >= 0) return {priority: 'P3 Sales Coaching', owner: 'TL | Sales Trainer', sla: '48 Hours', reason: row.salesLeakage};
  if (['Support Pending', 'Callback Required', 'Escalation Required'].indexOf(row.supportStatus) >= 0) return {priority: 'P3 Journey Follow-Up', owner: 'Process Owner | TL', sla: '48 Hours', reason: row.supportStatus};
  return {priority: 'Monitor', owner: 'TL', sla: 'Weekly Review', reason: 'No immediate action trigger'};
}

function buildEvidenceHighlights_(row) {
  // Compact list/table view helper. The detail drawer uses the richer V5.3 package.
  return buildDetailedEvidencePackage_(row).highlights.slice(0, 4);
}

function buildDetailedEvidencePackage_(row) {
  const text = String(row.TranscribeText || '');
  const scores = parseParameterScores_(row.FeedbackContext);
  const parameterEvidence = [];
  const highlights = [];
  const seenRanges = {};

  function scoreOf(parameter) {
    return scores[parameter] || {score: null, max: null, display: 'NA', loss: null};
  }

  function addObserved(parameter, severity, title, rationale, regexes, auditImpact) {
    const item = findTranscriptMatch_(text, regexes);
    const score = scoreOf(parameter);
    if (item) {
      const key = item.start + ':' + item.end + ':' + parameter;
      if (!seenRanges[key]) {
        seenRanges[key] = true;
        highlights.push({
          parameter: parameter,
          severity: severity,
          label: title,
          rationale: rationale,
          auditImpact: auditImpact || '',
          phrase: item.phrase,
          snippet: item.snippet,
          start: item.start,
          end: item.end,
          score: score.display,
          marksLost: score.loss
        });
      }
      parameterEvidence.push({
        parameter: parameter,
        score: score.display,
        marksLost: score.loss,
        status: 'Observed evidence',
        severity: severity,
        title: title,
        rationale: rationale,
        evidence: item.snippet,
        highlightStart: item.start,
        highlightEnd: item.end
      });
      return true;
    }
    return false;
  }

  function addNotEvidenced(parameter, severity, title, rationale) {
    const score = scoreOf(parameter);
    parameterEvidence.push({
      parameter: parameter,
      score: score.display,
      marksLost: score.loss,
      status: 'Not evidenced in transcript',
      severity: severity,
      title: title,
      rationale: rationale,
      evidence: 'No exact customer-facing phrase proving this required behaviour was found in the transcript.',
      highlightStart: null,
      highlightEnd: null
    });
  }

  // Compliance / transparency evidence: highest priority trace.
  if (row.riskBucket === 'High Priority Risk Trigger' || /OTP Request Phrase/i.test(String(row.SensitiveWordUsed || ''))) {
    addObserved(
      'Compliance', 'high', 'Credential request phrase detected',
      'A request for the customer OTP is a high-priority trigger requiring same-day validation. The dashboard does not call it a confirmed breach until validated.',
      [
        /how may i have your otp/i,
        /share\s+(?:me\s+)?(?:your\s+|the\s+)?otp/i,
        /tell\s+(?:me\s+)?(?:your\s+|the\s+)?otp/i,
        /provide\s+(?:me\s+)?(?:your\s+|the\s+)?otp/i
      ],
      'Risk trigger'
    );
  }
  if (/Ambiguous OTP Guidance/i.test(String(row.SensitiveWordUsed || ''))) {
    addObserved(
      'Compliance', 'medium', 'Ambiguous OTP guidance',
      'The wording around OTP handling requires validation and coaching because it may be interpreted as asking the customer to disclose a credential.',
      [/give\s+the\s+(?:o\s*t\s*p|otp)\s+and\s+fill\s+the\s+(?:o\s*t\s*p|otp)/i],
      'Sensitive guidance flag'
    );
  }
  if (/Timeline Assurance|Timeline Promise/i.test(String(row.SensitiveWordUsed || ''))) {
    addObserved(
      'Compliance', 'medium', 'Outcome timeline assurance',
      'A disbursal or credit timeline is communicated before actual outcome confirmation. This is a transparency mark-down, not conversion evidence.',
      [
        /(?:within|in)\s+(?:twenty[\s-]*four|24)\s+hours[^.?!]{0,120}/i,
        /(?:loan|disburs\w*|credit\w*)[^.?!]{0,80}(?:within|in)\s+(?:twenty[\s-]*four|24)\s+hours/i
      ],
      'Transparency mark-down'
    );
  }
  if (/Approval/i.test(String(row.SensitiveWordUsed || ''))) {
    addObserved(
      'Compliance',
      row.Snapmint_Pitch === 'High' ? 'high' : 'medium',
      'Approval language used',
      'Approval wording is highlighted because it must match the customer stage and approved process script.',
      [
        /loan\s+has\s+been\s+(?:system\s+)?approved/i,
        /loan\s+has\s+this\s+system\s+approved/i,
        /pre[\s-]?approved/i,
        /system\s+approved/i
      ],
      'Transparency observation'
    );
  }
  if (/Self-Entry Guidance|Payment Credential/i.test(String(row.SensitiveWordUsed || ''))) {
    addObserved(
      'Compliance', 'safe', 'Customer self-entry guidance',
      'This evidence shows credential-entry guidance in the journey. It is not a confirmed credential violation unless the analyst asks the customer to share the credential.',
      [
        /debit\s+card\s+number[^.?!]{0,100}cvv/i,
        /user\s+id\s+and\s+password/i,
        /verify[^.?!]{0,80}(?:otp|o\s*t\s*p)/i,
        /security\s+pin/i
      ],
      'Context only'
    );
  }

  // Pitch mark-down trace.
  if (row.opportunity) {
    if (row.PrepaidPitch !== '1' || row.pitchStrength === 'Not Attempted') {
      addNotEvidenced('Pitch', 'medium', 'No persuasive sales pitch evidenced',
        'A Sales/Mixed opportunity exists, but no value-based pitch was identified for the customer.');
    } else if (row.pitchStrength === 'Weak') {
      if (!addObserved(
        'Pitch', 'medium', 'Weak pitch evidence',
        'The conversation references a loan/approval or application step, but does not evidence a complete benefit-led sales pitch.',
        [
          /loan\s+has\s+been\s+(?:system\s+)?approved[^.?!]{0,100}/i,
          /pre[\s-]?approved[^.?!]{0,100}/i,
          /system\s+approved[^.?!]{0,100}/i,
          /personal\s+loan[^.?!]{0,110}/i
        ],
        'Pitch mark-down'
      )) {
        addNotEvidenced('Pitch', 'medium', 'Weak pitch evidence',
          'The pitch score is low and no clear customer-relevant benefit statement can be traced in the transcript.');
      }
    } else if (row.pitchStrength === 'Average' && scoreOf('Pitch').score !== null && scoreOf('Pitch').score < scoreOf('Pitch').max) {
      if (!addObserved(
        'Pitch', 'info', 'Partial pitch evidence',
        'A product offer or loan benefit is discussed, but the pitch is incomplete against the full sales standard.',
        [
          /(?:approved|pre[\s-]?approved)[^.?!]{0,100}/i,
          /(?:loan|amount|interest|emi)[^.?!]{0,100}/i
        ],
        'Partial pitch mark-down'
      )) {
        addNotEvidenced('Pitch', 'info', 'Partial pitch evidence',
          'A pitch is recorded but the transcript does not evidence all elements required for a strong pitch.');
      }
    }

    // Pricing is separately traceable from pitch.
    if (['Not Discussed', 'Partial Disclosure', 'Potentially Misleading', 'Incorrect or Unsafe'].indexOf(row.Pricing_and_Discount_Structure) >= 0) {
      const foundPricing = addObserved(
        'Pitch',
        row.Pricing_and_Discount_Structure === 'Potentially Misleading' ? 'high' : 'medium',
        'Pricing transparency gap',
        'The pricing/term wording is incomplete or requires review against the approved disclosure standard.',
        [
          /\b(?:interest|rate|roi)\b[^.?!]{0,100}/i,
          /\b(?:emi|e\s*m\s*i)\b[^.?!]{0,100}/i,
          /\b(?:processing\s+fee|charges?|insurance|tenure)\b[^.?!]{0,100}/i
        ],
        'Pricing mark-down'
      );
      if (!foundPricing && row.Pricing_and_Discount_Structure === 'Not Discussed') {
        addNotEvidenced('Pitch', 'medium', 'Pricing not discussed',
          'No exact rate, EMI, tenure, charges or pricing disclosure statement was identified in a selling opportunity.');
      }
    }
  }

  // Journey / support deductions.
  if (['Support Pending', 'Callback Required', 'Escalation Required'].indexOf(row.supportStatus) >= 0) {
    if (!addObserved(
      'Journey', 'medium', 'Pending customer journey action',
      'The customer journey remains dependent on a callback, verification or unresolved assistance step.',
      [
        /call\s*back[^.?!]{0,100}/i,
        /verification[^.?!]{0,100}/i,
        /pending[^.?!]{0,100}/i,
        /will\s+call[^.?!]{0,100}/i,
        /loan\s+manager[^.?!]{0,100}/i
      ],
      'Journey support mark-down'
    )) {
      addNotEvidenced('Journey', 'medium', 'Pending customer journey action',
        'The audit disposition reports pending support/callback, but no precise transcript phrase could be isolated.');
    }
  }

  // Objection handling deductions only for an actual objection.
  if (row.CustomerObjectionCategory !== 'None') {
    const objectionRegexes = objectionPatterns_(row.CustomerObjectionSubCategory);
    const objectionFound = addObserved(
      'Objection', row.ObjectionHandling === '1' ? 'info' : 'medium',
      row.ObjectionHandling === '1' ? 'Customer objection handled' : 'Unresolved customer objection',
      row.ObjectionHandling === '1'
        ? 'The customer concern is evidenced and handling is recorded.'
        : 'The customer concern is evidenced but no satisfactory rebuttal is recorded.',
      objectionRegexes,
      row.ObjectionHandling === '1' ? 'Objection evidence' : 'Objection mark-down'
    );
    if (!objectionFound) {
      addNotEvidenced('Objection', 'medium', 'Objection categorised without locatable phrase',
        'The objection field is populated, but the exact matching phrase should be rechecked in the source transcript.');
    }
  }

  // Opening / discovery / closing absence should be reported honestly, not highlighted falsely.
  if (scoreOf('Opening').score !== null && scoreOf('Opening').score <= 5) {
    const startExcerpt = text.slice(0, Math.min(text.length, 150));
    if (startExcerpt) {
      const firstRange = {phrase: startExcerpt, start: 0, end: startExcerpt.length, snippet: cleanSpaces_(startExcerpt)};
      highlights.push({
        parameter: 'Opening', severity: 'medium', label: 'Opening control gap',
        rationale: 'The opening score is low; the opening transcript section is shown for calibration.',
        auditImpact: 'Opening mark-down', phrase: firstRange.phrase, snippet: firstRange.snippet,
        start: firstRange.start, end: firstRange.end, score: scoreOf('Opening').display, marksLost: scoreOf('Opening').loss
      });
      parameterEvidence.push({
        parameter: 'Opening', score: scoreOf('Opening').display, marksLost: scoreOf('Opening').loss,
        status: 'Observed opening excerpt', severity: 'medium', title: 'Opening control gap',
        rationale: 'The opening score is low; review the highlighted opening segment.',
        evidence: firstRange.snippet, highlightStart: firstRange.start, highlightEnd: firstRange.end
      });
    }
  }
  if (scoreOf('Discovery').score !== null && scoreOf('Discovery').score <= 5 && row.opportunity) {
    addNotEvidenced('Discovery', 'medium', 'Customer need discovery not sufficiently evidenced',
      'The selling interaction does not evidence complete discovery of the customer need, requirement or affordability context.');
  }
  if (scoreOf('Closing').score !== null && scoreOf('Closing').score <= 5) {
    if (!addObserved(
      'Closing', 'medium', 'Weak or incomplete closure',
      'The end of the interaction does not establish a clear, accurate next step or closure standard.',
      [
        /call\s*back[^.?!]{0,100}/i,
        /will\s+call[^.?!]{0,100}/i,
        /thank\s+you[^.?!]{0,80}/i,
        /within\s+(?:twenty[\s-]*four|24)\s+hours[^.?!]{0,100}/i
      ],
      'Closing mark-down'
    )) {
      addNotEvidenced('Closing', 'medium', 'Closure not evidenced',
        'No clear next-step confirmation or accurate closure statement was found.');
    }
  }

  const priority = {high: 1, medium: 2, safe: 3, info: 4};
  highlights.sort(function(a, b) {
    return a.start - b.start || (priority[a.severity] || 9) - (priority[b.severity] || 9);
  });
  const usableRanges = removeOverlappingHighlights_(highlights);
  parameterEvidence.sort(function(a, b) {
    return (priority[a.severity] || 9) - (priority[b.severity] || 9);
  });
  return {
    parameterEvidence: dedupeParameterEvidence_(parameterEvidence),
    highlights: usableRanges,
    highlightRanges: usableRanges.map(function(item) {
      return {
        start: item.start,
        end: item.end,
        severity: item.severity,
        parameter: item.parameter,
        label: item.label,
        rationale: item.rationale
      };
    })
  };
}

function parseParameterScores_(context) {
  const result = {};
  String(context || '').split('|').forEach(function(part) {
    const match = part.match(/^\s*([^:]+):\s*(NA|(\d+)\s*\/\s*(\d+))/i);
    if (!match) return;
    const name = match[1].trim();
    if (String(match[2]).toUpperCase() === 'NA') {
      result[name] = {score: null, max: null, display: 'NA', loss: null};
    } else {
      const score = Number(match[3]), max = Number(match[4]);
      result[name] = {score: score, max: max, display: score + '/' + max, loss: max - score};
    }
  });
  return result;
}

function findTranscriptMatch_(text, regexes) {
  for (let i = 0; i < regexes.length; i++) {
    const match = text.match(regexes[i]);
    if (match && typeof match.index === 'number') {
      return {
        phrase: match[0],
        start: match.index,
        end: match.index + match[0].length,
        snippet: snippetAround_(text, match.index, match[0].length)
      };
    }
  }
  return null;
}

function objectionPatterns_(subcategory) {
  const text = String(subcategory || '').toLowerCase();
  if (/insurance/.test(text)) return [/insurance[^.?!]{0,130}/i, /without\s+insurance[^.?!]{0,100}/i];
  if (/processing|fee|charge/.test(text)) return [/(?:processing\s+fee|charges?)[^.?!]{0,120}/i];
  if (/trust|fraud|fake/.test(text)) return [/(?:trust|fraud|fake|scam)[^.?!]{0,120}/i];
  if (/not\s+interested|no\s+loan|no\s+requirement/.test(text)) return [/(?:not\s+interested|do\s+not\s+need|don't\s+need|no\s+requirement)[^.?!]{0,120}/i];
  if (/salary|cash/.test(text)) return [/(?:salary|cash|bank\s+account)[^.?!]{0,130}/i];
  return [/(?:not\s+interested|insurance|charges?|salary|cash|trust|problem|issue)[^.?!]{0,120}/i];
}

function removeOverlappingHighlights_(items) {
  const selected = [];
  const rank = {high: 1, medium: 2, safe: 3, info: 4};
  items.slice().sort(function(a, b) {
    return (rank[a.severity] || 9) - (rank[b.severity] || 9) || a.start - b.start;
  }).forEach(function(item) {
    const overlaps = selected.some(function(chosen) {
      return item.start < chosen.end && item.end > chosen.start;
    });
    if (!overlaps) selected.push(item);
  });
  return selected.sort(function(a, b) { return a.start - b.start; });
}

function dedupeParameterEvidence_(items) {
  const output = [];
  const seen = {};
  items.forEach(function(item) {
    const key = item.parameter + '|' + item.title + '|' + item.status;
    if (!seen[key]) {
      seen[key] = true;
      output.push(item);
    }
  });
  return output;
}

function snippetAround_(text, start, length) {
  const from = Math.max(0, start - 95);
  const to = Math.min(text.length, start + length + 175);
  return cleanSpaces_(text.slice(from, to));
}

function buildClassificationReason_(row, trace) {
  if (row.nonAssessable) return 'No meaningful two-way interaction is available for behavioural scoring.';
  if (row.riskBucket === 'High Priority Risk Trigger') return 'A high-priority transcript phrase is evidenced and requires same-day validation; the dashboard does not present it as a confirmed breach without validation.';
  if (row.riskBucket === 'Medium Transparency / Sensitive Flag') return 'A transparency or sensitive-guidance concern is supported by transcript evidence and has been linked to the impacted audit parameter.';
  if (row.riskBucket === 'Safe / Guided Self-Entry') return 'The customer is guided to enter details in the journey; no credential-sharing breach is claimed.';
  if (row.salesLeakage !== 'Not Applicable' && row.salesLeakage !== 'No Major Leakage') return 'This selling opportunity contains a measurable leakage point: ' + row.salesLeakage + '. The mark-down trace distinguishes observed wording from missing expected behaviour.';
  return 'Audit output populated from the V5.3 evidence-trace rules.';
}

/* ------------------------------ Summaries ------------------------------ */

function buildSummary_(rows) {
  const meaningful = rows.filter(function(r) { return !r.nonAssessable; });
  const scored = rows.filter(function(r) { return r.score !== null; });
  const opportunities = rows.filter(function(r) { return r.opportunity; });
  const pitched = opportunities.filter(function(r) { return r.PrepaidPitch === '1'; });
  const salesMixedScored = rows.filter(function(r) { return r.opportunity && r.score !== null; });
  const supportScored = rows.filter(function(r) { return r.callType === 'Support' && r.score !== null; });
  const objections = rows.filter(function(r) { return r.CustomerObjectionCategory !== 'None'; });
  return {
    totalCalls: rows.length,
    nonAssessable: rows.filter(function(r) { return r.nonAssessable; }).length,
    meaningfulCalls: meaningful.length,
    qualityScoredCalls: scored.length,
    avgQuality: averageScore_(scored),
    salesMixedAvgQuality: averageScore_(salesMixedScored),
    supportAvgQuality: averageScore_(supportScored),
    opportunities: opportunities.length,
    pitched: pitched.length,
    pitchAttemptRate: percent_(pitched.length, opportunities.length),
    strongPitch: opportunities.filter(function(r) { return r.pitchStrength === 'Strong'; }).length,
    objections: objections.length,
    objectionHandled: objections.filter(function(r) { return r.ObjectionHandling === '1'; }).length,
    highRiskTriggers: rows.filter(function(r) { return r.riskBucket === 'High Priority Risk Trigger'; }).length,
    mediumFlags: rows.filter(function(r) { return r.riskBucket === 'Medium Transparency / Sensitive Flag'; }).length,
    criticalConfirmed: rows.filter(function(r) { return r.riskBucket === 'Confirmed Critical Violation'; }).length,
    disbursalSignal: rows.filter(function(r) { return r.disbursal; }).length
  };
}

function buildSales_(rows) {
  const opportunities = rows.filter(function(r) { return r.opportunity; });
  return {
    funnel: [
      countItem_('Sales / Mixed Opportunities', opportunities.length),
      countItem_('Pitch Attempted', opportunities.filter(function(r) { return r.PrepaidPitch === '1'; }).length),
      countItem_('Strong Pitch', opportunities.filter(function(r) { return r.pitchStrength === 'Strong'; }).length),
      countItem_('Customer Progressed', opportunities.filter(function(r) { return r.progressed; }).length),
      countItem_('Disbursal Signal', opportunities.filter(function(r) { return r.disbursal; }).length)
    ],
    pitchStrength: countByList_(opportunities, 'pitchStrength'),
    leakage: countByList_(opportunities, 'salesLeakage'),
    pricing: countByList_(opportunities, 'Pricing_and_Discount_Structure'),
    objections: countByList_(opportunities.filter(function(r) { return r.CustomerObjectionSubCategory !== 'None'; }), 'CustomerObjectionSubCategory'),
    themes: buildThemes_(opportunities)
  };
}

function buildThemes_(rows) {
  const grouped = {};
  rows.forEach(function(row) {
    String(row.Product_Appreciation || '').split('|').forEach(function(theme) {
      theme = value_(theme);
      if (theme === 'None') return;
      if (!grouped[theme]) grouped[theme] = [];
      grouped[theme].push(row);
    });
  });
  return Object.keys(grouped).map(function(theme) {
    const records = grouped[theme];
    return {
      label: theme,
      count: records.length,
      avgQuality: averageScore_(records.filter(function(r) { return r.score !== null; })),
      progressionRate: percent_(records.filter(function(r) { return r.progressed; }).length, records.length),
      riskCount: records.filter(function(r) { return ['High Priority Risk Trigger', 'Medium Transparency / Sensitive Flag'].indexOf(r.riskBucket) >= 0; }).length
    };
  }).sort(function(a, b) { return b.count - a.count; });
}

function buildJourney_(rows) {
  const pending = rows.filter(function(r) { return ['Support Pending', 'Callback Required', 'Escalation Required'].indexOf(r.supportStatus) >= 0; });
  return {
    callTypes: countByList_(rows, 'callType'),
    stages: countByList_(rows.filter(function(r) { return r.journeyStage !== 'None'; }), 'journeyStage'),
    supportStatuses: countByList_(rows, 'supportStatus'),
    pendingCount: pending.length,
    pendingCalls: pending.slice().sort(sortNewest_).slice(0, 40).map(lightRecord_)
  };
}

function buildQuality_(rows) {
  const parameterNames = ['Opening', 'Discovery', 'Pitch', 'Journey', 'Objection', 'Compliance', 'Closing'];
  const params = parameterNames.map(function(name) {
    const percentages = [];
    rows.forEach(function(row) {
      const value = parseParameter_(row.FeedbackContext, name);
      if (value) percentages.push((value.score / value.max) * 100);
    });
    return {label: name, average: average_(percentages), assessedCalls: percentages.length};
  });
  return {
    bands: countByList_(rows, 'qualityBand'),
    byCallType: ['Sales', 'Mixed', 'Support', 'Verification Follow-Up'].map(function(callType) {
      const records = rows.filter(function(r) { return r.callType === callType && r.score !== null; });
      return {label: callType, average: averageScore_(records), scoredCalls: records.length};
    }),
    parameters: params.sort(function(a, b) { return a.average - b.average; })
  };
}

function buildCompliance_(rows) {
  const riskRows = rows.filter(function(r) { return r.riskBucket !== 'No Risk Flag'; });
  return {
    buckets: countByList_(rows, 'riskBucket'),
    highPriority: riskRows.filter(function(r) { return r.riskBucket === 'High Priority Risk Trigger'; }).map(lightRecord_),
    medium: riskRows.filter(function(r) { return r.riskBucket === 'Medium Transparency / Sensitive Flag'; }).map(lightRecord_),
    evidenceQueue: riskRows.slice().sort(sortNewest_).map(lightRecord_)
  };
}

function buildActions_(rows, mappings) {
  return rows.filter(function(row) { return row.action.priority !== 'Monitor'; }).map(function(row) {
    const mapping = mappings[row.AgentName] || {};
    return {
      callId: row.id,
      callDate: row.CallDate,
      analyst: row.AgentName,
      tlName: mapping.tlName || 'TL Mapping Required',
      priority: row.action.priority,
      owner: mapping.tlName ? mapping.tlName + ' | ' + row.action.owner : row.action.owner,
      sla: row.action.sla,
      reason: row.action.reason,
      qualityScore: row.score === null ? 'N/A' : row.score,
      callType: row.callType,
      journeyStage: row.journeyStage,
      insight: row.Feedback
    };
  }).sort(function(a, b) {
    const rank = {'P1 Confirmed': 1, 'P1 Validate': 2, 'P2 Coach / Validate': 3, 'P3 Sales Coaching': 4, 'P3 Journey Follow-Up': 5};
    return (rank[a.priority] || 9) - (rank[b.priority] || 9);
  });
}

function buildAnalysts_(rows, mappings) {
  const grouped = {};
  rows.forEach(function(row) {
    if (!grouped[row.AgentName]) grouped[row.AgentName] = [];
    grouped[row.AgentName].push(row);
  });
  return Object.keys(grouped).map(function(agent) {
    return buildSingleAnalyst_(agent, grouped[agent], mappings);
  }).sort(function(a, b) {
    const rank = {'P1 Confirmed': 1, 'P1 Validate': 2, 'P2 Coach / Validate': 3, 'P3 Sales Coaching': 4, 'P3 Journey Follow-Up': 5, 'Monitor': 9};
    return (rank[a.priority] || 9) - (rank[b.priority] || 9) || a.avgQuality - b.avgQuality;
  });
}

function buildSingleAnalyst_(agent, rows, mappings) {
  const s = buildSummary_(rows);
  const mapping = mappings[agent] || {};
  const actions = buildActions_(rows, mappings);
  const leakage = countByList_(rows.filter(function(r) { return r.opportunity; }), 'salesLeakage');
  return {
    agentId: agent,
    analystName: mapping.analystName || agent,
    tlName: mapping.tlName || 'Not Mapped',
    teamName: mapping.teamName || 'Not Mapped',
    calls: rows.length,
    scoredCalls: s.qualityScoredCalls,
    avgQuality: s.avgQuality,
    salesMixedAvgQuality: s.salesMixedAvgQuality,
    opportunities: s.opportunities,
    pitchAttemptRate: s.pitchAttemptRate,
    strongPitch: s.strongPitch,
    highRiskTriggers: s.highRiskTriggers,
    mediumFlags: s.mediumFlags,
    primaryLeakage: leakage.length ? leakage[0].label : 'No Dominant Leakage',
    priority: actions.length ? actions[0].priority : 'Monitor'
  };
}

function buildCallouts_(summary, sales, journey, quality, compliance, analysts) {
  const output = [];
  output.push({
    severity: 'High',
    title: 'Sales pitch strength is the core capability gap',
    text: 'There are ' + summary.opportunities + ' Sales/Mixed opportunities and ' + summary.pitched + ' pitch attempts, but ' + summary.strongPitch + ' defensible strong pitches.'
  });
  output.push({
    severity: 'High',
    title: 'Overall quality must not mask sales quality',
    text: 'Overall average quality is ' + summary.avgQuality + ', while Sales/Mixed quality is ' + summary.salesMixedAvgQuality + ' compared with Support quality of ' + summary.supportAvgQuality + '.'
  });
  output.push({
    severity: 'High',
    title: 'Progression is not final conversion',
    text: 'Transcript-confirmed disbursal signals: ' + summary.disbursalSignal + '. Use operational outcome data for final conversion reporting.'
  });
  if (summary.highRiskTriggers || summary.mediumFlags) {
    output.push({
      severity: 'Critical',
      title: 'Evidence-based risk actions are pending',
      text: summary.highRiskTriggers + ' high-priority risk triggers and ' + summary.mediumFlags + ' medium transparency/sensitive flags require action.'
    });
  }
  if (journey.pendingCount) {
    output.push({
      severity: 'Medium',
      title: 'Journey follow-up queue exists',
      text: journey.pendingCount + ' interactions contain pending/callback/escalation support outcomes.'
    });
  }
  return output;
}

/* ------------------------------ Utilities ------------------------------ */

function buildFilterOptions_(rows) {
  return {
    agents: unique_(rows.map(function(r) { return r.AgentName; })),
    callTypes: unique_(rows.map(function(r) { return r.callType; })),
    journeyStages: unique_(rows.map(function(r) { return r.journeyStage; })),
    pitchStrengths: unique_(rows.map(function(r) { return r.pitchStrength; })),
    riskBuckets: unique_(rows.map(function(r) { return r.riskBucket; })),
    actionPriorities: unique_(rows.map(function(r) { return r.action.priority; }))
  };
}

function lightRecord_(row) {
  return {
    id: row.id,
    date: row.CallDate,
    analyst: row.AgentName,
    mobile: maskMobile_(row.MobileNo),
    callType: row.callType,
    journeyStage: row.journeyStage,
    qualityScore: row.score === null ? 'N/A' : row.score,
    qualityBand: row.qualityBand,
    pitchStrength: row.pitchStrength,
    leakage: row.salesLeakage,
    supportStatus: row.supportStatus,
    riskBucket: row.riskBucket,
    riskLevel: row.Snapmint_Pitch,
    progressed: row.progressed,
    disbursal: row.disbursal,
    actionPriority: row.action.priority,
    actionOwner: row.action.owner,
    actionSla: row.action.sla,
    insight: row.Feedback
  };
}

function countByList_(rows, field) {
  const counts = {};
  rows.forEach(function(row) {
    const key = value_(row[field]);
    counts[key] = (counts[key] || 0) + 1;
  });
  return Object.keys(counts).map(function(key) {
    return {label: key, count: counts[key]};
  }).sort(function(a, b) { return b.count - a.count; });
}

function countItem_(label, count) {
  return {label: label, count: count};
}

function parseParameter_(context, parameter) {
  const regex = new RegExp('(?:^|\\|)' + parameter + ':(\\d+)\\/(\\d+)', 'i');
  const match = String(context || '').match(regex);
  return match ? {score: Number(match[1]), max: Number(match[2])} : null;
}

function averageScore_(rows) {
  const scores = rows.map(function(r) { return r.score; }).filter(function(v) { return v !== null; });
  return average_(scores);
}

function average_(numbers) {
  if (!numbers.length) return 0;
  return Math.round(numbers.reduce(function(a, b) { return a + Number(b); }, 0) / numbers.length * 10) / 10;
}

function percent_(part, total) {
  return total ? Math.round(part / total * 1000) / 10 : 0;
}

function clamp_(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

function value_(input) {
  const text = String(input === null || input === undefined ? '' : input).trim();
  return (!text || /^(none|null|n\/a)$/i.test(text)) ? 'None' : text;
}

function unique_(values) {
  const seen = {};
  values.forEach(function(v) {
    v = value_(v);
    if (v !== 'None') seen[v] = true;
  });
  return Object.keys(seen).sort();
}

function parseDate_(value) {
  const text = String(value || '').trim();
  if (!text || text === 'None') return null;
  const standard = new Date(text);
  if (!isNaN(standard.getTime())) return standard;
  const m = text.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
  if (!m) return null;
  const months = {Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11};
  const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
  return new Date(year, months[m[2]], Number(m[1]));
}

function sortNewest_(a, b) {
  const aDate = parseDate_(a.CallDate) || new Date(0);
  const bDate = parseDate_(b.CallDate) || new Date(0);
  return bDate.getTime() - aDate.getTime();
}

function maskMobile_(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '');
  return digits.length >= 4 ? 'XXXXXX' + digits.slice(-4) : 'Masked';
}

function maskTranscript_(text) {
  return maskTranscriptPreservePositions_(text);
}

function maskTranscriptPreservePositions_(text) {
  return String(text || '')
    .replace(/\b\d{10,}\b/g, function(match) {
      return '•'.repeat(Math.max(0, match.length - 4)) + match.slice(-4);
    })
    .replace(/((?:otp|pin|cvv|password)\s*(?:is|:|-)?\s*)(\d{3,8})/ig, function(full, prefix, digits) {
      return prefix + '•'.repeat(digits.length);
    });
}

function cleanSpaces_(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}



module.exports = {
  cleanFilters_,
  applyFiltersToEnriched_,
  enrichRows_,
  filterEnrichedRows_,
  enrich_,
  insightMatches_,
  drilldownTitle_,
  buildDetailedEvidencePackage_,
  buildClassificationReason_,
  buildSummary_,
  buildSales_,
  buildJourney_,
  buildQuality_,
  buildCompliance_,
  buildActions_,
  buildAnalysts_,
  buildSingleAnalyst_,
  buildCallouts_,
  buildFilterOptions_,
  lightRecord_,
  clamp_,
  sortNewest_,
  maskTranscriptPreservePositions_
};
