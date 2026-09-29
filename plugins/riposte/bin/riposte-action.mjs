#!/usr/bin/env node
import { createRequire as __riposteRequire } from 'node:module'; const require = __riposteRequire(import.meta.url);

// packages/adapters/src/action-cli.ts
import { readFileSync as readFileSync2 } from "node:fs";

// packages/verify/src/verdict/canonical.ts
import { createHash } from "node:crypto";
function canonicalize(value) {
  return JSON.stringify(normalize(value));
}
function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function hashOf(value) {
  return sha256(canonicalize(value));
}
function normalize(v) {
  if (v === void 0 || v === null) return v === void 0 ? void 0 : null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v)) {
    return v.map((x) => {
      const n = normalize(x);
      return n === void 0 ? null : n;
    });
  }
  if (typeof v === "object") {
    const src = v;
    const out = /* @__PURE__ */ Object.create(null);
    for (const k of Object.keys(src).sort()) {
      const n = normalize(src[k]);
      if (n !== void 0) out[k] = n;
    }
    return out;
  }
  return null;
}

// packages/verify/src/textmatch/normalize.ts
var QUOTE_MAP = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": "'",
  "\u201B": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u201E": '"',
  "\u201F": '"',
  "\xAB": '"',
  "\xBB": '"',
  "\u2039": "'",
  "\u203A": "'",
  "`": "'",
  "\xB4": "'"
};
var DASHES = /* @__PURE__ */ new Set(["\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015", "\u2212"]);
function isSpace(c) {
  return c === " " || c === "	" || c === "\n" || c === "\r" || c === "\f" || c === "\v" || c === "\xA0";
}
function isHyphenOrDash(c) {
  return c === "-" || DASHES.has(c);
}
function normalizeMapped(src, profile) {
  const out = [];
  const map = [];
  const n = src.length;
  const push = (ch, srcOffset) => {
    for (let k = 0; k < ch.length; k++) {
      out.push(ch[k]);
      map.push(srcOffset);
    }
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (isHyphenOrDash(c)) {
      let k = i + 1;
      while (k < n && (src[k] === " " || src[k] === "	")) k++;
      if (k < n && (src[k] === "\n" || src[k] === "\r")) {
        i = k;
        while (i < n && isSpace(src[i])) i++;
        continue;
      }
      push("-", i);
      i++;
      continue;
    }
    if (isSpace(c)) {
      const start = i;
      while (i < n && isSpace(src[i])) i++;
      push(" ", start);
      continue;
    }
    if (c === "\u2026") {
      push("...", i);
      i++;
      continue;
    }
    const q = QUOTE_MAP[c];
    if (q !== void 0) {
      push(q, i);
      i++;
      continue;
    }
    push(profile === "legal" ? c.toLowerCase() : c, i);
    i++;
  }
  return { text: out.join(""), map, original: src };
}
function toOriginalSpan(m, normStart, normEnd) {
  if (m.text.length === 0) return { start: 0, end: 0 };
  const s = Math.max(0, Math.min(normStart, m.text.length - 1));
  const e = Math.max(s, Math.min(normEnd - 1, m.text.length - 1));
  const start = m.map[s];
  const lastOrig = m.map[e];
  return { start, end: lastOrig + 1 };
}

// packages/verify/src/textmatch/matcher.ts
var WORD_RE = /[^\s]+/g;
var MIN_ANCHOR_WORDS = 3;
function prepareSource(source) {
  return { legal: normalizeMapped(source, "legal"), value: normalizeMapped(source, "value"), raw: source };
}
function words(s) {
  return s.match(WORD_RE) ?? [];
}
function matchQuote(prepared, quote) {
  const src = prepared.legal;
  const qn = normalizeMapped(quote, "legal").text.trim();
  if (qn.length === 0) return { found: false, reason: "not_located" };
  const idx = src.text.indexOf(qn);
  if (idx >= 0) {
    const span = toOriginalSpan(src, idx, idx + qn.length);
    return { found: true, span, matchedText: prepared.raw.slice(span.start, span.end), reason: "verbatim" };
  }
  const qWords = words(qn);
  let bestLen = 0;
  let bestPos = -1;
  let bestChars = 0;
  for (let i = 0; i < qWords.length; i++) {
    let phrase = qWords[i];
    let pos = src.text.indexOf(phrase);
    if (pos < 0) continue;
    let j = i;
    while (j + 1 < qWords.length) {
      const trial = `${phrase} ${qWords[j + 1]}`;
      const tpos = src.text.indexOf(trial);
      if (tpos < 0) break;
      phrase = trial;
      pos = tpos;
      j++;
    }
    const len = j - i + 1;
    if (len > bestLen) {
      bestLen = len;
      bestPos = pos;
      bestChars = phrase.length;
    }
  }
  if (bestLen >= MIN_ANCHOR_WORDS && bestPos >= 0) {
    const margin = Math.max(qn.length, 40);
    let ws = Math.max(0, bestPos - margin);
    let we = Math.min(src.text.length, bestPos + bestChars + margin);
    while (ws > 0 && src.text[ws - 1] !== " ") ws--;
    while (we < src.text.length && src.text[we] !== " ") we++;
    const span = toOriginalSpan(src, ws, we);
    return {
      found: false,
      nearest: { span, text: prepared.raw.slice(span.start, span.end) },
      reason: "misquote_nearest"
    };
  }
  return { found: false, reason: "not_located" };
}

// packages/verify/src/version.ts
var ENGINE_VERSION = "0.0.1";
var SCHEMA_VERSION = "v0";

