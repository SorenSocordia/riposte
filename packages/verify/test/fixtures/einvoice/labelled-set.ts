/**
 * PREREG-EINVOICE-TWIN-1 §4: the labelled claim set, generated deterministically from the three constructed
 * fixtures (PREREG-EINVOICE-TWIN-1, pre-registration, 2026-09-28, design sha256 dd3a707e…). SYNTHETIC: the
 * errors are seeded by rule, not produced by a model. No sampling, no randomness.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseXml, detectProfile, bindField, EINVOICE_MAPS, type EinvoiceFieldMap, type EinvoiceLabeledClaim, type EinvoiceLabeledDocument } from '../../../src/twin-einvoice/index'
import { lineElements, vatBreakdownElements, breakdownTotals } from '../../../src/twin-einvoice/map'

const HERE = dirname(fileURLToPath(import.meta.url))
export const FIXTURES = ['peppol-bis3-invoice.xml', 'zatca-standard-invoice.xml', 'ksef-fa3-invoice.xml'] as const

type Scope = { scope: 'document' | 'line' | 'vat_breakdown'; index: number }
interface Present { fm: EinvoiceFieldMap; ref: Scope; field: string; value: number | string }

const claimField = (fm: EinvoiceFieldMap, ref: Scope): string =>
  ref.scope === 'document' ? fm.field : `${ref.scope === 'line' ? 'lines' : 'vat_breakdown'}[${ref.index}].${fm.field}`

/** Swap the first adjacent pair of different digits, left to right. null when there is none. */
export function transposeFirst(s: string): string | null {
  for (let i = 0; i + 1 < s.length; i++) {
    const a = s[i]!, b = s[i + 1]!
    if (a !== b && /\d/.test(a) && /\d/.test(b)) return s.slice(0, i) + b + a + s.slice(i + 2)
  }
  return null
}

export function buildLabelledSet(): EinvoiceLabeledDocument[] {
  return FIXTURES.map((name) => {
    const xml = readFileSync(join(HERE, name), 'utf8')
    const root = parseXml(xml)
    const profile = detectProfile(root).profile!
    const map = EINVOICE_MAPS[profile]
    const scopes: Scope[] = [{ scope: 'document', index: 0 }]
    lineElements(map, root).forEach((_, i) => scopes.push({ scope: 'line', index: i }))
    if (breakdownTotals(root) === 1) vatBreakdownElements(map, root).forEach((_, i) => scopes.push({ scope: 'vat_breakdown', index: i }))

    const present: Present[] = []
    for (const ref of scopes) for (const fm of map.fields) {
      if (fm.scope !== ref.scope) continue
      const b = bindField(map, root, fm, ref)
      if (b.ok) present.push({ fm, ref, field: claimField(fm, ref), value: b.binding.value! })
    }
    const at = (field: string): Present | undefined => present.find((p) => p.field === field)
    const claims: EinvoiceLabeledClaim[] = []
    const add = (field: string, value: number | string, label: 'CLEAN' | 'ERROR', kind: string, correct: number | string): void => {
      if (label === 'ERROR' && (value === correct || (typeof value === 'number' && typeof correct === 'number' && Math.abs(value - correct) < 1e-9))) return
      claims.push({ claim: { id: `${name}:${field}:${kind}`, field, value }, label, kind })
    }

    // ---- CLEAN
    for (const p of present) {
      add(p.field, p.value, 'CLEAN', 'exact', p.value)
      if (p.fm.kind === 'identifier') { const v = (p.value as string).replace(/(.{3})(?=.)/g, '$1 '); if (v !== p.value) add(p.field, v, 'CLEAN', 'spaced_id', p.value) }
      if (p.fm.kind === 'text') { const v = (p.value as string).toUpperCase(); if (v !== p.value) add(p.field, v, 'CLEAN', 'upper_name', p.value) }
      if (p.fm.kind === 'amount') add(p.field, (p.value as number).toFixed(2), 'CLEAN', 'string_amount', p.value)
    }

    // ---- ERROR
    for (const p of present) {
      // E1 transposed digits: amounts / quantities (two-decimal rendering), identifiers (raw string)
      if (p.fm.kind === 'amount' || p.fm.kind === 'quantity') {
        const v = p.value as number
        const t = transposeFirst(Math.abs(v).toFixed(2))
        if (t !== null) add(p.field, Math.sign(v || 1) * Number(t), 'ERROR', 'transposed_digits', v)
      }
      if (p.fm.kind === 'identifier') { const t = transposeFirst(p.value as string); if (t !== null) add(p.field, t, 'ERROR', 'transposed_digits', p.value) }
      // E3 currency scale: every non-zero amount × 100
      if (p.fm.kind === 'amount' && p.value !== 0) add(p.field, Math.round((p.value as number) * 100 * 100) / 100, 'ERROR', 'currency_scale', p.value)
      // E4 party swap: document-scope counterpart pairs, both present
      if (p.fm.counterpart && p.ref.scope === 'document') { const cp = at(p.fm.counterpart); if (cp) add(p.field, cp.value, 'ERROR', 'party_swap', p.value) }
      // E5 day/month swap: day ≤ 12 and day ≠ month
      if (p.fm.kind === 'date') {
        const [y, m, d] = (p.value as string).split('-')
        if (Number(d) <= 12 && d !== m) add(p.field, `${y}-${d}-${m}`, 'ERROR', 'day_month_swap', p.value)
      }
    }
    // E2 VAT total vs net
    const swapFrom = (field: string, from: string): void => { const a = at(field), b = at(from); if (a && b) add(field, b.value, 'ERROR', 'vat_vs_net', a.value) }
    if (profile === 'ksef-fa3') {
      for (const x of [1, 2, 3, 4, 5]) swapFrom(`P_14_${x}`, `P_13_${x}`)
      const nets = present.filter((p) => p.ref.scope === 'document' && /^P_13_/.test(p.field))
      const p15 = at('P_15')
      if (p15 && nets.length) add('P_15', Math.round(nets.reduce((s, p) => s + (p.value as number), 0) * 100) / 100, 'ERROR', 'vat_vs_net', p15.value)
    } else {
      swapFrom('tax_amount', 'tax_exclusive_amount')
      swapFrom('tax_amount_accounting_currency', 'tax_exclusive_amount')
      swapFrom('tax_exclusive_amount', 'tax_inclusive_amount')
      for (const p of present) if (p.ref.scope === 'vat_breakdown' && p.fm.field === 'tax_amount') swapFrom(p.field, `vat_breakdown[${p.ref.index}].taxable_amount`)
      if (profile === 'zatca-ksa') for (const p of present) if (p.ref.scope === 'line' && p.fm.field === 'vat_amount') swapFrom(p.field, `lines[${p.ref.index}].net_amount`)
    }
    return { name, xml, claims }
  })
}
