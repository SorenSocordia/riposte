// blind-shipping-1, legal arm (PREREG.md section 4.3): obtain the briefs and the opinions, after the stamp; then the
// mechanical steps of the transcription protocol (LEGAL-TRANSCRIPTION-PROTOCOL.md). NOT RUN before the harness block is
// stamped. Every download records its URL, the time and the sha256 of the bytes.
//
//   node harness/legal-fetch.mjs --head-check
//        HEAD requests only, no content read: the calendars index, every October Term 2024 calendar PDF, one docket page, the
//        Caselaw Access Project's U.S. Reports root and one volume's metadata. Prints each status; exits 1 on any required
//        address that does not answer 200 at the address asked (a redirect elsewhere counts as a failure). Run it before the
//        stamp and again before the first fetch.
//   node harness/legal-fetch.mjs calendars
//        the calendars index page (https://www.supremecourt.gov/oral_arguments/calendarsandlists.aspx, recorded) and the
//        October Term 2024 monthly argument calendars, argument_calendars/MonthlyArgumentCal<Month><Year>.pdf, in session order:
//        October 2024 to April 2025 are required; a special sitting's calendar for May or June 2025 is taken when the Court
//        published one and recorded as absent otherwise. The docket numbers in the order the calendars print them
//        -> results/legal/calendar.json
//   node harness/legal-fetch.mjs briefs --cases <n>
//        the next <n> cases of the calendar order: for each docket, its page (docket/docketfiles/html/public/<docket>.html),
//        and its merits briefs (petitioner's side first, then the respondent's, each in docket order) as the PDFs the page
//        links, with a text layer made by pdftotext -layout -> results/legal/briefs/<brief id>.pdf|.txt, one line each in
//        results/legal/briefs.jsonl
//   node harness/legal-fetch.mjs opinions
//        for every "<volume> U.S. <page>" the candidate files cite: the Caselaw Access Project's case file, found by that
//        official citation in the volume's metadata on static.case.law -> results/legal/opinions/<cite>.txt, sources.json
//        and opinions.jsonl (served or not, and why)
//   node harness/legal-fetch.mjs select
//        per brief, the first 25 candidates in page order whose cited opinion the Project serves with a majority opinion
//        -> results/legal/citations/<brief id>.json (the citations file the engine reads), one line per brief in eligibility.jsonl
//   node harness/legal-fetch.mjs draw --what genuine
//        section 6's order of the genuine quotations (seed of arm "legal"), for the planted set -> results/legal/draw.json
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { args, drawOrder, readJson, RUN_DIR, seedFor, sha256, writeNew } from './lib.mjs'

const UA = { 'User-Agent': 'blind-shipping-1-harness (research; one request at a time)' }
const SCOTUS = 'https://www.supremecourt.gov'
export const CALENDARS_INDEX = `${SCOTUS}/oral_arguments/calendarsandlists.aspx`
/** The October Term 2024 sittings, in session order: each required; then the special sittings, each taken when published. */
export const SESSIONS = [['October', 2024], ['November', 2024], ['December', 2024], ['January', 2025], ['February', 2025], ['March', 2025], ['April', 2025]]
export const SPECIAL_SESSIONS = [['May', 2025], ['June', 2025]]
export const calendarUrl = (month, year) => `${SCOTUS}/oral_arguments/argument_calendars/MonthlyArgumentCal${month}${year}.pdf`
export const docketUrl = (docket) => `${SCOTUS}/docket/docketfiles/html/public/${encodeURIComponent(docket.replace(/\s+/g, ''))}.html`
export const CAP_US = 'https://static.case.law/us/'
/** The addresses --head-check asks (HEAD only); `required: false` is reported, never refused. 24-394 and volume 347 are probes. */
export const headAddresses = () => [
  { url: CALENDARS_INDEX, required: true },
  ...SESSIONS.map(([m, y]) => ({ url: calendarUrl(m, y), required: true })),
  ...SPECIAL_SESSIONS.map(([m, y]) => ({ url: calendarUrl(m, y), required: false })),
  { url: docketUrl('24-394'), required: true },
  { url: CAP_US, required: true },
  { url: `${CAP_US}347/CasesMetadata.json`, required: true },
]
export const DOCKET = /\b(\d{2}-\d{1,5}|\d{2,3}[ ,]*Orig\.?|\d{2}O\d{1,4})\b/g
export const PER_BRIEF = 25

