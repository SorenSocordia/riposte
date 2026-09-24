# Rules that write themselves: mining an AP policy from pay/hold labels

*Riposte benchmark note · 2026-09-24 · everything here re-runs from the files it cites*

## The claim we tested
Rules-based verification has one standing objection: someone has to write the rules. We tested whether Riposte can **learn a
company's rules from its own history**. From 100 invoices labelled only *paid* or *held* (not *why* they were held), can it
recover the policy that produced the labels?

The data is Distil Labs' public AP benchmark (Apache-2.0), the same set as [BENCHMARK-AP.md](BENCHMARK-AP.md). Its policy
has four checks:
- the PO number matches;
- no line bills more than was received;
- no unit price is more than 2% over the PO;
- the total adds up, with freight only if the PO allows it.

The miner is never shown these checks.

## How it works
`verify mine`:
1. **Proposes candidate rules from a typed grammar** over the document's fields: comparisons between same-kind fields,
   tolerances, sums, conditionals and identifier matches. In this set that is 30 forms and 78 variants, counting learned
   tolerances.
2. **Kills candidates** unless they pass three judges:
   - **consistency**: no approved invoice breaks the rule;
   - **grounding**: the invoices that break it are held more often than chance allows (exact hypergeometric test,
     k ≥ 5, p ≤ 0.01);
   - **novelty**: the rule explains at least 3 holds that no already-accepted rule explains.
3. **Keeps survivors as proposals for a person to ratify, and records every death with its cause.**
4. **Compiles ratified rules** into the engine's declarative ruleset format, so `verify` enforces them with the same
   proof objects as any hand-written rule.

The method and its pass bar were **pre-registered before the miner was written** (frozen 2026-09-24, sha256
`09d94446355a50f28791fe44c0063cccfb0019516a8197113b0c95e3e72937ed`, available on request). The pass bar was at least 3 of
the 4 true rules and at most 2 false rules.

## Result
| true rule | found as | held invoices it explains | p |
|---|---|---|---|
| PO number matches | `inv_po_numbers cites exactly one id = po_number` | 14 | 2.8e-3 |
| billed ≤ received | `inv_qty <= rcv_qty` | 21 | 9.2e-5 |
| price ≤ PO + 2% | `inv_price <= po_price*(1+t)`, **t = 0.02 learned** | 22 | 5.5e-5 |
| total adds up (freight if allowed) | `total = sum(inv_amount) + freight*[freight_allowed]` | 19 | 2.5e-4 |

- **All 4 rules were recovered, with 0 false rules. All 68 of 68 held invoices are explained.**
- **The tolerance was learned from the labels.** The data puts it anywhere in [1.90%, 2.20%): between the largest approved
  overcharge and the smallest held one. The miner reports that interval rather than pretending to more precision.
- **26 candidates died with recorded causes.** Two examples:
  - "freight billed when not allowed" alone was too thin (6 cases, p = 0.09), because it is really part of the total rule;
  - "total = lines + freight" was redundant, because the conditional rule already covers it.
- **Enforcing the mined rules:** `verify` running the compiled ruleset agrees with the gold decision on **100 of 100
  invoices**, with no abstentions.
- **Under a strict family-wise correction** (0.05/78), the PO-number rule (p = 2.8e-3) would not pass. With 68% of invoices
  held, 100 cases can't make a 14-case rule significant at that level. The pre-registration predicted this, and it is why
  the miner proposes rules rather than enacting them.

## What this does and doesn't show
- **Shows:** a rule policy can be recovered from outcomes alone, with learned thresholds, zero false rules, and a
  replayable reason for every rule it kept and every one it killed.
- **Doesn't show real-world performance.** These invoices are synthetic and templated, so the rules hold exactly. The field
  extraction was also developed on this set.
  - Real companies approve exceptions. With a high allowed-exception rate (25%) the current miner learns the price rule
    badly and explains only 52 of 68 holds. Fixing that needs a new pre-registered method, not a quiet patch.
  - **Real-data tests are next,** each with its dataset linked.

## Re-run it
```bash
node packages/verify/dist/cli.js mine packages/verify/data/real/D-ap-distil/invoice_cases.jsonl --ap
# add --ruleset-out mined.json to write the compiled ruleset, then: node packages/verify/dist/cli.js <doc.json> --ruleset mined.json
```
The regression test (`packages/verify/test/mine.test.ts`) pins every candidate's fate, learned tolerance, violators and
p-value exactly.
