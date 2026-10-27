/**
 * Tables held from a tree: declared by name in `docs/bench/_held.json` (bench-held/1), by whoever assembles the tree (an export
 * that leaves a table out). A held table's `<id>.json` and its folder are not in the tree. Its misses stay in the ledger, every
 * row unchanged and in its place, because the ledger never drops a row: regeneration keeps a held table's rows as recorded
 * (bench/ledger.ts `mergeLedger`), `MISSES.md` marks each one "table held: not yet published", and `BENCH.md` lists the held
 * tables by name with no numbers. Nothing here decides what is held, and with no list every page reads as before.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FIGURE_PERCENT, FIGURE_RATIO } from './marker.js'

export const HELD_FORMAT = 'bench-held/1'
/** The list's file name inside a tables directory (a leading underscore: never read as a table). */
export const HELD_FILE = '_held.json'
/** The words a held table's ledger rows carry on `MISSES.md`, after the table's id. */
export const HELD_MARK = 'table held: not yet published'

export interface HeldTable {
  /** The table id, as the ledger's rows name it. */
  id: string
  /** Why it is held, in words; printed on `BENCH.md`, so it may carry no figure. */
  reason: string
}
export interface HeldList { format: typeof HELD_FORMAT; tables: HeldTable[] }

const ID = /^[a-z0-9][a-z0-9._-]*$/

/**
 * What is wrong with a parsed held list, given the ids of the tables the directory holds and the ids of its folders. A held
 * table must be absent: neither its `<id>.json` nor its folder may be in the tree.
 */
export function heldProblems(x: unknown, tables: ReadonlySet<string>, folders: ReadonlySet<string> = new Set()): string[] {
  const o = x as HeldList
  if (typeof x !== 'object' || x === null || o.format !== HELD_FORMAT || !Array.isArray(o.tables)) return [`not a ${HELD_FORMAT} list ({ "format": "${HELD_FORMAT}", "tables": [{ "id", "reason" }] })`]
  const out: string[] = []
  const seen = new Set<string>()
  o.tables.forEach((t, i) => {
    const at = `tables[${i}]`
    if (typeof t !== 'object' || t === null || typeof t.id !== 'string' || !ID.test(t.id)) { out.push(`${at}: an id of lower-case letters, digits, dots, dashes or underscores`); return }
    if (seen.has(t.id)) out.push(`${at}: ${t.id} is listed twice`)
    seen.add(t.id)
    if (typeof t.reason !== 'string' || !t.reason.trim()) out.push(`${at}: ${t.id} names no reason`)
    else if ([FIGURE_PERCENT, FIGURE_RATIO].some(re => [...t.reason.matchAll(re)].length)) out.push(`${at}: ${t.id}'s reason carries a figure; a held table's line prints no numbers`)
    if (tables.has(t.id)) out.push(`${at}: ${t.id} is held, but ${t.id}.json is in the directory`)
    if (folders.has(t.id)) out.push(`${at}: ${t.id} is held, but its folder is in the directory`)
  })
  return out
}

/** The held table ids (empty with no list). */
export const heldIds = (h: HeldList | null | undefined): Set<string> => new Set((h?.tables ?? []).map(t => t.id))

/**
 * The held list of a tables directory: null with no `_held.json`. `problems` (from `heldProblems`, or the file not being JSON)
 * is non-empty when the list cannot be used; `bench index` then writes nothing and `bench check` fails.
 */
export function readHeld(dir: string, tableIds: ReadonlySet<string>): { held: HeldList | null; problems: string[] } {
  const p = join(dir, HELD_FILE)
  if (!existsSync(p)) return { held: null, problems: [] }
  let x: unknown
  try { x = JSON.parse(readFileSync(p, 'utf8')) } catch (e) { return { held: null, problems: [`${HELD_FILE} is not JSON: ${(e as Error).message}`] } }
  const folders = new Set(readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name))
  const problems = heldProblems(x, tableIds, folders)
  return { held: problems.length ? null : (x as HeldList), problems }
}
