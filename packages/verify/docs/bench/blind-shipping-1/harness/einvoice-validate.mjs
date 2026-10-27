// blind-shipping-1, e-invoice arm (PREREG.md section 4.2): the labels are the official validators' output.
// NOT RUN before the harness block is stamped and the sources are fetched.
//
//   node harness/einvoice-validate.mjs --labeller <name> --labeller-model <model id> --attestation <file>
//        [--results results/einvoice] [--work tmp/einvoice-clones] [--python python] [--schxslt <SchXslt 2.0 pipeline .xsl>]
//
// The validators, each at the tag and commit einvoice-fetch.mjs recorded:
//   cen     the CEN/TC 434 EN 16931 UBL schematron, from ConnectingEurope/eInvoicing-EN16931
//   peppol  the OpenPeppol BIS Billing 3.0 UBL schematron (PEPPOL-EN16931-UBL), from OpenPeppol/peppol-bis-invoice-3
// Each is run from the compiled XSLT its repository ships at that commit when it ships one; otherwise its .sch is compiled
// with SchXslt (--schxslt; the pipeline's sha256 is recorded). The processor is SaxonC-HE through schematron-svrl.py.
//
// The label of a file for a rule a ruleset cites is "fires" when either validator's SVRL holds a failed-assert or a
// successful-report with that rule's id (any flag; the flag is recorded), and "does not fire" otherwise. A file is valid for
// a ruleset when no rule it cites fires, invalid when one does. A file a validator could not process is left unlabelled
// and listed (section 10), and joins no denominator. The rules each ruleset cites are read off its checks (lib.mjs:
// citedRules), from the pinned ruleset files.
//
// Writes <results>/labels.json and appends its sha256 to the run's ledger as the arm's labels (section 3). The labeller of
// this arm is the agent that runs this command, named with the model id its own first reply attested; the arm's word for its
// labels is "validator-labelled", never "independent".
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { args, citedRules, HARNESS, kids, ledgerAppend, posix, readJson, RULESET_FILES, RUN_DIR, scanXml, sha256File, writeNew } from './lib.mjs'

const SVRL = 'http://purl.oclc.org/dsdl/svrl'

/** Every file under a folder, as forward-slash paths relative to it. */
function listFiles(dir) {
  const out = []
  const walk = (d) => { for (const n of readdirSync(d)) { if (n === '.git') continue; const p = join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p); else out.push(posix(relative(dir, p))) } }
  walk(dir)
  return out.sort()
}

/** Find a validator's artefact in a clone: its compiled XSLT when the repository ships one, else its schematron. */
export function locate(files, { xslt, sch }) {
  const x = files.filter(f => xslt.test(f))
  if (x.length === 1) return { kind: 'xslt', path: x[0] }
  if (x.length > 1) throw new Error(`more than one compiled XSLT matches ${xslt}: ${x.join(', ')}; the amendment does not choose between them`)
  const s = files.filter(f => sch.test(f))
  if (s.length === 1) return { kind: 'sch', path: s[0] }
  throw new Error(s.length ? `more than one schematron matches ${sch}: ${s.join(', ')}` : `no compiled XSLT matching ${xslt} and no schematron matching ${sch}`)
}
export const VALIDATORS = [
  { id: 'cen', repo: 'eInvoicing-EN16931', xslt: /(^|\/)ubl\/xslt\/EN16931-UBL-validation\.xslt?$/i, sch: /(^|\/)ubl\/schematron\/EN16931-UBL-validation\.sch$/i },
  { id: 'peppol', repo: 'peppol-bis-invoice-3', xslt: /(^|\/)PEPPOL-EN16931-UBL\.xslt?$/i, sch: /(^|\/)rules\/sch\/PEPPOL-EN16931-UBL\.sch$/i },
]

/** The rule ids an SVRL report fires, with their flags: { id: [flag, …] }. */
export function firedRules(svrlText) {
  const root = scanXml(svrlText)
  const fired = {}
  const walk = (el) => {
    for (const c of el.children) {
      if (c.ns === SVRL && (c.local === 'failed-assert' || c.local === 'successful-report')) {
        const id = c.attrs.find(a => a.ns === null && a.local === 'id')?.value
        const flag = c.attrs.find(a => a.ns === null && a.local === 'flag')?.value ?? null
        if (id) (fired[id] ??= []).push(flag)
      }
      walk(c)
    }
  }
  walk(root)
  return fired
}

