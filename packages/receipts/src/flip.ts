/**
 * The flip probe: ask the SAME choice questions with the options in different orders and measure whether the decision
 * moves. A decision that changes when nothing but option order changed is not a decision about the input — it is a
 * decision about the prompt layout. Kev's own playground has a "Permute" button for one question; this makes it a
 * systematic, replayable measurement and feeds the result into the gate.
 */
import type { ChoiceAnswer, SystemOneRequest, Transport } from './systemone.js'
import { orderSchedule, reorder } from './permute.js'

export interface FlipResult {
  question: string
  options: number
  /** the option orders actually sent, identity first */
  orders: string[][]
  /** the decided choice under each order (same index as `orders`) */
  choices: string[]
  identityChoice: string
  /** most frequent choice across orders (ties -> identity's choice) */
  modal: string
  /** true iff every order produced the same choice */
  stable: boolean
  /** fraction of non-identity orders whose choice differs from the identity order's choice */
  flipRate: number
  /** max over options of (max P - min P) across orders — how far the probabilities move even when the argmax holds */
  maxProbSwing: number
  /** P(option) under each order, per option — the raw evidence */
  probabilities: Record<string, number[]>
}

export interface FlipOptions {
  /** how many orders to try per question, identity included. Default 6. */
  orders?: number
  /** schedule seed; publish it with results so anyone can replay the same orders. Default 'receipts/flip/v1'. */
  seed?: string
  /** only probe these choice questions (default: all choice questions in the request) */
  only?: string[]
}

/**
 * Runs the probe. One transport call per order; within a call every probed choice question uses its own order from
 * its own schedule, so questions stay independent (Kev/System One questions cannot read each other).
 */
export async function flipProbe(transport: Transport, req: SystemOneRequest, opts: FlipOptions = {}): Promise<Record<string, FlipResult>> {
  const n = Math.max(1, opts.orders ?? 6)
  const seed = opts.seed ?? 'receipts/flip/v1'
  const names = Object.entries(req.questions)
    .filter(([name, q]) => q.type === 'choice' && (!opts.only || opts.only.includes(name)))
    .map(([name]) => name)
  const schedules: Record<string, string[][]> = {}
  for (const name of names) {
    const q = req.questions[name]
    if (q?.type !== 'choice') continue
    schedules[name] = orderSchedule(Object.keys(q.criteria), n, `${seed}\u0000${name}`)
  }
  const rounds = Math.max(0, ...Object.values(schedules).map((s) => s.length))
  const answersByRound: Record<string, ChoiceAnswer[]> = Object.fromEntries(names.map((nm) => [nm, []]))

  for (let r = 0; r < rounds; r++) {
    const questions = { ...req.questions }
    const inRound: string[] = []
    for (const name of names) {
      const sched = schedules[name] as string[][]
      const q = req.questions[name]
      if (r >= sched.length || q?.type !== 'choice') continue
      questions[name] = { ...q, criteria: reorder(q.criteria, sched[r] as string[]) }
      inRound.push(name)
    }
    if (!inRound.length) continue
    const res = await transport({ ...req, questions })
    for (const name of inRound) {
      const a = res.answers[name]
      if (!a || a.type !== 'choice') throw new Error(`flipProbe: no choice answer for "${name}" in round ${r}`)
      ;(answersByRound[name] as ChoiceAnswer[]).push(a)
    }
  }

  const out: Record<string, FlipResult> = {}
  for (const name of names) {
    const answers = answersByRound[name] as ChoiceAnswer[]
    const orders = (schedules[name] as string[][]).slice(0, answers.length)
    const choices = answers.map((a) => a.choice)
    const identityChoice = choices[0] as string
    const counts = new Map<string, number>()
    for (const c of choices) counts.set(c, (counts.get(c) ?? 0) + 1)
    let modal = identityChoice
    for (const [c, k] of counts) if (k > (counts.get(modal) ?? 0)) modal = c
    const others = choices.slice(1)
    const flipRate = others.length ? others.filter((c) => c !== identityChoice).length / others.length : 0
    const keys = orders[0] ?? []
    const probabilities: Record<string, number[]> = {}
    let maxProbSwing = 0
    for (const k of keys) {
      const ps = answers.map((a) => a.probabilities[k] ?? 0)
      probabilities[k] = ps
      maxProbSwing = Math.max(maxProbSwing, Math.max(...ps) - Math.min(...ps))
    }
    out[name] = {
      question: name, options: keys.length, orders, choices, identityChoice, modal,
      stable: counts.size === 1, flipRate, maxProbSwing, probabilities,
    }
  }
  return out
}
