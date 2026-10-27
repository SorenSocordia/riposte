/**
 * `riposte-pilot shadow`: one closed month of a buyer's bills through the AP gate in SHADOW (2026-10-03).
 *
 *   frozen prereg → read the export (refuse unmapped/missing) → the month's bills → per bill: the gate, a signed receipt
 *   (hashes only by default) → the audit sample (seeded by the prereg hash and the ledger head) → PILOT-REPORT.md
 *
 * Nothing is executed: no payment call, no hold call, no network at all. The proposal each bill is gated on is the buyer's
 * own decision when the export records one (paid → approve, held → hold), so the receipt also says whether the gate would
 * have executed that decision; an open bill is gated on "approve" and says so.
 *
 * WOULD, AT THE TOP LEVEL (2026-10-05). A shadow receipt says what the gate WOULD have done where a
 * reader looks first: `action` WOULD_EXECUTE | WOULD_REVIEW, `effect` WOULD_PAY | WOULD_HOLD | WOULD_REVIEW, `executed:
 * false`, `mode: "shadow"`. It never says EXECUTE or PAY at the top level (a CPA skimming the log misread that). Ledgers
 * written before carry the live gate's words at the top level and `shadow.executed: false` nested: `riposte-ledger verify`
 * reads them unchanged (it checks the chain and the signatures, never the words), and the report recounts both shapes from
 * `shadow`, which both carry.
 *
 * THE RECEIPT SAYS WHAT THE REPORT COUNTS (2026-10-05). The report counts each bill's disposition (would pay,
 * would hold, to a person: the checker's own reading, fail-closed). The receipt's top level used to carry the live gate's
 * reading of the buyer's decision instead (execute it when the checker agrees, else a person), so a bill the checker would
 * hold, which the buyer paid, said WOULD_REVIEW at the top while the report counted it held: 34 of 300 in one month. Now the
 * disposition is the record: it is the receipt's FIRST field, `action`/`effect` are its WOULD_ words, and `shadow.disposition`
 * repeats it. What the live gate would have done with the buyer's own decision is kept, named, as
 * `shadow.on_buyer_decision` ({ action, words }). Not-checked bills and pay applications say their disposition first too.
 * Ledgers written before carry the old top level; the report recounts every shape from `shadow.disposition`.
 *
 * WHO HOLDS THE KEY (the same finding). The receipts are signed. With --key, by a key the operator holds (the run writes no
 * private key). Without it, by a key made for this run: its private half goes beside the receipts (so one folder holds the
 * whole run), or, with --key-dir, into that folder instead, and the output folder holds only the public half. The manifest,
 * the report and the CLI say which, who holds it, and why.
 *
 * THE WOULD-PAY SAMPLE (the same finding). When the prereg registers the co-primary miss rate, a second audit sample is drawn
 * from the would-pays, the same way as the would-hold sample (a seed nobody chooses: the prereg hash and the ledger head).
 *
 * THE KEY IS A DECISION (2026-10-05). A run refuses to start until the operator says who holds the signing key:
 * --key (a key your organisation holds; the run writes no private key), --key-dir (a key made for this run, its private half
 * written outside the output folder) or --key-here (a key made for this run, its private half beside the receipts, where
 * whoever can read the folder can sign as the run). Before, --key-here was the silent default.
 *
 * IN WORDS, AND PAY APPLICATIONS (the same round). Unless --hashes-only, each bill's record carries its vendor, what is wrong
 * in words and what would clear it (report.ts). The month's G702/G703 pay applications (pay-apps.ts) are checked beside the
 * bills, each with a `pay_app_check` receipt (hashes only). A bill's disposition follows the gate fail-closed: the checker's
 * approve is a would-pay only on exactly PASS; approve with a check that could not run goes to a person.
 */
import { createHash, createPublicKey } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ENGINE_VERSION, canonicalize, gateStatusOpen, generateSigningKeypair, hasStruckLoadBearing, hashOf, parseTaxPolicy, taxPolicyText, verify, type ApStructuredInput, type Json, type Verdict } from 'riposte-verify'
import { apGate, type ApGateResult } from '../ap-gate.js'
import { AP_POLICY, hashesOnlyBody } from '../ap-receipt.js'
import { fileStore } from '../file-store.js'
import { keyFingerprint, openLedger, verifyChain, type LedgerEntry } from '../ledger.js'
import { stamped } from '../version.js'
import { readExport, detectSource, type MappedBill, type ReadOptions, type SourceId } from './mappers.js'
import { readPayApps, type MappedPayApp } from './pay-apps.js'
import { frozenPrereg, preregFreight, preregPriceTolerance, preregTax, type FrozenPrereg } from './prereg.js'
import { auditSheet, clearWords, fieldWords, renderPilotReport, totalWords, type Disposition, type PilotBill, type PilotManifest, type PilotPayApp, type AuditLabels } from './report.js'

