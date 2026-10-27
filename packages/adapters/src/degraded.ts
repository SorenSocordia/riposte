/**
 * The action policy's safest rung (2026-10-05, the policy-error ruling).
 *
 * The rule. When the action policy itself cannot be applied (the policy file is missing, unreadable or invalid; the mode
 * RIPOSTE_ACTION_HOOK is misspelled; the hook input is malformed; the check throws), the hook no longer fails open. It fails
 * to the SAFEST rung:
 *   - a CONSEQUENTIAL call (one that moves money or files something) is HELD until the operator fixes the problem: a typed
 *     denial that names the fix ("RIPOSTE_ACTION_HOOK 'enforce' is not one of off/record-only/on; did you mean on?");
 *   - every other call (the record-and-advise class) PROCEEDS, with a `governance degraded` receipt on the action ledger.
 * Document errors (a verdict that FAILs or cannot tell) are not policy errors: they keep their path through the rungs.
 * Friction lands on the operator, once: `riposte-action --doctor` checks the setup at install and prints what the hook would
 * do on each class, and the first held call names the fix. It never lands on the user per transaction.
 *
 * Which class a call is in, strongest evidence first:
 *   1. the policy's own rule for the tool, when the policy text can be read at all (even if it is invalid elsewhere): a rule
 *      at gate or autonomy is consequential; at record or advise it is record-and-advise; a rule whose rung cannot be read
 *      (a misspelling) is consequential (an unknown rung is treated as the strictest);
 *   2. a fully valid policy with no rule for the tool: the tool is not a declared action and passes through, as always;
 *   3. otherwise, the tool's name: a name that moves money or files something (CONSEQUENTIAL_WORDS) is consequential;
 *      any other name is record-and-advise. This is a fallback, used only when the policy cannot say. It errs toward holding.
 *   A call whose tool cannot be read at all is consequential, unless a readable policy declares no gate or autonomy action.
 *
 * In record-only mode nothing is delivered (that mode never enforces); the degraded receipt records what would have happened.
 * A misspelled mode is not a choice of record-only: it enforces the safest rung.
 *
 * THE OPT-OUT. RIPOSTE_ACTION_ON_ERROR=open restores the old fail-open behaviour, loudly: a stderr line on every call it
 * affects, and a degraded receipt that says `on_error: "open"`. Any other value than hold or open is itself reported and
 * read as hold.
 */
import { VOICE_LADDER } from 'riposte-verify'

export type DegradedCode = 'policy.missing' | 'policy.unreadable' | 'policy.invalid' | 'policy.mode_invalid' | 'policy.bad_input' | 'policy.error'
export type CallClass = 'consequential' | 'record-advise'
export type OnError = 'hold' | 'open'

export const ON_ERROR_ENV = 'RIPOSTE_ACTION_ON_ERROR'
export const ON_ERROR_VALUES: readonly OnError[] = ['hold', 'open']
export const DOCTOR_COMMAND = 'riposte-action --doctor'

// ── did you mean ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Optimal string alignment distance (Levenshtein plus adjacent transpositions), case-insensitive. */
export function editDistance(a: string, b: string): number {
  const s = a.toLowerCase(), t = b.toLowerCase()
  const d: number[][] = Array.from({ length: s.length + 1 }, (_, i) => Array.from({ length: t.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1)
    }
  }
  return d[s.length]![t.length]!
}

/** The closest option to `raw`, when it is close enough to be a slip (at most 2 edits, and fewer than half its letters). */
export function didYouMean(raw: string, options: readonly string[]): string | undefined {
  let best: string | undefined, bestD = Infinity
  for (const o of options) { const dd = editDistance(raw, o); if (dd < bestD) { best = o; bestD = dd } }
  return best !== undefined && bestD > 0 && bestD <= 2 && bestD < Math.max(2, Math.ceil(best.length / 2)) ? best : undefined
}

/** "<what> 'x' is not one of a/b/c; did you mean b?" (the ruling's wording). */
export function notOneOf(what: string, raw: string, options: readonly string[]): string {
  const m = didYouMean(raw, options)
  return `${what} '${raw}' is not one of ${options.join('/')}${m ? `; did you mean ${m}?` : ''}`
}

