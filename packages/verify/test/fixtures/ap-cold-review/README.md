# AP and pay-application cases from a cold review (2026-10-06)

Written by cold readers: AI agents, in the roles of a controller at a mechanical and electrical subcontractor and of a
platform engineer, who had not worked on this tree. Every company, number, address and person in them is made up. They are kept
as written, except that one item in the four text bills reads "first aid case" (the checks match lines by their words and
figures, and no result depends on it).

- `ap-bec.txt`, `ap-bec2.txt`: a bill that matches its order and goods receipt, sent from a look-alike of the vendor's domain
  (`aldine-janitorial-payments.co` for "Aldine Janitorial"), whose text says the vendor's bank details have changed (one with
  an IBAN on the "please remit" line). A person decides, the controller clears it, for both the bank change and the sender.
- `ap-clean.txt`: the same bill from the vendor's own domain, with no bank change (approve, with what was not checked).
- `ap-homo.txt`: the same bill from `aidinejan.com`, a capital I for a lower-case l (a person decides, for the sender).
- `B3-dup-typo-vendor-new-id-leading-zero.json`: an invoice number already booked, written with a leading zero, under a
  vendor name with one letter off and another vendor id (a person decides; both reasons say "a look-alike vendor").
- `B12-reel-billed-twice-54-of-40.json`: a second bill for a PO line already billed 24 of 40 received; this one bills 30
  (approve without the line's invoiced quantity; a person decides with it).
- `B6-tax-wrong-rate.json`, `L1-clean-exact.json`: a taxed bill at the wrong rate, and a clean one (for the tax rule).
- `payapps/`: a month-3 G702/G703 application (`app3.previous.json`) and eight month-4 applications against it: five with an
  error (a line billed again, previous certificates understated, retainage withheld at half the rate, a line past 100%, a
  scheduled value raised with no change order) and three that are correct (stored materials read by the form's column D
  heading with a new change-order line, the same with stored materials carried in column D, and a stated reduced retainage).
