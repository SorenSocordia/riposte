# Scope: cold review, round 10

Four cold readers (AI agents that had not worked on this tree: a controller, a security-minded platform engineer, a legal-operations director, a methods reviewer) were each given a copy of the public tree and a brief on the idea and the state of its build for about one hour and asked to break it; every documentation, message and method defect they reported, and every engine defect they found, is a row here, one per distinct defect, with the readers' roles in the description.

This folder holds a bench table that records misses only. It is not a preregistered run: it has no bar, no counts and no
verdict. The bench tool requires a hashed document in the prereg's place, and this note is that document. It was written
on 2026-10-20, after the events it describes, and hashed when it was written (`SCOPE.sha256`, whose time is in UTC). It
reads NEEDS STAMP on the bench page until a timestamp authority stamps it, and a stamp can then show only that the note
existed by then.

**What the review was.** The readers were AI agents, not people: four instances of Claude Opus 5.5 (`claude-opus-5-5`),
none of which had worked on this tree, each reading a copy of the public tree in one reader's role: J1 a controller at a
mechanical and electrical subcontractor, J2 a platform engineer before procurement, J3 a legal-operations director at a
mid-size law firm, J4 a methods reviewer for a venue that would receive the authors' preprint. The copy was the tree as
exported on 2026-10-19 (engine 0.7.2, an open label, with legal@0.5.4 and ap-threeway@0.3.0 the defaults), the
placeholders for the publisher, the price and the support terms kept. With it each reader was handed a brief on the idea
behind the tree and the state of its build, written for the round by another AI agent; the brief is not part of this
tree, it describes packages this tree does not hold, and some rows cite it. The first instance given J3's role stopped
before it wrote a report, and a fresh instance took the role with one added instruction, to test invented opinions and
never reproduce a real one; the report hashed here is the second one's. "Cold" means only that: no earlier contact with
the tree. It does not mean independent of the authors, who chose the roles, wrote the instructions and transcribed the
rows. Each reader wrote one report: a friction log, the claims it could not back up, the fixes it wanted first, what it
ran, and its reading of the brief's larger idea against the tool. The four reports were written on 2026-10-19, between
22:30 and 22:41 UTC by their file times. The reports also name working folders on the authors' machine, so they do not
ship: their sha256 are in `REPORTS.sha256`, and the table lists them as hashed, not shipped.

**What the table counts.** Every documentation, message and method defect in the four reports (friction logs, the claims
a reader could not back up, the fixes asked for first, and the missing pieces), and the engine defects the readers
found, one row per distinct defect. Defects in the brief they were handed are rows too, as earlier rounds' tables count
defects in the replay instructions handed out with the copy; each such row says the document was handed out with the
copy. A defect several readers logged is one row naming each of them. A defect an earlier round's table already holds is
a row here again when a reader of this round logged it on the tree it was handed: each round's table records what that
round's readers reported. Kinds: docs-defect, message-defect, method and engine. No replay instructions that count a
defect as a kill were handed out this round, so there is no kill row. Sixteen items are not rows, because they are not
defects of the tree (limits working as documented, numbers disclosed where they are printed, the readers' own errors,
conditions of fit, claims in the brief that the folder cannot check, a case a reader judged defensible, a condition for
a paper, and judgments of the product and of the larger idea as a whole); `FINDINGS.md` lists each with the reason. The
rows were written on 2026-10-20 from the four reports, and `FINDINGS.md` is that transcription.

**Fixed.** Ten of the rows carry a fix. A row carries one only when this tree's changelog, or the page the fix cites,
records the change that removes the defect as described, in the words the fix quotes; each quote was checked against
that file when the rows were written, and each fix was read against its row. A partial fix, or a disclosure where the
row asks for a fix, stays open. So does a fix that exists only as a rule a user may select: while the default a command
uses still answers as the reader found, the defect is there for anyone who runs the default. No tagged, signed release
of this tree exists yet, so "fixed" never means "fixed in a release". The ledger never drops or changes a row. A fix may
be added to an open row later, and a recorded fix never changes.

**What it does not count.** A reader's judgment of the product as a whole (whether it would meet again, trust, clarity),
and the questions only the publisher can answer.