// packages/verify/src/action/index.ts
var ACTION_RULESET = { id: "action", version: "0.0.1", domain: "action" };
var ACTION_RECORDS_RULESET = { id: "action", version: "0.1.0", domain: "action" };
var isScalar = (x) => typeof x === "string" || typeof x === "number" || typeof x === "boolean";
var looksNumeric = (v) => typeof v === "number" || typeof v === "string" && /^-?[\d.,\s$]+$/.test(v) && /\d/.test(v);
function allowlistEvidence(path, value) {
  return { locator: { kind: "field", source: "contract", path: `allowed.${path}` }, value, confidence: 100, role: "REFERENCE" };
}
function spanEvidence(sourceHash, span, text) {
  return { locator: { kind: "span", source_hash: sourceHash, start: span.start, end: span.end }, value: text, confidence: 100, role: "QUOTE" };
}
function groundArgument(path, value, sources, prepared, sourceHash) {
  const base = { claim_id: `arg.${path}`, tier: "DETERMINISTIC", field: path, asserted: value };
  const allowed = sources.allowed?.[path];
  if (allowed !== void 0) {
    const ok = allowed.some((a) => String(a) === String(value));
    return ok ? {
      ...base,
      kind: "CROSS_REFERENCE",
      outcome: "PASS",
      rule_id: "GROUNDED",
      rule_name: "Value grounded in an approved set",
      computation: { formula: "value \u2208 allowed", operands: { value }, result: true },
      evidence: [allowlistEvidence(path, value)],
      locked: true,
      explanation: `"${value}" is one of the ${allowed.length} approved values for ${path}.`
    } : {
      ...base,
      kind: "CROSS_REFERENCE",
      outcome: "FAIL",
      rule_id: "GROUNDED",
      rule_name: "Value grounded in an approved set",
      computation: { formula: "value \u2208 allowed", operands: { value, approved: allowed.length }, result: false },
      evidence: [allowlistEvidence(path, value)],
      locked: true,
      explanation: `"${value}" is NOT in the approved set for ${path}. The agent proposed a value with no approved source \u2014 do not execute.`
    };
  }
  if (prepared && sourceHash) {
    if (looksNumeric(value)) {
      return {
        ...base,
        kind: "CROSS_REFERENCE",
        outcome: "INSUFFICIENT_DATA",
        rule_id: "GROUNDED",
        rule_name: "Value grounded in an approved source",
        evidence: [],
        insufficiency: { reason: "REFERENCE_NOT_PROVIDED", detail: `${path} = ${JSON.stringify(value)}: a bare number found in free source text does not establish it as this argument's value (it can match a year, quantity, part or account number, or an opposite sign). Supply an allow-list of approved values, or a labelled source field, to ground a numeric action value.` },
        locked: false,
        explanation: `Numeric value ${path} cannot be grounded by free-text presence alone; provenance unconfirmed.`
      };
    }
    const sval = String(value);
    if (sval.trim().length >= 3) {
      const r2 = matchQuote(prepared, sval);
      if (r2.found && r2.span) return {
        ...base,
        kind: "QUOTE_MATCH",
        outcome: "PASS",
        rule_id: "GROUNDED",
        rule_name: "Value grounded in the source document",
        computation: { formula: "value \u2208 source", operands: { value }, result: true },
        evidence: [spanEvidence(sourceHash, r2.span, r2.matchedText ?? "")],
        locked: true,
        explanation: `${path} = "${value}" appears verbatim in the source the agent read.`
      };
    }
    return {
      ...base,
      kind: "QUOTE_MATCH",
      outcome: "INSUFFICIENT_DATA",
      rule_id: "GROUNDED",
      rule_name: "Value grounded in the source document",
      evidence: [],
      insufficiency: { reason: "SPAN_NOT_FOUND", detail: `${path} = ${JSON.stringify(value)} was not found verbatim in the supplied source. Not confirmed grounded \u2014 do not execute on this alone.` },
      locked: false,
      explanation: `Could not ground ${path} in the source; provenance unconfirmed.`
    };
  }
  return {
    ...base,
    kind: "CROSS_REFERENCE",
    outcome: "INSUFFICIENT_DATA",
    rule_id: "GROUNDED",
    rule_name: "Value grounded in an approved source",
    evidence: [],
    insufficiency: { reason: "REFERENCE_NOT_PROVIDED", detail: `no allow-list and no source were declared for ${path}, so its provenance cannot be checked. Supply allowed values or the source document the value must come from.` },
    locked: false,
    explanation: `No source declared for ${path}; provenance unverifiable.`
  };
}
var hasField = (r2, k) => Object.prototype.hasOwnProperty.call(r2, k);
function recordNamed(records) {
  const out = [];
  for (const r2 of records) for (const k of Object.keys(r2)) if (!out.includes(k)) out.push(k);
  return out;
}
function groundRecords(args, records, required) {
  const rule = { kind: "CROSS_REFERENCE", tier: "DETERMINISTIC", rule_id: "GROUNDED_RECORD", rule_name: "Values grounded together in one approved record" };
  const out = /* @__PURE__ */ new Map();
  const recordRef = (i, k, value) => ({ locator: { kind: "field", source: "contract", path: `records[${i}].${k}` }, value, confidence: 100, role: "REFERENCE" });
  if (records.length === 0) {
    for (const k of required) {
      const v = isScalar(args[k]) ? args[k] : null;
      out.set(k, {
        ...rule,
        claim_id: `arg.${k}`,
        field: k,
        asserted: v,
        outcome: "FAIL",
        computation: { formula: "values \u2208 one approved record", operands: { value: v, records: 0 }, result: false },
        evidence: [{ locator: { kind: "field", source: "contract", path: "records" }, value: v, confidence: 100, role: "REFERENCE" }],
        locked: true,
        explanation: `The approved records are empty, so nothing is approved: ${k} = ${JSON.stringify(args[k] ?? null)} has no approved record. Do not execute.`
      });
    }
    return out;
  }
  const named = recordNamed(records);
  const present = named.filter((k) => isScalar(args[k]));
  const missing = named.filter((k) => !isScalar(args[k]));
  const agrees = (r2, k) => hasField(r2, k) && String(r2[k]) === String(args[k]);
  const consistent = records.map((_, i) => i).filter((i) => present.every((k) => agrees(records[i], k)));
  const given = present.map((k) => `${k} = ${JSON.stringify(args[k])}`).join(", ");
  const partial = `the approved records bind ${named.join(", ")} together, and the action does not supply ${missing.join(", ")} as a value; a record is never grounded piecewise, so no record-named argument is grounded. Supply every record-named argument, or declare records that name only this tool's arguments.`;
  const abstain = (k) => ({
    ...rule,
    claim_id: `arg.${k}`,
    field: k,
    asserted: isScalar(args[k]) ? args[k] : null,
    outcome: "INSUFFICIENT_DATA",
    evidence: [],
    insufficiency: { reason: "FIELD_MISSING", detail: `${k}: ${partial}`, missing },
    locked: false,
    explanation: `${k} cannot be grounded on a partial record (missing: ${missing.join(", ")}); provenance unconfirmed.`
  });
  for (const k of missing) out.set(k, abstain(k));
  if (consistent.length === 0) {
    const score = (i) => present.filter((k) => agrees(records[i], k)).length;
    let best = 0;
    for (let i = 1; i < records.length; i++) if (score(i) > score(best)) best = i;
    const r2 = records[best];
    const differs = present.filter((k) => !agrees(r2, k)).map((k) => `${k} = ${hasField(r2, k) ? JSON.stringify(r2[k]) : "(not on it)"}`).join(", ");
    const closest = `Closest approved record: records[${best}] (${score(best)} of ${present.length} agree; it has ${differs}).`;
    for (const k of present) {
      const v = args[k];
      out.set(k, {
        ...rule,
        claim_id: `arg.${k}`,
        field: k,
        asserted: v,
        outcome: "FAIL",
        computation: { formula: "values \u2208 one approved record", operands: { value: v, records: records.length }, result: false },
        evidence: [recordRef(best, k, hasField(r2, k) ? r2[k] : null)],
        locked: true,
        explanation: `No approved record carries ${given} together. ${closest} A value approved for one record combined with another record's value is not grounded. Do not execute.`
      });
    }
  } else if (missing.length === 0) {
    const i = consistent[0];
    for (const k of present) {
      const v = args[k];
      out.set(k, {
        ...rule,
        claim_id: `arg.${k}`,
        field: k,
        asserted: v,
        outcome: "PASS",
        computation: { formula: "values \u2208 one approved record", operands: { value: v, record: i }, result: true },
        evidence: [recordRef(i, k, records[i][k])],
        locked: true,
        explanation: `${k} = ${JSON.stringify(v)} is grounded together with the action's other record-named values (${given}) in approved records[${i}].`
      });
    }
  } else {
    for (const k of present) out.set(k, abstain(k));
  }
  return out;
}
function coverageOf(claims) {
  let pass = 0, fail = 0, ins = 0;
  for (const c of claims) c.outcome === "PASS" ? pass++ : c.outcome === "FAIL" ? fail++ : ins++;
  return { claims_total: claims.length, claims_checked: pass + fail, claims_pass: pass, claims_fail: fail, claims_insufficient: ins };
}
function verifyAction(action, sources = {}, options = {}) {
  const args = action.arguments ?? {};
  const declared = sources.require ?? Object.keys(args).filter((k) => isScalar(args[k]));
  const records = sources.records;
  const required = records ? [...declared, ...recordNamed(records).filter((k) => !declared.includes(k))] : declared;
  const byRecord = records ? groundRecords(args, records, required) : void 0;
  const prepared = typeof sources.text === "string" && sources.text.length > 0 ? prepareSource(sources.text) : void 0;
  const sourceHash = prepared ? sha256(sources.text) : void 0;
  const claims = required.map((path) => {
    const v = args[path];
    const rec = byRecord?.get(path);
    if (rec) {
      if (rec.outcome !== "INSUFFICIENT_DATA" && sources.allowed?.[path] !== void 0 && isScalar(v)) {
        const listed = groundArgument(path, v, { allowed: sources.allowed }, void 0, void 0);
        if (listed.outcome === "FAIL") return listed;
      }
      return rec;
    }
    if (!isScalar(v)) {
      return {
        claim_id: `arg.${path}`,
        kind: "CROSS_REFERENCE",
        tier: "DETERMINISTIC",
        outcome: "INSUFFICIENT_DATA",
        field: path,
        asserted: null,
        rule_id: "GROUNDED",
        rule_name: "Value grounded in an approved source",
        evidence: [],
        insufficiency: { reason: "UNPARSEABLE", detail: `${path} is not a scalar value; only scalar arguments (amounts, codes, ids, strings) are checked for grounding.` },
        locked: false,
        explanation: `${path} is not a scalar; not checked.`
      };
    }
    return groundArgument(path, v, sources, prepared, sourceHash);
  });
  const coverage = coverageOf(claims);
  const outcome = coverage.claims_fail > 0 ? "FAIL" : coverage.claims_insufficient > 0 || coverage.claims_checked === 0 ? "INSUFFICIENT_DATA" : "PASS";
  const ruleset = records ? ACTION_RECORDS_RULESET : ACTION_RULESET;
  const input_hash = hashOf({ action, sources });
  const verdict_id = sha256(`${input_hash}:${ruleset.id}@${ruleset.version}:${ENGINE_VERSION}`).slice(0, 32);
  const issued_at = (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  return {
    schema_version: SCHEMA_VERSION,
    verdict_id,
    issued_at,
    engine_version: ENGINE_VERSION,
    ruleset: { ...ruleset },
    input_hash,
    replayable: true,
    document: { extraction_hash: hashOf(action), ...options.producer !== void 0 ? { producer: options.producer } : {}, line_items: 0 },
    references: { contract: sources.allowed !== void 0 || records !== void 0, evidence: 0, history: 0, source: prepared !== void 0 },
    outcome,
    aggregation: "ANY_FAIL_FAILS",
    claims,
    coverage
  };
}

// packages/verify/src/verdict/notices.ts
var disputeCommand = (verdict_id, claim_id) => `verify opinion --ledger <chain.jsonl> --dispute ${verdict_id}${claim_id !== void 0 ? ` --claim ${claim_id}` : ""}`;
var ACTION_HANDLING = {
  record: { FAIL: "SURFACE", INSUFFICIENT_DATA: "SURFACE", PASS: "UNCHANGED", delivery: "notice", every_fail_disputable: true },
  advise: { FAIL: "SURFACE", INSUFFICIENT_DATA: "SURFACE", PASS: "UNCHANGED", delivery: "in-flow", every_fail_disputable: true },
  gate: { FAIL: "HOLD", INSUFFICIENT_DATA: "HOLD", PASS: "HUMAN_REVIEW", delivery: "in-flow", every_fail_disputable: true },
  autonomy: { FAIL: "HOLD", INSUFFICIENT_DATA: "HOLD", PASS: "ACT_WITHIN_BOUNDS", delivery: "in-flow", every_fail_disputable: true }
};
function findingOf(v, c) {
  return {
    claim_id: c.claim_id,
    rule_id: c.rule_id,
    rule_name: c.rule_name,
    outcome: c.outcome,
    field: c.field,
    asserted: c.asserted,
    // A boolean computation result is a rule's pass/fail bit (e.g. GROUNDED), not a value the claim should have had.
    // Rendering it as "expected false" misled (delivery-lane finding F2, 2026-09-28), so only real values are "expected".
    ...c.computation && typeof c.computation.result !== "boolean" ? { expected: c.computation.result } : {},
    ...c.variance !== void 0 ? { variance: c.variance } : {},
    explanation: c.explanation,
    evidence: c.evidence.map((e) => ({ ...e })),
    ...c.insufficiency ? { insufficiency: { ...c.insufficiency } } : {},
    dispute: disputeCommand(v.verdict_id, c.claim_id)
  };
}
function verdictFindings(verdict) {
  const det = verdict.claims.filter((c) => c.tier === "DETERMINISTIC");
  const reasoned = verdict.claims.filter((c) => c.tier !== "DETERMINISTIC" && (c.outcome === "PASS" || c.outcome === "FAIL")).length;
  const fail = det.some((c) => c.outcome === "FAIL");
  const checked = det.filter((c) => c.outcome !== "INSUFFICIENT_DATA").length;
  const aggregated = fail ? "FAIL" : checked === 0 ? "INSUFFICIENT_DATA" : "PASS";
  const rank = { PASS: 0, INSUFFICIENT_DATA: 1, FAIL: 2 };
  const allDet = det.length === verdict.claims.length;
  const detInsufficient = det.some((c) => c.outcome === "INSUFFICIENT_DATA");
  const floor = allDet ? verdict.outcome : verdict.outcome === "INSUFFICIENT_DATA" && detInsufficient ? "INSUFFICIENT_DATA" : "PASS";
  const outcome = rank[floor] > rank[aggregated] ? floor : aggregated;
  return {
    verdict_id: verdict.verdict_id,
    outcome,
    findings: [...det.filter((c) => c.outcome === "FAIL"), ...det.filter((c) => c.outcome === "INSUFFICIENT_DATA")].map((c) => findingOf(verdict, c)),
    advisories: reasoned,
    dispute: disputeCommand(verdict.verdict_id)
  };
}
function actionNotice(verdict, level) {
  const handling = ACTION_HANDLING[level];
  if (!handling) throw new RangeError(`unknown rung ${JSON.stringify(level)} (record | advise | gate | autonomy)`);
  const f = verdictFindings(verdict);
  const action = f.outcome === "PASS" ? "PROCEED" : handling[f.outcome] === "HOLD" ? "HOLD" : "SURFACE";
  return { ...f, level, handling, action };
}

// narrow-engine:riposte-verify
var VOICE_LADDER = ["record", "advise", "gate", "autonomy"];

// packages/receipts/src/nunchi.ts
var MOMENTS = ["pre-action", "done-claim", "mid-flow"];
var AUDIENCES = ["solo", "pr", "auditor"];
var DEFAULT_TIERS = ["low", "moderate", "high", "severe"];
var json = (v) => v === void 0 ? "\u2014" : JSON.stringify(v);
function evidenceLine(e) {
  const l = e.locator;
  const where = l.kind === "field" ? `${l.source}:${l.path}` : `span ${String(l.source_hash ?? "").slice(0, 12)}\u2026[${l.start}..${l.end}]`;
  return `${where} = ${json(e.value)}${e.original !== void 0 ? ` (read as ${json(e.original)})` : ""} \xB7 confidence ${e.confidence}`;
}
function factsFromNotice(notice, subject) {
  return {
    facts_version: "nunchi-facts-v0",
    source: "action_notice",
    subject,
    verdict_id: notice.verdict_id,
    outcome: notice.outcome === "INSUFFICIENT_DATA" ? "ABSTAIN" : notice.outcome,
    action: notice.action,
    level: notice.level,
    pass_handling: notice.handling.PASS,
    in_flow: notice.handling.delivery === "in-flow",
    findings: notice.findings.map((f) => ({
      id: f.claim_id,
      status: f.outcome === "FAIL" ? "FAIL" : "ABSTAIN",
      field: f.field,
      statement: f.outcome === "INSUFFICIENT_DATA" && f.insufficiency ? `${f.insufficiency.reason}: ${f.insufficiency.detail}` : f.explanation,
      ...f.expected !== void 0 ? { values: `asserted ${json(f.asserted)} \xB7 expected ${json(f.expected)}${f.variance !== void 0 ? ` \xB7 variance ${f.variance}` : ""}` } : {},
      evidence: f.evidence.map(evidenceLine),
      dispute: f.dispute
    })),
    advisories: notice.advisories,
    dispute: notice.dispute
  };
}
function weightOf(tier, tiers = DEFAULT_TIERS) {
  const of = tiers.length;
  const rank = tiers.indexOf(tier);
  if (rank < 0 || of === 0) return { weight: "floor", rank: -1, of, known: false };
  if (rank === of - 1) return { weight: "floor", rank, of, known: true };
  if (rank === 0) return { weight: "light", rank, of, known: true };
  if (of >= 4 && rank === of - 2) return { weight: "heavy", rank, of, known: true };
  return { weight: "standard", rank, of, known: true };
}
function timingOf(facts, moment, floor) {
  if (facts.action === "HOLD") return { speak: "now", reason: "a hold is spoken before the action, never deferred" };
  if (!facts.in_flow) return { speak: "on-record", reason: `rung ${facts.level ?? "record"} delivers as a notice on the record, not in-flow` };
  if (floor) return { speak: "now", reason: "top consequence tier: the tact of waiting drops" };
  if (moment === "mid-flow") return { speak: "at-boundary", reason: 'mid-flow: held for the next "done" claim or pre-action moment' };
  return { speak: "now", reason: moment === "pre-action" ? "before the action" : 'at the "done" claim' };
}
function plainStatement(f) {
  const n = f.findings.length;
  const count = `${n} finding${n === 1 ? "" : "s"}`;
  if (f.action === "HOLD") return `Held for a person: ${f.subject}, outcome ${f.outcome} (${count}). It stays held until a person resolves it.`;
  if (f.action === "SURFACE") {
    return f.outcome === "FAIL" ? `${f.subject} failed a check, outcome ${f.outcome} (${count}). Surfaced, not held.` : `${f.subject} could not be checked, outcome ${f.outcome} (${count}). Not confirmed; surfaced, not held.`;
  }
  const where = f.pass_handling === "HUMAN_REVIEW" ? " A person reviews it before it runs." : f.pass_handling === "ACT_WITHIN_BOUNDS" ? " It proceeds within the declared bounds." : "";
  return `${f.subject}: outcome ${f.outcome}, action ${f.action}.${where}${n ? ` (${count})` : ""}`;
}
function tactOf(weight, audience, f) {
  if (weight === "floor" || audience === "auditor") return "";
  if (f.action === "PROCEED" && f.findings.length === 0) return "";
  if (weight === "light") return "Heads-up, when you get a chance: ";
  if (weight === "standard") return "Worth a look: ";
  return "Please check this before relying on it: ";
}
function rungLine(f, tier) {
  const parts = [`outcome ${f.outcome}`, `action ${f.action}`];
  if (f.level !== void 0) parts.push(`rung ${f.level}`);
  if (f.pass_handling !== void 0) parts.push(`PASS handling ${f.pass_handling}`);
  parts.push(`tier ${tier.name}${tier.known ? ` (${tier.rank + 1} of ${tier.of})` : " (undeclared: treated as the top tier)"}`);
  if (f.verdict_id !== void 0) parts.push(`verdict ${f.verdict_id}`);
  return parts.join(" \xB7 ");
}
function renderSolo(f, d) {
  const head = d.weight === "floor" ? `RIPOSTE: ${plainStatement(f)}` : d.weight === "heavy" ? `RIPOSTE (high consequence): ${tactOf(d.weight, "solo", f)}${plainStatement(f)}` : `riposte: ${tactOf(d.weight, "solo", f)}${plainStatement(f)}`;
  const L = [head, `  ${rungLine(f, d.tier)}`];
  for (const x of f.findings) {
    L.push(`  - ${x.status} ${x.id} on ${x.field}: ${x.statement}`);
    if (x.values !== void 0) L.push(`      ${x.values}`);
    for (const e of x.evidence) L.push(`      evidence: ${e}`);
    if (x.dispute !== void 0) L.push(`      dispute: ${x.dispute}`);
  }
  if (f.advisories) L.push(`  ${f.advisories} judgement-tier advisor${f.advisories === 1 ? "y" : "ies"} (COUNSEL): shown, never held.`);
  if (f.dispute !== void 0) L.push(`  dispute the whole verdict: ${f.dispute}`);
  return `${L.join("\n")}
`;
}
function renderPr(f, d) {
  const h = d.weight === "floor" ? "## Riposte: " : d.weight === "heavy" ? "### Riposte (high consequence): " : d.weight === "standard" ? "#### Riposte: " : "##### Riposte note: ";
  const L = [`${h}${tactOf(d.weight, "pr", f)}${plainStatement(f)}`, "", `\`${rungLine(f, d.tier)}\``, ""];
  if (f.findings.length) {
    L.push("| status | finding | field |", "|---|---|---|");
    for (const x of f.findings) L.push(`| ${x.status} | \`${x.id}\` | \`${x.field}\` |`);
    L.push("");
    for (const x of f.findings) {
      L.push(`- **${x.status}** \`${x.id}\`: ${x.statement}`);
      if (x.values !== void 0) L.push(`  - ${x.values}`);
      for (const e of x.evidence) L.push(`  - evidence: \`${e}\``);
      if (x.dispute !== void 0) L.push(`  - dispute: \`${x.dispute}\``);
    }
    L.push("");
  }
  if (f.advisories) L.push(`${f.advisories} judgement-tier advisor${f.advisories === 1 ? "y" : "ies"} (COUNSEL): shown, never held.`, "");
  if (f.dispute !== void 0) L.push(`Dispute the whole verdict: \`${f.dispute}\``, "");
  return `${L.join("\n")}`;
}
function renderAuditor(f, d) {
  const L = [
    "RIPOSTE NOTICE",
    `statement: ${plainStatement(f)}`,
    `subject: ${f.subject}`,
    `source: ${f.source}`,
    `verdict_id: ${f.verdict_id ?? "\u2014"}`,
    `outcome: ${f.outcome}`,
    `action: ${f.action}`,
    `rung: ${f.level ?? "\u2014"}`,
    `pass_handling: ${f.pass_handling ?? "\u2014"}`,
    `consequence_tier: ${d.tier.name} (${d.tier.known ? `${d.tier.rank + 1} of ${d.tier.of}` : "undeclared"})`,
    `delivery: moment ${d.moment} \xB7 speak ${d.timing.speak} \xB7 weight ${d.weight}`,
    `facts_hash: ${d.facts_hash}`,
    `findings: ${f.findings.length}`
  ];
  f.findings.forEach((x, i) => {
    L.push(`  [${i + 1}] ${x.status} ${x.id}`, `      field: ${x.field}`, `      statement: ${x.statement}`);
    if (x.values !== void 0) L.push(`      values: ${x.values}`);
    for (const e of x.evidence) L.push(`      evidence: ${e}`);
    if (x.dispute !== void 0) L.push(`      dispute: ${x.dispute}`);
  });
  L.push(`advisories: ${f.advisories ?? 0}`);
  if (f.dispute !== void 0) L.push(`dispute_verdict: ${f.dispute}`);
  return `${L.join("\n")}
`;
}
function deliver(facts, ctx) {
  if (!MOMENTS.includes(ctx.moment)) throw new RangeError(`unknown moment ${JSON.stringify(ctx.moment)} (${MOMENTS.join(" | ")})`);
  const audience = ctx.audience ?? "solo";
  if (!AUDIENCES.includes(audience)) throw new RangeError(`unknown audience ${JSON.stringify(audience)} (${AUDIENCES.join(" | ")})`);
  const w = weightOf(ctx.tier, ctx.tiers ?? DEFAULT_TIERS);
  const floor = w.weight === "floor";
  const base = {
    delivery_version: "nunchi-v0",
    facts,
    facts_hash: hashOf(facts),
    timing: timingOf(facts, ctx.moment, floor),
    weight: w.weight,
    floor,
    tier: { name: ctx.tier, rank: w.rank, of: w.of, known: w.known },
    audience,
    moment: ctx.moment
  };
  const text = audience === "pr" ? renderPr(facts, base) : audience === "auditor" ? renderAuditor(facts, base) : renderSolo(facts, base);
  return { ...base, text };
}

// packages/receipts/src/ledger.ts
import { createHash as createHash2, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from "node:crypto";
function memoryStore(seed = []) {
  const entries = [...seed];
  return { load: () => [...entries], append: (e) => {
    entries.push(e);
  } };
}
var GENESIS = "0".repeat(64);
var entryHash = (e) => sha256(canonicalize({ seq: e.seq, kind: e.kind, at: e.at, body: e.body, prev_hash: e.prev_hash }));
function keyFingerprint(publicKeyPem) {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash2("sha256").update(der).digest("hex").slice(0, 16);
}
function openLedger(store = memoryStore(), opts = {}) {
  const now = opts.now ?? (() => /* @__PURE__ */ new Date());
  return {
    append(kind, body) {
      const all = store.load();
      const prev = all[all.length - 1];
      const partial = { seq: all.length, kind, at: now().toISOString(), body, prev_hash: prev ? prev.hash : GENESIS };
      const hash = entryHash(partial);
      const entry = { ...partial, hash };
      if (opts.signingKey) {
        const key = createPrivateKey(opts.signingKey);
        entry.signature = { alg: "ed25519", public_key: createPublicKey(key).export({ type: "spki", format: "pem" }).toString(), sig: edSign(null, Buffer.from(hash, "utf8"), key).toString("base64") };
      }
      store.append(entry);
      return entry;
    },
    entries: () => store.load(),
    verify: (policy) => verifyChain(store.load(), policy)
  };
}
function verifyChain(entries, policy = {}) {
  let prev = GENESIS;
  let signed = 0;
  let unsigned = 0;
  const signers = /* @__PURE__ */ new Set();
  let expected = null;
  if (policy.publicKey) {
    try {
      expected = keyFingerprint(policy.publicKey);
    } catch {
      return { ok: false, length: entries.length, head: prev, reason: "the expected public key could not be read", signed, unsigned, signers: [] };
    }
  }
  const fail = (i, reason) => ({ ok: false, length: entries.length, head: prev, broken_at: i, reason, signed, unsigned, signers: [...signers] });
  let anchored = !policy.head;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i) return fail(i, `entry ${i} has seq ${e.seq} (reordered or removed entries)`);
    if (e.prev_hash !== prev) return fail(i, `entry ${i} does not follow entry ${i - 1} (chain broken)`);
    if (entryHash(e) !== e.hash) return fail(i, `entry ${i} was altered after it was written`);
    if (e.signature) {
      let ok = false;
      let fp = "";
      try {
        ok = edVerify(null, Buffer.from(e.hash, "utf8"), createPublicKey(e.signature.public_key), Buffer.from(e.signature.sig, "base64"));
        fp = keyFingerprint(e.signature.public_key);
      } catch {
        ok = false;
      }
      if (!ok) return fail(i, `entry ${i} signature does not verify`);
      signers.add(fp);
      signed++;
      if (expected && fp !== expected) return fail(i, `entry ${i} is signed by key ${fp}, not the expected ${expected} (re-signed by someone else?)`);
    } else {
      unsigned++;
      if (policy.requireSigned) return fail(i, `entry ${i} is not signed (signatures required)`);
    }
    if (policy.head && e.hash === policy.head) anchored = true;
    prev = e.hash;
  }
  const base = { length: entries.length, head: prev, signed, unsigned, signers: [...signers] };
  if (!anchored) return { ok: false, ...base, reason: `the anchored hash ${policy.head.slice(0, 16)}\u2026 is not in this chain (rewritten or truncated since it was recorded)` };
  return { ok: true, ...base };
}

