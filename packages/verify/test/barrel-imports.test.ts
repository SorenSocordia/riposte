/**
 * The package barrel (src/index.ts) is only a list of re-exports, and nothing under src/ loads it at runtime (core-tidy,
 * 2026-09-29). A module that imports the barrel from inside makes a cycle, and every bundle that reaches it (the action hook
 * reaches verdict/voice.ts → verdict/channel.ts → protocol/replay.ts) pulls the whole package in. verify() lives in
 * src/verify.ts; import it from there.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const BARREL = join(SRC, 'index.ts')
/** Runtime importers still waiting on their owner's one-line patch (tmp/core-tidy/http-mcp-barrel.patch). Never add to it. */
const PENDING = new Set<string>() // emptied 09-29: the http/mcp barrel patch landed; no module may import the barrel

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) files(p, out)
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p)
  }
  return out
}
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

/** Runtime import/export-from edges of one module (type-only statements dropped), resolved to .ts files. */
function edges(file: string): string[] {
  const text = stripComments(readFileSync(file, 'utf8'))
  const out: string[] = []
  for (const m of text.matchAll(/(?:^|\n)\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s+'(\.[^']+)'/g)) {
    if (m[2]) continue
    const spec = m[4]!
    const ts = resolve(dirname(file), spec.replace(/\.js$/, '.ts'))
    out.push(existsSync(ts) ? ts : resolve(dirname(file), spec, 'index.ts'))
  }
  for (const m of text.matchAll(/(?:^|\n)\s*import\s+'(\.[^']+)'/g)) out.push(resolve(dirname(file), m[1]!.replace(/\.js$/, '.ts')))
  return out
}

const ALL = files(SRC)
const GRAPH = new Map(ALL.map(f => [f, edges(f)]))
const rel = (f: string): string => relative(SRC, f).split('\\').join('/')
function reaches(from: string, to: string): boolean {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    for (const n of GRAPH.get(stack.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n) }
  }
  return seen.has(to)
}

describe('the package barrel', () => {
  it('only re-exports: verify() and every other definition live in their own modules', () => {
    const rest = stripComments(readFileSync(BARREL, 'utf8'))
      .replace(/export\s+(type\s+)?(\*|\{[^}]*\})\s*(as\s+\w+\s*)?from\s+'[^']+'/g, '')
    expect(rest.trim()).toBe('')
  })

  it('no module under src/ imports it at runtime (bar the pending patch)', () => {
    const importers = ALL.filter(f => f !== BARREL && GRAPH.get(f)!.includes(BARREL)).map(rel)
    expect(importers.filter(f => !PENDING.has(f))).toEqual([])
  })

  it('replay, voice, channel, verify and the CLI never reach it', () => {
    for (const m of ['protocol/replay.ts', 'verdict/voice.ts', 'verdict/channel.ts', 'verify.ts', 'cli.ts', 'anchor/index.ts']) {
      expect(reaches(join(SRC, m), BARREL), m).toBe(false)
    }
  })

  it('the scan sees a real edge (negative control: the barrel reaches replay)', () => {
    expect(GRAPH.get(BARREL)!.length).toBeGreaterThan(20)
    expect(reaches(BARREL, join(SRC, 'protocol', 'replay.ts'))).toBe(true)
    expect(GRAPH.get(join(SRC, 'protocol', 'replay.ts'))).toContain(join(SRC, 'verify.ts'))
  })
})
