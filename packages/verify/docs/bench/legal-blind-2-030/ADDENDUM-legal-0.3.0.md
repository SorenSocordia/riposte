# Addendum: legal@0.3.0 on half B (T3-C, tank round 3, 2026-10-05), written before this run

**What this is not.** It is not the 0.3.0 candidate PREREG.md section 6 provides for. That slot was for legal@0.2.0's limits
tuned on half A and frozen before half B. Tuning moved no limit (`results/FREEZE.json`), so that candidate never existed.
Half B ran once, under every rule, at 14:26Z, as the prereg requires. Nothing in `results/` is re-run or changed.

**What this is.** legal@0.3.0 is a different change, built after half B's numbers were published. It came from an outside
reviewer's adversarial brief, and it makes four changes:

- it binds a text by its caption;
- it leaves a parties-only binding open;
- it guards conditions at a quotation's edges;
- it compares letter case.

It was not tuned on this set. Its outcomes on half B were already seen once, in T3-C's post-hoc regression at about 13:30 EDT
(`legal-0.3.0.json` beside this file), so this run is **post-hoc, not blind**.

**The run.** It covers the 10 controls and 10 known-bads of half B in `items/MANIFEST.json`, unchanged, with each source
checked against its manifest sha256. It runs legal@0.3.0 under engine 0.6.0, one citation per verdict, with the clock fixed
at 2026-10-05T00:00:00Z as in `harness/run.ts`. Scoring is PREREG.md section 6, unchanged: rates per label, Wilson 95%
intervals, and the loss J. The scoring functions are copied from `harness/run.ts` into `run-halfB-030.ts`, beside this file.

**What decides the default** (the lead's rule, applied in docs/LEGAL.md):

1. The default is the version with the lowest upper bound on known-bad quotations passed.
2. A tie goes to the version with fewer false FAILs.
3. A version that closes a false-PASS class an outside reviewer found may take the default the same day. Its half-B row is
   then published with it, and the date of the change is named.

If 0.3.0 does worse than 0.2.0 on controls by more than the interval, that is printed and discussed before shipping.
