/**
 * SARIF 2.1.0 from Riposte verdicts: findings as code-scanning alerts.
 *
 * One result per check that did not PASS:
 *   FAIL     level "error"    (the check ran and did not hold)
 *   INSUFFICIENT_DATA  level "warning"  (can't tell: an input it needs was missing, so a person decides; never an error)
 * The word ABSTAIN is retired from this output (2026-10-05): results say INSUFFICIENT_DATA, the counts `insufficient_data`.
 * An older verdict that carries ABSTAIN is still read, as can't tell.
 * PASS checks produce no result. Rule ids are the check ids (e.g. TOTAL_INT). Every result carries the verdict id and the
 * replay command in `properties.riposte`, so the alert can be re-checked by anyone with the proof file.
 *
 * Locations come from the verdict's own provenance: a field path (`totals.total`, `line_items[*].amount`, resolved to the
 * line and column of that property in the file), or a character span in the source text when the file carries it. When
 * neither resolves (a missing field has no line), the nearest existing parent is used, else the document itself, and
 * `properties.riposte.located` says which.
 *
 * GitHub's supported subset (docs.github.com, "SARIF support for code scanning"): `partialFingerprints` holds a custom
 * `riposteFinding/v1` key; codeql-action's upload step still adds `primaryLocationLineHash` (it fills that key whenever it is
 * missing, src/fingerprints.ts). Results use the default `kind` ("fail"): SARIF's "review" kind would force level "none".
 */
import { createHash } from 'node:crypto'
import { ENGINE_VERSION, answerOf } from 'riposte-verify'
import type { ClaimVerdict, Remedy, Verdict } from 'riposte-verify'

export const SARIF_SCHEMA_URI = 'https://json.schemastore.org/sarif-2.1.0.json'
export const TOOL_NAME = 'Riposte'
export const TOOL_URI = 'https://github.com/SorenSocordia/riposte'

// ── positions in a JSON text ────────────────────────────────────────────────────────────────────────────────────────────
export interface JNode {
  type: 'object' | 'array' | 'string' | 'number' | 'literal'
  start: number
  end: number
  /** The property key's span (with quotes) when this node is an object member's value. */
  keyStart?: number
  props?: Map<string, JNode>
  items?: JNode[]
}

/** Parse `text` (already known to be JSON) into nodes with their character offsets. Undefined if it is not JSON. */
export function jsonPositions(text: string): JNode | undefined {
  let i = 0
  const ws = () => { while (i < text.length && (/\s/.test(text[i]!) || text.charCodeAt(i) === 0xfeff)) i++ }
  const str = (): JNode => {
    const start = i++
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1
    if (i >= text.length) throw new Error('unterminated string')
    return { type: 'string', start, end: ++i }
  }
  const value = (): JNode => {
    ws()
    const c = text[i]
    if (c === '"') return str()
    if (c === '{') {
      const node: JNode = { type: 'object', start: i++, end: 0, props: new Map() }
      ws()
      if (text[i] === '}') { node.end = ++i; return node }
      for (;;) {
        ws()
        if (text[i] !== '"') throw new Error('expected a key')
        const k = str()
        const key = JSON.parse(text.slice(k.start, k.end)) as string
        ws()
        if (text[i++] !== ':') throw new Error('expected :')
        const v = value()
        v.keyStart = k.start
        node.props!.set(key, v)
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === '}') { node.end = ++i; return node }
        throw new Error('expected , or }')
      }
    }
    if (c === '[') {
      const node: JNode = { type: 'array', start: i++, end: 0, items: [] }
      ws()
      if (text[i] === ']') { node.end = ++i; return node }
      for (;;) {
        node.items!.push(value())
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === ']') { node.end = ++i; return node }
        throw new Error('expected , or ]')
      }
    }
    const m = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y
    m.lastIndex = i
    const hit = m.exec(text)
    if (!hit) throw new Error(`unexpected ${JSON.stringify(c)}`)
    const start = i
    i += hit[0].length
    return { type: /\d/.test(hit[0][0]!) || hit[0][0] === '-' ? 'number' : 'literal', start, end: i }
  }
  try {
    const root = value()
    ws()
    return i === text.length ? root : undefined
  } catch {
    return undefined
  }
}

