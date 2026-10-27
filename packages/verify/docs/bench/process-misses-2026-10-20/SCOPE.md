# Scope: process misses, week of 2026-10-20 to 2026-10-26

The maintainers build this tree with AI agents: a lead agent that plans the work, writes briefs and merges what comes back, and runs, each an agent given one brief. This table records the misses the lead and the runs recorded as their own in the working process of the week from 2026-10-20 to 2026-10-26: a step taken in the wrong order, a standing rule broken, a script or command whose defect made a check refuse, left a step unrun or put a file where it did not belong, and a time or a source written without being checked. Each row is one miss. A row describes a step and what it did, never a person; each description begins with who recorded it, "the lead" or "a run".

This folder holds a bench table that records misses only. It is not a preregistered run: it has no bar, no counts and no
verdict. The bench tool requires a hashed document in the prereg's place, and this note is that document. It was written
on 2026-10-26, after the events it describes, and hashed when it was written (`SCOPE.sha256`, whose time is in UTC). It
reads NEEDS STAMP on the bench page until a timestamp authority stamps it, and a stamp can then show that the note existed
by then, and no more.

**Where the rows come from.** The lead's misses are transcribed from the maintainers' working log, which the lead writes as
the work happens, and from two notes in which the lead listed its own misses of 2026-10-20 with their hours; one miss, a
waiting script that gave up early, is also read from that script and its status file. The runs' misses are transcribed
from the kept-misses section of each run's report, for the eight runs of 2026-10-26 whose reports had landed when the rows
were written; five of them hold a miss that counts. One row was found by the run that wrote these rows, by comparing the
log with the clock. The log and the five reports were copied at 08:18:40 UTC on 2026-10-26, the log while it was still
being written, and the three other reports a few minutes later; each sha256 in `REPORTS.sha256` names the copy read, under
a name given here. The sources name working folders and private matters on the authors' machine, so they do not ship, and
the table lists them as hashed, not shipped.

**What the table counts.** Every miss the log labels as the lead's own in the week (its kept-miss, lead's-miss and
correction lines), and every kept miss of a run that broke one of the maintainers' standing rules for runs (no
version-control command; a local backup before any edit; a clock time read, never estimated; no command that names a folder
the maintainers' read guard protects), or that let a wrong result, a wrong path or a gap reach a record, a brief or another
step before it was caught. A miss a run recorded about a brief it was given is the lead's row. Not counted: an early draft
that a run corrected by its own reading or tests before anything used it, notes on the limits of a piece of work as
delivered, two log lines about matters outside the work, and a prediction of a person's choice in a matter of taste, which
is not a defect of data or code. `FINDINGS.md` lists what is left out, run by run, with the reason.

**How a row reads.** Hours are local time on the maintainers' machine (UTC-4), as the sources give them; an hour written
with a final x, such as 10:3x, means a time from 10:30 to 10:39, and a row whose source gives no hour says so. Each row is
dated by the day the miss was made, and its description says when it was found and what undid it. Kinds: method (a step, a
source or a rule) and harness defect (a defect in a script or a command the maintainers ran), and one defect (a guard
delivered with a gap). No row is post-hoc: no row comes from a study, and none was found by reading a study's results.

**Fixed.** No row carries a fix. The damage of most rows was undone within the hour, and each description says how, but
undoing the damage does not fix the miss. A row will carry a fix when this tree records a change that catches its class of
miss (a check, a test or a refusal), in the words the fix quotes, and not before. The ledger never drops or changes a row.
A fix may be added to an open row later, and a recorded fix never changes.

**What it does not count.** Misses nobody recorded, and the misses of runs whose reports had not landed when the rows were
written; those belong to the next week's table.
