/**
 * Multilingual verification (2026-09-22): deterministic checking is language-agnostic on the numbers; only field NAMES
 * differ by language. A Spanish / French / German invoice with native field names must verify — no model, no English.
 * This is the wall the English-only, US-cloud incumbents (Bedrock AR) cannot cross. Proven separately on real Indonesian
 * receipts (test/real-cord.test.ts).
 */
import { describe, it, expect } from 'vitest'
import { verify } from '../src/index'
import type { Json } from '../src/index'

const NOW = () => new Date('2026-09-22T00:00:00Z')
const claim = (v: ReturnType<typeof verify>, id: string) => {
  const c = v.claims.find(x => x.claim_id === id)
  if (!c) throw new Error(`claim ${id} not found; have ${v.claims.map(x => x.claim_id).join(', ')}`)
  return c
}

describe('multilingual invoice field names verify deterministically (no English required)', () => {
  it('SPANISH: factura foots — cantidad × precio = importe, subtotal + IVA = total', () => {
    const es: Json = {
      invoice_number: 'FAC-2001', moneda: 'EUR',
      line_items: [
        { descripcion: 'Consultoría', cantidad: 10, precio_unitario: 150, importe: 1500 },
        { descripcion: 'Viaje', cantidad: 1, precio_unitario: 250, importe: 250 },
      ],
      totals: { subtotal: 1750, tipo_iva: 0.21, impuesto: 367.5, total: 2117.5 },
    }
    const v = verify(es, { now: NOW })
    expect(claim(v, 'document.SUM_INT').outcome, 'footing').toBe('PASS')
    expect(claim(v, 'document.TAX_INT').outcome, 'IVA').toBe('PASS')
    expect(claim(v, 'document.TOTAL_INT').outcome, 'total').toBe('PASS')
    expect(claim(v, 'line[0].MATH_INT').outcome).toBe('PASS')
    expect(v.outcome).toBe('PASS')
  })

  it('GERMAN: Rechnung foots — Menge × Einzelpreis = Betrag, Zwischensumme + MwSt = Gesamtbetrag', () => {
    const de: Json = {
      invoice_number: 'RE-3001', waehrung: 'EUR',
      line_items: [{ beschreibung: 'Beratung', menge: 4, einzelpreis: 200, betrag: 800 }],
      totals: { zwischensumme: 800, steuersatz: 0.19, mwst: 152, gesamtbetrag: 952 },
    }
    const v = verify(de, { now: NOW })
    expect(claim(v, 'document.SUM_INT').outcome).toBe('PASS')
    expect(claim(v, 'document.TAX_INT').outcome).toBe('PASS')
    expect(claim(v, 'document.TOTAL_INT').outcome).toBe('PASS')
    expect(v.outcome).toBe('PASS')
  })

  it('FRENCH: a broken facture still FAILs on exactly the wrong number (verification, not translation)', () => {
    const fr: Json = {
      invoice_number: 'FAC-FR-1', devise: 'EUR',
      line_items: [{ designation: 'Service', quantite: 2, prix_unitaire: 100, montant: 200 }],
      totals: { sous_total: 200, tva: 0, total: 999 }, // total wrong: 999 ≠ 200
    }
    const v = verify(fr, { now: NOW })
    expect(claim(v, 'document.SUM_INT').outcome).toBe('PASS')      // lines foot to the subtotal
    expect(claim(v, 'document.TOTAL_INT').outcome).toBe('FAIL')     // but the total is wrong
    expect(claim(v, 'document.TOTAL_INT').variance).toBe(799)
    expect(v.outcome).toBe('FAIL')
  })

  it('JAPANESE with FULL-WIDTH digits: 小計 + 消費税 = 合計 (digits folded, no model)', () => {
    const ja: Json = {
      invoice_number: 'JP-1', 通貨: 'JPY',
      line_items: [{ 品名: 'コンサル', 数量: '２', 単価: '５０００', 金額: '１００００' }], // full-width digits
      totals: { 小計: '１００００', 税率: 0.1, 消費税: '１０００', 合計: '１１０００' },
    }
    const v = verify(ja, { now: NOW })
    expect(claim(v, 'document.SUM_INT').outcome, 'footing').toBe('PASS')
    expect(claim(v, 'document.TAX_INT').outcome, '消費税').toBe('PASS')
    expect(claim(v, 'document.TOTAL_INT').outcome, '合計').toBe('PASS')
    expect(v.outcome).toBe('PASS')
  })

  it('ARABIC with Arabic-Indic digits: الكمية × سعر = المبلغ, المجموع الفرعي + الضريبة = المجموع', () => {
    const ar: Json = {
      invoice_number: 'AR-1', العملة: 'AED',
      line_items: [{ الوصف: 'خدمة', الكمية: '٢', سعر_الوحدة: '١٠٠', المبلغ: '٢٠٠' }], // Arabic-Indic digits
      totals: { subtotal: '٢٠٠', الضريبة: '١٠', المجموع: '٢١٠' },
    }
    const v = verify(ar, { now: NOW })
    expect(claim(v, 'document.SUM_INT').outcome, 'footing').toBe('PASS')
    expect(claim(v, 'document.TOTAL_INT').outcome).toBe('PASS')
    expect(v.outcome).toBe('PASS')
  })

  it('an EU-formatted German total ("1.234,56") normalizes and verifies', () => {
    const de: Json = {
      invoice_number: 'RE-3002', waehrung: 'EUR',
      line_items: [{ beschreibung: 'Ware', menge: 1, einzelpreis: '1.234,56', betrag: '1.234,56' }],
      totals: { zwischensumme: '1.234,56', steuersatz: 0, mwst: 0, gesamtbetrag: '1.234,56' },
    }
    expect(verify(de, { now: NOW }).outcome).toBe('PASS')
  })
})
