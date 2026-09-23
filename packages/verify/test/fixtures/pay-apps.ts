/**
 * Golden fixtures for the pay-application ruleset (AIA G702 / G703). Every fixture states what the verifier MUST say.
 *
 * The project: contract 95,000 + 5,000 change orders = 100,000 across three schedule-of-values items.
 * Application #1 (prevApp) billed 30,000; application #2 (cleanApp) bills to 62,000 with 10% retainage.
 */

export type Json = Record<string, unknown>

export const FIXED_NOW = () => new Date('2026-09-22T00:00:00Z')

/** Application #1 — the previous application. Σ G = 30,000; retainage 3,000; earned less retainage 27,000. */
export const prevApp: Json = {
  application_number: 1,
  original_contract_sum: 95000, net_change_orders: 5000, contract_sum_to_date: 100000,
  schedule_of_values: [
    { item_no: '1', description: 'Mobilization', scheduled_value: 10000, previous: 0, this_period: 10000, materials_stored: 0, completed_to_date: 10000, percent_complete: 100, balance_to_finish: 0, retainage: 1000 },
    { item_no: '2', description: 'Concrete', scheduled_value: 50000, previous: 0, this_period: 20000, materials_stored: 0, completed_to_date: 20000, percent_complete: 40, balance_to_finish: 30000, retainage: 2000 },
    { item_no: '3', description: 'Framing', scheduled_value: 40000, previous: 0, this_period: 0, materials_stored: 0, completed_to_date: 0, percent_complete: 0, balance_to_finish: 40000, retainage: 0 },
  ],
  total_completed_and_stored: 30000, retainage_rate: '10%', total_retainage: 3000,
  total_earned_less_retainage: 27000, current_payment_due: 27000, balance_to_finish_including_retainage: 73000,
}

/** Application #2 — every line of both forms foots. With prevApp as history, continuity holds too. */
export const cleanApp: Json = {
  application_number: 2, currency: 'USD',
  original_contract_sum: 95000, net_change_orders: 5000, contract_sum_to_date: 100000,
  schedule_of_values: [
    { item_no: '1', description: 'Mobilization', scheduled_value: 10000, previous: 10000, this_period: 0, materials_stored: 0, completed_to_date: 10000, percent_complete: 100, balance_to_finish: 0, retainage: 1000 },
    { item_no: '2', description: 'Concrete', scheduled_value: 50000, previous: 20000, this_period: 15000, materials_stored: 5000, completed_to_date: 40000, percent_complete: 80, balance_to_finish: 10000, retainage: 4000 },
    { item_no: '3', description: 'Framing', scheduled_value: 40000, previous: 0, this_period: 12000, materials_stored: 0, completed_to_date: 12000, percent_complete: 30, balance_to_finish: 28000, retainage: 1200 },
  ],
  total_completed_and_stored: 62000, retainage_rate: '10%', total_retainage: 6200,
  total_earned_less_retainage: 55800, less_previous_certificates: 27000, current_payment_due: 28800,
  balance_to_finish_including_retainage: 44200,
}

/**
 * Application #2 with five independent errors:
 *   line[1] G stated 41,000 but D+E+F = 40,000        → G703_TOTAL FAIL, variance 1,000
 *   line[1] H stated 10,000 but C−G = 9,000           → G703_BAL FAIL, variance 1,000
 *   line[1] % stated 80 but G÷C = 0.82                → G703_PCT FAIL
 *   line[2] E = 45,000 → G = 45,000 > C = 40,000       → G703_CAP FAIL, variance 5,000
 *   line 4 stated 62,000 but Σ G = 96,000              → G702_DONE FAIL, variance −34,000
 * Everything else stays coherent with the stated line 4.
 */
export const brokenApp: Json = {
  ...cleanApp,
  schedule_of_values: [
    { item_no: '1', description: 'Mobilization', scheduled_value: 10000, previous: 10000, this_period: 0, materials_stored: 0, completed_to_date: 10000, percent_complete: 100, balance_to_finish: 0, retainage: 1000 },
    { item_no: '2', description: 'Concrete', scheduled_value: 50000, previous: 20000, this_period: 15000, materials_stored: 5000, completed_to_date: 41000, percent_complete: 80, balance_to_finish: 10000, retainage: 4000 },
    { item_no: '3', description: 'Framing', scheduled_value: 40000, previous: 0, this_period: 45000, materials_stored: 0, completed_to_date: 45000, percent_complete: 112.5, balance_to_finish: -5000, retainage: 1200 },
  ],
}

