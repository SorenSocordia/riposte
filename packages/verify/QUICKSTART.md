# Quickstart — riposte-verify

Deterministic post-extraction verification. You bring data that has already been extracted, and it tells you whether the
numbers cohere: PASS, FAIL, or an honest *can't tell*, with a replayable proof. A figure that cannot be read unambiguously
comes back as can't tell, with the reason: a lone "1,500" or "1.500" unless the extraction declares `number_locale`, a
document that writes figures both as "1,500.00" and as "1.500,00" or in two scripts of digits, a stray no-break space.
The `ap` command's emailed-bill input still reads its figures in US style; other known exceptions are open rows in the
misses ledger ([`docs/MISSES.md`](docs/MISSES.md)).

Each answer has one name in prose and one in the JSON. Can't tell is `INSUFFICIENT_DATA` in a verdict and in command
headlines. A PASS on which some checks could not run reads `PASS-WITH-OPEN` on screen and `PASS_WITH_OPEN` in a verdict's
`gate_status` field. Other terms are defined in the [glossary](../../docs/GLOSSARY.md).

> Not yet on npm. Build from the repository root with `npm install --legacy-peer-deps && npm run build` (plain
> `npm install` works under npm 11.6.2 and fails under npm 10.9.x), then import from `riposte-verify` (a workspace link). Every command on this page runs from the repository root and is written
> `node packages/verify/dist/cli.js <command>`, the form a source checkout runs. Installed as a package, the same program
> is `riposte-verify`, and pages that say `verify` mean it too.

## What `npm test` does

