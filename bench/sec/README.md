# SEC filings harness

This directory reproduces every number in [`packages/verify/docs/BENCHMARK-SEC.md`](../../packages/verify/docs/BENCHMARK-SEC.md)
from the SEC's public Financial Statement Data Sets. Run everything from the repository root after
`npm install && npm run build`.

## What's here

- **Pre-registrations, verbatim, frozen before the data they test:**
  - [`PREREG-SEC-CHECK.md`](PREREG-SEC-CHECK.md): the blind v0.1 run.
  - [`ADDENDUM-V02.md`](ADDENDUM-V02.md): v0.2 and its held-out test. It includes amendment A1 and an append-only log of
    the code freeze, the download and the verdict.
  - [`PREREG-SEC-MINE.md`](PREREG-SEC-MINE.md): the rule-mining study, with amendment A1 and its log.
- **Results:** [`RESULTS.md`](RESULTS.md), [`RESULTS-V02.md`](RESULTS-V02.md), [`RESULTS-MINE.md`](RESULTS-MINE.md).
  Each one lists every audited filing with its EDGAR link.
- **Scripts** that produced them, and the small published outputs in `results/`: the seeded audit samples, automated
  audit classes, hand labels with written reasons, the final audit tables, summaries, and the mining case tables.
- **Paths in the frozen documents** refer to where the files lived when they were written. The texts are otherwise
  unchanged, so their sha256 values can be checked.

## 0. Check the freezes

Each amendment and log entry was appended to the end of its pre-registration, below a `---` line. The original text is
the prefix before the first amendment, so its hash can be checked:

```bash
sha256sum bench/sec/PREREG-SEC-CHECK.md    # dfb646fb… (never amended)
node -e "const f=require('fs'),c=require('crypto');for(const n of ['ADDENDUM-V02','PREREG-SEC-MINE']){const s=f.readFileSync('bench/sec/'+n+'.md');console.log(n,c.createHash('sha256').update(s.subarray(0,s.indexOf('\n---\n\n## AMENDMENT A1'))).digest('hex'))}"
# ADDENDUM-V02     777bfc2803993340f0e4a722ea9dd94b451c8896b7cb51e843c01067bb5d3550
# PREREG-SEC-MINE  bb91776d7ee89c43bfdb9ac60061855485feccbecadeba1a963a0c609a04c0cb
```

## 1. Get the data (about 260 MB zipped)

The SEC requires a descriptive User-Agent with a contact address.

```bash
mkdir -p bench/sec/data/2025q1
UA="your-name your@email"
curl -A "$UA" -o bench/sec/data/2026q1.zip https://www.sec.gov/files/dera/data/financial-statement-data-sets/2026q1.zip
curl -A "$UA" -o bench/sec/data/2025q1/2025q1.zip https://www.sec.gov/files/dera/data/financial-statement-data-sets/2025q1.zip
curl -A "$UA" --compressed -o bench/sec/data/frames-EntityPublicFloat-USD-CY2025Q2I.json https://data.sec.gov/api/xbrl/frames/dei/EntityPublicFloat/USD/CY2025Q2I.json
sha256sum bench/sec/data/2026q1.zip          # d18c01c615da8f5cd46273b0dacaeee5b1163f4089171da0f84153a5f3c362f6
sha256sum bench/sec/data/2025q1/2025q1.zip   # 4386e7057cc216b6fc729d8f957998acb831d29be7b16f6d8ed0f6b1ab74eba5
(cd bench/sec/data && unzip -o 2026q1.zip sub.txt num.txt pre.txt tag.txt)
(cd bench/sec/data/2025q1 && unzip -o 2025q1.zip sub.txt num.txt pre.txt tag.txt)
```

The frames API returns the latest facts, so a later download can differ from the published file. Its published
sha256 is `2ee33f34fb934712cfdb4011d283877f5cab3ce0eb25e3f7831e8ec6ab0a7b2c` (fetched 2026-09-24).

## 2. Re-run

```bash
# blind v0.1 on 2026q1 → results.jsonl, fails.jsonl, summary.json, then the seeded audit
npx tsx bench/sec/sec-run.mts
python bench/sec/audit_sample.py && npx tsx bench/sec/audit.mts && npx tsx bench/sec/audit-assist.mts

# v0.1 and v0.2 on the held-out 2025q1, then its audit
npx tsx bench/sec/sec-run-v02.mts 2025q1
python bench/sec/audit_sample_v02.py && npx tsx bench/sec/audit-v02.mts && npx tsx bench/sec/audit-assist-v02.mts && python bench/sec/audit_final_v02.py

# rule mining (needs 2026q1, 2025q1 and the float frame)
npx tsx bench/sec/sec-mine.mts && npx tsx bench/sec/sec-mine-explore.mts
```

Outputs are written next to the scripts. Compare them with `results/`. The automated audit steps are deterministic.
The hand labels (`results/manual-labels*.json`) are the human part, and each one gives its reason.
