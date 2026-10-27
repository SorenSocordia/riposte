# Emailed bills from a cold review, 2026-10-13

From a cold review, 2026-10-13: a controller's own emailed bills and payment history, copied byte for byte. The controller
sat as a 60-person electrical and mechanical subcontractor, wrote a clean bill from an electrical supply house against its
purchase order and goods receipt, then reworded it. The test that reads them is `test/ap-announced-change.test.ts`.

- `A-clean.txt`: the clean bill (three lines, a tax line, a remit-to post office box), approved then and now.
- `B1-bank-explicit.txt`, `B3-bank-w9.txt`, `R1.txt` to `R3.txt`: the same bill with a change of payment details said in five
  ways; each went to a person then and goes to a person now. (The review's sixth wording, a bank taken over by another
  institution so that "the account on your file is no longer valid", went to a person then and now too; its file is not
  kept here because one of its words is not one this repository's export carries.)
- `B2-bank-subtle.txt`: the same bill saying "Heads up, our old account at Wells Fargo was closed last week. Janet in our office
  will call you with the replacement info before you cut the check." It was **approved** under ruleset ap-threeway@0.2.0 (exit
  0, 15 of 15), and the approve said no change of payment details was found. Under 0.3.0 it goes to a person, the sentence named.
- `C-lookalike-domain.txt`: sent from `lonestarelectricsupply.com` when the booked bills came from `lonestarelectric.com`.
- `H-numeric-invno.txt`: the clean bill under a distributor's invoice number, `S104412558.001`.
- `W-wire-perM.txt`: the clean bill with wire priced per thousand feet ("2,500 FT ... @ USD 189.00/M = USD 472.50").
- `history.json`: the payment history the bills were run with (one booked bill, with its sender).

Two bills the controller described but did not keep as files are reconstructed here from the clean bill exactly as the review
describes the edit, and are marked as reconstructions, not copies:

- `A-1p.txt`: `A-clean.txt` with the breaker line written "20A 1P BREAKER" (the review: "my clean Lone Star Electric bill as
  first written: '20A 1P BREAKER' against PO 'Breaker 20A single pole'").
- `A-subtotal.txt`: `A-clean.txt` with a "Subtotal: USD 8,878.00" line before the tax line (the review: "same bill, breaker
  spelled out, with a 'Subtotal: USD 8,878.00' line").

Both reproduce the review's answers on the old ruleset (a line match "too weakly to check (score 0.3)"; a subtotal "not a line
item, the total, freight, or a known stray").

| file | sha256 |
|---|---|
| `A-1p.txt` (reconstructed) | `9ab7d3bbc74b5a2244c9eeda06822ff8948ad0158a310ea421dfc48e2ecd02ce` |
| `A-clean.txt` | `7479fd121c230de49bf2d9f9daf842f83615a20ab0046d739b8f2f6ffaa1681a` |
| `A-subtotal.txt` (reconstructed) | `7d7a42e61a2ae6a2fe9556e7abfd3f51abdfd59674463bb55e8bf5355fb90a6a` |
| `B1-bank-explicit.txt` | `21973f44f6c65fb04d5d3b5f9e3f871680bf6b4dc0ea32740845f0f75518828c` |
| `B2-bank-subtle.txt` | `63802b05d622f99dcabb6dae041b05bc486f39a1aad40b378d07be8d09225ced` |
| `B3-bank-w9.txt` | `9e58244df2109b17175b06b3c2e0c79bc4d687783f21ec5ff4b8e1d27a91e589` |
| `C-lookalike-domain.txt` | `d66114093feae9fe57d2b337a3558338e9060c0b6aee94ec2828f7857e32ff91` |
| `H-numeric-invno.txt` | `26967d301fe06002472dc7b633687253cbc469b9d1286b51f97752948133d39c` |
| `R1.txt` | `725f190872a8ead76a2b563bc1a5e5135194af1329f17dd0b659d28ed5a25b4b` |
| `R2.txt` | `ca7db55df47ee214e97063c2ce079f630d2eaba3bdd32bfa2fe4021a9e7fe5a9` |
| `R3.txt` | `5a3c11e6842d0a7ae2163293cab62e9b69e294f0cff5d2b2803970c894ecc373` |
| `W-wire-perM.txt` | `e449289c1f2499bf0bec061d6f8e8ca824560c70efc1f68c4ab40ece4b6cc1d6` |
| `history.json` | `2a4ce76571d19bdf5324eabb74253b66c5317712047f268e995650acc6cfb81a` |
