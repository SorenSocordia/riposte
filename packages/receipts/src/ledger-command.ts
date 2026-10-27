/**
 * The `riposte-ledger` command, as a pure function (the bin in ./ledger-cli.ts only does I/O).
 *
 *   riposte-ledger verify <ledger.jsonl> [--key <public.pem>] [--require-signed] [--head <hash>]
 *   riposte-ledger summary <ledger.jsonl>
 *   riposte-ledger fingerprint <key.pem> [--short]    (public or private key → the full fingerprint and public PEM to pin)
 *   riposte-ledger rule <ledger.jsonl> --verdict <id> --by <role> --decision allow|deny --note "…" [--key <private.pem>]
 *                  [--rules R1,R2] [--verdict-file <verdict.json>] [--ledger-key <private.pem>]
 *
 * `rule` (2026-10-02) appends a person's AUTHORITY RULING (./ruling.ts): call-scoped (one verdict, the rule ids named),
 * Ed25519-signed with --key, never a waiver of later checks. The verdict is read from --verdict-file, else from the ap_gate
 * receipt on this ledger that carries it. Without --rules the ruling covers the role's whole mandate in that verdict (the
 * rules its authority remedies name); with --rules every rule must be in that mandate. Without --key it is recorded
 * unsigned, and ap_gate refuses it. The ledger entry is signed with --ledger-key when given (a ledger pinned to one key
 * needs it). Refuses to append to a chain that does not verify. The bin appends through the receipts file store
 * (2026-10-03): the chain is read, checked and appended to under the ledger's single-writer lock, in one critical section.
 *
 * `rule --sign-only` (2026-10-03) prints the signed ruling and appends nothing: what `POST /v1/ap/rulings` takes. The verdict
 * then comes from --verdict-file, or the rules are named with --rules (the server checks the mandate on its own ledger).
 *
 * `verify` (2026-10-03) also says:
 *   - a TORN TAIL: the file ends in a line that was never finished (a crash mid-append). The chain before it is checked and
 *     the exit is 1; the receipts file store quarantines those bytes the next time it opens the ledger.
 *   - each torn tail already QUARANTINED, from the signed note the store put on the chain (bytes, sha256, file).
 *   - with --proof <proof.json | proofs.jsonl> [--entry <seq|hash>]: whether each proof the customer kept BINDS to its ap_gate
 *     receipt: the verdict hashes to the receipt's verdict_sha256, and the verdict id, input hash and each document's sha256
 *     and length are the receipt's. A proof that does not bind names its entry and the field; the exit is then 1.
 *
 * `verify` (2026-10-05) also reads the HEAD RECORD beside the file (`<ledger>.head.json`, ./head-record.ts),
 * unless --no-sidecar: a file shorter than the record, or whose entry at the record's head is another one, does not verify
 * (exit 1), in words. No record: verify says that truncation cannot be detected without an anchor. The record is written by
 * the same process beside the file, so it adds a refusal and never removes one; --head, a head recorded elsewhere, is the
 * anchor. A pinned --key now needs every entry signed by it (an unsigned entry fails, as verifyEntry already did).
 *
 * `verify` (2026-10-05): a missing head record does not verify unless --no-sidecar (a file cut at the tail
 * with its record deleted too verified OK); `chain_ok` is the hash chain alone, beside `signatures_ok` and `anchor_ok`; and
 * `fingerprint` prints the full sha256 of the key's DER bytes, the value verify replay pins (--short adds 16 hex for display).
 *
 * Exit: 0 ok · 1 the chain does not verify, a cut or rewrite the head record shows, a torn tail, a proof that does not bind,
 * or a ruling refused (no mandate) · 3 usage / unreadable input, or a line before the last that is not JSON.
 * A chain alone cannot detect a whole-file rewrite. `verify` without --key, --require-signed or --head prints a warning.
 *
 * `verify` (2026-10-13): a torn tail is a last line that is not a whole entry, with or without a newline after it (a partial line
 * ending in a newline used to be exit 3, "line N is not JSON"), and its words give the next step; a whole last entry with no
 * newline after it verifies, with a note (it used to be a torn tail); a broken chain's first line is "BROKEN: chain", and when
 * every signature still verifies the words say why signatures_ok alone is not the answer.
 *
 * `verify` (2026-10-19; a cold reviewer rewrote a signed entry as `"decision":"EXECUTE","decision":"HOLD"` and it verified with
 * the pinned key, exit 0): every line is read under the engine's hash contract (readLedgerLine, verify's parseJsonStrict). A key
 * written twice in one object, or a number whose text does not read back as written, breaks the chain at that entry (exit 1),
 * naming the line and the JSON path; `summary` and `rule` read the same way, and parseLedger / parseLedgerTolerant throw by
 * default, so every reader of a ledger file refuses such a line. The head record's byte count is checked against the file (the
 * reviewer's file had grown by 21 bytes). The bin reads every file as UTF-8 and refuses bytes that are not (exit 3).
 *
 *   riposte-ledger sign <verdict.json | proof.json> --key <private.pem>
 *   riposte-ledger verify-signature <envelope.json | proof.json> [--trusted-key <public.pem | 64-hex fingerprint>]
 *
 * `sign` (2026-10-14; an engineer's request from a cold review, 2026-10-13) puts a verdict, or the verdict inside a replay bundle,
 * into the engine's signed envelope { verdict, alg: "ed25519", public_key, signature } (verify's signVerdict, unchanged: an
 * Ed25519 signature over the canonical JSON of the verdict; the same shape `verify replay`, `riposte-replay` and the gate
 * server's `replay` read). A bundle keeps its inputs, so it still replays. It prints the ISSUER FINGERPRINT (sha256 over the
 * public key's DER bytes, 64 hex: what `fingerprint` prints and `--trusted-key` pins), which the issuer publishes once, out of
 * band. `verify-signature` checks an envelope offline: the signature (exit 1 when a byte of the verdict changed), and with
 * --trusted-key, that the issuer is the one expected. It checks the signature, not the verdict: a replay re-performs that.
 */
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { bundlesFromText, invalidUtf8Offset, parseJsonStrict, signVerdict, verifyEnvelope, type SignedVerdict, type Verdict } from 'riposte-verify'
import { keyFingerprint, openLedger, readLedgerLine, verifyChain, type ChainPolicy, type LedgerEntry, type LedgerStore, type LineRefusal } from './ledger.js'
import { makeRuling, mandateOf, rulingIdOf, signRuling, type RulingDecision } from './ruling.js'
import { bindProof, receiptForProof } from './ap-receipt.js'
import { checkHeadRecord, headRecordPathOf, ledgerLayout, type HeadRecordCheck } from './head-record.js'