type Step = string | number | '*'
/** `totals.total`, `line_items[3].amount`, `line_items[*].amount`, `dates[service_date]`, `$.a.b`. Undefined if not a path. */
export function pathSteps(path: string): Step[] | undefined {
  const p = path.replace(/^\$\.?/, '')
  if (!p || /[^\w$.\[\]*\- ]/.test(p)) return undefined
  const out: Step[] = []
  const re = /([^.[\]]+)|\[([^\]]*)\]/g
  let m: RegExpExecArray | null
  let at = 0
  while ((m = re.exec(p))) {
    const gap = p.slice(at, m.index)
    if (gap && gap !== '.') return undefined
    at = re.lastIndex
    if (m[1] !== undefined) out.push(m[1])
    else out.push(m[2] === '*' ? '*' : /^\d+$/.test(m[2]!) ? Number(m[2]) : m[2]!)
  }
  return at === p.length && out.length ? out : undefined
}

/** Walk `steps` from `node`: the deepest node reached and how many steps it took. `*` takes `line` when given. */
export function walk(node: JNode, steps: Step[], line?: number): { node: JNode; depth: number } {
  let cur = node
  let depth = 0
  for (const s of steps) {
    // `*` is the claim's line item; with no line, only a one-element array is unambiguous
    const st = s === '*' ? (line ?? (cur.type === 'array' && cur.items!.length === 1 ? 0 : undefined)) : s
    if (st === undefined) break
    let next: JNode | undefined
    if (cur.type === 'array' && typeof st === 'number') next = cur.items![st]
    else if (cur.type === 'object') next = cur.props!.get(String(st))
    if (!next) break
    cur = next
    depth++
  }
  return { node: cur, depth }
}

export interface SarifRegion { startLine: number; startColumn: number; endLine: number; endColumn: number }

/** 1-based line and column (UTF-16 code units, SARIF's default column kind) of the half-open span [start, end). */
export function regionOf(text: string, start: number, end: number): SarifRegion {
  const at = (ix: number) => {
    let line = 1
    let lineStart = 0
    for (let k = text.indexOf('\n'); k !== -1 && k < ix; k = text.indexOf('\n', k + 1)) { line++; lineStart = k + 1 }
    return { line, column: ix - lineStart + 1 }
  }
  const a = at(start)
  const b = at(Math.max(start + 1, end))
  return { startLine: a.line, startColumn: a.column, endLine: b.line, endColumn: b.column }
}

/** A node's region: the key and a scalar value, or the key and the opening bracket of a container. */
export function nodeRegion(text: string, n: JNode): SarifRegion {
  const start = n.keyStart ?? n.start
  const end = n.type === 'object' || n.type === 'array' ? n.start + 1 : n.end
  return regionOf(text, start, end)
}

/** The raw offset in `text` of the `offset`-th decoded character of the string node `s` (escapes counted once). */
export function rawOffset(text: string, s: JNode, offset: number): number {
  let i = s.start + 1
  for (let k = 0; k < offset && i < s.end - 1; k++) i += text[i] === '\\' ? (text[i + 1] === 'u' ? 6 : 2) : 1
  return i
}

// ── the log ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** One checked file. `layout`: the file is the extraction itself, or a `{ extraction, references?, source?, ruleset? }` inputs object. */
export interface SarifItem {
  uri: string
  text: string
  layout: 'extraction' | 'inputs'
  result: { kind: 'verdict'; verdict: Verdict; replay: string; proofFile: string } | { kind: 'refused'; reason: string }
}

export interface SarifOptions {
  /** The absolute file URI of the folder `uri`s are relative to (ends with "/"): `originalUriBaseIds["%SRCROOT%"]`. */
  rootUri?: string
  /** `automationDetails.id` category (GitHub: one per tool and part of the repository). */
  category?: string
}

export type Located = 'field' | 'source' | 'ancestor' | 'document'

interface Loc { region: SarifRegion; located: Located; path?: string }

const lineOf = (claimId: string): number | undefined => {
  const m = /^line\[(\d+)\]\./.exec(claimId)
  return m ? Number(m[1]) : undefined
}

