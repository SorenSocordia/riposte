// SPDX-License-Identifier: Apache-2.0
// Writes unicode-classes.json, the pinned class table of riposte.pattern/0.1.0, from this Node's own Unicode tables (the
// version is `process.versions.unicode`, written into the file). Both translators read the file and never their host's
// tables, so a pattern naming a class answers the same under any Unicode a host carries.
//
//   node conformance/patterns/gen-unicode.mjs           writes the table
//   node conformance/patterns/gen-unicode.mjs --check   compares the file with what this Node would write
//
// What it holds:
//   classes.L, Lu, Ll, N, Mn   the code points of each general category class, as [low, high] ranges
//   repertoire                 every code point assigned in that Unicode version, surrogates aside: outside it, a pattern
//                              that names a class answers can't tell
//   cased                      code points above ASCII that take part in case mapping or case folding: the dialect refuses
//                              them under the i flag, whose folding covers ASCII letters only
//   maps.LOOKALIKE             the look-alike letters the AP pack reads as Latin (Cyrillic and Greek), copied by a parse of
//                              its source, packages/verify/src/ap/remittance.ts, never retyped
// Exit 0 written, or the file matches; 1 the file differs (--check); 3 the source of a map cannot be read and the file holds
// no copy of it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = new URL('./', import.meta.url)
const OUT = new URL('./unicode-classes.json', HERE)
const SOURCES = ['../../packages/verify/src/ap/remittance.ts', '../../../verify/src/ap/remittance.ts']
const MAX = 0x10ffff

function ranges(test) {
  const out = []
  let start = -1
  for (let cp = 0; cp <= MAX + 1; cp++) {
    const yes = cp <= MAX && test(cp)
    if (yes && start < 0) start = cp
    if (!yes && start >= 0) { out.push([start, cp - 1]); start = -1 }
  }
  return out
}
const isSurrogate = (cp) => cp >= 0xd800 && cp <= 0xdfff
const prop = (name) => { const re = new RegExp(`^\\p{${name}}$`, 'u'); return (cp) => !isSurrogate(cp) && re.test(String.fromCodePoint(cp)) }

function lookalike() {
  for (const rel of SOURCES) {
    const url = new URL(rel, HERE)
    if (!existsSync(url)) continue
    const text = readFileSync(url, 'utf8')
    const start = text.indexOf('const LOOKALIKE')
    const end = text.indexOf('].map(', start)
    if (start < 0 || end < 0) continue
    const block = text.slice(start, end)
    const line = text.slice(0, start).split('\n').length
    const map = {}
    for (const m of block.matchAll(/\[0x([0-9A-Fa-f]{4,6}), '([^'\\])'\]/g)) map[m[1].toUpperCase().padStart(4, '0')] = m[2]
    return { source: `packages/verify/src/ap/remittance.ts:${line}`, count: Object.keys(map).length, map }
  }
  return null
}

export function build(previous) {
  const cased = new Set()
  for (let cp = 0x80; cp <= MAX; cp++) {
    if (isSurrogate(cp)) continue
    const c = String.fromCodePoint(cp)
    const up = c.toUpperCase()
    const lo = c.toLowerCase()
    if (up !== c || lo !== c) {
      cased.add(cp)
      for (const r of [up, lo]) if ([...r].length === 1 && r.codePointAt(0) > 0x7f) cased.add(r.codePointAt(0))
    }
  }
  const casedProps = [prop('Cased'), prop('Changes_When_Casefolded'), prop('Changes_When_Casemapped')]
  const map = lookalike() ?? previous?.maps?.LOOKALIKE ?? null
  return {
    schema: 'riposte.unicode-classes/0.1.0',
    about: 'The pinned class table of riposte.pattern/0.1.0 (SPEC.md). Ranges are [low, high] code points, inclusive. Written by gen-unicode.mjs from Node.js\'s own tables; both translators read this file, never their host\'s tables.',
    unicode: process.versions.unicode,
    generated_by: `gen-unicode.mjs on Node.js ${process.versions.node}`,
    classes: {
      L: ranges(prop('L')),
      Lu: ranges(prop('Lu')),
      Ll: ranges(prop('Ll')),
      N: ranges(prop('N')),
      Mn: ranges(prop('Mn')),
    },
    repertoire: ranges((cp) => !isSurrogate(cp) && !/^\p{Cn}$/u.test(String.fromCodePoint(cp))),
    cased: ranges((cp) => cp > 0x7f && !isSurrogate(cp) && (cased.has(cp) || casedProps.some((f) => f(cp)))),
    maps: map ? { LOOKALIKE: map } : {},
  }
}

/** One class per line, so a reader can see what changed between two versions of the table. */
export function write(table) {
  const lines = ['{']
  const keys = Object.keys(table)
  keys.forEach((k, n) => {
    const comma = n < keys.length - 1 ? ',' : ''
    if (k === 'classes') {
      lines.push('  "classes": {')
      const ck = Object.keys(table.classes)
      ck.forEach((c, m) => lines.push(`    ${JSON.stringify(c)}: ${JSON.stringify(table.classes[c])}${m < ck.length - 1 ? ',' : ''}`))
      lines.push(`  }${comma}`)
    } else if (k === 'maps') {
      lines.push(`  "maps": ${JSON.stringify(table.maps)}${comma}`)
    } else {
      lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(table[k])}${comma}`)
    }
  })
  lines.push('}')
  return `${lines.join('\n')}\n`
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null
  const table = build(previous)
  if (!table.maps.LOOKALIKE) { console.log('the look-alike map\'s source cannot be read and the table holds no copy of it'); process.exit(3) }
  const text = write(table)
  if (process.argv.includes('--check')) {
    const same = previous && write({ ...table, generated_by: previous.generated_by }) === readFileSync(OUT, 'utf8')
    console.log(same ? `the table matches this Node's tables (Unicode ${table.unicode})` : `the table differs from this Node's tables (this Node reads Unicode ${table.unicode}; the file pins ${previous?.unicode ?? 'nothing'})`)
    process.exit(same ? 0 : 1)
  }
  writeFileSync(OUT, text)
  const count = (r) => r.reduce((a, [x, y]) => a + y - x + 1, 0)
  console.log(`wrote unicode-classes.json: Unicode ${table.unicode}; ${Object.entries(table.classes).map(([k, r]) => `${k} ${count(r)} in ${r.length} ranges`).join(', ')}; repertoire ${count(table.repertoire)}; cased ${count(table.cased)}; LOOKALIKE ${table.maps.LOOKALIKE.count} from ${table.maps.LOOKALIKE.source}`)
}
