# How to map your own export for the shadow pilot

This page is for a system the pilot has no verified preset for, such as a construction ERP. You export three CSV files, write
a mapping file that names your columns, and check it with a dry run that executes nothing. Allow about an hour, and keep
your ERP open beside you to check five bills by hand.

## 1. Export three files, one row per line

| file | one row per | must carry |
|---|---|---|
| `bills.csv` | bill line | the invoice number, the bill date, the bill total, the PO number, and per line an item, quantity, unit price and line amount |
| `purchase_orders.csv` | PO line | the PO number, and per line an item and unit price (quantity, amount and the quantity invoiced before the month if you have them) |
| `item_receipts.csv` | received line | the PO number, an item, and the quantity received (a date if you have one) |

The header fields repeat on every line row, so a bill with three lines has three rows. Use other file names if you like, and
name them in the mapping's `files`. Without `item_receipts.csv` every quantity check can only abstain or fail, and the report
says so.

## 2. Start a mapping file

If your system has a drafted mapping, write it out and edit it:

```sh
riposte-pilot mappings                                   # every construction ERP and what is known about it
riposte-pilot mappings --erp vista --out mapping.json    # the one drafted mapping; its notes print as it is written
```

Otherwise start from this, which uses `--source generic-csv`, whose default column names are the field names themselves:

```json
{ "source": "generic-csv",
  "columns": {
    "bills": { "ref": "", "invoice_number": "", "vendor": "", "date": "", "currency": "", "total": "", "tax": "", "po": "",
               "status": "", "line_id": "", "item": "", "description": "", "quantity": "", "rate": "", "amount": "",
               "price_per": "", "unit": "" },
    "purchase_orders": { "ref": "", "number": "", "vendor": "", "currency": "", "line_id": "", "item": "", "description": "",
                         "quantity": "", "rate": "", "amount": "", "invoiced_quantity": "", "price_per": "", "unit": "" },
    "item_receipts": { "ref": "", "number": "", "po": "", "date": "", "item": "", "quantity": "" } },
  "status": { "pay": [], "hold": [] },
  "ignore": [] }
```

Put your column's exact header text after each field you have, and delete each field you do not have: an empty name is
refused. The required ones are `invoice_number`, `date`, `total`, `po`, `item`, `quantity`, `rate` and `amount` on bills;
`number`, `item` and `rate` on purchase orders; `po`, `item` and `quantity` on receipts. Map `ref` on bills too whenever your
export has a bill id; it is not required, and the dry run tells you when you need it.

- **`ref` is which rows are one bill.** Map it to your system's own id for the bill record (an internal id, a voucher or
  document number), never to the vendor's invoice number. Two bills can carry one invoice number: a vendor that re-bills,
  a second vendor record, a duplicate your team paid. With `ref`, every row with the same id is one bill. Without it, rows
  are one bill only when they share the invoice number, the bill date and the vendor as written; rows under one number on
  two dates or under two spellings of the vendor are read as separate bills, never merged, and the dry run says so: "8 rows,
  6 bills; GCS-20417 has rows on two dates under two vendor names: read as separate bills, never merged". The later bill's
  ref then names its date and vendor ("GCS-20417 (2026-09-18, Gulf Coast Supply Co.)"), and a paid duplicate is reported as a
  duplicate. If that warning names bills you know are one, map `ref`.

- **`item` is how lines meet.** A bill line, its PO line and its receipt line must carry the same value in the column you map
  to `item`: a part number, or the PO line number if your system has one. A bill line whose item matches no PO line, or
  matches two, cannot be checked.
- **`status`** lists the values in your status column that mean paid and held. Leave both lists empty if your export has no
  such column. Every bill then counts as open, and the report cannot compare its answers with your team's.
- **`ignore`** lists columns you have checked and want left unread, such as company codes and GL accounts.
- **`invoiced_quantity`** (optional) is each PO line's quantity already invoiced **before the pilot month**. Job-cost ERPs keep
  it per PO line, often as "quantity invoiced" or "billed to date"; export it as of the month's first day. Each bill is then
  netted line by line against it plus the earlier bills of the month on that line (a bill your status column marks held is left
  out). A second bill that would take a line past what was received goes to a person, naming the figures. Without the column,
  quantities are netted against the order's total only, and each answer says so. Do not map a figure taken after the month: it
  already counts the month's own bills, and every bill would be netted against itself.
- **`price_per`** (optional, bills and purchase orders) is the unit a rate is per: `E` (each), `C` (per hundred) or `M` (per
  thousand), as a construction ERP's price-unit column writes it (Vista's ECM and CurECM), or `1`, `100`, `1000`. A rate per
  hundred is divided by 100 and a rate per thousand by 1,000 to a price per unit, so wire priced per thousand feet is checked per
  foot. A value that is none of these sends the bill to a person, naming it. A blank cell reads as each, unless the line's own
  amount is quantity × rate / 100 or / 1,000; then a person reads it.
- **`unit`** (optional, bills and purchase orders) is the unit of measure (Vista's UM). A bill line in another unit than its
  PO line sends the bill to a person, naming both units; nothing is converted between units.
- **`notes`** (optional, a list of sentences) is printed with every dry run and run, and acted on in no way. The drafted
  mappings carry theirs.

## 3. Dry run, then fix what it lists

```sh
riposte-pilot map --export ./export --source generic-csv --mapping mapping.json --month 2026-09
```

It reads everything and executes nothing. It lists each column it reads, each it does not read (**unmapped**), each required
one it cannot find (**missing**), and how many bills it could put together. An unmapped column stops a real run until you
either map it or add it to `ignore`. Do not ignore a column that changes what is payable, such as retainage, tax, freight,
discounts or a per-hundred price unit, until you have decided how it is handled. Ignoring it does not make the arithmetic
right.

## 4. Check five bills by hand

Check the mapping on a different month from the pilot month, so that you first see the pilot month's results after your
pre-registration is frozen. Freeze a scratch pre-registration for that other month and run it into a scratch folder with
`--key-here`. Open `pilot-run.json`, pick five bills, and compare each with your ERP's screen: the total, the PO number, and
each line's quantity, unit price and amount. If one differs, the mapping names the wrong column. Fix it and run again into a
new folder. When the five agree, write and freeze the pilot month's pre-registration, then make the real run.

## What silently goes wrong

- **Prices per hundred or per thousand.** A unit price "per C" read as per each is off by a factor of 100. Map the column
  that says so to `price_per` (above), or convert those rows, or leave them out.
- **Amounts with a currency sign or parentheses.** `1,300.00` reads as a number. `$1,300.00` and `(1,300.00)` do not.
- **Dates.** `2026-09-14` and `9/14/2026` are read. A day-first date such as `14/09/2026` is read month-first, which is
  wrong, so its bill falls outside every month. Convert day-first dates first.
- **Two columns with one name**, for example a header and a line `Description` in one joined export. Rename one.
- **Bills without a PO**, such as subcontract invoices and rentals, are listed and not checked.

## Pay applications

G702/G703 pay applications are not read from CSV. Put each one in `pay_applications/` as a JSON file in the shape of
`packages/verify/docs/examples/payapp-g702-g703.json`, last month's included. See PILOT.md, "Pay applications".
