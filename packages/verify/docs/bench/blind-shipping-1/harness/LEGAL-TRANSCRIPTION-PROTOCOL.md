# blind-shipping-1, legal arm: the transcription and labelling protocol

This protocol implements section 4.3 of `PREREG.md`. It is written so that a person or an AI agent follows it the same way.
Where a step asks for judgment, the protocol says so, and the decision and its reason are written down beside the case.
The person or agent who follows it is called the labeller below.

## 0. Before you start

- **Who.** Name yourself in every file you write: `{ "name", "role": "person" | "AI agent", "model": "<model id>" }`. An AI
  agent states the model id that its own first reply attested. If the labeller is an AI agent run by the maintainers, the
  arm's result opens with: "labelled by an AI agent of the maintainers, not independently".
- **What you must not see.** You make every candidate, every label and every planted case before any engine output on this
  arm exists. Do not run `verify`, `legal-run.mjs` or any tool built from the engine's matcher. Plain reading and a plain text
  search ("find" in a viewer or editor) are the only aids. The maintainers do not see your labels or planted cases before
  their hashes are on the run's ledger (step 7).
- **Where.** Everything lives under `results/legal/` in this folder. The briefs are in `briefs/` (`<brief id>.pdf`, with a
  text layer `<brief id>.txt` made by `pdftotext -layout`). The PDF's page image is the authority; the text layer is a
  convenience and can be wrong.

## 1. The briefs, in order

Run `node harness/legal-fetch.mjs --head-check` first: HEAD requests only, and it refuses if any address it needs does not
answer. Then `node harness/legal-fetch.mjs calendars`: it records the Court's calendars index
(`https://www.supremecourt.gov/oral_arguments/calendarsandlists.aspx`) and takes the October Term 2024 monthly argument
calendars (`oral_arguments/argument_calendars/MonthlyArgumentCal<Month><Year>.pdf`, October 2024 to April 2025, then any
special sitting's calendar for May or June 2025), and lists the dockets in the order the calendars print them. Then
`node harness/legal-fetch.mjs briefs --cases <n>` for the next cases of that order: it reads each case's docket page
(`docket/docketfiles/html/public/<docket>.html`) and takes the merits briefs it links. A brief's id is `<docket>-P<n>` (the
petitioner's or appellant's side) or `<docket>-R<n>` (the respondent's or appellee's side). Work the briefs in the order `briefs.jsonl` lists them. Add cases, in calendar order, until
200 quotations are labelled genuine (step 5). The brief in which the 200th falls is finished whole.

## 2. The Argument section

The Argument section runs from the heading `ARGUMENT` (not `SUMMARY OF ARGUMENT`) to the next heading at the same level, which
is usually `CONCLUSION`. A brief with no `ARGUMENT` heading has no eligible quotation; record it in its candidate file with
`"no_argument_heading": true` and `"complete": true`.

## 3. Candidates, in page order

Read the Argument section page by page. Within a page, read the body text from top to bottom, then the footnotes at the foot
of that page in their number order. A footnote that runs onto the next page is read where it starts.

A **candidate** is a quotation that meets all four conditions.

