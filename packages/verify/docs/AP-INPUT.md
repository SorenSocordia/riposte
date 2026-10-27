# Structured AP input: the manual (riposte.ap-input/0.1.0)

The AP three-way match can read structured data instead of three texts: a bill, its purchase order and its item receipts as
JSON, the shape an ERP or a spend platform already holds. The verdict is issued under ruleset `ap-structured@0.1.0`; the text
path (`ap-threeway`, an emailed bill with its PO and goods receipt pasted under it) runs the same checks. This page is the
manual: what to send, the checks in the order they run, and what each one reads, answers, and lets whom clear. What changed
and when is in [`CHANGELOG.md`](../CHANGELOG.md).

Three-way matching is not new: ERPs have matched bills to orders and receipts, and held the exceptions, for decades. What this
adds is the proof. Every check is a claim with its rule, its operands and JSON Pointers to the fields it read, with typed
remedies on anything that did not pass, and anyone who holds the verdict and its inputs can re-perform it.

- Schema (JSON Schema draft 2020-12): [`ap-input.schema.json`](ap-input.schema.json), also `AP_INPUT_SCHEMA` in the library.
- Library: `validateApInput(x)` returns typed errors; `verifyBillMatch(x)` returns the same result shape as the text path.
- CLI: `node packages/verify/dist/cli.js ap --input bill.json`, from the repository root, prints the result and its
  replayable proof. Installed as a package, the same program is `riposte-verify`.
- Gate: `apGate(decision, input)` in packages/receipts takes structured input.

## What to send

```json
{
  "schema": "riposte.ap-input/0.1.0",
  "bill": {
    "invoice_number": "NM-84665",
    "vendor": { "name": "Northfield Material Handling" },
    "purchase_order_number": "PO-48825",
    "currency": "USD",
    "amount": { "amount": 269500, "currency_code": "USD" },
    "line_items": [
      { "purchase_order_line_item_id": "pol-1", "quantity": 5,  "unit_price": "47.30", "amount": "236.50" },
      { "purchase_order_line_item_id": "pol-2", "quantity": 10, "unit_price": "14.25", "amount": "142.50" },
      { "purchase_order_line_item_id": "pol-3", "quantity": 24, "unit_price": "96.50", "amount": "2316.00" }
    ]
  },
  "purchase_order": {
    "id": "po-1",
    "purchase_order_number": "PO-48825",
    "vendor": { "name": "Northfield Material Handling" },
    "currency": "USD",
    "freight_allowed": false,
    "line_items": [
      { "id": "pol-1", "description": "Extension cord 50 ft, 12 AWG", "quantity": 5,  "unit_price": "47.30" },
      { "id": "pol-2", "description": "Floor marking tape, yellow",   "quantity": 10, "unit_price": "14.25" },
      { "id": "pol-3", "description": "Wire shelving unit 48 in",     "quantity": 24, "unit_price": "96.50" }
    ]
  },
  "item_receipts": [
    { "purchase_order_id": "po-1", "line_items": [
      { "purchase_order_line_item_id": "pol-1", "quantity": 5 },
      { "purchase_order_line_item_id": "pol-2", "quantity": 10 },
      { "purchase_order_line_item_id": "pol-3", "quantity": 24 }
    ] }
  ],
  "decision": { "action": "pay", "confidence": 0.97 }
}
```

- **`payment_history`** (optional; invoices already booked) turns on the duplicate check and the PO balance check:

  ```json
  "payment_history": [
    { "invoice_number": "NM-84102", "vendor": "Northfield Material Handling", "purchase_order_number": "PO-48825",
      "amount": "1180.00", "paid_at": "2026-09-12" }
  ]
  ```

  `invoice_number` is required. `vendor` is the vendor's name as it was booked; `vendor_id` and `vendor_tax_id` are optional,
  and the duplicate check compares them first when the bill carries them too. `purchase_order_number` and `amount` let the PO
  balance check count the row. A row booked without a purchase order says `"no_purchase_order": true` and is not counted
  against any order. `"payment_history": []` says nothing is booked yet.
- **Optional fields the checks read:** `bill.tax`, `bill.freight`, `purchase_order.tax_rate` (a fraction: 0.0825 is 8.25%;
  a bare 8.25 is refused), `purchase_order.line_items[].taxable` (`false` leaves a line out of the taxable base),
  `purchase_order.freight_allowed`, `purchase_order.line_items[].invoiced_quantity_to_date` (the quantity **earlier** bills
  invoiced on that PO line, not counting this one), and tax ids and vendor ids on `bill.vendor`, `purchase_order.vendor` and
  the history rows.
- **`decision`** (optional) is the model's decision the gate checks. It is never part of the verdict: the same documents give
  the same verdict id whatever the model said.

## Running it

```sh
node packages/verify/dist/cli.js ap --input bill.json    # exit 0 approve · 1 hold · 2 a person decides (abstain; also a bill with no payment_history) · 3 input that does not validate
node packages/verify/dist/cli.js ap --input bill.json --price-tolerance 0.05   # a 5% price tolerance, bound into the verdict
node packages/verify/dist/cli.js ap --input bill.json --freight allow          # freight on a PO that does not say is added to the total
node packages/verify/dist/cli.js ap --input bill.json --tax rate:8.25%         # tax on a PO that states no tax terms, checked at 8.25%
node packages/verify/dist/cli.js ap --input bill.json > result.json
node packages/verify/dist/cli.js replay result.json      # replays the file's "proof" member ({ verdict, inputs }) and says so
```

`ap --input` prints the verdict and its inputs as the `proof` member of its output, and `replay` re-performs that member. A
file whose top-level verdict is not its `proof` member's verdict (changed after `ap --input` wrote it) is refused, exit 1. A
shadow-pilot receipt holds hashes, not documents, so a receipt made without `--store-documents` (the default) cannot be
re-performed on its own (packages/receipts PILOT.md, "Data handling").

Its decision, `payable`, `grounding`, `reasons` and `not_checked` (and `exit` and `allow_open`, with `--allow-open`) are derived
again from the re-performed verdict, and a field that differs, or a key `ap` never writes, fails the replay, exit 1, with or
without `--strict` (REPLAY.md, "The decision beside an AP verdict"). The same holds for the output of `ap` on an emailed bill.

On the text path (`ap <layout.txt>`, or `--invoice`, `--po` and `--receipt` as separate files), `--history <file>` is the same
book as a JSON array of `{ invoice_number, po_number?, total?, vendor?, vendor_id?, vendor_tax_id?, paid_on?, sender? }`.
`sender` is the address the booked bill came from; it puts the vendor's domain on file for the vendor check when the PO
names none (check 8). `--history -` reads it from stdin; only one input can come from stdin in one run.

Every `ap` answer names the path the bill came through on its own labelled line, after the headline (`verify ap: APPROVE ·
verdict PASS: ...`, whose shape scripts parse and which is unchanged): `read from: emailed text` or `read from: structured
input`. The structured input path is the product. The emailed-text path is a convenience with a documented limit, and
every approve names which path read the bill: an emailed-text approve says so last, under "Not checked".

**Replaying an emailed bill.** The text path's JSON carries the verdict and, as its `read` member, the sha256 of the text it
read (`text_sha256`, or `invoice_sha256`, `po_sha256` and `receipt_sha256` for three files), the sha256 of the payment
history (`history_sha256`, or null when none was given) and the policy the verdict was made under. It never carries the
documents. The replay takes the same files:

```sh
node packages/verify/dist/cli.js ap bill.txt --history history.json > result.json
node packages/verify/dist/cli.js replay result.json --source bill.txt --history history.json   # exit 0: re-performed, byte-identical
node packages/verify/dist/cli.js replay result.json --invoice inv.txt --po po.txt --receipt gr.txt --history history.json   # read from three files
```

A file left out is named, exit 3 ("this call leaves out --history"). A file that is not the one the result was read from is
a failed replay, exit 1, before any hash is compared ("--source bill.txt is not the text this result was read from").
`--history` on a result read without one is refused, exit 3. A result written before the text path recorded `read` is
re-performed under the default policy when its files are given; with none, the replay says which files would re-perform it,
exit 2.

## The checks, in the order they run

Every check runs, and every result stays in the verdict. The bill's decision comes from the first check, in this order, that
holds (a hold) or cannot decide (a person decides).