export const LEDGER_USAGE = [
  'riposte-ledger verify <ledger.jsonl> [--key <public.pem>] [--require-signed] [--head <hash>] [--no-sidecar] [--proof <proof.json | .jsonl> [--entry <seq | hash>]]',
  'riposte-ledger summary <ledger.jsonl> [--no-sidecar]',
  'riposte-ledger fingerprint <key.pem> [--short]',
  'riposte-ledger rule <ledger.jsonl> --verdict <id> --by <role> --decision allow|deny --note "…" [--key <private.pem>]',
  '               [--rules R1,R2] [--verdict-file <verdict.json>] [--ledger-key <private.pem>] [--sign-only]',
  'riposte-ledger case ingest | witness | check …   (arbitration case rows under a witnessed head: riposte-ledger case --help)',
  'riposte-ledger sign <verdict.json | proof.json> --key <private.pem>      (the issuer signs a verdict, or a replay bundle\'s verdict, into the envelope shape)',
  'riposte-ledger verify-signature <envelope.json | proof.json> [--trusted-key <public.pem | 64-hex fingerprint>]',
].join('\n')

/** `riposte-ledger --help`: the usage, how a ledger is written, and what each check catches (2026-10-05). */
export const LEDGER_HELP = `${LEDGER_USAGE}

How a ledger is written. This command appends only a person's ruling (rule). Every other receipt is appended by the tool
that made the decision, one entry per decision, under the ledger's single-writer lock: riposte-pilot shadow (one per bill
and pay application), the MCP server and riposte-serve (each ap_gate, check_done, check_claims and model_attest call),
riposte-claims and riposte-attest-monitor. From code, this package exports the same call they use:
  openLedger(fileStore('receipts.jsonl'), { signingKey }).append(kind, body)
The store rewrites the head record (<ledger>.head.json: entry count, head hash, byte length) after every append.

What verify checks, and what each check catches:
  the chain, always     each entry follows the one before and its hash re-derives: an edit, a reorder or a deletion inside
                        the file, unless whoever made it recomputed every hash after it. Each line is read strictly, as
                        the engine reads a replay bundle: a key written twice in one object, or a number whose text does
                        not read back as written, breaks the chain at that entry, naming the line and the JSON path.
                        JSON keeps the last of two values, so the hash and the signature would cover one value while a
                        reader that keeps the first sees another. Every file is read as UTF-8; bytes that are not UTF-8
                        cannot be read.
  --key <public.pem>    every entry carries a valid signature by this key (an unsigned entry fails): a forged, edited,
                        reordered or deleted entry, even with every hash recomputed. It does NOT catch a clean cut at the
                        tail (the entries left are still signed), or a rewrite of the whole file by whoever holds the
                        private key.
  the head record       read by default from beside the file: a cut at the tail, or a rewrite, that left the record behind,
                        and, from its byte count, bytes added to or removed from the entries it covers.
                        It is written by the same process in the same folder, so whoever can rewrite the file can rewrite
                        or delete the record too. No record: verify does not verify (exit 1), because a cut with the
                        record deleted too would otherwise pass. --no-sidecar verifies without it, and says so.
  --head <hash>         a head you recorded earlier somewhere you control (another system, write-once storage): the chain
                        must still contain it. It catches a cut or a rewrite of everything up to that head, by anyone, the
                        key's holder included. This is the real guard against truncation; entries written after you
                        recorded it are covered by the next head you record.
  --require-signed      no entry may be unsigned (implied by --key).
The head record can add a refusal and never removes one: --head is checked whatever the record says.

Exit (verify):
  0  verified. A last entry with no newline after it is not a failure: verify says so in a note, because the receipts
     file store moves the bytes after the last newline aside when it next opens the ledger.
  1  not verified: a broken chain (the first line reads "BROKEN: chain"), a line the strict reader refuses (it breaks
     the chain at that entry), a signature that does not verify or is not the --key's, a cut or rewrite the head record
     shows (its byte count included), no head record without --no-sidecar, a --head not in the chain, a torn tail (a last
     line that is not a whole entry, with or without a newline after it; the words say how to repair it), or a proof
     that does not bind.
  3  a usage error, a file that cannot be read, or a line before the last that is not JSON.
The JSON on stdout agrees with the exit: "ok", its first key, is true exactly when the exit is 0; "reason" names what failed
first; "chain_ok" is the hash chain's own answer (links and hashes only), "signatures_ok" the signatures' and the --key's,
and "anchor_ok" (with --head) whether the chain still holds that head. Read "ok": an entry whose body was edited still has a
valid signature over the hash it records (signatures_ok true, chain_ok false, ok false).

Key fingerprints. fingerprint prints a key's fingerprint: sha256 over its DER-encoded public key, 64 hex, the value verify
pins (--key takes the key itself) and the value verify replay prints and --trusted-key pins. --short adds its first 16 hex
characters for display; a prefix is never a pin, because a key can be ground to match a short prefix.

Signing (sign, verify-signature). sign puts a verdict, or the verdict inside a replay bundle ({ verdict, inputs }), into the
engine's signed envelope { verdict, alg: "ed25519", public_key, signature }: an Ed25519 signature over the canonical JSON of
the verdict, the same shape verify replay, riposte-replay and the gate server's replay read. A bundle keeps its inputs, so it
still replays. It prints the ISSUER FINGERPRINT: sha256 over the public key's DER bytes, 64 hex, the value fingerprint prints
and --trusted-key pins. The fingerprint is published once, out of band (on the issuer's site, in the contract), and a
replayer pins it; a fingerprint carried inside an envelope is never the pin, because the envelope carries its own key.
verify-signature checks an envelope offline: the signature over the verdict body (exit 1 when one byte of it changed), and
with --trusted-key, that the issuer is the one expected (another issuer's valid signature is exit 1, and the words say whose it
is). It checks the signature, not the verdict: riposte-replay or verify replay re-performs the verdict.
Exit (sign, verify-signature): 0 signed, or the signature verifies (and is the trusted key's when one was given) · 1 the
signature does not verify, another key signed it, or the file carries no envelope · 3 usage, a file that cannot be read, a
file that is not a verdict or bundle, a key that is not an Ed25519 private key (sign) or not a public key (--trusted-key).`

/** Read a ledger's head record through `readFile`: its text, nothing when there is none, or why it could not be read. */
function readHeadRecord(file: string, readFile: (path: string) => string): { text?: string; error?: string } {
  try { return { text: readFile(headRecordPathOf(file)) } } catch (e) {
    const code = (e as { code?: unknown }).code
    return code === undefined || code === 'ENOENT' || code === 'ENOTDIR' ? {} : { error: (e as Error).message }
  }
}

