# blind-shipping-1, AP arm (PREREG.md section 4.1): what waits for a partner

The AP arm needs one closed month of a partner's accounts payable under a written data agreement (section 4.1). No partner
has agreed. Section 10 holds: an arm whose data is not in hand 90 days after the stamp does not run, and the result says so.
The other arms run.

Three parts of the AP arm's harness block cannot be written before a partner exists. They are written then, hashed and
stamped in a further amendment before any bill is run (sections 9 and 11):

1. **The column mapping**, from the export's header row only, no data row (section 4.1). The template is
   `ap-mapping.TEMPLATE.json` beside this page: the structure `riposte-pilot map --mapping` reads, with every column name
   left blank. A blank is filled with the partner's own column name, or left out when the export has no such column.
2. **The frozen pilot pre-registration** (section 9), made with the shipped pilot tool:

   ```
   riposte-pilot prereg init PREREG-AP.md --buyer "<the partner, or its role if it declines to be named>" --month <YYYY-MM> \
     --source <the export's source id> --price-tolerance 0.02 --freight person --tax person
   riposte-pilot prereg freeze PREREG-AP.md
   ```

   `--tax` is `person` unless the partner states its own tax rule in writing before the run; then that rule. The registered
   audit is hold_precision primary with S1's bar and size (lower bound at or above 0.80, 60 audited) and miss_rate co-primary
   with P1's bar and size (upper bound at or below 0.05, 150 audited).
3. **The record of which seeded operators are inside the claim**, quoting the shipped pages at that amendment's stamp
   (section 4.1). The pages to quote are the pilot tool's `PILOT.md` (the checks a bill goes through, the freight and tax
   rules, the synthetic month's operators) and the engine's `docs/AP-INPUT.md` (the structured input path). Operator 7 is
   outside the claim on structured input, because the payment-details check reads emailed text only (section 4.1).
   Operator 8 is inside it only if the export carries the quantity invoiced to date.

## What the scoring script reads from this arm

`score.mjs` reads `results/ap/ap-scoring.json`:

```json
{ "bills":  [{ "id": "<stable token>", "decision": "pay" | "hold" | "person" }],
  "audit":  { "hold": [{ "id": "…", "label": "confirmed" | "not confirmed" | "undecided" }],
              "pay":  [{ "id": "…", "label": "bad" | "good" | "undecided" }] },
  "seeded": [{ "id": "…", "operator": 1, "in_claim": true, "decision": "pay" | "hold" | "person" }] }
```

The script that writes it from the pilot tool's run folder and the labeller's audit sheet (`riposte-pilot report --audit`)
is part of the AP amendment, written against the partner's export. Until it exists, `score.mjs` reads the AP arm as DID NOT
RUN, and P1, P2, S1 and S2 read DID NOT RUN; the run then cannot read PASS, because P1 and P2 are primary (section 7).