async function get(url) {
  const r = await fetch(url, { headers: UA, redirect: 'follow' })
  const bytes = Buffer.from(await r.arrayBuffer())
  return { url, final_url: r.url, status: r.status, at: new Date().toISOString(), bytes, sha256: sha256(bytes) }
}
const rec = ({ bytes, ...r }) => ({ ...r, length: bytes.length })
const pdfText = (pdf, txt) => execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdf, txt], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

/** Docket numbers in the order a calendar's text prints them, each once. */
export function docketsIn(text) {
  const seen = new Set(), out = []
  for (const m of text.matchAll(DOCKET)) { const d = m[1].replace(/\s+/g, ' '); if (!seen.has(d)) { seen.add(d); out.push(d) } }
  return out
}

/**
 * The merits briefs among a docket page's entries (docketEntriesFromHtml): an entry whose text begins "Brief of
 * (the) petitioner(s)/respondent(s)/appellant(s)/appellee(s)" and does not say "in opposition", "amicus"/"amici", "reply",
 * "supplemental", "letter" or "motion"; its "Main Document" link. Petitioner's (appellant's) side first, then the
 * respondent's (appellee's), each in docket order.
 */
export function meritsBriefs(entries) {
  const out = { P: [], R: [] }
  for (const e of entries) {
    const t = String(e.Text ?? '').trim()
    const m = t.match(/^Brief of (?:the )?(petitioners?|respondents?|appellants?|appellees?)\b/i)
    if (!m || /in opposition|amicus|amici|reply|supplemental|letter|motion/i.test(t)) continue
    const link = (e.Links ?? []).find(l => /^main document$/i.test(String(l.Description ?? '').trim()))
    if (!link?.DocumentUrl) continue
    out[/^(petitioner|appellant)/i.test(m[1]) ? 'P' : 'R'].push({ text: t, date: e.Date ?? null, url: link.DocumentUrl })
  }
  return [...out.P.map((b, i) => ({ side: 'P', n: i + 1, ...b })), ...out.R.map((b, i) => ({ side: 'R', n: i + 1, ...b }))]
}

/**
 * The entries of a docket's HTML page (docket/docketfiles/html/public/<docket>.html): a table row whose first cell is a
 * date ("Jan 21 2025") starts an entry, its next cell is the entry's text, and the links of the rows after it, up to the next
 * dated row, are its links (their link text is the description).
 */
export function docketEntriesFromHtml(html, base = docketUrl('0-0')) {
  const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
  const out = []
  for (const row of html.split(/<tr[\s>]/i).slice(1)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1])
    // a relative link (/DocketPDF/…) is resolved against the docket page's own address
    const links = [...row.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map(m => ({ Description: strip(m[2]), DocumentUrl: new URL(m[1].replace(/&amp;/g, '&'), base).href }))
    const date = cells.length ? strip(cells[0]) : ''
    if (/^[A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}$/.test(date)) out.push({ Date: date, Text: strip(cells[1] ?? ''), Links: links })
    else if (out.length) out[out.length - 1].Links.push(...links)
  }
  return out
}

/** "<volume> U.S. <page>" as the cite key, spacing and periods normalized; null when the text is not one. */
export function usCite(s) {
  const m = String(s).match(/^\s*(\d{1,3})\s*U\.?\s*S\.?\s*(\d{1,4})\s*$/)
  return m ? `${Number(m[1])} U.S. ${Number(m[2])}` : null
}

