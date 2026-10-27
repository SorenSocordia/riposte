# X2b preregistration: fixing the false FAILs X2 found in verify's legal quotation check

Written 2026-10-03 at about 16:25Z by lane X2b (resolved model `claude-opus-5-5`, read from the first reply's metadata in
this lane's transcript), BEFORE any change to `products/verify`. This file and the scratch harness copy are hashed into
`PREREG.sha256` before the engine is edited.

## What kind of test this is

**A post-hoc fix of a blind test. The re-run is NOT blind.** Before writing this I read X2's report, its PREREG and
RESULTS, all 58 items with their blind outcomes, the opinion passages behind every control, and the source texts behind
the known-bad items that carry brackets or an ellipsis (KB05, KB07, KB09, KB11, SP14). The fix list and thresholds were
chosen with that knowledge, and with X2's post-hoc observation in view: anchors were 3 to 5 words on every bad-quote FAIL
and 7 to 42 on every control FAIL. X2's blind numbers stay what they are. Nothing under `workspace/receipts-spike/legal-blind/`
is edited.

## Where the fix goes

- **A new ruleset version, `legal@0.1.0`, opt-in.** It is selected with `ruleset: 'legal@0.1.0'` on `verifyCitations`
  (and the same field on the HTTP and MCP citation surfaces). `legal@0.0.1` stays the default and its code path is
  untouched, so every existing 0.0.1 verdict keeps its bytes. Replay re-performs each verdict under the version it names.
- **The shared text matcher (`src/textmatch/`) is not changed.** The generic QUOTE_MATCH, declarative source checks and
  action grounding use it, so 0.1.0's reading lives in its own legal-only module.

## The fix list, exact (all under legal@0.1.0 only)

- **F1, quotation marks.** Straight, curly and angle double and single quotation marks are not compared: they are dropped on
  both sides. An apostrophe between two letters or digits is kept and compared ("plaintiff's" is not "plaintiffs").
- **F2, brackets.**
  - Quote side, first reading: brackets are dropped and their contents kept, so "[t]he" reads "the" and "[I]t" reads "it".
  - Second reading, only if the first finds nothing: each bracket stands for a short substitution. The opinion text it
    replaces is at most (words inside the brackets + 2) words and 40 characters. A bracket with no space inside, attached
    to a word, replaces part of that word only (no space), as in "serv[e]" for "serving".
  - Source side: bracket characters are dropped and their contents kept ("[The] first", "complaint[.]").
- **F3, ellipses.**
  - Quote side: "…", "...", ". . ." (and four-dot forms, and "[...]") are ordered gaps, each standing for at most 600
    characters of opinion text.
  - Source side: an ellipsis is dropped; the opinion's own omission marks need not be reproduced.
  - A quotation with gaps must keep a literal piece of at least 3 words and at least 4 literal words in total.
- **F4, parentheticals.** "(cleaned up)", "(internal quotation marks omitted)", "(citation omitted)", "(citations
  omitted)", "(emphasis added)", "(emphasis supplied)", "(emphasis in original)", "(alteration in original)", "(footnote
  omitted)" and their combinations are stripped from the quote side and named on the verdict.
- **F5, trailing punctuation.** A period, comma, semicolon or colon at the end of the quotation is not compared. A space
  before . , ; : ! ? is dropped on both sides.
- **F6, hyphens.** A soft hyphen (U+00AD) and any whitespace after it are dropped, joining the word. A hyphen between two
  letters is not compared, so "long-arm", "longarm" and "long-" + line break + "arm" read alike. Line-break hyphenation
  joins as in 0.0.1.
- **F7, word boundaries.** Every literal piece of the quotation must start and end on a word boundary in the opinion (an
  apostrophe counts as part of a word), except where a bracket is attached to it.
- **F8, negation guard extended.** ABSTAIN `SELECTIVE_QUOTE` also when the text an ellipsis omits carries a negation, or a
  bracket replaces text whose negation it does not carry (or adds one the text lacks). 0.0.1's preceding-negation check
  stays.