1. **In double quotation marks.** Its words stand between double quotation marks (“ ” or "). An indented block quotation
   without quotation marks is not a candidate. A quotation inside a longer quotation is part of the longer one, not a
   candidate of its own. A quotation the brief interrupts with its own words (“…,” the Court said, “…”) is two quotations.
2. **10 words or more.** Split the quotation, as printed, on white space. Drop every token that holds no letter and no digit
   (an ellipsis "…" or ". . .", a dash). Count what is left. Words inside brackets count. 10 or more qualifies.
3. **Attributed by the next citation to a U.S. Reports opinion.** The next citation after the closing quotation mark (in the
   same sentence, in the citation sentence that follows, or in the footnote a footnote call right after the quotation points
   to) names a United States Reports opinion: a full citation `<volume> U.S. <page>`, a short form (`<volume> U.S., at
   <page>`, `<case>, <volume> U.S. at <page>`), or "Id." or "Ibid." whose antecedent is a U.S. Reports citation. Resolve a
   short form or "Id." to the full citation, `<volume> U.S. <first page>`, from the brief's own text, and record where the
   full citation is printed. A citation that names no U.S. Reports page (a slip opinion, `602 U.S. ___`; only the Supreme
   Court Reporter; a statute; another court) does not qualify. A citation that gives both, U.S. Reports and another
   reporter, qualifies by its U.S. Reports cite. `(quoting X)` does not change the attribution: the cited opinion is the
   opinion the brief names first.
4. **In the Argument section** (step 2).

## 4. Typing the candidates

Write `candidates/<brief id>.json`:

```json
{
  "brief_id": "23-1039-P1",
  "labeller": { "name": "…", "role": "AI agent", "model": "…" },
  "complete": false,
  "candidates": [
    { "id": "23-1039-P1-Q01", "pdf_page": 14, "printed_page": "9", "where": "body",
      "quote": "…", "cite": "347 U.S. 483", "cite_as_printed": "Brown, 347 U.S., at 495",
      "case_name": "Brown v. Board of Education", "resolved_from": "the full citation on printed page 7",
      "conventions": ["(emphasis added)"], "notes": "" }
  ],
  "corrections": []
}
```

- **ids** are `<brief id>-Q01`, `-Q02`, … in page order, over every candidate.
- **`quote`** is exactly what stands between the quotation marks, as printed: words, punctuation, brackets, ellipses ("…" or
  ". . ." as printed), inner single quotation marks, capital letters. Leave out the quotation marks themselves and anything
  after them (a citation, a parenthetical). Join a line break with one space. Join a word the line break hyphenated
  ("legis-" / "lation"); keep a hyphen the word carries anywhere else; note each such join in `notes`. Leave out a footnote
  call inside the quotation and note it. Italics and bold are not typed.
- **`cite`** is the full `<volume> U.S. <first page>`; **`case_name`** is the case name as the brief's full citation prints
  it; **`conventions`** lists every parenthetical the brief attaches to that citation that speaks about the quotation:
  "(emphasis added)", "(emphasis in original)", "(cleaned up)", "(citation omitted)", "(citations omitted)", "(internal
  quotation marks omitted)", "(alteration in original)", "(footnote omitted)", "(brackets in original)", "(quoting …)".
- **Typing errors are yours to find.** Before you mark the file complete, read every candidate again against the page
  image. A correction made then is listed in `corrections` as `{ "id", "before", "after" }`.
- **When to stop.** Run `node harness/legal-fetch.mjs opinions` as you go: it looks up every cited opinion in the Caselaw
  Access Project and records whether the Project serves it with a majority opinion. Stop typing a brief when 25 of its
  candidates cite an opinion the Project serves, or when its Argument section ends. Then set `"complete": true` and run
  `node harness/legal-fetch.mjs select`. That writes `citations/<brief id>.json`, the citations file the engine reads: the
  first 25 candidates, in page order, whose opinion the Project serves (section 4.3: "at most 25 per brief, the first 25 in
  page order"). A candidate whose opinion the Project does not serve is not eligible; `eligibility.jsonl` counts them.

## 5. Labels: genuine, not faithful, or undecided

For every quotation in `citations/<brief id>.json`, write `labels/<brief id>.json`, an array of:

```json
{ "id": "23-1039-P1-Q01", "label": "genuine", "found_at": "the first eight words of the matched passage …",
  "conventions_applied": ["ellipsis", "(cleaned up)"], "reason": "" }
```

Read the quotation against `majority/<cite>.txt`, the majority opinion alone as the Project serves it. (The engine's text in
`opinions/` holds the caption, the head matter and every opinion; the label is about the majority.)

**Compare after this normalization, on both sides:** curly quotation marks and apostrophes read as straight ones; every
dash (—, –, ‑) reads as a hyphen; runs of white space read as one space; a line-break hyphen in the opinion is joined as in
step 4. Nothing else is normalized.

**A quotation is genuine** when its words appear in the majority opinion, in order, as quoted, under these conventions, and
under the parentheticals the brief states:

- **Ellipsis.** "…" or ". . ." stands for words left out. The parts on either side appear in the opinion in the same order,
  within one passage: the rest of the paragraph and the paragraph after it at most. The ellipsis is faithful unless the
  words it leaves out hold a negation (not, no, never, nor, neither, without) or a condition or limitation on what the
  remaining words say (only, unless, except, if, but, provided that, at least, in part): then the quotation is not faithful.
  This is a judgment; write the left-out words in `reason`.
- **Brackets.** A bracketed letter or word replaces or adds to the opinion's words: a change of letter case ("[T]he" for
  "the"), a grammatical form the brief's sentence needs ("[s]" for a plural), or the thing a word refers to in the opinion
  ("[the Act]" for "it"). The words outside the brackets match as printed. A bracket is not faithful when it changes what
  the opinion says: a negation added or removed, a modal changed ("[must]" for "may"), a party, a number or a holding
  changed. This is a judgment; write the opinion's words in `reason`.
