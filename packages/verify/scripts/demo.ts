/**
 * `verify` — one-command live demo. Runs the whole story end-to-end so it can be shown (or screen-recorded) in ~90s:
 *   Beat 1  A legal brief with a fabricated + a misquoted citation → caught, with the opinion's ACTUAL words.
 *   Beat 2  A 4-way procure-to-pay set with an overpayment → the cross-document mismatch caught, per-document provenance.
 *   Beat 3  Sign the verdict, verify it with only the public key, tamper the outcome → the signature breaks; and replay
 *           the binding WITHOUT the engine. "You don't have to trust us — check us."
 *
 * Run:  cmd //c "node_modules\.bin\tsx.cmd products\verify\scripts\demo.ts"
 * The logic is exported as runDemo() so it is unit-tested (test/demo.test.ts); the console wrapper only formats.
 */

import {
  verifyCitations, renderCitationAudit, type Citation, type OpinionSources,
  reconcile, type ReconciliationRuleset,
  generateSigningKeypair, signVerdict, verifyEnvelope, verifyReplay,
} from '../src/index'

const NOW = () => new Date('2026-09-23T00:00:00Z')

// ---- Beat 1 fixtures: a brief citing a real opinion, one quote accurate, one fabricated ----
const OPINIONS: OpinionSources = {
  Twombly: 'To survive a motion to dismiss, a complaint must state a claim to relief that is plausible on its face.',
}
const BRIEF: Citation[] = [
  { id: 'p3n1', case_name: 'Twombly', cite: '550 U.S. 544', quote: 'plausible on its face' },      // ✓ verbatim
  { id: 'p3n2', case_name: 'Twombly', cite: '550 U.S. 544', quote: 'probable on its face' },        // ✗ misquote
  { id: 'p4n1', case_name: 'Ghost v. Nowhere', cite: '1 F.4th 1', quote: 'the statute is void' },   // ⚠ no opinion supplied
]

// ---- Beat 2 fixtures: a procure-to-pay set where the payment overpays the invoice ----
const FOUR_WAY: ReconciliationRuleset = {
  id: 'procure-to-pay-4way', version: '0.0.1', domain: 'reconciliation',
  documents: ['po', 'invoice', 'receipt', 'payment'],
  tolerance: { rel: 0.0003, absCap: 0.01 },
  fields: {
    PO_AMOUNT: { doc: 'po', paths: ['approved_amount'] },
    INV_TOTAL: { doc: 'invoice', paths: ['payable_amount', 'total'] },
    RECEIPT_AMOUNT: { doc: 'receipt', paths: ['received_amount'] },
    PAY_AMOUNT: { doc: 'payment', paths: ['amount'] },
  },
  checks: [
    { code: 'INV_WITHIN_PO', field: 'invoice.total', left: 'INV_TOTAL', op: '<=', right: 'PO_AMOUNT' },
    { code: 'RECEIPT_TIES_INV', field: 'receipt.total', left: 'RECEIPT_AMOUNT', op: '=', right: 'INV_TOTAL' },
    { code: 'PAYMENT_TIES_INV', field: 'payment.amount', left: 'PAY_AMOUNT', op: '=', right: 'INV_TOTAL' },
  ],
}
const P2P_DOCS = {
  po: { approved_amount: 10000 },
  invoice: { payable_amount: 10000 },
  receipt: { received_amount: 10000 },
  payment: { amount: 11000 }, // overpaid by 1,000
}

export interface DemoResult {
  legal: { outcome: string; audit: string; verdict_id: string }
  reconcile: { outcome: string; failedCheck: string; variance: number | undefined; provenanceDocs: string[] }
  protocol: { signature_ok: boolean; tamper_caught: boolean; replay_ok: boolean; replay_wrong_inputs_rejected: boolean }
}