// packages/receipts/src/file-store.ts
import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
function fileStore(path) {
  return {
    load: () => existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [],
    append: (e) => {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, JSON.stringify(e) + "\n");
    }
  };
}

// packages/adapters/src/cli.ts
import { dirname as dirname2, isAbsolute, resolve } from "node:path";

// packages/adapters/src/policy.ts
var ACTION_POLICY_VERSION = "riposte-action-policy-v0";
var isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var isApprovedValue = (x) => typeof x === "string" || typeof x === "number";
function recordsProblem(x) {
  if (!Array.isArray(x) || x.length === 0) return "must be a non-empty array of approved records, each { <argument>: <approved value> }";
  let names;
  for (const [i, r2] of x.entries()) {
    if (!isObj(r2) || Object.keys(r2).length === 0) return `[${i}] must be a non-empty object: { <argument>: <approved value> }`;
    const bad = Object.entries(r2).find(([, v]) => !isApprovedValue(v));
    if (bad) return `[${i}].${bad[0]} must be a string or a number (an approved value)`;
    const these = Object.keys(r2).sort().join(", ");
    if (names === void 0) names = these;
    else if (these !== names) return `[${i}] names ${these}, but [0] names ${names}: every record must name the same arguments`;
  }
  return void 0;
}
function lintActionPolicy(x) {
  const errors = [];
  if (!isObj(x)) return { ok: false, errors: ["the policy must be a JSON object"] };
  if (x.policy_version !== ACTION_POLICY_VERSION) errors.push(`policy_version must be "${ACTION_POLICY_VERSION}"`);
  let tiers = DEFAULT_TIERS;
  if (x.tiers !== void 0) {
    if (!Array.isArray(x.tiers) || x.tiers.length === 0 || !x.tiers.every((t) => typeof t === "string" && t)) errors.push("tiers must be a non-empty array of tier names, ascending in consequence");
    else if (new Set(x.tiers).size !== x.tiers.length) errors.push("tiers must not repeat a name");
    else tiers = x.tiers;
  }
  if (x.audience !== void 0 && !AUDIENCES.includes(x.audience)) errors.push(`audience must be one of ${AUDIENCES.join(" | ")}`);
  if (!Array.isArray(x.actions)) return { ok: false, errors: [...errors, "actions must be an array"] };
  const seen = /* @__PURE__ */ new Set();
  x.actions.forEach((a, i) => {
    const at = `actions[${i}]`;
    if (!isObj(a)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (typeof a.tool !== "string" || !a.tool) errors.push(`${at}.tool must be a tool name`);
    else if (seen.has(a.tool)) errors.push(`${at}.tool "${a.tool}" is declared twice`);
    else seen.add(a.tool);
    if (!VOICE_LADDER.includes(a.level)) errors.push(`${at}.level must be one of ${VOICE_LADDER.join(" | ")} (a rung a person set)`);
    if (typeof a.tier !== "string" || !tiers.includes(a.tier)) errors.push(`${at}.tier must be one of the declared tiers (${tiers.join(", ")})`);
    if (a.workflow !== void 0 && typeof a.workflow !== "string") errors.push(`${at}.workflow must be a string`);
    if (a.set_by !== void 0 && typeof a.set_by !== "string") errors.push(`${at}.set_by must be a string`);
    if (a.sources !== void 0) {
      const s = a.sources;
      if (!isObj(s)) {
        errors.push(`${at}.sources must be an object`);
        return;
      }
      if (s.allowed !== void 0) {
        if (!isObj(s.allowed) || !Object.values(s.allowed).every((v) => Array.isArray(v) && v.every((y) => typeof y === "string" || typeof y === "number"))) {
          errors.push(`${at}.sources.allowed must map argument names to arrays of approved strings or numbers`);
        }
      }
      if (s.records !== void 0) {
        const problem = recordsProblem(s.records);
        if (problem) errors.push(`${at}.sources.records ${problem}`);
      }
      if (s.require !== void 0 && !(Array.isArray(s.require) && s.require.every((r2) => typeof r2 === "string"))) errors.push(`${at}.sources.require must be an array of argument names`);
      if (s.text !== void 0 && typeof s.text !== "string") errors.push(`${at}.sources.text must be a string`);
      if (s.text_file !== void 0 && typeof s.text_file !== "string") errors.push(`${at}.sources.text_file must be a path`);
      if (s.text !== void 0 && s.text_file !== void 0) errors.push(`${at}.sources: give text or text_file, not both`);
    }
  });
  return { ok: errors.length === 0, errors };
}
function parseActionPolicy(text) {
  let x;
  try {
    x = JSON.parse(text);
  } catch (e) {
    throw new Error(`the action policy is not JSON: ${e.message}`);
  }
  const lint = lintActionPolicy(x);
  if (!lint.ok) throw new Error(`the action policy is invalid: ${lint.errors.join("; ")}`);
  return x;
}
function ruleFor(policy, tool) {
  return policy.actions.find((a) => a.tool === tool);
}

// packages/adapters/src/hold.ts
var SEVERITY = { PASS: 0, INSUFFICIENT_DATA: 1, FAIL: 2 };
function guardNotice(verdict, notice) {
  const v = verdict.outcome;
  if (SEVERITY[v] <= SEVERITY[notice.outcome]) return { notice };
  const outcome = v;
  const action = notice.handling[outcome] === "HOLD" ? "HOLD" : "SURFACE";
  return {
    notice: { ...notice, outcome, action },
    guard: `verify's notice read ${notice.outcome}/${notice.action}, but the verdict itself is ${v}: the stricter outcome governs, so this action is ${action} at rung ${notice.level}`
  };
}
function dispositionOf(notice) {
  if (notice.action === "HOLD") return "hold";
  if (notice.action === "SURFACE") return notice.handling.delivery === "in-flow" ? "surface" : "record";
  return notice.handling.PASS === "HUMAN_REVIEW" ? "review" : "proceed";
}
function sourcesOf(rule, deps, problems) {
  const s = rule.sources ?? {};
  const out = {};
  if (s.allowed) out.allowed = s.allowed;
  if (s.records) out.records = s.records;
  if (s.require) out.require = s.require;
  if (typeof s.text === "string") out.text = s.text;
  else if (typeof s.text_file === "string") {
    if (!deps.readText) problems.push(`sources.text_file "${s.text_file}" given but no reader: the source text is absent`);
    else {
      try {
        out.text = deps.readText(s.text_file);
      } catch (e) {
        problems.push(`sources.text_file "${s.text_file}" could not be read (${e.message}): the source text is absent`);
      }
    }
  }
  return out;
}
function checkAction(policy, call, deps = {}) {
  const rule = ruleFor(policy, call.tool);
  if (!rule) return { matched: false, tool: call.tool, disposition: "pass-through" };
  const problems = [];
  const args = call.arguments ?? {};
  const verdict = verifyAction({ tool: call.tool, arguments: args }, sourcesOf(rule, deps, problems), deps.now ? { now: deps.now } : {});
  const g = guardNotice(verdict, actionNotice(verdict, rule.level));
  const delivery = deliver(factsFromNotice(g.notice, `tool ${call.tool}`), {
    moment: deps.moment ?? "pre-action",
    tier: rule.tier,
    tiers: policy.tiers ?? DEFAULT_TIERS,
    audience: deps.audience ?? policy.audience ?? "solo"
  });
  return {
    matched: true,
    tool: call.tool,
    disposition: dispositionOf(g.notice),
    rule,
    workflow: rule.workflow ?? call.tool,
    call_hash: hashOf({ tool: call.tool, arguments: args }),
    verdict,
    notice: g.notice,
    ...g.guard ? { guard: g.guard } : {},
    delivery,
    problems
  };
}

// packages/adapters/src/claude-code.ts
var ACTION_HOOK_MODES = ["off", "record-only", "on"];
var PROMPTABLE_MODES = ["default", "acceptEdits", "plan", "auto"];
function actionHookOptionsFromEnv(env) {
  const problems = [];
  const raw = (env.RIPOSTE_ACTION_HOOK ?? "").trim().toLowerCase();
  let mode = "off";
  if (raw) {
    if (ACTION_HOOK_MODES.includes(raw)) mode = raw;
    else problems.push(`RIPOSTE_ACTION_HOOK="${env.RIPOSTE_ACTION_HOOK}" is not one of ${ACTION_HOOK_MODES.join(" | ")}; staying off`);
  }
  const policy = env.RIPOSTE_ACTION_POLICY?.trim() || void 0;
  const ledger = env.RIPOSTE_ACTION_LEDGER?.trim() || void 0;
  return { mode, ...policy ? { policy } : {}, ...ledger ? { ledger } : {}, problems };
}
function noLedgerNote(inherited) {
  return `riposte-action: no action ledger (set RIPOSTE_ACTION_LEDGER or --ledger): this receipt was recorded to no file, and the loop guard has no memory of earlier holds${inherited ? "; RIPOSTE_LEDGER is not used for action receipts" : ""}
`;
}
var NO_RETRY = "This call is held for a person. Do not retry it. Tell the person what is held and why; they resolve it (or dispute the finding with the command above).";
function plan(check, ctx) {
  const text = check.delivery.text.trimEnd();
  const d = check.disposition;
  if (d === "hold" || d === "review") {
    const repeat = ctx.prior > 0;
    const promptable = ctx.permission_mode === void 0 || PROMPTABLE_MODES.includes(ctx.permission_mode);
    const what = d === "hold" ? "held" : "sent for review";
    const context = `Riposte ${what} this ${check.tool} call for a person (rung ${check.notice.level}, verdict ${check.verdict.verdict_id}, outcome ${check.delivery.facts.outcome}). If the person approves, it runs; if not, do not retry it.`;
    if (!repeat && promptable) {
      return { decision: "ask", repeat, output: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: text, additionalContext: context } } };
    }
    const why = repeat ? `Already ${what} once in this session: Riposte will not ask again for this exact call.` : `No person can be asked in permission mode "${ctx.permission_mode}", so the call does not run.`;
    return {
      decision: "deny",
      repeat,
      output: {
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `${why}
${text}
${NO_RETRY}` },
        systemMessage: `Riposte ${what} ${check.tool} (verdict ${check.verdict.verdict_id}): ${why}`
      }
    };
  }
  if (d === "surface") {
    return { decision: "surface", repeat: false, output: { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: text }, systemMessage: text } };
  }
  return { decision: "none", repeat: false };
}
function preToolUseHook(stdin, mode, deps) {
  const failCode = mode === "on" ? 1 : 0;
  const fail = (msg) => ({ code: failCode, stdout: "", stderr: `riposte-action --hook: ${msg} (failing open: the tool call proceeds through the normal permission flow)
`, decision: "none" });
  let hook;
  try {
    const x = JSON.parse(stdin);
    if (x === null || typeof x !== "object" || Array.isArray(x)) return fail("stdin is not hook JSON");
    hook = x;
  } catch {
    return fail("stdin is not hook JSON");
  }
  if (hook.hook_event_name !== void 0 && hook.hook_event_name !== "PreToolUse") return { code: 0, stdout: "", stderr: "", decision: "none", skipped: `not a PreToolUse event (${String(hook.hook_event_name)})` };
  if (typeof hook.tool_name !== "string") return fail("no tool_name in the hook input");
  const input = hook.tool_input;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return fail("tool_input is not an object");
  let check;
  try {
    check = checkAction(deps.policy, { tool: hook.tool_name, arguments: input }, deps);
  } catch (e) {
    return fail(`the check threw: ${e.message}`);
  }
  if (!check.matched) return { code: 0, stdout: "", stderr: "", decision: "none", skipped: "not a declared action" };
  const session = typeof hook.session_id === "string" ? hook.session_id : void 0;
  const permission_mode = typeof hook.permission_mode === "string" ? hook.permission_mode : void 0;
  let prior = 0;
  if (session && deps.priorHolds) {
    try {
      prior = deps.priorHolds(session, check.call_hash);
    } catch {
      prior = 0;
    }
  }
  const p = plan(check, { ...permission_mode !== void 0 ? { permission_mode } : {}, prior });
  const enforcing = mode === "on";
  const decision = enforcing ? p.decision : "none";
  const record = {
    source: "pre_tool_use",
    mode,
    ...session ? { session_id: session } : {},
    ...typeof hook.tool_use_id === "string" ? { tool_use_id: hook.tool_use_id } : {},
    tool: check.tool,
    call_hash: check.call_hash,
    workflow: check.workflow,
    level: check.rule.level,
    tier: check.rule.tier,
    ...check.rule.set_by ? { set_by: check.rule.set_by } : {},
    disposition: check.disposition,
    decision,
    would_decision: p.decision,
    held: enforcing && (decision === "ask" || decision === "deny"),
    repeat: p.repeat,
    ...permission_mode !== void 0 ? { permission_mode } : {},
    ...check.guard ? { guard: check.guard } : {},
    problems: check.problems,
    facts_hash: check.delivery.facts_hash,
    verdict: check.verdict
  };
  const stderr = check.problems.map((x) => `riposte-action: ${x}
`).join("");
  return { code: 0, stdout: enforcing && p.output ? `${JSON.stringify(p.output)}
` : "", stderr, decision, record };
}
function countPriorHolds(entries, sessionId, callHash) {
  let n = 0;
  for (const e of entries) {
    if (e.kind !== "action_check") continue;
    const b = e.body;
    if (b && b.session_id === sessionId && b.call_hash === callHash && b.held === true) n++;
  }
  return n;
}

