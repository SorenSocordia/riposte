/**
 * PAY-APP ontology — field-path → role mappings for a construction pay application as an extractor would emit it:
 * a G702 summary (document level) and a G703 continuation sheet (one line per schedule-of-values item).
 *
 * The per-line array may be called `schedule_of_values`, `continuation_sheet`, `line_items` or `items`
 * (see lineArrayKeys). Every amount role has fuzzy matching OFF: a footing check must never run against a
 * number that was merely name-similar (honesty rule 3 makes that abstain anyway; this makes it not happen).
 *
 * Resolution order per mapping: fieldPath (confidence 100) → alternativePaths (95) → fuzzy alias (75, off here).
 */

import type { DomainFieldMapping, DomainOntology, RoleKind, UniversalRole } from '../../kernel/types.js'

const D = 'pay-app'
export const PAY_APP_LINE_ARRAY_KEYS = ['schedule_of_values', 'continuation_sheet', 'line_items', 'items', 'sov']

/** Expand `ROOT[*].field` across every candidate line-array root. First root = primary path. */
function line(role: UniversalRole, fields: string[], opts: { fuzzy?: boolean; aliases?: string[] } = {}): DomainFieldMapping {
  const paths: string[] = []
  for (const root of PAY_APP_LINE_ARRAY_KEYS) for (const f of fields) paths.push(`${root}[*].${f}`)
  const [fieldPath, ...alternativePaths] = paths
  return {
    domain: D, role, documentType: 'invoice', priority: 100,
    fieldPath: fieldPath as string, alternativePaths,
    fuzzyMatch: opts.fuzzy ?? false,
    ...(opts.aliases ? { fieldAliases: opts.aliases } : {}),
  }
}

function doc(role: UniversalRole, fields: string[], opts: { fuzzy?: boolean } = {}): DomainFieldMapping {
  const roots = ['', 'summary.', 'g702.', 'application.', 'totals.']
  const paths: string[] = []
  for (const r of roots) for (const f of fields) paths.push(`${r}${f}`)
  const [fieldPath, ...alternativePaths] = paths
  return { domain: D, role, documentType: 'invoice', priority: 100, fieldPath: fieldPath as string, alternativePaths, fuzzyMatch: opts.fuzzy ?? false }
}

// ---------------------------------------------------------------- G703 — per line
const LINE_MAPPINGS: DomainFieldMapping[] = [
  line('SOV_ITEM_ID', ['item_no', 'item_number', 'item', 'line_no', 'line_number', 'no', 'id', 'number', 'cost_code']),
  line('SOV_DESCRIPTION', ['description', 'description_of_work', 'work_description', 'name', 'scope'], { fuzzy: true, aliases: ['description'] }),
  line('SCHEDULED_VALUE', ['scheduled_value', 'scheduled_amount', 'contract_value', 'sov_value', 'value', 'budget', 'contract_amount', 'amount']),
  line('WORK_PREVIOUS', ['previous', 'from_previous_application', 'from_previous_applications', 'previous_applications', 'work_completed_previous', 'previously_completed', 'completed_previous', 'prior', 'previous_work']),
  line('WORK_THIS_PERIOD', ['this_period', 'work_completed_this_period', 'this_application', 'current_period', 'current', 'this_month', 'completed_this_period']),
  line('MATERIALS_STORED', ['materials_stored', 'materials_presently_stored', 'stored_materials', 'presently_stored', 'stored']),
  line('COMPLETED_TO_DATE', ['completed_to_date', 'total_completed_and_stored', 'total_completed_and_stored_to_date', 'total_completed_stored_to_date', 'total_to_date', 'completed_and_stored', 'total_completed', 'total_completed_stored']),
  line('PERCENT_COMPLETE', ['percent_complete', 'percent', 'pct_complete', 'percentage_complete', 'percentage', 'complete_pct', 'g_over_c', 'pct']),
  line('BALANCE_TO_FINISH', ['balance_to_finish', 'balance', 'balance_remaining', 'remaining', 'remaining_balance']),
  line('LINE_RETAINAGE', ['retainage', 'retention', 'retainage_amount', 'retained', 'retainage_held']),
]

