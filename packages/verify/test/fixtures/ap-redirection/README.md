# Emailed bills, structured bills and pay applications from a cold review (2026-10-06)

Written by a cold reader: an AI agent, in the role of a controller at a mechanical and electrical subcontractor, who had not
worked on this tree. Every company, number, address and person in them is made up. They are kept as written, except that one
item in the thirteen text bills reads "first aid case" (the checks match lines by their words and figures, and no result
depends on it), and one file name lost a dot (`T7-tld-swap-co.txt`).

- `text/T1` to `text/T13`: one emailed bill for "Aldine Janitorial", against its order and goods receipt, sent thirteen
  ways. T1 is clean. T2 and T3 ask to change bank details; T4 says to pay online at a link; T5 says to send payment by Zelle
  to a Gmail address; T6 comes from `aldine-jan.com`, T7 from `aldinejan.co`, T8 from a Gmail address, T13 from
  `aidinejan.com`; T10 comes from `aldinejan.co` against an order naming `ar@aldinejan.com`. T9 comes from a billing platform's
  domain, T11 prints a remit-to post office box, T12 prints the vendor's ACH details on every bill. Run with an empty payment
  history.
- `ap/L3`: a second shipment of 20 billed at the same amount as the first, the purchase order line recording 20 invoiced
  earlier against 40 received. `ap/F10`: tax billed at 2,075.20 where 8.25% of the lines is 2,036.51. `ap/L9`: tax two cents
  off, as a vendor rounding per line might bill it. `ap/F9`: every price 1.9% over the order (within the default tolerance).
- `payapp/P5`: a new change-order line marked "(pending owner approval)". `payapp/P10`: 10% retained on completed work and 0%
  on stored material, stated as the G702's own split. `payapp/P10b`: the same retainage with one 10% rate stated. Run against
  the shipped previous application (`docs/examples/payapp-g702-g703.previous.json`).
