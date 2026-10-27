/**
 * 2026-10-04: `verify replay` names the inputs it was not given.
 *
 * A declarative verdict is issued on an extraction and a ruleset it does not embed, and on page text, quotes, choice values
 * or archive files when it says so. Before this, a call that left one out got "input_hash does not match the supplied
 * inputs" (exit 1), the same words a forged binding gets. Now:
 *   - some inputs given, not all → ONE line naming exactly the flags this verdict needs, exit 3 (usage), nothing on stdout;
 *   - no inputs at all          → exit 2 as before (the binding was checked), and the line names those flags;
 *   - all inputs, hash differs  → exit 1 as before, and the reason names the input that disagrees where the verdict records
 *                                 it (`input_mismatch`), else lists what agrees and what it does not record;
 *   - a carried ruleset name without @version means the version the verdict names.
 * The fixture is the e-invoice verdict handed to outside replayers (test/replay-n18/, byte copies), replayed with their command.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../src/cli'
import { verify, verifyAction, verifyReplay, type DeclarativeRuleset, type Verdict } from '../src/index'
import { declarativeReplayNeeds, isDeclarativeVerdict, replayNeedsSentence, replayRulesetRef } from '../src/protocol/replay'
import { hashOf } from '../src/verdict/canonical'
import { clean, FIXED_NOW } from './fixtures/invoices'

const HERE = dirname(fileURLToPath(import.meta.url))
const N18 = join(HERE, 'replay-n18')
const BUNDLE = join(N18, 'peppol-N18.json')
const EXTRACTION = join(N18, 'peppol-N18.extraction.json')
const SOURCE = join(N18, 'peppol-N18.txt')
const RS_V02 = join(HERE, '..', 'docs', 'examples', 'peppol-en16931.ruleset.v0.2.json')
const PREFIX = 'input_hash does not match the supplied inputs'

function go(argv: string[]): { code: number; out: string; err: string; json: () => Record<string, any> } {
  let out = '', err = ''
  const code = run(argv, { out: s => { out += s }, err: s => { err += s } }) as number
  return { code, out, err, json: () => JSON.parse(out) }
}
const scratch = (): string => mkdtempSync(join(tmpdir(), 'replay-names-'))
const put = (dir: string, name: string, body: unknown): string => {
  const p = join(dir, name)
  writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body))
  return p
}
const NEEDS_N18 = 'this verdict was issued with page text and an external extraction under ruleset peppol-en16931@0.2.0: pass --extraction <file>, --ruleset peppol-en16931@0.2.0 (or its file) and --source <file>'

describe('the N18 replay command, with and without its flags', () => {
  it('with every flag: outcome VERIFIED, exit 0', () => {
    const r = go(['replay', BUNDLE, '--extraction', EXTRACTION, '--ruleset', RS_V02, '--source', SOURCE])
    expect(r.code).toBe(0)
    expect(r.json()).toMatchObject({ status: 'REPERFORMED', id_ok: true, input_ok: true, outcome_verified: true })
    // 2026-10-05: the VERIFIED line names the ruleset id@version beside the engine
    expect(r.err).toMatch(/outcome VERIFIED: re-performed with declarative \(ruleset peppol-en16931@0\.2\.0, engine 0\.1\.0\) and byte-identical, issued_at aside\./)
  })

  it('with no input flags: still exit 2 (the binding was checked), and the line names the exact flags this verdict needs', () => {
    const r = go(['replay', BUNDLE])
    expect(r.code).toBe(2)
    expect(r.json()).toMatchObject({ status: 'STRUCTURE_ONLY', id_ok: true, outcome_verified: false })
    expect(r.err).toBe('verify replay: structure verified; outcome NOT re-performed: no inputs were supplied, so the check was not run again (the verdict_id binds the inputs, not the outcome). This verdict was issued with page text and an external extraction under ruleset peppol-en16931@0.2.0: to re-perform it, pass --extraction <file>, --ruleset peppol-en16931@0.2.0 (or its file) and --source <file> (or --inputs <inputs.json>). Exit 2.\n')
  })

  const partial: [string, string[], string][] = [
    ['no --source', ['--extraction', EXTRACTION, '--ruleset', RS_V02], '--source'],
    ['no --ruleset', ['--extraction', EXTRACTION, '--source', SOURCE], '--ruleset'],
    ['--extraction only', ['--extraction', EXTRACTION], '--ruleset and --source'],
    ['--source only', ['--source', SOURCE], '--extraction and --ruleset'],
    ['--ruleset and --source, no --extraction', ['--ruleset', RS_V02, '--source', SOURCE], '--extraction'],
    ['--ruleset by name only', ['--ruleset', 'peppol-en16931'], '--extraction and --source'],
  ]
  for (const [name, flags, missing] of partial) {
    it(`${name}: one line naming the flags, exit 3, never "input_hash does not match", no usage dump`, () => {
      const r = go(['replay', BUNDLE, ...flags])
      expect(r.code).toBe(3)
      expect(r.out).toBe('')
      expect(r.err).toBe(`verify replay: ${NEEDS_N18}; this call leaves out ${missing}\n`)
      expect(r.err).not.toContain(PREFIX)
      expect(r.err).not.toContain('verify <extraction.json')
    })
  }

  it('a bare carried ruleset name replays (the resolver, on replay)', () => {
    const r = go(['replay', BUNDLE, '--extraction', EXTRACTION, '--ruleset', 'peppol-en16931', '--source', SOURCE])
    expect(r.code).toBe(0)
    expect(r.json().status).toBe('REPERFORMED')
    expect(go(['replay', BUNDLE, '--extraction', EXTRACTION, '--ruleset', 'peppol-en16931@0.2.0', '--source', SOURCE]).code).toBe(0)
    expect(go(['replay', BUNDLE, '--extraction', EXTRACTION, '--ruleset', 'e-invoice', '--source', SOURCE]).code).toBe(0)
  })

  it('the stdout JSON on a match is what it was before 2026-10-04 (no new field on a match)', () => {
    const r = go(['replay', BUNDLE, '--extraction', EXTRACTION, '--ruleset', RS_V02, '--source', SOURCE])
    expect(r.json().input_mismatch).toBeUndefined()
  })
})

describe('a supplied input that disagrees is named, where the verdict records it', () => {
  it('one source byte changed: the extraction, the page-text flag and the ruleset agree; the page text itself is the first candidate', () => {
    const d = scratch()
    const src2 = put(d, 'src2.txt', readFileSync(SOURCE, 'utf8').replace('Amount due for payment', 'Amount due for paymenT'))
    const r = go(['replay', BUNDLE, '--extraction', EXTRACTION, '--ruleset', RS_V02, '--source', src2])
    expect(r.code).toBe(1)
    const j = r.json()
    expect(j.input_mismatch).toEqual({ differs: [], agrees: ['extraction', 'ruleset', 'source'], unrecorded: ['source_text', 'ruleset_content', 'tolerance'], recorded: true })
    expect(j.reason.startsWith(`${PREFIX}: recorded ${j.recorded_input_hash}, computed ${j.computed_input_hash} — `)).toBe(true) // 2026-10-05
    expect(j.reason).toContain('— this verdict is not for these inputs: every input it records agrees (the extraction\'s hash, the ruleset id@version (peppol-en16931@0.2.0) and whether page text was supplied), so the difference is in one it does not record: the page text itself (the verdict records only that page text was supplied), the ruleset\'s content (the verdict records only its id@version; the copy supplied is the one this build carries under that name) or a rounding-tolerance override. The page text is hashed byte for byte: if it was re-saved or copied, check its line endings (CRLF or LF), a trailing newline and a byte-order mark. If it was issued under a rounding-tolerance override, restate it') // 2026-10-05: line endings named
  })

  it('a changed extraction is named by its recorded hash', () => {
    const d = scratch()
    const ex = JSON.parse(readFileSync(EXTRACTION, 'utf8')) as Record<string, unknown>
    const r = go(['replay', BUNDLE, '--extraction', put(d, 'ex.json', { ...ex, invoice_number: 'Snippet2' }), '--ruleset', RS_V02, '--source', SOURCE])
    expect(r.code).toBe(1)
    expect(r.json().input_mismatch.differs).toEqual(['extraction'])
    // 2026-10-05: the refusal on several lines: what failed, the recorded and the computed hash, then the input that disagrees
    expect(r.err).toMatch(/^verify replay: FAILED: input_hash does not match the supplied inputs: this verdict is not for these inputs\n  recorded [0-9a-f]{64} \(in the verdict\)\n  computed [0-9a-f]{64} \(from the inputs given here\)\n  the extraction is not the one it was issued on \(its hash is not the verdict's document\.extraction_hash\)\n$/)
  })

  it('another version of the ruleset is named, with both versions', () => {
    const r = go(['replay', BUNDLE, '--extraction', EXTRACTION, '--ruleset', 'peppol-en16931@0.1.0', '--source', SOURCE])
    expect(r.code).toBe(1)
    expect(r.json().input_mismatch.differs).toEqual(['ruleset'])
    expect(r.err).toContain('it was issued under ruleset peppol-en16931@0.2.0, and the ruleset supplied is peppol-en16931@0.1.0')
  })

  it('page text supplied for a verdict issued without it: "leave out --source"', () => {
    const d = scratch()
    const doc = JSON.parse(readFileSync(EXTRACTION, 'utf8')) as Record<string, unknown>
    const issued = go([put(d, 'doc.json', doc), '--ruleset', 'peppol-en16931@0.1.0'])
    const vp = put(d, 'v.json', issued.out)
    expect((JSON.parse(issued.out) as Verdict).references.source).toBe(false)
    expect(go(['replay', vp, '--extraction', join(d, 'doc.json'), '--ruleset', 'peppol-en16931@0.1.0']).code).toBe(0)
    const extra = go(['replay', vp, '--extraction', join(d, 'doc.json'), '--ruleset', 'peppol-en16931@0.1.0', '--source', SOURCE])
    expect(extra.code).toBe(1)
    expect(extra.json().input_mismatch.differs).toEqual(['source'])
    expect(extra.err).toContain('it was issued without page text, and page text was supplied (leave out --source)')
  })

  it('a bare carried name means the version the verdict names: a 0.1.0 verdict replays under 0.1.0, not the 0.2.0 default', () => {
    const d = scratch()
    const doc = put(d, 'doc.json', JSON.parse(readFileSync(EXTRACTION, 'utf8')))
    const issued = go([doc, '--ruleset', 'peppol-en16931@0.1.0'])
    const vp = put(d, 'v.json', issued.out)
    expect(replayRulesetRef('peppol-en16931', JSON.parse(issued.out))).toBe('peppol-en16931@0.1.0')
    expect(go(['replay', vp, '--extraction', doc, '--ruleset', 'peppol-en16931']).code).toBe(0)
    // a version this build does not carry is refused, naming those it does
    const wrong = { ...(JSON.parse(issued.out) as Verdict), ruleset: { id: 'peppol-en16931', version: '0.9.9', domain: 'e-invoice' } }
    const r = go(['replay', put(d, 'w.json', wrong), '--extraction', doc, '--ruleset', 'peppol-en16931'])
    expect(r.code).toBe(3)
    expect(r.err).toMatch(/ruleset peppol-en16931@0\.9\.9 is not one this build carries; it carries peppol-en16931@0\.1\.0, peppol-en16931@0\.2\.0, peppol-en16931@0\.3\.0/)
  })
})

describe('quotes, the page text\'s recorded sha256, and a ruleset that is not carried', () => {
  // the shape of r3b-engine §6: a ruleset that requires one passage, and the caller's own quote
  const rs: DeclarativeRuleset = {
    id: 'mini-einvoice', version: '1.0.0',
    fields: { TOTAL: { paths: ['total'] }, NET: { paths: ['net'] }, LINE: { paths: ['amount'], line: true } },
    checks: [{ code: 'NET_INT', left: 'NET', op: '=', right: 'sum(LINE)', field: 'net' }],
    quotes: [{ id: 'title', quote: 'Commercial invoice' }],
  }
  const doc = { net: 100, total: 100, line_items: [{ amount: 60 }, { amount: 40 }] }
  const text = 'Commercial invoice No. 7. Net 100.00'
  const issue = () => {
    const d = scratch()
    const p = { doc: put(d, 'doc.json', doc), rs: put(d, 'rs.json', rs), src: put(d, 'src.txt', text), q: put(d, 'q.json', [{ id: 'net', quote: 'Net 100.00' }]) }
    const issued = go([p.doc, '--ruleset', p.rs, '--source', p.src, '--quotes', p.q])
    expect(issued.code).toBe(0)
    return { d, ...p, v: put(d, 'v.json', issued.out), verdict: JSON.parse(issued.out) as Verdict }
  }

  it('every input: VERIFIED; without --quotes: one line naming --quotes, exit 3 (the supplied ruleset tells its own passage from the caller\'s)', () => {
    const t = issue()
    expect(go(['replay', t.v, '--extraction', t.doc, '--ruleset', t.rs, '--source', t.src, '--quotes', t.q]).code).toBe(0)
    const r = go(['replay', t.v, '--extraction', t.doc, '--ruleset', t.rs, '--source', t.src])
    expect(r.code).toBe(3)
    expect(r.out).toBe('')
    expect(r.err).toBe('verify replay: this verdict was issued with page text, quotes and an external extraction under ruleset mini-einvoice@1.0.0: pass --extraction <file>, --ruleset <the file of mini-einvoice@1.0.0>, --source <file> and --quotes <file>; this call leaves out --quotes\n')
  })

  it('without the ruleset to hand, the quotes are a "maybe": named, not counted missing', () => {
    const t = issue()
    const n = declarativeReplayNeeds(t.verdict)!
    expect(n.needs.map(x => x.input)).toEqual(['extraction', 'ruleset', 'source'])
    expect(n.maybe.map(x => x.input)).toEqual(['quotes'])
    const r = go(['replay', t.v, '--extraction', t.doc, '--source', t.src])
    expect(r.code).toBe(3)
    expect(r.err).toBe('verify replay: this verdict was issued with page text and an external extraction under ruleset mini-einvoice@1.0.0: pass --extraction <file>, --ruleset <the file of mini-einvoice@1.0.0> and --source <file>, and --quotes <file> if it was issued with them (without its ruleset, the verdict alone cannot tell); this call leaves out --ruleset\n')
  })

  it('a quote with other words is named as the quotes; the page text with other bytes is named by the sha256 its quote evidence records', () => {
    const t = issue()
    const q2 = put(t.d, 'q2.json', [{ id: 'net', quote: 'Net 100' }])
    const r = go(['replay', t.v, '--extraction', t.doc, '--ruleset', t.rs, '--source', t.src, '--quotes', q2])
    expect(r.code).toBe(1)
    expect(r.json().input_mismatch.differs).toEqual(['quotes'])
    expect(r.err).toContain('the quotes are not the ones it was issued with (the text or label of source.net differs) (--quotes)')
    const src2 = put(t.d, 'src2.txt', `${text} `)
    const s = go(['replay', t.v, '--extraction', t.doc, '--ruleset', t.rs, '--source', src2, '--quotes', t.q])
    expect(s.code).toBe(1)
    expect(s.json().input_mismatch).toMatchObject({ differs: ['source_text'], agrees: ['extraction', 'ruleset', 'source', 'quotes'] })
    expect(s.err).toContain('the page text is not the text it was issued on (its sha256 is not the one the verdict\'s quote evidence records)')
  })

  it('flags a declarative verdict never takes keep their own error (r3b-engine §6)', () => {
    const t = issue()
    const r = go(['replay', t.v, '--extraction', t.doc, '--ruleset', t.rs, '--contract', t.doc])
    expect(r.code).toBe(3)
    expect(r.err).toContain('{ extraction, ruleset, source? } only')
  })
})

describe('what the verdict records decides what can be told', () => {
  it('a built-in verdict issued with a contract, replayed without one: exit 1 as before, and the contract is named', () => {
    const d = scratch()
    const contract = { rates: [{ role: 'Consulting', rate: 150 }] }
    const v = verify(clean, { references: { contract }, now: FIXED_NOW })
    const r = go(['replay', put(d, 'v.json', v), '--extraction', put(d, 'doc.json', clean)])
    expect(r.code).toBe(1)
    expect(r.json()).toMatchObject({ input_ok: false, status: 'FAILED', input_mismatch: { differs: ['contract'] } })
    expect(r.err).toContain('it was issued with a contract, and none was supplied (--contract)')
  })

  it('a verdict that records no per-input hashes says so, after the sentence it always had', () => {
    const v = verify(clean, { now: FIXED_NOW }) as unknown as Record<string, unknown>
    const { document: _d, references: _r, ...bare } = v
    const inputs = { extraction: { ...clean, total: 1 }, references: { contract: null, evidence: [], history: [] }, source: null }
    const r = verifyReplay(bare as unknown as Verdict, inputs)
    expect(r.input_mismatch).toEqual({ differs: [], agrees: [], unrecorded: ['tolerance'], recorded: false })
    expect(r.reason).toBe(`${PREFIX}: recorded ${v.input_hash as string}, computed ${hashOf(inputs)} — this verdict is not for these inputs. This verdict records no per-input hashes, so which input disagrees cannot be told. If it was issued under a rounding-tolerance override, restate it: the input identity includes the override`)
  })

  it('inputs of another shape keep the sentence they always had, byte for byte, and gain no field', () => {
    const v = verify(clean, { now: FIXED_NOW })
    const r = verifyReplay(v, { not: 'these' })
    expect(r.reason).toBe(`${PREFIX}: recorded ${v.input_hash}, computed ${hashOf({ not: 'these' })} — this verdict is not for these inputs`) // 2026-10-05: both hashes, labelled
    expect(r.input_mismatch).toBeUndefined()
  })

  it('declarativeReplayNeeds reads only declarative verdicts: not a built-in one, not an action, not garbage', () => {
    const n18 = JSON.parse(readFileSync(BUNDLE, 'utf8')) as Verdict
    expect(isDeclarativeVerdict(n18)).toBe(true)
    expect(replayNeedsSentence(declarativeReplayNeeds(n18)!)).toBe(NEEDS_N18)
    expect(declarativeReplayNeeds(verify(clean, { now: FIXED_NOW }))).toBeUndefined()
    expect(declarativeReplayNeeds(verifyAction({ tool: 'wire', arguments: { to: '9' } }, { allowed: { to: ['9'] } }, { now: FIXED_NOW }))).toBeUndefined()
    for (const junk of [null, 7, [], {}, { verdict_id: 'x' }]) expect(declarativeReplayNeeds(junk)).toBeUndefined()
  })

  it('engine 0.5.0 records the judge\'s choice values and hashed archive files: both become needs', () => {
    const n18 = JSON.parse(readFileSync(BUNDLE, 'utf8')) as Verdict
    const v = { ...n18, choices: [{ id: 'weights', source: { default: 'none', by: 'judge' } }, { id: 'flags', source: { default: 'argo', by: 'ruleset' } }], archives: [{ matched: 'archive_files[0]' }, { matched: 'archive_files[1]' }] }
    const n = declarativeReplayNeeds(v)!
    expect(n.needs.map(x => x.input)).toEqual(['extraction', 'ruleset', 'source', 'supplied-choices', 'archive-file'])
    expect(n.issued_with).toBe('page text, the judge\'s choice values, 2 archive files and an external extraction')
    expect(replayNeedsSentence(n, { extraction: true, ruleset: true, source: true, 'archive-file': 1 })).toMatch(/; this call leaves out --supplied-choices and --archive-file$/)
    expect(replayNeedsSentence(n, { extraction: true, ruleset: true, source: true, 'supplied-choices': true, 'archive-file': 2 })).not.toContain('leaves out')
  })
})