/**
 * The head-record check for a verify, replay or summary run ({ error }: the record exists and could not be read; the caller
 * exits 3). `required` (verify and replay, 2026-10-05): a missing record does not verify unless `skip` (--no-sidecar).
 * 2026-10-19: the record's byte count is checked against the file's layout; `ledgerText` is the file's text when the caller has
 * it (otherwise it is read through `readFile`).
 */
export function headRecordFor(file: string, entries: readonly LedgerEntry[], readFile: (path: string) => string, skip: boolean, required = false, ledgerText?: string): HeadRecordCheck | { error: string } {
  const name = headRecordPathOf(file).split(/[\\/]/).pop()!
  if (skip) return checkHeadRecord(entries, name, undefined, { skipped: true })
  const r = readHeadRecord(file, readFile)
  if (r.error !== undefined) return { error: `cannot read the head record ${headRecordPathOf(file)}: ${r.error} (pass --no-sidecar to verify without it)` }
  if (r.text === undefined) return checkHeadRecord(entries, name, undefined, { required })
  let text = ledgerText
  if (text === undefined) {
    try { text = readFile(file) } catch (e) { return { error: `cannot read ${file} to compare it with its head record: ${(e as Error).message}` } }
  }
  return checkHeadRecord(entries, name, r.text, { required, layout: ledgerLayout(text) })
}

/**
 * A file's bytes as text, refusing bytes that are not UTF-8 (2026-10-19). readFileSync(path, 'utf8') replaces each such byte
 * with U+FFFD, so two different files read the same, and a head record's byte count would be compared with the wrong length.
 * The engine's invalidUtf8Offset finds the first one. A byte-order mark is kept, as readFileSync kept it. The bin reads every
 * file through it.
 */
export function readLedgerText(bytes: Uint8Array, name: string): string {
  const at = invalidUtf8Offset(bytes)
  // a code of its own, so a head record that is not UTF-8 reads as unreadable, never as missing (readHeadRecord)
  if (at >= 0) throw Object.assign(new Error(`${name} is not valid UTF-8 at byte ${at}: every file this command reads is UTF-8 (the receipts store writes nothing else), and reading it would replace those bytes, so two different files would read the same`), { code: 'ledger.not_utf8' })
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8')
}

export interface CliResult { code: number; out: string; err: string }

/** What `rule` needs beyond reading: a way to append to the ledger, and the clock (the person's ruling time). */
export interface LedgerCliIO {
  /**
   * The ledger as a store (2026-10-03; the bin passes the receipts file store, which takes the single-writer lock
   * by default). `rule` then reads, checks and appends inside one critical section under that lock. Preferred over `append`.
   */
  openStore?: (path: string) => LedgerStore
  /** append a raw line (the old hook, no lock of its own: refuses past any live lock). Used only without `openStore`. */
  append?: (path: string, text: string) => void
  now?: () => Date
  /** who holds the ledger's single-writer lock (./file-store.ts lockHolder): `rule` never appends past a running server */
  lockHolder?: (path: string) => { pid?: number; host?: string; started_at?: string; alive: boolean | 'unknown'; mode?: 'append' | 'hold' } | undefined
}

/**
 * How a reader treats a line the strict reader refuses (2026-10-19; readLedgerLine): 'throw' (the default, so every reader of a
 * ledger file fails closed) throws its reason; 'collect' (verify, summary, rule) keeps JSON.parse's reading of it and returns the
 * first one as `refused`, for verifyChain to break the chain there.
 */
export interface LedgerReadOptions { refusals?: 'throw' | 'collect' }

/** Whole lines, in order, each read under the hash contract; a line that is not JSON throws "line N is not JSON". */
function readWholeLines(lines: readonly string[], collect: boolean): { entries: LedgerEntry[]; refused?: LineRefusal } {
  const entries: LedgerEntry[] = []
  let refused: LineRefusal | undefined
  for (let i = 0; i < lines.length; i++) {
    const r = readLedgerLine(lines[i]!, i, i + 1)
    if (r === undefined) throw new Error(`line ${i + 1} is not JSON`)
    if (r.refused) {
      if (!collect) throw new Error(r.refused.reason)
      refused ??= r.refused
    }
    entries.push(r.entry)
  }
  return refused ? { entries, refused } : { entries }
}

/**
 * Every non-blank line of a ledger file as an entry. 2026-10-19: each line is read as the engine reads a replay bundle, and a line
 * that JSON.parse reads but the strict reader refuses (a key written twice in one object, a number that does not read back as
 * written) throws, naming the entry, the line and the JSON path.
 */
export function parseLedger(text: string): LedgerEntry[] {
  return readWholeLines(text.split('\n').filter((l) => l.trim()), false).entries
}

/**
 * Like parseLedger, but the file's last line is read as a tail, and both tail shapes are reported instead of thrown
 * (2026-10-13; a cold reader found a partial last line that ended in a newline thrown as "line 5 is not JSON", exit 3 with no
 * next step, while a whole last entry with no newline after it was a TORN TAIL):
 *   - a last line that is not a whole entry (it does not parse as JSON) is a TORN TAIL, with or without a newline after it:
 *     the whole lines before it are parsed, and `torn` says how many bytes it holds (its newline included), after which line,
 *     and `ends_in_newline` when a newline follows it (a crash mid-append leaves none; a cut or an edit does);
 *   - a last entry that parses but has no newline after it is a whole entry, kept; `no_final_newline` says so.
 * Any line before the last that is not JSON still throws ("line N is not JSON"). Before 2026-10-13 the bytes after the last
 * newline were a torn tail whatever they held, and a partial line that ended in a newline threw.
 * 2026-10-19: every whole line, the last included, is read under the hash contract (readLedgerLine). A line the strict reader
 * refuses throws its reason by default (case, pilot and replay read ledgers through here, so they refuse it too); with
 * `refusals: 'collect'` it is kept as JSON.parse reads it, and the first is returned as `refused`.
 */
export function parseLedgerTolerant(text: string, opts: LedgerReadOptions = {}): { entries: LedgerEntry[]; torn?: { bytes: number; after_line: number; ends_in_newline?: true }; no_final_newline?: true; refused?: LineRefusal } {
  const lines = text.split('\n')
  let last = lines.length - 1
  while (last >= 0 && !lines[last]!.trim()) last--
  if (last < 0) return { entries: [] }
  const collect = opts.refusals === 'collect'
  const whole = readWholeLines(lines.slice(0, last).filter((l) => l.trim()), collect)
  const entries = whole.entries
  let refused = whole.refused
  const tail = lines[last]!
  const newline = last < lines.length - 1
  const t = readLedgerLine(tail, entries.length, entries.length + 1)
  if (t === undefined) {
    return { entries, torn: { bytes: Buffer.byteLength(tail, 'utf8') + (newline ? 1 : 0), after_line: entries.length, ...(newline ? { ends_in_newline: true as const } : {}) }, ...(refused ? { refused } : {}) }
  }
  if (t.refused) {
    if (!collect) throw new Error(t.refused.reason)
    refused ??= t.refused
  }
  return { entries: [...entries, t.entry], ...(newline ? {} : { no_final_newline: true as const }), ...(refused ? { refused } : {}) }
}

