# Scope: cold review, buyers' round 2

Four cold readers (AI agents that had not worked on this tree), each in a buyer's role (the controller of a subcontractor, the head of platform and security at a mid-size company, a legal-operations director at a mid-size law firm, a programme officer who funds studies), were each given a copy of the public tree, with three documents the authors wrote about it, for about one hour and asked whether they would pilot it, at what price, what it is worth and what stands in the way; every documentation, message and method defect they reported, and every engine defect they found, is a row here, one per distinct defect, with the readers' roles in the description.

This folder holds a bench table that records misses only. It is not a preregistered run: it has no bar, no counts and no
verdict. The bench tool requires a hashed document in the prereg's place, and this note is that document. It was written
on 2026-10-20, after the events it describes, and hashed when it was written (`SCOPE.sha256`, whose time is in UTC). It
reads NEEDS STAMP on the bench page until a timestamp authority stamps it, and a stamp can then show only that the note
existed by then.

**What the review was.** The readers were AI agents, not people: four instances of Claude Opus 5.5 (`claude-opus-5-5`),
none of which had worked on this tree, each reading a copy of the public tree in one buyer's role: B1 the controller of
a 60-person mechanical and electrical subcontractor, B2 the head of platform and security at a 300-person company
weighing the paid tier, B3 a legal-operations director who owns the tooling budget at a mid-size law firm, B4 a
programme officer deciding whether to fund a six-month blind study. Each was asked whether it would pilot the product
and at what price, to walk its own organisation's purchase path step by step, to say what the work is worth now and
after a signed pilot and a measured bench, where the authors' own valuation is wrong, and what ten things it would have
the founder do first, and to name what it ran, its deal-breakers, the claims it could not back up and the missing piece.
The copy was the tree as exported on 2026-10-19 that review round 10's readers were handed the same evening, with one
difference: in each buyer's copy the three placeholders for the publisher, the price and the support terms (in README.md
and packages/receipts/PILOT.md) were replaced by a paragraph of assumptions about them, labelled as assumed. This tree
keeps the placeholders. With the copy each reader was handed three documents that are not part of this tree: the brief
on the idea and the state of the build that round 10's readers had, the authors' own valuation of the work, and a pack
of draft commercial paper (an order form, pilot terms, a security questionnaire, a page on the bill of materials and the
steps to form an entity); some rows cite them. "Cold" means only that: no earlier contact with the tree. It does not
mean independent of the authors, who chose the roles, wrote the instructions and transcribed the rows. The four reports
were written on 2026-10-19, between 23:29 and 23:34 UTC by their file times. The reports also name working folders on
the authors' machine, so they do not ship: their sha256 are in `REPORTS.sha256`, and the table lists them as hashed, not
shipped.

**What the table counts.** Every documentation, message and method defect in the four reports (the claims a reader could
not back up, the gaps it found on its purchase path, the items it needs before it would sign, and the missing pieces),
and the engine defects the readers found, one row per distinct defect. Defects in the documents they were handed with it
are rows too, as earlier rounds' tables count defects in the replay instructions handed out with the copy; each such row
says the document was handed out with the copy. A defect several readers logged is one row naming each of them. A defect
an earlier round's table already holds is a row here again when a reader of this round logged it on the tree it was
handed: each round's table records what that round's readers reported. Kinds: docs-defect, message-defect, method and
engine. No replay instructions that count a defect as a kill were handed out this round, so there is no kill row.
Thirteen items are not rows, because they are not defects of the tree (the prices, guesses and advice the round asked
for, the readers' verdicts on the valuation's frames, conditions of fit, conditions for using a partner's data or
funding the study, numbers disclosed where they are printed, defaults and limits working as documented, a market claim a
reader disputed by argument, claims a reader could not verify, and judgments of the product as a whole); `FINDINGS.md`
lists each with the reason. The rows were written on 2026-10-20 from the four reports, and `FINDINGS.md` is that
transcription.

**Fixed.** Four of the rows carry a fix. A row carries one only when this tree's changelog, or the page the fix cites,
records the change that removes the defect as described, in the words the fix quotes; each quote was checked against
that file when the rows were written, and each fix was read against its row. A partial fix, or a disclosure where the
row asks for a fix, stays open. So does a fix that exists only as a rule a user may select: while the default a command
uses still answers as the reader found, the defect is there for anyone who runs the default. No tagged, signed release
of this tree exists yet, so "fixed" never means "fixed in a release". The ledger never drops or changes a row. A fix may
be added to an open row later, and a recorded fix never changes.

**What it does not count.** A reader's judgment of the product as a whole (whether it would meet again, trust, clarity),
and the questions only the publisher can answer.
