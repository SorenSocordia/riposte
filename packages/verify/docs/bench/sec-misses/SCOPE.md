# Scope: the misses the SEC studies published

This folder holds a bench table that records misses only. It is not a preregistered run: it has no bar, no counts and
no verdict. The bench tool requires a hashed document in the prereg's place, and this note is that document. It was
written on 2026-10-05, after the events it describes, and hashed when it was written (`SCOPE.sha256`). It reads NEEDS
STAMP on the bench page until a timestamp authority stamps it, and a stamp can then show only that the note existed by
then.

**What the misses are.** The three SEC studies (`BENCHMARK-SEC.md`) were preregistered, run on 2026-09-24, and published
whether they passed or not. Their numbers sit outside the bench rule (`BENCH.md`, "Outside the rule"): their results are
in `bench/sec/` in the runs' own format and were never emitted as bench tables. This table carries the misses the
studies themselves report, so the misses ledger holds them: the first study's field miss (low precision on filed
statements), its failed prediction and its taxonomy gap, the second study's missed precision bar, and the rule-mining
study's two missed thresholds. None of them is fixed: they are results, published as they fell.

**Source.** `bench/sec/RESULTS.md`, `RESULTS-V02.md` and `RESULTS-MINE.md`, which ship at the repository root. Their
sha256 are in `REPORTS.sha256`, so a reader can check that the rows were typed from the files that ship. `FINDINGS.md` is
the transcription.
