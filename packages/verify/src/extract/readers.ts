/**
 * The extraction contract's two kinds of reader (2026-10-03): the PDF text layer, and OCR.
 *
 *   text layer  pdfjs-dist (an optional dependency: `npm i pdfjs-dist`), words split from its text items.
 *   OCR         poppler's `pdftoppm` renders a page to a PNM image; Tesseract reads it (`tsv`, word boxes and its own line
 *               grouping). Both are external programs: found by option, else the environment (VERIFY_PDFTOPPM,
 *               VERIFY_TESSERACT), else on PATH. Every child is spawned with `windowsHide`, one at a time, with
 *               RIPOSTE_LEDGER and RIPOSTE_HOOK_MODE removed from its environment; its temporary files are removed.
 *
 * Coordinates are PDF points with y measured from the top of the page, whatever the reader, so layout rules (gaps,
 * columns) read the same on both. Page preprocessing for OCR is declared per setting (OcrSetting), never per document:
 *   - `dropout`: on a page carrying saturated colour ink (a stamp), read the lightest channel, so coloured ink fades and black
 *     print stays; `threshold` then binarizes it;
 *   - orientation: on a scan, Tesseract's orientation detection (`--psm 0`) turns the page upright before reading.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** One word a reader read, with its box (points, y from the top) and its row key (OCR: Tesseract's line). */
export interface Word {
  t: string
  x0: number
  x1: number
  yTop: number
  yBot: number
  /** OCR: "block.paragraph.line"; text layer: null (rows are clustered by baseline) */
  line: string | null
  conf?: number
  /** text layer: the item's font size in points */
  size?: number
}
/** One page as one reader read it. */
export interface PageRead {
  page: number
  reader: string
  words: Word[]
  width: number
  height: number
  /** OCR: the rotation applied (0, 90, 180, 270) */
  rotate?: number
}
/** A row: the page's words that share a line, left to right, with its 1-based line number on the page. */
export interface Row {
  page: number
  line: number
  words: Word[]
}

export interface Tools {
  /** the tesseract executable (else VERIFY_TESSERACT, else "tesseract" on PATH) */
  tesseract?: string
  /** poppler's pdftoppm (else VERIFY_PDFTOPPM, else "pdftoppm" on PATH) */
  pdftoppm?: string
  /** where temporary files go (default: the OS temp directory) */
  workDir?: string
}
export interface OcrSetting {
  /** the reader's name as provenance records it */
  name: string
  dpi: number
  psm: number
  /** read the lightest channel on a page carrying saturated colour ink (a stamp) */
  dropout?: boolean
  /** binarize at this grey level (0–255) after dropout, on dropout pages only */
  threshold?: number
}

