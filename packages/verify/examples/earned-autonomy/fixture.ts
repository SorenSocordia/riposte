/**
 * The demo's data: real 10-K filings, real agent extractions, real gold labels (see build-fixture.ts for provenance).
 * A parsed iXBRL twin is stored compactly (facts as tuples, Maps as entry lists) and decoded back to the exact object
 * the twin judge reads.
 */
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { InlineXbrl, TwinContext, TwinFact, TwinUnit, TwinPresentation, TwinPresentationInput } from '../../src/index.js'

type FactTuple = [string, number, string, string, string, number | 'INF' | null, number, 1 | -1, string, string, number, number, number]

export interface EncodedTwin {
  sha256: string
  stats: InlineXbrl['stats']
  namespaces: string[]
  contexts: TwinContext[]
  units: TwinUnit[]
  facts: FactTuple[]
}

export interface FixtureItem {
  field: string
  cell: string
  /** the agent's extracted value */
  value: number
  /** the benchmark's own twin v0.2 outcome for this item (the builder checked the demo's verdict agrees) */
  bench_v02: 'PASS' | 'FAIL' | 'ABSTAIN'
  /** the independent reader's adjudicated reading of the printed statement (audit-sample filings only) */
  gold?: { value: number | null; displayed: string | null; row: string | null; column: string | null }
}

export interface FixtureFiling {
  adsh: string
  name: string
  cik: string
  /** the agent that extracted this filing's values */
  model: string
  period_end: string
  link: string
  doc_name: string
  doc_html_sha256: string
  audit_sample: boolean
  twin: EncodedTwin
  presentation: TwinPresentation
  items: FixtureItem[]
  /** a real value the agent extracted outside the six promoted cells (never checked by this workflow) */
  unchecked_value?: { field: string; value: number }
}

export interface Fixture {
  fixture_version: 'earned-autonomy-fixture-v1'
  source: {
    benchmark: string
    files: Record<string, string>
    audit_sample: number
    promoted_cells: string[]
    map: string
    reduction: string
    items_checked_equal: number
  }
  filings: FixtureFiling[]
  /** one whole filing, as text, so replay can re-perform from the real bytes */
  full?: { adsh: string; html: string; presentation: TwinPresentationInput }
}

export function encodeTwin(tw: InlineXbrl): EncodedTwin {
  const namespaces: string[] = []
  const ns = (u: string): number => { let i = namespaces.indexOf(u); if (i < 0) { i = namespaces.length; namespaces.push(u) } return i }
  return {
    sha256: tw.sha256, stats: tw.stats, namespaces,
    contexts: [...tw.contexts.values()], units: [...tw.units.values()],
    facts: tw.facts.map(f => [f.concept, ns(f.namespace), f.qname, f.contextRef, f.unitRef, f.decimals === Infinity ? 'INF' : f.decimals,
      f.scale, f.sign, f.format, f.displayed, f.value, f.span.start, f.span.end]),
  }
}

export function decodeTwin(e: EncodedTwin): InlineXbrl {
  const facts: TwinFact[] = e.facts.map(([concept, n, qname, contextRef, unitRef, decimals, scale, sign, format, displayed, value, start, end]) => ({
    concept, namespace: e.namespaces[n]!, qname, contextRef, unitRef, decimals: decimals === 'INF' ? Infinity : decimals, scale, sign, format, displayed, value,
    span: { start, end },
  }))
  return { sha256: e.sha256, stats: e.stats, facts, contexts: new Map(e.contexts.map(c => [c.id, c])), units: new Map(e.units.map(u => [u.id, u])) }
}

export const FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'data', 'fixture.json.gz')

export function loadFixture(path = FIXTURE_PATH): { fixture: Fixture; bytes: Buffer } {
  const bytes = readFileSync(path)
  return { fixture: JSON.parse(gunzipSync(bytes).toString('utf8')) as Fixture, bytes }
}
