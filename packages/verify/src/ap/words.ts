/**
 * Money and the total check in a clerk's words (engine 0.6.0, 2026-10-05), shared by the text path (./index.ts),
 * the structured path (./structured.ts) and the PO balance check (./po-balance.ts). Rendering only: no value, outcome or id
 * depends on it. Engines up to 0.5.0 keep their own wording, byte for byte.
 */

/** Money as a clerk reads it: thousands grouped, the currency's minor digits (more only when the value has them). */
export function moneyWords(x: number, digits: number): string {
  let d = Math.max(0, digits)
  while (d < 6 && Math.abs(Math.round(x * 10 ** d) - x * 10 ** d) > 1e-6) d++
  const [w, f] = Math.abs(x).toFixed(d).split('.') as [string, string | undefined]
  return `${x < 0 ? '-' : ''}${w.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${f ? `.${f}` : ''}`
}

/**
 * The total check's explanation under engine 0.6.0: what the lines add to, then what the bill says, then by how much it is off.
 * "The lines add to 20,961.36; the bill says 21,078.97; over by 117.61." (Before: "Stated total 21078.97; lines 20961.36 =
 * 20961.36. Does not add up.", which repeats one number and names neither difference.)
 */
export function totalWords(x: { stated: number; lines: number; sum: number; ok: boolean; freight?: number | null; freightAllowed?: boolean | null; tax?: number | null; digits: number
  /** 2026-10-05: 'policy' when the PO does not say and the run's freight policy (`ap --freight allow`) allowed it */
  freightBy?: 'po' | 'policy' }): string {
  const M = (n: number): string => moneyWords(n, x.digits)
  const parts = [`The lines add to ${M(x.lines)}`]
  const extra: string[] = []
  if (x.freight !== undefined && x.freight !== null) {
    if (x.freightAllowed && x.freightBy === 'policy') extra.push(`freight ${M(x.freight)}, which the PO does not address and the run's freight policy allows`)
    else if (x.freightAllowed) extra.push(`freight ${M(x.freight)}, which the PO allows`)
    else parts.push(`freight ${M(x.freight)} is billed, but the PO does not allow freight, so it is left out`)
  }
  if (x.tax !== undefined && x.tax !== null) extra.push(`tax ${M(x.tax)}`)
  if (extra.length) parts[0] = `${parts[0]}, plus ${extra.join(' and ')}: ${M(x.sum)} in all`
  parts.push(`the bill says ${M(x.stated)}`)
  if (!x.ok) {
    const off = Math.round((x.stated - x.sum) * 1e6) / 1e6
    parts.push(`${off > 0 ? 'over' : 'under'} by ${M(Math.abs(off))}`)
  }
  return `${parts.join('; ')}.`
}
