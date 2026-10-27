# Scope: the AP stress study's development-seed misses

This folder holds a bench table that records misses only. It is not a preregistered run: it has no bar, no counts and
no verdict. The bench tool requires a hashed document in the prereg's place, and this note is that document. It was
written on 2026-10-05, after the events it describes, and hashed when it was written (`SCOPE.sha256`). It reads NEEDS
STAMP on the bench page until a timestamp authority stamps it, and a stamp can then show only that the note existed by
then.

**What the misses are.** The AP stress study (`BENCHMARK-AP.md`, Result 3) perturbs the benchmark's 100 invoices in
ways that keep their meaning. Before its five holdout seeds ran, the parser was hardened on four development seeds:
`default`, `fresh1`, `fresh2` and `fresh3`. Those seeds produced five wrong decisions, all false holds: two on the
default seed, then one on each fresh seed, all three the same case. They are the rows of this table, one per wrong
decision, dated 2026-09-23, the day they ran. They are post-hoc: development rounds, run after the blind headline was read.

**Source.** The authors' stress write-up of 2026-09-23 records them. It names the authors' working folders, so it does
not ship; `REPORTS.sha256` lists it by hash, and the provenance archive (`bench/ap-blind/PROVENANCE.md`, "The
development seeds") quotes its record. `FINDINGS.md` is the transcription. The write-up names the two default-seed
cases and the perturbation kinds of their wrong decisions without pairing them, and does not name the perturbation kind
of the fresh-seed case; the rows say only what it says. The development seeds' original result files were overwritten
after the fixes and do not ship.

**Fixed.** Each row names the fix the write-up records. On 2026-10-05 the four development seeds were re-run on the
released engine 0.6.0 tree with the shipped harness (`npx tsx bench/ap/stress.ts --out <folder>`, adding `--seed fresh1`
and so on for the fresh seeds): 0 wrong on every seed, and the three cases decided right or sent to a person.
`RERUN-2026-10-05.md` holds those scorecards. Re-run, not re-banked: nothing in `bench/ap/results/` changed.

**Why this table has no numbers.** The stress study's numbers stay outside the bench rule (`BENCH.md`, "Outside the
rule"): its protocol's sha256 was never recorded before the run. This table carries its misses so the misses ledger holds
them.