export interface ProofBindingLine { proof: string; entry: number | null; bound: boolean; field?: string; reason?: string }

/** Bind each proof in a file (a bundle, an array of them, or a .jsonl) to its receipt on `entries`. */
export function bindProofs(entries: readonly LedgerEntry[], file: string, text: string, want?: string): ProofBindingLine[] {
  return bundlesFromText(file, text).map(({ name, bundle }) => {
    const vid = isObj(bundle) && isObj(bundle.verdict) ? bundle.verdict.verdict_id : undefined
    const e = receiptForProof(entries, bundle, want)
    if (!e) return { proof: name, entry: null, bound: false, field: 'entry', reason: want !== undefined ? `no entry ${want} on the ledger` : `no ap_gate receipt on the ledger carries verdict ${String(vid)}` }
    const b = bindProof(e.body, bundle)
    return b.ok ? { proof: name, entry: e.seq, bound: true } : { proof: name, entry: e.seq, bound: false, field: b.field, reason: b.reason }
  })
}

/** Public PEM + fingerprint from a PEM that holds either a public or a private key. */
export function publicOf(pem: string): { public_key: string; fingerprint: string } {
  let pub: string
  try { pub = createPublicKey(pem).export({ type: 'spki', format: 'pem' }).toString() } catch {
    pub = createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'pem' }).toString()
  }
  return { public_key: pub, fingerprint: keyFingerprint(pub) }
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

/**
 * The verdict a ruling would answer: a verdict, an envelope or a bundle in a file; else the latest ap_gate receipt carrying it.
 * A receipt that stored its documents carries the whole verdict; a hashes-only receipt (the default since 2026-10-03) carries
 * the claims' rules and outcomes and the remedies' kinds, roles and rule ids, which is all a mandate is read from.
 */
function findVerdict(id: string, entries: readonly LedgerEntry[], fileJson?: unknown): Verdict | undefined {
  const unwrap = (x: unknown): unknown => isObj(x) && isObj(x.verdict) ? unwrap(x.verdict) : x
  if (fileJson !== undefined) {
    const v = unwrap(fileJson)
    return isObj(v) && v.verdict_id === id ? v as unknown as Verdict : undefined
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const b = isObj(entries[i]?.body) ? entries[i]!.body as Record<string, unknown> : undefined // a null line holds no verdict
    const p = b?.proof
    if (isObj(p) && isObj(p.verdict) && p.verdict.verdict_id === id) return p.verdict as unknown as Verdict
    if (b && entries[i]!.kind === 'ap_gate' && b.stored === 'hashes' && b.verdict_id === id && Array.isArray(b.claims)) {
      return { verdict_id: id, claims: b.claims, remedies: Array.isArray(b.remedies) ? b.remedies : [] } as unknown as Verdict
    }
  }
  return undefined
}

