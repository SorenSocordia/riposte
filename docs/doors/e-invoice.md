# E-invoices: Peppol BIS 3.0 / EN 16931, ZATCA, KSeF

For teams whose extractor (OCR, an AI model, a vendor service) reads e-invoices. With the XML, Riposte checks what the
extractor read against the binding XML itself. With only a PDF or a scan, it checks that the extracted figures agree with
each other and with the published business rules. It calls no model, and the answer states and exit codes are in
[How to read an answer](../../README.md#how-to-read-an-answer).

## With the XML

**First command:** a total with two digits swapped, against a sample Peppol invoice that ships with the tests.

```bash
echo '[{"id":"total","field":"payable_amount","value":1043.00}]' | node packages/verify/dist/cli.js twin-einvoice packages/verify/test/fixtures/einvoice/peppol-bis3-invoice.xml --claims - --profile peppol-bis3
```

It answers FAIL: "two adjacent digits are transposed (1043 vs 1034)", naming the binding element, BT-115 PayableAmount, and
the XML's own figures pass 7 of 7 business rules. Exit code 1.

- `--claims` takes a file, or `-` for stdin: a JSON list of `{"id", "field", "value", "currency"}`, the currency optional.
- The same command reads ZATCA and KSeF FA(3) XML (`--profile zatca-ksa` or `ksef-fa3`).
- The XML is read as structured data. Nothing is guessed from layout, and the XML is the reference the extraction is
  compared with.

## With a PDF or a scan, and no XML

The Peppol ruleset checks an extraction against a set of EN 16931 and Peppol business rules, for example BR-CO-10: the
invoice line net amounts add up to the stated sum of line net amounts. Each check cites the published rule it comes from.

- It checks that the extracted figures agree with each other and with those rules.
- It does not check that a figure is the one printed on the page, so an extraction that misreads every amount the same way
  passes.
- `node packages/verify/dist/cli.js extract-schema peppol-en16931` prints what an extraction must contain.
- An optional stricter input, the [extraction contract](../../packages/verify/docs/EXTRACTION-CONTRACT.md), carries where
  each value was read and which reader read it; a value two readings disagree on comes back unreadable, never guessed.
- An amount needs its two decimals. A printed figure that was not read is reported as unreadable, and the checks that need
  it say can't tell, naming it.

## Which ruleset version

- **The default under engine 0.6.0 and later is `peppol-en16931@0.3.0`.** A bare `peppol-en16931` or `e-invoice` means it.
- **0.1.0 and 0.2.0 stay selectable,** byte for byte, so the verdicts issued under them keep their ids and replay. A replay
  of such a verdict says how today's default reads the same inputs when that differs ("under today's default
  peppol-en16931@0.3.0 this invoice reads FAIL (currency), not PASS-WITH-OPEN"; `rule_now` in the JSON).
- **To refuse a verdict under an older rule,** replay it with `--require-ruleset 'peppol-en16931@>=0.3.0'`: a verdict
  issued under an older version fails, exit 1.
- What each version checks, its declared accuracy and its misses are in
  [`RULESETS.md`](../../packages/verify/docs/RULESETS.md), in the Peppol sections.

## What has been measured

- **The only e-invoice table labelled blind (by the authors' records) failed its primary bar.** Table `x1-einvoice-pdf`
  ran ruleset 0.1.0 on 60 invoices rendered as PDFs and read back by an extractor: 11 of the 20 planted defects were
  certified PASS. Tier: blind, by the authors' records.
- **Ruleset 0.2.0, the fix, has only post-hoc tables,** scored on those same PDFs. Re-run there, it certified none of the
  20 as PASS: 17 caught, 3 can't tell. Tier: post-hoc.
- **The default, 0.3.0, has no table of its own.** A blind run of the shipping versions, 0.3.0 included, is preregistered
  and has not begun; the [methods page](methods.md#not-yet-measured-the-versions-that-ship-on-unseen-documents) says more.
- Each table, with its interval, is on the [bench page](../../packages/verify/docs/BENCH.md).

## What it does not check

- That a figure is the one printed on the page, when there is no XML (above).
- Who the supplier is, its bank details, or whether the invoice is payable: an e-invoice that is internally consistent and
  matches its own XML passes.
- A national rule set beyond the business rules a ruleset quotes. Every rule a compiled ruleset carries is quoted with its
  source ([`COMPILER.md`](../../packages/verify/docs/COMPILER.md)).

## Read next

- [`RULESETS.md`](../../packages/verify/docs/RULESETS.md): what each Peppol version checks, and how to add a document type.
- [`EXTRACTION-CONTRACT.md`](../../packages/verify/docs/EXTRACTION-CONTRACT.md): the stricter input format.
- [The engineers' page](engineers.md): replay, the hash contract and signing, which apply to every verdict here.
