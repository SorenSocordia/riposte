# Scope: cold review, buyers' round 1

Four cold readers (AI agents that had not worked on this tree), each in a buyer's role (the controller of a subcontractor, the head of platform and security at a mid-size company, a legal-operations director at a litigation firm, a programme officer who funds studies), were each given a copy of the public tree for about one hour and asked whether they would pilot it, at what price, and what stands in the way; every documentation, message and method defect they reported, and every engine defect they found, is a row here, one per distinct defect, with the readers' roles in the description.

This folder holds a bench table that records misses only. It is not a preregistered run: it has no bar, no counts and no
verdict. The bench tool requires a hashed document in the prereg's place, and this note is that document. It was written
on 2026-10-19, after the events it describes, and hashed when it was written (`SCOPE.sha256`, whose time is in UTC,
where it was already 2026-10-20). It reads NEEDS STAMP on the bench page until a timestamp authority stamps it, and a
stamp can then show only that the note existed by then.

**What the review was.** The readers were AI agents, not people: four instances of Claude Opus 5.5 (`claude-opus-5-5`),
none of which had worked on this tree, each reading a copy of the public tree in one buyer's role: B1 the controller of
a 60-person mechanical and electrical subcontractor, B2 the head of platform and security at a 300-person company
weighing the paid tier, B3 a legal-operations director at a mid-size litigation firm, B4 a programme officer deciding
whether to fund a six-month blind study. Each was asked whether it would pilot the product and at what price, to walk
its own organisation's purchase path step by step, and to name what it ran, its deal-breakers, the claims it could not
back up and the missing piece. The copy was the tree of 2026-10-13 that review round 9's readers were handed the same
night, with one difference: in each buyer's copy the three placeholders for the publisher, the price and the support
terms (in README.md and packages/receipts/PILOT.md) were replaced by a paragraph of assumptions about them, labelled as
assumed. This tree keeps the placeholders. The first instance given B3's role stopped before it had run anything, and a
fresh instance took the role; the report hashed here is the second one's. "Cold" means only that: no earlier contact
with the tree. It does not mean independent of the authors, who chose the roles, wrote the instructions and transcribed
the rows. With the copy each reader was handed a page of replay instructions, `REPLAYERS.md`; it is not part of this
tree. The four reports were written on 2026-10-14, between 05:07 and 05:14 UTC by their file times; their working file
names carry 2026-10-13, the date their instructions gave. The reports also name working folders on the authors' machine,
so they do not ship: their sha256 are in `REPORTS.sha256`, and the table lists them as hashed, not shipped.

**What the table counts.** Every documentation, message and method defect in the four reports (the claims a reader could
not back up, the gaps it found on its purchase path, the items it needs before it would sign, and the missing pieces),
and the engine defects the readers found, one row per distinct defect. A defect several readers logged is one row naming
each of them. A defect an earlier round's table already holds is a row here again when a reader of this round logged it
on the tree it was handed: each round's table records what that round's readers reported. Kinds: docs-defect,
message-defect, method and engine. No reader found a defect that the replay rules they were handed count as breaking the
replay claim, so there is no kill row. Twelve items are not rows, because they are not defects of the tree (the prices
and guesses the round asked for, documented limits a reader would check before signing, terms only the publisher can
offer, conditions for funding a study, claims a reader could not verify, cases a reader judged defensible, scope notes a
reader did not count as over-claims, and judgments of the product as a whole); `FINDINGS.md` lists each with the reason.
The rows were written on 2026-10-19 from the four reports, and `FINDINGS.md` is that transcription.

**Fixed.** Ten of the rows carry a fix. A row carries one only when this tree's changelog, or the page the fix cites,
records the change that removes the defect as described, in the words the fix quotes; each quote was checked against
that file when the rows were written, and each fix was read against its row. A partial fix, or a disclosure where the
row asks for a fix, stays open. No tagged, signed release of this tree exists yet, so "fixed" never means "fixed in a
release". The ledger never drops or changes a row. A fix may be added to an open row later, and a recorded fix never
changes.

**What it does not count.** A reader's judgment of the product as a whole (whether it would meet again, trust, clarity),
and the questions only the publisher can answer.
