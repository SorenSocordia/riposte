/**
 * The model-switch monitor's pre-registered synthetic test (fixtures/attest-monitor/PREREG.md, frozen in PREREG.lock.json
 * before its seeds were generated). The recorded runs must be unchanged, must be exactly what the generator produces for the
 * frozen seeds, and the monitor must meet the frozen bars on them: every planted switch flagged with its cause, no flag on a
 * clean run, every planted record disagreement flagged, nothing extra on a planted run. Synthetic: invented model ids.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { synthAttestMonth, runMonitor } from '../src/index.js'
import { loadManifest } from '../src/attest-monitor/manifest.js'
import { scoreAgainstTruth } from '../src/attest-monitor/score.js'

const F = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'attest-monitor')
// hashed with line endings normalized, so a checkout that converts them does not read as an edit
const sha = (b: Buffer | string) => createHash('sha256').update(Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')).digest('hex')
const lock = JSON.parse(readFileSync(join(F, 'PREREG.lock.json'), 'utf8')) as { sha256: string; seeds: number[]; month: string; frozen_at: string }
const recorded = JSON.parse(readFileSync(join(F, 'FIXTURES.sha256.json'), 'utf8')) as { generated_at: string; files: Record<string, string> }

describe('model-switch monitor: the frozen synthetic pre-registration', () => {
  it('the prereg is unchanged since it was frozen, and was frozen before the seeds were generated', () => {
    expect(sha(readFileSync(join(F, 'PREREG.md')))).toBe(lock.sha256)
    expect(lock.seeds).toEqual([101, 202, 303])
    expect(Date.parse(lock.frozen_at)).toBeLessThan(Date.parse(recorded.generated_at))
  })

  it('the recorded runs are unchanged, and are exactly the generator\'s output for the frozen seeds', () => {
    for (const [rel, h] of Object.entries(recorded.files)) expect(sha(readFileSync(join(F, rel))), rel).toBe(h)
    for (const seed of lock.seeds) {
      const s = synthAttestMonth({ seed, month: lock.month })
      for (const [rel, body] of Object.entries(s.files)) expect(sha(body), `seed-${seed}/${rel}`).toBe(recorded.files[`seed-${seed}/${rel}`])
      expect(sha(`${JSON.stringify(s.truth, null, 2)}\n`)).toBe(recorded.files[`seed-${seed}/truth.json`])
      expect(sha(`${JSON.stringify(s.manifest, null, 2)}\n`)).toBe(recorded.files[`seed-${seed}/manifest.json`])
    }
  })

  it('meets the frozen bars: P1 27/27 switches with their cause, P2 0 false flags on clean runs, S1 12/12, S2 0', () => {
    const tot = { ps: 0, psf: 0, pd: 0, pdf: 0, clean: 0, cleanFlags: 0, extra: 0, exact: 0, runs: 0 }
    for (const seed of lock.seeds) {
      const dir = join(F, `seed-${seed}`)
      const loaded = loadManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')), (rel) => readFileSync(join(dir, rel)))
      expect(loaded.refused).toEqual([])
      const s = scoreAgainstTruth(runMonitor(loaded.input), JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')))
      tot.ps += s.planted_switches; tot.psf += s.planted_switches_flagged; tot.pd += s.planted_disagreements; tot.pdf += s.planted_disagreements_flagged
      tot.clean += s.clean_runs; tot.cleanFlags += s.clean_false_flags; tot.extra += s.planted_extra_flags; tot.exact += s.exact_runs; tot.runs += s.runs.length
    }
    expect({ P1: `${tot.psf}/${tot.ps}`, P2: tot.cleanFlags, clean_runs: tot.clean, S1: `${tot.pdf}/${tot.pd}`, S2: tot.extra, S3: `${tot.exact}/${tot.runs}` })
      .toEqual({ P1: '27/27', P2: 0, clean_runs: 30, S1: '12/12', S2: 0, S3: '66/66' })
  })
})
