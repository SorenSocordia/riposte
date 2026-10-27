// blind-shipping-1, e-invoice arm (PREREG.md section 4.2): obtain the sources, after the stamp, and select the files.
// NOT RUN before the harness block is stamped. It touches the network (GitHub) and nothing in it may run earlier.
//
//   node harness/einvoice-fetch.mjs --date YYYY-MM-DD [--results results/einvoice] [--work tmp/einvoice-clones]
//        [--tree-root <dir>] [--never-read <dir>]... [--local <repo>=<dir>]... [--label <text>]
//
// --date is the day of the stamp (UTC) the amendment names. For each repository it takes the latest release on that day
// (GitHub releases: not a draft, not a pre-release, published at or before 23:59:59Z that day). A repository with no
// release at all is read by its tags instead (the latest tag whose date is at or before the end of that day), and the
// manifest says so. It records the tag, the commit and the time in fetch-tags.json, and appends their hash to the run's
// ledger, BEFORE any file of the repository is read.
//
// Selection, exactly as section 4.2 and the amendment fix it:
//   - the instance sources are itplr-kosit/xrechnung-testsuite and ConnectingEurope/eInvoicing-EN16931; the validator
//     source OpenPeppol/peppol-bis-invoice-3 is cloned for its schematron only, and none of its files is selected;
//   - every file of an instance source whose root element is a UBL 2.1 Invoice or CreditNote (by namespace), read from the
//     commit's own blob (the bytes as committed, never a checkout converted for this machine's line endings);
//   - in path order: the ordinal order of "<repository>/<path>";
//   - a file whose sha256 equals any file in this tree is dropped, and listed; the tree is indexed before anything is
//     fetched (lib.mjs: indexTree);
//   - a file whose bytes equal a file selected before it, in path order, is dropped as a duplicate and listed (the
//     amendment's duplicate clause).
// Each selected file is copied, byte for byte, to <results>/instances/<repository>/<path> and listed with its sha256.
//
// --local <repo>=<dir> reads a folder in place of a repository: a DRY RUN on fixtures, labelled so in every record.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { args, indexTree, ledgerAppend, posix, RUN_DIR, sha256, TREE_ROOT, ublRoot, writeNew } from './lib.mjs'

export const REPOS = [
  { name: 'eInvoicing-EN16931', owner: 'ConnectingEurope', role: 'instances and the CEN EN 16931 UBL schematron' },
  { name: 'peppol-bis-invoice-3', owner: 'OpenPeppol', role: 'the Peppol BIS Billing 3.0 schematron (no file selected)' },
  { name: 'xrechnung-testsuite', owner: 'itplr-kosit', role: 'instances' },
]
export const INSTANCE_REPOS = ['eInvoicing-EN16931', 'xrechnung-testsuite']
const git = (cwd, ...a) => execFileSync('git', a, { cwd, windowsHide: true, encoding: 'buffer', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] })
const gitText = (cwd, ...a) => git(cwd, ...a).toString('utf8').trim()

async function latestRelease(owner, name, endOfDay) {
  const all = []
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`https://api.github.com/repos/${owner}/${name}/releases?per_page=100&page=${page}`, { headers: { 'User-Agent': 'blind-shipping-1-harness', Accept: 'application/vnd.github+json' } })
    if (!r.ok) throw new Error(`GitHub releases of ${owner}/${name}: HTTP ${r.status}`)
    const batch = await r.json()
    all.push(...batch)
    if (batch.length < 100) break
  }
  const eligible = all.filter(x => !x.draft && !x.prerelease && x.published_at && x.published_at <= endOfDay).sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
  return { count: all.length, pick: eligible[0] ? { tag: eligible[0].tag_name, published_at: eligible[0].published_at, url: eligible[0].html_url } : null }
}

