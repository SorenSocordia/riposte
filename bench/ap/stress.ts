/**
 * Stress test (see README.md). Meaning-preserving perturbations of the INVOICE text only; the production AP pack is
 * called unmodified. Deterministic (seeded per case × perturbation). Writes results/stress-<P>.jsonl and prints a scorecard.
 *   npx tsx bench/ap/stress.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyInvoiceMatch, splitApLayout, parseInvoice } from 'riposte-verify'

const HERE = dirname(fileURLToPath(import.meta.url))
const cases = readFileSync(join(HERE, 'data', 'distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))

function rng(seedText: string): () => number {
  let a = createHash('sha256').update(seedText).digest().readUInt32LE(0)
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** The invoice's line-item lines as the ORIGINAL text reads them (index into the invoice's lines + parsed fields). */
function itemLines(invoice: string): { idx: number; name: string; qty: number; unit: number; amount: number }[] {
  const lines = invoice.split('\n')
  const parsed = parseInvoice(invoice)
  return parsed.lines.map((l) => ({ idx: l.span.line - 1, name: l.name, qty: l.qty, unit: l.unit, amount: l.amount })).filter((l) => lines[l.idx] !== undefined)
}

const fmt = (x: number, mode: 'plain' | 'space' | 'comma'): string => {
  const [i, d] = x.toFixed(2).split('.') as [string, string]
  const grouped = mode === 'plain' ? i : i.replace(/\B(?=(\d{3})+(?!\d))/g, mode === 'space' ? ' ' : ',')
  return `${grouped}.${d}`
}

const SYN: Record<string, string> = { inch: 'in', inches: 'in', unit: 'u', units: 'u', yellow: 'yel', extension: 'ext', cartridge: 'cart', roll: 'rl', person: 'p', heavy: 'hvy', duty: 'dty', black: 'blk', white: 'wht', small: 'sm', large: 'lg', medium: 'med', package: 'pkg', assorted: 'asst' }
function reword(name: string, r: () => number): string {
  return name.split(/(\s+)/).map((w) => {
    if (/\d/.test(w) || !/[a-z]/i.test(w)) return w
    const lw = w.toLowerCase().replace(/[^a-z]/g, '')
    if (SYN[lw] && r() < 0.8) return SYN[lw]!.toUpperCase()
    if (lw.length >= 7 && r() < 0.5) return (w[0] + w.slice(1).replace(/[aeiou]/gi, '')).toUpperCase()
    return w.toUpperCase()
  }).join('')
}

type P = 'P1_order' | 'P2_wording' | 'P3_numbers' | 'P4_ocr' | 'P5_layout' | 'P6_all'