| # | claim (rule) | reads | answers | who may clear it | tolerance |
|---|---|---|---|---|---|
| 1 | `ap.duplicate` (AP_DUPLICATE) | the bill's number and vendor against `payment_history` | pass; `hold_duplicate`; or a person decides | the controller (a hold); a clerk (a person) | names compared without case, spacing, punctuation or a company suffix; look-alike rules below |
| 2 | `ap.po_number` (AP_PO_MATCH) | `bill.purchase_order_number`, `purchase_order.purchase_order_number` | pass or `hold_no_po` | the buyer | exact, after trimming |
| 3 | `ap.line[L].quantity` (AP_QTY_RECEIVED) | each bill line's quantity; every item-receipt line for its PO line; on the text path, a bill line that matches no PO line or does not name its item is `ap.bill_line[n].*` | pass or `hold_quantity`; a person decides on an unmatched line | the buyer | none: billed ≤ received |
| 4 | `ap.line[L].price` (AP_PRICE_PO) | each bill line's unit price; the PO line's | pass or `hold_price` | the buyer | 2% over the PO price unless set (`--price-tolerance`) |
| 5 | `ap.line[L].amount` (AP_LINE_MATH) | quantity, unit price and the stated line amount | pass or `hold_line_math` | an AP supervisor | one minor unit (a cent) |
| 6 | `ap.total` (AP_TOTAL_SUM) | the bill's stated amount, its lines, freight, tax | pass or `hold_total` | an AP supervisor | half a cent |
| 7 | `ap.remittance` (AP_REMITTANCE) | each sentence and each line of the emailed bill (text path only) | a person decides, when a sentence is an instruction about where payment goes, announces a change of a payment detail or promises payment instructions, or a line matches a payment-redirection phrasing | the controller | the sentence reading, the announced-change reading and the 25 phrasings listed under check 7; a wording the reading does not parse is not caught |
| 8 | `ap.vendor` (AP_VENDOR_MATCH) | `bill.vendor` against `purchase_order.vendor`; on the text path, the sender, the vendor's domain on file and the invoice text | pass, or a person decides | the controller | as the duplicate check compares vendors; senders by the domain rules under check 8 |
| 9 | `ap.tax` (AP_TAX) | `bill.tax`, `purchase_order.tax_rate`, taxable lines; on the text path, a tax line and the rate the PO block states | pass, a person decides, or `hold_total` on a stated rate of 0 | the buyer | to the cent: one minor unit per taxable line for rounding, never the price tolerance |
| 10 | `ap.line[L].billed_to_date` (AP_QTY_TO_DATE) | `invoiced_quantity_to_date`, this bill's quantity, what was received | pass, or a person decides | the buyer | none |
| 11 | `ap.po_balance` (AP_PO_BALANCE) | the booked rows on this order, this bill's lines, the order's total | pass, or a person decides | the buyer; a clerk for a row it cannot count | half a cent |

`L` is the PO line's 1-based position in `purchase_order.line_items`. Checks 7, 9 and 10 exist only when their input does:
a text bill with such a sentence or line, a bill that carries tax (`tax` on structured input, a tax line on the text path), a
PO line that carries `invoiced_quantity_to_date`. Checks 1 and 11 run only with a payment history.

### 1. Duplicate (`ap.duplicate`)

A vendor can sit in the books under two names, such as "Northfield Material Handling" and "Northfield Material Handling,
Inc.", or under two vendor records. That is the usual way a duplicate gets paid, so the check compares vendors by the
strongest evidence both sides carry:

- **Tax id first.** If the bill's vendor (`bill.vendor.tax_id` or `purchase_order.vendor.tax_id`) and the booked row
  (`payment_history[].vendor_tax_id`) both carry one, equal ids are one supplier. Spaces, hyphens, periods and slashes are
  ignored. Different ids under matching names go to a person.
- **Then vendor id.** If the bill or PO carries a `vendor.id` and the row carries `vendor_id`, equal ids are one supplier.
  Different ids under matching names are treated as two records for one supplier, and the bill is held.
- **Then the name.** Case, spacing, punctuation, "&" against "and", and a trailing company suffix (Inc, Incorporated, LLC,
  Ltd, Limited, Co, Company, Corp, Corporation, GmbH, SA, PLC, LLP, LP) are ignored. A row with no vendor name counts as the
  same vendor.