From the repository root, `npm test` runs each package's test suite in turn (vitest): the engine (`packages/verify`), then
the agent layer (`packages/receipts`), the adapters (`packages/adapters`) and the nine other workspaces `scripts/test-all.mjs`
names, twelve in all; then three checks that are not packages (the whetstone, the refusals pages' drift test and their
generator's check). Every package and check runs even when an earlier one fails, and the run ends with one line per package
and check (passed, or FAILED with its exit code) and exits non-zero if any failed (`scripts/test-all.mjs`). It makes no
outbound network calls.

- Each package's test configuration points the temporary folder at its own `tmp/vitest/` (gitignored), so the tests, and
  any process they start, write their scratch folders there and not in your system's temporary folder. Nothing there needs
  keeping.
- Some files (among them `packages/verify/test/http-transport.test.ts`, `packages/verify/test/http-check-budget.test.ts`
  and `packages/verify/test/hash-contract-entry-points.test.ts`) start the engine's HTTP server on 127.0.0.1 at a random
  port for the length of the file, send it requests, and close it. Nothing listens on any other interface.
  `http-check-budget.test.ts` also sends a stand-in worker requests built to run past their time or memory budget, so for
  a moment a worker thread allocates up to 64 MiB.
- `packages/adapters/test/hosts-bins.test.ts` starts the hook executables as child processes and feeds them input.
- `npm run test:determinism` (inside `packages/verify`) runs only the determinism suite: no server, about half a minute,
  and more than 10,000 replays of the golden fixtures, each byte-identical.

## Library

```ts
import { verify } from 'riposte-verify'

const verdict = verify({
  invoice_number: 'INV-1001',
  line_items: [
    { description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 },
    { description: 'Travel', quantity: 1, unit_price: 250.5, amount: 250.5 },
  ],
  totals: { subtotal: 1750.5, tax_rate: 0.0825, tax: 144.42, total: 1894.92 },
})

verdict.outcome        // 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA'
verdict.claims         // one proof per rule: operands, provenance, variance, locked
verdict.verdict_id     // deterministic: same input + ruleset + engine → same id
```

A PASS can still carry checks that could not run. Before anything acts on money, read the gate status, which has four
values:

```ts
import { gateStatus } from 'riposte-verify'

gateStatus(verdict)    // 'PASS' | 'PASS-WITH-OPEN' | 'FAIL' | 'INSUFFICIENT_DATA'; treat PASS-WITH-OPEN as not passed
verdict.gate_status    // the same reading recorded in the verdict (engine 0.6.0), spelled 'PASS_WITH_OPEN' there
```

The invoice above reads PASS-WITH-OPEN: its own arithmetic holds, and the checks that need a contract, a delivery receipt,
dates or the list of invoices already processed could not run. The command line fails closed on it: it exits 2 unless you
pass `--allow-open`, which exits 0 and says so on stderr. Cross-document checks run only when you supply the reference:

```ts
verify(invoice, { references: { contract, evidence: [receipt] } })
verify(payApp,  { ruleset: 'pay-app', references: { history: [previousApplication] } })
```

To check that the extracted numbers (or a quoted passage) actually appear in the document text:

```ts
verify(invoice, { source: { text: pdfText, values: [{ id: 'total', value: 1894.92, field: 'total' }] } })
```

## Accounts payable: the three-way match

This takes the invoice as it arrived (free text), the ERP purchase order and the goods receipt, and returns a pay/hold
decision. It follows this policy, in order:
1. The PO number matches.
2. No line bills more than was received.
3. No unit price is more than 2% over the PO.
4. The total adds up, with freight allowed only if the PO allows it.

Whenever it can't read something unambiguously, a person decides (the decision `abstain`). Without a payment history the
duplicate check cannot run, so a bill that passes every other check also goes to a person; pass `history: []` to say
nothing is booked yet.

The structured input path is the product. The emailed-text path is a convenience with a documented limit, and every
approve names which path read the bill. The structured input's manual is [`docs/AP-INPUT.md`](docs/AP-INPUT.md).

```ts
import { verifyInvoiceMatch } from 'riposte-verify'

const r = verifyInvoiceMatch({ invoice, purchase_order, goods_receipt, history /* the payment history: runs the duplicate check */ })
r.decision   // 'approve' | 'hold_no_po' | 'hold_quantity' | 'hold_price' | 'hold_line_math' | 'hold_total' | 'hold_duplicate' | 'abstain'
r.grounding  // invoice + PO number, the failing item, and both disagreeing values
r.verdict    // the full proof object: every check with the source spans it read (replayable, signable)
```

## CLI

```bash
node packages/verify/dist/cli.js invoice.json
node packages/verify/dist/cli.js packages/verify/docs/examples/payapp-g702-g703.json --ruleset pay-app --history packages/verify/docs/examples/payapp-g702-g703.previous.json
                                    # a G702/G703 pay application and last month's: PASS, 44 of 44 checks
node packages/verify/dist/cli.js invoice.json --contract contract.json --source invoice.txt
node packages/verify/dist/cli.js ap packages/verify/docs/examples/ap-three-way.txt     # or --invoice <f> --po <f> --receipt <f>
node packages/verify/dist/cli.js ap packages/verify/docs/examples/ap-three-way.txt --history booked.json   # a JSON array; [] = nothing booked
node packages/verify/dist/cli.js ap --input bill.json     # structured input: docs/AP-INPUT.md
cat invoice.json | node packages/verify/dist/cli.js -
# exit code: 0 a clean PASS / approve · 1 FAIL / hold · 2 PASS-WITH-OPEN, INSUFFICIENT_DATA / a person decides · 3 usage error
# fails closed: only a clean PASS exits 0. ap prints A PERSON DECIDES and exits 2 on a bill a check could not run on.
# --allow-open says so on stderr: check exits 0 on PASS-WITH-OPEN; ap exits 0 only on a bill held for want of a payment history.
```

## Replay a verdict someone hands you

A replay re-runs the check on your machine, with this open-source engine and no model, and compares the canonical JSON of
the result with the verdict's, byte for byte (the `issued_at` timestamp aside). What you need depends on what you were handed.

**A bundle** (one JSON file holding `{ "verdict": …, "inputs": … }`), a `.jsonl` of bundles, or a folder of them. A bundle
carries its own inputs, so it takes no other flags:

```bash
node packages/verify/dist/cli.js replay bundle.json        # or cases.jsonl, or a folder of *.json / *.jsonl bundles
```

Each case prints one line: `MATCH <file> <outcome>` (the replay agrees, and the verdict's own answer was `<outcome>`),
`DIVERGED` (with the field that differs), `NOT_REPERFORMED` or `REFUSED` (with the reason). A folder is not searched
recursively. Exit 0 all match · 1 any diverged · 2 some not re-performed · 3 refused.

**A verdict on its own**, plus the files it was issued on. Pass the inputs the verdict names: always `--extraction`, plus
`--ruleset` for a JSON-defined document type and `--source` (a file) when it was checked against page text:

```bash
node packages/verify/dist/cli.js replay verdict.json --extraction invoice.json
node packages/verify/dist/cli.js replay verdict.json --extraction extraction.json --ruleset peppol-en16931 --source page.txt
```

`outcome VERIFIED`, exit 0: re-performed and byte-identical. The next line is the verdict's own answer: PASS,
PASS-WITH-OPEN (with how many checks could not run), FAIL or INSUFFICIENT_DATA. `FAILED`, exit 1: the inputs, the outcome
or a signature do not match. Exit 2: you gave no inputs, so only the verdict's structure and id were checked and the
outcome was NOT re-performed. Exit 3: not a verdict, a file with a key repeated in one object, or an input the verdict names was left out
(the message says which flag).

If you were handed a signed envelope, pin the signer: add `--trusted-key <public.pem | keygen.json | 64-hex fingerprint>`.
The replay then fails (exit 1) on an envelope signed by any other key, and on a verdict with no signature. Add `--strict`
to fail as well when anything was not re-performed: an annotation field the replay exempts, remedies that were missing and
re-derived, or an envelope whose key you did not pin. Strict also fails a verdict with no `issued_at`. The issuer's
`document.producer` label is reported, not failed, because only a signature by a pinned key binds it.

Two things to know when you read the output:
- The JSON result goes to stdout and a short human summary to stderr, so you may see the answer twice.
- The input hash is taken over the canonical JSON of the inputs, not over the files' bytes. Re-ordering keys or writing
  `6125` as `6125.0` is the same input. A changed trailing newline or CRLF line endings in a source text file is a
  different input. The hash contract is in [`docs/REPLAY.md`](docs/REPLAY.md).

To try it with nothing handed to you, save this as `invoice.json` (the invoice from the top of this page, as JSON):

```json
{
  "invoice_number": "INV-1001",
  "line_items": [
    { "description": "Consulting", "quantity": 10, "unit_price": 150, "amount": 1500 },
    { "description": "Travel", "quantity": 1, "unit_price": 250.5, "amount": 250.5 }
  ],
  "totals": { "subtotal": 1750.5, "tax_rate": 0.0825, "tax": 144.42, "total": 1894.92 }
}
```

then:

```bash
node packages/verify/dist/cli.js invoice.json > verdict.json                       # PASS-WITH-OPEN: writes the verdict, exit 2
node packages/verify/dist/cli.js replay verdict.json --extraction invoice.json     # outcome VERIFIED, exit 0
```

Change one figure in `invoice.json` and run the replay again: it refuses, exit 1.

## Proofs you don't have to trust us for

```ts
import { verifyReplay, generateSigningKeypair, signVerdict, verifyEnvelope } from 'riposte-verify'

verifyReplay(verdict, inputs)                  // re-derive the id, check it binds these inputs, and re-run the check byte for byte
                                               // (without inputs: structure only, and it says the outcome was NOT re-performed)
const { privateKeyPem } = generateSigningKeypair()
const signed = signVerdict(verdict, privateKeyPem)
verifyEnvelope(signed, inputs)                 // Ed25519 signature over the verdict + the same input-binding check
```

An envelope carries the signer's public key, so a valid signature says only that this key signed. Compare the key with
the issuer's published key before you rely on it.

## As an MCP tool (call it from an agent before it acts)

```bash
node packages/verify/dist/mcp/stdio.js    # a JSON-RPC MCP server over stdio; --policy <policy.json> pins the operator's price tolerance; no network (installed: riposte-verify-mcp)
```

The tools are:
- `verify_document`: invoice or pay-app.
- `verify_invoice_match`: the AP three-way match.
- `verify_quotes`: does a passage appear in a source? A case-insensitive match that also ignores spacing, quotation-mark
  and dash style, and hyphens at line breaks.
- `verify_citations`: a quotation check for a legal brief. For each citation, are the quoted words in the opinion text you
  supply, as quoted, letter case included? It does not check that the case exists, is good law, or supports the
  proposition. See [`docs/LEGAL.md`](docs/LEGAL.md).
- `verify_action`: is a proposed action grounded in its sources?
- `verify_declared`: any JSON-defined document type.
- `verify_twin`: 10-K values against the filing's own inline-XBRL facts.
- `action_check`: one proposed tool call, checked before it runs. The autonomy level a person set decides whether it is
  held, shown or only recorded.
- `voice_assess`: the autonomy level a person granted a workflow, read from the verdict ledger, and any proposal to raise
  or lower it, with the evidence.
- `opinion_render`: a written opinion on a disputed reading of the verdict ledger: the question, the candidate readings with
  the records they cite, the ruling and what would overturn it.
- `reconcile_completeness`: did every payment go through the check?
- `grant_cosign`: a second person's signature on a grant that needs two.

An agent that is about to move money calls one of these and gates its action on the verdict, reading PASS-WITH-OPEN as not
passed. Before gating a legal filing on `verify_citations`, read its published accuracy in
[`docs/LEGAL.md`](docs/LEGAL.md).

## The one rule to remember

It is designed to return a value only when the value follows from what it was given. Some fields can't be verified: a
fuzzy-matched name, an ambiguous unit, a reference that offers several candidates. Those come back as `INSUFFICIENT_DATA`
with a reason. Its proof is relative to its inputs: a PASS on a quotation means the words are in the text you supplied, not
that the text is the right opinion. The known exceptions to the rule are open rows in [`docs/MISSES.md`](docs/MISSES.md).
The proof replays byte for byte, so a verdict issued today can be re-audited later with the same engine version.