/** A first application: no previous work, no previous certificates (line 7 blank). Line 8 must equal line 6. */
export const firstApp: Json = {
  application_number: 1,
  original_contract_sum: 100000, contract_sum_to_date: 100000,
  schedule_of_values: [
    { item_no: '1', description: 'Mobilization', scheduled_value: 10000, this_period: 10000, completed_to_date: 10000, percent_complete: '100%', balance_to_finish: 0, retainage: 1000 },
    { item_no: '2', description: 'Concrete', scheduled_value: 90000, this_period: 0, completed_to_date: 0, percent_complete: '0%', balance_to_finish: 90000, retainage: 0 },
  ],
  total_completed_and_stored: 10000, retainage_rate: 10, total_retainage: 1000,
  total_earned_less_retainage: 9000, current_payment_due: 9000, balance_to_finish_including_retainage: 91000,
}

/** Percent complete extracted as bare fractions in (0, 1] — 1 could be 1% or 100%. Must abstain AMBIGUOUS_UNIT, never guess. */
export const barePercent: Json = {
  ...cleanApp,
  schedule_of_values: (cleanApp.schedule_of_values as Json[]).map((l, i) => ({ ...l, percent_complete: [1, 0.8, 0.3][i] })),
}

/** Alternate vocabulary an extractor might emit: `line_items`, `from_previous_application`, `total_completed_and_stored`, summary block. */
export const altVocab: Json = {
  pay_app_number: 'PA-002',
  summary: {
    original_contract_sum: 95000, net_change_by_change_orders: 5000, revised_contract_sum: 100000,
    total_completed_and_stored_to_date: 62000, retainage_percent: '10%', retainage: 6200,
    earned_less_retainage: 55800, previous_certificates_for_payment: 27000, payment_due: 28800, balance_to_finish_incl_retainage: 44200,
  },
  line_items: [
    { item_number: 1, description_of_work: 'Mobilization', scheduled_value: '$10,000.00', from_previous_application: '$10,000.00', work_completed_this_period: '$0.00', stored_materials: '$0.00', total_completed_and_stored: '$10,000.00', percent: '100%', balance: '$0.00', retention: '$1,000.00' },
    { item_number: 2, description_of_work: 'Concrete', scheduled_value: '$50,000.00', from_previous_application: '$20,000.00', work_completed_this_period: '$15,000.00', stored_materials: '$5,000.00', total_completed_and_stored: '$40,000.00', percent: '80%', balance: '$10,000.00', retention: '$4,000.00' },
    { item_number: 3, description_of_work: 'Framing', scheduled_value: '$40,000.00', from_previous_application: '$0.00', work_completed_this_period: '$12,000.00', stored_materials: '$0.00', total_completed_and_stored: '$12,000.00', percent: '30%', balance: '$28,000.00', retention: '$1,200.00' },
  ],
}

/** A previous application that lists item 2 twice — continuity for item 2 must abstain AMBIGUOUS_REFERENCE. */
export const prevAppDupItems: Json = {
  ...prevApp,
  schedule_of_values: [...(prevApp.schedule_of_values as Json[]), { item_no: '2', description: 'Concrete (dup)', scheduled_value: 0, completed_to_date: 999 }],
}

/** Application #2 whose "previous" column disagrees with application #1 (item 2: 25,000 vs 20,000). */
export const driftApp: Json = {
  ...cleanApp,
  schedule_of_values: (cleanApp.schedule_of_values as Json[]).map((l, i) => (i === 1 ? { ...l, previous: 25000, completed_to_date: 45000, percent_complete: 90, balance_to_finish: 5000 } : l)),
}

export const ALL_PAY_APPS: Array<[string, Json]> = [
  ['prevApp', prevApp],
  ['cleanApp', cleanApp],
  ['brokenApp', brokenApp],
  ['firstApp', firstApp],
  ['barePercent', barePercent],
  ['altVocab', altVocab],
  ['driftApp', driftApp],
]