export function runDemo(): DemoResult {
  // Beat 1 — legal cite-check
  const legalVerdict = verifyCitations(BRIEF, OPINIONS, { now: NOW })
  const audit = renderCitationAudit(legalVerdict, { title: 'Citation audit — Plaintiff\'s MTD response' })

  // Beat 2 — cross-document reconciliation
  const reconVerdict = reconcile(P2P_DOCS, FOUR_WAY, { now: NOW })
  const failed = reconVerdict.claims.find(c => c.outcome === 'FAIL')

  // Beat 3 — sign, verify with only the public key, tamper, and independently replay
  const { privateKeyPem } = generateSigningKeypair()
  const env = signVerdict(reconVerdict, privateKeyPem)
  const honest = verifyEnvelope(env)
  const tampered = { ...env, verdict: { ...env.verdict, outcome: 'PASS' as const } }
  const tamperCheck = verifyEnvelope(tampered)
  const replayGood = verifyReplay(reconVerdict, { documents: P2P_DOCS, ruleset: FOUR_WAY })
  const replayWrong = verifyReplay(reconVerdict, { documents: { ...P2P_DOCS, payment: { amount: 1 } }, ruleset: FOUR_WAY })

  return {
    legal: { outcome: legalVerdict.outcome, audit, verdict_id: legalVerdict.verdict_id },
    reconcile: {
      outcome: reconVerdict.outcome,
      failedCheck: failed?.rule_id ?? '',
      variance: failed?.variance,
      provenanceDocs: (failed?.evidence ?? []).map(e => (e.locator.kind === 'field' ? e.locator.path.split('.')[0]! : 'span')),
    },
    protocol: {
      signature_ok: honest.signature_ok,
      tamper_caught: tamperCheck.signature_ok === false,
      replay_ok: replayGood.ok,
      replay_wrong_inputs_rejected: replayWrong.input_ok === false,
    },
  }
}

function main(): void {
  const r = runDemo()
  const line = '─'.repeat(74)
  const out = (s = ''): void => { process.stdout.write(s + '\n') }

  out(); out('  V E R I F Y   —   live demo'); out(`  ${line}`)
  out('  It catches expensive lies in documents — and proves it wasn\'t lying.'); out()

  out('  ① LEGAL CITE-CHECK — a brief with a fabricated citation'); out(`  ${line}`)
  out(r.legal.audit.split('\n').map(l => '  ' + l).join('\n'))
  out(`  → brief outcome: ${r.legal.outcome} (one misquote fails the filing). No AI guessed; every call is re-checkable.`); out()

  out('  ② CROSS-DOCUMENT RECONCILIATION — PO ↔ invoice ↔ receipt ↔ payment'); out(`  ${line}`)
  out(`  → outcome: ${r.reconcile.outcome} · ${r.reconcile.failedCheck} failed by $${r.reconcile.variance}`)
  out(`  → the mismatch names its documents: ${[...new Set(r.reconcile.provenanceDocs)].join(' vs ')} — a $1,000 overpayment no single-document check would catch.`); out()

  out('  ③ "DON\'T TRUST US — CHECK US" — the portable proof'); out(`  ${line}`)
  out(`  → signed verdict verifies with only the public key: ${r.protocol.signature_ok ? 'YES' : 'no'}`)
  out(`  → flip the outcome after signing, the signature breaks: ${r.protocol.tamper_caught ? 'CAUGHT' : 'missed'}`)
  out(`  → a third party replays the binding without our engine: ${r.protocol.replay_ok ? 'VERIFIED' : 'failed'}`)
  out(`  → the same proof rejects a swapped-in different document: ${r.protocol.replay_wrong_inputs_rejected ? 'REJECTED' : 'missed'}`); out()

  out(`  ${line}`)
  out('  Deterministic · never guesses · publishes its own error rate · every verdict independently verifiable.'); out()
}

if (process.argv[1] && (process.argv[1].endsWith('demo.ts') || process.argv[1].endsWith('demo.js'))) main()