function roots(item: SarifItem, root: JNode | undefined) {
  if (!root) return {}
  if (item.layout === 'extraction') return { extraction: root }
  return { extraction: root.props?.get('extraction'), references: root.props?.get('references'), sourceText: root.props?.get('source')?.props?.get('text') }
}

/** Where a claim points in the file: the field it tests, the source span it quotes, the nearest parent, or the document. */
export function locateClaim(item: SarifItem, root: JNode | undefined, claim: ClaimVerdict, remedies: Remedy[] = []): Loc {
  const r = roots(item, root)
  const line = lineOf(claim.claim_id)
  const docSources = new Set(['invoice', 'document'])
  const candidates: string[] = []
  for (const e of claim.evidence) if (e.locator.kind === 'field' && docSources.has(e.locator.source)) candidates.push(e.locator.path)
  for (const m of remedies) if (m.claims.includes(claim.claim_id) && m.operand?.path && docSources.has(m.operand.source)) candidates.push(m.operand.path)
  candidates.push(claim.field)
  if (line !== undefined) candidates.push(`line_items[${line}].${claim.field}`)
  let best: { node: JNode; depth: number; path: string } | undefined
  if (r.extraction) {
    for (const path of candidates) {
      const steps = pathSteps(path)
      if (!steps) continue
      const w = walk(r.extraction, steps, line)
      if (w.depth === steps.length) return { region: nodeRegion(item.text, w.node), located: 'field', path }
      if (w.depth > 0 && (!best || w.depth > best.depth)) best = { ...w, path }
    }
  }
  const span = claim.evidence.find((e) => e.locator.kind === 'span')?.locator
  if (span && span.kind === 'span' && r.sourceText?.type === 'string') {
    return { region: regionOf(item.text, rawOffset(item.text, r.sourceText, span.start), rawOffset(item.text, r.sourceText, span.end)), located: 'source' }
  }
  if (best) return { region: nodeRegion(item.text, best.node), located: 'ancestor', path: best.path }
  const doc = r.extraction ?? root
  return { region: doc ? nodeRegion(item.text, { ...doc, keyStart: undefined } as JNode) : { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }, located: 'document' }
}

/** Other provenance the file holds (contract rates, delivery records, other fields), as related locations. */
function relatedOf(item: SarifItem, root: JNode | undefined, claim: ClaimVerdict, primary: Loc) {
  const r = roots(item, root)
  const line = lineOf(claim.claim_id)
  const out: { id: number; physicalLocation: { artifactLocation: { uri: string; uriBaseId: string }; region: SarifRegion }; message: { text: string } }[] = []
  const seen = new Set<string>([primary.path ?? ''])
  for (const e of claim.evidence) {
    if (e.locator.kind !== 'field' || seen.has(`${e.locator.source}:${e.locator.path}`) || out.length >= 5) continue
    const steps = pathSteps(e.locator.path)
    if (!steps) continue
    const isDoc = e.locator.source === 'invoice'
    const base = isDoc ? r.extraction : e.locator.source === 'contract' ? r.references?.props?.get('contract') : r.references
    if (!base || (isDoc && e.locator.path === primary.path)) continue
    const w = walk(base, steps, isDoc ? line : undefined)
    if (w.depth !== steps.length) continue
    seen.add(`${e.locator.source}:${e.locator.path}`)
    out.push({
      id: out.length + 1,
      physicalLocation: { artifactLocation: { uri: item.uri, uriBaseId: '%SRCROOT%' }, region: nodeRegion(item.text, w.node) },
      message: { text: `${e.locator.source}: ${e.locator.path}` },
    })
  }
  return out
}

const fingerprint = (...parts: string[]) => createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32)
const linePart = (claimId: string) => { const l = lineOf(claimId); return l === undefined ? '' : ` on line item ${l + 1}` }
const firstSentence = (s: string) => (s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s).trim()

export function resultMessage(c: ClaimVerdict, verdictId: string, replay: string): string {
  const where = `${c.field}${linePart(c.claim_id)}`
  const head = c.outcome === 'FAIL'
    ? `${c.rule_name} did not hold for ${where}.`
    : `${c.rule_name} could not be checked for ${where} (${c.insufficiency?.reason ?? 'an input was missing'}): a person decides; this is not a failure.`
  return `${head} ${c.explanation.trim()} Verdict ${verdictId}; re-run: ${replay}`
}