const STRIP_ENV = ['RIPOSTE_LEDGER', 'RIPOSTE_HOOK_MODE']
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, OMP_THREAD_LIMIT: '1' }
  for (const k of STRIP_ENV) delete env[k]
  return env
}
const tool = (given: string | undefined, envName: string, dflt: string): string => given ?? process.env[envName] ?? dflt
function run(exe: string, args: string[], maxBuffer = 64 << 20): Buffer {
  return execFileSync(exe, args, { windowsHide: true, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'], maxBuffer })
}

// ── the text layer ────────────────────────────────────────────────────────────────────────────────────────────────────

type PdfJs = { getDocument: (o: unknown) => { promise: Promise<PdfDoc> }; GlobalWorkerOptions: { workerSrc: string } }
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> }
type PdfPage = { getViewport: (o: { scale: number }) => { width: number; height: number }; getTextContent: () => Promise<{ items: { str?: string; transform: number[]; width: number; height: number }[] }> }

let pdfjsP: Promise<PdfJs> | undefined
/** pdfjs-dist, loaded on first use. Not a dependency of the checks: only the reference readers need it. */
export async function loadPdfJs(): Promise<PdfJs> {
  pdfjsP ??= (async () => {
    const spec = 'pdfjs-dist/legacy/build/pdf.mjs'
    let mod: PdfJs
    try { mod = await import(spec) as PdfJs } catch (e) {
      throw new Error(`the PDF text-layer reader needs pdfjs-dist (npm i pdfjs-dist): ${(e as Error).message}`)
    }
    const require = createRequire(import.meta.url)
    mod.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href
    return mod
  })()
  return pdfjsP
}

/** The pdfjs-dist version in use (for provenance), or undefined when it cannot be found. */
export function pdfJsVersion(): string | undefined {
  try { return (createRequire(import.meta.url)('pdfjs-dist/package.json') as { version?: string }).version } catch { return undefined }
}

/** Every page's text layer: words with boxes. A page with no text layer comes back with no words. */
export async function readTextLayer(bytes: Uint8Array, reader = 'pdf-text-layer'): Promise<PageRead[]> {
  const pdfjs = await loadPdfJs()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise
  const pages: PageRead[] = []
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const vp = page.getViewport({ scale: 1 })
      const tc = await page.getTextContent()
      const words: Word[] = []
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue
        const [a, b, , , e, f] = it.transform as [number, number, number, number, number, number]
        const size = Math.hypot(a, b) || it.height
        const yTop = vp.height - f - size, yBot = vp.height - f
        const s = it.str, n = s.length
        const re = /\S+/g
        let m: RegExpExecArray | null
        while ((m = re.exec(s))) {
          const x0 = e + it.width * (m.index / n)
          const end = m.index + m[0].length
          const x1 = end === s.trimEnd().length ? e + it.width * (s.trimEnd().length / n) : e + it.width * (end / n)
          words.push({ t: m[0], x0, x1, yTop, yBot, line: null, size })
        }
      }
      pages.push({ page: p, reader, words, width: vp.width, height: vp.height })
    }
  } finally { await doc.destroy() }
  return pages
}

// ── PNM images ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** A greyscale or RGB raster: P5 (channels 1) or P6 (channels 3), 8-bit. */
export interface Pnm { width: number; height: number; channels: 1 | 3; data: Uint8Array }

export function readPnm(buf: Uint8Array): Pnm {
  let pos = 0
  const token = (): string => {
    for (;;) {
      while (pos < buf.length && /\s/.test(String.fromCharCode(buf[pos] as number))) pos++
      if (buf[pos] === 0x23) { while (pos < buf.length && buf[pos] !== 0x0a) pos++; continue }
      break
    }
    let s = ''
    while (pos < buf.length && !/\s/.test(String.fromCharCode(buf[pos] as number))) s += String.fromCharCode(buf[pos++] as number)
    return s
  }
  const magic = token()
  if (magic !== 'P5' && magic !== 'P6') throw new Error(`not a binary PGM/PPM image (${magic})`)
  const width = Number(token()), height = Number(token()), max = Number(token())
  if (max !== 255) throw new Error(`only 8-bit PNM images are read (maxval ${max})`)
  pos++ // the single whitespace after maxval
  const channels = magic === 'P5' ? 1 : 3
  return { width, height, channels, data: buf.subarray(pos, pos + width * height * channels) }
}

export function writePgm(img: Pnm): Uint8Array {
  if (img.channels !== 1) throw new Error('writePgm takes a greyscale image')
  const head = new TextEncoder().encode(`P5\n${img.width} ${img.height}\n255\n`)
  const out = new Uint8Array(head.length + img.data.length)
  out.set(head, 0); out.set(img.data, head.length)
  return out
}

/** The share of pixels carrying saturated colour (max − min channel > 80 and not near-white): a stamp, a coloured mark. */
export function saturatedShare(img: Pnm): number {
  if (img.channels !== 3) return 0
  const d = img.data
  let n = 0
  for (let i = 0; i < d.length; i += 3) {
    const r = d[i] as number, g = d[i + 1] as number, b = d[i + 2] as number
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    if (mx - mn > 80) n++
  }
  return n / (d.length / 3)
}

