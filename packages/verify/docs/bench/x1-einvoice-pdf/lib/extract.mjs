// X1 extractor (the step a MODEL would do in the real-world path; here deterministic, see RESULTS.md):
//   1. words with positions: the PDF text layer (pdfjs-dist, pinned 5.4.296) when the page has one; otherwise OCR:
//      poppler renders the page at 300 dpi, Tesseract 5.4 detects orientation (--psm 0), sharp turns the image upright,
//      Tesseract reads it (--psm 6, TSV word boxes). Tesseract's recognizer is an LSTM network, a small neural model
//      (CPU) that reads characters; it does not interpret fields.
//   2. a deterministic, label-anchored parser maps the words to the invoice fields.
// THE SAFETY RULE: a value is taken only if it parses STRICTLY (amount = the document's own decimal separator, exactly
// 2 decimals, valid digit grouping). No character repair (no O->0, l->1). A value that does not parse is OMITTED, so the
// ruleset abstains on it instead of checking a guess.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFTOPPM } from './render.mjs'

export const TESSERACT = 'C:/Program Files/Tesseract-OCR/tesseract.exe'
export const EXTRACTOR_VERSION = 'x1-extract 1.0'
const require = createRequire(import.meta.url)
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href

// ------------------------------------------------------------------------------------------------ words
async function textLayerWords(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise
  const page = await doc.getPage(1)
  const vp = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent()
  const words = []
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue
    const [a, b, , , e, f] = it.transform
    const size = Math.hypot(a, b) || it.height
    const yTop = vp.height - f - size, yBot = vp.height - f
    // split the item into words, apportioning x by character count (Helvetica is proportional: approximate inside an
    // item; exact at the item's two ends, which is what column logic reads)
    const s = it.str, n = s.length
    const re = /\S+/g
    let m
    while ((m = re.exec(s))) {
      const x0 = e + it.width * (m.index / n), x1 = e + it.width * ((m.index + m[0].length) / n)
      words.push({ t: m[0], x0, x1: m.index + m[0].length === s.trimEnd().length ? e + it.width * (s.trimEnd().length / n) : x1, yTop, yBot, line: null })
    }
  }
  await doc.destroy()
  return { words, route: 'text-layer', pageW: vp.width }
}

