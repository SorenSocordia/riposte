"""PREREG-SEC-CHECK precision audit: a seeded sample of up to 10 FAILs per check (random.Random(20260924) over FAIL rows sorted by adsh)."""
import json, random, collections
rows = [json.loads(l) for l in open("fails.jsonl", encoding="utf-8") if l.strip()]
by = collections.defaultdict(list)
for r in rows:
    by[r["check"]].append(r)
out = []
for check in sorted(by):
    pool = sorted(by[check], key=lambda r: r["adsh"])
    pick = pool if len(pool) <= 10 else random.Random(20260924).sample(pool, 10)
    out += pick
    print(f"{check:28} fails={len(pool):5}  sampled={len(pick)}")
with open("audit-sample.jsonl", "w", encoding="utf-8") as f:
    for r in out:
        f.write(json.dumps(r) + "\n")
print("total sampled:", len(out))