// ── the opt-out ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function onErrorFromEnv(env: Record<string, string | undefined>): { onError: OnError; problem?: string } {
  const raw = (env[ON_ERROR_ENV] ?? '').trim()
  if (!raw) return { onError: 'hold' }
  const v = raw.toLowerCase()
  if ((ON_ERROR_VALUES as readonly string[]).includes(v)) return { onError: v as OnError }
  return { onError: 'hold', problem: `${notOneOf(ON_ERROR_ENV, raw, ON_ERROR_VALUES)}; reading it as hold (the default)` }
}

/** The stderr line printed on every call the opt-out affects. */
export const openLine = (code: DegradedCode): string =>
  `riposte-action: ${ON_ERROR_ENV}=open: failing OPEN on ${code}, as the operator chose (the old behaviour). Consequential calls are NOT held while the action policy cannot be applied. Unset ${ON_ERROR_ENV} to hold them.\n`

// ── the class of a call ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Words in a tool's name that move money or file something. Matched against the name's words (split on _ - . / : space
 * and camelCase), so `mcp__bank__transfer`, `payInvoice` and `submit_filing` match and `read_file` does not ("file" counts
 * only as the first word of the tool's own name, where it is a verb: `file_claim`).
 */
export const CONSEQUENTIAL_WORDS: readonly string[] = [
  'pay', 'pays', 'paid', 'payment', 'payments', 'payout', 'payouts', 'payroll', 'transfer', 'transfers', 'wire', 'wires', 'remit',
  'remittance', 'refund', 'refunds', 'disburse', 'disbursement', 'charge', 'charges', 'withdraw', 'withdrawal', 'settle',
  'settlement', 'capture', 'purchase', 'buy', 'sell', 'trade', 'ach', 'sepa', 'swift', 'apply', 'approve', 'submit', 'filing',
  'lodge',
]
const FILE_VERB = 'file'

/** The words of a tool name, lower-cased. */
export function toolWords(tool: string): string[] {
  return tool.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).map((w) => w.toLowerCase()).filter(Boolean)
}

/** The word that makes a tool name consequential, or undefined. */
export function consequentialWord(tool: string): string | undefined {
  const words = toolWords(tool)
  const hit = words.find((w) => CONSEQUENTIAL_WORDS.includes(w))
  if (hit) return hit
  const own = toolWords(tool.split('__').pop() ?? tool)
  return own[0] === FILE_VERB ? FILE_VERB : undefined
}

