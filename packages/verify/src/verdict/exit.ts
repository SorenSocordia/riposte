/**
 * The exit reading (2026-10-05): what a verdict, or an AP decision, means to a caller that acts on it, failing closed.
 * One reading for every entry point, so the CLI's exit code, the HTTP response headers and the MCP gate line never disagree:
 *
 *   exit 0  a clean PASS: every deterministic check ran and held (an AP approve also needs `payable` true)
 *   exit 1  FAIL, or HELD-SUSPECT (a value could not be read and a reading one character away fails: booked as a FAIL)
 *   exit 2  PASS-WITH-OPEN or OPEN (every check that ran held, but one could not run, or a load-bearing field is struck),
 *           INSUFFICIENT_DATA (no check could run), and an AP abstain
 *
 * "A CI user wiring exit codes gets fail-open by default" (a cold reader, cold review round 2): PASS-WITH-OPEN used to exit 0 unless the caller
 * asked for the gate reading. Now the gate reading is the default. A caller who wants the old reading states it (`allowOpen`:
 * the CLI's --allow-open, the HTTP and MCP `allow_open: true`): an open verdict whose checks that ran all held then reads exit 0,
 * and the reading says it was the caller's stated choice. Nothing here changes a verdict: the verdict already records the gate
 * reading as `gate_status` (engine 0.6.0), and its bytes are the same whichever entry point reads it.
 * 2026-10-19: the stated choice is narrowed to open checks that wait on a reference not given or a field the document does not
 * carry (ALLOW_OPEN_REASONS), with no struck field; any other open check keeps exit 2 and is named (`allow_open_refused`).
 */
import type { Verdict } from './schema.js'
import { gateLabel, openClaims, heldSuspectClaims, type GateLabel } from './aggregation.js'
import { abstainsOnlyForMissingHistory } from '../ap/decide.js'

export interface ExitReading {
  /** What a person reads at the gate (aggregation.ts gateLabel). */
  gate: GateLabel
  /** The exit code a command line gives this reading (and the `x-verify-exit` header, and the MCP gate line). */
  exit: 0 | 1 | 2
  /** One sentence: why this exit. */
  words: string
  /** Present when `allowOpen` changed the exit (2 → 0): the caller's stated choice. */
  allow_open?: true
  /**
   * Present when `allowOpen` was stated and did not apply (2026-10-19): the open checks it does not accept, each with the reason
   * it could not run (empty when only a struck field kept it from applying).
   */
  allow_open_refused?: { claim_id: string; reason: string }[]
}

type ExitVerdict = Pick<Verdict, 'outcome' | 'claims'> & { struck?: readonly unknown[]; would_unlock?: Verdict['would_unlock'] }

/**
 * The reasons an open check may have for allow-open to accept it (2026-10-19; a cold reader, platform engineer's role): a
 * reference the caller did not give (a contract, a receipt, a payment history) and a field the document does not carry. Both
 * leave a check the caller can settle by supplying something. A figure that is present but could not be read ("1600.0O" for
 * 1600.00), a field found only by a fuzzy name, an ambiguous unit or reference, a quotation not found or cut, or a check outside
 * the ruleset's scope is not accepted: one unreadable character used to hide an amount wrong by 100 behind exit 0.
 */
export const ALLOW_OPEN_REASONS: ReadonlySet<string> = new Set(['REFERENCE_NOT_PROVIDED', 'FIELD_MISSING'])

/** The exit reading of a verdict. */
export function verdictExit(v: ExitVerdict, allowOpen = false): ExitReading {
  const gate = gateLabel(v)
  if (gate === 'FAIL') return { gate, exit: 1, words: 'a check failed' }
  if (gate === 'HELD-SUSPECT') return { gate, exit: 1, words: `${heldSuspectClaims(v).length} check(s) could not read a value, and a reading one character away fails the check; a gate books it as a FAIL` }
  if (gate === 'PASS') return { gate, exit: 0, words: 'every check ran and held' }
  if ((gate === 'PASS-WITH-OPEN' || gate === 'OPEN') && v.outcome === 'PASS') {
    const open = openClaims(v)
    const parts = [
      ...(open.length ? [`${open.length} check(s) could not run: ${open.map(c => c.claim_id).join(', ')}`] : []),
      ...(gate === 'OPEN' ? [`${(v.struck ?? []).length} load-bearing field(s) are struck`] : []),
    ]
    const what = parts.join('; ')
    if (allowOpen) {
      // 2026-10-19: allow-open accepts an open check only for want of a reference or of a field the document does not carry,
      // and never a struck field (OPEN); anything else stays exit 2 and is named with its reason (ALLOW_OPEN_REASONS)
      const refused = open.filter(c => !ALLOW_OPEN_REASONS.has(String(c.insufficiency?.reason)))
        .map(c => ({ claim_id: c.claim_id, reason: typeof c.insufficiency?.reason === 'string' ? c.insufficiency.reason : 'no reason stated' }))
      const struck = gate === 'OPEN'
      if (!refused.length && !struck) return { gate, exit: 0, words: `exit 0 by allow-open, the caller's stated choice: every check that ran held, but ${what}; a gate would hold`, allow_open: true }
      const why = [
        ...(refused.length ? [`${refused.map(c => `${c.claim_id} (${c.reason})`).join(', ')} could not run for another reason`] : []),
        ...(struck ? ['a load-bearing field is struck'] : []),
      ].join('; ')
      return { gate, exit: 2, words: `fails closed: every check that ran held, but ${what}; allow-open does not apply: it accepts only checks that could not run for want of a reference (REFERENCE_NOT_PROVIDED) or of a field the document does not carry (FIELD_MISSING), and ${why}`, allow_open_refused: refused }
    }
    return { gate, exit: 2, words: `fails closed: every check that ran held, but ${what}` }
  }
  return { gate, exit: 2, words: gate === 'INSUFFICIENT_DATA' ? 'no check could run' : 'a load-bearing field is struck and no check could run' }
}

