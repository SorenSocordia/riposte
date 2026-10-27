# H11 preregistration: a fresh blind test of verify's legal quotation rules (legal-blind-2)

Written 2026-10-05 by lane T2-C of tank round 2, before any item exists and before any engine call on any item. This file
is hashed (footer below, and `PREREG.sha256`) before the set is built. The harness that builds and runs the set is written
after this file, implements exactly the rules below, and is hashed into `PREREG.sha256` before the first engine call. Anything
changed after the first engine call is labelled AMENDED here with its reason, and the numbers made before it stay.

## 1. What is tested

The legal quotation check of `products/verify` (rule `CITE_VERBATIM`), called through the library from `src/` (the same code
the CLI, HTTP, MCP and replay call), under **engine 0.6.0**, one citation per verdict:

| rule under test | what it is |
|---|---|
| `legal@0.0.1` | the default: normalised verbatim match; under engine 0.6.0 a passage is named only on 0.1.0's rule |
| `legal@0.1.0` | reads quotation conventions (brackets, ellipses, quotation marks, parentheticals, trailing punctuation) |
| `legal@0.2.0` | 0.1.0 plus the meaning guard (altered brackets FAIL; elided conditions and reassigned inner marks abstain) |
| `legal@0.3.0` candidate | 0.2.0's reading and guard with limits tuned on half A only (section 6); it exists only if tuning moves a limit |