// packages/adapters/src/cli.ts
var ACTION_USAGE = [
  "riposte-action --hook [--ledger <file>]                       (Claude Code PreToolUse; env RIPOSTE_ACTION_HOOK=off|record-only|on, RIPOSTE_ACTION_POLICY, RIPOSTE_ACTION_LEDGER)",
  'riposte-action --check --policy <file> [--moment pre-action|done-claim|mid-flow] [--audience solo|pr|auditor]   (stdin {"tool","arguments"})',
  "riposte-action --lint --policy <file>"
].join("\n");
function parseActionArgs(argv) {
  const out = { hook: false, check: false, lint: false };
  const take = (i, name) => {
    const v = argv[i];
    if (!v || v.startsWith("--")) {
      out.error = `${name} needs a value`;
      return void 0;
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--hook") out.hook = true;
    else if (a === "--check") out.check = true;
    else if (a === "--lint") out.lint = true;
    else if (a === "--policy") {
      const v = take(++i, "--policy");
      if (v) out.policy = v;
    } else if (a === "--ledger") {
      const v = take(++i, "--ledger");
      if (v) out.ledger = v;
    } else if (a === "--moment") {
      const v = take(++i, "--moment");
      if (v) out.moment = v;
    } else if (a === "--audience") {
      const v = take(++i, "--audience");
      if (v) out.audience = v;
    } else out.error = `unknown argument ${a}`;
    if (out.error) return out;
  }
  if ([out.hook, out.check, out.lint].filter(Boolean).length > 1) out.error = "one of --hook, --check, --lint";
  return out;
}
function loadPolicy(path, io) {
  const policy = parseActionPolicy(io.readFile(path));
  const base = dirname2(path);
  return { policy, readText: (p) => io.readFile(isAbsolute(p) ? p : resolve(base, p)) };
}
function actionCli(argv, env, io) {
  const args = parseActionArgs(argv);
  if (args.help) return { code: 0, stdout: "", stderr: `${ACTION_USAGE}
` };
  if (args.error) return { code: 3, stdout: "", stderr: `${args.error}
${ACTION_USAGE}
` };
  if (args.hook) {
    const cfg = actionHookOptionsFromEnv(env);
    const notes = cfg.problems.map((p) => `riposte-action: ${p}
`).join("");
    if (cfg.mode === "off") return { code: 0, stdout: "", stderr: notes };
    const failCode = cfg.mode === "on" ? 1 : 0;
    const policyPath = cfg.policy ?? args.policy;
    if (!policyPath) return { code: failCode, stdout: "", stderr: `${notes}riposte-action --hook: RIPOSTE_ACTION_HOOK=${cfg.mode} but no RIPOSTE_ACTION_POLICY is set (failing open: nothing is checked)
` };
    let loaded;
    try {
      loaded = loadPolicy(policyPath, io);
    } catch (e) {
      return { code: failCode, stdout: "", stderr: `${notes}riposte-action --hook: ${e.message} (failing open: nothing is checked)
` };
    }
    let stdin;
    try {
      stdin = io.stdin();
    } catch (e) {
      return { code: failCode, stdout: "", stderr: `${notes}riposte-action --hook: cannot read stdin: ${e.message}
` };
    }
    const ledgerPath = cfg.ledger ?? args.ledger;
    let ledger;
    let ledgerNote = "";
    if (ledgerPath && io.openLedger) {
      try {
        ledger = io.openLedger(ledgerPath);
      } catch (e) {
        ledgerNote = `riposte-action: ledger not opened (${e.message}); the loop guard falls back to asking
`;
      }
    }
    const r2 = preToolUseHook(stdin, cfg.mode, {
      policy: loaded.policy,
      readText: loaded.readText,
      ...io.now ? { now: io.now } : {},
      ...ledger ? { priorHolds: (s, h) => countPriorHolds(ledger.entries(), s, h) } : {}
    });
    if (r2.record && ledger) {
      try {
        ledger.append("action_check", r2.record);
      } catch (e) {
        ledgerNote += `riposte-action: receipt not written: ${e.message}
`;
      }
    } else if (r2.record && !ledgerPath) {
      ledgerNote += noLedgerNote(Boolean(env.RIPOSTE_LEDGER?.trim()));
    }
    return { code: r2.code, stdout: r2.stdout, stderr: notes + ledgerNote + r2.stderr };
  }
  if (args.check || args.lint) {
    if (!args.policy) return { code: 3, stdout: "", stderr: `--policy <file> is required
${ACTION_USAGE}
` };
    if (args.lint) {
      let x;
      try {
        x = JSON.parse(io.readFile(args.policy));
      } catch (e) {
        return { code: 3, stdout: "", stderr: `cannot read ${args.policy}: ${e.message}
` };
      }
      const lint = lintActionPolicy(x);
      return { code: lint.ok ? 0 : 1, stdout: `${JSON.stringify(lint, null, 2)}
`, stderr: lint.ok ? "" : `${lint.errors.join("\n")}
` };
    }
    if (args.moment !== void 0 && !MOMENTS.includes(args.moment)) return { code: 3, stdout: "", stderr: `--moment must be one of ${MOMENTS.join(" | ")}
` };
    if (args.audience !== void 0 && !AUDIENCES.includes(args.audience)) return { code: 3, stdout: "", stderr: `--audience must be one of ${AUDIENCES.join(" | ")}
` };
    try {
      const { policy, readText } = loadPolicy(args.policy, io);
      const call = JSON.parse(io.stdin());
      if (call === null || typeof call !== "object" || typeof call.tool !== "string") throw new Error('stdin must be {"tool": "<name>", "arguments": {\u2026}}');
      const c = call;
      const a = c.arguments === void 0 ? {} : c.arguments;
      if (a === null || typeof a !== "object" || Array.isArray(a)) throw new Error('"arguments" must be an object');
      const r2 = checkAction(policy, { tool: c.tool, arguments: a }, {
        readText,
        ...io.now ? { now: io.now } : {},
        ...args.moment ? { moment: args.moment } : {},
        ...args.audience ? { audience: args.audience } : {}
      });
      return { code: 0, stdout: `${JSON.stringify(r2)}
`, stderr: "" };
    } catch (e) {
      return { code: 3, stdout: "", stderr: `riposte-action --check: ${e.message}
` };
    }
  }
  return { code: 3, stdout: "", stderr: `nothing to do
${ACTION_USAGE}
` };
}

// packages/adapters/src/action-cli.ts
var signingKey = (() => {
  try {
    return process.env.RECEIPTS_KEY ? readFileSync2(process.env.RECEIPTS_KEY, "utf8") : void 0;
  } catch {
    return void 0;
  }
})();
var r = actionCli(process.argv.slice(2), process.env, {
  stdin: () => readFileSync2(0, "utf8"),
  readFile: (p) => readFileSync2(p, "utf8"),
  openLedger: (p) => openLedger(fileStore(p), signingKey ? { signingKey } : {})
});
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
process.exitCode = r.code;
