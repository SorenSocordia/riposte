/**
 * receipts — the checker you don't have to trust, for typed AI decisions.
 *
 *   const { response, gate, receipt } = await guard(transport, request, policy, { checks, flip: true, signingKey })
 *
 * The model decides. Receipts recomputes what can be recomputed (via `verify`), measures whether the decision moves
 * when only the option order moves, returns PROCEED / HOLD / ABSTAIN, and signs a replayable receipt of all of it.
 */
import { flipProbe, type FlipOptions, type FlipResult } from './flip.js'
import { gate, type GateChecks, type GatePolicy, type GateResult } from './gate.js'
import { buildReceipt, signReceipt, type DecisionReceipt, type SignedReceipt } from './receipt.js'
import type { SystemOneRequest, SystemOneResponse, Transport } from './systemone.js'

export * from './systemone.js'
export { apGate, type ApGateResult, type ApAction } from './ap-gate.js'
export { checkDone, type DoneClaim, type DoneResult, type DoneOutcome, type Expectation, type ExpectationResult, type StateReader } from './done.js'
export { openLedger, verifyChain, memoryStore, type Ledger, type LedgerEntry, type LedgerStore, type ChainCheck, type ReceiptKind } from './ledger.js'
export { orderSchedule, reorder } from './permute.js'
export { flipProbe, type FlipOptions, type FlipResult } from './flip.js'
export { gate, type GateChecks, type GatePolicy, type GateResult, type GateOutcome } from './gate.js'
export { buildReceipt, signReceipt, verifyReceipt, RECEIPT_VERSION, type DecisionReceipt, type SignedReceipt, type ReceiptCheck } from './receipt.js'

export interface GuardOptions {
  checks?: GateChecks
  /** run the flip probe on the deciding question (true = defaults) */
  flip?: boolean | FlipOptions
  /** Ed25519 private key (PEM). If present, the receipt is signed. */
  signingKey?: string
  now?: () => Date
}

export interface GuardResult {
  response: SystemOneResponse
  gate: GateResult
  flip?: Record<string, FlipResult>
  receipt: DecisionReceipt
  signed?: SignedReceipt
}

/** One call: decide, probe, check, gate, receipt. The identity-order answer is the decision of record. */
export async function guard(transport: Transport, request: SystemOneRequest, policy: GatePolicy, opts: GuardOptions = {}): Promise<GuardResult> {
  const response = await transport(request)
  let flip: Record<string, FlipResult> | undefined
  if (opts.flip && request.questions[policy.question]?.type === 'choice') {
    const fo: FlipOptions = typeof opts.flip === 'object' ? opts.flip : {}
    flip = await flipProbe(transport, request, { ...fo, only: [policy.question] })
  }
  const g = gate(request, response, policy, opts.checks, flip)
  const receipt = buildReceipt({ request, response, gate: g, ...(flip ? { flip } : {}), ...(opts.now ? { now: opts.now } : {}) })
  const out: GuardResult = { response, gate: g, receipt }
  if (flip) out.flip = flip
  if (opts.signingKey) out.signed = signReceipt(receipt, opts.signingKey)
  return out
}
export { fileStore } from './file-store.js'
export { handleRequest as handleMcpRequest, rootedJsonReader, rootedTextReader, TOOLS as MCP_TOOLS } from './mcp.js'
export { attestModels, modelGate, modelMatches, isFloatingAlias, eventsFromReplies, eventsFromClaudeCodeTranscript, type ModelEvent, type AttestPolicy, type ModelAttestation, type SwitchEvent, type ModelGateResult } from './model-attest.js'
export { attestCli, parseAttestArgs, ATTEST_USAGE } from './attest-command.js'
