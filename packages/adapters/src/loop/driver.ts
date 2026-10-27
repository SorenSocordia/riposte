/**
 * The closed-loop driver (2026-10-03, T3): runs an agent against the gate through receipts' loop session. Each round the agent
 * proposes; if the gate does not execute it, the verdict's typed remedies come back as the agent's next instruction
 * (`next(ctx)`), and its answer is verdicted again. The agent may decline (return null). At most the round limit (3), then the
 * gate holds for a person. Returns the loop's bundle: its signed chain and every round's proof, replayable as one.
 *
 * GOVERNANCE (T4c). With a `governance` check (see ../governance.ts: the fleet's execution-boundary check, which fails closed),
 * it runs before EVERY round's submit, fresh each time. A refusal closes the loop at once, HELD-FOR-HUMAN, through the loop's
 * own decline (so the bundle stays replayable), with the refusal code in the reason; that round's proposal is never submitted.
 * The call it checks is the tool `loop.submit` with the proposal's canonical sha256, so a GO may name one exact proposal.
 */
import { canonicalize, sha256 } from 'riposte-verify'
import { openLoop, type AgentModel, type LoopAgent, type LoopBundle, type LoopClose, type LoopGateResult, type LoopInstruction, type LoopOptions, type LoopProposal, type LoopTask } from 'riposte-ai'
import type { GovernanceVerdict } from '../governance.js'

export interface NextContext {
  task: LoopTask
  round: number
  previous: LoopProposal
  instruction: LoopInstruction
  gate: LoopGateResult
}

export interface LoopAgentImpl {
  id: string
  first(): LoopProposal | Promise<LoopProposal>
  /** the agent's answer to an instruction, or null to decline */
  next(ctx: NextContext): LoopProposal | null | Promise<LoopProposal | null>
  /** the model that produced round n's proposal, as resolved (null for a program) */
  model(round: number): AgentModel
}

/** The tool name a loop round is checked as (a charter may put it in an action class). */
export const LOOP_TOOL = 'loop.submit'

/** What the governance check sees for one round. */
export interface LoopRoundCall { task: LoopTask; round: number; proposal: LoopProposal; tool: typeof LOOP_TOOL; proposal_sha256: string }

/** A governance check for loop rounds: allow or deny, never throws (a thrown check counts as a deny). */
export type LoopGovernance = (call: LoopRoundCall) => GovernanceVerdict | Promise<GovernanceVerdict>

export interface LoopRun {
  bundle: LoopBundle
  closed: LoopClose
  /** per round: what the gate said, and whether the discipline (or governance) refused it */
  rounds: { round: number; status?: string; action?: string; effect?: string; refused?: boolean; governance?: string; remedies: number }[]
}

export async function runLoop(task: LoopTask, agent: LoopAgentImpl, opts: LoopOptions = {}, governance?: LoopGovernance): Promise<LoopRun> {
  const loop = openLoop(task, { id: agent.id } satisfies LoopAgent, opts)
  const rounds: LoopRun['rounds'] = []
  let proposal = await agent.first()
  for (;;) {
    const round = loop.round + 1
    if (governance) {
      let v: GovernanceVerdict
      try {
        v = await governance({ task, round, proposal, tool: LOOP_TOOL, proposal_sha256: sha256(canonicalize(proposal)) })
      } catch (e) {
        v = { decision: 'deny', code: 'governance.error', detail: (e as Error).message, agent: null, tool: LOOP_TOOL, call_sha256: null }
      }
      if (v.decision !== 'allow') {
        rounds.push({ round, refused: true, governance: v.code, remedies: 0 })
        const closed = loop.decline(`governance: ${v.code}: ${v.detail} (round ${round} was not submitted)`, agent.model(round))
        return { bundle: loop.bundle(), closed, rounds }
      }
    }
    const r = loop.submit(proposal, agent.model(round))
    rounds.push({ round, ...(r.gate ? { status: r.gate.status, action: r.gate.action, effect: r.gate.effect } : {}), ...(r.refused ? { refused: true } : {}), remedies: r.gate?.remedies.length ?? 0 })
    if (r.closed) return { bundle: loop.bundle(), closed: r.closed, rounds }
    const next = await agent.next({ task, round, previous: proposal, instruction: r.instruction!, gate: r.gate! })
    if (next === null || canonicalize(next) === canonicalize(proposal)) {
      const closed = loop.decline(next === null ? 'no lawful action for these remedies' : 'its next proposal would repeat this one', agent.model(round + 1))
      return { bundle: loop.bundle(), closed, rounds }
    }
    proposal = next
  }
}