export interface ShadowOptions extends ReadOptions {
  exportDir: string
  month: string
  preregPath: string
  /** the output folder: must not exist yet, or be empty (a run never writes over another) */
  out: string
  source?: SourceId
  /** keep each bill's structured input and proof (the buyer's own retention); default hashes only */
  storeDocuments?: boolean
  /** Ed25519 private key (PEM) that signs the receipts; default: a key made for this run, written to the output folder */
  signingKeyPem?: string
  /** where a key made for this run is written instead of the output folder (2026-10-05); refused together with signingKeyPem */
  keyDir?: string
  /** a key made for this run, its private half written beside the receipts (2026-10-05: a choice, never a default) */
  keyHere?: boolean
  /** a label for a supplied key in the manifest and report (e.g. the --key path); never its contents */
  signingKeyLabel?: string
  /** the run's record, report and audit sheet without document wording (rule ids and typed remedies only); default: in words */
  hashesOnly?: boolean
  /** the price tolerance the run was asked for (`--price-tolerance`): it must be the one the prereg froze (2026-10-05) */
  priceTolerance?: number
  /** the freight rule the run was asked for (`--freight`): it must be the one the prereg froze (2026-10-05) */
  freight?: 'allow' | 'person'
  /** the tax rule the run was asked for (`--tax`, as the flag writes it): it must be the one the prereg froze (2026-10-06) */
  tax?: string
  now?: () => Date
}

/** The key choice a run needs before it starts (2026-10-05). */
export const KEY_CHOICE = 'choose who holds the signing key before the run: --key <private.pem> signs with a key your organisation holds (the run writes no private key); --key-dir <dir> makes a key for this run and writes its private half in <dir>, outside the output folder; --key-here makes a key for this run and writes its private half beside the receipts, where anyone who can read the folder can sign receipts that verify as the run\'s. Nothing was written.'