- **"(cleaned up)"** allows, without marking them: the opinion's own internal quotation marks, brackets, ellipses,
  citations and footnote calls left out, and the case of the first letter changed.
- **"(internal quotation marks omitted)"** allows the opinion's internal quotation marks to be left out.
- **"(citation omitted)" / "(citations omitted)"** allows citations inside the passage to be left out without an ellipsis.
- **"(footnote omitted)"** allows a footnote call to be left out.
- **"(alteration in original)" / "(brackets in original)"** means the brackets are the opinion's own: they match as text.
- **"(emphasis added)" / "(emphasis in original)"** change nothing about the words.

**A quotation is not faithful** otherwise: a word differs; a word is missing without an ellipsis or a stated convention; a
word is added without brackets; the words are not in the majority opinion (they are in a dissent, a concurrence, the
syllabus, the head matter, or nowhere); an ellipsis or a bracket fails its test above. Write the reason: the opinion's words
beside the quotation's.

**Undecided.** When you cannot decide (the opinion's text is garbled near the passage; the passage is split across a page
image you cannot read), write `"undecided"` and why. An undecided quotation is listed and kept out of every denominator
(section 10). Never guess.

A natural quotation labelled not faithful is reported case by case in the result and joins the planted set's denominator
(section 5). Keep adding briefs (step 1) until 200 quotations are labelled genuine.

## 6. The planted set: 40 quotations, five per operator

Run `node harness/legal-fetch.mjs draw --what genuine`. It writes `draw.json`: the genuine quotations in section 6's order
(the seed of arm "legal"). For each operator below, in this order, take the first quotations of that order, not used by an
earlier operator, that can take the operator, until five are made. A quotation that cannot take an operator is skipped for
the next (section 6). Make one change per copy and write `planted/planted.json`, an array of:

```json
{ "key": "L01", "operator": "a word changed", "base_id": "23-1039-P1-Q07", "cite": "347 U.S. 483",
  "case_name": "Brown v. Board of Education", "source_key": "347 U.S. 483", "quote": "<the altered quotation>",
  "change": { "before": "…", "after": "…", "note": "…" } }
```

1. **A word changed.** Replace the first word, in reading order, of four or more letters that is not part of a name, with a
   different word that changes the meaning (not a synonym, not a spelling variant).
2. **A word dropped.** Drop one word, with no ellipsis: the first negation, modal or quantifier (not, no, only, may, must,
   shall, all, any) if the quotation has one; otherwise its first adjective or adverb. Cannot take: none of these.
3. **A word inserted.** Insert one word, without brackets, that changes the meaning ("not", "only", "never", "always"), at
   the first place where the sentence still reads grammatically.
4. **A bracket that changes the meaning.** Replace a word or phrase with a bracketed one that changes what the opinion says:
   a modal ("[must]" for "may"), a referent that is not the opinion's ("[the State]" where the opinion means the federal
   government), a negation ("[not]"). Cannot take: no word can be replaced that way.
5. **An ellipsis over a negation or a limitation.** Take the whole sentence of the majority opinion the quotation comes
   from; place an ellipsis over a negation (not, no, never) or a limitation (only, unless, except) in it, so that what remains
   reads the other way. Cannot take: the sentence holds none.
6. **A quotation cut where the opinion's sentence goes on to reverse or limit it.** End the quotation, with no ellipsis,
   where the opinion's sentence continues with words that reverse or limit it (but, unless, except, only if, provided). The
   words kept are the opinion's own. Cannot take: the sentence has no such continuation.
7. **Words from a dissent or the syllabus attributed to the majority.** Replace the quotation with the first sentence of 10
   words or more of the case's first dissent, copied exactly; with no dissent served, the first such sentence of the syllabus
   in the head matter. The cite and case name stay. Cannot take: the served text has neither.
8. **The right words attributed to another case's citation.** Keep the quotation as typed; give it the cite, case name and
   source key of the next quotation in the draw order that cites a different case. Check, by a plain text search, that the
   words are not in that other case's majority opinion; if they are, take the next.

## 7. Hash before any engine call

When every brief is labelled and the planted set is made, record three hashes on the run's ledger, in this order, before
anyone runs `legal-run.mjs`:

```
node harness/ledger.mjs hash --arm legal --kind transcription --file results/legal/citations
node harness/ledger.mjs hash --arm legal --kind labels --file results/legal/labels
node harness/ledger.mjs hash --arm legal --kind planted --file results/legal/planted/planted.json
```

`legal-run.mjs` refuses to start unless all three are on the ledger with the digests the files have then. There is no look at
any count before that (section 10).
