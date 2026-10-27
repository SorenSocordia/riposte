# Legal operations: a verbatim quotation check

For legal operations, litigation support and knowledge management. It answers one question: **are the quoted words in the
opinion text you supplied, as quoted?** It uses no model and makes no network call, and every answer can be replayed on
your own machine. It does not check that a case exists, that it is good law, or that it supports your proposition: that
stays with the attorney of record.

## The three answers

| answer | when | what it shows |
|---|---|---|
| **PASS** | The quoted words are in the majority opinion of the text supplied for the cite, letter case included. | Where it matched (the section and the line). "Verbatim" only when the quoted words match exactly and begin and end where their sentence does; any other PASS prints how the sentence begins and goes on, and one that begins where its sentence begins prints the sentence before it. A match in a plurality opinion says so; a quotation the opinion itself quotes from another source names that source ("the brief should say (quoting …)"). |
| **FAIL** | A passage of that text corresponds to the quotation but differs, or the quoted words are a statement the opinion quotes and then rejects. | The passage, and the words or punctuation that differ; for a rejected statement, the sentence that rejects it. |
| **can't tell** | The check cannot say the words are there as quoted, or the question is not about words. | Why, and who decides: the attorney of record. |

**What a PASS ignores.** Spacing, quotation-mark style and dash style; in a Westlaw or Lexis download, star paging, headnote
numbers (Westlaw "[9]", Lexis "HN4[ ]"), footnote numerals glued to punctuation, and a PDF's page footers and running
headers, their lines of parallel citations included; what a parenthetical says was left out ("(citation omitted)",
"(cleaned up)", "(footnote omitted)"), a citation set off inside the sentence included; and a "(quoting …)" parenthetical the
brief writes after the quoted words, inside the quotation or after the citation. A full citation with a pin page or in
Bluebook form ("Anderson v. Liberty Lobby, Inc., 477 U.S. 242, 248 (1986)") finds the text supplied for 477 U.S. 242, and so
does a Westlaw or Lexis database number ("2025 WL 1188234"); the pin page is not checked.

**What makes a FAIL.** A word changed, added or dropped; punctuation that differs; a bracket that changes or inserts a word;
a citation left out without saying so; words joined from passages too far apart; or words the opinion quotes from another
source and then rejects in its next sentences ("the court rejected this standard", with the line). A difference that is only
words shaped like a citation or a page's running header is never a FAIL: it answers can't tell.

**What makes a can't tell.**

- No opinion text; or the text's caption does not name the cited case (a later opinion that only cites it does not count).
- A short form it cannot match to a full citation in the same brief ("Id.").
- Words not in the text at all: they may be fabricated, and the answer says so.
- Words only in editorial matter or a separate opinion (a headnote, the syllabus, a dissent), named; a dissent whose
  designation carries a join clause ("with whom Justice GINSBURG joins except as to Part IV, dissenting") included, and one
  designated in any other style ("Judge MOLINA, dissenting.", "MOLINA, J. (dissenting):", "I respectfully dissent.").
- A footnote call it does not read out inside the quoted words ("n7", "[4]").
- A cut that leaves out a negation, a condition or a limitation, before the quoted words, inside an ellipsis or after
  them: "must accept as true all of the allegations contained in a complaint", where the sentence goes on "is inapplicable
  to legal conclusions"; an ellipsis that drops a part of a condition joined by "and" ("tolled where the injury is inherently
  unknowable . . . , but" for "… unknowable and the plaintiff is blamelessly ignorant of it, but").
- Words that follow a lead-in reporting someone else's position or framing them: "Appellant argues that", "Bravo asks us
  to hold that", "According to Bravo,", "Tamberly's brief states that", "the court below held (1) that …, and (2) that", "we
  might hold that". The answer names the words and says whose they are ("found as a party's position, not the court's").
- Words in the sentences after one that introduces another's view ("In his view, …"), until the court speaks again ("We
  disagree.", "The Court disagrees.", "That rule no longer holds.").
- A changed letter case, the first letter's included when it is not written in a bracket ("summary judgment" for "Summary
  judgment": the answer names "[s]ummary"); or a citation that states only a proposition.

The commands print `INSUFFICIENT_DATA` for can't tell, on screen and in the JSON.

## First command

Check the five citations of a sample brief against the opinion text supplied with them:

