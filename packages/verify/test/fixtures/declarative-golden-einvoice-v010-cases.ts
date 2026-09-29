/**
 * The SECOND byte-identity golden (added 2026-09-28, E-INVOICE-2): the three e-invoice rulesets as corrected to 0.1.0,
 * pinned to their bytes. It sits ALONGSIDE the first golden (declarative-golden-cases.ts), which keeps running the
 * shipped 0.0.1 bytes as the engine-identity guard; its 123 e-invoice hashes are never regenerated.
 *
 * Inputs: sha256-identical copies of docs/examples/{peppol-en16931,zatca-ksa,ksef-fa3}.ruleset.json at 0.1.0
 * (fixtures/golden-rulesets/*.v0.1.0.json), run over (a) the same seeded synthetic documents the first golden uses
 * (same generator, same seeds 12 / 14 / 11, 40 each), (b) the constructed, hand-labelled ruleset-corrections set
 * (fixtures/einvoice-ruleset-corrections-set.ts), and (c) lint. The 0.1.0 features (declared abstention, guard
 * reasons, the `price` kind, optional terms, `sources`) are all exercised. The hashes in
 * declarative-golden-einvoice-v010-hashes.json were produced ONCE, by the engine as it stood before any E-INVOICE-2
 * engine change, so later engine additions must leave every one of them unchanged.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { PEPPOL_SET, ZATCA_SET, KSEF_SET } from './einvoice-ruleset-corrections-set'

const HERE = dirname(fileURLToPath(import.meta.url))
export const V010_FILES = {
  peppol: join(HERE, 'golden-rulesets', 'peppol-en16931.ruleset.v0.1.0.json'),
  zatca: join(HERE, 'golden-rulesets', 'zatca-ksa.ruleset.v0.1.0.json'),
  ksef: join(HERE, 'golden-rulesets', 'ksef-fa3.ruleset.v0.1.0.json'),
} as const
/** The pinned bytes: sha256 of each file at 0.1.0 (docs/RULESET-CORRECTIONS-2026-09-28.md). */
export const V010_SHA256 = {
  peppol: '0a3cd5a52e6a835a8649ac8fa831bce47906ae77e5be2bdb85a70d1a9a0cd81c',
  zatca: '6f1240d4ca8c12411dfd0486ede2f5895f5c13a1220129d21836bfcaddc9deb8',
  ksef: '335329d4ba654a2701d72d9ae68ffd94d0253abdcf603e0edfcccbca799c9ab9',
} as const

export interface GoldenApiV010 {
  verifyDeclarative: (x: Record<string, unknown>, rs: never, o: Record<string, unknown>) => unknown
  lintRuleset: (rs: unknown) => unknown
}
export interface GoldenCaseV010 { id: string; run: (api: GoldenApiV010) => unknown }

// ---- the first golden's synthetic generator, copied verbatim (declarative-golden-cases.ts does not export it) ----
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
type FieldSpec = { paths: string[]; kind?: string; line?: boolean; default?: number }
type RS = { fields: Record<string, FieldSpec>; lineArrayKeys?: string[] }
function setPath(obj: Record<string, unknown>, path: string, v: unknown): void {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cur: Record<string, unknown> = obj
  for (let i = 0; i < parts.length - 1; i++) { const p = parts[i]!; if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {}; cur = cur[p] as Record<string, unknown> }
  cur[parts[parts.length - 1]!] = v
}
function randValue(rnd: () => number, kind: string | undefined): unknown {
  const r = rnd()
  if (kind === 'string') return r < 0.9 ? `S${Math.floor(rnd() * 100)}` : ''
  if (kind === 'bool') return [true, false, 'yes', 'no', 1, 0, 'maybe'][Math.floor(r * 7)]
  if (kind === 'identifier') return r < 0.5 ? `PO-${Math.floor(rnd() * 3)}` : r < 0.9 ? [`po ${Math.floor(rnd() * 3)}`, 'PO-1'] : { bad: 1 }
  if (r < 0.06) return 'n/a'
  if (r < 0.14) return `${(rnd() * 5000).toFixed(2)}`
  if (r < 0.18) return `1.234,${Math.floor(rnd() * 90 + 10)}`
  if (kind === 'rate') return Math.round(rnd() * 30) / 100
  if (kind === 'quantity') return Math.floor(rnd() * 20)
  return Math.round(rnd() * 100000) / 100
}
function synthDocs(rs: RS, seed: number, n: number): Record<string, unknown>[] {
  const rnd = mulberry32(seed)
  const out: Record<string, unknown>[] = []
  const lineKey = (rs.lineArrayKeys ?? ['line_items'])[0]!
  const docFields = Object.entries(rs.fields).filter(([, f]) => !f.line)
  const lineFields = Object.entries(rs.fields).filter(([, f]) => f.line)
  for (let i = 0; i < n; i++) {
    const doc: Record<string, unknown> = {}
    for (const [, f] of docFields) if (rnd() < 0.85) setPath(doc, f.paths[Math.floor(rnd() * f.paths.length)]!, randValue(rnd, f.kind))
    if (lineFields.length) {
      const nl = Math.floor(rnd() * 4)
      const lines: Record<string, unknown>[] = []
      for (let j = 0; j < nl; j++) { const l: Record<string, unknown> = {}; for (const [, f] of lineFields) if (rnd() < 0.9) setPath(l, f.paths[Math.floor(rnd() * f.paths.length)]!, randValue(rnd, f.kind)); lines.push(l) }
      if (nl > 0 || rnd() < 0.5) doc[lineKey] = lines
    }
    out.push(doc)
  }
  return out
}

const NOW = () => new Date('2026-09-22T00:00:00Z')
export const hashOfV010 = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex')

export function buildGoldenCasesV010(): GoldenCaseV010[] {
  const cases: GoldenCaseV010[] = []
  const rs = Object.fromEntries(Object.entries(V010_FILES).map(([k, f]) => [k, JSON.parse(readFileSync(f, 'utf8'))])) as Record<keyof typeof V010_FILES, Record<string, unknown>>
  const seeds: [keyof typeof V010_FILES, number][] = [['ksef', 11], ['peppol', 12], ['zatca', 14]]
  for (const [k, seed] of seeds) synthDocs(rs[k] as unknown as RS, seed, 40).forEach((doc, i) => cases.push({ id: `v010/${k}/synthetic/${i}`, run: api => api.verifyDeclarative(doc, rs[k] as never, { now: NOW }) }))
  const sets: [keyof typeof V010_FILES, { id: string; extraction: Record<string, unknown> }[]][] = [['peppol', PEPPOL_SET], ['zatca', ZATCA_SET], ['ksef', KSEF_SET]]
  for (const [k, set] of sets) for (const c of set) cases.push({ id: `v010/${k}/corrections-set/${c.id}`, run: api => api.verifyDeclarative(c.extraction, rs[k] as never, { now: NOW }) })
  for (const k of Object.keys(V010_FILES) as (keyof typeof V010_FILES)[]) cases.push({ id: `v010/${k}/lint`, run: api => api.lintRuleset(rs[k]) })
  return cases
}
