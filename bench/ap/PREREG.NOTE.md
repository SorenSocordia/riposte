# A note on `PREREG.md`, written 2026-10-06

`PREREG.md` is shipped as it was frozen, apart from one path its line 5 marks as updated for this repository. This note
corrects its first line. It does not change the file.

**What the header says.** "PRE-REGISTRATION (frozen 2026-09-23 ~08:55, before any run)".

**What the record shows.** The authors' file times, archived with their sha256 in
[`packages/verify/docs/bench/ap-blind/PROVENANCE.md`](../../packages/verify/docs/bench/ap-blind/PROVENANCE.md) ("The order of
events those times give"):

| event | time (UTC, 2026-09-23) |
|---|---|
| `PREREG.md` created | 12:47:22.056 |
| `PREREG.md` last written | 12:49:17.155 |
| `results/run-1.jsonl` written (run 1, the headline) | 12:49:17.658 |
| `threeway-v1.frozen.ts` written | 12:49:55.374 |
| the header's own time, "~08:55" local | about 12:55 |

**What that means.**
- The header's time is an estimate the authors typed into the file. Read literally, it places the freeze about six minutes
  after run 1, so it does not support "before any run".
- By the file times, the prereg's last write came half a second before run 1's results. Those times come from the authors'
  own machine. Nobody outside it saw the file before the run.
- The prereg's sha256 was never recorded, before or after the run. So even the file times cannot show that the text in this
  folder is the text that existed before the run; the record does not reach that far.
- The tier follows from that. The run is not a bench table (`verify bench emit` refuses it, and the refusal stays on the
  refused list in `packages/verify/docs/BENCH.md`). Its numbers are printed under "Rows outside the bench rule" as
  "transcribed; provenance archived; prereg unhashed". We do not call it preregistered.
- No hash is taken now, on purpose. A hash made today would prove the text from today on, never that it came before the run.
