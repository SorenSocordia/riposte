# Shadow pilot: one closed month of your bills through the AP gate, offline

A shadow pilot is a dry run on bills you have already dealt with. `riposte-pilot` reads one closed month from your AP
system's export and checks every bill against its purchase order and item receipts, and every G702/G703 pay application
against last month's, in **shadow**: nothing is executed. No money moves, nothing is held, and no message or network call goes
out. Every bill and application gets a signed receipt. The report says first what the gate would have cost your team in bills
stopped. It then says how many bills the gate would have paid, held, or sent to a person, how that compares with what your
team did, every hold in words with what would clear it, and the numbers you registered before the run, with their intervals.

## For a controller: what you get, what it costs, what it means

- **The cost to your team, first.** The report opens with how many of the bills your team paid the gate would have stopped,
  sent to a person or held, and how many of the month's bills would have needed someone's attention. Bills your team paid stand
  in for good bills, because the export does not say which payments were right.
- **Every hold in words.** Each hold names the vendor, the amount, what is wrong with the line it is on ("line 2 amount:
  34 × 150.46 = 5115.64, but the line says 5155.21") and what would clear it, starting with who may ("An AP supervisor may
  clear it, for this one only"). The audit sheet carries the vendor, the amount and the discrepancy too.
- **Nothing is executed, and no money moves.** This is a shadow run. Every receipt records `executed: false`. Where a
  shadow receipt uses pay or execute wording, read it as *would have paid* or *would have executed*.
- **What it costs.** [PRICE]
- **What it costs your staff.** Someone maps the export once ([HOW-TO-MAP.md](HOW-TO-MAP.md)), and after the run a person
  labels the audit sample: with the template's examples, 115 rows, about 6 to 12 hours at an assumed 3 to 6 minutes a row
  (not timed). [Choosing the numbers](#choosing-the-numbers-in-plain-terms) says what sample sizes your month supports.
- **You decide who holds the signing key before the run.** The run refuses to start until you choose one of three:
  - `--key <private.pem>` signs with a key your organisation holds. The run writes no private key. For signatures your auditor
    can rely on, keep that key with someone who does not run the pilot and give your auditor its public key or fingerprint
    (`riposte-ledger fingerprint <key.pem>`).
  - `--key-dir <dir>` makes a key for this run and writes its private half in `<dir>`, outside the output folder.
  - `--key-here` makes a key for this run and writes its private half beside the receipts, so one folder holds the whole run.
    Whoever can read that folder can then sign receipts that verify as the run's.

  A key proves the receipts were not edited after signing. Tying a key to a person or a company happens outside this package.
- **What the registered numbers measure, and what they miss.** The template's primary number, hold precision, is the share
  of the bills the gate would have held that a person confirms are real problems. It measures false holds. The co-primary,
  the miss rate, is the share of the bills the gate would have paid automatically that a person finds bad. Each is measured on
  its own audit sample.
- **Pay applications** are checked beside the bills and reported in their own section, outside the registered numbers. See
  [Pay applications](#pay-applications-g702g703).
- **What it does not check** is listed [below](#what-it-does-not-check): vendor identity and bank details, fraud the
  documents agree with, and duplicates outside the export, among others.
- **Which exports it reads** is in [Sources](#sources-and-what-was-verified). [Construction ERPs](#construction-erps) are
  listed one by one, with what is known about each. None of their exports has been read. [HOW-TO-MAP.md](HOW-TO-MAP.md)
  is one page on mapping your own export.

In a source checkout, `riposte-pilot` is `node packages/receipts/dist/pilot-cli.js` and `riposte-ledger` is
`node packages/receipts/dist/ledger-cli.js`.

## The steps

```sh
riposte-pilot prereg init PREREG.md --buyer "Acme" --month 2026-09 --source ramp   # a template: replace every <fill: …>
riposte-pilot prereg freeze PREREG.md                                               # BEFORE the run: hashes it, writes PREREG.md.lock.json
riposte-pilot map --export ./export --month 2026-09                                 # dry run: what is read, what is not, what is missing
riposte-pilot shadow --export ./export --month 2026-09 --prereg PREREG.md --out ./pilot-2026-09 --key-dir ./keys
# a person labels AUDIT-SHEET.csv (issue / no_issue), then:
riposte-pilot report --out ./pilot-2026-09 --prereg PREREG.md --audit ./pilot-2026-09/AUDIT-SHEET.csv
riposte-ledger verify ./pilot-2026-09/receipts.jsonl --key ./pilot-2026-09/run-key.pub.pem --require-signed
# record the ledger head pilot-run.json names somewhere you control; later, add --head <that head> to the line above
```

The template writes each number it asks for without quotes, so you type `0.85` over `<fill: …>`. A number left in quotes
(`"bar": "0.85"`) is refused with the fix: remove the quotes around 0.85.

The template also registers `price_tolerance`: how far a bill's unit price may run over the purchase order's before the check
holds it. It is 0.02 (2%) unless you give `prereg init --price-tolerance 0.05` (or `5%`) or change it before freezing, for
instance to what your contracts allow for a metals surcharge. Every bill of the run is checked under the frozen value, and each
receipt records it (`shadow.price_tolerance`). `shadow --price-tolerance` is optional; if given, it must name the same value,
or the run is refused. A pre-registration written before 2026-10-05 has no such field and runs at 0.02.

It registers `freight` too: what happens to freight billed on a purchase order that does not say whether freight is allowed.
`"person"`, the default, sends each such bill to a person. `"allow"` adds the freight into the bill's total as an allowed
charge. A purchase order that says freight is not allowed is never overridden. Ramp's purchase order has no such field, so
under `"person"` every freighted Ramp bill goes to a person; choose `"allow"` if your purchase orders allow freight unless they
say otherwise. Give `prereg init --freight allow` or change it before freezing. Every bill of the run is checked under the
frozen rule, each receipt records it (`shadow.freight`), and under `"allow"` each verdict's inputs carry it, so a stored proof
replays under it. `shadow --freight` is optional; if given, it must name the same rule, or the run is refused. A
pre-registration written before the field runs under `"person"`.

It registers `tax` too (2026-10-06): what happens to tax billed on a purchase order that states no tax terms. No export
mapping reads a PO's tax terms, so without a rule every taxed bill goes to a person. `"person"`, the default, keeps that.
`"allow"` accepts the tax as billed, and each bill's answer says it was not checked against a rate. `"rate:8.25%"` checks the
tax against that rate on the bill's taxable lines, to the cent (a cent of rounding per taxable line), never within the price
tolerance; a tax off by more goes to a person. A purchase
order that states its tax terms is never overridden. Give `prereg init --tax rate:8.25%` (or `allow`), or change it before
freezing. Every bill of the run is checked under the frozen rule, each receipt records it (`shadow.tax`, written as the flag
writes it), and under `"allow"` or a rate each verdict's inputs carry it, so a stored proof replays under it. `shadow --tax` is
optional; if given, it must name the same rule, or the run is refused. A pre-registration written before the field runs under
`"person"`.

`prereg freeze` warns, in words, when a registered audit sample cannot clear its bar even at its best: "primary.sample_size is
2: even if every one of the 2 audited would-holds is confirmed, the lower bound of the 95% interval is 0.158, under the bar of
0.85, so hold_precision cannot pass with this sample; 23 is the fewest that could". It freezes the file as written; a larger
sample needs a new pre-registration.

Exit codes: 0 done · 1 refused, with the reason · 3 a usage error or an unreadable file.

## What it refuses, and why

- **A run without a key choice** (`--key`, `--key-dir` or `--key-here`), or with more than one. Nothing is written.
- **A column or key it does not read.** Every key in a JSON export and every column in a CSV is either read by the mapper,
  known to the provider's schema and deliberately not read, or **unmapped**. Unmapped keys stop the run and are listed. Check
  each, then acknowledge them with `--ignore-columns a,b` or `--ignore-file <file>` (one per line); the report lists them.
  Pay applications follow the same rule.
- **A missing file or column** the mapper needs.
- **A pre-registration that is not frozen**, changed after freezing, frozen after the run started, or registered for another
  month or source. The report refuses to render without the same frozen file.
- **An output folder that is not empty.** A run never writes over another.
- **A report whose numbers the ledger does not recount**, or a ledger whose chain does not verify. An edited receipt is named:
  `riposte-pilot report` says "BROKEN at entry 25: entry 25 was altered after it was written", as `riposte-ledger verify` does.
- **Text that is not UTF-8** (UTF-16 with a byte-order mark is read). Nothing is guessed about an encoding. Files over
  100 MB, and exports over 100,000 bills, are refused.

## Sources, and what was verified

Field names were checked against each provider's own published schema file. Those files are named, with their sha256, in
`src/pilot/known-fields.ts`.

| `--source` | the export | field or column names | item receipts |
|---|---|---|---|
| `ramp` | `bills*.json`, `purchase_orders*.json`, `item_receipts*.json`: Ramp Developer API resources, as an array or a page `{ data, page }` | **verified** (Bill, ApiBillInventoryLineItem, ApiPurchaseOrderResource, ApiPurchaseOrderLineItem, ApiItemReceiptResource, CurrencyAmount) | Ramp's own |
| `xero` | `Invoices.json` (`{ Invoices: [...] }`, Type ACCPAY), `PurchaseOrders.json` | **verified** (Invoice, LineItem, PurchaseOrder, Contact). The bill's PO is read from `Reference`, which is **not verified** as the field a given company uses | none in Xero: `item_receipts.csv` (below) |
| `qbo` | `Bill.json`, `PurchaseOrder.json` (a query response `{ QueryResponse: { Bill: [...] } }` or an array) | **verified** against Finance.xsd; a bill line names its PO line by `LinkedTxn` `TxnLineId`. `Id` and the other base fields live in IntuitBaseTypes.xsd, **not fetched** | none in QuickBooks Online: `item_receipts.csv` |
| `netsuite-csv` | `bills.csv`, `purchase_orders.csv`, `item_receipts.csv` (saved searches, one row per line) | **UNVERIFIED** (no published spec fetched) | the saved search |
| `xero-csv`, `qbo-csv` | `bills.csv`, `purchase_orders.csv`, `item_receipts.csv` | **UNVERIFIED** | `item_receipts.csv` |
| `generic-csv` | `bills.csv`, `purchase_orders.csv`, `item_receipts.csv`, with this package's own column names (`invoice_number`, `po`, `quantity`, …) or the names a mapping file gives | yours, checked by you ([HOW-TO-MAP.md](HOW-TO-MAP.md)) | `item_receipts.csv` |

`item_receipts.csv`, this package's own format for systems without a goods-receipt object: one row per received line, columns
`receipt_id, purchase_order_number, line_ref, quantity, received_at`, where `line_ref` is the PO line's id or its item code.
Without receipts, every quantity check says can't tell or fails, and the report says so.

**A CSV source's column names** can be replaced with a mapping file (`--mapping mapping.json`):

```json
{ "source": "netsuite-csv", "columns": { "bills": { "invoice_number": "Ref #", "rate": "Unit Rate" } },
  "status": { "pay": ["Paid In Full"], "hold": ["Rejected"] }, "ignore": ["Department"] }
```

A field the mapper does not read, or an unknown key in the file, is refused.

**Your own decision** is read from the export's status fields, which is this package's reading of each provider's documented
values. Ramp: `status` PAID or `status_summary` PAYMENT_COMPLETED is paid; `status_summary` ON_HOLD, APPROVAL_REJECTED or BLOCKED,
or `approval_status` REJECTED, is held; anything else is open. Xero: `Status` PAID is paid; VOIDED or DELETED is held. QuickBooks
Online: `Balance` 0 is paid; the Bill entity has no hold status. CSV sources: the `status` values in the preset or mapping file.
The report names the field each decision came from. Open bills are not compared.

## Construction ERPs

No construction ERP export has been read by this package. For each system, here is what is known. `riposte-pilot mappings`
prints the same list.

| system | status |
|---|---|
| Viewpoint Vista (Trimble) | **Mapping drafted from published column names; not verified on a real export.** The names are the field names of Trimble App Xchange's Vista Accounts Payable v2 and Purchase Order v2 API specifications (views APUI/APUL, POHD/POIT, PORD), read 2026-10-05. They are not Vista's own import template. `riposte-pilot mappings --erp vista --out mapping.json` writes the draft. |
| QuickBooks Desktop (Intuit) | Published IIF headers read (Intuit's bill, purchase order and item receipt sample files). **No mapping drafted**: the published bill layout carries no purchase-order link and no item or unit price on its lines, so a bill cannot be matched to its PO from it. Not verified on a real export. |
| Sage 300 Construction and Real Estate | **No published column list found** (the vendor's knowledgebase is behind a sign-in). Not drafted. Not verified on a real export. |
| Viewpoint Spectrum (Trimble) | **No published column list found** (its Data Exchange field layouts are behind a captcha on the vendor's help site). Not drafted. Not verified on a real export. |
| Foundation Software | **No published column list found** (the public site has no import or export layout). Not drafted. Not verified on a real export. |

For any of them, the way in is a CSV export of your bills, purchase orders and receipts, read through `--source generic-csv`
and a mapping file you check against your own file. [HOW-TO-MAP.md](HOW-TO-MAP.md) is one page on doing that.
`riposte-pilot map` lists what it reads, what it does not, and what is missing, and executes nothing. The Vista draft reads
ECM and CurECM as the price unit, turning rates per hundred and per thousand into a price per unit (wire priced per thousand
feet is checked per foot), and UM as the unit of measure; a price unit that is not E, C or M, or a bill line in another unit
than its PO line, sends the bill to a person, naming it. Its notes are written into the mapping file and print when you write
it: the price units, the amounts left unmapped on purpose (retainage, tax, discounts), duplicated column names, no paid or held
status, and when Vista's invoiced units per PO line may be mapped. Every dry run reads them out again.

## How each bill is checked

Each bill becomes the structured AP input (`riposte.ap-input/0.1.0`; packages/verify docs/AP-INPUT.md) with its PO, the PO's
item receipts received by the end of the month, and, as payment history, the bills of the same export you paid before it (the
duplicate check and the PO balance check). Each history row names the order the paid bill was booked against, or says it was
booked without one. For the month's first bills that history is empty, and the checks run against it.

The PO balance check nets what those earlier bills already charged to the same order. When billed to date would pass the
order's total, the bill goes to a person, and the words name each earlier bill, its amount and the order's total. The history
carries amounts, not lines, so it nets amounts on the order, not quantities on a line (packages/verify docs/AP-INPUT.md,
"The PO balance check"). When an earlier bill is booked on the bill's order, the bill's `not_checked` says so, naming it.
From 2026-10-06 a CSV export can close that gap: give the purchase-order file an `invoiced_quantity` column, each PO line's
quantity invoiced before the month (job-cost ERPs keep it). Each bill is then netted line by line against that figure plus the
earlier bills of the month on the line (a bill your status column marks held is left out), and a second bill that would take a
line past what was received goes to a person: "billed to date would be 54 against 40 received: 24 invoiced earlier on PO line
1, 30 on this bill" (HOW-TO-MAP.md).

Every bill the gate would pay says what it did not check, under "Not checked" in its answer: how the vendor was matched and
that who sent the bill was not checked, that the bank details are not on the inputs, and tax where the PO states no tax terms.

Three more checks run on every bill (packages/verify docs/AP-INPUT.md):

- **The vendor check.** The bill's vendor is compared with the vendor its PO names, by tax id, then vendor id (Ramp: the bill's
  `vendor.id` against the PO's `vendor_id`), then the name. Another vendor, a name that only looks alike, or two vendor
  records under one name goes to a person, and the words name both vendors. A PO that names no vendor is not compared, and the
  bill's record says so.
- **The tax check.** A bill that carries tax is checked against the tax rate its PO states. No export mapping reads a PO's tax
  terms today, so the frozen `tax` rule (above) decides: a person by default, accepted as billed under `"allow"`, or checked
  against the registered rate. On a Ramp export, which has no tax field, one expense line with no PO line whose whole memo is
  a tax's name ("Sales tax", "Sales & use tax", "VAT"; never a memo that only mentions tax) is read as the bill's tax
  (from 2026-10-06), and the rule decides it. Any other expense line matches no PO line, and the bill goes to a person for it.
- **The freight rule.** Freight on a PO that does not say is decided by the frozen `freight` (above). On a Ramp export, one
  expense line with no PO line whose whole memo is a freight charge's name ("Freight", "Shipping & handling", "Delivery
  charge"; never a memo that only mentions one, such as "Shipping container rental") is read as the bill's freight,
  and the dry run's notes count those bills. Several such lines stay lines, and the bill goes to a person, naming each.
- **Which rows are one bill (CSV exports).** A CSV row is one line of a bill; the mapped `ref` column says which rows are one
  bill. With no `ref`, rows are one bill only when they share the invoice number, the bill date and the vendor as written:
  two bills under one invoice number on two dates, or under two spellings of the vendor, are read as two bills, and the dry
  run's notes say so ("8 rows, 6 bills; GCS-20417 has rows on two dates under two vendor names"). The report's count of bills
  your team paid is the export's, and the second bill of a paid duplicate is held as a duplicate. HOW-TO-MAP.md says how to
  map `ref`.

The gate is run on your own
decision (paid is "approve", held is "hold"; an open bill on "approve", and its receipt says so). The disposition is the
checker's, read fail-closed:

- an approve with every check run would **pay**;
- an approve beside a check that could not run goes **to a person**;
- a hold reason would **hold**, with typed remedies;
- can't tell goes **to a person**.

A bill that cannot be put together (no PO linked, its PO not in the export, values the schema refuses) is not checked; it is
listed with the reason and counted as to a person.

Each receipt's first field is the disposition the report counts: `disposition` is `pay`, `hold` or `person`. The two
fields after it say the same thing in words: `action` is `WOULD_EXECUTE` (pay or hold) or `WOULD_REVIEW` (a person), and
`effect` is `WOULD_PAY`, `WOULD_HOLD` or `WOULD_REVIEW`. Then come `executed: false` and `mode: "shadow"`. The receipt's
`shadow` block repeats the disposition, and `riposte-pilot report` refuses to render over a receipt whose first field and
`shadow` block disagree. A bill that could not be checked, and each pay application, says its disposition first too. A
shadow receipt never says `EXECUTE` or `PAY`.

What the live gate would have done with your own decision is a different question, kept apart under
`shadow.on_buyer_decision`. When the checker agrees with your decision, the live gate would have carried it out
(`WOULD_EXECUTE`). When it disagrees, the live gate would have sent your decision to a person (`WOULD_REVIEW`), and the
words say both readings. For example, you paid a bill, and the checker found it a duplicate: the disposition is `hold`, and
the live gate would have sent your payment to a person. The report counts the disposition.

Receipts written before 2026-10-05 put the live gate's reading at the top level and the disposition only inside the
`shadow` block, so on some of them the top level and the report differ. `riposte-pilot report` counts the `shadow` block on
every receipt, old or new, and `riposte-ledger verify` checks the chain and the signatures of both shapes.

## Pay applications (G702/G703)

Put a folder `pay_applications/` inside the export folder, with one JSON file per application in the shape of packages/verify
`docs/examples/payapp-g702-g703.json`. Include last month's application of each contract too. Your decision on each, if you
want it compared, goes in `pay_applications/decisions.csv` (columns `file,decision`, decision `paid`, `held` or `open`).

- An application whose `period_to` falls in the month is checked with the pay-app ruleset: each G703 line's math, the G702
  summary, retainage, and continuity with last month. Continuity (from 2026-10-06):
  - each line's "previous" (column D) is last month's work for the item, read either way the form is filled in: last month's
    "completed to date" (column G, stored materials included), or last month's D + E, the form's own heading for column D
    ("from previous application (D + E)"), where stored materials move to this period when installed. Either reconciles, and the
    console names the reading; neither is a FAIL;
  - each line's scheduled value (column C) is last month's, unless a change order the application states accounts for the
    change (`change_orders: [{ "number", "amount", "item_no" }]`, or `change_order_amount` on the line); otherwise a person
    decides, naming the line and the difference, and the owner may clear it;
  - a line new this month is read as a change order when net change orders (line 2) rose by its scheduled value (the console
    says so, and that the owner's approval is not checked); otherwise a person decides: "line 8 is new this month (item 8,
    scheduled value 8,000); net change orders did not change, at 18,500: confirm it is a change order";
  - a line the application itself marks unapproved, and that bills work to date, goes to a person, the owner clearing it:
    its description says "pending owner approval", "unapproved", "not approved", "awaiting approval", "subject to approval",
    "proposed", "unsigned", "not executed", "disputed" or "rejected", or carries PCO or COR; or a `status` field says so; or
    `approved` is false. So does a raised scheduled value that only a change order marked unapproved accounts for. "Line 8 is
    marked unapproved ("pending owner approval" in its description, ...) and bills 11,000 to date: a change the owner has not
    approved is not payable on this application";
  - the original contract sum (line 1) is last month's, and line 7 equals last month's line 6.
- Retainage: the stated rate applies (from 2026-10-05). A line may retain less only where the application says so: the line
  states its own rate (`retainage_rate` on the schedule line), the application states a reduced rate for the period
  (`reduced_retainage_rate`, with `reduced_retainage_items` naming the lines it covers), or the line is complete and its
  column I shows the lower retainage while another line with work still retains at the stated rate. Such a reduction passes,
  and the console names each line and the dollars. Anything else under the stated rate goes to a person, leading with the
  difference ("13,741.25 less retained than the stated 10% ..."); the owner may clear it. Uniform under-withholding, every
  line at 5% against a stated 10%, is a person's decision. With no rate on the application, last month's stated rate applies;
  with none on either, the lines' own retainage is read and each line's rate listed. Retaining more than the rate still
  fails.
- Retainage split by the form's own lines 5a and 5b, one rate on completed work and another on stored material: state it as
  `retainage_rate: { "completed_work": "10%", "stored_materials": "0%" }`. Line 5 is then the work rate on line 4 less the
  stored materials of column F, plus the stored rate on column F; at it, the check passes and names both parts; above it, it
  fails; under it, a person decides. A rate given as any other object, or as an array, on the application, a line or as the
  reduced rate, is refused by name (exit 3), never read as "no rate".
- Last month's application is the one with the same project and contractor and the application number one lower. Without
  it, the continuity checks cannot run, and the application goes to a person, saying so.
- Exactly PASS would pay. FAIL would hold, with what would clear it, for instance the certifier (the architect, on AIA G702).
  Anything else goes to a person.
- Each checked application gets a `pay_app_check` receipt, which holds hashes only. The report has its own section for them,
  and they are not part of the pre-registered numbers, which count bills.

## The pre-registered numbers

The template's primary is **hold_precision**: of the bills the gate would have held, the share a person confirms is a real
problem. It is measured on a random sample drawn after the run from a seed nobody picks by hand: the sha256 of the
pre-registration's hash and the ledger head before the draw, recorded on the ledger. It is reported with its exact
(Clopper-Pearson) interval, the range the true share plausibly lies in given how many bills were audited, and
judged by the rule fixed in the pre-registration: the lower bound at or above the bar passes, the upper bound below it fails,
anything else is inconclusive. `agreement` and `coverage` may be registered as primary instead. Until a person labels the audit
sheet, the report says the number is not measured.

The template also registers a **co-primary, `miss_rate`**: of the bills the gate would have paid automatically, the share a
person confirms is a bad bill. hold_precision alone measures false holds. It says nothing about bad bills the gate would have
paid, which is the failure that costs money. Your pre-registration holds your parameters and the rules they are judged by.

The miss rate is measured on a second sample, of would-pays, drawn the same way with its own seed; those rows are marked
`would-pay` on the same audit sheet. Lower is better: the upper bound at or below the bar passes, the lower bound above it
fails. With both registered, the pilot passes only when both pass. With no bad bill found, 75 audited would-pays is about the
fewest whose 95% upper bound falls under 0.05. A pre-registration without the `co_primary` block (all of them before
2026-10-05) still freezes and runs, with hold_precision alone.

### Choosing the numbers, in plain terms

You can keep the template's examples: a precision bar of 0.85 with 40 audited would-holds, and a miss-rate bar of 0.05 with
75 audited would-pays. This is what they mean, computed with the report's own exact 95% interval:

| registered | passes when | smallest sample that can pass |
|---|---|---|
| hold precision, bar 0.85, 40 audited | at least 39 of the 40 are real problems (38 reads inconclusive, not fail) | 23, with every one real |
| miss rate, bar 0.05, 75 audited | none of the 75 is a bad bill | 72 with none bad; 110 if one bad bill is found |

- **Other bars.** Hold precision at 0.80 needs at least 17 audited, at 0.90 at least 36, each with every one real. A miss
  rate of 0.10 needs at least 36 audited would-pays with none bad, and 0.03 at least 122.
- **Your month's size.** The draw cannot audit more bills than the gate would hold or pay. With fewer would-holds than the
  sample, every one is audited; with fewer than 23, hold precision at 0.85 cannot pass and reads inconclusive, which is a
  result about the sample, not about the gate. The gate's hold rate on real bills has not been measured, so a month of a
  few hundred bills is the safe size for these numbers: it needs at least 75 bills the gate would pay and, for the
  template's example, 40 it would hold. `prereg freeze` warns when a sample cannot clear its bar even at its best.
- **The labelling cost.** A person marks each audited row `issue` or `no_issue` against the bill, its purchase order and its
  receipts. It has not been timed. At an assumed 3 to 6 minutes a row, the template's 115 rows (40 + 75) take one person
  about 6 to 12 hours.

## Data handling

| file in the output folder | what it holds |
|---|---|
| `receipts.jsonl` (+ `.head.json`) | one signed, hash-chained receipt per bill and per pay application: each document's sha256 and length, the verdict's hash, rule ids, outcomes, JSON Pointers, typed remedies without their wording, your decision, the disposition, `executed: false`. **No document values**, in every mode. |
| `pilot-run.json`, `PILOT-REPORT.md`, `AUDIT-SHEET.csv` | by default, **in words**: the export's record ids, invoice numbers, vendors, bill totals, your decisions, and what each check found and what would clear it, which can quote line descriptions and amounts. With `--hashes-only`: record ids, invoice numbers, bill totals, your decisions and rule ids, nothing else from the documents |
| `run-key.pem`, `run-key.pub.pem` | the key made for this run: with `--key-here` both are here; with `--key-dir`, only the public half; with `--key`, neither |
| `documents/`, `proofs/` | **only with `--store-documents`**, for your own retention: each bill's structured input and its proof, which replays bound to its receipt (`riposte-replay --ledger receipts.jsonl --proof <proof>`), and each pay application with the previous one |

- The report, the run record and the audit sheet are your working files, and they stay on your machine. If they must not
  carry vendor names or document wording, for instance to share with someone outside AP, run with `--hashes-only`.
- **Who holds the signing key.** The run's output, its manifest and PILOT-REPORT.md each say. With `--key-here`, move
  `run-key.pem` somewhere only you control, or delete it once the run is checked. `riposte-ledger verify receipts.jsonl --key
  run-key.pub.pem` refuses any receipt not signed by the run's key, and any receipt edited, reordered or removed from the
  middle.
- **Receipts cut from the end.** A key does not catch them: the receipts left are still signed. `riposte-ledger verify`
  reads `receipts.jsonl.head.json`, which the run writes beside the receipts, and refuses a file shorter than it says. Whoever
  can rewrite the receipts can rewrite that file too, so record the run's head (`ledger.head` in `pilot-run.json`, also in
  the report) somewhere you control, and verify with `--head <that head>`. That catches a cut or a rewrite by anyone.
- Everything stays on your machine: the run is offline and makes no network call.
- `riposte-pilot purge --out <dir>` deletes `documents/` and `proofs/` and leaves the hashes.
- Without `--store-documents` (the default), a receipt alone cannot be re-performed, because no proof is kept.
- The audit sheet is written with every cell that a spreadsheet would read as a formula (`= + - @`) prefixed with `'`.

## What it does not check

Vendor identity and bank details (the bill's vendor is compared with the vendor its PO names, and a different one goes to a
person; a vendor both documents agree on is taken as given), fraud the documents agree with, contract terms beyond the PO
price, tax rules beyond the PO's stated rate or the frozen tax rule (no export mapping reads a PO's tax terms; on a Ramp export
only one expense line whose whole memo names a tax is read as the bill's tax), approval policy, bills without a PO, timing beyond "received by the end of the
month", duplicates outside the export, and why you held or paid a bill. Quantities billed against one PO line across several
bills, unless the export carries `invoiced_quantity` per PO line: the payment history carries amounts, not lines, so earlier
bills are netted against the order's total, not against each line, and tax or freight inside an earlier bill's amount counts
against the order too. For pay applications: whether the work was done or the percent complete is true, lien waivers, whether
the owner approved a change order (a new line net change orders account for, or a stated change order, is taken as given),
and whether a lower retainage is allowed by the contract (retainage
withheld under the stated rate goes to a person unless the application says where: a line's own rate, a reduced rate it
states, or a complete line beside lines still at the rate; a stated reduction is taken as given). The report repeats this list.

## A synthetic dry run

`riposte-pilot synth --out <dir> --month 2026-09 --bills 300 --seed 11 --pay-apps 8` writes the month into `<dir>/export/`
(give that folder to `map` and `shadow` as `--export`) and its truth file to `<dir>/synthetic-truth.json`. The month is in
Ramp's export shapes, with planted mismatches: price, quantity, line arithmetic, total, a repeat of a paid bill, a line never
received, no PO, another currency. With `--pay-apps 8` it also writes last month's and this month's G702/G703 for 8
contracts, about half of this month's with a planted error: a shifted "previous", a payment due off by $1,000, or a line billed
past its scheduled value. Nothing in it is real, and a number from it is never a result. `--format generic-csv` writes the same
month in this package's own CSV columns (`bills.csv`, `purchase_orders.csv`, `item_receipts.csv`; shadow it with `--source
generic-csv`), with each PO line's `invoiced_quantity`, so the billed-to-date check can net a line across bills.

Those classes are the ones the gate was built to check, so a perfect score on them is a mirror. The month also carries
classes the earlier checks never looked at, appended after the bills above (so the rest of the month is unchanged), about
one bill per class per 100 bills, at least one each. That is why a month asked for 300 bills holds 327:

- **another vendor** (`vendor_mismatch`): a bill from a vendor other than the one its PO names, billing exactly what was
  ordered and received. The right answer is a person decides.
- **tax on an untaxed PO** (`tax_on_untaxed_po`): a "Sales tax" line on a PO with no tax terms. A person decides under the
  default tax rule. The truth file states each tax rule's answer (`by_tax_rule`), and the score reads the run's rule: under
  `"allow"` the gate pays it, and under `"rate:8.25%"` it pays only when the tax is 8.25% of the lines to the cent (one cent
  of rounding per taxable line), as the gate checks it, never within the price tolerance.
- **tax at the rate, and off it** (`tax_at_rate`, `tax_off_rate`): the same kind of bill with tax at exactly 8.25% of the
  lines, or at 9.5%. A person decides under the default tax rule; under `"allow"` both pay; under `"rate:8.25%"` the first
  pays and the second goes to a person.
- **a re-sent invoice number with a leading zero** (`duplicate_leading_zero`): a paid bill sent again with a zero after its
  number's prefix ("NOR-010345" for "NOR-10345"), same vendor, PO, lines and total. The right answer is not to pay it: a
  person confirms it (an AP clerk may clear it), or a hold.
- **freight the PO does not mention** (`freight_po_silent`): a "Freight" line on a PO that does not say whether freight is
  allowed. A person decides under the default freight rule; a run whose pre-registration froze `"freight": "allow"` pays
  it, and the score reads the run's rule.
- **a PO line billed again** (`line_overbilled_across_bills`): an earlier bill, paid, billed all of one PO line; this bill
  bills part of the same line again while the order as a whole still has room. That is over-billing, so the right answer is
  a hold. In Ramp's shapes the check states this gap (below): with no quantity invoiced per PO line, it nets amounts on the
  order, not quantities on a line. The truth file says so, and the score marks a bill of this class the gate would pay as
  that gap. In a `--format generic-csv` month each PO line carries `invoiced_quantity`, the billed-to-date check nets the
  line, a person decides, and the truth file names no gap.
- with `--pay-apps`, one more contract per 8 (at least one), **retainage under the stated rate**
  (`payapp_retainage_under`): this month's application states 10% and every line withholds 5%, with the totals carried
  through, so only the stated rate shows it. A person decides.
- with `--pay-apps`, three more contracts, one each: **a scheduled value raised** (`payapp_sov_raised`): one line's
  scheduled value and the net change orders rise by the same amount, with no change-order line and no change order stated,
  so a person (the owner) decides; and two **legitimate** applications the gate must pay: **a new change-order line**
  (`payapp_new_co_line`), the net change orders up by its scheduled value, and **stored materials installed**
  (`payapp_stored_formD`), last month's stored materials installed this month with column D written as the form's heading
  says (last month's D + E).

Not planted: a request to change bank details and a sender writing from a look-alike of the vendor's domain. Only the emailed
bill (`ap` on its text) carries them; an export's bills have no free text for payment instructions, and the approve says the
bank details were not checked.

Ramp's bill has no tax or freight field, so the month carries tax and freight as Ramp does: an expense line
(`Bill.line_items`) with no PO line, beside the inventory lines. The mapper reads both kinds of line. One expense line whose
whole memo names a freight charge ("Freight", "Shipping & handling" and the like) is the bill's freight, and the freight rule
decides it. One whose whole memo names a tax ("Sales tax" and the like) is the bill's tax, and the tax rule decides it (from
2026-10-06). Any other expense line matches no PO line, so the check sends the bill to a person and names the line. In a
`--format generic-csv` month the tax is the bill's `tax` column, and a freight charge, which those columns have no field for,
is a bill line no PO line matches, so a person decides it under either freight rule; the truth file says so.

The planted repeats come in three kinds, each labelled in the truth file with the bill it repeats and both vendor records:

- **plain** (`duplicate`): the same vendor record;
- **vendor-name variants** (`duplicate_vendor_variant`): a second vendor record whose name reads "…, Inc.", "… LLC", or differs
  in punctuation;
- **near matches** (`duplicate_near_match`): a second vendor record whose name is a one-letter typo ("Caldre Fastener
  Supply" for "Calder Fastener Supply"), has one word abbreviated ("Linden Elec. Wholesale"), or is a d/b/a name ("Northfield
  d/b/a NMH" for "Northfield Material Handling"). Half of them repeat the original's PO and total. The other half bill their
  own PO, lines and total, which check out on their own, so only the duplicate check can stop them. The right answer is to
  hold it as a duplicate or send it to a person, clearable only by the controller.

`riposte-pilot score --out <run dir> --truth <synthetic-truth.json>` counts a synthetic run against its truth file. It states
the labour cost first: how many clean bills would have gone to a person or been held. Then, per planted class, it gives what a
correct check says and what the gate would have done, with any planted bill it would pay marked. For the near-match class it
also gives the lowest role that may clear each bill, and counts each kind apart (typo, abbreviation, d/b/a, each with or
without its own PO and total). Pay applications are scored the same way; a legitimate class that pays is right, and one held
or sent to a person counts with the clean applications as a good application stopped. Its second line sorts the report's first figure, "the gate would have stopped N
of the bills your team paid", by the truth file: how many of those N are planted problems the synthetic team paid by
mistake, and how many are clean bills.
