# Scope: cold review, round 4

Four outside readers, AI agents that had not worked on this project (a controller, a security-minded platform engineer, a legal-operations director, a methods reviewer), were each given the pack cold for one hour and asked to break it; every documentation, message and method defect they reported, and every engine defect they found, is a row here, one per distinct defect, with the readers' roles in the description.

This folder holds a bench table that records misses only. It is not a preregistered run: it has no bar, no counts and
no verdict. The bench tool requires a hashed document in the prereg's place, and this note is that document. It was
written on 2026-10-05, after the events it describes, and hashed when it was written (`SCOPE.sha256`). It reads NEEDS
STAMP on the bench page until a timestamp authority stamps it, and a stamp can then show only that the note existed by
then.

**What the review was.** Four AI agents (Claude Opus 5.5, `claude-opus-5-5`), none of which had worked on this
project, each read a copy of the public tree in one reader's role: J1 a controller at a construction subcontractor, J2 a
platform engineer before procurement, J3 a legal-operations director at a law firm, J4 a methods reviewer for a venue
that would receive the authors' preprint. Each wrote one report: a friction log, the claims it could not back up, the
fixes it wanted first, and what it ran. With the copy each reviewer was handed a page of replay instructions,
`REPLAYERS.md`; some rows cite it, and it is not part of this tree. The reports also name working folders on the
authors' machine, so they do not ship: their sha256 are in `REPORTS.sha256`, and the table lists them as hashed, not
shipped.

**What the table counts.** Every documentation, message and method defect in the four reports (friction logs, the
claims a reviewer could not back up, the fixes asked for first, and the missing pieces), and the engine defects the
reviewers found, one row per distinct defect. A defect several reviewers logged is one row naming each of them. A defect
an earlier round's table already holds is a row here again when a reader of this round logged it on the released tree:
each round's table records what that round's readers reported. Kinds: docs-defect, message-defect, method, engine.
5 items are not rows, because they are not defects of the tree (a reader's own slip, a limit the reader
recorded as documented, a licence question for a firm, terms only the publisher can offer, and judgments of the product
as a whole); `FINDINGS.md` lists each with the reason. The rows were written on 2026-10-05 from the four reports, and
`FINDINGS.md` is that transcription. When the rows were written, no fix for them had reached a released tree, so every
row is open.

**Fixed.** A row is marked fixed only when the defect as described is gone from a released tree, checked in that
tree (the copy handed to a later round's reviewers) and in the sources after it; a partial fix, or a disclosure where the
row asks for a fix, stays open. The ledger never drops or changes a row. A fix may be added to an open row later, and a
recorded fix never changes.

**What it does not count.** A reviewer's judgment of the product as a whole (whether it would meet again, trust,
clarity), and the questions only the publisher can answer.
