"""ADDENDUM-V02 held-out precision audit: a seeded sample of up to 10 v0.2 FAILs per check.

Copy of audit_sample.py (the blind v0.1 audit's sampler). Differences, per ADDENDUM-V02.md "Test", and nothing else:
  - input  fails.jsonl        -> fails-2025q1-v02.jsonl   (v0.2 FAILs on the held-out quarter 2025q1)
  - seed   20260924           -> 20250101                 (random.Random(20250101), as the addendum states)
  - output audit-sample.jsonl -> audit-sample-2025q1-v02.jsonl
Row format: the sampler reads only `check` and `adsh`, which both row formats carry, so no field names needed adapting.
Per-check logic unchanged: pool = that check's FAIL rows sorted by adsh; all of them if <= 10, else Random(seed).sample(pool, 10)
with a fresh Random(seed) per check, checks visited in sorted order.
"""
import json, random, collections
rows = [json.loads(l) for l in open("fails-2025q1-v02.jsonl", encoding="utf-8") if l.strip()]
by = collections.defaultdict(list)
for r in rows:
    by[r["check"]].append(r)
out = []
for check in sorted(by):
    pool = sorted(by[check], key=lambda r: r["adsh"])
    pick = pool if len(pool) <= 10 else random.Random(20250101).sample(pool, 10)
    out += pick
    print(f"{check:28} fails={len(pool):5}  sampled={len(pick)}")
with open("audit-sample-2025q1-v02.jsonl", "w", encoding="utf-8") as f:
    for r in out:
        f.write(json.dumps(r) + "\n")
print("total sampled:", len(out))
