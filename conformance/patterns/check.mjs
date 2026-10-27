// SPDX-License-Identifier: Apache-2.0
// The conformance check for riposte.pattern/0.1.0, for any implementation, with no dependencies (Node.js 20 or later).
// Import it from any test runner and assert that `failures` is empty:
//
//   import { check } from '<path to>/conformance/patterns/check.mjs'
//   const { passed, failures, parts } = check({ compile, firstMatch, fold })   // parts: the passes, counted by part
//
// impl.compile(source, flags, options)  required: a compiled pattern; throws an error with `.code` and `.at` for a pattern
//                                       outside the dialect; options.table, when given, is the class table to read
// impl.firstMatch(compiled, text)       required: { answer: 'match' | 'no match' | "can't tell", span?: [start, end] }, the
//                                       span in UTF-16 code units of the text
// impl.fold(text, map, options)         optional: the table's character map applied code point by code point
// impl.rewrite(source, flags, options)  optional: the catalogue of rewrites (rewrite.mjs offers it; a reader need not)
// impl.tableBytes()                     optional: the bytes of the class table the implementation reads
//
// Run as a program, it checks translate.mjs and rewrite.mjs beside it and prints `passed N, failures M`:
//   node conformance/patterns/check.mjs
// Exit 0: every case as expected. Exit 1: at least one was not. Exit 3: vectors.json or the translator cannot be read.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const CASES = new URL('./vectors.json', import.meta.url)
export const TABLE = new URL('./unicode-classes.json', import.meta.url)

export function loadCases() {
  return JSON.parse(readFileSync(CASES, 'utf8'))
}

/** A formula over pattern answers: a name, { all }, { any } or { not }; true, false, or null for can't tell. */
export function holds(f, answers) {
  if (typeof f === 'string') return answers[f] === "can't tell" ? null : answers[f] === 'match'
  if (f.all) { const v = f.all.map((x) => holds(x, answers)); return v.includes(false) ? false : v.includes(null) ? null : true }
  if (f.any) { const v = f.any.map((x) => holds(x, answers)); return v.includes(true) ? true : v.includes(null) ? null : false }
  if (f.not !== undefined) { const v = holds(f.not, answers); return v === null ? null : !v }
  throw new Error(`unknown formula ${JSON.stringify(f)}`)
}