/** Greyscale: luminance, or (dropout) the lightest channel, so coloured ink fades and black print stays black. */
export function toGrey(img: Pnm, dropout: boolean, threshold?: number): Pnm {
  if (img.channels === 1) return img
  const d = img.data
  const out = new Uint8Array(img.width * img.height)
  for (let i = 0, j = 0; i < d.length; i += 3, j++) {
    const r = d[i] as number, g = d[i + 1] as number, b = d[i + 2] as number
    let v = dropout ? Math.max(r, g, b) : Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    if (dropout && threshold !== undefined) v = v < threshold ? 0 : 255
    out[j] = v
  }
  return { width: img.width, height: img.height, channels: 1, data: out }
}

/** Turn a greyscale image clockwise by 90, 180 or 270 degrees (Tesseract's "Rotate:" value). */
export function rotateGrey(img: Pnm, deg: number): Pnm {
  const r = ((deg % 360) + 360) % 360
  if (r === 0) return img
  const { width: w, height: h, data: d } = img
  if (r === 180) {
    const out = new Uint8Array(d.length)
    for (let i = 0; i < d.length; i++) out[i] = d[d.length - 1 - i] as number
    return { width: w, height: h, channels: 1, data: out }
  }
  const out = new Uint8Array(d.length)
  const W = h, H = w
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = d[y * w + x] as number
    // clockwise 90: (x, y) → (h - 1 - y, x); counter-clockwise (270): (x, y) → (y, w - 1 - x)
    const nx = r === 90 ? h - 1 - y : y
    const ny = r === 90 ? x : w - 1 - x
    out[ny * W + nx] = v
  }
  return { width: W, height: H, channels: 1, data: out }
}

// ── OCR ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Render one page of a PDF to a PNM image (colour when `colour`, else greyscale). */
export function renderPage(pdfPath: string, page: number, dpi: number, colour: boolean, tools: Tools, dir: string): Pnm {
  const out = join(dir, `r${page}-${dpi}${colour ? 'c' : 'g'}`)
  run(tool(tools.pdftoppm, 'VERIFY_PDFTOPPM', 'pdftoppm'), ['-r', String(dpi), '-f', String(page), '-l', String(page), '-singlefile', ...(colour ? [] : ['-gray']), pdfPath, out])
  return readPnm(new Uint8Array(readFileSync(`${out}.${colour ? 'ppm' : 'pgm'}`)))
}

/** Tesseract's orientation answer for a greyscale image: the clockwise rotation that turns it upright (0 when unsure). */
export function detectRotation(img: Pnm, tools: Tools, dir: string): { rotate: number; osd: string } {
  const p = join(dir, 'osd.pgm')
  writeFileSync(p, writePgm(img))
  try {
    const osd = run(tool(tools.tesseract, 'VERIFY_TESSERACT', 'tesseract'), [p, 'stdout', '--psm', '0']).toString()
    const m = /Rotate:\s*(\d+)/.exec(osd)
    return { rotate: m ? Number(m[1]) : 0, osd: osd.split(/\r?\n/).filter(l => /Rotate|Orientation conf|Script:/.test(l)).join('; ') }
  } catch (e) {
    return { rotate: 0, osd: `orientation detection failed: ${String((e as { stderr?: unknown }).stderr ?? (e as Error).message).slice(0, 160)}` }
  }
}