/** Run both validators on files [{ key, path }] and return { meta, byKey: { key: { fired: {id: [{validator, flag}]}, errors: [] } } }. */
export function runValidators({ files, fetchTags, work, python = 'python', schxslt = null, out }) {
  const validators = VALIDATORS.map(v => {
    const repo = fetchTags.repos.find(r => r.name === v.repo)
    if (!repo || !repo.commit) throw new Error(`${v.repo} was not fetched at a commit; the validators run only on a fetched tag`)
    const dir = join(work, v.repo)
    const found = locate(listFiles(dir), v)
    if (found.kind === 'sch' && !schxslt) throw new Error(`${v.repo} at ${repo.tag} ships no compiled XSLT for ${v.id}; give --schxslt <SchXslt's xslt/2.0/pipeline-for-svrl.xsl>`)
    return { id: v.id, repo: v.repo, tag: repo.tag, commit: repo.commit, artefact: found.path, kind: found.kind, artefact_sha256: sha256File(join(dir, found.path)),
      job: found.kind === 'xslt' ? { id: v.id, xslt: join(dir, found.path) } : { id: v.id, sch: join(dir, found.path), schxslt: resolve(schxslt) } }
  })
  mkdirSync(out, { recursive: true })
  const jobPath = join(out, 'job.json')
  writeFileSync(jobPath, JSON.stringify({ validators: validators.map(v => v.job), inputs: files.map(f => ({ key: f.key, file: f.path })), out }, null, 1))
  execFileSync(python, [join(HARNESS, 'schematron-svrl.py'), jobPath], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  const job = readJson(join(out, 'job-result.json'))
  const byKey = Object.fromEntries(files.map(f => [f.key, { fired: {}, errors: [] }]))
  for (const r of job.results) {
    const slot = byKey[r.key]
    if (!r.ok) { slot.errors.push({ validator: r.validator, error: r.error }); continue }
    const fired = firedRules(readFileSync(join(out, r.validator, `${r.key}.svrl.xml`), 'utf8'))
    for (const [id, flags] of Object.entries(fired)) (slot.fired[id] ??= []).push(...flags.map(flag => ({ validator: r.validator, flag })))
  }
  const meta = { processor: { saxon: job.saxon, python: job.python }, validators: validators.map(({ job: _j, ...v }) => ({ ...v, ...job.validators[v.id] })) }
  return { meta, byKey }
}

/** The labels of one file for the rules the rulesets cite. */
export function labelFile(entry, cites) {
  const all = [...new Set(Object.values(cites).flat())].sort()
  if (entry.errors.length) return { decided: false, errors: entry.errors }
  const fires = Object.fromEntries(all.map(id => [id, id in entry.fired]))
  const flags = Object.fromEntries(all.filter(id => id in entry.fired).map(id => [id, entry.fired[id]]))
  const valid = Object.fromEntries(Object.entries(cites).map(([v, ids]) => [v, ids.every(id => !fires[id])]))
  return { decided: true, fires, flags, valid, fired_any_rule: Object.keys(entry.fired).sort() }
}

export const citesNow = () => Object.fromEntries(Object.entries(RULESET_FILES).map(([v, f]) => [v, citedRules(readJson(f)).rules]))

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const a = args(process.argv.slice(2))
  const R = resolve(a.results ?? join(RUN_DIR, 'results', 'einvoice'))
  const WORK = resolve(a.work ?? join(RUN_DIR, 'tmp', 'einvoice-clones'))
  if (!a.labeller || !a['labeller-model'] || !a.attestation) { console.error('name the labeller: --labeller <name> --labeller-model <the model id its first reply attested> --attestation <file holding that reply\'s model field>'); process.exit(3) }
  if (existsSync(join(R, 'labels.json'))) { console.error(`${R}/labels.json exists; the labels are made once`); process.exit(1) }
  const fetchTags = readJson(join(R, 'fetch-tags.json'))
  const manifest = readJson(join(R, 'fetch-manifest.json'))
  if (fetchTags.dry_run || manifest.dry_run) console.error(`DRY RUN: ${fetchTags.dry_run || manifest.dry_run}`)
  const files = manifest.selected.map(s => ({ key: s.key, path: join(R, s.file) }))
  const { meta, byKey } = runValidators({ files, fetchTags, work: WORK, python: a.python ?? 'python', schxslt: a.schxslt ?? null, out: join(R, 'svrl') })
  const cites = citesNow()
  const labels = {
    format: 'blind-shipping-1/einvoice-labels/1',
    labeller: { name: a.labeller, model: a['labeller-model'], attestation_sha256: sha256File(a.attestation), word: 'validator-labelled' },
    ...meta, cites,
    files: manifest.selected.map(s => ({ key: s.key, id: s.id, sha256: s.sha256, ...labelFile(byKey[s.key], cites) })),
  }
  const h = writeNew(join(R, 'labels.json'), labels)
  if (!manifest.dry_run) ledgerAppend({ arm: 'einvoice', event: 'hashed', kind: 'labels', sha256: h })
  const undecided = labels.files.filter(f => !f.decided).length
  console.error(`labels.json: ${labels.files.length} files, ${undecided} unlabelled; sha256 ${h}${manifest.dry_run ? ' (dry run: not on the ledger)' : ' (on the ledger)'}`)
}
