# Scope: cold review, round 8

Four cold readers (AI agents that had not worked on this tree: a controller, a security-minded platform engineer, a legal-operations director, a methods reviewer) were each given a copy of the public tree for about one hour and asked to break it; every documentation, message and method defect they reported, and every engine defect they found, is a row here, one per distinct defect, with the readers' roles in the description.

This folder holds a bench table that records misses only. It is not a preregistered run: it has no bar, no counts and no
verdict. The bench tool requires a hashed document in the prereg's place, and this note is that document. It was written
on 2026-10-19, after the events it describes, and hashed when it was written (`SCOPE.sha256`, whose time is in UTC,
where it was already 2026-10-20). It reads NEEDS STAMP on the bench page until a timestamp authority stamps it, and a
stamp can then show only that the note existed by then.

**What the review was.** The readers were AI agents, not people: four instances of Claude Opus 5.5 (`claude-opus-5-5`),
none of which had worked on this tree, each reading a copy of the public tree in one reader's role: J1 a controller at a
mechanical and electrical subcontractor, J2 a platform engineer before procurement, J3 a legal-operations director at a
law firm, J4 a methods reviewer for a venue that would receive the authors' preprint. "Cold" means only that: no earlier
contact with the tree. It does not mean independent of the authors, who chose the roles, wrote the instructions and
transcribed the rows. Each reader wrote one report: a friction log, the claims it could not back up, the fixes it wanted
first, and what it ran. With the copy each reader was handed a page of replay instructions, `REPLAYERS.md`; some rows
cite it, and it is not part of this tree. All four reports were written on 2026-10-12, between 22:26 and 22:38 UTC by
their file times. The reports also name working folders on the authors' machine, so they do not ship: their sha256 are
in `REPORTS.sha256`, and the table lists them as hashed, not shipped. One row, r8-61, is the maintainers' own: after the
reports were read they reproduced row r8-60 and found the same build notes in ten shipped files. It is marked post-hoc,
and its source, the maintainers' record of the round, is hashed beside the reports and does not ship either.

**What the table counts.** Every documentation, message and method defect in the four reports (friction logs, the claims
a reader could not back up, the fixes asked for first, and the missing pieces), and the engine defects the readers
found, one row per distinct defect. A defect several readers logged is one row naming each of them. A defect an earlier
round's table already holds is a row here again when a reader of this round logged it on the tree it was handed: each
round's table records what that round's readers reported. Kinds: docs-defect, message-defect, method, engine, and kill,
for a defect that the replay rules the readers were handed count as breaking the replay claim; the one kill row, r8-23,
was filed as a kill by its reader, who judged it not a deal-breaker because the verdict itself is untouched. Ten items
are not rows, because they are not defects of the tree (a claim a reader could not verify, limits disclosed where they
apply, a request about a run that had not begun, conditions of fit, and judgments of the product as a whole);
`FINDINGS.md` lists each with the reason. The rows were written on 2026-10-19 from the four reports and the maintainers'
record of the round, and `FINDINGS.md` is that transcription.

**Fixed.** Forty-three of the rows carry a fix. A row carries one only when this tree's changelog, or the page the fix
cites, records the change that removes the defect as described, in the words the fix quotes; each quote was checked
against that file when the rows were written, and each fix was read against its row. A partial fix, or a disclosure
where the row asks for a fix, stays open. No tagged, signed release of this tree exists yet, so "fixed" never means
"fixed in a release". The ledger never drops or changes a row. A fix may be added to an open row later, and a recorded
fix never changes.

**What it does not count.** A reader's judgment of the product as a whole (whether it would meet again, trust, clarity),
and the questions only the publisher can answer.