```bash
node packages/verify/dist/cli.js citations packages/verify/docs/examples/legal-citations.json --sources packages/verify/docs/examples/legal-opinions
```

It prints one line per citation, on stderr:

- a PASS that says where it matched ("found at: line 6 of 201 F.3d 110") and how the sentence it is cut from continues;
- a FAIL that shows the passage of the supplied text and the words that differ;
- can't tell for a quotation not found in the text ("it may be fabricated");
- can't tell for a citation whose supplied text's caption names another case;
- can't tell for a proposition.

It lists where each opinion text came from, with its sha256. Exit code 1, because one citation failed. Its verdict's JSON
goes to stdout only when you pass `--json`.

## What you supply, and what it costs

- **The brief, as JSON.** The citations file lists each quotation (id, cite, case name, the quoted words). From a Word brief,
  one command writes it: `node packages/intake/dist/cli.js brief brief.docx --out brief.json`. It takes every quotation with
  its citation, resolves "Id.", "supra" and short forms to the full citation before them, keeps the paragraph in each id, and
  prints first whatever it could not resolve, with the passage, still writing it out so the engine answers can't tell for it.
  It is a prototype with no measured accuracy: read its list before you run the engine. From a PDF brief, someone builds the
  file by hand or with the firm's own tools; the engine itself reads neither.
- **The opinions, as UTF-8 text files.** A vendor delivers PDF, Word or RTF: [Getting text from Westlaw and
  Lexis](../../packages/verify/docs/LEGAL-TEXT.md) says how to convert each once, what to keep, and what the check reads out.
  It checks that each text's caption names the cited case (its parties and reporter citation), but it cannot confirm that
  the text is the genuine, complete opinion. It reads the sections the text marks (editorial matter, the majority opinion,
  separate opinions); a part the text does not mark is read as the opinion.
- **What a run keeps.** The `--bundle` file holds every quotation of the brief and every opinion text in full, so it is
  work product to keep or destroy on purpose.
- **What happens to client documents.** Nothing leaves the machine: the check calls no AI model, makes no network call, and
  writes nothing but the verdict or bundle you ask for.

## Which rule, and how well it does

- The default rule is `legal@0.5.4` (`legal@0.5.3` under engine 0.7.1; `legal@0.5.2` under engines 0.6.0 and 0.7.0). Earlier
  rule versions stay selectable so their verdicts replay; a replay of a legal verdict under an older rule says how today's
  default reads the same inputs, and `--require-ruleset 'legal@>=0.5.4'` fails a verdict under an older rule, exit 1.
- **The miss rate, measured blind on 10 items each.** On half B of the second legal blind set, the default passed 0 of 10
  known-bad quotations (upper bound 27.8%), failed 1 of 10 genuine ones and passed 4 of 10, with 5 can't tell; the
  default's row is post-hoc, because the rule was written after the set was seen, and its outcomes equal `legal@0.5.2`'s on
  every item of both blind sets ([LEGAL.md](../../packages/verify/docs/LEGAL.md#the-current-blind-number)).
- **Every reviewer named here was an AI agent, not a lawyer:** the default changed six times in nine days (legal@0.4.0 to
  legal@0.5.4), each time to close a class of error that cold readers found, AI agents given a buyer's role. Their numbers
  are in LEGAL.md and its changelog, and earlier ones under [Outside the rule](../../packages/verify/docs/BENCH.md#outside-the-rule).
  No person has labelled a legal case yet.
- A blind run of the shipping versions is preregistered and has not begun. Its preregistration pins the legal@0.5.3 sources
  by hash, and a timestamp authority signed it on 2026-10-14, before any of its data exists
  ([methods page](methods.md#not-yet-measured-the-versions-that-ship-on-unseen-documents)).

Read the accuracy before relying on it.

## Read next

- [`LEGAL.md`](../../packages/verify/docs/LEGAL.md): how the text is read, whose words count, what each guard does, the
  blind numbers and their misses.
- [Running it on your own briefs](../../packages/verify/docs/LEGAL.md#running-it-on-your-own-briefs): a blind pilot on
  your own filed briefs, and what a run keeps.
- [Getting text from Westlaw and Lexis](../../packages/verify/docs/LEGAL-TEXT.md): from the PDF, Word or RTF a vendor
  delivers to the text file the check reads.
- [Replaying a verdict under an older rule](../../packages/verify/docs/LEGAL.md#replaying-a-verdict-under-an-older-rule).
