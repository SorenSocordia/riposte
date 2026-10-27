# Scope: cold review, round 2

Four outside readers, AI agents that had not worked on this project (a controller, a security-minded platform engineer, a legal-operations director, a methods reviewer), were each given the pack cold for one hour and asked to break it; the defects named in the written summary of the round are rows here, one per distinct defect, with the readers' roles in the description.

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

**What the table counts.** The defects in the written summary of round 2, the fixes named by two or more reviewers and
the single-reviewer findings that are defects by the project's own rules, split into one row per distinct defect. A
defect several reviewers logged is one row naming each reviewer whose report logged it, checked against the four reports.
Kinds: docs-defect, message-defect, method, engine (code, tests and the command line). `FINDINGS.md` is the transcription.
A few friction items that the summary did not carry are not rows here.

**Fixed.** A row is marked fixed only when the defect as described is gone from a released tree, checked in that
tree (the copy handed to a later round's reviewers) and in the sources after it; a partial fix, or a disclosure where the
row asks for a fix, stays open. The ledger never drops or changes a row. A fix may be added to an open row later, and a
recorded fix never changes.

**What it does not count.** A reviewer's judgment of the product as a whole (whether it would meet again, trust,
clarity), and the questions only the publisher can answer.
