/**
 * The shipped bench docs are generated, never typed: every table in docs/bench/ is a well-formed bench-table/1 in its own
 * <id>.json; docs/BENCH.md and docs/MISSES.md are byte-for-byte what the generator renders from them; the misses ledger
 * regenerates from the tables (and the withdrawn runs' misses) onto itself with nothing dropped or changed; every figure on
 * either page sits inside a block naming the JSON it came from, with that JSON's current sha256; and every table re-emits
 * byte for byte from its in-tree folder, with no path leaving the tree. A tree that holds tables back (`docs/bench/_held.json`,
 * bench/held.ts) is read the same way, the held list included: the held tables' rows stay in the ledger and are marked on the page.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { listTableFiles } from '../src/bench/spec'
import { tableProblems, type BenchTable } from '../src/bench/table'
import { mergeLedger, ledgerBytes, asLedger, ledgerSources } from '../src/bench/ledger'
import { engineLabels, renderBenchIndex, renderMisses, withdrawnLabels, type RefusedList } from '../src/bench/docs'
import type { ProvenanceList } from '../src/bench/provenance'
import type { OutsideList } from '../src/bench/outside'
import type { StressDeclaration } from '../src/bench/stress'
import { checkTree, plannedRuns, tableFolders } from '../src/bench/tree'
import { blocksOf, findBareFigures } from '../src/bench/marker'
import { heldIds, readHeld } from '../src/bench/held'

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs')
const BENCH = join(DOCS, 'bench')
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')

describe.skipIf(!existsSync(join(BENCH, '_misses-ledger.json')))('the shipped bench docs', () => {
  const files = existsSync(BENCH) ? listTableFiles(BENCH) : []
  const bytes = new Map(files.map(f => [f, readFileSync(join(BENCH, f))]))
  const tables = files.map(f => JSON.parse(bytes.get(f)!.toString('utf8')) as BenchTable)
  const shas = new Map(tables.map((t, i) => [t.id, sha(bytes.get(files[i]!)!)]))
  const refusedPath = join(BENCH, '_refused.json')
  const refusedBytes = existsSync(refusedPath) ? readFileSync(refusedPath) : null
  const refused = refusedBytes ? (JSON.parse(refusedBytes.toString('utf8')) as RefusedList) : null
  const provPath = join(BENCH, '_provenance.json')
  const provBytes = existsSync(provPath) ? readFileSync(provPath) : null
  const provenance = provBytes ? (JSON.parse(provBytes.toString('utf8')) as ProvenanceList) : null
  const outPath = join(BENCH, '_outside.json')
  const outBytes = existsSync(outPath) ? readFileSync(outPath) : null
  const outside = outBytes ? (JSON.parse(outBytes.toString('utf8')) as OutsideList) : null
  const stressPath = join(BENCH, '_stress.json')
  const stress = existsSync(stressPath) ? (JSON.parse(readFileSync(stressPath, 'utf8')) as StressDeclaration) : null
  // tables held from this tree (_held.json; none in a tree that ships every table): their rows stay in the ledger
  const heldRead = existsSync(BENCH) ? readHeld(BENCH, new Set(tables.map(t => t.id))) : { held: null, problems: [] }
  const held = heldRead.held

  it('a held list, when the tree has one, is well formed and names no table the tree holds', () => {
    expect(heldRead.problems).toEqual([])
  })

  it('every table is well formed, lives in <id>.json, and carries a prereg hash', () => {
    expect(tables.length).toBeGreaterThan(0)
    tables.forEach((t, i) => {
      expect(tableProblems(t), files[i]).toEqual([])
      expect(`${t.id}.json`).toBe(files[i])
      expect(t.prereg.frozen_sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(t.prereg.stamp?.status, `${t.id}: every prereg has a stamp proof or the unstamped label`).toBeDefined()
    })
  })

  it('the misses ledger regenerates from the tables onto itself: nothing dropped, nothing changed', () => {
    const raw = readFileSync(join(BENCH, '_misses-ledger.json'))
    const { ledger, added } = mergeLedger(asLedger(JSON.parse(raw.toString('utf8'))), ledgerSources(tables, (refused?.runs ?? []).filter(r => r.code === 'withdrawn')), heldIds(held))
    expect(added).toBe(0)
    expect(ledgerBytes(ledger)).toBe(raw.toString('utf8'))
  })

  it('BENCH.md and MISSES.md are exactly the generator\'s rendering', () => {
    // the same inputs `bench index` reads: the engine labels from the package's changelog, the re-bank history from the amendment file
    const changelog = join(DOCS, '..', 'CHANGELOG.md')
    const engine = engineLabels(existsSync(changelog) ? readFileSync(changelog, 'utf8') : null)
    const amendment = stress ? join(BENCH, stress.amendment) : null
    const stressAmendment = amendment && existsSync(amendment) ? readFileSync(amendment, 'utf8') : null
    expect(readFileSync(join(DOCS, 'BENCH.md'), 'utf8')).toBe(renderBenchIndex(tables, shas, refused, refusedBytes ? sha(refusedBytes) : null, { provenance, provenanceSha: provBytes ? sha(provBytes) : null, outside, outsideSha: outBytes ? sha(outBytes) : null, folders: tableFolders(BENCH), stress, planned: plannedRuns(BENCH), engine, stressAmendment, held }))
    const ledgerRaw = readFileSync(join(BENCH, '_misses-ledger.json'))
    expect(readFileSync(join(DOCS, 'MISSES.md'), 'utf8')).toBe(renderMisses(asLedger(JSON.parse(ledgerRaw.toString('utf8'))), sha(ledgerRaw), withdrawnLabels(refused), heldIds(held)))
  })

  it('no figure on either page sits outside a block, and every block names its JSON\'s current sha256', () => {
    for (const page of ['BENCH.md', 'MISSES.md']) {
      const text = readFileSync(join(DOCS, page), 'utf8')
      expect(findBareFigures(text), page).toEqual([])
      const { blocks, problems } = blocksOf(text)
      expect(problems, page).toEqual([])
      for (const b of blocks) {
        const file = b.kind === 'table' ? `${b.id}.json` : b.kind === 'ledger' ? '_misses-ledger.json' : b.kind === 'provenance' ? '_provenance.json' : b.kind === 'outside' ? '_outside.json' : '_refused.json'
        expect(b.sha256, `${page}: block ${b.kind}=${b.id}`).toBe(sha(readFileSync(join(BENCH, file))))
      }
    }
  })

  it('every table re-emits byte for byte from its in-tree folder; refused, withdrawn and provenance rows are consistent', () => {
    const r = checkTree(BENCH)
    expect(r.lines.filter(l => l.status !== 'MATCH' && l.status !== 'OK'), r.lines.map(l => `${l.status} ${l.id}: ${l.detail}`).join('\n')).toEqual([])
    expect(r.lines.filter(l => l.status === 'MATCH').map(l => l.id).sort()).toEqual(tables.map(t => t.id).sort())
    expect(r.ok).toBe(true)
    // a run after stamping began with no proof is flagged, never passed silently
    for (const t of tables) expect(r.lines.find(l => l.id === t.id)?.flag === 'needs stamp').toBe(t.prereg.stamp?.status === 'needs stamp')
  })

  it('no path on the index page or in a table leaves the tree', () => {
    const page = readFileSync(join(DOCS, 'BENCH.md'), 'utf8')
    for (const [i, line] of page.split('\n').entries()) expect(line, `BENCH.md:${i + 1}`).not.toMatch(/\.\.[\\/]|(?:^|[\s(`'"])(?:tmp|products|workspace)[\\/]|(?<![A-Za-z])[A-Za-z]:[\\/]/)
    for (const t of tables) {
      expect(t.prereg.path.split('/')).not.toContain('..')
      if (t.run.results) expect(t.run.results.path.split('/')).not.toContain('..')
    }
  })
})