function ruleCommand(file: string, rest: string[], readFile: (path: string) => string, io: LedgerCliIO): CliResult {
  const usage = (msg: string): CliResult => ({ code: 3, out: '', err: `${msg}\n${LEDGER_USAGE}\n` })
  const f: Record<string, string> = {}
  let signOnly = false
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    if (a === '--sign-only') { signOnly = true; continue }
    if (!['--verdict', '--by', '--decision', '--note', '--key', '--rules', '--verdict-file', '--ledger-key'].includes(a)) return usage(`unknown option ${a}`)
    const v = rest[++i]
    if (v === undefined || v.startsWith('--')) return usage(`${a} needs a value`)
    f[a.slice(2)] = v
  }
  for (const k of ['verdict', 'by', 'decision', 'note']) if (!f[k]) return usage(`rule needs --${k}`)
  if (f.decision !== 'allow' && f.decision !== 'deny') return usage('--decision is allow or deny')
  if (!/^[0-9a-f]{32}$/.test(f.verdict!)) return usage('--verdict is a 32-hex verdict id')
  if (signOnly && !f.key) return usage('--sign-only needs --key: an unsigned ruling is refused everywhere')
  if (signOnly && f['ledger-key']) return usage('--sign-only appends nothing, so --ledger-key has nothing to sign')
  if (!signOnly && !io.append && !io.openStore) return { code: 3, out: '', err: 'this build cannot append to a ledger\n' }
  const heldByServer = (h: { pid?: number; host?: string; alive: boolean | 'unknown' }): CliResult => ({ code: 3, out: '', err: `refusing to append: ${file} is held by a running server (pid ${h.pid ?? '?'} on ${h.host ?? '?'}${h.alive === 'unknown' ? ', another host' : ''}), and one process writes a ledger at a time. Sign the ruling with --sign-only and POST it to that server's /v1/ap/rulings.\n` })

  // 2026-10-03: with `openStore` (the bin) the ledger is read, checked and appended to inside ONE critical section
  // under its single-writer lock, so nothing lands between the check and the ruling, and a torn tail is quarantined and
  // recorded by the store instead of refused. A per-append writer's lock is waited for; a running server's refuses.
  if (!signOnly && io.openStore) {
    const holder = io.lockHolder?.(file)
    if (holder && holder.alive !== false && holder.mode !== 'append') return heldByServer(holder)
    const store = io.openStore(file)
    try {
      // 2026-10-19: the store parses its lines with JSON.parse, so the file's text is read here too, under the lock, and a line
      // the strict reader refuses breaks the chain before anything is appended (a line that is not JSON: the store refuses it)
      const run = (): CliResult => {
        let refused: LineRefusal | undefined
        let text: string | undefined
        try { text = readFile(file) } catch { text = undefined } // a new ledger
        if (text !== undefined) { try { refused = parseLedgerTolerant(text, { refusals: 'collect' }).refused } catch { refused = undefined } }
        return decide(store.load(), store, refused)
      }
      return store.exclusive ? store.exclusive(run) : run()
    } catch (e) {
      return { code: 3, out: '', err: `${(e as { code?: unknown }).code === 'ledger.locked' ? 'refusing to append' : 'cannot append'}: ${(e as Error).message}\n` }
    }
  }

  let entries: LedgerEntry[] = []
  let text: string | undefined
  let refused: LineRefusal | undefined
  // --sign-only reads the ledger only to find the verdict (it may not exist: the hosted ledger is the server's)
  try { text = readFile(file) } catch { text = undefined } // a new ledger
  if (text !== undefined) {
    let torn: { bytes: number; after_line: number } | undefined
    try { ({ entries, torn, refused } = parseLedgerTolerant(text, { refusals: 'collect' })) } catch (e) { return { code: 3, out: '', err: `${file}: ${(e as Error).message}\n` } }
    if (torn && !signOnly) return { code: 1, out: '', err: `refusing to append: ${file} ends in a torn line (${torn.bytes} bytes after entry ${torn.after_line - 1}, a crash mid-append). Open it with the receipts file store (riposte-serve, or the MCP server), which quarantines the torn bytes and records it, then rule again.\n` }
  }
  return decide(entries, undefined, refused)

  /**
   * Check the chain and the mandate, sign, and append: through `store` when given (under its lock), else `io.append`.
   * `refused` (2026-10-19): the first line of the file the strict reader refused; the chain breaks there.
   */
  function decide(entries: LedgerEntry[], store?: LedgerStore, refused?: LineRefusal): CliResult {
    if (!signOnly) {
      const c = verifyChain(entries, {}, refused ? { refused } : {})
      if (!c.ok) return { code: 1, out: '', err: `refusing to append: the chain does not verify (entry ${c.broken_at ?? '-'}: ${c.reason})\n` }
    }
    let fileJson: unknown
    if (f['verdict-file']) {
      try { fileJson = JSON.parse(readFile(f['verdict-file'])) } catch (e) { return { code: 3, out: '', err: `cannot read ${f['verdict-file']}: ${(e as Error).message}\n` } }
    }
    const verdict = findVerdict(f.verdict!, entries, fileJson)
    const asked = f.rules ? [...new Set(f.rules.split(',').map((s) => s.trim()).filter(Boolean))] : undefined
    let rules: string[]
    if (verdict) {
      const mandate = mandateOf(verdict, f.by!)
      if (!mandate.length) {
        const roles = [...new Set((verdict.remedies ?? []).filter((r) => r.kind === 'authority').map((r) => r.authority))]
        return { code: 1, out: '', err: `refused: role '${f.by}' has no mandate in verdict ${f.verdict} (its authority remedies name: ${roles.join(', ') || 'no role'})\n` }
      }
      const outside = (asked ?? []).filter((r) => !mandate.includes(r))
      if (outside.length) return { code: 1, out: '', err: `refused: role '${f.by}' has no mandate over ${outside.join(', ')} in verdict ${f.verdict} (its mandate: ${mandate.join(', ')})\n` }
      rules = asked ?? mandate
    } else {
      if (!asked) return { code: 3, out: '', err: `verdict ${f.verdict} is not on ${file} (no ap_gate receipt carries it) and no --verdict-file was given: name the rules with --rules, or give the verdict\n` }
      rules = asked
    }

    let ruling, keyText: string | undefined, ledgerKey: string | undefined
    try {
      if (f.key) keyText = readFile(f.key)
      if (f['ledger-key']) ledgerKey = readFile(f['ledger-key'])
      ruling = makeRuling({ verdict_id: f.verdict!, rules, by: f.by!, decision: f.decision as RulingDecision, note: f.note!, ...(io.now ? { now: io.now } : {}) })
    } catch (e) { return { code: 3, out: '', err: `${(e as Error).message}\n` } }
    // Signed: the ruling with its own signature (it travels on its own). Unsigned: the ruling and its id, refused at the gate.
    let body: unknown
    try { body = keyText ? signRuling(ruling, keyText) : { ruling, ruling_id: rulingIdOf(ruling) } } catch (e) { return { code: 3, out: '', err: `cannot sign: ${(e as Error).message}\n` } }
    const signed = Boolean(keyText)
    if (signOnly) {
      return { code: 0, out: `${JSON.stringify(body, null, 2)}\n`, err: `ruling ${rulingIdOf(ruling)} signed (not recorded): ${ruling.by} ${ruling.decision}s ${ruling.rules.join(', ')} on verdict ${ruling.verdict_id} only${verdict ? '' : '; its mandate was not checked here (the verdict is not on this ledger)'}. POST it to /v1/ap/rulings.\n` }
    }
    if (!store) {
      // without a store (an injected `append`): no lock to wait on, so any live lock refuses
      const holder = io.lockHolder?.(file)
      if (holder && holder.alive !== false) return heldByServer(holder)
    }
    const target: LedgerStore = store ?? { load: () => entries, append: (e: LedgerEntry) => { io.append!(file, JSON.stringify(e) + '\n'); entries = [...entries, e] } }
    let entry: LedgerEntry
    try { entry = openLedger(target, { ...(ledgerKey ? { signingKey: ledgerKey } : {}), ...(io.now ? { now: io.now } : {}) }).append('ruling', body) } catch (e) { return { code: 3, out: '', err: `cannot append: ${(e as Error).message}\n` } }
    const out = { ruling_id: rulingIdOf(ruling), verdict_id: ruling.verdict_id, rules: ruling.rules, by: ruling.by, decision: ruling.decision, signed, seq: entry.seq, hash: entry.hash, ledger_entry_signed: Boolean(entry.signature), verdict_found: Boolean(verdict) }
    const warn = signed ? '' : 'note: unsigned (no --key). It is on the record, and ap_gate refuses it: a ruling counts only when signed by a key pinned for its role.\n'
    return { code: 0, out: `${JSON.stringify(out, null, 2)}\n`, err: `ruling ${out.ruling_id} recorded at entry ${entry.seq}: ${ruling.by} ${ruling.decision}s ${ruling.rules.join(', ')} on verdict ${ruling.verdict_id} only\n${warn}` }
  }
}

// ── sign / verify-signature (2026-10-14) ────────────────────────────────────────────────────────────────────────────────

/** An envelope as the engine writes it: a verdict under `verdict`, with a `signature`. */
const isEnvelope = (x: unknown): x is SignedVerdict => isObj(x) && isObj(x.verdict) && typeof x.signature === 'string'
const fingerprintOrUnknown = (pem: unknown): string => { try { return keyFingerprint(String(pem)) } catch { return '?' } }
const PUBLISHED_ONCE = 'the fingerprint is published once, out of band; a replayer pins it with --trusted-key, and a fingerprint carried inside an envelope is never the pin'

/** Read a JSON file under the hash contract (a repeated key, a number past the double range, a byte-order mark is refused by name). */
function readJsonStrict(file: string, readFile: (path: string) => string): { json: unknown } | { error: string } {
  let text: string
  try { text = readFile(file) } catch (e) { return { error: `cannot read ${file}: ${(e as Error).message}` } }
  try { return { json: parseJsonStrict(text, file) } } catch (e) { return { error: (e as Error).message } }
}