/** An AP result as the exit reading takes it (src/ap: verifyInvoiceMatch, verifyBillMatch). */
export interface ApExitInput { decision: string; payable?: boolean | null; verdict: ExitVerdict }

/**
 * The exit reading of an AP decision, with the word a person reads first. An approve pays (exit 0) only when the gate pays on
 * it: its verdict is a clean PASS and `payable` is not false or null. Under engine 0.6.0 the AP gate itself abstains on a bill a
 * check could not run on (src/ap/decide.ts), so an abstain reads A PERSON DECIDES and exits 2.
 *
 * allow-open on an AP decision reaches exactly one case: an abstain whose only open check is the duplicate check, skipped for
 * want of a payment history, with every other check passed (src/ap/decide.ts abstainsOnlyForMissingHistory, the AP gate's own
 * test). It never reaches a look-alike vendor (a hold), a line with no goods-receipt line, an ambiguous duplicate, a currency
 * mismatch or an unreadable field: those stay exit 2 whatever the caller states. The decision object keeps saying 'abstain'.
 * (An approve over an open verdict, which this build's gate no longer issues, is still read as A PERSON DECIDES.)
 */
export function apExit(r: ApExitInput, allowOpen = false): ExitReading & { word: string } {
  const gate = gateLabel(r.verdict)
  if (r.decision === 'abstain') {
    if (allowOpen && abstainsOnlyForMissingHistory(r as Parameters<typeof abstainsOnlyForMissingHistory>[0])) {
      return { gate, exit: 0, word: 'A PERSON DECIDES, exit 0 by allow-open', words: 'exit 0 by allow-open, the caller\'s stated choice: the duplicate check did not run (no payment history was given) and every other check passed; the AP gate abstains', allow_open: true }
    }
    return { gate, exit: 2, word: 'A PERSON DECIDES', words: 'the AP gate sends this bill to a person' }
  }
  if (r.decision !== 'approve') return { gate, exit: 1, word: `HOLD (${r.decision})`, words: `the gate holds (${r.decision})` }
  if (gate === 'FAIL' || gate === 'HELD-SUSPECT') return { gate, exit: 1, word: `HOLD (the verdict reads ${gate})`, words: `the verdict reads ${gate}` }
  const open = openClaims(r.verdict)
  const isOpen = gate !== 'PASS'
  if (!isOpen && r.payable !== false && r.payable !== null) return { gate, exit: 0, word: 'APPROVE', words: 'every check ran and passed' }
  const what = isOpen
    ? open.length ? `every check that ran passed, but ${open.map(c => c.claim_id).join(', ')} could not run` : 'every check that ran passed, but a load-bearing field is struck'
    : 'the gate does not pay on it (payable is not true)'
  if (allowOpen && (gate === 'PASS-WITH-OPEN' || gate === 'OPEN')) {
    return { gate, exit: 0, word: 'A PERSON DECIDES (approve held), exit 0 by allow-open', words: `exit 0 by allow-open, the caller's stated choice: ${what}; the gate holds`, allow_open: true }
  }
  return { gate, exit: 2, word: `A PERSON DECIDES (${what})`, words: `fails closed: ${what}` }
}

/** The headers an HTTP response carries for an exit reading (lower-case names, string values). */
export function exitHeaders(d: ExitReading): Record<string, string> {
  return { 'x-verify-gate': d.gate, 'x-verify-exit': String(d.exit), ...(d.allow_open ? { 'x-verify-allow-open': 'stated' } : {}) }
}

/** The line an MCP verdict tool's result leads with (its first text item, before the JSON): `gate: PASS-WITH-OPEN · exit 2: ...`. */
export function exitLine(d: ExitReading & { word?: string }): string {
  return `gate: ${d.word ?? d.gate} · exit ${d.exit}${d.exit === 0 ? '' : ' (do not act on it as passed)'}: ${d.words}`
}
