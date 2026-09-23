/**
 * Text normalization for source-text verification — with a CHARACTER-OFFSET MAP back to the original.
 *
 * The map is the point: after we find a normalized quote inside a normalized opinion, we must report the span in the
 * ORIGINAL text (the reviewer reads the real document, not our normalized copy). Every transformation here is therefore
 * either 1:1, an expansion (all output chars map to the one source offset), or a deletion (mapped away) — never a
 * length change we can't trace.
 *
 * Two profiles:
 *   'legal' — case-folded, punctuation/whitespace/hyphenation tolerant. For "does this quoted passage appear verbatim".
 *   'value' — NOT case-folded (numbers don't have case); whitespace collapsed. For "does this number appear in the text".
 *
 * Deliberately NOT tolerated (kept as a safe false-negative → abstain, never a false PASS):
 *   bracketed editorial insertions ("[e]dited"), omitted-word ellipses inside a quote (handled at the matcher via
 *   nearest-passage, not by silently deleting text). We would rather say "can't confirm verbatim" than approve a
 *   quote we did not actually find.
 */

export type Profile = 'legal' | 'value'

export interface Mapped {
  /** The normalized text. */
  text: string
  /** map[i] = offset in `original` of normalized char i. length === text.length. */
  map: number[]
  original: string
}

const QUOTE_MAP: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
  '«': '"', '»': '"', '‹': "'", '›': "'",
  '`': "'", '´': "'",
}
const DASHES = new Set(['‐', '‑', '‒', '–', '—', '―', '−'])

function isSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === ' '
}
function isHyphenOrDash(c: string): boolean {
  return c === '-' || DASHES.has(c)
}

/**
 * Normalize `src` under `profile`, producing the text plus a per-character map back to original offsets.
 */
export function normalizeMapped(src: string, profile: Profile): Mapped {
  const out: string[] = []
  const map: number[] = []
  const n = src.length
  const push = (ch: string, srcOffset: number): void => {
    for (let k = 0; k < ch.length; k++) { out.push(ch[k] as string); map.push(srcOffset) }
  }

  let i = 0
  while (i < n) {
    const c = src[i] as string

    // Line-break hyphenation: "exam-\nple" → "example". Hyphen/dash + optional spaces + newline → drop the join entirely.
    if (isHyphenOrDash(c)) {
      let k = i + 1
      while (k < n && (src[k] === ' ' || src[k] === '\t')) k++
      if (k < n && (src[k] === '\n' || src[k] === '\r')) {
        i = k
        while (i < n && isSpace(src[i] as string)) i++
        continue
      }
      push('-', i); i++; continue
    }

    // Whitespace run → single space, mapped to the first whitespace offset.
    if (isSpace(c)) {
      const start = i
      while (i < n && isSpace(src[i] as string)) i++
      push(' ', start); continue
    }

    // Unicode ellipsis → three dots, all mapped to the ellipsis offset.
    if (c === '…') { push('...', i); i++; continue }

    // Smart quotes → straight; dashes → hyphen.
    const q = QUOTE_MAP[c]
    if (q !== undefined) { push(q, i); i++; continue }

    // (dashes handled above by isHyphenOrDash when not line-break; standalone dash already emitted as '-')

    push(profile === 'legal' ? c.toLowerCase() : c, i)
    i++
  }

  return { text: out.join(''), map, original: src }
}

/** Map a [start,end) span in normalized space back to an original [start,end). Clamps to the original length. */
export function toOriginalSpan(m: Mapped, normStart: number, normEnd: number): { start: number; end: number } {
  if (m.text.length === 0) return { start: 0, end: 0 }
  const s = Math.max(0, Math.min(normStart, m.text.length - 1))
  const e = Math.max(s, Math.min(normEnd - 1, m.text.length - 1))
  const start = m.map[s] as number
  // end offset: one past the last original char the normalized span covers
  const lastOrig = m.map[e] as number
  return { start, end: lastOrig + 1 }
}

/**
 * Surface forms a number might take in running text, most-specific first. We search for these as digit-bounded tokens,
 * so "1500" never matches inside "215000". Currency symbols / signs are checked at the boundary by the matcher.
 */
export function numberSurfaceForms(value: number): string[] {
  if (!Number.isFinite(value)) return []
  const abs = Math.abs(value)
  const forms = new Set<string>()
  const two = abs.toFixed(2)
  const [ip, fp] = two.split('.') as [string, string]
  const grouped = Number(ip).toLocaleString('en-US')
  forms.add(two)                       // 1500.00
  forms.add(`${grouped}.${fp}`)        // 1,500.00
  const plain = String(abs)            // 1500 or 1500.5
  forms.add(plain)
  if (Number.isInteger(abs)) {
    forms.add(grouped)                 // 1,500
    forms.add(ip)                      // 1500
  } else {
    // non-integer: also the grouped form with its own fractional part
    const [pp, pf] = plain.split('.') as [string, string]
    forms.add(`${Number(pp).toLocaleString('en-US')}.${pf}`)
  }
  return [...forms].filter(s => s.length > 0)
}