function signCommand(file: string, rest: string[], readFile: (path: string) => string): CliResult {
  const usage = (msg: string): CliResult => ({ code: 3, out: '', err: `${msg}\n${LEDGER_USAGE}\n` })
  let keyPath: string | undefined
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    if (a !== '--key') return usage(`unknown option ${a}`)
    const v = rest[++i]
    if (v === undefined || v.startsWith('--')) return usage('--key needs a value')
    keyPath = v
  }
  if (!keyPath) return usage('sign needs --key <private.pem>: the issuer\'s Ed25519 private key')
  const read = readJsonStrict(file, readFile)
  if ('error' in read) return { code: 3, out: '', err: `${read.error}\n` }
  const json = read.json
  let keyText: string
  try { keyText = readFile(keyPath) } catch (e) { return { code: 3, out: '', err: `cannot read ${keyPath}: ${(e as Error).message}\n` } }
  try {
    const key = createPrivateKey(keyText)
    if (key.asymmetricKeyType !== 'ed25519') return { code: 3, out: '', err: `cannot sign: a verdict is signed with an Ed25519 key, not ${String(key.asymmetricKeyType)}\n` }
  } catch (e) { return { code: 3, out: '', err: `cannot sign: ${keyPath} is not a private key (${(e as Error).message})\n` } }
  // what the file holds: an envelope (refused: sign the verdict, not the envelope), a bundle, or a verdict
  const already = (env: SignedVerdict): CliResult => ({ code: 3, out: '', err: `${file} is already a signed envelope (issuer fingerprint ${fingerprintOrUnknown(env.public_key)}); a second signature is not a countersignature. Sign the verdict, not the envelope\n` })
  const notOne: CliResult = { code: 3, out: '', err: `${file}: not a verdict (no verdict_id) and not a replay bundle ({ verdict, inputs })\n` }
  if (isEnvelope(json)) return already(json)
  let verdict: Verdict
  let wrap: (env: SignedVerdict) => unknown
  if (isObj(json) && isObj(json.verdict)) {
    if (isEnvelope(json.verdict)) return already(json.verdict)
    if (typeof json.verdict.verdict_id !== 'string') return notOne
    verdict = json.verdict as unknown as Verdict
    wrap = (env) => ({ ...json, verdict: env })
  } else if (isObj(json) && typeof json.verdict_id === 'string') {
    verdict = json as unknown as Verdict
    wrap = (env) => env
  } else return notOne
  let env: SignedVerdict
  try { env = signVerdict(verdict, keyText) } catch (e) { return { code: 3, out: '', err: `cannot sign: ${(e as Error).message}\n` } }
  return { code: 0, out: `${JSON.stringify(wrap(env), null, 2)}\n`, err: `signed verdict ${verdict.verdict_id} · issuer fingerprint ${keyFingerprint(env.public_key)}\n${PUBLISHED_ONCE}\n` }
}

function verifySignatureCommand(file: string, rest: string[], readFile: (path: string) => string): CliResult {
  const usage = (msg: string): CliResult => ({ code: 3, out: '', err: `${msg}\n${LEDGER_USAGE}\n` })
  let trustedSpec: string | undefined
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    if (a !== '--trusted-key') return usage(`unknown option ${a}`)
    const v = rest[++i]
    if (v === undefined || v.startsWith('--')) return usage('--trusted-key needs a value: a public key PEM file, or the 64-hex fingerprint')
    trustedSpec = v
  }
  const read = readJsonStrict(file, readFile)
  if ('error' in read) return { code: 3, out: '', err: `${read.error}\n` }
  const json = read.json
  // the trusted key: a 64-hex fingerprint as published, or a public key file (never a private key)
  let trusted: string | undefined
  if (trustedSpec !== undefined) {
    if (/^[0-9a-f]{64}$/.test(trustedSpec)) trusted = trustedSpec
    else {
      let pem: string
      try { pem = readFile(trustedSpec) } catch (e) { return { code: 3, out: '', err: `--trusted-key: cannot read ${trustedSpec}: ${(e as Error).message} (give a public key PEM file, or the 64-hex fingerprint)\n` } }
      if (/PRIVATE KEY/.test(pem)) return { code: 3, out: '', err: '--trusted-key is a private key: give the public key whose signature counts (never a private key)\n' }
      try { trusted = keyFingerprint(pem) } catch (e) { return { code: 3, out: '', err: `--trusted-key: ${trustedSpec} is not a public key in PEM: ${(e as Error).message}\n` } }
    }
  }
  // the envelope: the file, or the verdict of a bundle
  let env: SignedVerdict | undefined
  if (isEnvelope(json)) env = json
  else if (isObj(json) && isEnvelope(json.verdict)) env = json.verdict
  else if (isObj(json) && ((isObj(json.verdict) && typeof json.verdict.verdict_id === 'string') || typeof json.verdict_id === 'string')) {
    const id = isObj(json.verdict) ? json.verdict.verdict_id : json.verdict_id
    return { code: 1, out: `${JSON.stringify({ ok: false, signature_ok: false, verdict_id: id, reason: 'not signed' }, null, 2)}\n`, err: `NOT VERIFIED: not signed: ${file} carries a verdict with no envelope { verdict, alg, public_key, signature }; riposte-ledger sign writes one\n` }
  } else return { code: 3, out: '', err: `${file}: not a signed envelope, a replay bundle carrying one, or a verdict\n` }
  const issuer = fingerprintOrUnknown(env.public_key)
  const verdict_id = isObj(env.verdict) ? env.verdict.verdict_id : undefined
  const ec = verifyEnvelope(env)
  if (!ec.signature_ok) {
    return { code: 1, out: `${JSON.stringify({ ok: false, signature_ok: false, verdict_id, issuer_fingerprint: issuer, reason: 'the signature does not verify: the verdict body was altered, or the key does not match' }, null, 2)}\n`,
      err: `NOT VERIFIED: the signature does not verify: the verdict body was altered, or the key does not match\n${ec.reason && !/^signature does not verify/.test(ec.reason) ? `${ec.reason}\n` : ''}` }
  }
  if (trusted !== undefined && trusted !== issuer) {
    return { code: 1, out: `${JSON.stringify({ ok: false, signature_ok: true, verdict_id, issuer_fingerprint: issuer, trusted: false }, null, 2)}\n`,
      err: `NOT VERIFIED: signed by ${issuer}, which is not the trusted key (${trusted}); the signature verifies, but it proves only that the holder of that other key issued the verdict\n` }
  }
  return { code: 0, out: `${JSON.stringify({ ok: true, signature_ok: true, verdict_id, issuer_fingerprint: issuer, ...(trusted !== undefined ? { trusted: true } : {}) }, null, 2)}\n`,
    err: `OK: the signature verifies${trusted !== undefined ? ', by the trusted key' : ''}; issuer fingerprint ${issuer}\nnote: this checks the signature, not the verdict: riposte-replay or verify replay re-performs it\n` }
}

