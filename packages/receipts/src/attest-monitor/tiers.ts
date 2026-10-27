/**
 * Evidence tiers for model attestation (the model-switch monitor). Every finding says which tier it rests on and what would
 * raise it. The ladder is about EVIDENCE of which model answered, not about trust in any party:
 *
 *   T0  declared only: the model the run was declared (or asked) to use. No record of what answered.
 *   T1  host-recorded per reply: the provider's per-message `model` field, as the host transcript recorded it.
 *   T2  provider usage export: the provider's usage or billing rows that match the reply (by request id, or by time window and
 *       token counts, with a stated confidence) and name the model billed.
 *   T3  signed record: a signed provider attestation, or a host record anchored in a signed receipt ledger when the reply
 *       happened (a receipt-anchored host record). Only the receipt-anchored form is read today.
 */
export type EvidenceTier = 'T0' | 'T1' | 'T2' | 'T3'
export const TIER_ORDER: readonly EvidenceTier[] = ['T0', 'T1', 'T2', 'T3']

export interface TierDefinition { tier: EvidenceTier; name: string; rests_on: string; cannot_prove: string; raise_by: string }

export const TIERS: Record<EvidenceTier, TierDefinition> = {
  T0: {
    tier: 'T0', name: 'declared only',
    rests_on: 'the model the run was declared, or the host was asked, to use. Nothing records which model answered.',
    cannot_prove: 'anything about which model answered.',
    raise_by: "record the host transcript with the provider's model field on every reply (T1), or export the provider's usage rows for the period (T2).",
  },
  T1: {
    tier: 'T1', name: 'host-recorded per reply',
    rests_on: "the provider's per-message model field, as the host transcript recorded it.",
    cannot_prove: 'that the provider reported the model truthfully, or that the transcript was not edited after the fact.',
    raise_by: "export the provider's usage or billing rows for the period (T2), or anchor each reply in a signed receipt ledger as it happens (T3).",
  },
  T2: {
    tier: 'T2', name: 'provider usage export',
    rests_on: "the provider's own usage or billing rows that match the reply and name the model billed.",
    cannot_prove: "that the provider's records are true. A provider that serves another model can bill it under the declared name.",
    raise_by: 'anchor each reply in a signed receipt ledger as it happens, or obtain a signed provider attestation (T3).',
  },
  T3: {
    tier: 'T3', name: 'signed record',
    rests_on: 'a host record anchored in a signed receipt ledger when the reply happened (or a signed provider attestation).',
    cannot_prove: 'which weights ran. Only hardware attestation of the serving workload speaks to that, and it is outside this ladder.',
    raise_by: 'nothing higher in this ladder.',
  },
}

export const tierRank = (t: EvidenceTier): number => TIER_ORDER.indexOf(t)
export const maxTier = (ts: readonly EvidenceTier[]): EvidenceTier => ts.reduce<EvidenceTier>((a, b) => (tierRank(b) > tierRank(a) ? b : a), 'T0')

/** The tier table as Markdown (docs and the report). */
export function tierTable(): string {
  const rows = TIER_ORDER.map((t) => `| ${t} | ${TIERS[t].name} | ${TIERS[t].rests_on} | ${TIERS[t].cannot_prove} |`)
  return ['| tier | name | rests on | cannot prove |', '|---|---|---|---|', ...rows].join('\n')
}