// ---------------------------------------------------------------- G702 — document
const DOCUMENT_MAPPINGS: DomainFieldMapping[] = [
  doc('DOCUMENT_ID', ['application_number', 'application_no', 'pay_app_number', 'pay_application_number', 'app_no', 'invoice_number', 'number']),
  doc('ORIGINAL_CONTRACT_SUM', ['original_contract_sum', 'original_contract_amount', 'original_contract_value', 'base_contract', 'base_contract_sum']),
  doc('NET_CHANGE_ORDERS', ['net_change_orders', 'net_change_by_change_orders', 'change_orders_net', 'net_change', 'approved_change_orders', 'approved_change_orders_total']),
  doc('CONTRACT_SUM_TO_DATE', ['contract_sum_to_date', 'revised_contract_sum', 'current_contract_sum', 'adjusted_contract_sum', 'contract_sum']),
  doc('TOTAL_COMPLETED_STORED', ['total_completed_and_stored', 'total_completed_and_stored_to_date', 'total_completed_stored_to_date', 'total_completed_to_date', 'work_completed_to_date', 'total_completed']),
  doc('RETAINAGE_RATE', ['retainage_rate', 'retainage_percent', 'retainage_percentage', 'retention_rate', 'retainage_pct', 'retention_percent']),
  doc('RETAINAGE_TOTAL', ['total_retainage', 'retainage_total', 'retainage', 'retention_total', 'total_retention', 'retainage_held']),
  doc('TOTAL_EARNED_LESS_RETAINAGE', ['total_earned_less_retainage', 'earned_less_retainage', 'net_earned', 'total_earned_less_retention']),
  doc('PREVIOUS_CERTIFICATES', ['less_previous_certificates', 'previous_certificates', 'previous_certificates_for_payment', 'less_previous_certificates_for_payment', 'previous_payments', 'previously_paid', 'prior_payments', 'previously_certified']),
  doc('CURRENT_PAYMENT_DUE', ['current_payment_due', 'payment_due', 'amount_due', 'this_payment', 'current_due', 'total_due']),
  doc('BALANCE_INCL_RETAINAGE', ['balance_to_finish_including_retainage', 'balance_to_finish_incl_retainage', 'balance_including_retainage', 'balance_to_finish', 'remaining_balance']),
  doc('CURRENCY_CODE', ['currency', 'currency_code']),
]

export const PAY_APP_ROLE_KINDS: Partial<Record<UniversalRole, RoleKind>> = {
  SOV_ITEM_ID: 'reference', SOV_DESCRIPTION: 'string',
  SCHEDULED_VALUE: 'amount', WORK_PREVIOUS: 'amount', WORK_THIS_PERIOD: 'amount', MATERIALS_STORED: 'amount',
  COMPLETED_TO_DATE: 'amount', EXPECTED_COMPLETED_TO_DATE: 'amount',
  PERCENT_COMPLETE: 'rate', EXPECTED_PERCENT_COMPLETE: 'rate',
  BALANCE_TO_FINISH: 'amount', EXPECTED_BALANCE_TO_FINISH: 'amount', LINE_RETAINAGE: 'amount', PREVIOUS_COMPLETED_TO_DATE: 'amount',
  ORIGINAL_CONTRACT_SUM: 'amount', NET_CHANGE_ORDERS: 'amount', CONTRACT_SUM_TO_DATE: 'amount', EXPECTED_CONTRACT_SUM_TO_DATE: 'amount',
  TOTAL_COMPLETED_STORED: 'amount', SOV_SCHEDULED_SUM: 'amount', SOV_COMPLETED_SUM: 'amount',
  RETAINAGE_RATE: 'rate', RETAINAGE_TOTAL: 'amount', EXPECTED_RETAINAGE_TOTAL: 'amount', SOV_RETAINAGE_SUM: 'amount',
  TOTAL_EARNED_LESS_RETAINAGE: 'amount', EXPECTED_EARNED_LESS_RETAINAGE: 'amount',
  PREVIOUS_CERTIFICATES: 'amount', PREVIOUS_EARNED_LESS_RETAINAGE: 'amount',
  CURRENT_PAYMENT_DUE: 'amount', EXPECTED_CURRENT_PAYMENT_DUE: 'amount',
  BALANCE_INCL_RETAINAGE: 'amount', EXPECTED_BALANCE_INCL_RETAINAGE: 'amount',
}

export const PAY_APP_ONTOLOGY: DomainOntology = {
  domainId: D,
  domainName: 'Construction pay application (AIA G702 / G703)',
  mappings: [...LINE_MAPPINGS, ...DOCUMENT_MAPPINGS],
  roleKinds: PAY_APP_ROLE_KINDS,
  lineArrayKeys: PAY_APP_LINE_ARRAY_KEYS,
}

export default PAY_APP_ONTOLOGY