export function ledgerCli(argv: string[], readFile: (path: string) => string, io: LedgerCliIO = {}): CliResult {
  const [cmd, file, ...rest] = argv
  const usage = (msg?: string): CliResult => ({ code: msg ? 3 : 0, out: '', err: `${msg ? `${msg}\n` : ''}${msg ? LEDGER_USAGE : LEDGER_HELP}\n` })
  if (!cmd || cmd === '--help' || cmd === '-h' || file === '--help' || file === '-h') return usage()
  if (!file) return usage(`${cmd} needs a file`)
  if (cmd === 'rule') return ruleCommand(file, rest, readFile, io)
  if (cmd === 'sign') return signCommand(file, rest, readFile)
  if (cmd === 'verify-signature') return verifySignatureCommand(file, rest, readFile)
  let text: string
  try { text = readFile(file) } catch (e) { return { code: 3, out: '', err: `cannot read ${file}: ${(e as Error).message}\n` } }

  if (cmd === 'fingerprint') {
    // 2026-10-05: the full fingerprint, the value `verify replay` prints and pins; --short adds its first 16
    // hex characters for display. Before, this printed only those 16, which no pin accepts.
    for (const a of rest) if (a !== '--short') return usage(`unknown option ${a}`)
    const short = rest.includes('--short')
    try {
      const p = publicOf(text)
      const shown = short ? { ...p, short: p.fingerprint.slice(0, 16) } : p
      return { code: 0, out: `${JSON.stringify(shown, null, 2)}\n`, err: `fingerprint ${p.fingerprint}${short ? `\nshort ${p.fingerprint.slice(0, 16)} (for display only: pin the full fingerprint)` : ''}\n` }
    } catch (e) { return { code: 3, out: '', err: `not a key: ${(e as Error).message}\n` } }
  }

  let entries: LedgerEntry[]
  let torn: { bytes: number; after_line: number; ends_in_newline?: true } | undefined
  let noFinalNewline: true | undefined
  // 2026-10-19: each line read under the hash contract; the first line the strict reader refuses breaks the chain there
  let refused: LineRefusal | undefined
  try { ({ entries, torn, no_final_newline: noFinalNewline, refused } = parseLedgerTolerant(text, { refusals: 'collect' })) } catch (e) { return { code: 3, out: '', err: `${file}: ${(e as Error).message}\n` } }
  if (torn && cmd !== 'verify') return { code: 3, out: '', err: `${file}: line ${entries.length + 1} is not JSON (a torn tail of ${torn.bytes} bytes: riposte-ledger verify says more)\n` }
  const read = refused ? { refused } : {}

  if (cmd === 'summary') {
    for (const a of rest) if (a !== '--no-sidecar') return usage(`unknown option ${a}`)
    const hr = headRecordFor(file, entries, readFile, rest.includes('--no-sidecar'), false, text)
    if ('error' in hr) return { code: 3, out: '', err: `${hr.error}\n` }
    const kinds: Record<string, number> = {}
    for (const e of entries) kinds[e?.kind] = (kinds[e?.kind] ?? 0) + 1 // a null line counts as "undefined", as an array line does
    const c = verifyChain(entries, {}, read)
    const s = { entries: entries.length, kinds, first_at: entries[0]?.at ?? null, last_at: entries[entries.length - 1]?.at ?? null, head: c.head, chain_ok: c.chain_ok, signatures_ok: c.signatures_ok, signed: c.signed, unsigned: c.unsigned, signers: c.signers, ...(c.reason ? { reason: c.reason } : {}), head_record: hr }
    return { code: c.ok && hr.ok ? 0 : 1, out: `${JSON.stringify(s, null, 2)}\n`, err: hr.ok ? '' : `${hr.words}\n` }
  }

  if (cmd !== 'verify') return usage(`unknown command ${cmd}`)
  const policy: ChainPolicy = {}
  let proofFile: string | undefined
  let want: string | undefined
  let noSidecar = false
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    if (a === '--require-signed') policy.requireSigned = true
    else if (a === '--no-sidecar') noSidecar = true
    else if (a === '--key' || a === '--head' || a === '--proof' || a === '--entry') {
      const v = rest[++i]
      if (!v) return usage(`${a} needs a value`)
      if (a === '--head') policy.head = v
      else if (a === '--proof') proofFile = v
      else if (a === '--entry') want = v
      else {
        try { policy.publicKey = publicOf(readFile(v)).public_key } catch (e) { return { code: 3, out: '', err: `cannot use key ${v}: ${(e as Error).message}\n` } }
      }
    } else return usage(`unknown option ${a}`)
  }
  if (want !== undefined && proofFile === undefined) return usage('--entry names the receipt a --proof binds to: give --proof too')
  let bindings: ProofBindingLine[] | undefined
  if (proofFile !== undefined) {
    let ptext: string
    try { ptext = readFile(proofFile) } catch (e) { return { code: 3, out: '', err: `cannot read ${proofFile}: ${(e as Error).message}\n` } }
    bindings = bindProofs(entries, proofFile, ptext, want)
  }
  const c = verifyChain(entries, policy, read)
  const hr = headRecordFor(file, entries, readFile, noSidecar, true, text)
  if ('error' in hr) return { code: 3, out: '', err: `${hr.error}\n` }
  const anchored = Boolean(policy.publicKey || policy.requireSigned || policy.head)
  const warn = anchored ? '' : 'note: no trust anchor given (--key, --require-signed or --head). This proves the file is internally consistent, not that nobody rewrote all of it.\n'
  const counts = `${c.length} entries, head ${c.head.slice(0, 16)}… · ${c.signed} signed (${c.signers.join(', ') || 'no keys'}) · ${c.unsigned} unsigned`
  // 2026-10-05: a chain that holds but a head record that says entries are missing (or another head) is NOT verified, and
  // the first line says so; the chain's own counts follow, so nobody reads "OK" over a cut file. Later the same day,
  // a torn tail or a proof that does not bind also leads with NOT VERIFIED: the first line never says OK when the
  // exit is not 0.
  const unbound = (bindings ?? []).filter((b) => !b.bound)
  const torn_cut = torn && hr.status === 'cut' ? ' (the unfinished line at the end of the file may be that entry: see TORN TAIL)' : ''
  // 2026-10-05: BROKEN only when the chain itself is; an intact chain with a wrong key, an unsigned entry
  // under --key, or a --head not in it reads NOT VERIFIED, and says the chain holds
  // 2026-10-13: a broken chain's first line is "BROKEN: chain" whatever else holds, and when every signature still verifies the
  // words say why that is not the answer (a cold reader's dashboard read signatures_ok alone on an edited entry and saw green)
  const sigNote = c.signatures_ok
    ? 'signatures_ok is true because each signature covers the hash its entry records, not the entry\'s body or its place in the chain: with the chain broken it does not vouch for this file. Read ok, which is false\n' : ''
  const line = !c.chain_ok
    ? `BROKEN: chain\nBROKEN at entry ${c.broken_at ?? '-'}: ${c.reason}\n${sigNote}`
    : !c.ok
      ? `NOT VERIFIED: ${c.reason}; the hash chain itself holds (${counts})\n`
    : !hr.ok
      ? `${hr.status === 'cut' ? 'BROKEN at the tail' : hr.status === 'rewritten' ? 'BROKEN' : 'NOT VERIFIED'}: ${hr.words}${torn_cut}\n`
        + `the entries in the file chain correctly on their own (${counts}); ${hr.status === 'cut' ? 'that does not show nothing was removed after them' : hr.status === 'rewritten' ? 'a consistent chain is what a rewrite by the key holder looks like' : 'without a readable head record, a cut at the tail would not show'}\n`
      : torn
        ? `NOT VERIFIED: torn tail. ${torn.ends_in_newline ? 'The file\'s last line is not a whole entry' : 'The file ends in an unfinished line'}; the entries before it chain correctly on their own (${counts})\n`
        : unbound.length
          ? `NOT VERIFIED: ${unbound.length} of ${bindings!.length} proof(s) do not bind to their receipts (see NOT BOUND); the chain itself holds (${counts})\n`
          : `OK: ${counts}\n`
  // the head record, when it agrees (or is behind), and its limit when no --head was given; when absent or skipped, a note
  const hrLine = !hr.ok ? (c.ok ? '' : `head record: ${hr.words}\n`) : hr.status === 'agrees' || hr.status === 'behind'
    ? `${hr.words}${policy.head ? '' : '. It is written beside the file by the same process, so it catches a cut that left it behind, not one that rewrote it too: --head <hash>, recorded somewhere you control, is the anchor'}\n`
    : `note: ${policy.head ? `${hr.status === 'skipped' ? 'head record not read (--no-sidecar)' : `no head record found (${hr.file})`}; the --head you gave is the anchor` : hr.words}\n`
  // 2026-10-13: both tail shapes, each with the next step. A partial line with a newline after it is not what a crash
  // mid-append leaves, and the file store does not move it aside (it refuses to open such a file), so that is not offered.
  const nextStep = torn ? `Next: truncate the file after entry ${torn.after_line - 1} and verify again, or restore it from a copy that matches its head record (<ledger>.head.json)` : ''
  const tornLine = !torn ? '' : torn.ends_in_newline
    ? `TORN TAIL: the file's last line is not a whole entry (${torn.bytes} bytes after entry ${torn.after_line - 1}), and a newline follows it, which a crash mid-append does not leave: a cut or an edit. The entries before it are checked above. ${nextStep}.\n`
    : `TORN TAIL: the file ends in an unfinished line (${torn.bytes} bytes after entry ${torn.after_line - 1}): a crash mid-append. The entries before it are checked above; the receipts file store moves those bytes to <ledger>.torn-<stamp> and records it when it next opens this ledger. ${nextStep}, or let the store do it.\n`
  // 2026-10-13: a whole last entry with no newline after it verifies; the note says so, and what the file store would do with it
  const newlineLine = noFinalNewline
    ? `note: the last line has no newline after it. Every entry is whole and was checked. The receipts file store reads the bytes after the last newline as an unfinished line and moves them aside when it next opens this ledger, so add the newline first (printf '\\n' >> ${file})\n` : ''
  const repairLines = (c.repairs ?? []).map((r) => `quarantined: entry ${r.seq} records a torn tail of ${r.bytes} bytes (sha256 ${r.sha256.slice(0, 16)}…) moved to ${r.quarantined_to}${r.after_seq !== null ? ` after entry ${r.after_seq}` : ''}`
    + (r.cut_entry ? `; the cut went through entry ${r.cut_entry.seq} (hash ${r.cut_entry.hash.slice(0, 16)}…), which had been written: that entry is lost from this file (a disk fault or an edit, not a crash)` : '') + '\n').join('')
  const bindLines = (bindings ?? []).map((b) => b.bound
    ? `BOUND: ${b.proof} ↔ entry ${b.entry}: the verdict hash, verdict id, input hash and documents are the receipt's\n`
    : `NOT BOUND: ${b.proof}${b.entry !== null ? ` at entry ${b.entry}` : ''}: ${b.field}: ${b.reason}\n`).join('')
  const ok = c.ok && hr.ok && !torn && unbound.length === 0
  // `ok` in the JSON is the exit code's (2026-10-05): true exactly when the exit is 0. Before, a torn tail or
  // an unbound proof left `ok: true` beside exit 1, so a CI step reading `.ok` passed a torn ledger. `chain_ok` keeps the
  // chain's own answer; `reason` names the first thing that failed.
  const reason = !c.ok ? c.reason
    : !hr.ok ? hr.words
      : torn ? (torn.ends_in_newline
        ? `torn tail: the last line is not a whole entry (${torn.bytes} bytes after entry ${torn.after_line - 1}, a newline after it): a cut or an edit, not a crash mid-append`
        : `torn tail: the file ends in an unfinished line (${torn.bytes} bytes after entry ${torn.after_line - 1}), a crash mid-append`)
        : unbound.length ? `${unbound.length} of ${bindings!.length} proof(s) do not bind to their receipts` : undefined
  // `chain_ok` is the hash chain's own answer; `signatures_ok` and `anchor_ok` (with --head) answer the key and the anchor.
  // `ok` comes first (2026-10-13 says so in the words too): a dashboard that reads one field reads that one.
  const out = { ...c, ok, ...(reason !== undefined ? { reason } : {}), head_record: hr, ...(torn ? { torn_tail: torn } : {}), ...(noFinalNewline ? { no_final_newline: true } : {}), ...(bindings ? { bindings } : {}) }
  return { code: ok ? 0 : 1, out: `${JSON.stringify(out, null, 2)}\n`, err: line + hrLine + newlineLine + tornLine + repairLines + bindLines + warn }
}