export function check(impl, opts = {}) {
  if (!impl || typeof impl.compile !== 'function' || typeof impl.firstMatch !== 'function') throw new TypeError('check(impl): impl.compile and impl.firstMatch are required')
  const cases = opts.cases ?? loadCases()
  const failures = []
  let passed = 0
  const same = (got, want, span) => got.answer === want && (span === undefined || JSON.stringify(got.span) === JSON.stringify(span))
  const show = (s) => JSON.stringify(s).slice(0, 80)
  const probe = (part, name, compiled, p) => {
    let got
    try { got = impl.firstMatch(compiled, p.text) } catch (e) { failures.push(`${part}, ${name}, ${show(p.text)}: threw ${e && e.message}`); return }
    if (same(got, p.expect, p.span)) passed++
    else failures.push(`${part}, ${name}, ${show(p.text)}: got ${got.answer}${got.span ? ` ${JSON.stringify(got.span)}` : ''}, expected ${p.expect}${p.span ? ` ${JSON.stringify(p.span)}` : ''}`)
  }
  const compileOr = (part, name, source, flags, options) => {
    try { return impl.compile(source, flags, options) } catch (e) { failures.push(`${part}, ${name}: refused (${e && e.code} at ${e && e.at}), expected it to be read`); return null }
  }

  const parts = {}
  let mark = passed
  const part = (name) => { parts[name] = passed - mark; mark = passed }
  if (typeof impl.tableBytes === 'function') {
    const sha = createHash('sha256').update(impl.tableBytes()).digest('hex')
    if (sha === cases.table.sha256) passed++
    else failures.push(`table: sha256 ${sha}, expected ${cases.table.sha256}`)
  }
  part('table')
  for (const c of cases.constructs) {
    const comp = compileOr('construct', c.name, c.pattern, c.flags)
    if (comp) for (const p of c.probes) probe('construct', c.name, comp, p)
  }
  part('constructs')
  for (const c of cases.refusals) {
    try {
      impl.compile(c.pattern, c.flags)
      failures.push(`refusal, ${c.name}: accepted, expected ${c.expect.refused} at ${c.expect.at}`)
    } catch (e) {
      if (e && e.code === c.expect.refused && e.at === c.expect.at) passed++
      else failures.push(`refusal, ${c.name}: ${e && e.code} at ${e && e.at}, expected ${c.expect.refused} at ${c.expect.at}`)
    }
  }
  part('refusals')
  for (const c of cases.rewrites) {
    if (typeof impl.rewrite === 'function') {
      const r = impl.rewrite(c.from.source, c.from.flags, { unicodeFold: c.rule === 'R-UFOLD' })
      if (r && r.source === c.to.source && r.flags === c.to.flags) passed++
      else failures.push(`rewrite, ${c.name}: the catalogue wrote ${r ? show(r.source) : 'nothing'}, expected ${show(c.to.source)}`)
    }
    const comp = compileOr('rewrite', c.name, c.to.source, c.to.flags)
    if (comp) for (const p of c.probes) probe('rewrite', c.name, comp, p)
  }
  part('rewrites')
  for (const c of cases.table_cases) {
    const comp = compileOr('table', c.name, c.pattern, c.flags, { table: cases.doctored_table })
    if (comp) for (const p of c.probes) probe('table', c.name, comp, p)
  }
  part('table_cases')
  if (typeof impl.fold === 'function') {
    for (const c of cases.folds) {
      const got = impl.fold(c.text, c.map)
      if (got === c.expect) passed++
      else failures.push(`fold, ${c.name}: got ${show(got)}, expected ${show(c.expect)}`)
    }
  }
  part('folds')
  let readings = 0
  const w = cases.worked
  const comps = {}
  for (const [k, p] of Object.entries(w.patterns)) comps[k] = compileOr('worked', k, p.re, p.flags)
  if (Object.values(comps).every(Boolean)) {
    for (const row of w.probes) {
      const answers = {}
      for (const [k, c] of Object.entries(comps)) {
        answers[k] = impl.firstMatch(c, row.text).answer
        if ((answers[k] === 'match') === row.patterns[k] && answers[k] !== "can't tell") passed++
        else failures.push(`worked, ${k}, ${show(row.text)}: got ${answers[k]}, expected ${row.patterns[k] ? 'match' : 'no match'}`)
      }
      const r = holds(w.when, answers)
      if (r === row.reading) { passed++; readings++ }
      else failures.push(`worked, the reading, ${show(row.text)}: got ${r}, expected ${row.reading}`)
    }
  }
  parts.worked_patterns = passed - mark - readings
  parts.worked_readings = readings
  return { passed, failures, parts }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let impl
  let cases
  try {
    cases = loadCases()
    const t = await import(new URL('./translate.mjs', import.meta.url))
    const r = await import(new URL('./rewrite.mjs', import.meta.url))
    impl = { compile: t.compile, firstMatch: t.firstMatch, fold: t.fold, rewrite: r.rewrite, tableBytes: () => readFileSync(TABLE) }
  } catch (e) {
    console.log(`cannot read the vectors or the translator: ${e && e.message}`)
    process.exit(3)
  }
  const { passed, failures, parts } = check(impl, { cases })
  for (const f of failures) console.log(f)
  console.log(Object.entries(parts).map(([k, v]) => `${k} ${v}`).join(', '))
  console.log(`node ${process.versions.node}: passed ${passed}, failures ${failures.length}`)
  process.exit(failures.length ? 1 : 0)
}