/** The opinion text the engine reads, from a Caselaw Access Project case file: a caption line, the head matter, then every opinion as served. */
export function opinionText(cap, cite) {
  const ops = cap?.casebody?.opinions
  if (!Array.isArray(ops)) throw new Error('the case file has no casebody.opinions')
  const year = String(cap.decision_date ?? '').slice(0, 4)
  const caption = `${cap.name_abbreviation ?? cap.name}, ${cite}${year ? ` (${year})` : ''}`
  const parts = [caption, '', String(cap.casebody.head_matter ?? '').trim(), ...ops.map(o => String(o.text ?? '').trim())].filter((p, i) => i < 2 || p)
  return parts.join('\n\n').replace(/\r\n?/g, '\n') + '\n'
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2)
  const a = args(rest)
  const L = resolve(a.results ?? join(RUN_DIR, 'results', 'legal'))

  if (cmd === '--head-check' || cmd === 'head-check') {
    // HEAD only: no content is read. A required address passes only with 200 at the address asked.
    const rows = []
    for (const h of headAddresses()) {
      let status = null, final = null, error = null
      try { const r = await fetch(h.url, { method: 'HEAD', headers: UA, redirect: 'follow' }); status = r.status; final = r.url } catch (e) { error = e.message }
      const ok = status === 200 && final === h.url
      rows.push({ ...h, status, final_url: final, ok, error })
      console.log(`${ok ? 'OK  ' : h.required ? 'FAIL' : 'NOTE'} ${String(status ?? 'none').padEnd(4)} ${h.required ? 'required' : 'optional'}  ${h.url}${final && final !== h.url ? `  -> redirected to ${final}` : ''}${error ? `  (${error})` : ''}`)
    }
    const bad = rows.filter(r => r.required && !r.ok)
    console.log(bad.length ? `HEAD check: ${bad.length} required address(es) failed; nothing may be fetched until they answer` : `HEAD check: every required address answers 200 (${new Date().toISOString()})`)
    process.exit(bad.length ? 1 : 0)
  }
  mkdirSync(L, { recursive: true })

  if (cmd === 'calendars') {
    const page = await get(CALENDARS_INDEX)
    if (page.status !== 200) throw new Error(`${CALENDARS_INDEX}: HTTP ${page.status}; nothing is fetched`)
    const html = page.bytes.toString('utf8')
    const calendars = [], absent = [], dockets = []
    for (const [[month, year], required] of [...SESSIONS.map(s => [s, true]), ...SPECIAL_SESSIONS.map(s => [s, false])]) {
      const url = calendarUrl(month, year)
      const r = await get(url)
      if (r.status !== 200) {
        if (required) throw new Error(`${url}: HTTP ${r.status}; the ${month} ${year} sitting's calendar is required; nothing is chosen by hand`)
        absent.push({ session: `${month} ${year}`, url, status: r.status }); continue
      }
      const n = calendars.length + 1
      mkdirSync(join(L, 'calendars'), { recursive: true })
      const f = join(L, 'calendars', `${n}.pdf`)
      writeFileSync(f, r.bytes)
      pdfText(f, f.replace(/\.pdf$/, '.txt'))
      const found = docketsIn(readFileSync(f.replace(/\.pdf$/, '.txt'), 'utf8'))
      calendars.push({ session: `${month} ${year}`, linked_on_index: html.includes(`MonthlyArgumentCal${month}${year}.pdf`), ...rec(r), file: `calendars/${n}.pdf`, dockets: found })
      for (const d of found) if (!dockets.includes(d)) dockets.push(d)
    }
    const h = writeNew(join(L, 'calendar.json'), { format: 'blind-shipping-1/legal-calendar/2', index: rec(page), calendars, special_sessions_absent: absent, dockets })
    console.error(`${dockets.length} dockets from ${calendars.length} calendars; calendar.json sha256 ${h}`)
  } else if (cmd === 'briefs') {
    const n = Number(a.cases)
    if (!(n > 0)) { console.error('--cases <n>: how many more cases of the calendar order to fetch'); process.exit(3) }
    const cal = readJson(join(L, 'calendar.json'))
    const log = join(L, 'briefs.jsonl')
    const done = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
    const doneDockets = new Set(done.map(d => d.docket))
    const seenPdf = new Map(done.filter(d => d.pdf_sha256).map(d => [d.pdf_sha256, d.brief_id]))
    const next = cal.dockets.filter(d => !doneDockets.has(d)).slice(0, n)
    mkdirSync(join(L, 'briefs'), { recursive: true })
    for (const d of next) {
      const dj = await get(docketUrl(d))
      const entries = dj.status === 200 ? docketEntriesFromHtml(dj.bytes.toString('utf8'), dj.final_url) : []
      if (!entries.length) { appendFileSync(log, JSON.stringify({ docket: d, docket_page: rec(dj), briefs: 0, note: dj.status === 200 ? 'the docket page gave no dated entries (its layout is not the one this script reads); no brief taken; report it' : `the docket page answered HTTP ${dj.status}; no brief taken` }) + '\n'); continue }
      const briefs = meritsBriefs(entries)
      if (!briefs.length) appendFileSync(log, JSON.stringify({ docket: d, docket_page: rec(dj), entries: entries.length, briefs: 0, note: 'no merits brief of either party on the docket' }) + '\n')
      for (const b of briefs) {
        const id = `${d.replace(/\s+/g, '')}-${b.side}${b.n}`
        const pdf = await get(b.url)
        const line = { docket: d, brief_id: id, side: b.side, docket_text: b.text, docket_date: b.date, docket_page: rec(dj), pdf: rec(pdf), pdf_sha256: pdf.sha256 }
        if (seenPdf.has(pdf.sha256)) { appendFileSync(log, JSON.stringify({ ...line, duplicate_of: seenPdf.get(pdf.sha256), note: 'the same PDF filed on another docket of the same argument; read once' }) + '\n'); continue }
        seenPdf.set(pdf.sha256, id)
        writeFileSync(join(L, 'briefs', `${id}.pdf`), pdf.bytes)
        pdfText(join(L, 'briefs', `${id}.pdf`), join(L, 'briefs', `${id}.txt`))
        appendFileSync(log, JSON.stringify({ ...line, text_sha256: sha256(readFileSync(join(L, 'briefs', `${id}.txt`))) }) + '\n')
        console.error(`${id}  ${b.text.slice(0, 90)}`)
      }
    }
  } else if (cmd === 'opinions') {
    const cands = readdirSync(join(L, 'candidates')).filter(f => f.endsWith('.json')).flatMap(f => readJson(join(L, 'candidates', f)).candidates)
    const cites = [...new Set(cands.map(c => usCite(c.cite)).filter(Boolean))]
    const log = join(L, 'opinions.jsonl')
    const have = new Set(existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).cite) : [])
    const sourcesPath = join(L, 'opinions', 'sources.json')
    const sources = existsSync(sourcesPath) ? readJson(sourcesPath) : {}
    const volumes = new Map()
    mkdirSync(join(L, 'opinions'), { recursive: true })
    for (const cite of cites.filter(c => !have.has(c))) {
      const [vol, , page] = cite.split(' ')
      if (!volumes.has(vol)) volumes.set(vol, await get(`https://static.case.law/us/${vol}/CasesMetadata.json`))
      const meta = volumes.get(vol)
      const base = { cite, metadata: rec(meta) }
      if (meta.status !== 200) { appendFileSync(log, JSON.stringify({ ...base, served: false, why: `the Project serves no volume ${vol} of U.S. Reports (HTTP ${meta.status})` }) + '\n'); continue }
      const cases = JSON.parse(meta.bytes.toString('utf8'))
      const hits = cases.filter(c => (c.citations ?? []).some(x => usCite(x.cite) === cite && /official/i.test(String(x.type ?? 'official'))))
      if (hits.length !== 1) { appendFileSync(log, JSON.stringify({ ...base, served: false, why: hits.length ? `${hits.length} cases carry this citation; none is chosen` : 'no case in the volume carries this official citation' }) + '\n'); continue }
      const file = hits[0].file_name
      const caseFile = await get(`https://static.case.law/us/${vol}/cases/${file}.json`)
      if (caseFile.status !== 200) { appendFileSync(log, JSON.stringify({ ...base, served: false, why: `the case file answered HTTP ${caseFile.status}` }) + '\n'); continue }
      const cap = JSON.parse(caseFile.bytes.toString('utf8'))
      const majority = (cap.casebody?.opinions ?? []).some(o => o.type === 'majority')
      if (!majority) { appendFileSync(log, JSON.stringify({ ...base, case_file: rec(caseFile), served: false, why: `no majority opinion is served (opinion types: ${(cap.casebody?.opinions ?? []).map(o => o.type).join(', ') || 'none'})` }) + '\n'); continue }
      const text = opinionText(cap, cite)
      const name = `${cite.replace(/\s+/g, '-').replace(/\./g, '')}.txt`
      writeFileSync(join(L, 'opinions', name), text)
      // the majority opinion alone, for the labeller's match (the protocol's step 5); kept outside opinions/, which the engine reads
      mkdirSync(join(L, 'majority'), { recursive: true })
      writeFileSync(join(L, 'majority', name), cap.casebody.opinions.filter(o => o.type === 'majority').map(o => String(o.text ?? '').trim()).join('\n\n').replace(/\r\n?/g, '\n') + '\n')
      sources[cite] = { file: name, source: 'Caselaw Access Project (static.case.law)', url: caseFile.url, retrieved_at: caseFile.at, bind: 'strict' }
      appendFileSync(log, JSON.stringify({ ...base, case_file: rec(caseFile), served: true, case_name: cap.name_abbreviation, text_file: name, text_sha256: sha256(Buffer.from(text, 'utf8')) }) + '\n')
      console.error(`${cite}  ${cap.name_abbreviation}`)
    }
    writeFileSync(sourcesPath, JSON.stringify(sources, null, 1) + '\n')
  } else if (cmd === 'select') {
    const served = new Map(readFileSync(join(L, 'opinions.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(o => [o.cite, o.served]))
    // once per brief, when its candidate file is complete (the protocol's step 4); a line per brief in eligibility.jsonl
    mkdirSync(join(L, 'citations'), { recursive: true })
    for (const f of readdirSync(join(L, 'candidates')).filter(f => f.endsWith('.json')).sort()) {
      const c = readJson(join(L, 'candidates', f))
      if (existsSync(join(L, 'citations', `${c.brief_id}.json`))) continue
      if (c.complete !== true) { console.error(`${c.brief_id}: candidates not marked complete; not selected yet`); continue }
      const unknown = c.candidates.filter(q => !served.has(usCite(q.cite)))
      if (unknown.length) throw new Error(`${f}: run "opinions" first; ${unknown.length} cite(s) not looked up`)
      const eligible = c.candidates.filter(q => served.get(usCite(q.cite)) === true)
      const taken = eligible.slice(0, PER_BRIEF)
      const h = writeNew(join(L, 'citations', `${c.brief_id}.json`), taken.map(q => ({ id: q.id, cite: usCite(q.cite), case_name: q.case_name, quote: q.quote, source_key: usCite(q.cite) })))
      appendFileSync(join(L, 'eligibility.jsonl'), JSON.stringify({ brief_id: c.brief_id, candidates: c.candidates.length, not_served: c.candidates.length - eligible.length, eligible: eligible.length, taken: taken.length, citations_sha256: h }) + '\n')
      console.error(`${c.brief_id}: ${taken.length} taken of ${eligible.length} eligible (${c.candidates.length - eligible.length} cite an opinion the Project does not serve)`)
    }
  } else if (cmd === 'draw') {
    if (a.what !== 'genuine') { console.error('draw --what genuine'); process.exit(3) }
    const labels = readdirSync(join(L, 'labels')).filter(f => f.endsWith('.json')).flatMap(f => readJson(join(L, 'labels', f)))
    const genuine = labels.filter(l => l.label === 'genuine').map(l => l.id)
    const seed = await seedFor('legal')
    const h = writeNew(join(L, 'draw.json'), { format: 'blind-shipping-1/legal-draw/1', seed: { arm: 'legal', ...seed }, order: drawOrder(seed.seed, genuine) })
    console.error(`draw.json: ${genuine.length} genuine quotations in section 6's order; sha256 ${h}`)
  } else { console.error('usage: legal-fetch.mjs --head-check | calendars | briefs --cases <n> | opinions | select | draw --what genuine'); process.exit(3) }
}
