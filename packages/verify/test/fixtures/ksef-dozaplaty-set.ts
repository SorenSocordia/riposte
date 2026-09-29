/**
 * The constructed set for the KSeF DoZaplaty identity (ruleset 0.2.0, E-INVOICE-2, 2026-09-28). Pre-registered in
 * "KSeF FA(3) DoZaplaty identity", pre-registration, 2026-09-28, before this file existed. CONSTRUCTED; not field data.
 *
 * Identity (FA(3) XSD, Rozliczenie/DoZaplaty; MF information sheet p.105): DoZaplaty = P_15 + SumaObciazen − SumaOdliczen,
 * where SumaObciazen / SumaOdliczen are the sums of the Kwota of the Obciazenia / Odliczenia items.
 * `expect` is the outcome of DOZAPLATY_INT by construction: PASS (CLEAN), FAIL (ERROR), or ABSTAIN (by design).
 */
export interface DoZaplatyCase { id: string; why: string; label: 'CLEAN' | 'ERROR' | 'BY_DESIGN'; expect: 'PASS' | 'FAIL' | 'ABSTAIN'; extraction: Record<string, unknown> }

const item = (Kwota: number, Powod: string) => ({ Kwota, Powod })
const R = (P_15: number, rozliczenie: Record<string, unknown>) => ({ P_15, Rozliczenie: rozliczenie })

export const KSEF_DOZAPLATY_SET: DoZaplatyCase[] = [
  { id: 'C1-no-items', label: 'CLEAN', expect: 'PASS', why: 'nothing added or deducted: DoZaplaty = P_15', extraction: R(100, { DoZaplaty: 100 }) },
  { id: 'C2-charge', label: 'CLEAN', expect: 'PASS', why: '40.00 + a 2.50 deposit charge = 42.50', extraction: R(40, { Obciazenia: [item(2.5, 'Kaucja')], SumaObciazen: 2.5, DoZaplaty: 42.5 }) },
  { id: 'C3-deduction', label: 'CLEAN', expect: 'PASS', why: '1,230.00 − a 200.00 overpayment = 1,030.00', extraction: R(1230, { Odliczenia: [item(200, 'Nadpłata')], SumaOdliczen: 200, DoZaplaty: 1030 }) },
  { id: 'C4-both', label: 'CLEAN', expect: 'PASS', why: '500.00 + 20.00 − (50.00 + 20.00) = 450.00', extraction: R(500, { Obciazenia: [item(20, 'Odsetki')], SumaObciazen: 20, Odliczenia: [item(50, 'Rabat'), item(20, 'Nadpłata')], SumaOdliczen: 70, DoZaplaty: 450 }) },
  { id: 'C5-zero-sums', label: 'CLEAN', expect: 'PASS', why: 'both sums stated as 0.00', extraction: R(53.63, { Obciazenia: [item(0, 'Odsetki')], SumaObciazen: 0, Odliczenia: [item(0, 'Nadpłata')], SumaOdliczen: 0, DoZaplaty: 53.63 }) },
  { id: 'E1-charge-ignored', label: 'ERROR', expect: 'FAIL', why: 'DoZaplaty left at P_15 despite a 2.50 charge', extraction: R(40, { Obciazenia: [item(2.5, 'Kaucja')], SumaObciazen: 2.5, DoZaplaty: 40 }) },
  { id: 'E2-deduction-added', label: 'ERROR', expect: 'FAIL', why: 'the 200.00 deduction added instead of subtracted', extraction: R(1230, { Odliczenia: [item(200, 'Nadpłata')], SumaOdliczen: 200, DoZaplaty: 1430 }) },
  { id: 'E3-one-cent', label: 'ERROR', expect: 'FAIL', why: '450.01 for 450.00', extraction: R(500, { Obciazenia: [item(20, 'Odsetki')], SumaObciazen: 20, Odliczenia: [item(70, 'Rabat')], SumaOdliczen: 70, DoZaplaty: 450.01 }) },
  { id: 'E4-two-cents-large', label: 'ERROR', expect: 'FAIL', why: '250,000.02 for 250,000.00 (the old 0.02 band would have forgiven it)', extraction: R(250000, { DoZaplaty: 250000.02 }) },
  { id: 'A1-items-without-sum', label: 'BY_DESIGN', expect: 'ABSTAIN', why: 'Obciazenia items but no SumaObciazen: the engine does not sum the items', extraction: R(40, { Obciazenia: [item(2.5, 'Kaucja')], DoZaplaty: 42.5 }) },
  { id: 'A2-overpaid', label: 'BY_DESIGN', expect: 'ABSTAIN', why: 'DoRozliczenia instead of DoZaplaty: its sign is not stated, so it is not checked', extraction: R(100, { Odliczenia: [item(150, 'Nadpłata')], SumaOdliczen: 150, DoRozliczenia: 50 }) },
  { id: 'A3-no-rozliczenie', label: 'BY_DESIGN', expect: 'ABSTAIN', why: 'no Rozliczenie section at all', extraction: { P_15: 100 } },
]