/** Files of a selection source: [{ path, read() }], from a commit's blobs or (dry run) a folder. */
function blobsAt(cwd, commit) {
  const out = git(cwd, 'ls-tree', '-r', '-z', '--full-tree', commit).toString('utf8').split('\0').filter(Boolean)
  return out.map(l => { const [meta, path] = l.split('\t'); const [, type, id] = meta.split(' '); return { type, id, path } })
    .filter(e => e.type === 'blob').map(e => ({ path: e.path, read: () => git(cwd, 'cat-file', 'blob', e.id) }))
}
function filesIn(dir) {
  const out = []
  const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p); else if (s.isFile()) out.push({ path: posix(relative(dir, p)), read: () => readFileSync(p) }) } }
  walk(dir)
  return out
}

/** Section 4.2's selection over the files of the instance sources; pure, so it is tested on fixtures. */
export function select(sources, index) {
  const all = []
  for (const s of sources) for (const f of s.files) all.push({ repo: s.name, path: f.path, id: `${s.name}/${f.path}`, read: f.read })
  all.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const selected = [], droppedInTree = [], duplicates = [], seen = new Map()
  let notUbl = 0
  for (const f of all) {
    const bytes = f.read()
    const root = ublRoot(bytes)
    if (!root) { notUbl++; continue }
    const h = sha256(bytes)
    const inTree = index.matches(bytes)
    if (inTree.length) { droppedInTree.push({ id: f.id, sha256: h, equals: inTree.slice(0, 5), equals_count: inTree.length }); continue }
    if (seen.has(h)) { duplicates.push({ id: f.id, sha256: h, duplicate_of: seen.get(h) }); continue }
    seen.set(h, f.id)
    selected.push({ key: `N${String(selected.length + 1).padStart(4, '0')}`, id: f.id, repo: f.repo, path: f.path, root, sha256: h, bytes: bytes.length, file: `instances/${f.repo}/${f.path}`, _bytes: bytes })
  }
  return { selected, droppedInTree, duplicates, notUbl, considered: all.length }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const a = args(process.argv.slice(2), { many: ['never-read', 'local'] })
  if (!a.date || !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) { console.error('usage: einvoice-fetch.mjs --date YYYY-MM-DD (the day of the stamp, UTC) [...]'); process.exit(3) }
  const R = resolve(a.results ?? join(RUN_DIR, 'results', 'einvoice'))
  const WORK = resolve(a.work ?? join(RUN_DIR, 'tmp', 'einvoice-clones'))
  const local = Object.fromEntries((a.local ?? []).map(s => { const i = s.indexOf('='); return [s.slice(0, i), resolve(s.slice(i + 1))] }))
  const dry = Object.keys(local).length > 0
  if (existsSync(join(R, 'fetch-manifest.json'))) { console.error(`${R}/fetch-manifest.json exists; the sources are fetched once`); process.exit(1) }
  const endOfDay = `${a.date}T23:59:59Z`
  const treeRoot = resolve(a['tree-root'] ?? TREE_ROOT)
  const t0 = Date.now()
  console.error(`indexing the tree at ${treeRoot} (sizes only) before anything is fetched…`)
  const index = indexTree(treeRoot, { neverRead: a['never-read'] ?? [], exclude: [join(RUN_DIR, 'results'), join(RUN_DIR, 'tmp'), R, WORK] })
  console.error(`  ${index.files} files indexed in ${Math.round((Date.now() - t0) / 1000)} s`)
  const repos = []
  for (const r of REPOS) {
    if (dry) {
      if (local[r.name]) repos.push({ ...r, url: null, tag: 'LOCAL-DRY-RUN', tag_method: 'dry run on a local folder', commit: null, dir: local[r.name], fetched_at: new Date().toISOString() })
      continue
    }
    const url = `https://github.com/${r.owner}/${r.name}`
    const rel = await latestRelease(r.owner, r.name, endOfDay)
    const dir = join(WORK, r.name)
    mkdirSync(WORK, { recursive: true })
    let tag, method, published = null
    if (rel.pick) { tag = rel.pick.tag; method = `the latest GitHub release published at or before ${endOfDay} (${rel.count} releases listed)`; published = rel.pick.published_at }
    else if (rel.count === 0) {
      git(WORK, 'clone', '--bare', '--filter=blob:none', '--no-tags', url, `${dir}.tags.git`)
      git(`${dir}.tags.git`, 'fetch', '--tags', '--filter=blob:none', 'origin')
      const refs = gitText(`${dir}.tags.git`, 'for-each-ref', '--format=%(refname:short)\t%(creatordate:iso-strict)', 'refs/tags').split('\n').filter(Boolean)
        .map(l => l.split('\t')).filter(([, d]) => new Date(d).toISOString() <= new Date(endOfDay).toISOString()).sort((x, y) => (new Date(x[1]) < new Date(y[1]) ? 1 : -1))
      if (!refs.length) throw new Error(`${r.owner}/${r.name}: no release and no tag at or before ${endOfDay}`)
      ;[tag, published] = refs[0]; method = `no GitHub release exists; the latest tag dated at or before ${endOfDay}`
    } else throw new Error(`${r.owner}/${r.name}: ${rel.count} releases, none published at or before ${endOfDay}; the amendment does not say what to do, so nothing is chosen`)
    git(WORK, '-c', 'core.autocrlf=false', 'clone', '--depth', '1', '--branch', tag, '--single-branch', url, dir)
    const commit = gitText(dir, 'rev-parse', 'HEAD')
    const tagObject = gitText(dir, 'rev-parse', `refs/tags/${tag}`)
    repos.push({ ...r, url, tag, tag_object: tagObject, tag_method: method, release_published_at: published, commit, dir, fetched_at: new Date().toISOString() })
  }
  const tags = { format: 'blind-shipping-1/einvoice-tags/1', date: a.date, dry_run: dry ? (a.label ?? 'DRY RUN on local fixtures; not data of this run') : false,
    repos: repos.map(({ dir, ...r }) => r) }
  const tagsHash = writeNew(join(R, 'fetch-tags.json'), tags)
  if (!dry) ledgerAppend({ arm: 'einvoice', event: 'hashed', kind: 'source-tags', sha256: tagsHash })
  const sources = repos.filter(r => INSTANCE_REPOS.includes(r.name)).map(r => ({ name: r.name, files: r.commit ? blobsAt(r.dir, r.commit) : filesIn(r.dir) }))
  const s = select(sources, index)
  for (const f of s.selected) { const p = join(R, f.file); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, f._bytes); delete f._bytes }
  const manifest = { format: 'blind-shipping-1/einvoice-fetch/1', date: a.date, dry_run: tags.dry_run, fetch_tags_sha256: tagsHash,
    tree_index: { root: posix(relative(RUN_DIR, index.root)) || '.', files_indexed: index.files, links_not_followed: index.links_not_followed, excluded: index.excluded, never_read_folders: index.never_read_folders, private_folders_not_opened: index.private_folders_not_opened },
    counts: { files_considered: s.considered, not_ubl_invoice_or_credit_note: s.notUbl, dropped_equal_to_a_file_in_this_tree: s.droppedInTree.length, dropped_duplicates: s.duplicates.length, selected: s.selected.length },
    selected: s.selected, dropped_in_tree: s.droppedInTree, duplicates: s.duplicates }
  const h = writeNew(join(R, 'fetch-manifest.json'), manifest)
  if (!dry) ledgerAppend({ arm: 'einvoice', event: 'hashed', kind: 'selection', sha256: h, selected: s.selected.length, dropped_in_tree: s.droppedInTree.length })
  console.error(`${s.selected.length} selected of ${s.considered} files (${s.notUbl} not UBL Invoice/CreditNote, ${s.droppedInTree.length} equal to a file in this tree, ${s.duplicates.length} duplicates); fetch-manifest.json sha256 ${h}`)
}
