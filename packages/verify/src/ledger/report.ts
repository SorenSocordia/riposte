/**
 * Tenant "book of record" report — the compliance artifact, composed from everything the ledger holds.
 *
 * This is the single document a regulated buyer or an auditor actually asks for: how many verdicts,
 * how often a human overturned us (the honest real-world accuracy), which rules the field distrusts (per-rule
 * calibration), and a tamper-evidence attestation with the anchor hash to notarize. It composes existing pieces
 * (stats + ruleCalibration + the hash chain); it invents no number and is honest when a section is empty. Deterministic
 * given the ledger's contents (the only clock is the optional `as_of` line the caller supplies).
 */

import type { Ledger } from './types.js'
import { ruleCalibration, renderCalibration, type CalibrationOptions } from './calibration.js'

export interface TenantReportOptions {
  /** Restrict to one tenant. Omit for an all-tenants report. */
  tenant_id?: string
  /** An "as of" timestamp to stamp on the report (ISO-8601). Purely cosmetic; kept out of the deterministic body. */
  as_of?: string
  /** Thresholds for the per-rule calibration section. */
  calibration?: CalibrationOptions
}

export function renderTenantReport(ledger: Ledger, opts: TenantReportOptions = {}): string {
  const stats = ledger.stats(opts.tenant_id)
  const reviewed = ledger.query(opts.tenant_id !== undefined ? { tenant_id: opts.tenant_id, reviewed: true } : { reviewed: true })
  const cal = ruleCalibration(reviewed, opts.calibration)
  const chain = ledger.verifyContent()
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`

  const lines: string[] = []
  lines.push(`# Verification book of record${opts.tenant_id ? ` — tenant \`${opts.tenant_id}\`` : ''}`)
  if (opts.as_of) lines.push('', `_As of ${opts.as_of}._`)

  lines.push(
    '',
    '## Volume',
    '',
    `- Verdicts on record: **${stats.total}** — ${stats.by_outcome.PASS} PASS · ${stats.by_outcome.FAIL} FAIL · ${stats.by_outcome.INSUFFICIENT_DATA} can't-tell.`,
    `- Human-reviewed: **${stats.reviewed}**.`,
    '',
    '## Real-world accuracy',
    '',
    '> The number that matters most: measured on verdicts a human actually reviewed, not synthetic tests.',
    '',
    stats.reviewed > 0
      ? `- **Human-overturn rate: ${pct(stats.overturn_rate)}** — ${stats.overturned} overturned of ${stats.reviewed} reviewed (${stats.upheld} upheld).`
      : '- **Human-overturn rate: —** (no reviewed verdicts yet).',
    '',
    renderCalibration(cal),
    '## Tamper-evidence',
    '',
    chain.ok
      ? `- Chain intact across **${chain.length}** events. Anchor to notarize (head hash): \`${chain.head}\`.`
      : `- ⚠ **Chain integrity FAILED** at event ${chain.brokenAt}: ${chain.reason}. Head: \`${chain.head}\`.`,
    '',
  )
  return lines.join('\n')
}