/** `insufficient_data`: files whose verdict is can't tell. `open`: PASS files with a check that could not run (PASS-WITH-OPEN). */
export interface SarifCounts { files: number; pass: number; fail: number; insufficient_data: number; refused: number; open: number; errors: number; warnings: number }

export function sarifCounts(items: SarifItem[]): SarifCounts {
  const c: SarifCounts = { files: items.length, pass: 0, fail: 0, insufficient_data: 0, refused: 0, open: 0, errors: 0, warnings: 0 }
  for (const it of items) {
    if (it.result.kind === 'refused') { c.refused++; continue }
    const v = it.result.verdict
    const a = answerOf(v.outcome)
    if (a === 'PASS') c.pass++; else if (a === 'FAIL') c.fail++; else c.insufficient_data++ // can't tell (an older verdict's ABSTAIN too)
    const nonPass = v.claims.filter((x) => x.outcome !== 'PASS')
    c.errors += nonPass.filter((x) => x.outcome === 'FAIL').length
    c.warnings += nonPass.filter((x) => x.outcome === 'INSUFFICIENT_DATA').length
    if (a === 'PASS' && nonPass.length) c.open++
    if (!v.claims.length && a === 'FAIL') c.errors++
    if (!v.claims.length && a !== 'PASS' && a !== 'FAIL') c.warnings++
  }
  return c
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type SarifLog = Record<string, any>

/** The SARIF log for a set of checked files (one run, one tool). */
export function toSarif(items: SarifItem[], opts: SarifOptions = {}): SarifLog {
  const rules: any[] = []
  const ruleIndex = new Map<string, number>()
  const ruleFor = (id: string, name: string, ruleset: string) => {
    if (!ruleIndex.has(id)) {
      ruleIndex.set(id, rules.length)
      rules.push({
        id,
        name: id,
        shortDescription: { text: name },
        fullDescription: { text: `${name}: a deterministic check in the ${ruleset} ruleset. FAIL means it ran and did not hold; can't tell (INSUFFICIENT_DATA) means an input it needs was missing, so a person decides.` },
        help: {
          text: `${name} (${id}, ruleset ${ruleset}). FAIL is reported as an error, can't tell (INSUFFICIENT_DATA) as a warning. Each alert names its verdict id and the command that re-performs the check from the saved proof: riposte-verify replay <proof file>.`,
          markdown: `**${name}** (\`${id}\`, ruleset \`${ruleset}\`)\n\n- **FAIL** (error): the check ran and did not hold.\n- **can't tell** (INSUFFICIENT_DATA, warning): an input it needs was missing or not supplied, so a person decides. It is not a failure, and it fails the step unless \`fail-on\` is \`fail\` or \`none\`.\n\nEach alert names its verdict id and the command that re-performs the check from the saved proof: \`riposte-verify replay <proof file>\`.`,
        },
        defaultConfiguration: { level: 'error' },
        properties: { tags: ['riposte', `ruleset:${ruleset.split('@')[0]}`] },
      })
    }
    return ruleIndex.get(id)!
  }
  const results: any[] = []
  const notifications: any[] = []
  for (const item of items) {
    if (item.result.kind === 'refused') {
      notifications.push({
        level: 'error',
        message: { text: `${item.uri}: not checked: ${item.result.reason}` },
        locations: [{ physicalLocation: { artifactLocation: { uri: item.uri, uriBaseId: '%SRCROOT%' } } }],
      })
      continue
    }
    const { verdict, replay, proofFile } = item.result
    const root = jsonPositions(item.text)
    const ruleset = `${verdict.ruleset.id}@${verdict.ruleset.version}`
    const findings: ClaimVerdict[] = verdict.claims.filter((c) => c.outcome !== 'PASS')
    if (!verdict.claims.length && verdict.outcome !== 'PASS') {
      // No check ran at all and none was listed: one document-level finding, so the file is not silently clean.
      findings.push({
        claim_id: 'document', kind: 'CONSISTENCY', tier: 'DETERMINISTIC', outcome: verdict.outcome, field: 'document', asserted: null,
        rule_id: 'NO_CHECK_RAN', rule_name: 'No check could run', evidence: [], locked: false,
        explanation: 'The ruleset found nothing it could check in this document.',
        ...(verdict.outcome === 'INSUFFICIENT_DATA' ? { insufficiency: { reason: 'OUT_OF_RULESET_SCOPE', detail: 'no check applies' } } : {}),
      } as ClaimVerdict)
    }
    for (const c of findings) {
      const loc = locateClaim(item, root, c, verdict.remedies)
      // FAIL or INSUFFICIENT_DATA, the verdict's own word (ABSTAIN retired from this output, 2026-10-05)
      const answer = answerOf(c.outcome) === 'FAIL' ? 'FAIL' : 'INSUFFICIENT_DATA'
      const remedies = (verdict.remedies ?? []).filter((m) => m.claims.includes(c.claim_id))
      const related = relatedOf(item, root, c, loc)
      results.push({
        ruleId: c.rule_id,
        ruleIndex: ruleFor(c.rule_id, c.rule_name, ruleset),
        level: c.outcome === 'FAIL' ? 'error' : 'warning',
        message: { text: resultMessage(c, verdict.verdict_id, replay) },
        locations: [{ physicalLocation: { artifactLocation: { uri: item.uri, uriBaseId: '%SRCROOT%' }, region: loc.region } }],
        ...(related.length ? { relatedLocations: related } : {}),
        partialFingerprints: { 'riposteFinding/v1': fingerprint(item.uri, c.rule_id, c.claim_id) },
        properties: {
          riposte: {
            answer, verdict_id: verdict.verdict_id, replay, proof_file: proofFile, ruleset, claim_id: c.claim_id, rule_id: c.rule_id,
            field: c.field, located: loc.located, ...(loc.path ? { path: loc.path } : {}),
            ...(c.insufficiency ? { reason: c.insufficiency.reason } : {}),
            ...(remedies.length ? { remedies } : {}),
          },
        },
      })
    }
  }
  const counts = sarifCounts(items)
  return {
    $schema: SARIF_SCHEMA_URI,
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: TOOL_NAME, informationUri: TOOL_URI, version: ENGINE_VERSION, semanticVersion: ENGINE_VERSION, rules } },
      ...(opts.category ? { automationDetails: { id: `${opts.category.replace(/\/+$/, '')}/` } } : {}),
      ...(opts.rootUri ? { originalUriBaseIds: { '%SRCROOT%': { uri: opts.rootUri, description: { text: 'The folder the checked files are relative to.' } } } } : {}),
      invocations: [{ executionSuccessful: true, ...(notifications.length ? { toolExecutionNotifications: notifications } : {}) }],
      results,
      properties: { riposte: counts },
    }],
  }
}

