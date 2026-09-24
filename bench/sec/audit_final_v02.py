"""ADDENDUM-V02 held-out audit, final step: merge the automated classes (audit-results-2025q1-v02.jsonl, written by
audit-v02.mts; the assist's verbatim rounding rule fired on 0 rows so the file is unchanged) with the hand labels
(manual-labels-2025q1-v02.json) -> audit-final-2025q1-v02.jsonl, then compute precision per check and overall and
evaluate the pre-registered pass bar exactly as ADDENDUM-V02.md states it.

    python audit_final_v02.py

Precision (PREREG-SEC-CHECK.md): (T1 + T2) / audited. Conservative: U counted as a false alarm. Optimistic: U counted
as correct. Pass bar (ADDENDUM-V02.md): conservative precision >= 50% over all audited flags AND v0.2 keeps >= 80% of
v0.1's PASS decisions on BS_LIAB_AND_EQUITY_TOTAL, IS_GROSS_PROFIT and CF_ENDING_CASH (both readings of "keeps" are
reported; summary-2025q1-v02.json pass_bar_coverage_checks).
"""
import json, collections

auto = [json.loads(l) for l in open("audit-results-2025q1-v02.jsonl", encoding="utf-8") if l.strip()]
labels = json.load(open("manual-labels-2025q1-v02.json", encoding="utf-8"))
labels.pop("_note")
summary = json.load(open("summary-2025q1-v02.json", encoding="utf-8"))

# hand-verification notes on AUTOMATED rows (reported as sensitivity; they do NOT change the primary classes)
AUTO_NOTES = {
    "0000874761-25-000013|CF_NET_CHANGE": ("T3", "hand check: the negation match is a coincidence (49m vs -48m within the 5m tolerance); the filing's own custom CF line '(Increase) decrease in cash, cash equivalents and restricted cash of held-for-sale businesses' = 97m = gap, so the flag is a disposal-group structural false alarm (T3)"),
    "0001477932-25-000201|IS_NET_INCOME": ("T2", "hand check: ProfitLoss (+21,752) is tagged on the CF line 'Net (loss) income' while the income statement's net loss is -21,752: a sign error in the filing (T2); the T4 rule fired first because NetIncomeLoss closes the identity"),
    "0001274494-25-000010|IS_OPERATING_INCOME": ("T3", "hand check: the exact explanation is 'Gain on sales of businesses, net' 1,115,000 (GainLossOnSaleOfBusiness) inside operating income; the auto-matched AssetImpairmentCharges (1,360,000) is only within tolerance; class unchanged (T3)"),
}
# hand labels that apply a class to a pattern with NO direct blind-audit precedent (sensitivity: all as false alarms)
NEW_PATTERN_T2 = {"0001497645-25-000013|BS_ACCOUNTING_EQUATION", "0001793229-25-000022|XSTMT_CASH_ARTICULATION",
                  "0001819989-25-000005|XSTMT_CASH_ARTICULATION", "0000927089-25-000064|IS_NET_INCOME",
                  "0001580808-25-000043|IS_COMPREHENSIVE_INCOME", "0000950170-25-047891|IS_NET_INCOME"}

final, used = [], set()
for r in auto:
    key = f"{r['adsh']}|{r['check']}"
    if r["class"] == "UNEXPLAINED":
        if key not in labels:
            raise SystemExit(f"missing hand label for {key}")
        cls, reason = labels[key]; src = "hand"; used.add(key)
    else:
        cls, reason, src = r["class"], r["why"], "auto"
    row = {"check": r["check"], "adsh": r["adsh"], "name": r["name"], "link": r["link"], "gap": r["gap"], "class": cls,
           "reason": reason, "source": src, "formula": r["formula"], "tolerance": r["tolerance"], "v01_outcome": r["v01_outcome"]}
    if key in AUTO_NOTES:
        row["hand_check_class"], row["hand_check_note"] = AUTO_NOTES[key]
    if r.get("class_mechanical_t2") and r["class_mechanical_t2"] != r["class"]:
        row["audit_mts_identical_auto_class"] = r["class_mechanical_t2"]
    final.append(row)
extra = set(labels) - used
if extra:
    raise SystemExit(f"hand labels for rows that are not UNEXPLAINED: {sorted(extra)}")