function perturb(invoice: string, kind: P, seed: string): string {
  const r = rng(seed)
  let lines = invoice.split('\n')
  const items = itemLines(invoice)
  const doOrder = kind === 'P1_order' || kind === 'P6_all'
  const doWord = kind === 'P2_wording' || kind === 'P6_all'
  const doNum = kind === 'P3_numbers' || kind === 'P6_all'
  const doLayout = kind === 'P5_layout' || kind === 'P6_all'
  const doOcr = kind === 'P4_ocr' || kind === 'P6_all'
  const numMode: 'plain' | 'space' = r() < 0.5 ? 'plain' : 'space'
  const cur = ['USD ', '$', ''][Math.floor(r() * 3)] as string
  const curAfter = cur === '' ? ' USD' : ''
  const layoutMode = r() < 0.5 ? 'table' : 'prose'

  // re-render item lines (wording / numbers / layout); position-preserving
  const rendered = items.map((it) => {
    const name = doWord ? reword(it.name, r) : it.name
    if (!doNum && !doLayout && !doWord) return lines[it.idx]!
    const u = doNum ? `${cur}${fmt(it.unit, numMode)}${curAfter}` : `USD ${fmt(it.unit, 'comma')}`
    const a = doNum ? `${cur}${fmt(it.amount, numMode)}${curAfter}` : `USD ${fmt(it.amount, 'comma')}`
    if (doLayout) return layoutMode === 'table' ? `${name} | ${it.qty} | ${u} | ${a}` : `${it.qty} x ${name} at ${u} each, ${a}`
    return `- ${it.qty} x ${name} @ ${u} = ${a}`
  })
  // order
  const slots = items.map((it) => it.idx)
  const order = rendered.map((_, i) => i)
  if (doOrder) for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!] }
  slots.forEach((slot, k) => { lines[slot] = rendered[order[k]!]! })

  // numbers outside item lines: totals / freight — reformat only the money amounts (never change value)
  if (doNum) {
    lines = lines.map((l, i) => slots.includes(i) ? l : l.replace(/(USD\s*)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})\b/g, (m, _c, int: string, dec: string) => {
      const v = Number(int.replace(/,/g, '') + dec)
      return `${cur}${fmt(v, numMode)}${curAfter}`
    }))
  }
  // OCR noise: letters only, never inside tokens that contain digits or hyphens (IDs/numbers stay exact)
  if (doOcr) {
    lines = lines.map((l) => l.split(/(\s+)/).map((tok) => {
      if (/[\d-]/.test(tok) || tok.trim() === '') return tok.replace(/ {1}/g, () => (r() < 0.05 ? '  ' : ' '))
      let t = tok
      if (t.length > 3 && r() < 0.12) { const k = 1 + Math.floor(r() * (t.length - 2)); t = t.slice(0, k) + t[k + 1] + t[k] + t.slice(k + 2) }
      if (r() < 0.05) t = t.replace(/[,;:!?]$/, '')
      return t
    }).join(''))
  }
  return lines.join('\n')
}

const SEED_SUFFIX = process.argv.includes('--seed') ? ':' + process.argv[process.argv.indexOf('--seed') + 1] : ''
const KINDS: P[] = ['P1_order', 'P2_wording', 'P3_numbers', 'P4_ocr', 'P5_layout', 'P6_all']
mkdirSync(join(HERE, 'results'), { recursive: true })
const NOW = () => new Date('2026-09-23T00:00:00Z')
console.log('| perturbation | decided | WRONG | correct | abstained | six-field |')
console.log('|---|---|---|---|---|---|')
let totalWrong = 0
for (const kind of KINDS) {
  let decided = 0, wrong = 0, correct = 0, abst = 0, six = 0
  const rows: string[] = []
  for (const c of cases) {
    const d = splitApLayout(c.input)!
    const inv2 = perturb(d.invoice, kind, `${c.id}:${kind}${SEED_SUFFIX}`)
    const r = verifyInvoiceMatch({ ...d, invoice: inv2 }, { now: NOW })
    const ok = r.decision === c.decision
    if (r.decision === 'abstain') abst++; else { decided++; if (ok) correct++; else wrong++ }
    const g = r.grounding
    const numEq = (a: unknown, b: unknown): boolean => (a == null || b == null) ? a == null && b == null : typeof b === 'number' ? Math.abs(Number(a) - b) <= 0.005 : String(a) === String(b)
    if (ok && g.invoice_number === c.invoice.invoice_number && g.po_number === c.invoice.po_number && (g.item ?? null) === (c.grounding?.item ?? null) &&
      numEq(g.invoiced, c.grounding?.invoice_value ?? null) && numEq(g.expected, c.grounding?.reference_value ?? null)) six++
    rows.push(JSON.stringify({ id: c.id, kind: c.kind, gold: c.decision, got: r.decision, wrong: r.decision !== 'abstain' && !ok, reasons: r.reasons, invoice_perturbed: inv2 }))
  }
  totalWrong += wrong
  writeFileSync(join(HERE, 'results', `stress-${kind}${SEED_SUFFIX.replace(':', '-')}.jsonl`), rows.join('\n') + '\n')
  console.log(`| ${kind} | ${decided} | ${wrong} | ${correct} | ${abst} | ${six} |`)
}
console.log(`\nTOTAL wrong decisions across all perturbations: ${totalWrong}`)