/** A Markdown digest for a CI job summary: the counts, then each finding with its place and its re-run command. */
export function sarifSummary(log: SarifLog, max = 50): string {
  const run = log.runs[0]
  const c = run.properties.riposte as SarifCounts
  const lines = [
    '### Riposte',
    '',
    "| files | PASS | FAIL | INSUFFICIENT_DATA (can't tell) | not checked | errors (FAIL findings) | warnings (can't-tell findings) |",
    '|---|---|---|---|---|---|---|',
    `| ${c.files} | ${c.pass} | ${c.fail} | ${c.insufficient_data} | ${c.refused} | ${c.errors} | ${c.warnings} |`,
    '',
  ]
  const results = run.results as any[]
  for (const r of results.slice(0, max)) {
    const loc = r.locations[0].physicalLocation
    lines.push(`- **${r.properties.riposte.answer}** \`${r.ruleId}\` ${loc.artifactLocation.uri}:${loc.region.startLine}: ${firstSentence(r.message.text)} Re-run: \`${r.properties.riposte.replay}\``)
  }
  if (results.length > max) lines.push(`- … ${results.length - max} more in the SARIF file`)
  for (const n of run.invocations[0].toolExecutionNotifications ?? []) lines.push(`- **not checked** ${n.message.text}`)
  return `${lines.join('\n')}\n`
}
