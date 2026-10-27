# Scope: cold review, round 1

Four outside readers, AI agents that had not worked on this project (a controller, a security-minded platform engineer, a legal-operations director, a methods reviewer), were each given the pack cold for one hour and asked to break it; the documentation and message defects in their friction logs are rows here, one per item, with the reader's role in the description (`FINDINGS.md` lists the items left out, and why).

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

**What the table counts.** The documentation and message defects in the four reports' friction logs, one row per item a
reviewer logged: an item two reviewers logged is two rows. Each description begins with its reviewer. The rows were
written on 2026-10-05, after the round, from the four reports, and `FINDINGS.md` is that transcription. 12 friction
items were left out because they are not documentation or message defects (a packaging gap, a reviewer's own slip, a
default the engine chose); `FINDINGS.md` lists each with the reason.

**Fixed.** A row is marked fixed only when the defect as described is gone from a released tree, checked in that
tree (the copy handed to a later round's reviewers) and in the sources after it; a partial fix, or a disclosure where the
row asks for a fix, stays open. The ledger never drops or changes a row. A fix may be added to an open row later, and a
recorded fix never changes.

**What it does not count.** A reviewer's judgment of the product as a whole (whether it would meet again, trust,
clarity), and the questions only the publisher can answer.