/** Tesseract's words for a greyscale image (tsv), in points (y from the top). */
export function ocrImage(img: Pnm, setting: OcrSetting, tools: Tools, dir: string): Word[] {
  const p = join(dir, `ocr-${setting.name.replace(/[^\w-]/g, '_')}.pgm`)
  writeFileSync(p, writePgm(img))
  const tsv = run(tool(tools.tesseract, 'VERIFY_TESSERACT', 'tesseract'), [p, 'stdout', '--psm', String(setting.psm), '-c', 'preserve_interword_spaces=1', 'tsv']).toString()
  const k = 72 / setting.dpi
  const words: Word[] = []
  for (const row of tsv.split(/\r?\n/).slice(1)) {
    const c = row.split('\t')
    if (c.length < 12 || c[0] !== '5') continue
    const t = (c[11] ?? '').trim()
    if (!t) continue
    const left = Number(c[6]), top = Number(c[7]), w = Number(c[8]), h = Number(c[9])
    words.push({ t, x0: left * k, x1: (left + w) * k, yTop: top * k, yBot: (top + h) * k, line: `${c[2]}.${c[3]}.${c[4]}`, conf: Number(c[10]) })
  }
  return words
}

export interface OcrPageOptions {
  /** detect the orientation and turn the page upright first (scans) */
  orient?: boolean
  /** a rotation already decided for this page (both OCR settings of one scan turn it the same way) */
  rotate?: number
}

/**
 * OCR one page of a PDF file under one setting. Renders it (in colour when the setting may drop colour out), prepares the
 * greyscale image the setting says, turns it upright, and reads it.
 */
export function ocrPage(pdfPath: string, page: number, setting: OcrSetting, tools: Tools, opts: OcrPageOptions = {}): PageRead & { osd?: string; dropout: boolean } {
  const dir = mkdtempSync(join(tools.workDir ?? tmpdir(), 'vx-'))
  try {
    const raw = renderPage(pdfPath, page, setting.dpi, !!setting.dropout, tools, dir)
    const stamped = !!setting.dropout && saturatedShare(raw) > 0.002
    let grey = toGrey(raw, stamped, stamped ? setting.threshold : undefined)
    let rotate = opts.rotate ?? 0, osd: string | undefined
    if (opts.rotate === undefined && opts.orient) { const o = detectRotation(grey, tools, dir); rotate = o.rotate; osd = o.osd }
    grey = rotateGrey(grey, rotate)
    const words = ocrImage(grey, setting, tools, dir)
    const k = 72 / setting.dpi
    return { page, reader: setting.name, words, width: grey.width * k, height: grey.height * k, rotate, ...(osd !== undefined ? { osd } : {}), dropout: stamped }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

/** The number of pages of a PDF (pdfjs). */
export async function pageCount(bytes: Uint8Array): Promise<number> {
  const pdfjs = await loadPdfJs()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise
  try { return doc.numPages } finally { await doc.destroy() }
}

// ── rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] as number }

/** A page's rows: OCR words grouped by Tesseract's own line; text-layer words clustered by baseline (2.5 pt). Top to bottom. */
export function toRows(pr: PageRead): Row[] {
  const groups: Word[][] = []
  if (pr.words.length && pr.words[0]!.line !== null) {
    const by = new Map<string, Word[]>()
    for (const w of pr.words) { const k = w.line as string; if (!by.has(k)) by.set(k, []); by.get(k)!.push(w) }
    groups.push(...by.values())
  } else {
    const rows: { yBot: number; ws: Word[] }[] = []
    for (const w of [...pr.words].sort((a, b) => a.yBot - b.yBot || a.x0 - b.x0)) {
      const r = rows.find(r => Math.abs(r.yBot - w.yBot) < 2.5)
      if (r) r.ws.push(w); else rows.push({ yBot: w.yBot, ws: [w] })
    }
    groups.push(...rows.map(r => r.ws))
  }
  return groups.map(ws => ws.sort((a, b) => a.x0 - b.x0))
    .sort((a, b) => median(a.map(w => w.yBot)) - median(b.map(w => w.yBot)))
    .map((words, i) => ({ page: pr.page, line: i + 1, words }))
}

/** A row's text: its words joined by single spaces. */
export const rowText = (r: Row): string => r.words.map(w => w.t).join(' ')
