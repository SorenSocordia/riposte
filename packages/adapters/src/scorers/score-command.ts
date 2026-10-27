/**
 * `riposte-score`: one check for a scorer in another language (the Python Inspect scorer calls it). The bin is
 * ./score-cli.ts (I/O only).
 *   stdin  {"output": <document or its JSON text>, "ruleset"?: "invoice" | "pay-app" | {declarative},
 *           "references"?: {contract, evidence, history}, "source"?: "<text>", "inline_proof"?: true}
 *   stdout {"kind": "verdict", "proof": {...}} or {"kind": "refused", "reason": "..."}, exit 0
 *   exit 3 the request itself is unusable (not a JSON object, no "output", an unknown ruleset)
 */
import { checkOutput, type CheckRequest } from './core.js'

export const SCORE_USAGE = 'riposte-score   (one request as JSON on stdin; prints the verdict as a score proof; see the adapters README, "Scorers")\n'

export function scoreCommand(stdin: string): { stdout: string; stderr: string; code: number } {
  let req: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(stdin)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('the request is not a JSON object')
    req = parsed as Record<string, unknown>
  } catch (e) {
    return { stdout: '', stderr: `riposte-score: ${(e as Error).message}\n`, code: 3 }
  }
  if (!('output' in req)) return { stdout: '', stderr: 'riposte-score: the request has no "output"\n', code: 3 }
  try {
    const result = checkOutput(req as unknown as CheckRequest, { inlineProof: req.inline_proof !== false })
    return { stdout: `${JSON.stringify(result)}\n`, stderr: '', code: 0 }
  } catch (e) {
    return { stdout: '', stderr: `riposte-score: ${(e as Error).message}\n`, code: 3 }
  }
}
