# Scope: cold review, round 6

Four cold readers (AI agents that had not worked on this tree: a controller, a security-minded platform engineer, a legal-operations director, a methods reviewer) were each given a copy of the public tree for about one hour and asked to break it; every documentation, message and method defect they reported, and every engine defect they found, is a row here, one per distinct defect, with the readers' roles in the description.

This folder holds a bench table that records misses only. It is not a preregistered run: it has no bar, no counts and
no verdict. The bench tool requires a hashed document in the prereg's place, and this note is that document. It was
written on 2026-10-06, after the events it describes, and hashed when it was written (`SCOPE.sha256`). It reads NEEDS
STAMP on the bench page until a timestamp authority stamps it, and a stamp can then show only that the note existed by
then.

**What the review was.** The readers were AI agents, not people: four instances of Claude Opus 5.5
(`claude-opus-5-5`), none of which had worked on this tree, each reading a copy of the public tree in one reader's role:
J1 a controller at a construction subcontractor, J2 a platform engineer before procurement, J3 a legal-operations
director at a law firm, J4 a methods reviewer for a venue that would receive the authors' preprint. "Cold" means only
that: no earlier contact with the tree. It does not mean independent of the authors, who chose the roles, wrote the
instructions and transcribed the rows. Each reader wrote one report: a friction log, the claims it could not back up,
the fixes it wanted first, and what it ran. With the copy each reader was handed a page of replay instructions,
`REPLAYERS.md`; some rows cite it, and it is not part of this tree. All four reports were written on 2026-10-06. The
reports also name working folders on the authors' machine, so they do not ship: their sha256 are in `REPORTS.sha256`,
and the table lists them as hashed, not shipped.

**What the table counts.** Every documentation, message and method defect in the four reports (friction logs, the
claims a reader could not back up, the fixes asked for first, and the missing pieces), and the engine defects the
readers found, one row per distinct defect. A defect several readers logged is one row naming each of them. A defect an
earlier round's table already holds is a row here again when a reader of this round logged it on the tree it was
handed: each round's table records what that round's readers reported. Kinds: docs-defect, message-defect, method and
engine. No reader found a defect that the replay rules they were handed count as breaking the replay claim, so there is
no kill row. Eleven items are not rows, because they are not defects of the tree (a default working as documented, a
case the reader judged defensible, a condition of fit, the readers' own errors, claims a reader could not test, a
hedge a reader judged fair, terms only the publisher can offer, limits a reader recorded as disclosed, a judgment of
adoption, and judgments of the product as a whole); `FINDINGS.md` lists each with the reason. The rows were written on
2026-10-06 from the four reports, and `FINDINGS.md` is that transcription. When the rows were written, no fix for them
had reached a tree handed to later readers, so every row is open.

**Fixed.** A row is marked fixed only when the defect as described is gone from a later tree handed to the next
round's readers, checked in that tree and in the sources after it. No tagged, signed release of this tree exists yet,
so "fixed" never means "fixed in a release". A partial fix, or a disclosure where the row asks for a fix, stays open.
The ledger never drops or changes a row. A fix may be added to an open row later, and a recorded fix never changes.

**What it does not count.** A reader's judgment of the product as a whole (whether it would meet again, trust,
clarity), and the questions only the publisher can answer.
