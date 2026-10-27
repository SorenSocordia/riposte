# AP and pay-application cases from a cold review (2026-10-05)

Written by a cold reader: an AI agent, in the role of a controller at a mechanical and electrical subcontractor, that had not
worked on this tree (the folder keeps its earlier name, "outside review", so the tests that read it are unchanged). Every
company, number and person in them is made up. They are kept as written, except that one PO line description reads "EMT fittings set"
(the checks match lines by id, so no result depends on it):

- `01-clean.json`: a clean bill against a known, empty book (approve).
- `03-exact-dup.json`: the same invoice number already paid (hold_duplicate).
- `05-partial-overbill.json`: a second bill on a PO line already billed and paid in full; the order still has room by amount
  (approve; the answer names the per-line netting gap under "Not checked").
- `06-wrong-vendor.json`: a bill from another company against a PO placed with a named vendor (a person decides).
- `07-inflated-tax.json`: a $1,490 tax on a PO that states no tax terms (a person decides).
- `08-freight.json`: freight on a PO that does not allow freight (hold_total).
- `17-freight-po-silent.json`: freight on a PO that does not say (a person decides; approve under `--freight allow`).
- `t2-table-layout.txt`, `t5-legit-footer.txt`: free-text bills from the PO's vendor (approve).
- `t3-wrong-vendor-sneaky-line.txt`, `t3b-wrong-vendor-no-bank-line.txt`: free-text bills from another company, one with a
  bank-account number on a "please remit" line (a person decides, for the vendor).
- `p2-retainage-5pct.json`: a G702/G703 stating 10% retainage that retains 5% on every line (a person decides).