/** What a policy text still says, even when it is not a valid policy. */
export interface PolicyReading {
  /** full: a valid policy · partial: JSON with an `actions` list, invalid somewhere · none: nothing could be read */
  readable: 'full' | 'partial' | 'none'
  /** the first rule per readable tool name, with its rung as written */
  rules: Map<string, { index: number; level: unknown }>
  /** true when some rule is (or may be) consequential: a gate or autonomy rung, an unreadable rung, or an unreadable tool */
  anyConsequential: boolean
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

/** Read what can be read from a policy text. `valid` says the text already passed parseActionPolicy. */
export function readPolicyLoosely(text: string | undefined, valid = false): PolicyReading {
  const none: PolicyReading = { readable: 'none', rules: new Map(), anyConsequential: true }
  if (text === undefined) return none
  let x: unknown
  try { x = JSON.parse(text) } catch { return none }
  if (!isObj(x) || !Array.isArray(x.actions)) return none
  const rules = new Map<string, { index: number; level: unknown }>()
  let anyConsequential = false
  x.actions.forEach((a, index) => {
    if (!isObj(a) || typeof a.tool !== 'string' || !a.tool) { anyConsequential = true; return }
    if (!rules.has(a.tool)) rules.set(a.tool, { index, level: a.level })
    if (!(a.level === 'record' || a.level === 'advise')) anyConsequential = true
  })
  return { readable: valid ? 'full' : 'partial', rules, anyConsequential }
}

export interface Classified {
  /** pass-through: a valid policy that does not declare the tool (untouched, as always) */
  cls: CallClass | 'pass-through'
  /** how the class was decided, for the receipt and the denial */
  from: string
}

/** The class of one call under a reading of the policy. `tool` is undefined when the hook input does not name one. */
export function classify(tool: string | undefined, reading: PolicyReading): Classified {
  if (tool === undefined) {
    return reading.readable !== 'none' && !reading.anyConsequential
      ? { cls: 'record-advise', from: 'the tool cannot be read, and the policy declares no gate or autonomy action' }
      : { cls: 'consequential', from: 'the tool cannot be read, so it is treated as the strictest class' }
  }
  const rule = reading.rules.get(tool)
  if (rule) {
    const lv = rule.level
    if (lv === 'gate' || lv === 'autonomy') return { cls: 'consequential', from: `the policy's rule for ${tool} sets rung ${lv}` }
    if (lv === 'record' || lv === 'advise') return { cls: 'record-advise', from: `the policy's rule for ${tool} sets rung ${lv}` }
    return { cls: 'consequential', from: `the policy's rule for ${tool} has a rung that cannot be read (${JSON.stringify(lv)}), so it is treated as the strictest` }
  }
  if (reading.readable === 'full') return { cls: 'pass-through', from: `${tool} is not a declared action` }
  const w = consequentialWord(tool)
  return w
    ? { cls: 'consequential', from: `the policy cannot say, and the tool name's word "${w}" moves money or files something` }
    : { cls: 'record-advise', from: 'the policy cannot say, and nothing in the tool name moves money or files something' }
}

// ── the typed problem ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface PolicyProblem { code: DegradedCode; problem: string; fix: string }

/** The rung problems of a policy that parses but is invalid, phrased with "did you mean". */
export function rungProblems(text: string): string[] {
  let x: unknown
  try { x = JSON.parse(text) } catch { return [] }
  if (!isObj(x) || !Array.isArray(x.actions)) return []
  const out: string[] = []
  x.actions.forEach((a, i) => {
    if (!isObj(a) || VOICE_LADDER.includes(a.level as never)) return
    const name = typeof a.tool === 'string' ? ` (${a.tool})` : ''
    out.push(typeof a.level === 'string' ? `actions[${i}]${name}: ${notOneOf('rung', a.level, VOICE_LADDER)}` : `actions[${i}]${name}: no rung (level) is set; it must be one of ${VOICE_LADDER.join('/')}`)
  })
  return out
}

export const problemMissing = (mode: string): PolicyProblem => ({
  code: 'policy.missing',
  problem: `RIPOSTE_ACTION_HOOK=${mode} but no RIPOSTE_ACTION_POLICY is set`,
  fix: 'set RIPOSTE_ACTION_POLICY to the action policy file (or set RIPOSTE_ACTION_HOOK=off)',
})
export const problemUnreadable = (path: string, why: string): PolicyProblem => ({
  code: 'policy.unreadable',
  problem: `the action policy ${path} cannot be read (${why})`,
  fix: `restore ${path}, or point RIPOSTE_ACTION_POLICY at the policy file`,
})
export function problemInvalid(path: string, text: string, message: string): PolicyProblem {
  const rungs = rungProblems(text)
  return {
    code: 'policy.invalid',
    problem: rungs.length ? `the action policy ${path} is invalid: ${rungs.join('; ')}` : `the action policy ${path}: ${message}`,
    fix: `correct ${path} (riposte-action --lint --policy ${path} lists every problem)`,
  }
}
export const problemMode = (raw: string): PolicyProblem => ({
  code: 'policy.mode_invalid',
  problem: notOneOf('RIPOSTE_ACTION_HOOK', raw, ['off', 'record-only', 'on']),
  fix: `set RIPOSTE_ACTION_HOOK to off, record-only or on${didYouMean(raw, ['off', 'record-only', 'on']) ? ` (${didYouMean(raw, ['off', 'record-only', 'on'])}?)` : ''}`,
})
export const problemBadInput = (detail: string): PolicyProblem => ({
  code: 'policy.bad_input',
  problem: `the hook input is not a PreToolUse call this hook can read (${detail})`,
  fix: 'this is the host\'s input, not the policy: check that hooks.json registers riposte-action-hook.mjs --hook on PreToolUse, and the host version',
})
export const problemError = (message: string): PolicyProblem => ({
  code: 'policy.error',
  problem: `the policy check failed: ${message}`,
  fix: `report it with this receipt; ${ON_ERROR_ENV}=open restores the old fail-open behaviour meanwhile`,
})

/** The denial the person and the agent see for a held consequential call. */
export function degradedDenyText(tool: string | undefined, p: PolicyProblem, c: Classified): string {
  return `Riposte held this ${tool ?? 'tool'} call: governance degraded, ${p.code}: ${p.problem}. While the action policy cannot be applied, calls that move money or file something are held and other calls proceed on the record (${c.from}). Fix: ${p.fix}; then check the setup with ${DOCTOR_COMMAND}. This call did not run. Do not retry it; tell the person what is held and why.`
}
