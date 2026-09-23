# Quickstart — riposte-verify

Deterministic post-extraction verification. You bring data that has already been extracted, and it tells you whether the
numbers cohere: PASS, FAIL, or an honest *can't-tell* (`INSUFFICIENT_DATA`), with a replayable proof. It never guesses.

> Not yet on npm. Build from the repository root with `npm install && npm run build`, then import from `riposte-verify`
> (a workspace link) or run the CLI with `node packages/verify/dist/cli.js`.

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

Cross-document checks run only when you supply the reference:

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

Whenever it can't read something unambiguously, it abstains.

```ts
import { verifyInvoiceMatch } from 'riposte-verify'

const r = verifyInvoiceMatch({ invoice, purchase_order, goods_receipt, history /* optional: enables the duplicate check */ })
r.decision   // 'approve' | 'hold_no_po' | 'hold_quantity' | 'hold_price' | 'hold_total' | 'hold_duplicate' | 'abstain'
r.grounding  // invoice + PO number, the failing item, and both disagreeing values
r.verdict    // the full proof object: every check with the source spans it read (replayable, signable)
```

## CLI

```bash
riposte-verify invoice.json
riposte-verify payapp.json --ruleset pay-app --history previous.json
riposte-verify invoice.json --contract contract.json --source invoice.txt
riposte-verify ap docs/examples/ap-three-way.txt          # or --invoice <f> --po <f> --receipt <f>
cat invoice.json | riposte-verify -
# exit code: 0 PASS / approve · 1 FAIL / hold · 2 INSUFFICIENT_DATA / abstain · 3 usage error
```

## Proofs you don't have to trust us for

```ts
import { verifyReplay, generateSigningKeypair, signVerdict, verifyEnvelope } from 'riposte-verify'

verifyReplay(verdict, inputs)                  // re-derive the verdict id and check it is bound to these inputs; no engine needed
const { privateKeyPem } = generateSigningKeypair()
const signed = signVerdict(verdict, privateKeyPem)
verifyEnvelope(signed, inputs)                 // Ed25519 signature over the verdict + the same input-binding check
```

## As an MCP tool (call it from an agent before it acts)

```bash
riposte-verify-mcp        # a JSON-RPC MCP server over stdio; no config, no network
```

The tools are:
- `verify_document`: invoice or pay-app.
- `verify_invoice_match`: the AP three-way match.
- `verify_quotes`: does a passage appear verbatim in a source?
- `verify_citations`: legal cite-checking.
- `verify_action`: is a proposed action grounded in its sources?
- `verify_declared`: any JSON-defined document type.

An agent that is about to move money or file a document calls one of these and gates its action on the verdict.

## The one rule to remember

It returns a value only when it can prove it. Some fields can't be verified: a fuzzy-matched name, an ambiguous unit, a
reference that offers several candidates. Those come back as `INSUFFICIENT_DATA` with a reason, never as a confident guess.
The proof replays byte for byte, so a verdict issued today can be re-audited in three years.
