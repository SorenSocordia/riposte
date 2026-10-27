# Shadow pilot: pre-registration

Written and frozen before the month is run. `riposte-pilot prereg freeze <this file>` records its sha256; the run and the
report refuse it if it changed afterwards.

## What is run

One closed month of the buyer's own bills, read from its export, each checked by the deterministic three-way match (bill,
purchase order, item receipts) in shadow: nothing is executed, no payment or hold is sent anywhere. Every bill gets a signed
receipt that holds hashes, not documents.

## The primary number

**hold_precision**: of the bills the check would have held, the share a person confirms is a real problem (wrong price,
quantity, arithmetic, total, or a duplicate), on a random sample drawn after the run from a seed nobody chooses (the sha256 of
this file and the receipt ledger's head). Reported with its exact (Clopper-Pearson) interval at the confidence below.

Decision rule, fixed now: the lower bound at or above the bar is a pass; the upper bound below the bar is a fail; anything else
is inconclusive and is reported as inconclusive.

## The co-primary number

**miss_rate**: of the bills the check would have paid automatically, the share a person confirms is a bad bill (the same
auditor's rule as below), on a second random sample, of would-pays, drawn after the run the same way. Reported with its exact
interval at the confidence below. Why it is registered: hold_precision alone measures false holds. It says nothing about bad
bills the check would have paid, which is the failure that costs money.

Decision rule, fixed now (lower is better): the upper bound at or below the bar is a pass; the lower bound above the bar is a
fail; anything else is inconclusive. Both numbers are primary: the pilot passes only when both pass, fails when either
fails, and is otherwise inconclusive. With no bad bill found, 75 audited would-pays is about the fewest whose 95% upper bound
falls under 0.05. Delete the co_primary block before freezing to register hold_precision alone.

What counts as a real problem (the auditor's rule): the bill as recorded asks for more money, a different price, or a quantity
not received, compared with the purchase order and the receipts on record, or it repeats a bill already paid.

## The check's price tolerance

`price_tolerance` is how far a bill's unit price may run over the purchase order's before the check holds it, as a fraction:
0.02 is 2%. Set it to what your contracts allow (a metals surcharge, for instance) before freezing. Every bill of the run is
checked under it, and each receipt records it.

## The check's freight rule

`freight` says what happens to freight billed on a purchase order that does not say whether freight is allowed. "person"
sends each such bill to a person. "allow" adds the freight into the bill's total as an allowed charge. A purchase order that
says freight is not allowed is never overridden. Choose before freezing; every bill of the run is checked under it, and each
receipt records it.

## The check's tax rule

`tax` says what happens to tax billed on a purchase order that states no tax terms. "person" sends each such bill to a person.
"allow" accepts the tax as billed, and each answer says it was not checked against a rate. "rate:8.25%" checks the tax against
that rate on the bill's taxable lines, within the price tolerance; a tax off by more goes to a person. A purchase order that
states its tax terms is never overridden. Choose before freezing; every bill of the run is checked under it, and each receipt
records it.

## Secondary and tertiary

- coverage: the share of the month's bills the export let the check run on (the rest are listed with the reason).
- agreement: the share of the bills the buyer decided (paid or held) where the check's pay/hold class matches; a check that
  could not decide counts as not matching.
- dollars_held: the total of the bills the check would have held (from the export's totals).

## Parameters (the run reads this block)

Each blank in the block below is in angle brackets and starts with "fill:", followed by what to write. Replace each one,
brackets included, with your value. Numbers are written without quotes, like 0.85 or 40.

```json
{
  "prereg_version": "riposte.pilot-prereg/0.1.0",
  "buyer": "Keystone Mechanical",
  "month": "2026-09",
  "source": "generic-csv",
  "price_tolerance": 0.02,
  "freight": "person",
  "tax": "person",
  "primary": {
    "metric": "hold_precision",
    "bar": 0.85,
    "confidence": 0.95,
    "sample_size": 5
  },
  "co_primary": {
    "metric": "miss_rate",
    "bar": 0.05,
    "confidence": 0.95,
    "sample_size": 5
  },
  "secondary": [
    "coverage",
    "agreement"
  ],
  "tertiary": [
    "dollars_held"
  ]
}
```

## Not claimed

No number is claimed before the month is run. A synthetic or tuned month is never presented as the buyer's result.