Each citation carries `id`, `cite` (the official U.S. Reports citation), `case_name` (CAP's `name_abbreviation`), `quote` and
`source_key`. Sources are bound to their cite by construction (section 3), so the test measures the quotation rule, not the
binding. Binding on the unheaded texts is reported separately and descriptively (section 7).

## 2. Hypotheses

- **H11a (primary).** `legal@0.2.0` certifies no known-bad item: 0 PASS among the 10 half-B known-bads. Also reported on all 20.
- **H11b (descriptive).** `legal@0.2.0`'s false-FAIL rate on half-B controls is below `legal@0.0.1`'s.
- **H11c.** The `legal@0.3.0` candidate beats `legal@0.2.0` on half B, where "beats" means both: (i) half-B known-bad PASS count
  no higher than 0.2.0's, and (ii) half-B loss J (section 6) strictly lower than 0.2.0's. Anything else is "does not beat".
- **Predictions from reading the code (not from any run):** (P1) 0.0.1 false-FAILs most controls that carry a bracket, an
  ellipsis or inner quotation marks; (P2) 0.1.0 PASSes at least one bracket-changed known-bad (its documented F1 hole);
  (P3) OCR artifacts in the CAP texts cause some control non-PASSes under every rule.

## 3. Data

**Quoting texts.** The Caselaw Access Project (CAP) static files for U.S. Reports volume 410 (1973):
`https://static.case.law/us/410/CasesMetadata.json`, then `https://static.case.law/us/410/cases/<file_name>.json`. Cases
in `first_page` order; a case is used only if it spans 10 or more pages (`last_page - first_page + 1 >= 10`). From each,
only the opinion with `type == "majority"` is scanned.

**Candidate quotations**, in order (case by case, and within a case in text order):

- a span inside double quotation marks (`“…”` or `"…"`) of 10 or more words;
- followed, within 250 characters after its closing mark, by a full citation `<volume> U. S. <page>` (spaces and periods
  optional), with no other opening quotation mark, no `Id.`/`id.`/`ibid.`, and no signal (`See`, `see`, `Cf.`, `cf.`,
  `accord`, `Compare`, `compare`, `See also`, `see also`, `But see`, `but see`) between the closing mark and that citation;
- the cited case is not the quoting case, is not excluded (section 4), and is obtainable: CAP's file for that U.S. Reports
  citation exists (looked up by exact official cite in the volume's `CasesMetadata.json`, else by `first_page`), or the
  cited case is one of the three on-disk opinions (below), whose on-disk text is used instead;
- a candidate whose quotation text repeats an earlier candidate's (normalised) is skipped;
- at most 4 candidates per quoting case, so no one opinion dominates.

The first **40** candidates are the set. If fewer than 40 exist in volume 410, volume 411 is scanned next by the same rules.

**On-disk opinion texts.** A search of `data/` (excluding sealed folders) found one usable source:
`data/oracle-corpora/law-landmark-opinions/law-landmark-opinions-1.txt`, Wikisource plain-text extracts (fetched 2026-07-05)
of Marbury v. Madison (5 U.S. 137), McCulloch v. Maryland (17 U.S. 316) and Brown v. Board of Education (347 U.S. 483),
majority opinions only. It is used when a candidate cites one of those three; each opinion's part of the file is its text.
The other legal matter in `data/` (`data/benchmarks/legal*`, `data/synthetic/legal`, activation-test files) is synthetic
contracts and briefs, not opinions. The CourtListener opinion API answered HTTP 401 ("Authentication credentials were not
provided") to an anonymous request at 2026-10-05T13:41:01Z, so CourtListener is not used; CAP static is (it is what X2 used).

**Source text per item.** For a CAP case: a header line built from CAP's own metadata, `<name_abbreviation>, <official cite>
(<year of decision_date>)`, then CAP's `head_matter`, then every opinion's text, joined by blank lines, otherwise exactly as
CAP serves it (OCR, unreviewed; nothing is corrected). For an on-disk opinion: the same header line from the reporter
citation above, then the on-disk text. The header makes every source name its cite, so binding passes by construction.

Every fetch is logged (`sources/fetch-log.jsonl`: URL, UTC time, HTTP status, bytes, sha256), and every source text's sha256
is in the manifest.

## 4. Exclusions (opinions used anywhere in existing bench items or fixtures)

A cited or quoting case is excluded when its official cite or its case name matches any authority in:
`workspace/receipts-spike/legal-blind/items/MANIFEST.json` (X2's 58 items: their cites and case names),
`products/verify/docs/bench/x2-legal-blind.json`, `products/verify/docs/bench/x2b-legal-fix.json`, the legal fixtures in
`products/verify/test/` (legal.test.ts, legal-v010.test.ts, legal-audit.test.ts, legal-060.test.ts, fixv-redteam.test.ts,
remedies.test.ts, replay-bundles.test.ts, http.test.ts), and the tank r1 legal-ops probes (Makarova, Axon, "Smith v. Jones").
The harness writes the exclusion list it applied to `items/EXCLUDED.json` before the first engine call.

## 5. Items: controls and known-bads

Candidates are numbered k = 1..40 in order and grouped in blocks of four (k = 4b-3 .. 4b, b = 1..10).

- **Control** (odd k, 20 items): the quotation exactly as the quoting opinion prints it, inner conventions included
  (brackets, ellipses, inner single marks), the outer quotation marks dropped, OCR text as served. A control's label is
  "accurate" on the quoting opinion's word; it is not audited before the run.
- **Known-bad** (even k, 20 items), made from that candidate's genuine quotation by one operator. The j-th known-bad
  (j = k/2) takes operator `[altered, elided, fabricated, bracket-changed][(j-1) mod 4]`:
  - **altered**: the middle-most word of 5 or more letters that is not in the first or last two words is replaced, unmarked,
    by the first word of this list whose lowercase form differs from it: `reasonable, substantial, material, adequate,
    exclusive, ordinary, judicial, federal, criminal, primary`;
  - **elided**: if the quotation holds one of `not, no, never, only, unless, except, without, any, all, every, solely, if`
    (whole word, case aside), the first one is removed together with the rest of its clause up to the next comma, semicolon
    or end, and replaced by an ellipsis ` . . . `; else the two middle-most words are removed silently (no ellipsis);
  - **fabricated**: the quotation is replaced by the genuine quotation of the next candidate (k+1, wrapping to k = 1) whose
    cited opinion differs, attributed to this candidate's cite; if that text happens to occur in this item's source
    (normalised: case, whitespace, quotation marks), the next one is taken;
  - **bracket-changed**: the first modal (`must, shall, may, can, should, will, would, could, might`) is replaced by a
    bracketed different modal (`must↔may`, `shall↔may`, `can↔cannot`, `should↔need not`, `will↔may`, `would↔might`,
    `could↔could not`, `might↔must`); with no modal, the word chosen as for "altered" is replaced by the bracketed list word.
  A known-bad is bad by construction: its words are not what the cited opinion says, or it changes what it says.
- **Halves.** Blocks go to halves in the order A, B, B, A, A, B, B, A, A, B. Each half has 10 controls and 10 known-bads and
  every operator. A cited opinion may appear in both halves; that overlap is reported.

## 6. Scoring, intervals, tuning, stopping

**Per rule and half:**
- known-bad false-PASS rate = known-bads that PASS / known-bads (FAIL and ABSTAIN are both correct non-PASS answers);
- control false-FAIL rate = controls that FAIL / controls; control PASS and ABSTAIN rates are reported beside it;
- known-bad FAIL and ABSTAIN rates, reported;
- every rate with a Wilson 95% interval (z = 1.96).

**Loss** on a set: J = 10 × (known-bad PASS) + 1 × (control FAIL) + 0.5 × (control ABSTAIN) + 0.25 × (known-bad ABSTAIN).

**Tuning (half A only; golden-section).** The candidate starts from legal@0.2.0's limits. Three limits are tuned one after
another, each with the others fixed at their current values, by golden-section search over its range:
1. `ellipsisChars` over [150, 2400], integers (0.2.0: 600);
2. `bracketChars` over [15, 120], integers (0.2.0: 40);
3. `nearestSimilarity` over [0.30, 0.80], steps of 0.01 (0.2.0: 0.5).
Each search runs 8 golden-section iterations (interior points at the golden ratio, the interval narrowed toward the lower
J; on a tie, toward the 0.2.0 value). The chosen value is the one with the lowest half-A J among every point evaluated and
the 0.2.0 value; ties go to the value nearest the 0.2.0 value, then to the smaller. If no limit moves, there is no distinct
0.3.0 candidate, H11c is "does not beat", and nothing new is shipped. Half B is never evaluated during tuning.

**Freeze, then half B once.** The candidate's limits are written to `results/FREEZE.json` with its sha256 before half B is
run. Half B is run once, under all four rules, in one invocation; its numbers are reported as they fall. Only a harness crash
(no verdict produced) allows a re-run of the identical command, recorded.

**Stopping rule.** Exactly 40 items. None is added, dropped, relabelled or edited after the first engine call. A label error
found in the post-run audit is reported next to the blind number, never in place of it.

**Post-run audit.** Every control that does not PASS and every known-bad that PASSes, under every rule, is read by hand
against the source and classed: (a) label error (the quoting opinion misquoted, or the operator did not in fact change the
words), (b) a quotation convention the rule does not read, (c) a text artifact (OCR, page break, footnote), (d) other.

## 7. Also reported (descriptive, no bar)

Binding without the header line: how many of the 40 items' sources name their cite under engine 0.6.0's binding rule when
the header line is removed (CAP head matter and opinion text only), under `legal@0.2.0`.

## 8. Outputs

`items/MANIFEST.json` (items, labels, operators, halves, source sha256s), `items/EXCLUDED.json`, `sources/` (raw files and
the fetch log), `results/run-halfA.json`, `results/tuning.json`, `results/FREEZE.json`, `results/run-halfB.json`,
`RESULTS.md`. The legal default stays `legal@0.0.1` whatever the numbers are; any change is the owner's ruling.

---
sha256 of everything above this line (the prereg body, as written before the set was built): `bfaf202aab0f5b5155c5d8b994c9637dfa4a71941f06beb875ae465812c1259e`, hashed 2026-10-05T14:00:36Z.
