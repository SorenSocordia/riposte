/**
 * Generated blocks, and the reference check that every published figure sits inside one.
 *
 * The bench index writes each table, the refusal list and the misses ledger into a fenced block:
 *
 *   <!-- bench:begin table=<id> sha256=<sha256 of docs/bench/<id>.json> -->
 *   …generated Markdown…
 *   <!-- bench:end -->
 *
 * (`refused=refused` names `docs/bench/_refused.json`; `ledger=misses` names `docs/bench/_misses-ledger.json`;
 * `provenance=provenance` names `docs/bench/_provenance.json`; `outside=outside` names `docs/bench/_outside.json`.) The sha256 is
 * of the JSON file's bytes, so a reader, or the export scan, can check that a block is the current rendering of its table.
 *
 * `findBareFigures` is the reference for the proposed export-scan check: a percentage (`55.0%`, `16 %`) or a k/n figure
 * (`11/20`, `0 / 20`) outside a generated block is a hit unless an allowance covers it. The export scan carries its own copy
 * of these expressions (it imports nothing from this package); this module is the tested statement of them.
 */

export const BLOCK_KINDS = ['table', 'refused', 'ledger', 'provenance', 'outside'] as const
export type BlockKind = typeof BLOCK_KINDS[number]

export const BLOCK_BEGIN_RE = /^<!-- bench:begin (table|refused|ledger|provenance|outside)=([A-Za-z0-9][A-Za-z0-9._-]*) sha256=([0-9a-f]{64}) -->$/
export const BLOCK_END = '<!-- bench:end -->'

export const blockBegin = (kind: BlockKind, id: string, sha256: string): string => `<!-- bench:begin ${kind}=${id} sha256=${sha256} -->`

/** A percentage: digits (with an optional decimal part) followed by `%`, not inside a word or a longer number. */
export const FIGURE_PERCENT = /(?<![\w.,])\d+(?:[.,]\d+)?\s?%/g
/**
 * A k/n figure: two integers around a slash, not part of a path, a date, a URL or a version (`a/1`, `2026/10/03`, `x/2/3`,
 * `1/2.5`). A sentence's closing period after the figure does not hide it.
 */
export const FIGURE_RATIO = /(?<![\w./:\\-])\d+\s?\/\s?\d+(?![\w/\\-]|\.\d)/g

export interface FigureAllowance {
  /** The exported path the allowance applies to (`packages/verify/docs/RULESETS.md`). */
  file: RegExp
  /** The line context the figure must sit in. */
  line: RegExp
  /** Why the figure is not a published accuracy number. */
  why: string
}

export interface BareFigure { line: number; figure: string; text: string }

export interface BlockProblem { line: number; problem: string }

/** The generated blocks in a text, and any malformed fencing (an unclosed block, a nested one, an end without a begin). */
export function blocksOf(text: string): { blocks: { kind: BlockKind; id: string; sha256: string; from: number; to: number }[]; problems: BlockProblem[] } {
  const blocks: { kind: BlockKind; id: string; sha256: string; from: number; to: number }[] = []
  const problems: BlockProblem[] = []
  let open: { kind: BlockKind; id: string; sha256: string; from: number } | null = null
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '').trim()
    const m = line.match(BLOCK_BEGIN_RE)
    if (m) {
      if (open) problems.push({ line: i + 1, problem: `a block opens inside the block opened at line ${open.from}` })
      open = { kind: m[1] as BlockKind, id: m[2]!, sha256: m[3]!, from: i + 1 }
      return
    }
    if (line.startsWith('<!-- bench:begin')) { problems.push({ line: i + 1, problem: 'a malformed block marker' }); return }
    if (line === BLOCK_END) {
      if (!open) problems.push({ line: i + 1, problem: 'a block end with no block open' })
      else { blocks.push({ ...open, to: i + 1 }); open = null }
    }
  })
  if (open) problems.push({ line: (open as { from: number }).from, problem: 'a block is never closed' })
  return { blocks, problems }
}

/** Every percentage or k/n figure outside a generated block that no allowance covers. */
export function findBareFigures(text: string, rel = '', allow: readonly FigureAllowance[] = []): BareFigure[] {
  const { blocks } = blocksOf(text)
  const inside = (n: number): boolean => blocks.some(b => n >= b.from && n <= b.to)
  const out: BareFigure[] = []
  text.split('\n').forEach((raw, i) => {
    const n = i + 1
    if (inside(n)) return
    const line = raw.replace(/\r$/, '')
    for (const re of [FIGURE_PERCENT, FIGURE_RATIO]) {
      for (const m of line.matchAll(re)) {
        if (allow.some(a => a.file.test(rel) && a.line.test(line))) continue
        out.push({ line: n, figure: m[0], text: line.trim().slice(0, 140) })
      }
    }
  })
  return out
}