- **F9, anchor rule, when no reading matches.**
  - Anchors are runs of at least 4 consecutive quoted words found as whole words in the opinion.
  - Similarity = the longest common subsequence of the quotation's words (punctuation stripped) with the passage around the
    anchor, divided by the quotation's word count.
  - **Strong**: anchor of 4 or more words and similarity of 0.8 or more. FAIL, naming the corresponding passage.
  - **Weak**: anchor of 4 or more words and similarity from 0.5 up to 0.8. FAIL, worded "The quotation ... was not found as
    quoted in the opinion", with the nearest passage labelled as nearest, a partial match only. Not locked.
  - **Otherwise**: ABSTAIN `SPAN_NOT_FOUND`.
- **F10, wording and typed remedies.**
  - No 0.1.0 FAIL says "is a real authority".
  - A weak FAIL never says "the opinion reads".
  - Strong FAIL: `recompute-with` on the brief's quote, conform it to the corresponding passage.
  - Weak FAIL: `recompute-with` on the brief's quote, quote the passage it comes from exactly, or withdraw it.
  - Abstain remedies are 0.0.1's, typed the same way.
- **F11, every PASS says what it relied on.** The evidence's `normalizations` and the explanation list:
  - which bracket stood for what;
  - what each ellipsis omitted;
  - that quotation marks were not compared;
  - any parenthetical stripped;
  - any trailing punctuation;
  - any soft hyphen joined;
  - the opinion's own ellipses or brackets inside the match.

## Bars, on X2's 58 items, under legal@0.1.0

| bar | what must hold |
|---|---|
| B1 | The 11 convention false FAILs (CT01, CT02, CT03, CT05, CT06, CT09, CT10, CT11, CT14, CT16, CT18) PASS |
| B2 | CT12 (Celotex) and CT19 (Keys v. Humana), the court's own misquotes, stay FAIL |
| B3 | 0 PASS on the 20 known-bad items and 0 PASS on the 18 supplementary items |
| B4 | The 5 fabricated cases ABSTAIN (0 FAIL, 0 PASS) |
| B5 | The 6 controls that passed blind (CT04, CT07, CT13, CT15, CT17, CT20) still PASS |
| B6 | The 2 propositions still ABSTAIN `OUT_OF_RULESET_SCOPE` |
| B7 | All 58 new bundles replay with 0 diverged, and X2's 58 blind bundles still replay 58 match on the rebuilt build |
| B8 | Full verify suite green, `tsc --noEmit` clean, the export dry run ends in `scan clean`, the vocabulary test green |

**Declared in advance: CT18 is predicted to miss B1.** Its opinion text (Harvard CAP OCR) reads "plaintiffs claim" where
the court's quotation has "plaintiff's claim". F1 keeps in-word apostrophes on purpose, because dropping them would
equate "its" with "it's" and "plaintiff's" with "plaintiffs". If CT18 stays non-PASS it is reported as a miss against
B1, not relabelled.

**Reported, no bar:**

- **CT08 (undetermined).** Predicted FAIL: the court has a comma after "power" that the CAP text lacks.
- **Known-bad and supplementary FAILs.** Predicted: most of the 14 bad-quote FAILs become ABSTAIN under F9. Any that stay
  FAIL are listed with anchor length and similarity, and checked by hand: related passage or coincidence.

## Re-run commands

The harness is a copy of X2's `harness/run.mjs` at `tmp/riposte-x2b/harness/run.mjs`. It differs only in paths (items and
sources are read from X2's folder, read-only; results go beside the copy) and in passing `ruleset: 'legal@0.1.0'`. Its
sha256 is in `PREREG.sha256`.

```
node tmp/riposte-x2b/harness/run.mjs
node products/verify/dist/cli.js replay tmp/riposte-x2b/results/bundles
node products/verify/dist/cli.js replay workspace/receipts-spike/legal-blind/results/bundles
```

The "before" column is X2's `results/run-blind.json`, as run.
