/**
 * Attach a measured DeclaredAccuracy to a verdict — the last link of the honesty loop: measure a ruleset once
 * (`measureRuleset`), then stamp that published accuracy onto every verdict the ruleset emits, so each proof
 * self-reports how often it is wrong. Additive metadata: it does NOT enter `verdict_id` (which is derived from
 * input_hash + ruleset + engine_version), so determinism is preserved.
 *
 * Honest guard: an accuracy measured on ruleset version X may not be stamped onto a verdict from version Y. A version
 * bump changes behaviour; the old accuracy no longer describes it. Re-measure and re-attach.
 */

import type { Verdict } from './schema.js'
import type { DeclaredAccuracy } from './schema.js'

export function attachDeclaredAccuracy(verdict: Verdict, accuracy: DeclaredAccuracy): Verdict {
  if (accuracy.ruleset_version !== verdict.ruleset.version) {
    throw new Error(
      `declared_accuracy was measured on ruleset version ${accuracy.ruleset_version} but this verdict is from version ${verdict.ruleset.version}; re-measure before attaching`,
    )
  }
  return { ...verdict, declared_accuracy: accuracy }
}
