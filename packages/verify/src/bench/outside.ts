/**
 * Numbers published outside the bench rule (bench-outside/1, `docs/bench/_outside.json`).
 *
 * The bench rule covers the tables on docs/BENCH.md. Some accuracy numbers the project publishes are not bench tables: their
 * prereg is not in this tree, or was never hashed in a form the tool reads, or the number is a measurement with no prereg at
 * all. Each such number is listed here: where it is published, the numbers as published, and one line on why it sits outside
 * the rule. The list is printed on docs/BENCH.md under "Outside the rule". Nothing on it is a bench number, and nothing on it
 * can become one by an edit to this list: a number joins the rule only as a table emitted from its own folder.
 */

export const OUTSIDE_FORMAT = 'bench-outside/1'

export interface OutsideEntry {
  id: string
  title: string
  /** Where the numbers are published: the page and section a reader opens. */
  where: string
  /** The numbers, restated as published. */
  numbers: string
  /** Why they sit outside the bench rule, in one line. */
  reason: string
}

export interface OutsideList { format: typeof OUTSIDE_FORMAT; entries: OutsideEntry[] }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Every problem with an outside-the-rule list ([] when well formed). `tables` are the ids that have a table: none may repeat. */
export function outsideProblems(x: unknown, tables: ReadonlySet<string> = new Set()): string[] {
  if (!isObj(x) || x.format !== OUTSIDE_FORMAT || !Array.isArray(x.entries)) return [`not a ${OUTSIDE_FORMAT}`]
  const out: string[] = []
  const seen = new Set<string>()
  x.entries.forEach((e, i) => {
    const at = `entries[${i}]`
    if (!isObj(e) || typeof e.id !== 'string' || !ID.test(e.id)) { out.push(`${at} needs a plain id`); return }
    if (seen.has(e.id)) out.push(`${at}: duplicate id ${e.id}`)
    seen.add(e.id)
    if (tables.has(e.id)) out.push(`${at}: ${e.id} is a bench table; a table is never also outside the rule`)
    for (const k of ['title', 'where', 'numbers', 'reason'] as const) if (typeof e[k] !== 'string' || !(e[k] as string).trim()) out.push(`${at}: ${k} is required`)
    if (typeof e.reason === 'string' && /\n/.test(e.reason)) out.push(`${at}: the reason is one line`)
  })
  return out
}

export const outsideBytes = (l: OutsideList): string => `${JSON.stringify(l, null, 2)}\n`