- **Names that look alike.** Two names that are not the same after the step above still count as a near match when one of
  these holds:
  - **a typo:** the names differ by one character (the longer name, as compared, of 6 to 15 characters), two (16 to 31) or
    three (32 or more). Shorter names must match exactly. A character is inserted, dropped, changed, or two neighbours swap.
    "Sumit Electrical Supply" against "Summit Electrical Supply" is one character.
  - **an abbreviation:** the same words in the same order, at least one equal, and each other word a listed contraction of
    its partner (Mfg, Mfr, Mfrs, Svc, Svcs, Intl, Natl, Bros, Assn, Ctr, Mgmt, Mgt, Plbg, Whse, Whsl, Whsle, Eqpt, Sply, Hldgs,
    Matl, Matls, Engr, Envtl, Inds, Solns, Grp, Prods, Dept, N, S, E, W, St, Mt, Ft) or its first three or more letters
    ("Summit Elec. Supply"). When at least two other words are equal, its first letter or more is enough ("Pemberton Lab
    Gl." against "Pemberton Lab Glass").
  - **initials:** a word of one name is the initials of the whole other name ("SES Electrical" against "Summit Electrical
    Supply"), or of the words it stands in for while the rest match ("SE Supply").
  - **a trading name:** either name carries "d/b/a", "dba", "doing business as", "t/a", "trading as", "aka", "a/k/a" or "also
    known as", and the name on either side of it matches or looks like the other name.
  - **a word left off:** one name is the other with one or two words missing, in order, keeping at least two words, or a
    first word of four or more letters ("Summit Electrical" against "Summit Electrical Supply").

  With vendor ids on both sides, different ids under names that look alike are a near match too. With tax ids on both sides,
  different tax ids under names that look alike go to a person, exactly as matching names do: tax ids are the strongest
  evidence of two legal entities.

What it answers, in order:

| booked row | result | who may clear it |
|---|---|---|
| same invoice number, same vendor (or no vendor on the row) | `hold_duplicate` | the controller (`ap-controller`) |
| same invoice number, a vendor name variant, or another vendor id under a matching name | `hold_duplicate`, naming both vendors | the controller (`ap-controller`) |
| same invoice number, a vendor name that looks alike (above), whatever the PO and total | `hold_duplicate`, naming both vendor strings and why they look alike | the controller (`ap-controller`) |
| same invoice number, another vendor, but the same PO or the same total; or a tax-id conflict | a person decides | a clerk (`ap-clerk`) |
| the same number apart from punctuation, spacing or leading zeros (`NM84665` against `NM-84665`, `SES-020417` against `SES-20417`), same, look-alike or no vendor | a person decides | a clerk (`ap-clerk`) |
| a new number, same (or look-alike) vendor, same PO, same total (a possible resubmission) | a person decides; on structured input from the same vendor, the check passes when the PO lines' `invoiced_quantity_to_date` shows this bill bills units received and not yet invoiced (check 10). When the booked number is similar to this bill's (one is the other with a suffix of up to three letters or digits, as `GCS-20417A` to `GCS-20417`, or they differ by one character), the reason says "a bill with a similar number is booked", naming both numbers, never that this invoice is booked | a clerk (`ap-clerk`) |
| same invoice number under an unrelated vendor, another PO and another total | the check passes; the approve's first reason says "invoice number X is also booked under 'Y'" and what that row carries | nothing to clear: the clerk who pays it reads the reason |
| anything else | the check passes | nothing to clear |

A suffixed bill reads: "possible resubmission: a bill with a similar number is booked: GCS-20417 (paid 2026-09-20), same
vendor, same PO (PO-7731) and same total (5244.80), under the number GCS-20417A — a person should confirm this is a new
delivery". On the text path an invoice number is read with its suffix (`GCS-20417A`, `AJ-97466-1`), never cut to the number
it extends. When the text names more than one invoice number (a forwarder's Subject line typed one digit off, say), the
duplicate check cannot run, and the reason names each number with its lines and any of them that is booked: "invoice number
unclear: the bill reads GCS-20471 (invoice line 3) and GCS-20417 (invoice lines 9, 13), so the duplicate check cannot run;
GCS-20417 is booked (paid 2026-09-20)".

A held near match reads: "same invoice number SES-10422 already booked under 'Sumit Electrical Supply' (paid 2026-09-12);
this bill says 'Summit Electrical Supply': the names look alike: they differ by one character ('sumit' against 'summit');
the booked row carries no PO or amount to compare. A look-alike vendor record is how one supplier's bill gets paid twice: the
controller confirms this is not the same bill before it is paid". A held variant reads: "same invoice number NM-84665 already
booked under 'Northfield Material Handling, Inc.'; this bill says 'Northfield Material Handling' (vendor names that differ
only in case, spacing, punctuation or a company suffix); a person confirms this is not the same bill before it is paid". The
explanation describes the booked row only as far as it carries a PO and an amount: "the booked row has another PO, PO-9999,
and another total, 312", "the booked row has the same total, 4875, and carries no PO to compare", or "the booked row carries
no PO or amount to compare".

The duplicate check and the vendor check say "a look-alike vendor" for the same finding. On structured input the duplicate
check compares the purchase order's vendor with the booked row's; when the bill's own vendor name only looks like the booked
one, its reason says so instead of "same vendor": "invoice number SES-020417 matches booked invoice SES-20417 (paid
2026-09-02) apart from punctuation, spacing or leading zeros, under a look-alike vendor (booked as 'Summit Electrical
Supply'; this bill says 'Sumit Electrical Supply': they differ by one character ('sumit' against 'summit'))". The vendor
check on the same bill: "the bill is from Sumit Electrical Supply; the order was placed with Summit Electrical Supply (a
look-alike vendor, another vendor id (the bill V-2290; the order V-1022): they differ by one character ...)".

**No payment history.** The check cannot run. The verdict says so as a claim of its own: `ap.duplicate` is
INSUFFICIENT_DATA ("duplicate check not run: no payment history supplied"), its `gate_status` is `PASS_WITH_OPEN`, and the
decision never approves: it is `abstain` (a person decides), `payable` is `false`, the first reason names the open check
("cannot decide ap.duplicate: duplicate check not run: ..."), and `ap` exits 2. Send `"payment_history": []` to say nothing is booked yet: the check then runs and passes, and the approve says
the history was empty. The PO balance check does not run either, and `not_checked` says so.

### 2. PO number (`ap.po_number`)

`bill.purchase_order_number` must equal `purchase_order.purchase_order_number` after trimming. Otherwise `hold_no_po`; the
buyer may clear it, to approve the bill without a matching PO.

### 3. Quantity received (`ap.line[L].quantity`)

Each bill line's quantity must be at most what was received on its PO line, summed over every item-receipt line for that PO
line. Otherwise `hold_quantity`, naming the line, the billed and the received quantity; the buyer may clear it, to pay for
units not yet received. Partial billing is ordinary: a PO line the bill does not bill is not checked, and is listed in
`not_checked`.

On the text path the bill's lines are matched to the PO's by their words and prices, and the counts may differ:

- **A partial bill.** Fewer bill lines than PO lines is ordinary when every bill line matches a PO line: the PO lines it does
  not bill are listed in `not_checked`, and the approve says so ("partial: 1 of 2 purchase-order lines billed; 1 line open").
  Earlier bills on the order are netted by amount (check 11). When an amount on the bill was not read as a line, the total,
  freight, tax or a known stray, the missing line may be that amount: the line checks cannot decide, and the reason says
  "cannot tell whether the bill is partial".
- **A line that matches no PO line.** More bill lines than PO lines, or a line left over: that line's checks are
  `ap.bill_line[n].quantity`, `.price` and `.amount` (n is its position on the bill), and a person decides, the line named:
  "invoice line 17, "FUEL SURCHARGE", matches no purchase-order line". The PO lines' own checks run as usual.
- **The item a line bills.** A line matches a PO line only when it names the PO line's item: its head noun (the last word of
  the description before a comma that is not a size, a unit or a colour: "conduit" in "3/4 in EMT conduit, 10 ft"), whole,
  abbreviated ("CART" for cartridge, "RL" for roll, "CU" for copper), run into another word ("HANDTRUCK"), or with two
  neighbouring letters swapped; or, failing that, another word of the description that says what the item is ("ratchet" in
  "Ratchet strap"). Sizes and family codes written in capitals never count: "3/4 EMT SET SCREW CONNECTOR" shares only "3/4"
  and "EMT" with "3/4 in EMT conduit, 10 ft", and goes to a person naming both descriptions. On the public Distil benchmark
  every one of the 455 line pairings names its item by this rule.

### 4. Price (`ap.line[L].price`) and the price tolerance

A unit price may run over the PO's price by the price tolerance before the bill is held: 2% unless you say otherwise.
`ap --price-tolerance 0.05` (or `5%`) sets it for one run; a library caller passes `policy: { price_tolerance: 0.05 }`; a
shadow pilot registers it in its pre-registration, frozen before the run. Over MCP, verify_invoice_match takes a price_tolerance up to the operator's pinned one (riposte-verify-mcp --policy), never above it; a higher one is refused by name (policy_exceeds_operator). The hold names it: "400A panelboard: invoiced 204.2,
PO 200 (max 204.0000 at the 2% price tolerance) — over tolerance." The buyer may clear it, to approve the variance. A price
under the PO's passes.

The tolerance is a policy, not a finding: a bill whose every price runs 1.9% over the PO is approved at the 2% default, by
design. For contract-priced purchase orders, where any creep is a problem, set it to 0 (`--price-tolerance 0`); the same bill
is then held (`hold_price`). The tolerance applies to unit prices only, never to tax (check 9).

The tolerance is an input of the verdict, not part of the ruleset. The `input_hash` is taken over the documents and the
policy together (`{ ap_structured: <the input without decision>, policy: { price_tolerance, total_tolerance } }`), so another
tolerance gives another verdict id, the proof's `inputs.policy` carries it, and `replay` re-performs the verdict under it.
An edited tolerance fails the replay on the input hash. A tolerance that is not a finite number of at least 0 is refused. A
bill and a PO in different currencies are not refused, but their unit prices are not compared (that claim says can't tell).

### 5. Line arithmetic (`ap.line[L].amount`)

The stated line amount must equal quantity × unit price within one minor unit of the currency (a cent for USD); every common
way of rounding lands inside that. Otherwise `hold_line_math`; an AP supervisor may clear it. A line with a discount
(`discount_amount` or `discount_rate`, non-zero), or a negative amount that does not recompute, says can't tell instead of
failing.

### 6. Total (`ap.total`) and the freight rule

The bill's stated amount must equal the sum of its line amounts, plus freight only if the PO (or the freight rule) allows
it, plus tax, within half a cent. Whether the tax is due is the tax check's question. Otherwise `hold_total`; an AP
supervisor may clear it.

**The freight rule.** Freight billed on a PO that does not say whether freight is allowed (`freight_allowed` absent) goes to
a person, because the check does not guess the buyer's terms. Many exports have no such field (Ramp's has none). The freight
rule is the buyer's choice, stated once: `person`, the default, sends each such bill to a person; `allow` adds the freight
into the total as an allowed charge, and the words say so ("freight 85.00, which the PO does not address and the run's
freight policy allows"). A PO that says freight is not allowed is never overridden. `ap --freight allow` sets it for one run;
a library caller passes `policy: { freight: 'allow' }`; a shadow pilot registers it. `allow` is bound into the `input_hash`
and carried as `inputs.policy.freight`; `person` is not written, so a default run hashes as before.

### 7. Payment details (`ap.remittance`, text path only)

A change of payment details sent with a bill is the usual way a payment is redirected, and the check holds no vendor master to
compare bank details with. Every sentence of a text bill is read, and a bill with a sentence that is an instruction about
where payment goes, or a line matching a phrasing on the list below, gets a check of its own, `ap.remittance`: a person
decides, the line is quoted, and the AP controller clears it.

**The sentence reading.** A sentence goes to the controller when it has:

- a verb of sending, directing, remitting, paying, mailing, wiring, depositing or updating ("send", "remit", "mail", "make
  checks payable to", "be made to") whose object is an account, an institution (a bank, a credit union), an address, a
  lockbox, a link, a factor or assignee, or instructions or details attached, enclosed, new or updated;
- or anything that names a change or an attachment about where money goes ("new", "changed", "moved", "effective
  immediately", "going forward", "attached", "disregard", beside a payment word or a destination; "now", "future" or "all
  payments" beside a destination);
- or a sale or assignment of the bill ("our receivables have been assigned to Bayside Factoring LLC"), or a payee other than
  the purchase order's vendor ("make checks payable to Bayside Factoring LLC").

**The announced-change reading** (ruleset `ap-threeway@0.3.0`). A bill from a cold review said "Heads up, our old account at
Wells Fargo was closed last week. Janet in our office will call you with the replacement info before you cut the check." It
has no verb of sending or paying and asks for nothing, and it was approved. It is the first step of a bank-change fraud: the
call that follows is the second. So a sentence also goes to the controller when it:

- names an account, a bank, a lockbox, a routing number or a remittance detail as closed, changed, new, updated or replaced
  ("our old account at Wells Fargo was closed", "the routing number on your file is no longer valid", "our remittance account
  was replaced");
- or promises to call, send or confirm payment instructions ("Janet will call you with the replacement info", "someone from our
  office will reach out to confirm the new banking details", "please call to confirm our payment instructions before
  releasing payment", "hold payment until our controller confirms where to send the check").

The reason says what it is: "the bill announces a change of payment details, or promises new payment instructions (invoice
line 22: "...")", and the controller confirms the vendor's payment details from the vendor master by a phone number already on
file, never one given in the bill, its email, or the call that follows.

"Remittance details unchanged" names no change. One sentence is read as standing, never as an instruction: a remit-to postal
address ("Remit to: PO Box 4471, Houston TX 77210", "Please remit payment to Gulf Coast Supply, PO Box 4471"), or a payee
that is the vendor itself, with no change, attachment, account, institution, link or assignee in it. Most invoices print one
on every bill; the approve names its line, and it is not checked against the vendor master. The phrasings below are read
too, line by line, as a fast path. A wording the reading does not parse is not caught, and an approve says so (below).

The payment-redirection phrasings, 25 of them:

1. a statement that bank, payment or remittance details have changed
2. new, changed, updated or revised bank, payment or remittance details, instructions, account or address
3. "new account" (a new bank, banking, checking or business account)
4. "we have changed banks" (changed, switched or moved banks or accounts, or a banking relationship)
5. "change of bank", "change in payment details" and the like
6. "please update", "note" or "use" our (new) bank, payment, remittance, wire or ACH details
7. "updated remittance"
8. payments directed, redirected or routed elsewhere ("direct all future payments to ...")
9. "remit to" on a line that also names an account, a bank, an IBAN, a wire, ACH, a routing number, a web address or an email address
10. an IBAN (the word, or an IBAN-shaped number)
11. a routing, ABA or transit number
12. an account number, or an account ending in digits
13. a SWIFT or BIC code
14. a sort code
15. wire or ACH transfer, instructions or details ("ACH:" included)
16. Zelle
17. Venmo
18. PayPal
19. Cash App, or a $cashtag
20. Western Union or MoneyGram
21. cryptocurrency (bitcoin, BTC, Ethereum, USDT, USDC, a crypto wallet)
22. a web address on a line about paying ("pay online at https://...", "payment portal: ...")
23. "pay by link", "payment link", "click here to pay" and the like
24. an email address named as the payee ("send payment to billing@...")
25. a phone number named as the payee ("send payment to 713-555-0100")

A bill that says "For faster processing please send payment by Zelle to billing.aldine@gmail.com" reads: "the bill names where
to send payment outside the vendor master (invoice line 21: "For faster processing please send payment by Zelle to
billing.aldine@gmail.com"): a payment app, a link or a payee address sent with a bill is how a payment is redirected, and the
gate holds no vendor master to compare it with. The controller confirms the vendor's payment details from the vendor master, by
a phone number already on file (never one given in the bill or its email), before it is paid". The headline names it first: "A
PERSON DECIDES. Open first: the payment-details check (ap.remittance) found where to send payment outside the vendor master".
The claim's `phrasings` operand lists the phrasings each line matched, the sentence reading among them. A bill that only
prints bank-account details ("ACH: Frost Bank, routing 114000093, account ending 4471. Remittance details unchanged.") still
goes to the controller, and the reason says the details were printed, not that they changed: "the bill prints bank-account
details (...); no sentence of it was read as asking to change them, but the gate holds no vendor master, so it cannot tell
whether they are the vendor's".

Not read as a redirection: a remit-to postal address ("Remit to: PO Box 4471, Denver CO 80217. Phone 303-555-0142."), which
most invoices print on every bill; words that only share a stem ("Previous balance on your account", "wire shelving unit",
"accounts receivable"); a web address on a line that says nothing about paying; and an email address or phone number given for
a remittance advice, a question or a copy ("Payment questions? Email ar@... or call ..."). A payee address is one that follows
"to", "via" or a colon directly, in the same sentence as a payment word. A bill with none of these gets no such claim, so its
verdict has the claims it had. An IBAN or an account number on a "please remit" line is never read as a stated total.
Structured input carries no free text for payment instructions, so the structured path has no such claim.

Ruleset `ap-threeway@0.4.0`, selectable and not the default, reads two things more here: the opening step of a payment
redirection, and every line as spelled (see [ap-threeway@0.4.0](#ap-threeway040-selectable-not-the-default) below).

### 8. Vendor (`ap.vendor`)

Invoicing against a known PO number is the oldest AP fraud there is. The check compares the bill's vendor (`bill.vendor`)
with the PO's (`purchase_order.vendor`) by the duplicate check's own comparison: tax id first, then vendor id, then the name,
then the rules for names that look alike.

- **One supplier passes:** the same tax id, the same vendor id, the same name, or names that differ only in case, spacing,
  punctuation or a company suffix.
- **Anything else, a person decides**, never an automatic hold, in words that name both vendors: "the bill is from Apex
  Industrial Holdings; the order was placed with Summit Electrical Supply (another vendor name): a person confirms who sent
  this bill, and that it is payable on this order, before it is paid". That covers another vendor, a name that only looks
  alike, two vendor records under one name, a tax-id conflict, and two vendors that cannot be compared (one side gives only a
  name, the other only an id). The AP controller may clear it. The vendor id or tax id on both documents settles a
  look-alike name.
- **A PO that names no vendor:** the check does not run, and `not_checked` says so ("vendor check: the purchase order names
  no vendor, so the bill's vendor was not compared with it"). **A bill that names none,** against a PO that does: a person
  decides.
- **Both vendors print first under "Lines read"** on every answer, approve included. A hold on an earlier check stays the
  bill's decision, and its reasons end with the open vendor check ("also for a person: cannot decide ap.vendor: ...").

On the text path (`ap <layout.txt>`) the invoice is free text with no vendor field, so the check reads whether the invoice
carries the PO's vendor (the PO's "Vendor:" field). It reads the sender's domain first, by look-alike rules:

- **The sender is the address in angle brackets.** On a From line the address the message came from is the one in angle
  brackets (`From: "Gulf Coast Billing" <billing@gulfcoastsupply.com>`), or after "mailto:" in square brackets; with neither,
  the address outside quotes. A display name is what the sender chose to show. A display name shaped like an address that is
  not the sender's goes to the controller, both named: "the From line shows billing@gulfcoastsupply.com but the message was
  sent from ar.dept@outlook-mailer.net (invoice line 8)". Every sentence the check prints names the address the bill was sent
  from.

- **A look-alike sender domain is a near match for the controller, never evidence of who sent the bill.** A domain is compared
  by its registrable name (the part left of `.com`, `.co`, `.co.uk`), so the vendor's name as a subdomain of another domain
  (`aldinejan.com.evil.co`) does not count. A look-alike is a name built from the vendor's with anything else added
  (`aldine-janitorial-payments`, `aldinejan-billing`, `aldinejanitorial-ar`), a name a letter or two away from one
  (`aidinejan`, a capital I for an l), or the vendor's name only in a subdomain. "the bill's sender,
  ar@aldine-janitorial-payments.co, writes from a look-alike of the purchase order's vendor, Aldine Janitorial (a look-alike
  vendor: aldine-janitorial-payments.co adds "payments" to a name built from Aldine Janitorial's)".
- **The vendor's domain on file** is the one the PO names ("PO-49051 | Vendor: Aldine Janitorial | Email: ar@aldinejan.com",
  or "Domain:", "Website:"). When the PO names none, it is the domain of each booked bill of this vendor whose history row
  carries `sender` (the address that bill came from); the PO's field wins when both exist. With a domain on file, the bill's
  sender (the first sender after a forward marker, else the first) must write from it. Another domain is a person's decision.
  The same name under another ending (`aldinejan.co` or `.net` for `aldinejan.com`), the same name with a hyphen inserted or
  removed, a name a letter or two away, or another domain built from the vendor's name is a near match for the controller.
  So is the domain on file with two neighbouring letters swapped: "aldinjean.com is the domain booked invoice AJ-90001 came
  from, aldinejan.com, with two neighbouring letters swapped". A domain on file passes only as written.
- **With no domain on file, the comparison works from the vendor's name.** A sender passes only when its domain is the name run
  together (its first word whole or cut to four letters or more, then each later word whole, cut short, or left out:
  "summitelec" for Summit Electrical Supply; a company-form word beside it, as in `acmecorp`, is allowed). Two more shapes are
  look-alikes for the controller: a hyphen that is not the vendor's own, and an ending one letter off `.com` (`.co`, `.cm`,
  `.om`, `.con`; `.net`, `.org` and country endings pass). A hyphen is the vendor's own only where its name has one
  (`pryce-webb.com` for "Pryce-Webb Supply"). Every other hyphenated domain is a look-alike: `gulfcoast-supply.com` for "Gulf
  Coast Supply" (a hyphen where the name has a space), `aldine-jan.com` for "Aldine Janitorial" (against a word cut short),
  `aldinejan-billing.com` (before another word), `acme-group.com` for "Acme". It is the cheapest domain anyone can buy in a
  vendor's name. An "Email:" field on the PO, or a booked bill's sender, settles a vendor whose own domain has either shape.
- **With no domain on file, a sender whose domain is not built from the vendor's name goes to the controller**, whatever a
  line of the bill says: "the bill's sender, accounts@gcs-remit.net, writes from gcs-remit.net, which is not built from the
  purchase order's vendor name, Gulf Coast Supply, and no domain for Gulf Coast Supply is on file". A bill sent from a billing
  platform's domain goes to a person this way until a booked bill of the vendor carries that address as its `sender`. Every
  sender on the bill is read (a forwarder's From line first, the vendor's after it), and one writing from a domain built from
  the vendor's name passes. Only a bill that names no sender at all may be matched by a line of the invoice holding the
  vendor's name, its words in order, a trailing company suffix aside, and never by a header line or a signature line.
- **A free-mail sender is a person's decision**, unless that exact address is on file (the PO's "Email:" field, or a booked
  bill's sender): anyone can open an address at a free-mail provider in any name. The providers are read by name whatever
  the ending (gmail, googlemail, outlook, hotmail, live, msn, yahoo, ymail, rocketmail, aol, icloud, protonmail, gmx, yandex,
  zohomail, mailinator) and by whole domain (me.com, mac.com, mail.com, proton.me, pm.me, tuta.io, tutanota.com,
  fastmail.com, hey.com, zoho.com, mail.ru, inbox.com, hushmail.com, aim.com, qq.com, 163.com, 126.com, and the US internet
  providers' comcast.net, att.net, sbcglobal.net, verizon.net, bellsouth.net, earthlink.net, cox.net, charter.net,
  optonline.net). "the bill's sender, aldinejanitorial.ar@gmail.com, writes from a free-mail address (gmail.com), which anyone
  can open in any name; no domain or email for Aldine Janitorial is on file (the purchase order names none, and no booked bill
  carries a sender), so nothing on file shows Aldine Janitorial writing from that address".
- **An email header line, or a signature line, is never vendor evidence.** "Subject:", "To:", "Cc:", "Date:", "Re:" and
  "Fwd:" lines are written by whoever sends the bill, and so is its signature: a closing on a line of its own ("Thank you,",
  "Regards,", "Sincerely,") and every line after it, up to a forward marker, or the lines after a "-- " delimiter.

One pair of neighbouring letters swapped (a scanning or typing slip) is allowed in the name, the word "From" and an address
compared with names built from the vendor's, never against a domain on file, and the sentence says so when the match needed
it ("once two neighbouring letters are swapped back"). A dropped or changed
letter is not. Neither found, a person decides, naming the PO's vendor and the sender's address. A layout
whose PO has no "Vendor:" field skips the check and says so. All 100 invoices of the public Distil Labs benchmark come from a
domain built from their PO's vendor's name, and the check passes on each.

What it does not do: it does not prove who sent an email (a sender's address can be forged), and it does not check the vendor's
bank details. An approve says both under "Not checked". Structured input compares the two documents' vendor fields, and
a payment going to the vendor-master record of the PO's vendor is the ERP's own control.

Ruleset `ap-threeway@0.4.0`, selectable and not the default, also reads a bill's Reply-To line here, and with no domain on
file passes a sender built from the vendor's name under `.com` only (see
[ap-threeway@0.4.0](#ap-threeway040-selectable-not-the-default) below).

### 9. Tax (`ap.tax`) and the tax rule

A structured bill that carries `tax` is checked against the tax terms the PO states. The total check adds the bill's tax into
the total, which checks the arithmetic and not whether the tax is due; this check asks the second question.

| the bill's tax | the PO | result |
|---|---|---|
| none (0) | anything | passes |
| some | states no tax terms (no `tax_rate`) | the tax rule decides: by default a person, naming the amount; the buyer may clear it |
| some | states a rate of 0 | `hold_total`: the bill's total carries an amount the PO rules out, as freight it rules out does |
| some | states a rate | the rate × the taxable lines, to the cent, within rounding (one minor unit per taxable line: a cent each on a USD bill): passes; otherwise a person decides, with both figures and the difference |
| negative | anything | a person decides (a credit or a correction a person reads) |

Tax is checked to the cent, not within the price tolerance: the price tolerance is for unit prices. A vendor that rounds each
line's tax stays inside the rounding allowance; $38.69 of extra tax on a $24,685.00 order taxed at 8.25% goes to a person: "tax
2,075.20 is billed, but 8.25% of the taxable lines, 24,685.00, is 2,036.51: over by 38.69, more than rounding allows (0.01 per
taxable line, 0.03 on this bill)". Silent and zero differ on purpose: a PO written without tax terms may still owe tax, so a
person looks; a PO that states no tax is due is answered by a hold. The taxable base is the bill's lines whose PO line is taxed; a bill line that matches no PO
line counts as taxed; freight is never in the base. Every answer prints the tax on its own line ("Tax: none billed.", "Tax:
1,490.00 billed; the purchase order states no tax terms."). A bill with no `tax` field gets no tax claim.

**On the text path** a line whose label is tax ("Sales tax 8.25%: USD 432.70", "Tax: USD 432.70", "Sales Tax: USD 432.70")
is the bill's tax: the rate printed beside it is never the amount, the total check adds it as it adds `bill.tax`, and this
check runs exactly as above against the rate the purchase-order block states on its header line ("PO-7731 | Vendor: Gulf
Coast Supply | Tax: 8.25% | Freight: not allowed"; "Tax: 0%", "Tax: exempt" or "Tax: none" state a rate of 0). Every bill
line counts as taxed. A tax line on a purchase order that states no rate goes to a person: "tax line present, PO states no
rate: tax 432.70 is billed (invoice line 18, "Sales tax 8.25%: USD 432.70"), and the purchase order states no tax rate".
Two tax lines are a person's decision on the total. A bill with no tax line gets no tax claim, and its approve says what
the purchase order states.

**The tax rule** is the buyer's choice for a PO that states no tax terms, stated once, like the freight rule. No export
mapping reads a PO's tax terms, so without it every taxed bill goes to a person.

- `person`, the default: a person decides.
- `allow`: the tax is accepted as billed, and the words say it was not checked against a rate ("Tax 467.78 is billed; the
  purchase order states no tax terms, and this run's tax policy (--tax allow) accepts tax as billed: it was not checked
  against a rate.").
- a rate, `rate:8.25%` (or the fraction `rate:0.0825`; a bare `8.25` is refused): checked against that rate on the taxable
  lines, to the cent within rounding, as a stated PO rate is. Off by more, a person decides (never a hold: the PO itself states nothing).

A PO that states its tax terms (`tax_rate`, including 0) is never overridden. `ap --input bill.json --tax rate:8.25%` sets it
for one run; a library caller passes `policy: { tax: 'allow' }` or `policy: { tax: { rate: 0.0825 } }`; a shadow pilot
registers it and records it in each receipt. It is bound into the `input_hash` and carried as `inputs.policy.tax`; `person`
is not written, so a default run hashes as before. The text path refuses a tax rule other than `person`.

### 10. Billed to date per PO line (`ap.line[L].billed_to_date`)

The quantity check compares one bill with what was received; it cannot see that an earlier bill already billed part of the
same line. Job-cost ERPs keep the quantity already invoiced on each PO line, and the input can carry it as
`purchase_order.line_items[].invoiced_quantity_to_date`. When a billed PO line carries it, and the quantity check could
compare (a quantity on the bill, a goods receipt for the line), this check runs:

| earlier + this bill | result |
|---|---|
| at or under what was received | passes: "MC cable 12/2 250ft roll: billed to date 40 of 40 received (10 invoiced earlier on PO line 1, 30 on this bill)." |
| over what was received | a person decides, the buyer clears it: "billed to date would be 54 against 40 received: 24 invoiced earlier on PO line 1 (invoiced_quantity_to_date), 30 on this bill" |

It never holds: what the ERP's figure counts (earlier bills only, or this one too) is the ERP's, and a person reads it. When
this bill alone bills more than was received, the quantity check holds it first. A PO line without the field is not netted
line by line, and the gap is named (below). The shadow pilot's CSV mapping reads it from a purchase-order column
(packages/receipts HOW-TO-MAP.md).

The same figures settle a possible resubmission. A second bill for a second delivery can carry the same amount as the first, and
the duplicate check sends a new number with the same vendor, PO and total to a person. When every line of the bill matches a
PO line that carries `invoiced_quantity_to_date`, states a quantity and has a goods receipt, earlier plus this bill stays
within what was received on every line, and at least one line records an earlier bill, the duplicate check passes and the
approve says why: "Same vendor, same PO (PO-7740) and same total (6256.85) as booked invoice SES-20417, under a different
number, but not a resubmission by the purchase order's own figures: MC cable 12/2 250ft roll: 20 invoiced earlier on PO line 1
+ 20 on this bill = 40 of 40 received (invoiced_quantity_to_date). This bill bills units received and not yet invoiced." A
bill whose vendor only looks like the booked one's still goes to a person.

### 11. PO balance (`ap.po_balance`)

With a payment history, the check nets what earlier bills already charged to the same order.

- **What it adds up.** Billed to date is every booked row on this order plus this bill's lines. The order is the sum of its
  lines, quantity × unit price; a PO line with no quantity counts its `amount`. Billed to date at or under the order passes.
- **Over the order, a person decides**, never an automatic hold, in words that name each booked invoice, its amount and the
  order: "billed to date on PO-7001 would be 2,600.00, 600.00 more than the order: already booked 1,200.00 on PO-7001
  (GS-2210); this bill 1,400.00; the order totals 2,000.00." The buyer, who owns the order, may clear it. A change order
  raising the order, or a credit booked against an earlier bill, makes it a new check.
- **Which booked rows count.** A row counts when its `purchase_order_number` is this order's (compared without case, spaces or
  punctuation) and its vendor is not another supplier by the duplicate check's comparison (a row with no vendor name counts).
  A row under this bill's own invoice number is the duplicate check's question and is not counted again. A credit booked
  against the order, a negative amount, counts as negative.
- **What it cannot count is said.** A row from this vendor with no PO number may be on this order, unless it says
  `"no_purchase_order": true`: it is counted as if it were, and the check passes only if the bill fits even then; otherwise a
  person decides, and the row is named. A row on this order with no amount, or an amount in another currency, cannot be
  counted: a person decides, naming it; a clerk may clear it.

It nets **amounts on the order, not quantities on a line**: payment-history rows carry one amount each and no lines. A booked
row's amount counts as booked, so tax or freight inside it counts against the order too, and the last bill on a taxed order
may go to a person. This bill counts its lines only, not its freight or tax, because the PO's prices carry neither. When a
booked invoice is on this order and a billed PO line carries no `invoiced_quantity_to_date`, `not_checked` names the gap and
the field that closes it. The gap: "quantities per PO line across bills: booked invoice SES-20417 on PO-7740 carries an
amount, not lines, so this bill's quantities were compared with what was received, not netted against what that bill already
billed on each line". The field: "invoiced_quantity_to_date on each PO line (the quantity earlier bills invoiced on it) lets
this bill be netted line by line".

## How the decision is made

- **One answer per bill.** An approve stands only on a verdict whose `gate_status` is `PASS`. A verdict that reads
  `PASS_WITH_OPEN`, for any check, is `abstain` with `payable: false`. `payable` is `true` exactly on an approve and `false` on
  every hold and every `abstain`, so the decision object, the gate and the exit code agree whichever door the bill comes
  through.
- **In order.** The first check in the order above that holds gives the hold; the first that cannot decide sends the bill to
  a person, the headline naming that check first ("A PERSON DECIDES. Open first: the duplicate check (ap.duplicate) did not
  run."). A hold also lists a later payment-details, vendor, tax or billed-to-date check left for a person ("also for a
  person: cannot decide ap.vendor: ..."), so whoever clears the hold sees it.

**Who may clear each result**, as the plain-English block prints it under "Who may clear it" (the `authority` of the remedy
the verdict carries):

| result | who may clear it |
|---|---|
| `hold_duplicate` | the AP controller (`ap-controller`) |
| `hold_no_po` | the buyer (`buyer`), to approve it as a bill without a matching PO |
| `hold_quantity` | the buyer (`buyer`), to pay for units not yet received |
| `hold_price` | the buyer (`buyer`), to approve the price variance |
| `hold_line_math`, `hold_total` | an AP supervisor (`ap-supervisor`) |
| a person decides on the duplicate check | an AP clerk (`ap-clerk`) |
| a person decides on the PO balance check: more billed than the order | the buyer (`buyer`) |
| a person decides on the PO balance check: a booked row it could not count | an AP clerk (`ap-clerk`) |
| a person decides on the payment-details check | the AP controller (`ap-controller`) |
| a person decides on the vendor check | the AP controller (`ap-controller`) |
| a person decides on the tax check, or `hold_total` on tax a PO rules out | the buyer (`buyer`) |
| a person decides on billed to date | the buyer (`buyer`) |

A ruling clears one verdict only. The roles are the usual AP ones, and the deployment decides who holds each, by key. A person
signs a ruling with `riposte-ledger rule --by <role> --key <private.pem>` (packages/receipts), and the gate honours it only
when that key is pinned for that role: the caller passes the map of role to public key as `authorities` to `apGate`, and an
unpinned or unsigned ruling is refused. A company that wants the clerk's cases at its controller pins the controller's key for
`ap-clerk`.

**The words a person reads.** `formatApReport(result, { documents })` (`src/ap/report.ts`) turns a result into a short block:
the decision, the invoice and PO, the reasons, the exact lines or fields it read, who may clear a hold, and the checks that
could not run. It reads the result and never changes it. "Lines read" is printed on every outcome; its first two lines are
the two vendors (the bill's and the PO's, or the invoice line or sender that names the PO's vendor), a "Tax:" line says what
tax the bill carries and how it was read, and a "Freight:" line, when the bill carries freight, says who allowed it.

## What an approve did not check

Every approve prints a "Not checked" block (the result's `not_checked`, also in the JSON) naming what the gate does not
check for that bill:

- **the vendor's identity beyond the match**: how the vendor was matched (the domain on file, the PO's or a booked bill's
  sender's; a sender's domain that is the vendor's name run together, with no domain on file; a line naming it; or on
  structured input a tax id, vendor id or name), what it was compared with, and that who sent the bill, and whether the vendor
  record is genuine, were not checked;
- **payment redirection**: on the text path, exactly what was read: "every sentence of the bill was read for an instruction
  about where payment goes (...), for an account, bank, lockbox, routing or remittance detail named as closed, changed, new,
  updated or replaced, and for a promise to call, send or confirm payment instructions, and the 25 phrasings listed in
  docs/AP-INPUT.md were scanned; no sentence was read as an instruction, a change or a promise, though one sentence names
  payment: invoice line 20 was read as the vendor's standing remit-to postal address, which was not checked against the vendor
  master; a wording the reading does not parse is not caught; the vendor's bank details are not part of the inputs, so where
  the payment goes was not checked against the vendor master". The words "none was found" appear only when no sentence of the
  bill names payment at all; a bill with a payment sentence has each such sentence named, with how it was read ("invoice
  line 22, "Payment terms: net 30.", names payment and was read as neither an instruction about where payment goes, a change
  of payment details nor a promise of one"), so an approve never says of a bill that mentions payment that nothing was found.
  On structured input, that the input has no field for payment instructions or bank details;
- **per-line netting**, when an earlier bill is booked on the order and a billed PO line carries no `invoiced_quantity_to_date`;
- **a partial bill's open lines**: each PO line the bill does not bill, by name;
- **tax**: on the text path with no tax line, that no line of the bill was read as tax, what rate the purchase order states (or
  that it states none), and that tax inside a price is not read; on structured input, when the order states no tax terms:
  none billed, accepted under the tax rule `allow`, or checked against the rule's rate instead of the order's;
- **the path**, last, on an emailed-text approve: "This bill was read from text; the structured path is the product and this
  path is a convenience with the limits listed."

The block never states something about the bill that the check did not establish: it says what was read or scanned, and what
was not. A hold or a person's decision does not carry the block: that bill is not paid automatically.

## What these checks do not check

- Quantities billed against one PO line across several bills, unless the PO line carries `invoiced_quantity_to_date`. The
  payment history carries amounts, not lines, so without it the PO balance check nets amounts on the order only.
- Tax or freight inside a booked amount: it counts against the order as booked.
- Whether a vendor is who it says it is, and its bank details. The vendor check compares the bill with its PO; on the text
  path a display name shaped like another address, a look-alike sender domain, a free-mail sender, a sender other than the
  domain on file, and, with none on file, a sender whose domain is not built from the vendor's name go to a person, but a
  forged sender's address is not detected. A bill with a sentence that is an instruction about where payment goes, or that
  names an account, bank, lockbox, routing or remittance detail as closed, changed, new, updated or replaced, or that promises
  to call, send or confirm payment instructions, or with a line matching a payment-redirection phrasing, goes to a person; a
  wording the reading does not parse is not caught, and the bank details themselves are never on the inputs.
- On the text path, four supply-house habits are read (ruleset `ap-threeway@0.3.0`), and their limits are these: a pole count
  ("1P", "2P", "single pole", "double pole") is one word for the line match, and no other abbreviation is expanded; a subtotal
  line that is the lines' sum (or the lines plus freight) is read as such, and one that is not goes to a person naming both
  figures; a distributor's invoice number ("S104412558.001", five to twelve digits with up to four letters in front) is read
  only when it follows the word "invoice"; a unit price per thousand or per hundred ("189.00/M", "/C", "per 1,000", "per
  hundred") is read as the price of one unit, with the capital M and C only, so a lowercase "/m" (a metre) is not read.
- Fraud the documents agree with, contract terms beyond the PO price and its tax and freight terms, approval policy, and
  duplicates outside the payment history you supply.

## Values

- **Money** is any of three forms: a JSON number in major units (`236.5`); a decimal string in major units (`"236.50"`, at
  most 15 digits and 6 decimals); or minor units with a currency, the way Ramp's `CurrencyAmount` writes it (`{ "amount":
  23650, "currency_code": "USD" }`; the divisor is `minor_unit_conversion_rate` when given, otherwise the currency's ISO 4217
  minor unit).
- **Quantities** are non-negative numbers or decimal strings.
- **One currency per document.** A money object whose `currency_code` differs from its document's currency is refused.

The forms change the input hash, so they change the verdict id. They never change the answer.

## Where structured input differs from the text path

The checks, rule ids, claim ids and remedies are the text path's, and the decision is the same function. On purpose:

- **Lines match by id, never by text.** A bill line matches by `purchase_order_line_item_id`, else by a `sku` that names
  exactly one PO line. Otherwise its claims (`ap.bill_line[n].*`) say can't tell, and the remedy names the field to fill:
  `/bill/line_items/<i>/purchase_order_line_item_id`. Two bill lines billing one PO line both say can't tell.
- **The vendor is two fields compared**, where the text path reads the sender and whether the invoice names the PO's vendor.
- **Tax is read** on both paths: `bill.tax` against `purchase_order.tax_rate`, or a tax line against the rate the PO block
  states. The payment-details check runs only on the text path.
- **On the text path a bill line is matched to a PO line by its words and price**, and must name the PO line's item (check
  3); a partial bill and a line that matches no PO line are read as structured input reads them.
- **Evidence locators are JSON Pointers** (RFC 6901) into the input, for example `/bill/line_items/0/quantity`. A raw value
  that was normalized (a decimal string, minor units) is kept as the evidence's `original`.

**Path parity.** A test converts each of the 100 cases in Distil Labs' public AP benchmark from the text parser's own reading
into structured input (`structuredFromText`) and compares decision, grounding, every claim's rule, outcome, operands and
result, coverage and remedies. All 100 agree, with and without payment history. The vendor check is compared on its rule,
outcome and reason only, since what each path reads differs by design. The conversion declines an invoice that does not name
its PO's vendor, one whose sender writes from a look-alike, a free-mail or another domain than the one on file, one with a
sentence or line about where payment goes, one with a tax line, and one with a line that does not name its PO line's item:
the conversion writes none of these. This is a determinism check between two readers of one set of
facts, not an accuracy result.

## Validation errors

Every error is `{ code, field, message }`. The field is a JSON Pointer into the input. `ap --input` prints the list and exits
3; over MCP, receipts' `ap_gate` returns it as a tool error, and each field there starts with `/structured`.

| code | meaning |
|---|---|
| `ap_input.not_object` | the input is not a JSON object |
| `ap_input.schema_version` | `schema` is not `riposte.ap-input/0.1.0` |
| `ap_input.missing_field` | a required field is absent, null, empty, or an array is under its minimum |
| `ap_input.unknown_field` | a field the schema does not name (a misspelling, usually) |
| `ap_input.wrong_type` | the wrong JSON type |
| `ap_input.invalid_money` | not one of the three money forms |
| `ap_input.invalid_quantity` | not a non-negative number or decimal string |
| `ap_input.invalid_enum` | not one of the allowed values (a currency code, `action`, `reason`) |
| `ap_input.out_of_range` | a negative price, a confidence outside 0 to 1, a conversion rate that is not a power of ten |
| `ap_input.too_many` | over a cap: 1,000 lines per document, 1,000 receipts, 10,000 receipt lines, 10,000 history rows |
| `ap_input.too_long` | a string over its length cap |
| `ap_input.currency_conflict` | two currencies in one document |
| `ap_input.currency_missing` | minor units with no currency anywhere |
| `ap_input.duplicate_id` | two PO lines with one id |
| `ap_input.reference_unknown` | a receipt line naming no PO line, or a receipt for another PO |
| `ap_input.conflict` | contradictory fields: a `pay` decision with a hold reason, text documents sent with structured input |

The JSON Schema states the shape. The last five codes (from `currency_conflict` down) cover what a schema cannot state, so only
the validator raises them.

## Library and MCP

```ts
import { validateApInput, verifyBillMatch } from 'riposte-verify'
const checked = validateApInput(json)
if (!checked.ok) console.error(checked.errors)     // [{ code, field, message }]
else console.log(verifyBillMatch(checked.input).decision)
```

The model's decision the gate checks is one of the AP decisions, a bare `hold`, or the input's own `decision`
(`{ "action": "pay" | "hold" }`). If both are given they must agree. Payment history goes inside the input as
`payment_history`. No HTTP service for the gate ships in this release.

Over MCP, verify's `verify_invoice_match` takes `{ "structured": <input> }` instead of the texts, and receipts' `ap_gate` takes
`{ "structured": <input>, "decision"? }` with the same input rules as `apGate` (a refusal is a tool error whose
`structuredContent.error.errors` names each field under `/structured`). `replay_proof` (verify) and `replay_receipt`
(receipts) re-perform the proof either hands back.

## Field map

Field names follow Ramp's public Developer API wherever Ramp has the field. Each mark says what was checked against the
provider's own published text on 2026-10-03.

- ✓: the field exists in the provider's published schema under the name shown (checked in the downloaded file). A mapper
  copies it, renaming it where the name differs.
- ◇: derived. The value needs a lookup, sits inside a nested object, or comes from another object, so a mapper does more than
  copy.
- ✗: the provider's schema has no such field. The value comes from somewhere else, or stays absent.

| our field | Ramp Developer API | Xero Accounting API | QuickBooks Online API |
|---|---|---|---|
| `bill.invoice_number` | `Bill.invoice_number` ✓ | `Invoice.InvoiceNumber` (Type ACCPAY) ✓ | `Bill.DocNumber` ✓ |
| `bill.vendor.id`, `.name` | `Bill.vendor` (`ApiBillVendor.id`, `.name`) ✓ | `Invoice.Contact` (`ContactID`, `Name`) ✓ | `Bill.VendorRef` ✓ (a reference; its name attribute not checked) |
| `bill.purchase_order_number` | ◇ `Bill.purchase_order_id` is an id: look up that PO's `purchase_order_number` | ✗ (often typed into `Invoice.Reference` by convention, not verified) | ◇ `LinkedTxn` to the PO, then its `DocNumber` |
| `bill.currency` | ◇ `Bill.amount.currency_code` | `Invoice.CurrencyCode` ✓ | `CurrencyRef` ✓ |
| `bill.amount` | `Bill.amount` (CurrencyAmount) ✓ | `Invoice.Total` ✓ | `Bill.TotalAmt` ✓ |
| `bill.freight` | ✗ (an expense line with no PO line in practice; the pilot's Ramp mapper reads one such line whose whole memo is a freight charge's name, such as "Freight", "Shipping & handling" or "Delivery charge", as the bill's freight) | ✗ | ✗ |
| `bill.tax` | ✗ | `Invoice.TotalTax` ✓ | ◇ inside `TxnTaxDetail` |
| `bill.issued_at` | `Bill.issued_at` ✓ | `Invoice.Date` ✓ | `TxnDate` ✓ |
| `bill.line_items[].id` | `ApiBillInventoryLineItem.id` ✓ | `LineItem.LineItemID` ✓ | `Line.Id` ✓ |
| `…purchase_order_line_item_id` | `ApiBillInventoryLineItem.purchase_order_line_item_id` ✓ | ✗ | ◇ via `Line.LinkedTxn` |
| `…sku` | ✗ | `LineItem.ItemCode` ✓ | ◇ `ItemBasedExpenseLineDetail.ItemRef` |
| `…description`, `…memo` | `memo` ✓ (no description field) | `LineItem.Description` ✓ | `Line.Description` ✓ |
| `…quantity` | `ApiBillInventoryLineItem.quantity` ✓ | `LineItem.Quantity` ✓ | ◇ `ItemBasedExpenseLineDetail.Qty` |
| `…unit_price` | `ApiBillInventoryLineItem.unit_price` ✓ | `LineItem.UnitAmount` ✓ | ◇ `ItemBasedExpenseLineDetail.UnitPrice` |
| `…amount` | `ApiBillInventoryLineItem.amount` ✓ | `LineItem.LineAmount` ✓ | `Line.Amount` ✓ |
| `…discount_amount`, `…discount_rate` | ✗ | `LineItem.DiscountAmount`, `.DiscountRate` ✓ | ✗ |
| `purchase_order.id` | `ApiPurchaseOrderResource.id` ✓ | `PurchaseOrder.PurchaseOrderID` ✓ | ◇ `Id` (inherited from Intuit's base types, not checked) |
| `purchase_order.purchase_order_number` | `ApiPurchaseOrderResource.purchase_order_number` ✓ | `PurchaseOrder.PurchaseOrderNumber` ✓ | `PurchaseOrder.DocNumber` ✓ |
| `purchase_order.vendor.id` | `vendor_id` ✓ | `PurchaseOrder.Contact` ✓ | `VendorRef` ✓ |
| `purchase_order.vendor.name` | ◇ look up the vendor by `vendor_id` | `Contact.Name` ✓ | ◇ inside `VendorRef` (not checked) |
| `purchase_order.currency` | ◇ `amount.currency_code` | `PurchaseOrder.CurrencyCode` ✓ | `CurrencyRef` ✓ |
| `purchase_order.freight_allowed` | ✗ (a policy field: absent means the PO does not say, and the freight rule decides: a person by default, or `allow`, above) | ✗ | ✗ |
| `purchase_order.tax_rate`, `…line_items[].taxable` (optional) | ✗ (checked 2026-10-05 in the downloaded file: `ApiPurchaseOrderResource` and `ApiPurchaseOrderLineItem` carry no tax field) | not checked | not checked |
| `purchase_order.line_items[].invoiced_quantity_to_date` (optional) | not checked against Ramp's schema | not checked | not checked (job-cost ERPs keep invoiced quantity per PO line; the shadow pilot's CSV mapping reads it from a purchase-order column) |
| `purchase_order.line_items[].id` | `ApiPurchaseOrderLineItem.id` ✓ | `LineItem.LineItemID` ✓ | `Line.Id` ✓ |
| `…external_id` | `ApiPurchaseOrderLineItem.external_id` ✓ | ✗ | ✗ |
| `…description`, `…quantity`, `…unit_price`, `…amount` | `ApiPurchaseOrderLineItem` ✓ (all four) | `LineItem` ✓ (`Description`, `Quantity`, `UnitAmount`, `LineAmount`) | ◇ `Line` and its `ItemBasedExpenseLineDetail` |
| `item_receipts[].id`, `.item_receipt_number`, `.purchase_order_id`, `.received_at` | `ApiItemReceiptResource` ✓ (all four) | ✗ (no goods-receipt object in the schema) | ✗ (no item-receipt entity in the schema) |
| `item_receipts[].line_items[].purchase_order_line_item_id`, `.quantity`, `.id` | `ApiItemReceiptLineItem` ✓ (all three) | ✗ | ✗ |
| `payment_history[]` | ◇ from paid bills: `Bill.invoice_number`, `vendor.name`, `amount`, `paid_at` | ◇ from paid ACCPAY invoices | ◇ from paid bills |
| `payment_history[].purchase_order_number`, `.no_purchase_order` (optional) | ◇ the paid bill's `purchase_order_id`: look up that PO's `purchase_order_number`; none means booked without a PO | ◇ the reference the company uses for the PO (not verified) | ◇ the bill's `LinkedTxn` to a PO, then its `DocNumber` |
| `payment_history[].vendor_id`, `.vendor_tax_id`, `bill.vendor.tax_id`, `purchase_order.vendor.tax_id` (optional) | ◇ the vendor-master id and tax id the bill was booked under; not checked against Ramp's schema | ◇ `Contact.ContactID`, `Contact.TaxNumber` (not checked) | ◇ `VendorRef`, the vendor's tax identifier (not checked) |
| money in minor units | `CurrencyAmount.amount`, `.currency_code`, `.minor_unit_conversion_rate` ✓ | ✗ (decimal amounts) | ✗ (decimal amounts) |

Ramp's descriptions, quoted from the downloaded schema:

- `ApiBillInventoryLineItem.amount`: "Amount of the line item, equal to the product of unit quantity and unit price,
  represented in the lowest denomination of the currency (e.g., cents for USD)."
- `ApiItemReceiptLineItem.purchase_order_line_item_id`: "Unique identifier of the purchase order line item that was received."
- `ApiItemReceiptLineItem.quantity`: "Received quantity of the line item."
- `CurrencyAmount.amount`: "the amount of money represented in the smallest denomination of the currency. For example, when the
  currency is USD, then the amount is expressed in cents."
- `ApiPurchaseOrderResource.three_way_match_enabled`: "Whether three-way match is enabled for the purchase order."

Two notes on Ramp's schema:

- Ramp's expense lines (`ApiBillLineItem`) have an amount but no quantity or unit price. A bill made of them can be checked for
  its total, but its quantity and price claims say can't tell (`FIELD_MISSING`).
- Ramp's bill lines also carry `item_receipt_line_item_ids` ✓. This input does not use them: it matches receipts to bill lines
  through the PO line, which both sides name.

**Not verified:**

- **CSV export column names** for Xero and QuickBooks. Xero's help pages are rendered by script and did not download as text,
  and no QuickBooks CSV specification was fetched. The Xero and QuickBooks columns above are their API field names, not their
  CSV headers.
- **Whether Ramp's sandbox returns these fields populated** as documented.
- **How a given Xero or QuickBooks company links a bill to its PO** (a reference field or a linked transaction). This varies by
  company and was not checked.

Sources, downloaded 2026-10-03:

| source | file | sha256 |
|---|---|---|
| Ramp Developer API OpenAPI 3.0.2 (`https://docs.ramp.com/openapi/developer-api.json`) | 2,404,814 bytes | `4e17ef628965c69a5f1202b68b590cb2cb28a2f21a11edc8294923533884fdce` |
| Xero Accounting API (`https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/master/xero_accounting.yaml`) | 933,096 bytes | `1afca0717bb0d323210c0f88f3802684c068059f6e5161ee24ddde7ee6294a64` |
| QuickBooks Online data schema, Intuit's Java SDK (`https://raw.githubusercontent.com/intuit/QuickBooks-V3-Java-SDK/master/ipp-v3-java-data/src/main/xsd/Finance.xsd`) | 473,665 bytes | `1a9396290315a383210df86ddabd9e0020fcad414fef0ecd96d39da00913c202` |

## ap-threeway@0.4.0: selectable, not the default

Six emailed bills from two cold reviews were approved under engine 0.7.2 and `ap-threeway@0.3.0`, the default, and each
reader expected a person to decide. Three were the opening step of a payment redirection ("Please reply to confirm the current
wiring information before releasing payment.", "We are moving to a new financial partner this week."), one spelled its bank
details apart ("Our b-a-n-k  d e t a i l s have changed, see attached."), one was sent from the vendor's own domain with a
Reply-To at a free-mail provider, and one came from `aldinejan.net` for "Aldine Janitorial" with no domain on file. The bills
are kept, with their sources, in `test/fixtures/ap-r10/`. Ruleset 0.4.0 sends each of them to a person. It reads everything
0.3.0 reads, and it only tightens: none of its readings lets through a bill 0.3.0 held.

**What it reads.**

- **The opening step of a payment redirection** (check 7, kind `opening`). A sentence goes to the controller when it asks for a
  confirmation of the vendor's payment details (confirm, verify, validate or update, with banking, bank, wiring, wire
  transfer, account, payment, remittance, routing, ACH or deposit information, details, instructions or numbers as the thing
  confirmed); or asks for a reply, a call or a message about such details, or before payment is released ("please reply
  before releasing payment", "call us before you send the wire"); or announces a move, a transition, a switch or a change to a
  new, different or another bank, banking or financial partner, provider or institution, or payment provider or processor.
  The reason names the sentence: "the bill takes the opening step of a payment redirection (invoice line 16: "We are moving to
  a new financial partner this week."): ... The new payment details come in the reply or the call that follows, and the gate
  holds no vendor master to compare them with, so a person decides: the controller confirms the vendor's payment details from
  the vendor master, by a phone number already on file (never one given in the bill, its email, or the reply it asks for),
  before it is paid". The headline: "A PERSON DECIDES. Open first: the payment-details check (ap.remittance) found the opening
  step of a payment redirection".
- **Every line read as spelled** (check 7). Each line of the bill is also read once these are set back, in this order:
  invisible characters (zero-width spaces and joiners, soft hyphens, word joiners, direction marks) are left out;
  compatibility forms (full-width letters) and accents become plain letters; in a word that mixes Latin letters with Cyrillic
  or Greek letters that look like Latin ones, or that is made only of such letters, each is read as its Latin letter; and three
  or more single letters, each separated from the next by one hyphen, dot, underscore, asterisk, middle dot or bullet (a space
  either side allowed) or by one space, are joined when they spell payment words ("b-a-n-k" is "bank", "b a n k d e t a i l s"
  is "bank details"). The words they may spell are account, ACH, bank, banking, change, changed, check, cheque, code, current,
  deposit, detail, details, direct, financial, IBAN, info, information, instructions, new, number, partner, pay, payment,
  payments, PayPal, remit, remittance, routing, sort, SWIFT, transfer, update, updated, Venmo, wire, wiring and Zelle.
  Initials and abbreviations ("A B C Supply", "U.S.A.", "P.O. Box") spell none and are left as written. The phrasings and the
  sentence reading run on the line as spelled too; a line found only that way is quoted as written, its `phrasings` operand
  names the spelled reading, and the reason says how it was read: "Invoice line 21 was read once the letters spelled apart
  were joined: "Our bank details have changed, see attached."".
- **A Reply-To at another domain** (check 8). When the vendor check would pass, a Reply-To line that writes from another
  registrable domain than the From line of its own header block (the nearest From line above it, else below it, with no blank
  line between; else the bill's sender) sends the bill to a person, both addresses named: "the bill's Reply-To,
  aldine.accounts@protonmail.com (invoice line 9), writes from protonmail.com, not from aldinejan.com, the domain of the address
  the bill was sent from, ar@aldinejan.com (invoice line 8): a reply to this bill goes to protonmail.com, not to the sender ...
  A person decides: the controller confirms who sent this bill ...". The address read is the one in angle brackets, else the
  first outside quotes and parentheses. A subdomain of the sender's domain is the sender's own, and a Reply-To in a forwarder's
  block is held to the forwarder's address.
- **The sender's ending, with no domain on file** (check 8). Under 0.3.0 a sender whose domain is the vendor's name run
  together passes under any ending but one letter off `.com` (`.net`, `.org` and country endings pass). Under 0.4.0, with no
  domain on file, it passes under `.com` only; under another ending (`aldinejan.net`, `aldinejan.org`, `aldinejan.co.uk`) a
  person decides, the ending named: "the bill's sender, ar@aldinejan.net (invoice line 8), writes from aldinejan.net, a name
  built from Aldine Janitorial's under .net, not .com, and no domain for Aldine Janitorial is on file ...: the vendor's name under
  another ending is the cheapest look-alike there is, and which ending is the vendor's own cannot be told from the bill". The
  headline is the look-alike one. A domain on file, the purchase order's "Email:" or "Domain:" field or a booked bill's
  `sender`, settles it whatever its ending, so a vendor whose own domain is not `.com` goes to a person until one of its bills
  is booked with its sender, or its purchase order names its domain.
- **What an approve says.** Its payment line names the two readings above, and its vendor line ends by saying whether the bill
  carried a Reply-To line ("the bill carries no Reply-To line") and, for a sender matched with no domain on file, that its
  domain is the vendor's name run together under `.com`. The structured conversion of a text bill
  (`structuredFromText`) declines what 0.4.0 sends to a person.

**What it does not read.** A confirmation, a reply or a move worded in a way these readings do not parse is not caught, and
the approve still says so. Letters spelled apart are joined only into the words listed; a word outside the list, spelled
apart, is read as written. The Reply-To is compared by domain only: two addresses at the same domain are not compared, and a
Reply-To is read only when the purchase order names its vendor (the vendor check runs). The sender's own address is not read
as spelled (the vendor check's look-alike rules read it). None of this checks the vendor's bank details, which are not part of
the inputs.

**How to select it.** In the library: `verifyInvoiceMatch(docs, { ruleset: 'ap-threeway@0.4.0' })` (or `{ ruleset: { id:
'ap-threeway', version: '0.4.0' } }`). A bill that names no ruleset is checked under `ap-threeway@0.3.0` under engine 0.7.2,
as before. 0.4.0 needs engine 0.7.0 or later and is refused under an earlier one. In this build `verify ap --ruleset ap-threeway@<version>` selects a ruleset for an emailed bill (from 2026-10-20; before
that the flag was read and not passed on); the gate server checks an emailed bill under the default only.

**Re-performance.** A verdict names the ruleset it was made under, and a replay re-performs it under that ruleset. 0.4.0 adds
no rule, claim id or remedy, so the remedy table, and with it every verdict id of 0.3.0 and earlier, is unchanged. Every 0.4.0
reading is gated on 0.4.0: verdicts made under 0.3.0, 0.2.0 or 0.1.0 re-perform byte for byte. On the 100 public benchmark
invoices, the five perturbation seeds of the stress study and the four development seeds (5,500 bills) and every AP fixture,
0.4.0 and 0.3.0 give the same decision on every bill; a scanning slip in a sender's `.com` ("castellantools.cmo") is read back
as before. Among the readers' bills, the six above, and a second copy of the first, move from approve to a person, and no
other bill moves.

## Older engines

Verdicts made under engines up to 0.5.0 compare vendor names exactly after trimming and case, carry no no-history claim,
approve a bill whose duplicate check did not run, give an `abstain` a `payable` of `null`, and have no PO balance, vendor,
tax, payment-details or billed-to-date check. Engines up to 0.5.0 refuse the freight and tax rules. Their verdicts replay
byte for byte under the engine that issued them.

Verdicts made under engine 0.6.0 read an emailed bill as that engine did, and replay byte for byte: every address on a From
line was a sender, a line naming the vendor matched it when no sender's domain was built from its name, a hyphen where the
vendor's name has a space was its own, only the 25 phrasings were scanned, the bill's lines had to match the PO's one for one,
a tax line was an amount the total check could not place, a suffix after an invoice number was not read, and a possible
resubmission never said "similar". Engines 0.7.0 and 0.7.1 read them as this page says. See the [changelog](../CHANGELOG.md) for what
each engine changed, and when.

## Older rulesets

The text path's ruleset versions independently of the engine, and a verdict names the one it was made under. `ap-threeway@0.1.0`
checked that the total adds up the stated line amounts, never a line's own arithmetic. `ap-threeway@0.2.0` added the line
recompute (check 5). `ap-threeway@0.3.0` added the announced-change reading (check 7) and the four supply-house readings
(above), and says "none was found" on an approve only when no sentence of the bill names payment; it needs engine 0.7.0 or
later and is refused under an earlier one. Verdicts made under 0.2.0 read a bill as that ruleset did: the announced change
above was approved, a pole count, a subtotal line, a distributor's invoice number and a per-thousand price each sent a clean
bill to a person. Every retained version re-performs its verdicts byte for byte (`ruleset: 'ap-threeway@<version>'` in the
library; a replay uses the version the verdict names).