function ocrWords(bytes, workDir) {
  const dir = mkdtempSync(join(workDir, 'o-'))
  try {
    writeFileSync(join(dir, 'in.pdf'), bytes)
    execFileSync(PDFTOPPM, ['-r', '300', '-gray', '-png', '-singlefile', join(dir, 'in.pdf'), join(dir, 'p')], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    const env = { ...process.env, OMP_THREAD_LIMIT: '1' }
    let rotate = 0, osd = ''
    try {
      osd = execFileSync(TESSERACT, [join(dir, 'p.png'), 'stdout', '--psm', '0'], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
      const m = osd.match(/Rotate:\s*(\d+)/)
      if (m) rotate = Number(m[1])
    } catch (e) { osd = 'OSD failed: ' + String(e.stderr ?? e.message).slice(0, 200) }
    return { dir, rotate, osd, env }
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
}

async function ocrRead(bytes, workDir) {
  const { dir, rotate, osd, env } = ocrWords(bytes, workDir)
  try {
    let img = join(dir, 'p.png')
    if (rotate) {
      const out = join(dir, 'u.png')
      await sharp(img).rotate(rotate).png().toFile(out)
      img = out
    }
    const meta = await sharp(img).metadata()
    const tsv = execFileSync(TESSERACT, [img, 'stdout', '--psm', '6', '-c', 'preserve_interword_spaces=1', 'tsv'], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }).toString()
    const k = 72 / 300
    const words = []
    for (const row of tsv.split(/\r?\n/).slice(1)) {
      const c = row.split('\t')
      if (c.length < 12 || c[0] !== '5') continue
      const t = c[11].trim()
      if (!t) continue
      const left = +c[6], top = +c[7], w = +c[8], h = +c[9]
      words.push({ t, x0: left * k, x1: (left + w) * k, yTop: top * k, yBot: (top + h) * k, line: `${c[2]}.${c[3]}.${c[4]}`, conf: +c[10] })
    }
    return { words, route: 'ocr', rotate, osd: osd.trim().split(/\r?\n/).filter(l => /Rotate|Orientation conf|Script:/.test(l)).join('; '), pageW: meta.width * k }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// ------------------------------------------------------------------------------------------------ rows
function toRows(words) {
  const rows = []
  if (words.length && words[0].line !== null) {
    // OCR: Tesseract's own line grouping (robust to mild skew)
    const by = new Map()
    for (const w of words) { if (!by.has(w.line)) by.set(w.line, []); by.get(w.line).push(w) }
    for (const ws of by.values()) rows.push(ws)
  } else {
    // text layer: cluster by baseline
    const sorted = [...words].sort((a, b) => a.yBot - b.yBot || a.x0 - b.x0)
    for (const w of sorted) {
      const r = rows.find(r => Math.abs(r.yBot - w.yBot) < 2.5)
      if (r) r.ws.push(w); else rows.push({ yBot: w.yBot, ws: [w] })
    }
    return rows.map(r => r.ws.sort((a, b) => a.x0 - b.x0)).sort((a, b) => a[0].yBot - b[0].yBot)
  }
  return rows.map(ws => ws.sort((a, b) => a.x0 - b.x0)).sort((a, b) => median(a.map(w => w.yBot)) - median(b.map(w => w.yBot)))
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

// ------------------------------------------------------------------------------------------------ numbers
export function detectDecimal(words) {
  let dot = 0, comma = 0
  for (const w of words) {
    const t = w.t.replace(/^[A-Z]{3}/, '')
    if (!/^-?\d[\d.,]*[.,]\d{2}$/.test(t)) continue
    if (t[t.length - 3] === '.') dot++; else comma++
  }
  if (dot === comma) return null
  return dot > comma ? '.' : ','
}
const esc = (c) => (c === '.' ? '\\.' : c)
function numRe(dec, minDec, maxDec, grouping) {
  const g = dec === '.' ? ',' : '.'
  const frac = maxDec === 0 ? '' : `(?:${esc(dec)}\\d{${minDec},${maxDec}})${minDec === 0 ? '?' : ''}`
  const int = grouping ? `(?:\\d{1,3}(?:${esc(g)}\\d{3})+|\\d+)` : '\\d+'
  return new RegExp(`^-?${int}${frac}$`)
}
function toNum(s, dec) {
  const g = dec === '.' ? ',' : '.'
  const n = Number(s.split(g).join('').replace(dec, '.'))
  return Number.isFinite(n) ? n : null
}
export const parseAmount = (s, dec) => (dec && numRe(dec, 2, 2, true).test(s) ? toNum(s, dec) : null)
export const parsePrice = (s, dec) => (dec && numRe(dec, 2, 6, true).test(s) ? toNum(s, dec) : null)
export const parseQty = (s, dec) => (dec && numRe(dec, 0, 6, false).test(s) ? toNum(s, dec) : null)
export const parseRate = (s, dec) => { if (!dec || !s.endsWith('%')) return null; const b = s.slice(0, -1); return numRe(dec, 0, 4, false).test(b) ? toNum(b, dec) : null }
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s)

// ------------------------------------------------------------------------------------------------ labels
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9%.:]/g, '')
function lev(a, b) {
  if (a === b) return 0
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
// a label word matches a page word exactly, or (OCR) within one edit when the label word has >= 5 characters
const wordMatch = (lw, pw) => { const a = norm(lw), b = norm(pw); return a === b || (a.length >= 5 && lev(a, b) <= 1) }
/** find `label` (multi-word) in a row; returns { start, end } word indices or null. The match must be MAXIMAL: the next
 *  word, if it sits close (< 8 pt) and is alphabetic lower-case, would continue a longer label, so it is not a match. */
function findLabel(row, label) {
  const lw = label.split(' ')
  for (let i = 0; i + lw.length <= row.length; i++) {
    let ok = true
    for (let j = 0; j < lw.length; j++) if (!wordMatch(lw[j], row[i + j].t)) { ok = false; break }
    if (!ok) continue
    const nx = row[i + lw.length]
    if (nx && nx.x0 - row[i + lw.length - 1].x1 < 8 && /^[a-z]+$/.test(nx.t)) continue
    return { start: i, end: i + lw.length - 1 }
  }
  return null
}
/** words to the right of index `end` in the row, stopping at a gap wider than `gap` points */
function valueRun(row, end, gap = 30) {
  const out = []
  let prev = row[end]
  for (let k = end + 1; k < row.length; k++) {
    const w = row[k]
    if (w.x0 - prev.x1 > (out.length ? gap : 160)) break
    out.push(w); prev = w
  }
  return out
}

const HEADER = [['invoice_number', 'Invoice number:'], ['issue_date', 'Issue date:'], ['due_date', 'Due date:'], ['currency', 'Currency:'], ['seller_name', 'Seller:'], ['buyer_name', 'Buyer:']]
const TOTALS = [
  ['line_extension_amount', 'Sum of line net amounts'], ['allowance_total_amount', 'Document allowances'], ['charge_total_amount', 'Document charges'],
  ['tax_exclusive_amount', 'Total without VAT'], ['tax_amount', 'VAT total'], ['tax_inclusive_amount', 'Total with VAT'],
  ['prepaid_amount', 'Paid amount'], ['payable_rounding_amount', 'Rounding amount'], ['payable_amount', 'Amount due for payment'],
]

// ------------------------------------------------------------------------------------------------ parse
export function parseWords({ words, route, pageW }) {
  const rows = toRows(words)
  const dec = detectDecimal(words)
  const out = {}, raw = {}, notes = []
  if (!dec) notes.push('decimal separator undetermined: every amount omitted')
  const rowText = (r) => r.map(w => w.t).join(' ')

  // header fields (label-anchored; value = the run of words to the right)
  for (const [key, label] of HEADER) {
    for (const r of rows) {
      const m = findLabel(r, label.replace(':', '')) ?? findLabel(r, label)
      if (!m) continue
      // the label may have been read with or without its colon; skip a separate ':' word
      let end = m.end
      if (!r[end].t.endsWith(':') && r[end + 1] && r[end + 1].t === ':') end++
      if (!r[end].t.endsWith(':') && !(r[end + 1] && r[end + 1].t === ':')) { /* label read without colon: accept */ }
      const run = valueRun(r, end)
      if (!run.length) break
      const v = run.map(w => w.t).join(' ')
      if (key === 'issue_date' || key === 'due_date') { if (isDate(v)) { out[key] = v; raw[key] = v } else notes.push(`${key}: "${v}" is not YYYY-MM-DD, omitted`) }
      else if (key === 'currency') { if (/^[A-Z]{3}$/.test(v)) { out[key] = v; raw[key] = v } else notes.push(`currency: "${v}" omitted`) }
      else { out[key] = v; raw[key] = v }
      break
    }
  }

  // totals (label-anchored; currency + amount to the right on the same row)
  const curSeen = []
  for (const [key, label] of TOTALS) {
    for (const r of rows) {
      const m = findLabel(r, label)
      if (!m) continue
      const right = r.slice(m.end + 1).filter(w => w.x0 > r[m.end].x1)
      const ccy = right.find(w => /^[A-Z]{3}$/.test(w.t))
      if (ccy) curSeen.push([key, ccy.t])
      const cand = right.filter(w => /\d/.test(w.t))
      const last = cand[cand.length - 1]
      if (!last) { notes.push(`${key}: label found, no value`); break }
      const v = parseAmount(last.t, dec)
      if (v === null) notes.push(`${key}: "${last.t}" does not parse strictly, omitted`)
      else { out[key] = v; raw[key] = last.t }
      break
    }
  }
  const pay = curSeen.find(([k]) => k === 'payable_amount')
  if (pay) out.amount_currency = pay[1]
  else if (curSeen.length) out.amount_currency = curSeen[curSeen.length - 1][1]
  if (curSeen.some(([, c]) => c !== out.amount_currency)) notes.push(`totals carry mixed currency codes: ${[...new Set(curSeen.map(([, c]) => c))].join(',')}`)

  // line items: the standard table (header row) or the two-column blocks ("Line X:")
  const lines = []
  const hdrIdx = rows.findIndex(r => findLabel(r, 'Qty') && findLabel(r, 'Price') && findLabel(r, 'Net') && findLabel(r, 'Item'))
  if (hdrIdx >= 0) {
    const h = rows[hdrIdx]
    const col = (name) => { const m = findLabel(h, name); return m ? h[m.end] : null }
    const C = { id: col('#'), item: col('Item'), qty: col('Qty'), unit: col('Unit'), price: col('Price'), per: col('Per'), allow: col('Allow.'), charge: col('Charge'), net: col('Net'), vat: col('VAT') }
    const numCols = ['qty', 'price', 'per', 'allow', 'charge', 'net'].filter(k => C[k])
    for (let i = hdrIdx + 1; i < rows.length; i++) {
      const r = rows[i]
      const t = rowText(r)
      if (/^(Document allowances|VAT breakdown|Line items)/i.test(t) || findLabel(r, 'VAT breakdown') || findLabel(r, 'Document allowances and charges')) break
      if (r[0].yTop - rows[i - 1][rows[i - 1].length - 1].yBot > 14 && i > hdrIdx + 1) break
      const cell = { qty: [], price: [], per: [], allow: [], charge: [], net: [], id: [], item: [], unit: [], vat: [] }
      for (const w of r) {
        const nc = numCols.find(k => Math.abs(w.x1 - C[k].x1) <= 6)
        if (nc) { cell[nc].push(w); continue }
        if (C.vat && w.x0 >= C.vat.x0 - 6) { cell.vat.push(w); continue }
        if (C.unit && w.x0 >= C.unit.x0 - 6 && w.x1 < C.price.x1 - 30) { cell.unit.push(w); continue }
        if (C.item && w.x0 >= C.item.x0 - 6 && w.x1 < C.qty.x1 - 30) { cell.item.push(w); continue }
        if (C.id && w.x0 >= C.id.x0 - 6 && w.x1 < (C.item ? C.item.x0 : C.id.x1 + 15)) { cell.id.push(w); continue }
      }
      if (!cell.id.length && !cell.net.length) continue
      const one = (k) => (cell[k].length === 1 ? cell[k][0].t : null)
      const L = { id: cell.id.map(w => w.t).join(' ') || null, item_name: cell.item.map(w => w.t).join(' ') }
      const q = one('qty') !== null ? parseQty(one('qty'), dec) : null
      const p = one('price') !== null ? parsePrice(one('price'), dec) : null
      const n = one('net') !== null ? parseAmount(one('net'), dec) : null
      if (q !== null) L.invoiced_quantity = q; else notes.push(`line ${L.id}: qty "${cell.qty.map(w => w.t).join(' ')}" omitted`)
      if (p !== null) L.price_amount = p; else notes.push(`line ${L.id}: price "${cell.price.map(w => w.t).join(' ')}" omitted`)
      if (n !== null) L.line_extension_amount = n; else notes.push(`line ${L.id}: net "${cell.net.map(w => w.t).join(' ')}" omitted`)
      const opt = (k, key, parser) => {
        const v = one(k)
        if (v === null) { if (cell[k].length) notes.push(`line ${L.id}: ${k} "${cell[k].map(w => w.t).join(' ')}" omitted`); return }
        if (v === '-') return
        const x = parser(v, dec)
        if (x !== null) L[key] = x; else { notes.push(`line ${L.id}: ${k} "${v}" omitted (line math will abstain)`); L.__unreadable = (L.__unreadable ?? []).concat(k) }
      }
      opt('per', 'base_quantity', parseQty); opt('allow', 'line_allowance_amount', parseAmount); opt('charge', 'line_charge_amount', parseAmount)
      lines.push(L)
    }
  } else {
    const vt = rows.map(r => { const m = findLabel(r, 'VAT breakdown'); return m ? r[m.start].x0 : null }).find(x => x !== null && x > 100)
    const rightColX = vt ?? null
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const li = r.findIndex(w => /^Line$/i.test(w.t))
      if (li !== 0 || !r[1] || !r[1].t.endsWith(':')) continue
      const L = { id: r[1].t.slice(0, -1), item_name: valueRun(r, 1, 6).map(w => w.t).join(' ') }
      // the left column = words left of the right column's start (the "VAT breakdown" title's x, else the page middle)
      const split = rightColX ?? pageW / 2
      const leftOf = (row) => row.filter(w => w.x1 < split - 4).map(w => w.t).join(' ')
      // the block's next two rows that carry left-column words (right-column rows interleave when baselines drift)
      const next = []
      for (let j = i + 1; j < rows.length && next.length < 2 && j <= i + 8; j++) { const s = leftOf(rows[j]); if (s) next.push(s) }
      const r2 = next[0] ?? '', r3 = next[1] ?? ''
      const m2 = r2.match(/^Qty:\s*(\S+)\s+(\S+)\s+Price:\s*(\S+)\s+Per:\s*(\S+)/)
      const m3 = r3.match(/^Allow\.?:\s*(\S+)\s+Charge:\s*(\S+)\s+Net:\s*(\S+)/)
      if (m2) {
        const q = parseQty(m2[1], dec), p = parsePrice(m2[3], dec)
        if (q !== null) L.invoiced_quantity = q; else notes.push(`line ${L.id}: qty "${m2[1]}" omitted`)
        if (p !== null) L.price_amount = p; else notes.push(`line ${L.id}: price "${m2[3]}" omitted`)
        if (m2[4] !== '-') { const b = parseQty(m2[4], dec); if (b !== null) L.base_quantity = b; else { notes.push(`line ${L.id}: per "${m2[4]}" omitted`); L.__unreadable = ['per'] } }
      } else notes.push(`line ${L.id}: qty/price row unreadable: "${r2}"`)
      if (m3) {
        const n = parseAmount(m3[3], dec)
        if (n !== null) L.line_extension_amount = n; else notes.push(`line ${L.id}: net "${m3[3]}" omitted`)
        for (const [v, key] of [[m3[1], 'line_allowance_amount'], [m3[2], 'line_charge_amount']]) {
          if (v === '-') continue
          const x = parseAmount(v, dec)
          if (x !== null) L[key] = x; else { notes.push(`line ${L.id}: ${key} "${v}" omitted`); L.__unreadable = (L.__unreadable ?? []).concat(key) }
        }
      } else notes.push(`line ${L.id}: net row unreadable: "${r3}"`)
      lines.push(L)
    }
  }
  // An unreadable optional line term (base qty / allowance / charge) must not silently default: the line's own math
  // would then be checked against a guess. Drop the line's price so LINE_MATH abstains (FIELD_MISSING) for that line.
  for (const L of lines) if (L.__unreadable) { delete L.price_amount; delete L.__unreadable }
  out.lines = lines

  // VAT breakdown
  const vbd = []
  const vh = rows.findIndex(r => findLabel(r, 'Taxable amount') && findLabel(r, 'VAT amount'))
  if (vh >= 0) {
    const h = rows[vh]
    const cRate = h[findLabel(h, 'Rate').end], cTax = h[findLabel(h, 'Taxable amount').end], cVat = h[findLabel(h, 'VAT amount').end]
    for (let i = vh + 1; i < rows.length; i++) {
      const r = rows[i]
      if (r[0].x0 > 200) break
      if (r[0].yTop - rows[i - 1][0].yBot > 14) break
      const at = (c) => r.filter(w => Math.abs(w.x1 - c.x1) <= 6)
      const cat = r[0].x0 < cRate.x0 - 40 ? r[0].t : null
      const rt = at(cRate), tx = at(cTax), vt = at(cVat)
      const e = {}; if (cat !== null && /^[A-Z]{1,2}$/.test(cat)) e.category = cat; else if (cat !== null) notes.push(`vat category "${cat}" is not a code, omitted`)
      if (rt.length === 1) { const v = parseRate(rt[0].t, dec); if (v !== null) e.rate = v }
      if (tx.length === 1) { const v = parseAmount(tx[0].t, dec); if (v !== null) e.taxable_amount = v }
      if (vt.length === 1) { const v = parseAmount(vt[0].t, dec); if (v !== null) e.tax_amount = v }
      if (!cat && rt.length === 0 && tx.length === 0) break
      vbd.push(e)
    }
  } else {
    const ti = rows.findIndex(r => findLabel(r, 'VAT breakdown'))
    if (ti >= 0) {
      const x0 = rows[ti][findLabel(rows[ti], 'VAT breakdown').start].x0
      for (let i = ti + 1; i < rows.length; i++) {
        const seg = rows[i].filter(w => w.x0 >= x0 - 6).map(w => w.t).join(' ')
        const m = seg.match(/^(\S+)\s+(\S+%)\s+Taxable:\s*(\S+)\s+VAT:\s*(\S+)/)
        if (!m) { if (/Sum of line|^$/.test(seg) || i > ti + 12) break; continue }
        const e = {}; if (/^[A-Z]{1,2}$/.test(m[1])) e.category = m[1]; else notes.push(`vat category "${m[1]}" is not a code, omitted`)
        const rt = parseRate(m[2], dec), tx = parseAmount(m[3], dec), vt = parseAmount(m[4], dec)
        if (rt !== null) e.rate = rt; if (tx !== null) e.taxable_amount = tx; if (vt !== null) e.tax_amount = vt
        vbd.push(e)
      }
    }
  }
  vbd.forEach((e, i) => { e.row = i + 1 })
  out.vat_breakdown = vbd
  const text = rows.map(rowText).join('\n')
  return { extraction: out, raw, notes, text, route, decimal: dec }
}

export async function extractPdf(bytes, { workDir }) {
  const tl = await textLayerWords(bytes)
  const useOcr = tl.words.length < 20
  const w = useOcr ? await ocrRead(bytes, workDir) : tl
  const r = parseWords(w)
  return { ...r, rotate: w.rotate ?? 0, osd: w.osd ?? null, words: w.words.length }
}