assert len(final) == 80, len(final)
with open("audit-final-2025q1-v02.jsonl", "w", encoding="utf-8") as f:
    for row in final:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")

CLS = ["T1", "T2", "T3", "T4", "U"]
def table(rows, cls_of=lambda r: r["class"]):
    by = collections.defaultdict(lambda: collections.Counter())
    for r in rows:
        by[r["check"]][cls_of(r)] += 1
    return by
def prec(c):
    n = sum(c.values()); ok = c["T1"] + c["T2"]
    return n, ok / n, (ok + c["U"]) / n
pct = lambda x: f"{100 * x:.1f}%"

by = table(final)
tot = collections.Counter()
lines = ["| check | v0.2 FAILs (population) | audited | T1 | T2 | T3 | T4 | U | precision, U as false alarm ... U as correct |", "|---|---|---|---|---|---|---|---|---|"]
for check in sorted(by):
    c = by[check]; tot.update(c); n, lo, hi = prec(c)
    pop = summary["per_check"][check]["v02"]["FAIL"]
    lines.append(f"| {check} | {pop} | {n} | {c['T1']} | {c['T2']} | {c['T3']} | {c['T4']} | {c['U']} | {pct(lo)} ... {pct(hi)} |")
n, lo, hi = prec(tot)
pop_total = sum(summary["per_check"][k]["v02"]["FAIL"] for k in summary["per_check"])
lines.append(f"| **all** | **{pop_total}** | **{n}** | **{tot['T1']}** | **{tot['T2']}** | **{tot['T3']}** | **{tot['T4']}** | **{tot['U']}** | **{pct(lo)} ... {pct(hi)}** |")
print("\n".join(lines))

# pass bar
cov = summary["pass_bar_coverage_checks"]
cov_min_filing = min(v["same_filing_still_pass"] for v in cov.values())
cov_min_count = min(v["pass_count_ratio"] for v in cov.values())
bar_prec = lo >= 0.50
bar_cov = cov_min_filing >= 0.80 and cov_min_count >= 0.80
print(f"\nPASS BAR: conservative precision {pct(lo)} (need >= 50%): {'MET' if bar_prec else 'MISSED'}; "
      f"coverage min per-filing {pct(cov_min_filing)}, min count-ratio {pct(cov_min_count)} (need >= 80%): {'MET' if bar_cov else 'MISSED'}"
      f" -> VERDICT {'PASS' if bar_prec and bar_cov else 'FAIL'}")
print("coverage:", json.dumps(cov))
print("structural flag-rate change:", json.dumps(summary["structural_checks_flag_rate_change"]))

# sensitivities (descriptive; NOT the pre-registered primary)
def overall(cls_of):
    c = collections.Counter(cls_of(r) for r in final); return prec(c)
s1 = overall(lambda r: r.get("hand_check_class", r["class"]))
s2 = overall(lambda r: "T3" if f"{r['adsh']}|{r['check']}" in NEW_PATTERN_T2 else r["class"])
s3 = overall(lambda r: r.get("audit_mts_identical_auto_class", r["class"]) if r.get("audit_mts_identical_auto_class") else r["class"])
w_lo = sum(summary["per_check"][k]["v02"]["FAIL"] * prec(by[k])[1] for k in by) / pop_total
w_hi = sum(summary["per_check"][k]["v02"]["FAIL"] * prec(by[k])[2] for k in by) / pop_total
print(f"\nSENSITIVITY auto labels hand-verified (AES->T3, Kingfish->T2, First Solar unchanged): {pct(s1[1])} ... {pct(s1[2])}")
print(f"SENSITIVITY the 6 new-pattern T2 hand labels counted as false alarms: {pct(s2[1])} ... {pct(s2[2])}")
print(f"SENSITIVITY guard D9 off (audit.mts-identical T2 for Summit, Longevity): {pct(s3[1])} ... {pct(s3[2])}")
print(f"DESCRIPTIVE per-check precision weighted by the population's v0.2 FAIL counts: {pct(w_lo)} ... {pct(w_hi)}")
t2 = sum(1 for r in final if r["class"] == "T2"); t3 = sum(1 for r in final if r["class"] == "T3")
print(f"PREDICTION 'most v0.2 FAILs are T2': T2 = {t2}/80, T3 = {t3}/80 -> {'confirmed' if t2 > 40 else 'NOT confirmed'}")
