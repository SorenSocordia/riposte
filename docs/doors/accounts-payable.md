# Accounts payable: vendor bills and pay applications

For controllers and AP leads. Riposte re-does the checks a clerk does by hand on a bill your team already holds: against
its purchase order and goods receipt, and, for an AIA G702/G703 pay application, against last month's application. It
answers pay, hold or "a person decides", prints the lines it read and who may clear a hold, and moves no money. Exit codes:
[How to read an answer](../../README.md#how-to-read-an-answer); terms: the [glossary](../GLOSSARY.md).

## Which path is yours

- **To measure it on your own bills, start with the [shadow pilot](../../packages/receipts/PILOT.md).** It runs one closed
  month from your AP system's export, plus any pay applications you add, offline: nothing is paid, held or sent, and it
  builds each bill's input from the export for you. Every bill gets a signed receipt saying what the gate would have done,
  and the report compares that with what your team did. No construction ERP export has been read yet ([below](#which-exports-it-reads)).
- **To call the check from your own code or ERP,** the input is the bill, its PO and its item receipts as JSON.
  [`AP-INPUT.md`](../../packages/verify/docs/AP-INPUT.md) is its manual: the checks in the order they run.
- **For a bill that arrives as email,** the first command below reads text. The file is the forwarded email followed by two
  blocks pasted from your system, headed `PURCHASE ORDER (ERP)` and `GOODS RECEIPT (ERP)`, as in the sample, or the three
  parts as separate files (`--invoice`, `--po`, `--receipt`). It does not fetch the PO or the receipt from your ERP. The
  structured input path is the product. The emailed-text path is a convenience with a documented limit, and every approve
  names which path read the bill. This page lists the limits. Every answer names the path it came through on a line of its
  own after the headline: "read from: emailed text" or "read from: structured input".

## First commands

The sample emailed bill against its PO and goods receipt:

```bash
node packages/verify/dist/cli.js ap packages/verify/docs/examples/ap-three-way.txt
```

It answers `hold_quantity`: "Machine grease cartridge 14 oz: billed 10, received 7", with the invoice line it read, exit 1.
The words go to your terminal; the full verdict, every check with its evidence, is JSON on stdout (several hundred lines).
For an emailed bill the JSON carries the sha256 of the text and of the payment history it read, never the documents, so
the replay takes the same files: `replay result.json --source bill.txt --history history.json` re-performs it, and names a
file that is missing or not the one it was read from. A structured bill's JSON carries its inputs, so `replay result.json`
alone re-performs it.

A sample G702/G703 against last month's application:

```bash
node packages/verify/dist/cli.js packages/verify/docs/examples/payapp-g702-g703.json --ruleset pay-app --history packages/verify/docs/examples/payapp-g702-g703.previous.json
```

It answers PASS, 44 of 44 checks, exit 0. When a pay-application check fails, needs a person or cannot run, the console
prints it in plain words, with the line it read, its figures and who may clear it, and it always says how the retainage was
read.

## What it checks

On a bill, in the order the checks run:

1. that it is not already booked, when you give the payment history (`--history <file.json>`; `[]` means nothing is booked
   yet), including a second vendor record under a look-alike name. A number one suffix away from a booked one
   ("GCS-20417A") goes to a person as a similar number, naming the booked bill;
2. the purchase-order number;
3. quantities billed against quantities received. A bill that bills some of the PO's lines is a partial bill, and the
   lines it does not bill are not checked; on an emailed bill, a billed line that matches no PO line, or does not name the
   item of the PO line it is read against ("SET SCREW CONNECTOR" against "EMT conduit"), goes to a person, both named;
4. unit prices against the PO, within a 2% tolerance that `--price-tolerance` changes. A price creeping under the 2% default
   tolerance is approved by design; for contract-priced orders set `--price-tolerance 0`;
5. line arithmetic, then the total;
6. on an emailed bill, every sentence is read for an instruction about where payment goes: a verb of sending, paying,
   remitting, mailing, wiring, directing or updating with an account, an institution, an address, a lockbox, a link or an
   assignee as its object, or anything that names a change or an attachment about payment details ("our receivables have
   been assigned", "use the remittance details on the attached letter", "mail all payments to our new lockbox"). Its 25
   listed phrasings (a change of bank details, Zelle, a link to pay at, a payee email or phone, and the rest) are read too.
   So is an announced change with no instruction in it: a sentence that names an account, bank, lockbox, routing number or
   remittance detail as closed, changed, new, updated or replaced, or that promises to call, send or confirm payment
   instructions ("our old account at Wells Fargo was closed last week. Janet in our office will call you with the replacement
   info before you cut the check"), goes to the controller, the sentence named; the call that follows such a bill is the
   second step of a bank-change fraud, and the controller confirms the details by a number already on file, never one given in
   the bill or on that call. Any of these goes to the controller. A standing remit-to postal address is named on the approve,
   not flagged. A wording the reading does not parse is not caught, and every approve says what was read;
7. that the bill comes from the vendor the PO names. On an emailed bill the sender is the address in angle brackets: a
   display name shaped like another address ("billing@vendor.com" over another address) goes to the controller, both
   named. A booked bill's `sender` in the text-path history, or an `Email:` field on the PO, puts the vendor's domain on
   file, and only that domain as written passes: the same domain with two neighbouring letters swapped goes to the
   controller, both named. With none on file, a sender whose domain is not built from the vendor's name goes to the controller (a signature
   naming the vendor does not count), and so do a hyphen the vendor's name does not carry ("gulfcoast-supply.com"), an
   ending one letter off .com, and a free-mail sender;
8. tax to the cent against the tax rate the PO states (the 2% tolerance is for prices, not tax): on structured input the
   PO's `tax_rate`; on an emailed bill a tax line ("Sales tax 8.25%: USD 432.70") against the rate the PO block states
   ("Tax: 8.25%"), and a tax line on a PO block that states no rate goes to a person;
9. what earlier bills already charged to the same order, and, where the input carries each PO line's quantity already
   invoiced (`invoiced_quantity_to_date`; in the pilot, an `invoiced_quantity` column), the same line across bills.

On a pay application: the G702/G703 math; retainage at the stated rate (a lower retainage passes only where the application
says where), or the form's own 5a/5b split, stated as `retainage_rate: { "completed_work": "10%", "stored_materials": "0%" }`
(a rate in any other shape is refused by name, exit 3); and continuity with last month: each line's previous work (read
either way the form is filled in for stored materials), each scheduled value (a change needs a change order the application
states, else a person decides, naming the line and the difference), new change-order lines (read as a change order when net
change orders rose by their value, and the console says so) and the contract sum. A line or change order the application
itself marks unapproved ("pending owner approval", "proposed", PCO and the like) goes to a person, the owner clearing it:
PASS-WITH-OPEN, exit 2.

## Reading the answer

- **Approve** (exit 0) only when every check ran and held. **Hold** (exit 1) names the check, the line and who may clear it.
  **A PERSON DECIDES** (exit 2; `abstain` in the JSON) when a check could not decide, the open check named first.
- **No payment history, no approve.** Without `--history` the duplicate check does not run, so a bill that passes every
  other check goes to a person, exit 2. `--allow-open` exits 0 on exactly that case and says so; the decision stays A
  PERSON DECIDES.
- **Every approve prints a "Not checked" block** saying what was read or scanned for that bill and what was not; it never
  asserts what it did not establish. Its payment-redirection line says "none was found" only when no sentence of the bill
  names payment at all; otherwise it names each sentence that does (the standing remit-to address, a payment-terms line) and
  says it was read as neither an instruction about where payment goes, a change of payment details nor a promise of one. An
  emailed-text approve ends the block with one fixed sentence: "This bill was read from text; the structured path is the
  product and this path is a convenience with the limits listed."
- **The line after the headline names the path**: "read from: emailed text" or "read from: structured input". The headline
  itself keeps its shape, for scripts that read it.

## What it does not check

- **Who the vendor is, or its bank details.** The bill's vendor is compared with the vendor its PO names, and a different
  one goes to a person. A sender's address can be forged, and a bank account is never on the inputs.
- **Fraud the documents agree with**, approval policy, and duplicates outside the payment history you supply.
- **Number formats on an emailed bill.** Its figures are read in US style ("1,598.00"); a bill written with "." for
  thousands and "," for decimals is not read as written. Send such bills as structured input. Four supply-house habits are
  read, each with a limit: a pole count ("1P" for single pole) is one word for the line match, and no other abbreviation
  is expanded; a Subtotal line that is the lines' sum is read as such, and one that is not goes to a person naming both
  figures; a distributor's invoice number ("S104412558.001") is read only after the word "invoice"; a price per thousand or
  per hundred ("189.00/M", "/C") is read as the price of one unit, capital M and C only, so "/m" (a metre) is not.
- **Contract terms beyond the PO's price, tax rate and freight terms.** Tax billed against a PO that states no tax rate
  goes to a person unless you choose a tax rule for structured input (`--tax allow`, or `--tax rate:8.25%`). Freight on a PO
  that does not say whether freight is allowed goes to a person unless you choose `--freight allow`.
- **Quantities on one PO line across several bills, without `invoiced_quantity_to_date`.** The payment history carries
  amounts, not lines, so earlier bills are netted against the order's total; a bill that would take billed-to-date over
  the order goes to a person, naming the earlier bills, and every answer on such an order names the missing field.
- **On a pay application:** whether the work was done, lien waivers, whether the owner really approved a change order the
  application does not mark unapproved, and whether the contract allows a lower retainage than the stated rate.

## Which exports it reads

It parses files shaped like the published export schemas of Ramp, Xero and QuickBooks Online, with field names checked
against those schemas; no real company's export has been read yet. It also parses CSV exports from NetSuite, Xero or
QuickBooks, whose column names are not verified. No construction ERP export has been read yet. For Viewpoint Vista a
column mapping is drafted from Trimble's published field names, not verified on a real export. QuickBooks Desktop's
published import layout carries no link from a bill to its purchase order, so no mapping is drafted. For Sage 300 CRE,
Viewpoint Spectrum and Foundation no published field list was found. [PILOT.md](../../packages/receipts/PILOT.md#construction-erps)
lists each, and [`HOW-TO-MAP.md`](../../packages/receipts/HOW-TO-MAP.md) is one page on mapping your own CSV export.

## What has been measured

- **The labour cost, on synthetic bills.** On Distil Labs' public benchmark of 100 templated invoices that arrive as
  emails, 13 of the 32 invoices that should have been paid went to a person (about 41%), and none of the 82 bills decided
  was decided wrong (Wilson 95% upper bound about 4.5%). Tier: transcribed; provenance archived; prereg unhashed. These
  figures measure the frozen bench script, not the shipped `ap` command. On real bills it has not been measured: your own
  closed month, in the shadow pilot, is how to measure it.
- **A real purchase log, compared by message counts, not money.** On the public BPI Challenge 2019 log (labelled blind by
  the authors' records; this figure is descriptive, with no preregistered bar), the check agreed with the company's own
  log on 61.7% of the 209,254 items it decided. Most of that agreement is items it passed that the company did not hold: of
  the 81,771 decided items the company held, it flagged 1,668, about 2.0%. The full tables, with intervals and tiers, are on
  the [methods page](methods.md#the-accounts-payable-numbers).

## Read next

- [`packages/receipts/PILOT.md`](../../packages/receipts/PILOT.md): the shadow pilot, its pre-registration and data handling.
- [`packages/verify/docs/AP-INPUT.md`](../../packages/verify/docs/AP-INPUT.md): the structured input and every check, in order.
- [`packages/verify/docs/BENCHMARK-AP.md`](../../packages/verify/docs/BENCHMARK-AP.md): the AP benchmark write-up. To pair a
  model with the check and gate its decisions with receipts, see [`examples/distil-pairing`](../../examples/distil-pairing).