export class ShadowRefused extends Error {
  constructor(message: string) { super(message); this.name = 'ShadowRefused' }
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

/** The live gate's words, and what a shadow receipt says at the top level instead (2026-10-05). */
export const SHADOW_ACTION = { EXECUTE: 'WOULD_EXECUTE', REVIEW: 'WOULD_REVIEW' } as const
export const SHADOW_EFFECT = { PAY: 'WOULD_PAY', HOLD: 'WOULD_HOLD', HUMAN_REVIEW: 'WOULD_REVIEW' } as const

/**
 * What a shadow receipt says first (2026-10-05): the disposition the report counts, and its WOULD_ words.
 * pay → WOULD_EXECUTE / WOULD_PAY · hold → WOULD_EXECUTE / WOULD_HOLD · a person → WOULD_REVIEW / WOULD_REVIEW.
 */
export function shadowWords(d: Disposition): { disposition: Disposition; action: typeof SHADOW_ACTION[keyof typeof SHADOW_ACTION]; effect: typeof SHADOW_EFFECT[keyof typeof SHADOW_EFFECT] } {
  return { disposition: d, action: d === 'person' ? SHADOW_ACTION.REVIEW : SHADOW_ACTION.EXECUTE, effect: d === 'pay' ? SHADOW_EFFECT.PAY : d === 'hold' ? SHADOW_EFFECT.HOLD : SHADOW_EFFECT.HUMAN_REVIEW }
}

/**
 * A gate receipt body made a shadow one: the disposition first, then `action`/`effect` in WOULD_ words read from it,
 * `executed: false`, `mode: "shadow"`, the rest of the gate's body, and the shadow block last. The live gate's own words for
 * the buyer's decision (EXECUTE / REVIEW) move into `shadow.on_buyer_decision`, as WOULD_ words, so no top-level field
 * disagrees with the disposition.
 */
export function shadowBody(body: Record<string, unknown>, shadow: Record<string, unknown> & { disposition: Disposition }): Record<string, unknown> {
  const live = SHADOW_ACTION[body.action as keyof typeof SHADOW_ACTION]
  if (!live || !SHADOW_EFFECT[body.effect as keyof typeof SHADOW_EFFECT]) throw new Error(`a gate result with action ${String(body.action)} and effect ${String(body.effect)} has no shadow wording`)
  const { action: _a, effect: _e, ...rest } = body
  return { ...shadowWords(shadow.disposition), executed: false, mode: 'shadow', ...rest, shadow }
}

/** What the live gate would have done with the buyer's own decision, in words: `shadow.on_buyer_decision`. */
function onBuyerDecision(g: Pick<ApGateResult, 'action' | 'checker_decision' | 'status'>, proposal: string, open: boolean): { action: string; words: string } {
  const decision = open ? `${proposal}, as no decision of the buyer is on record` : proposal
  if (g.action === 'EXECUTE') return { action: SHADOW_ACTION.EXECUTE, words: `the checker agrees with the buyer's decision (${decision}), so the live gate would have carried it out` }
  const sameReading = proposal === 'approve' ? g.checker_decision === 'approve' : g.checker_decision.startsWith('hold_')
  return {
    action: SHADOW_ACTION.REVIEW,
    words: sameReading
      ? `the checker reads the bill as the buyer did (${g.checker_decision}), but the verdict is ${g.status}, so the live gate would have sent the buyer's decision to a person`
      : `the buyer's decision (${decision}) is not the checker's (${g.checker_decision}), so the live gate would have sent it to a person`,
  }
}

/** Who holds the private key that signed a run's receipts, and why (2026-10-05). Recorded in the manifest. */
export interface KeyCustody {
  source: 'supplied' | 'made-for-this-run'
  fingerprint: string
  /** where this run wrote the private key; null when it was supplied (the run wrote none) */
  private_key: string | null
  /** the public key, in the output folder (absent when supplied) */
  public_key: string | null
  holder: string
  why: string
}

export function keyCustody(o: { source: KeyCustody['source']; fingerprint: string; privateKey: string | null; inOutput: boolean; label?: string }): KeyCustody {
  if (o.source === 'supplied') {
    return {
      source: 'supplied', fingerprint: o.fingerprint, private_key: null, public_key: null,
      holder: `whoever holds the key given with --key${o.label ? ` (${o.label})` : ''}: this run wrote no private key`,
      why: 'The receipts are signed with a key the operator supplied. For a CPA or auditor to rely on the signatures, tie its fingerprint to your organisation outside this tool (publish it, or have the auditor record it).',
    }
  }
  return o.inOutput
    ? {
        source: 'made-for-this-run', fingerprint: o.fingerprint, private_key: o.privateKey, public_key: 'run-key.pub.pem',
        holder: `whoever can read this output folder: the private key is ${o.privateKey}, beside the receipts`,
        why: '--key-here was chosen, so the run made a key for itself and wrote it beside the receipts, so that one folder holds the whole run. Anyone holding run-key.pem can sign receipts that verify as this run\'s: move it somewhere only you control, or delete it once the run is checked. --key-dir <dir> writes it outside the output folder instead, and --key <private.pem> signs with a key your organisation holds.',
      }
    : {
        source: 'made-for-this-run', fingerprint: o.fingerprint, private_key: o.privateKey, public_key: 'run-key.pub.pem',
        holder: `whoever can read ${o.privateKey}: --key-dir put the private key outside the output folder`,
        why: '--key-dir was chosen, so the run made a key for itself and wrote its private half outside the output folder, which holds only the public half (run-key.pub.pem). Anyone holding the private key can sign receipts that verify as this run\'s.',
      }
}
/** A bill's disposition, fail-closed (2026-10-05): the checker's approve is a would-pay only on exactly PASS. */
const dispositionOf = (g: Pick<ApGateResult, 'checker_decision' | 'status'>): Disposition =>
  g.checker_decision === 'approve' ? (g.status === 'PASS' ? 'pay' : 'person') : g.checker_decision.startsWith('hold_') ? 'hold' : 'person'

/** What a verdict found, in words, each finding with the line it is on: the FAILs, else the checks that could not run. */
function findingWords(v: Verdict, fallback: string): string {
  const failed = v.claims.filter((c) => c.outcome === 'FAIL')
  const shown = failed.length ? failed : v.claims.filter((c) => c.outcome === 'INSUFFICIENT_DATA')
  const seen = new Set<string>()
  const parts: string[] = []
  for (const c of shown) {
    const s = `${fieldWords(c.field)}: ${totalWords(c) ?? c.explanation}`
    if (!seen.has(s)) { seen.add(s); parts.push(s) }
  }
  return parts.join(' · ') || fallback
}

/** Why a bill went to a person, without document wording: each open (or failed) check's rule id and reason code. */
function hashesOnlyWhy(v: Verdict, decision: string): string {
  const open = v.claims.filter((c) => c.outcome === 'INSUFFICIENT_DATA')
  const shown = open.length ? open : v.claims.filter((c) => c.outcome === 'FAIL')
  const parts = [...new Set(shown.map((c) => `${c.rule_id}${c.insufficiency?.reason ? ` (${c.insufficiency.reason})` : ''}`))]
  return parts.length ? `cannot decide: ${parts.join(', ')}` : `checker decision ${decision}`
}

/** Bottom-k draw: rank by sha256(seed : ref), take k, keep the ranking order. */
export function drawAudit(refs: readonly string[], seed: string, k: number): string[] {
  return refs.map((ref) => ({ ref, key: sha(`${seed}:${ref}`) })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).slice(0, Math.max(0, k)).map((x) => x.ref)
}

export function runShadow(o: ShadowOptions): { manifest: PilotManifest; report: string; out: string } {
  const now = o.now ?? (() => new Date())
  const started = now()
  let prereg: FrozenPrereg
  try { prereg = frozenPrereg(o.preregPath, started) } catch (e) { throw new ShadowRefused((e as Error).message) }
  if (prereg.params.month !== o.month) throw new ShadowRefused(`the prereg registers ${prereg.params.month}, not --month ${o.month}`)
  const source = o.source ?? detectSource(o.exportDir)
  if (!source) throw new ShadowRefused(`cannot tell the export's source from its file names: give --source (${prereg.params.source} is registered)`)
  if (source !== prereg.params.source) throw new ShadowRefused(`the prereg registers source ${prereg.params.source}, not ${source}`)
  // the price tolerance is the prereg's, frozen before the run (2026-10-05); a run asked for another is refused, never re-set
  // 2026-10-05: the freight rule is the prereg's too; "allow" binds into each verdict's inputs (policy.freight), and "person"
  // (the default) leaves the policy exactly as before
  const freight = preregFreight(prereg.params)
  // 2026-10-06: the tax rule is the prereg's too; "allow" and a rate bind into each verdict's inputs (policy.tax), and "person"
  // (the default) leaves the policy exactly as before
  let taxRule: 'person' | 'allow' | { rate: number }
  try { taxRule = preregTax(prereg.params) } catch (e) { throw new ShadowRefused((e as Error).message) }
  const tax = taxPolicyText(taxRule)
  const policy = { ...AP_POLICY, price_tolerance: preregPriceTolerance(prereg.params), ...(freight === 'allow' ? { freight: 'allow' as const } : {}), ...(taxRule !== 'person' ? { tax: taxRule } : {}) }
  if (o.tax !== undefined) {
    const asked = parseTaxPolicy(o.tax)
    if ('error' in asked) throw new ShadowRefused(asked.error)
    if (taxPolicyText(asked.value) !== tax) throw new ShadowRefused(`the prereg froze the tax rule "${tax}"${prereg.params.tax === undefined ? ' (it names none, so the run uses "person")' : ''}; this run was asked for "${taxPolicyText(asked.value)}". The rule is fixed before the run: register it in a new pre-registration`)
  }
  if (o.priceTolerance !== undefined && Math.abs(o.priceTolerance - policy.price_tolerance) > 1e-12) {
    throw new ShadowRefused(`the prereg froze a price tolerance of ${policy.price_tolerance}${prereg.params.price_tolerance === undefined ? ' (it names none, so the run uses 0.02)' : ''}; this run was asked for ${o.priceTolerance}. A tolerance is fixed before the run: register it in a new pre-registration`)
  }
  if (o.freight !== undefined && o.freight !== freight) {
    throw new ShadowRefused(`the prereg froze the freight rule "${freight}"${prereg.params.freight === undefined ? ' (it names none, so the run uses "person")' : ''}; this run was asked for "${o.freight}". The rule is fixed before the run: register it in a new pre-registration`)
  }
  if (existsSync(o.out) && readdirSync(o.out).length) throw new ShadowRefused(`${o.out} is not empty: a pilot run never writes over another (choose a new --out)`)
  const choices = [o.signingKeyPem ? '--key' : '', o.keyDir !== undefined ? '--key-dir' : '', o.keyHere ? '--key-here' : ''].filter(Boolean)
  if (choices.length > 1) throw new ShadowRefused(`give one of --key (sign with your key), --key-dir (where to write a key made for this run) or --key-here (a key made for this run, beside the receipts), not both: ${choices.join(' and ')}`)
  if (!choices.length) throw new ShadowRefused(KEY_CHOICE)

  const reading = readExport(o.exportDir, source, { month: o.month, ...(o.ignore ? { ignore: o.ignore } : {}), ...(o.mapping !== undefined ? { mapping: o.mapping } : {}), ...(o.xeroPoField ? { xeroPoField: o.xeroPoField } : {}) })
  const payReading = readPayApps(o.exportDir, { ...(o.ignore ? { ignore: o.ignore } : {}) })
  if (reading.missing.length) throw new ShadowRefused(`the export lacks what the ${source} mapper needs:\n  ${reading.missing.join('\n  ')}`)
  const unmapped = [...reading.unmapped, ...payReading.unmapped]
  if (unmapped.length) throw new ShadowRefused(`the export holds ${unmapped.length} key(s) or column(s) the ${source} mapper does not read, and they are not acknowledged. Nothing is guessed: check each, then pass them with --ignore-columns (or --ignore-file):\n  ${unmapped.join('\n  ')}`)
  const words = o.hashesOnly !== true

  let keyPem = o.signingKeyPem
  let custody: KeyCustody
  const fingerprintOf = (privatePem: string): string => keyFingerprint(createPublicKey(privatePem).export({ type: 'spki', format: 'pem' }).toString())
  if (keyPem) {
    mkdirSync(o.out, { recursive: true })
    custody = keyCustody({ source: 'supplied', fingerprint: fingerprintOf(keyPem), privateKey: null, inOutput: false, ...(o.signingKeyLabel ? { label: o.signingKeyLabel } : {}) })
  } else {
    const kp = generateSigningKeypair()
    keyPem = kp.privateKeyPem
    const fp = fingerprintOf(keyPem)
    let privatePath = join(o.out, 'run-key.pem')
    if (o.keyDir !== undefined) {
      mkdirSync(o.keyDir, { recursive: true })
      privatePath = join(o.keyDir, `run-key-${fp}.pem`)
      if (existsSync(privatePath)) throw new ShadowRefused(`${privatePath} exists: a key file is never written over`)
    }
    mkdirSync(o.out, { recursive: true })
    writeFileSync(privatePath, keyPem, { mode: 0o600, flag: 'wx' })
    writeFileSync(join(o.out, 'run-key.pub.pem'), kp.publicKeyPem)
    custody = keyCustody({ source: 'made-for-this-run', fingerprint: fp, privateKey: privatePath, inOutput: o.keyDir === undefined })
  }
  const store = fileStore(join(o.out, 'receipts.jsonl'), { now, lock: true })
  const ledger = openLedger(store, { signingKey: keyPem, now })
  const docDir = join(o.out, 'documents'), proofDir = join(o.out, 'proofs')
  if (o.storeDocuments) { mkdirSync(docDir); mkdirSync(proofDir) }

  const inMonth = reading.bills.filter((b) => b.issued_at !== null && b.issued_at.startsWith(o.month))
    .sort((a, b) => (a.issued_at! < b.issued_at! ? -1 : a.issued_at! > b.issued_at! ? 1 : a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
  const appsInMonth = payReading.apps.filter((a) => a.period_to !== null && a.period_to.startsWith(o.month))
    .sort((a, b) => (a.period_to! < b.period_to! ? -1 : a.period_to! > b.period_to! ? 1 : a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
  const exportFiles = [...reading.files, ...payReading.files]
  const ignored = [...reading.ignored, ...payReading.ignored]
  ledger.append('note', { event: 'pilot.start', mode: 'shadow', executed: false, month: o.month, source, prereg_sha256: prereg.sha256, engine_version: ENGINE_VERSION, export: exportFiles, ignored, bills_in_month: inMonth.length, ...(payReading.apps.length ? { pay_applications_in_month: appsInMonth.length } : {}), store_documents: o.storeDocuments === true, wording: words ? 'words' : 'hashes-only' })

  const bills: PilotBill[] = []
  const payApps: PilotPayApp[] = []
  let ruleset = '?'
  try {
    for (const b of inMonth) bills.push(gateOne(b))
    for (const a of appsInMonth) payApps.push(checkPayApp(a))
    // The audit sample: drawn only now, from a seed no one chooses (the prereg's hash and the ledger head before the draw).
    const holds = bills.filter((b) => b.disposition === 'hold').map((b) => b.ref)
    const head = ledger.head().head
    const seed = sha(`riposte.pilot.audit:${prereg.sha256}:${head}`)
    const k = prereg.params.primary.sample_size ?? 0
    const sample = drawAudit(holds, seed, Math.min(k, holds.length))
    // the co-primary miss rate's sample (2026-10-05): would-pays, the same draw with its own seed, only when registered
    const co = prereg.params.co_primary
    const pays = bills.filter((b) => b.disposition === 'pay').map((b) => b.ref)
    const paySeed = co ? sha(`riposte.pilot.audit.pay:${prereg.sha256}:${head}`) : undefined
    const paySample = co ? drawAudit(pays, paySeed!, Math.min(co.sample_size, pays.length)) : undefined
    ledger.append('note', {
      event: 'pilot.end', executed: false, bills: bills.length, gated: bills.filter((b) => b.gated).length,
      ...(payApps.length ? { pay_applications: payApps.length, pay_applications_checked: payApps.filter((x) => x.checked).length } : {}),
      audit: { seed, ledger_head: head, population: holds.length, sample_size: sample.length, sample_sha256: sha(sample.join('\n')) },
      ...(paySample ? { pay_audit: { seed: paySeed, ledger_head: head, population: pays.length, sample_size: paySample.length, sample_sha256: sha(paySample.join('\n')) } } : {}),
    })
    const finished = now()
    const tip = ledger.head()
    const manifest: PilotManifest = {
      pilot_version: 'riposte.pilot-run/0.1.0', mode: 'shadow', executed: false, started_at: started.toISOString(), finished_at: finished.toISOString(),
      month: o.month, source, prereg: { file: prereg.path.split(/[\\/]/).pop()!, sha256: prereg.sha256, frozen_at: prereg.frozen_at },
      export: { files: exportFiles, ignored, notes: [...reading.notes, ...(payReading.apps.length ? payReading.notes : [])], bills_in_export: reading.bills.length, bills_outside_month: reading.bills.length - inMonth.length },
      engine: { verify: ENGINE_VERSION, ruleset },
      ledger: { file: 'receipts.jsonl', entries: tip.count, head: tip.head, key_fingerprint: custody.fingerprint },
      key: custody,
      store_documents: o.storeDocuments === true,
      // the frozen rules every bill was checked under (2026-10-05): the score reads the freight rule (a freight plant's right answer)
      price_tolerance: policy.price_tolerance, freight, tax,
      audit: { seed, sample_size: sample.length, population: holds.length, sample, ...(paySample ? { pay: { seed: paySeed!, sample_size: paySample.length, population: pays.length, sample: paySample } } : {}) },
      bills,
      wording: words ? 'words' : 'hashes-only',
      ...(payApps.length ? { pay_apps: payApps } : {}),
    }
    writeFileSync(join(o.out, 'pilot-run.json'), `${JSON.stringify(manifest, null, 1)}\n`)
    writeFileSync(join(o.out, 'AUDIT-SHEET.csv'), auditSheet(manifest))
    const entries = ledger.entries()
    const chain = verifyChain(entries)
    const report = renderPilotReport({ manifest, prereg, ledger: { entries, chainOk: chain.ok, ...(chain.reason ? { chainReason: chain.reason } : {}) } })
    writeFileSync(join(o.out, 'PILOT-REPORT.md'), report)
    return { manifest, report, out: o.out }
  } finally { store.release() }

  function gateOne(b: MappedBill): PilotBill {
    const ref_sha256 = sha(b.ref)
    const common = { ref: b.ref, invoice_number: b.invoice_number, issued_at: b.issued_at, amount: b.amount, currency: b.currency, buyer: b.buyer, ...(words ? { vendor: b.vendor } : {}) }
    if (!b.input) {
      const e = ledger.append('note', { ...shadowWords('person'), executed: false, mode: 'shadow', event: 'pilot.not_checked', shadow: { pilot: true, executed: false, month: o.month, bill_ref_sha256: ref_sha256, buyer_decision: b.buyer.decision, disposition: 'person' }, reason: b.problem })
      return { seq: e.seq, ...common, gated: false, problem: b.problem ?? 'not checked', disposition: 'person', failed: [], open: [], remedies: [], ...(words ? { discrepancy: `not checked: ${b.problem ?? 'the bill could not be put together'}` } : {}) }
    }
    const docs = documentsOf(b.input)
    const proposal = b.buyer.decision === 'pay' ? 'approve' : b.buyer.decision === 'hold' ? 'hold' : 'approve'
    const g = apGate(proposal, docs, { now, policy })
    ruleset = `${g.check.verdict.ruleset.id}@${g.check.verdict.ruleset.version}`
    const disposition = dispositionOf(g)
    const shadow = { disposition, pilot: true, executed: false, month: o.month, bill_ref_sha256: ref_sha256, buyer_decision: b.buyer.decision, proposal: b.buyer.decision === 'open' ? 'approve (no decision of the buyer on record)' : proposal, on_buyer_decision: onBuyerDecision(g, proposal, b.buyer.decision === 'open'), price_tolerance: policy.price_tolerance, freight, tax }
    // the tolerance is an input of the verdict (its input_hash binds it), and the receipt records it beside the disposition
    const proof = { verdict: g.check.verdict, inputs: { ap_structured: docs, policy } }
    const body = shadowBody(o.storeDocuments ? { ...hashesOnlyBody(g, docs), stored: 'documents', proof } : hashesOnlyBody(g, docs), shadow)
    const e = ledger.append('ap_gate', body)
    if (o.storeDocuments) {
      writeFileSync(join(docDir, `${String(e.seq).padStart(5, '0')}.json`), `${JSON.stringify(b.input, null, 1)}\n`)
      writeFileSync(join(proofDir, `${String(e.seq).padStart(5, '0')}.json`), `${JSON.stringify(proof)}\n`)
    }
    const v = g.check.verdict
    return {
      seq: e.seq, ...common, gated: true, checker_decision: g.checker_decision, status: g.status, disposition,
      failed: [...new Set(v.claims.filter((c) => c.outcome === 'FAIL').map((c) => c.rule_id))],
      open: [...new Set(v.claims.filter((c) => c.outcome === 'INSUFFICIENT_DATA').map((c) => c.rule_id))],
      remedies: (g.remedies ?? []).map((r) => ({ kind: r.kind, ...(r.authority ? { authority: r.authority } : {}), clears: r.clears, ...(r.operand?.path ? { operand: r.operand.path } : {}) })),
      // in words, the check's own first reason; under --hashes-only, rule ids and reason codes only (2026-10-05: the
      // vendor check's reason names both vendors, and a hashes-only record must hold no document wording)
      ...(disposition === 'person' ? { why: words ? g.check.reasons[0] ?? g.reason ?? 'undecided' : hashesOnlyWhy(v, g.checker_decision) } : {}),
      ...(words && disposition !== 'pay' ? { discrepancy: findingWords(v, g.check.reasons[0] ?? g.reason), clear: clearWords(g.remedies ?? []) } : {}),
    }
  }

  /** One pay application: verify's pay-app ruleset, against the previous application when the export holds it. */
  function checkPayApp(a: MappedPayApp): PilotPayApp {
    const shadowOf = (disposition: Disposition) => ({ pilot: true, executed: false, month: o.month, document: 'pay_application', app_ref_sha256: sha(a.ref), buyer_decision: a.buyer.decision, disposition, previous_found: a.previous !== undefined })
    const common = { ref: a.ref, application_number: a.application_number, period_to: a.period_to, amount: a.amount, currency: a.currency, buyer: a.buyer, previous: a.previous?.ref ?? null, ...(words ? { project: a.project, contractor: a.contractor } : {}) }
    if (a.problem) {
      const e = ledger.append('note', { ...shadowWords('person'), executed: false, mode: 'shadow', event: 'pilot.not_checked', shadow: shadowOf('person'), reason: a.problem })
      return { seq: e.seq, ...common, checked: false, problem: a.problem, disposition: 'person', failed: [], open: [], remedies: [], ...(words ? { discrepancy: `not checked: ${a.problem}` } : {}) }
    }
    const v = verify(a.doc as Json, { ruleset: 'pay-app', ...(a.previous ? { references: { history: [a.previous.doc as Json] } } : {}), now })
    const status = gateStatusOpen(v)
    const disposition: Disposition = status === 'PASS' && !hasStruckLoadBearing(v) ? 'pay' : status === 'FAIL' ? 'hold' : 'person'
    const doc = (x: unknown) => { const c = canonicalize(x); return { sha256: sha(c), bytes: Buffer.byteLength(c, 'utf8') } }
    const remedies = v.remedies ?? []
    const body = stamped('pay_app_check', {
      ...shadowWords(disposition),
      executed: false, mode: 'shadow',
      stored: 'hashes',
      verdict_id: v.verdict_id, input_hash: v.input_hash, outcome: v.outcome, gate_status: status, ruleset: v.ruleset, engine_version: v.engine_version, verdict_sha256: hashOf(v),
      documents: { pay_application: doc(a.doc), ...(a.previous ? { previous_application: doc(a.previous.doc) } : {}) },
      claims: v.claims.map((c) => ({ claim_id: c.claim_id, rule_id: c.rule_id, outcome: c.outcome, ...(c.insufficiency ? { reason: c.insufficiency.reason } : {}), pointers: c.evidence.flatMap((x) => (x.locator.kind === 'field' ? [x.locator.path] : [])) })),
      ...(remedies.length ? { remedies: remedies.map((r) => ({ kind: r.kind, ...(r.authority ? { authority: r.authority } : {}), ...(r.transform ? { transform: r.transform } : {}), clears: r.clears, claims: r.claims })) } : {}),
      shadow: shadowOf(disposition),
    })
    const e = ledger.append('pay_app_check', body)
    if (o.storeDocuments) writeFileSync(join(docDir, `${String(e.seq).padStart(5, '0')}.json`), `${JSON.stringify({ pay_application: a.doc, ...(a.previous ? { previous_application: a.previous.doc } : {}) }, null, 1)}\n`)
    const open = [...new Set(v.claims.filter((c) => c.outcome === 'INSUFFICIENT_DATA').map((c) => c.rule_id))]
    const why = disposition === 'person' ? (a.previous ? (words ? findingWords(v, 'the verdict is not PASS') : hashesOnlyWhy(v, status)) : `no previous application of this contract in the export, so the continuity checks could not run (${open.join(', ')})`) : undefined
    return {
      seq: e.seq, ...common, checked: true, outcome: v.outcome, status, disposition,
      failed: [...new Set(v.claims.filter((c) => c.outcome === 'FAIL').map((c) => c.rule_id))], open,
      remedies: remedies.map((r) => ({ kind: r.kind, ...(r.authority ? { authority: r.authority } : {}), clears: r.clears, ...(r.operand?.path ? { operand: r.operand.path } : {}) })),
      ...(why ? { why } : {}),
      ...(words && disposition !== 'pay' ? { discrepancy: disposition === 'hold' ? findingWords(v, 'the verdict is FAIL') : why!, clear: clearWords(remedies) } : {}),
    }
  }
}

/** The documents the gate checks: the input without a decision (the export never carries one; the proposal is separate). */
function documentsOf(input: ApStructuredInput): ApStructuredInput {
  const { decision: _d, ...docs } = input as ApStructuredInput & { decision?: unknown }
  return docs as ApStructuredInput
}

/** Re-render the report of a finished run (after the audit, say), recounting it from the ledger. */
export function rerenderReport(o: { out: string; preregPath: string; manifest: PilotManifest; entries: LedgerEntry[]; audit?: AuditLabels }): string {
  const prereg = frozenPrereg(o.preregPath, new Date(o.manifest.started_at))
  const chain = verifyChain(o.entries)
  return renderPilotReport({ manifest: o.manifest, prereg, ledger: { entries: o.entries, chainOk: chain.ok, ...(chain.reason ? { chainReason: chain.reason } : {}) }, ...(o.audit ? { audit: o.audit } : {}) })
}
