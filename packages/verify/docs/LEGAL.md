# Legal quotations: what the check does, how well, and how to run it

This page is the manual for the current rule, `legal@0.5.4`: what it checks, how it reads a text, what each guard does, how
well it does on the blind sets, and how to run it. What changed and when, the earlier rules, and the cold readers' briefs
that moved each one are in [`CHANGELOG.md`](../CHANGELOG.md) (see "The record", at the end of this page).

## What it checks

For each citation in a brief, the engine checks one thing: **are the quoted words in the opinion text you supplied for that
cite, as quoted?** It uses no model and makes no network call. Every answer is a verdict that anyone can replay; a changed
input or answer is refused on replay. Each quotation gets one of three answers:

| answer | when | what it shows |
|---|---|---|
| **PASS** | The quoted words are in the majority opinion of the text supplied for the cite, letter case included. Spacing, quotation-mark style, dash style, a download's page marks and a PDF's page footers and running headers do not count; nor does what a parenthetical says was left out ("(citation omitted)", "(cleaned up)", "(footnote omitted)"), nor a "(quoting …)" or "(citing …)" parenthetical written after the quoted words, in the quotation or after the citation. | Where it matched (section, line, character offset) and every convention it read. "Verbatim" only under the one rule below. A quotation that begins or ends inside its sentence prints how the sentence begins and goes on; one that begins where its sentence begins prints the sentence before it. A match in a plurality opinion says so; a match inside the opinion's own quotation of another source names that source. |
| **FAIL** | A passage of that opinion corresponds to the quotation but differs from it: a word changed, added or dropped; punctuation that differs; a bracket that changes or inserts a word; a citation left out without saying so; words joined from passages farther apart than an ellipsis is read for; or words the opinion quotes from another source and then rejects. | The passage, as whole sentences, and the words or punctuation that differ; for a rejected quotation, the sentence that rejects it and its line. |
| **can't tell** (`INSUFFICIENT_DATA`) | No text was supplied; the text's caption does not name the cited case; the cite is a short form it cannot match ("Id."); the words are not in the text (they may be fabricated); they appear only in editorial matter or a separate opinion; a footnote call it does not read out sits inside them; the cut leaves out a negation, a condition or a limitation; the words before them, in their sentence or the sentences before it, report someone else's position or frame them ("Appellant argues that", "In his view, …", "we might hold that"); the passage differs only by words shaped like a citation or a running header; the letter case is changed; or the citation states only a proposition. | Why, where the words are, and who decides: the attorney of record. |

**"Verbatim", one rule.** A PASS says "verbatim" only when the quoted words match exactly (letter case and punctuation
included; spacing, apostrophe style and quotation marks aside) and the quotation begins and ends where its sentence does.
Anything else that passes is "as quoted", and the PASS shows the context. Words the check reads as a party's or another
court's position are never PASS, so never "verbatim": the answer says "found as a party's position, not the court's".

It does not check that a case exists, is good law, or supports the point. A PASS means the words are there as quoted, not
that the cut is fair to the opinion: read the context a PASS prints.

**Run it.** One command, on one machine; nothing leaves it:

```
node packages/verify/dist/cli.js citations brief.json --sources opinions/
```

`brief.json` lists the brief's quotations as JSON (id, cite, case name, the quoted words). From a Word brief, one command
writes it (see "From a .docx", below); from a PDF, someone builds it by hand or with the firm's own tools: **the engine
itself reads neither a .docx nor a PDF.** `opinions/` holds the opinion texts as UTF-8 text files; [LEGAL-TEXT.md](LEGAL-TEXT.md)
says how to get them out of a vendor's PDF, Word or RTF, and what the engine reads out of them.

It checks **whose words they are**: it reads the sections of the supplied text (editorial matter, the syllabus, the majority
opinion, any concurring or dissenting opinion) and checks a quotation against the majority's words. Words found only
elsewhere answer can't tell, naming where they are: "the quoted words appear in the West headnotes (line 12), not in the
opinion". It also checks that **the supplied text is the opinion the cite names**, by its caption, before it checks the
quotation: "the supplied text is Cooper v. Aaron, 358 U.S. 1 (its caption); it cites Brown v. Board of Education, 347 U.S. 483
but is not that opinion".

## What it does not check

- That an authority exists, is good law, or has been overruled. Use a citator for that.
- Whether an authority stands for a proposition. A citation with a proposition and no quotation answers can't tell by design.
- Whether quoted words are the holding. Words the text marks as editorial matter or a separate opinion are never passed as
  the majority's; a part it does not mark is read as the opinion. Words after a lead-in that reports someone else's position,
  or in the sentences after one that introduces another's view, answer can't tell; a frame the reader does not list passes,
  with the words before it printed.
- Whether the opinion quoted binds. A lead opinion that is a plurality, in whole or in a part, is named as one.
- Whether a cut is fair to the opinion. A limitation the engine does not read passes, with the context printed.
- Whether the text you supplied is authentic. The engine checks that its caption names the cite and records where it came
  from; it trusts you for the rest.
- That a pin cite points to the right page. "Anderson v. Liberty Lobby, Inc., 477 U.S. 242, 248 (1986)" finds the text supplied
  for "477 U.S. 242", and a PASS says "The pin page 248 is not checked."

## The rules, and which one runs

**One current rule: `legal@0.5.4`,** the default for every new verdict from the first engine after 0.7.1. Under engine 0.7.1
the default is `legal@0.5.3`, under engines 0.6.0 and 0.7.0 `legal@0.5.2`, and under earlier engines `legal@0.0.1`. An earlier
rule is issued only when named (`--ruleset legal@0.5.3`); a verdict made under one names it and replays under it unchanged, and
the replay says when today's rule reads its inputs differently. `legal@0.5.4` and `legal@0.5.3` need engine 0.7.1; every rule
from `legal@0.3.0` needs engine 0.6.0.

| rule | status |
|---|---|
| `legal@0.5.5` | selectable from engine 0.7.2 (2026-10-19); the default from the first engine after it. See the CHANGELOG's "Legal rule 0.5.5" section. |
| `legal@0.5.4` | **current**: the default from the first engine after 0.7.1 (2026-10-14). Everything on this page. |
| `legal@0.5.3` | the default under engine 0.7.1 (2026-10-13). Do not use for filing: it passes six dissent designation styles ("Judge MOLINA, dissenting.", "I respectfully dissent.") as the majority's and a party's filing ("Tamberly's brief states that") as the court's, FAILs a genuine quotation that carries "(quoting …)" after its words, and holds four genuine quotations for a negation in the clause before theirs. |
| `legal@0.5.2` | the default under engines 0.6.0 and 0.7.0 (2026-10-06). Do not use for filing: it passes a dissent whose designation carries a join clause as the majority's, a party's view in the sentence after "In his view, …", and a standard the opinion quotes and rejects. |
| `legal@0.5.1` to `legal@0.0.1` | earlier rules. Do not use for filing. What each added, and gets wrong, is in CHANGELOG.md. |

**How the default is chosen.** The maintainers apply a stated rule to the half-B rows of the current blind set (below):

1. The default is the version with the lowest upper bound on known-bad quotations passed.
2. A tie goes to the version with fewer false FAILs.
3. A version that closes a false-PASS class found by a cold reader may take the default the same day. Its rows are then
   published with it, and the date of the change is named. If it does worse than the one it replaces on genuine quotations,
   by more than the interval, that is printed here and settled before it ships.

**What counts as a cold reader.** Every reader named on this page is an AI agent, not a person: given a buyer's role (the
legal-operations director of a firm), it had not worked on this tree before it read the shipped pack. It is not independent of
the maintainers: they dispatched it, and the same kind of AI agent builds the engine. No practising lawyer or legal-operations
director has run these briefs. A false PASS such a reader finds is a false PASS, whoever finds it; it is not a measured rate.

**Applied on 2026-10-14: `legal@0.5.3` to `legal@0.5.4`, from the first engine after 0.7.1.** Rules 1 and 2 tie on half B (0 of
10 known-bad passed, upper bound 27.8%; 1 of 10 genuine failed). By rule 3, `legal@0.5.4` closes the false-PASS classes the ninth
and tenth cold readers found: six separate-opinion designation styles passed as the majority's ("Dissenting Opinion by Judge
Molina", "Judge MOLINA, dissenting.", "MOLINA, J. (dissenting):", "MOLINA, J., dissents and votes to reverse in the following
opinion:", "MOLINA, Circuit Judge, dissenting from the denial of rehearing en banc:", "I respectfully dissent."); a party's
filing as a speaker ("Tamberly's brief states that"); an unbracketed change of a quotation's first letter; and an ellipsis that
omits a part of a condition joined by "and". It also ends five false can't-tells on genuine quotations (a negation before ", and"
read as governing the next clause, three times; a party's contention carried into the court's own headnote-marked sentence; an
ellipsis over a whole "not X, but" contrast) and a false FAIL (a genuine quotation written with "(quoting …)" after its words, as
this page told the writer to), and binds a Westlaw database number ("2025 WL 1188234") to its caption, so the nine quotations
one reader checked against such an opinion are checked instead of "no supplied text matched". On both blind sets it gives the
same outcome as `legal@0.5.3` on every item (40 of 40; 58 of 58), so it costs nothing on genuine quotations there. On the ten
cold readers' own briefs it moves 17 answers, all in the two reviews of 2026-10-13 and each named in CHANGELOG.md; none of the
eight earlier readers' answers moves (127 checks).

**Applied on 2026-10-13: `legal@0.5.2` to `legal@0.5.3`, from engine 0.7.1.** Rules 1 and 2 tie on half B (0 of 10 known-bad
passed, upper bound 27.8%; 1 of 10 genuine failed). By rule 3, `legal@0.5.3` closes the false-PASS classes the seventh and eighth
cold readers found: a dissent whose designation carries a join clause ("Justice STEVENS, with whom Justice GINSBURG joins except
as to Part IV, dissenting."), passed as the majority's in 6 of 13 designation styles; 7 of 12 party positions after lead-ins the
reader did not list ("asks us to hold that", "According to Bravo,", "In Bravo's view,"), and "urges us to"; a party's view in the
sentence after "In his view, …", passed "verbatim"; another court's holding after "held (1) that …, and (2) that"; and Conley's
retired standard, quoted by the opinion and then rejected, passed as the holding. It also ends two false FAILs on genuine
quotations (a running header's looseleaf citation line; "(citations omitted)" over a citation clause) and passes the genuine
Twombly sentence `legal@0.5.2` held ("but only enough facts …"). On both blind sets it gives the same outcome as `legal@0.5.2` on
every item (40 of 40; 58 of 58), so it costs nothing on genuine quotations there; the wording of 3 genuine PASSes changed (two
print the sentence before them, one names a quotation within the opinion). On the cold readers' own briefs (461 checks over
seven rounds) it moves 26 answers, each named in CHANGELOG.md; none of the five earlier readers' answers moves.

## The next rule, `legal@0.5.5`: selectable now, not yet the default

`legal@0.5.5` reads as `legal@0.5.4` does, plus what two more cold readers found on 2026-10-19 (an AI agent in the tenth review
round, and one reading the pack as a legal-operations buyer; neither a person). It is issued only when named (`--ruleset
legal@0.5.5`, engine 0.7.2), and it becomes the default with the first engine after 0.7.2. Until then the rest of this page
describes `legal@0.5.4`, the default. What `legal@0.5.5` changes:

- **An ellipsis inside a clause.** An ellipsis that omits words from the middle of a clause answers can't tell, "cut inside a
  clause", whatever the words are: on at least one side, no comma, dash, parenthesis or sentence end sets them off from the words
  kept ("are . . . enforced" for "are rarely enforced"). So does an ellipsis that omits a word of degree, frequency or hedging in
  the kept sentence ("generally", "ordinarily", "in limited circumstances"), words that say who must show what ("the opponent shows
  that"), or a part of a time phrase that "or" joins to the words kept (", within a reasonable time after he discovers . . . any
  breach," for "… discovers or should have discovered any breach,"). An ellipsis set off on both sides (", an adverse-inference
  instruction or dismissal,"), one over whole sentences, and one over a whole "not X, but" contrast read as before.
- **A bracket that inserts a word.** An inserted word of degree or frequency ("[always]"), a word that says the opposite of its
  stem ("[unreliable]") or an adverb in "-ly" ("[expressly]") FAILs, and the remedy is "Remove the inserted [always]". Any other
  inserted word ("[novel]", "[damages]") answers can't tell, and the attorney of record decides whether it changes what the text
  says. An article, a pronoun, a preposition, a form of "be", "have" or "do", "[sic]", a name written with its capital ("[of the
  Agreement]"), and a referent named for the pronoun before it ("It [the district court] held", or "[The arbitration agreement] is"
  for "It is") read as before. A bracket at an edge of the quotation that the check cannot place, and that holds such a word, answers
  can't tell.
- **Ligatures.** A ligature that PDF conversion leaves in the text ("ﬁ", "ﬂ", "ﬀ", "ﬃ", "ﬄ") is read as its letters, on both
  sides. A PASS that relied on one says so, and a FAIL never names one as a difference, so a correct quotation is never sent back.
- **"(citation omitted)" over a rule, a code or a Restatement.** A citation sentence or clause may open with a rule ("Fed. R. Civ.
  P. 56(a).", "See Fed. R. Civ. P. 56(a).", "Tex. R. Civ. P. 166a(c)."), a code ("Cal. Civ. Proc. Code § 340.", "N.Y. C.P.L.R.
  3212(b) (McKinney 2024).", "U.C.C. § 2-607(3)(a).") or a Restatement ("Restatement (Second) of Contracts § 90 (1981)."), when it
  holds citation words only. A sentence about a rule ("Rule 56 requires the movant to …") is never read as a citation.
- **The court's own sentence.** A quoted sentence in the court's voice ("That reading is foreclosed by the text.") is the court's,
  whatever the sentence before it reports.
- **A quotation the court departs from.** Words the opinion quotes and then departs from in one of its next two sentences, in words
  the rejection list does not hold ("We part ways with that formulation today."), answer can't tell, naming that sentence and its
  line. A strong rejection still FAILs.
- **Separate opinions and pluralities.** After the majority, a short line of its own that names a judge and goes on with a
  role-like word ends the majority: "LINDQVIST, Circuit Judge, concurring dubitante:", "specially concurring:", "statement
  respecting the denial of rehearing en banc:", "joining the opinion of the court and concurring:", "concurring, with whom OKAFOR,
  Circuit Judge, joins:", "Judge LINDQVIST, concurring dubitante.", "LINDQVIST, P.J. (concurring in result only)", "LINDQVIST,
  J., would grant the petition.", "Separate Statement of LINDQVIST, J.". A plurality stated only in a Lexis header's "Judges:" line,
  or under the heading "OPINION ANNOUNCING THE JUDGMENT OF THE COURT", is named "the lead opinion", and a PASS there says it is a
  plurality's.
- **A district court's slip opinion.** Before any majority has started, a district court's heading ("MEMORANDUM OPINION AND ORDER",
  "OPINION AND ORDER", "ORDER") or a line that is only its judge's name and title ("CORDELL, District Judge", "JANE M. CORDELL,
  United States District Judge", "CORDELL, J.") starts the opinion, unless the body has already begun: a judge's signature after
  the body starts nothing. These layouts were typed from memory by a cold reader, not taken from a real download.

**What it costs, as measured.** On both blind sets it gives every outcome `legal@0.5.4` gives: 40 of 40 on the second set, and 58
of 58 on the first, its texts each given a caption line. Neither set passes a known-bad quotation under either rule. On the earlier
cold readers' briefs and probes kept as test fixtures (229 checks, 2026-10-06 to 2026-10-13) no outcome moves. On the two new
readers' briefs, the known-bad quotations that pass fall from 6 of 31 to 2 for the review round, and from 5 of 43 to 1 for the
buyer. Genuine quotations that FAIL fall from 4 of 35 to 0, and the 11 quotations against the buyer's slip opinion are read against
its body instead of being held as the counsel listing's words. None of this is a measured rate: the readers are AI agents, and
their briefs were seen before the rule was written.

**What it leaves as it was.** A limitation the check does not read still passes, with the continuation printed: "must show that a
valid agreement exists" stops before ", that the dispute falls within its scope, and …". So does a frame the reader does not list
("Harrowgate's fallback is that"). A bracketed name for a pronoun is not checked against what the pronoun refers to ("[The
limitations clause]" for "It"). A district court's judge line after the opinion has started, a magistrate judge's line, and a
first-person sentence inside the majority start nothing.

## How the text is read

Both the quotation and the supplied text are read the same way before they are compared.

- **Spacing, quotation marks, apostrophes, hyphens, dashes.** Runs of spaces and line breaks are one space. Quotation marks
  are not compared, and neither is their style; an apostrophe inside a word is ("plaintiff's" is not "plaintiffs"). A soft
  hyphen, a hyphen at a line break and a hyphen between two letters are not compared. An em dash, an en dash and two or three
  hyphens are one dash, the spaces around it aside; a PASS that relied on it says so.
- **The quotation's conventions.** Brackets, ellipses, the parentheticals and a period, comma, semicolon or colon ending the
  quotation are read as the conventions they are. A parenthetical excuses what it names, whether it ends the quotation or
  follows the citation ("Ashcroft v. Iqbal, 556 U.S. 662, 678 (2009) (cleaned up)"):
  - "(citation omitted)", "(citations omitted)" and "(cleaned up)": a citation inside the quoted words may be absent. That is a
    citation sentence (a whole sentence that opens with "Id.", "Ibid.", a signal, a case name or a reporter citation, and holds a
    citation, its parenthetical included) or a citation clause inside a sentence, set off by a comma or semicolon ("…, ibid.;
    Sanjuan v. American Bd. of Psychiatry and Neurology, Inc., 40 F.3d 247, 251 (C.A.7 1994), a plaintiff's …"; ", see Twombly,
    550 U.S., at 570,"; a string of them). A clause opens with "id.", "ibid.", a signal ("see", "see also", "cf.", "accord",
    "compare", "but see", "e.g."), a case name with " v. " or a reporter citation, and runs through citation pieces only (a case
    name, "Inc." and its kin, a reporter citation, a pin page, "at" a page, a footnote, "supra", a statute section, each with its
    parentheticals). The quotation may keep the comma before the clause or join the words around it without one;
  - "(footnote omitted)" and "(cleaned up)": a footnote call inside the quoted words may be absent ("n3", "[4]", "FN6");
  - "(internal quotation marks omitted)" and "(cleaned up)": the text's inner quotation marks may be absent;
  - "(alteration in original)": the brackets the quotation shows are the text's own;
  - "(quoting …)" and "(citing …)", written after the quoted words in the quotation itself or after the citation: the brief's
    own disclosure of whom the opinion quoted. It is never compared as words, and the PASS names the source "as the citation
    says".

  The PASS names what each excused: "the citation "ibid.; Sanjuan v. American Bd. of … Inc., 40 F.3d 247, 251 (C.A.7 1994)"
  left out, as "(citations omitted)" says". None of them excuses a word: "(cleaned up)" over a dropped "mere" still FAILs, naming "mere". A citation left
  out with no ellipsis and no parenthetical FAILs, naming it, and the remedy is "(citation omitted)" or an ellipsis.
- **Letter case.** It is compared. Two changes are allowed: a letter in a bracket ("[t]he", "[S]ummary") and a change the
  quotation discloses ("(emphasis added)"). The first letter of the quotation, or the first after an ellipsis, changed with no
  bracket answers can't tell, naming the bracket to write ("summary judgment is appropriate" for "Summary judgment is
  appropriate": "[s]ummary").
- **Page marks and page furniture.** Star paging (`*248`, `[*249]`), a footnote numeral glued to sentence punctuation
  (`counted.4 This`), a Westlaw headnote number between sentences (`[9] Second, …`), a Lexis headnote marker (`HN4[ ]`) and a
  PDF's page footer and running header are read out of the comparison, on both sides, and named on the answer; such a match is
  never "verbatim". A run of page furniture needs a vendor's own line to start it (the Thomson Reuters footer, a Westlaw banner,
  "Page N of M", a KeyCite flag); next to one, a line that is only a case name with its citation, a page number, a KeyCite
  treatment line, or parallel citations belongs to it. A line of parallel citations is read by its shape, not by a list of
  reporters: "127 S.Ct. 1955, 167 L.Ed.2d 929, 75 USLW 4337, 2007-1 Trade Cases P 75,709" is one. A citation line standing alone
  in the opinion is never read out. Any other token that may be a page mark or footnote call (`n7`, `[4]`, `FN6`, `counted4`,
  superscript digits) is never read out on its own: a quotation that matches only with one read out answers can't tell, naming
  it, never FAIL, and its remedy is the printed page or "(footnote omitted)", never an edited download. The forms and examples
  are in [LEGAL-TEXT.md](LEGAL-TEXT.md), "What the check reads out". The supplied text is never changed: every answer's
  evidence points into it as you supplied it.
- **Sentence ends.** A sentence ends at a period, question mark or exclamation mark followed by a space, unless the period
  ends an abbreviation ("U.S.", "v.", "Inc.", a single letter), belongs to an ellipsis, or comes before a small letter
  ("American Bd. of Psychiatry"); or at a line break after a heading or caption line when the next line starts with a capital.
  A period after a number, or after "Id." or "Ibid.", ends one when a capital follows ("… 127 S.Ct. 1955. To survive …").

## Whose words: the sections of the text

A download carries more than the opinion. The engine reads where each part begins, line by line, and checks a quotation
against the majority opinion's words.

- **Editorial matter** starts at a heading on its own line: "Synopsis", "West Headnotes", "Headnotes", "LexisNexis®
  Headnotes", "Case Summary", "Summary", "Core Terms", "Syllabus", "Counsel", "Attorneys and Law Firms", "West Codenotes", "All
  Citations", "End of Document"; and, with text after the colon, "Counsel:", "Judges:", "Disposition:", "Prior History:",
  "Subsequent History:", "Procedural Posture:", "Overview:", "Outcome:", "Dissent by:", "Concur by:". A heading starts with a
  capital, and the line above it does not end with a comma or a hyphen.
- **The majority opinion** starts at an "Opinion" heading ("Opinion of the Court", "OPINION ____", "Opinion by:", "Per
  Curiam"), at a line that begins with who delivered the opinion or announced the judgment ("Justice WHITE delivered the opinion
  of the Court."), or at "NAME, Circuit Judge:". A sentence that mentions who delivered an opinion never starts one, nor does a
  syllabus's closing line ("Black, J., delivered the opinion of the Court, in Part I of which …").
- **A separate opinion** starts at its designation, on one line or up to three short ones: who wrote it, then whatever stands
  between, then its role at the end. "Justice BRENNAN, dissenting."; "SMITH, Circuit Judge, concurring in part and dissenting in
  part:"; "Justice STEVENS, with whom Justice GINSBURG joins except as to Part IV, dissenting."; "Justice THOMAS, with whom
  Justice SCALIA joins as to Parts I and II, concurring in part and dissenting in part."; "Justice ALITO, with whom THE CHIEF
  JUSTICE joins as to all but Part II-B, dissenting."; "JUSTICE ROE, joined by JUSTICE DOE, dissenting." What stands between the
  author and the role (a join clause, a part list) may hold no sentence end. The role may stand in parentheses ("MOLINA, J.
  (dissenting):") and go on with "from" or "as to" ("MOLINA, Circuit Judge, dissenting from the denial of rehearing en banc:");
  the title may come first ("Judge MOLINA, dissenting."); the role may be a verb ("MOLINA, J., dissents and votes to reverse in
  the following opinion:"). A "Dissent", "Concurrence" or "Separate opinion of" heading also starts one, with or without its
  author ("Dissenting Opinion by Judge Molina"), and so, after the majority, does a line that is only "Mr. Justice Douglas." or
  "I respectfully dissent." Any short line of its own that designates a separate opinion ends the majority. The opinion is
  named by its role as printed: "Justice Stevens's dissent", "Justice Kennedy's opinion concurring in part and concurring in the
  judgment", "Judge Molina's opinion dissenting from the denial of rehearing en banc"; one with no author printed is "a dissent".
- **Footnotes** after a separate opinion are a section of their own (they cannot be assigned to one opinion); otherwise they
  belong to the opinion before them. **The header** (caption, tribunal, docket, dates) is what precedes the first start, or the
  majority opinion when the first start is a separate opinion. **A text with none of these** is read whole, as the opinion.

The quotation is read against a view of the text in which every other section is blanked, offsets and lines kept. A match there
goes through every guard below, and a PASS says where it matched. When nothing matches there, the answer is, in this order: an
unread footnote call or page mark (can't tell, naming it); the words in another section (can't tell: "whose words: the quoted
words appear in Justice Stevens's dissent of the opinion text supplied for Bell Atlantic Corp. v. Twombly (line 46), not in
the majority opinion"); a citation left out without saying so
(FAIL); words joined from two passages (FAIL); a passage of the opinion that corresponds (FAIL, or can't tell when it differs
only by words shaped like a citation or a running header); the nearest passage in another section (can't tell); not found.

**A parenthetical names the opinion.** A citation whose cite carries "(Brennan, J., dissenting)" (or "(Stewart, J., concurring
in the judgment)") is checked against that separate opinion: "Found in Justice Brennan's dissent, as the citation says, line
20". Words of the majority under such a parenthetical answer can't tell, and so does a parenthetical naming an opinion the text
does not mark, listing those it does.

**A plurality.** The line that starts the lead opinion says whether it is the Court's: "announced the judgment of the Court and
delivered the opinion of the Court with respect to Parts I and II, and an opinion with respect to Part III" makes Part III a
plurality's; "… delivered an opinion, in which …" makes the whole one; "delivered the opinion of the Court, except as to Part
III" makes Part III one. The lead opinion is then named "the lead opinion", and a PASS says what the designation makes of the
place it matched: "Found in Part III of the lead opinion, line 7 (character offset 304): a plurality opinion, not an opinion of
the Court". A quotation that matches is still a PASS; the weight of a plurality is the attorney of record's call.

## What each guard does

- **Letter case.** A changed letter case answers can't tell as a "case change", naming the words as quoted and as written.
- **Brackets.** A bracket that replaces a word with a different word, or swaps a modal, a negation or a quantifier, FAILs as an
  altered quotation. A bracket that inserts a word is answered by removing it: "Remove the inserted [only]".
- **Conditions.** An ellipsis answers can't tell as an "elided condition" when what it omits carries a condition word
  ("unless", "provided", "except", "only", "if", "where", "not", "but", "subject to", "to the extent", "absent" and the like),
  or a set-off phrase of time or procedure (", after adequate time for discovery and upon motion,"); or when it omits a part of
  a condition that "and", "or" or "nor" joins to the words kept ("tolled where the injury is inherently unknowable . . . , but"
  for "… unknowable and the plaintiff is blamelessly ignorant of it, but": the condition reads broader than the text's). An
  ellipsis that omits a whole "not X, but" contrast keeps what the text asserts and passes, with a note ("The question is . . .
  whether the method is reliable" for "The question is not whether the expert is right but whether the method is reliable").
  An ellipsis at an edge of the quotation, and an opening capital that presents words from the middle of a sentence as its
  start ("[I]t cannot be said" for "Unless a defendant makes both showings, it cannot be said"), are read to the sentence
  boundary the same way.
- **A quotation that begins mid-sentence** is held when the part of its sentence before it is a condition or a limit: it opens
  with "Only", "Unless", "Except", "If", "Absent", "Provided", "Where", "When", "To the extent" and the like; or it ends with a
  comma right before the quotation and the stretch since the punctuation before that holds such a word; or its last clause,
  after the last semicolon, colon or "but", carries a negation.
- **The lead-in.** The same part of the sentence, when nothing above holds the quotation, is printed beside its PASS and read
  for whose words follow. The answer is can't tell, "found as a party's position, not the court's" (or another court's words,
  a separate opinion's view, someone else's position), when the words before the quotation:
  - report another's position: a reporting verb whose subject is not the court, with its inflections and what follows it
    ("Appellant argues that", "contends in its brief that", "the court below held that"); a verb that governs coordinated
    that-clauses ("The Supreme Court of South Carolina held (1) that …, and (2) that, in that circumstance,"); a request of the
    court ("Bravo asks us to hold that", "urges us to", "would have us", "requests that we"); the court told ("We are told
    that"); a position named by its noun and holder ("Bravo's position is that", "the contention that"; never "our view" or
    "the better view"); quoted or attributed matter ("relying on Conley's statement that", "the familiar statement that", "the
    District Court's finding that", "quoting X,"); a party's filing as the speaker ("Tamberly's brief states that", "the reply
    brief argues that"); a report with no speaker ("it is argued that");
  - open the sentence on another's view: "In Bravo's view,", "According to Bravo,", "Under Bravo's reading,", "Under the rule
    Bravo proposes," ("In our view," and "According to the statute," are the court's own);
  - state a counterfactual or a possibility ("we might hold that", "Were we …"), a hypothetical ("Assuming that"), a rejection
    ("It would be a mistake to conclude that") or a question ("The question is whether").

  The court's own voice passes ("We hold that", "this Court held that"), and so does the court adopting what it reports
  ("Petitioners suggest, and we agree, that", "Appellant correctly argues that"). A verb that only reports ("held", "stated",
  "found", "said") holds the quotation when its speaker is a party, a separate opinion, or another court; a verb a party or a
  critic uses ("argues", "contends", "maintains", "urges", "concedes") holds it whoever its subject is, unless it is the court.
- **The view runs on.** A sentence that introduces another's view makes the sentences after it, in its paragraph, that view's
  until the court speaks again. A view is introduced by an opener at the sentence's start ("In his view,", "According to
  Bravo,"), by a party's or a critic's verb or a position's noun with "that" or a colon after it, by a request of the court
  ("Rotkiske urges us to …"), or by a sentence that announces a party's arguments ("Bravo makes two arguments."); a report of a
  holding ("The district court held that …") is not one. The court speaks again in a sentence that opens on "we", "our", "this
  Court" or "the Court" ("The Court disagrees."); that judges the view or a stated rule ("That reading is foreclosed by the
  text.", "That rule no longer holds.", "It is mistaken.", "Not so."); that concedes in its own voice ("It is true that", "Of
  course,"); or whose first clause says "we hold", "we disagree" and the like. A sentence that opens on a headnote marker
  ("HN2[ ] A conclusory affidavit …", "[2] A court may …") is where the publisher marks the court's own statement of a point
  of law: it carries no view from the sentence before it.
  A paragraph ends at a blank line, or at every line break of a text that prints one paragraph per line. So the middle sentence
  of "In his view, the general discovery rule should apply. A statute of limitations under the FDCPA begins to run when the
  plaintiff discovers the violation. We disagree." answers can't tell, naming the sentence that introduced the view. A
  quotation that begins where its sentence begins prints the sentence before it beside its PASS.
- **A quotation within the opinion.** Words that stand inside the opinion's own quotation marks (an opening mark before them
  and its closing mark after them, in their paragraph) are the words of what the opinion quotes. Its source is the speaker the
  lead-in names ("relying on Conley's statement that", "the Ninth Circuit held that"), else a case named in the sentence or the
  citation after the closing mark. A PASS says so: "It is a quotation within the opinion, attributed to the Ninth Circuit; the
  brief should say (quoting Smith v. Jones)", or "…, as the citation says (quoting …)". When one of the next two sentences of the
  paragraph (a citation sentence aside) rejects it, the answer is FAIL: "the court rejected this standard: line 37: "We could go
  on, but there is no need to pile up further citations to show that Conley's "no set of facts" language has been questioned,
  criticized, and explained away long enough."". A rejection is a strong word ("retirement", "overrule", "abrogate",
  "repudiate", "disapprove", "abandon", "explained away", "no longer", "reject this standard" and the like), not negated, in a
  sentence that names the statement ("this famous observation"), its source ("Conley's") or three of its words in order. A
  party's words quoted after "Appellant argues that" stay reported speech.
- **Negation.** A quotation that starts right after a negation in its clause answers can't tell ("permit a State to forbid …"
  from "do not permit a State to forbid …"). The clause is read back up to 80 characters, to the nearest period, semicolon,
  colon, question or exclamation mark, and only after the last "but" or the last comma before "and", "or", "nor", "yet" or
  "so": in "we do not require heightened fact pleading of specifics, but only enough facts to state a claim to relief that is
  plausible on its face" the words after "but" are not negated, and in "does not create a genuine dispute, and a party may not
  defeat summary judgment …" the clause after ", and" is its own. ", and that" or ", or that" coordinate a further complement
  under the same verb and keep its negation ("We do not decide today that X, that Y, or that Z").
- **Inner quotation marks.** Inner marks the quotation drops or adds answer can't tell, because they say whose words they are.
- **The cut at the end.** A quotation that stops before its sentence ends prints how the sentence continues, and answers can't
  tell, "the cut ends before a limitation", when the continuation opens (after a comma, dash, semicolon, colon or parenthesis)
  with a limiting word ("but", "unless", "except", "only", "however", "provided", "if", "where", "when", "until", "to the extent",
  "subject to", "yet") or a negation, or with a set-off phrase of time or procedure; or goes on in the same clause with a negation
  or a word that denies what precedes it ("inapplicable", "insufficient", "rejected"). A closing ellipsis over it answers the
  same way. A concession ("notwithstanding …", "although …") and a continuation that is only a citation are not limitations. A
  fragment presented as a whole sentence says so, with the full sentence.
- **A FAIL that rests on furniture.** When a passage differs from the quotation only by words the text has and the quotation
  does not, each shaped like a citation or a page's running header (a reporter citation, a case name with " v. ", "Thomson
  Reuters", "USLW", numbers and capitalized abbreviations), the answer is can't tell, never FAIL. Its remedy is the printed page,
  or "(citation omitted)"; it never tells the writer to change the quotation.

**Known limits.** These cases go unexamined or are over-cautious:

- **A frame the reader does not list passes,** with the words before it printed ("the theory, advanced by the Government in
  its reply, holds that"); a view introduced in an earlier paragraph is not carried. Read what a PASS prints.
- **The court's own words can answer can't tell.** "The court" in small letters in the past tense is read as another court; a
  sentence after a party's view that continues in the court's voice without "we", "our", "the Court", a headnote marker or a
  judging word ("The statute says otherwise.") is held as that view's; "We are persuaded by the contention that" answers can't
  tell.
- **A rejection in other words, or more than two sentences later, is not read:** the quotation passes with its notice. A
  quotation the court rejects only in part FAILs. Read the sentences after it.
- **A condition in an earlier coordinated clause holds a quotation,** because a condition can govern every clause of its
  sentence and the engine does not tell which ("Unless X, A, and B": a quotation of B answers can't tell). A negation reaches
  only to the end of its clause (a semicolon, "but", or a comma before "and", "or", "nor", "yet", "so"), and over ", and that"
  or ", or that".
- **A limitation it does not read passes,** with the continuation printed ("the time limit is mandatory" from "… mandatory and
  jurisdictional."). **A benign contrast or a benign omission that carries a condition word answers can't tell** (a cut before
  ", but it does not unlock the doors of discovery …"; ", together with the affidavits, if any,"). **A condition with no
  trigger word passes**, unless it is a set-off phrase of time or procedure.
- **A section the text does not mark is read as the opinion,** and a part read as editorial matter that is the opinion answers
  can't tell. A majority footnote printed after a dissent answers can't tell. A plurality designated in another form is named
  "the majority opinion". Page furniture with no vendor line is not read out. A bracketed number at the start of a sentence is
  read as a headnote number. A parallel citation finds its text only when the sources are keyed by it. All of this was tested on
  mock-ups of Westlaw and Lexis layouts, public-archive texts and slip opinions, not on real vendor downloads.

## The current blind number

The second legal blind set (2026-10-05), half B. Its preregistration was hashed before the set was built (full file sha256
`27cbb26aa8e5ca9e85b01a6deb5d353cc2ff91e5c1e228aa2c2ae92565cba7aa`; the body above its footer,
`bfaf202aab0f5b5155c5d8b994c9637dfa4a71941f06beb875ae465812c1259e`). The numbers below are the bench table `legal-blind-2` in
[BENCH.md](BENCH.md); its prereg, per-case results and misses ship in `docs/bench/legal-blind-2/`. The prereg was hashed and
run on 2026-10-05 (run at 14:26:10Z), before the first timestamp in this tree. A timestamp authority signed it at
18:07:30Z, 221 minutes after the run, so the table reads "stamped after the run": the stamp shows the text existed by then,
not that it came before the run. Genuine quotations are quotations that 1973 U.S. Reports opinions make of earlier opinions;
known-bad ones are those quotations altered, elided, fabricated or bracket-changed by fixed rules. Intervals are Wilson 95%.
Four of the ten genuine items are label errors in the set's own extraction (the cite taken was an order, a statute or the case
the quotation is about); every rule answers can't tell on them, which is right, but they count against the genuine columns. The
last column sets them apart; it is post-hoc (an AI agent found them in the run author's audit), shown beside the blind number.

| rule | known-bad quotations passed | genuine quotations failed | genuine quotations passed | genuine quotations can't tell | genuine passed, the 4 label errors set apart |
|---|---|---|---|---|---|
| `legal@0.5.4` (the default; **post-hoc**) | 0/10 (0.0% to 27.8%) | 1/10 (1.8% to 40.4%) | 4/10 (16.8% to 68.7%) | 5/10 | 4/6 (30.0% to 90.3%) |
| `legal@0.5.3`, `0.5.2`, `0.5.1`, `0.5.0`, `0.4.0` (**post-hoc**) | 0/10 (0.0% to 27.8%) | 1/10 (1.8% to 40.4%) | 4/10 (16.8% to 68.7%) | 5/10 | 4/6 (30.0% to 90.3%) |
| `legal@0.3.0` (**post-hoc**) | 0/10 (0.0% to 27.8%) | 1/10 (1.8% to 40.4%) | 5/10 (23.7% to 76.3%) | 4/10 | 5/6 (43.6% to 97.0%) |
| `legal@0.2.0` | 0/10 (0.0% to 27.8%) | 1/10 (1.8% to 40.4%) | 5/10 (23.7% to 76.3%) | 4/10 | 5/6 (43.6% to 97.0%) |
| `legal@0.1.0` | **2/10** (5.7% to 51.0%) | 1/10 (1.8% to 40.4%) | 5/10 (23.7% to 76.3%) | 4/10 | 5/6 (43.6% to 97.0%) |
| `legal@0.0.1` | 0/10 (0.0% to 27.8%) | 3/10 (10.8% to 60.3%) | 3/10 (10.8% to 60.3%) | 4/10 | 3/6 (18.8% to 81.2%) |

With the label errors set apart, `legal@0.5.4` failed 1 of the 6 genuine quotations (an OCR error in the public text) and
answered can't tell on 1 (a quotation that starts after "or that", with a "not" earlier in its sentence: the negation reaches
over ", or that", so the hold stands).

**Only the three rows under `legal@0.3.0` are blind:** they ran once, together, as the preregistration requires. Every later
rule was built from cold readers' cases, not tuned on this set, and run on both halves afterwards with the outcomes known and no
note hashed before the run, so neither set is held-out for any of them (the `legal@0.3.0` row is the post-hoc bench table
`legal-blind-2-030`). `legal@0.5.3`'s first run on both sets gave every outcome `legal@0.5.2` gives (40 of 40, 58 of 58, the
first set's texts each given a caption line, 0 of 20 known-bad and 0 of 18 supplementary false quotations passed), and the
changes that followed a run on the readers' own briefs left them so; `legal@0.5.4` gives every outcome `legal@0.5.3` gives on
the second set (40 of 40, run from the shipped texts on 2026-10-14). What was built and changed for each earlier rule is in
CHANGELOG.md.

**Read it with these cautions.** n is 10 per cell, and the intervals are wide: over both halves the rules from 0.2.0 on passed 0
of 20 known-bad quotations (0.0% to 16.1%), not yet the large blind number a risk committee should rely on. Most other misses
are OCR errors in public texts; the page marks a firm's downloads carry instead are read out, as tested on the cold readers'
mock-ups, not on real downloads. The known-bad items were made by fixed rules (altered, elided, fabricated, bracket-changed):
none is one of the classes the cold readers found (a later opinion that cites the case, a cut before a condition or a
limitation, editorial or separate-opinion words, words after a lead-in or in a view that runs on, a quotation the opinion
rejects). Those are in the readers' tables in CHANGELOG.md, not in this number. The next step is a blind run on your own briefs,
scored by you: see "Running it on your own briefs".

## Binding the text to its cite

**Strict, the default.** A text is used for a citation only when its **caption** names the cite: the reporter citation (volume,
reporter and page; spacing and periods free, a pin cite ignored) and one distinctive word of each party. The caption is read
from the top of the text, at most its first 12 lines and before its first line of more than 400 characters: the case-name line
is the first line with " v. " (or "v." alone between the parties, or "In re", "Ex parte", "Matter of"); the citation line carries
the reporter citation, or a Westlaw or Lexis database number ("2025 WL 1188234", "2024 U.S. Dist. LEXIS 48213"), within three
lines above the name or two below it ("Cite as: 598 U. S. ____" anywhere counts); a line that
holds a sentence, or ends with a colon, is never caption. A party the brief abbreviates ("FTC") is named by the caption's full
name. Otherwise the answer is can't tell, saying what the caption says the text is, or that the citation line sits outside the
caption window. Put the caption on its own lines at the top:

```
Makarova v. United States
201 F.3d 110 (2d Cir. 2000)
```

**Vendor downloads as delivered.** A Lexis header's block after the line "Reporter" ("477 U.S. 317 *; 106 S. Ct. 2548 **; …") is
read as its caption citation line, with no edit to the text; a labelled line after it ("Disposition: 244 U.S. App. D.C. 160, …")
binds nothing. A Westlaw download's KeyCite flag and treatment line ("Declined to Extend by Nease v. Ford Motor Co., …"), and a
PDF footer or banner at the top, are skipped when the caption is read, and the lines under its closing "All Citations" heading
("509 U.S. 579, 113 S.Ct. 2786, 125 L.Ed.2d 469") are caption citation lines. The report says which line bound.

**Finding the text for a citation.** By its `source_key`; by its cite as written; by each reporter citation or database number
read off the cite, with a parenthetical, the pin page and a case name before it read off ("Anderson v. Liberty Lobby, Inc., 477
U.S. 242, 248 (1986)" reads "477 U.S. 242", spacing and periods aside; "Calloway Precision, Inc. v. Northgate Components Corp.,
2025 WL 1188234, at *3 (D. Minn. Apr. 18, 2025)" reads "2025 WL 1188234"); by its case name; by its id. A miss says what it
looked for and what was supplied. **Short forms.** "477 U.S. at 248" is read as a pin cite to the one full citation of the same
brief it fits (same volume and reporter, a first page at or before the pin, every party a named short form gives), and the
answer says so; none or more than one answers can't tell, "short form; supply the full citation". The engine never resolves
"Id." or "supra"; the brief reader does, before the engine runs (see "From a .docx").

**Parties only, opt-in, never certified.** A text whose caption names every party but not the reporter citation can be supplied
with `"bind": "parties"` (or `--bind parties`). Its citations are checked, and the answer stays open even when the quotation is
found: the verdict is PASS-WITH-OPEN (or INSUFFICIENT_DATA) and the verb exits 2, because another opinion in the same case
carries the same caption. The claim's reason begins "bound by parties only", `opinion_sources` records `tier: "parties-only"`,
the choice ledger records the stated binding, and the headline counts such citations. The remedy is the reporter citation in the
caption, or the attorney of record's confirmation.

## Provenance

Supply each opinion text as a string, or with its origin: `{ "text": "...", "source": "...", "url": "...",
"retrieved_at": "2026-10-05T13:00:00Z", "bind": "strict" | "parties" }`. Every verdict records, per text, its key, its sha256,
its length, the origin and binding you stated, what its caption says it is, the sections it read, and what it names for each
citation (`opinion_sources`). All of it is part of the input: change it and the verdict no longer replays. A text is hashed byte
for byte; the citations verb reads every file as strict UTF-8, and a byte that is not UTF-8, or a byte-order mark, is refused with
its offset, never replaced or stripped. Re-save such a file as UTF-8 without the mark.

## How to run it

```
node packages/verify/dist/cli.js citations brief.json --sources opinions/ [--ruleset legal@0.5.4] [--bind strict|parties] [--json] [--bundle verdict-bundle.json]
```

- `brief.json` is a JSON array of citations, or `{ "citations": [...] }`; each is `{ "id", "cite", "case_name", "quote" |
  "proposition", "source_key"? }`.
- `opinions/` holds UTF-8 text files: a `sources.json` manifest (`{ "<cite>": { "file", "source", "url", "retrieved_at", "bind"
  } }`), or one `<cite>.txt` per opinion. `--bind` sets every text's binding.
- It prints one line per citation (PASS, FAIL or INSUFFICIENT_DATA, with the reason and the remedy), then each text's origin,
  sha256 and caption, then the verdict. Exit 0 means every citation was checked and held, 1 a FAIL, 2 some citation could not be
  checked or is bound by parties only, 3 a usage or input error.
- The report goes to stderr; with `--json` the verdict goes to stdout. `--bundle` writes a file `verify replay` re-performs.

A worked example: `docs/examples/legal-citations.json` with `docs/examples/legal-opinions/`. From the library (`npm run build`
first): `verifyCitations(readCitationsFile('brief.json'), loadOpinionFolder('opinions/', 'strict'))`, or
`runCitations(['brief.json', '--sources', 'opinions/'])` for the command's exit code, from `./dist/index.js`. The same check is
the HTTP route `POST /v1/verify/citations` and the MCP tool `verify_citations`, taking `{ citations, sources, ruleset? }`.

**Citation text is read up to 1,024 characters.** The command, the HTTP route and the MCP tool refuse a cite, case name or
source key, or the key of a text, longer than 1,024 characters, before anything is read or hashed: exit 3 on the command line,
`400` over HTTP, a tool error over MCP, each naming the bound and the length. It is a refusal, never a verdict; a citation at or
under the bound is read exactly as before. The longest citation in this package's legal fixtures, blind sets and the cold
reviews' briefs is 122 characters, a cite with a "(quoting …)" parenthetical. A 64 KB citation made of a long run of spaces or of
open parentheses took 4 to 16 seconds through the patterns that read a citation, and a text's key is read again for every
citation of the brief. Characters are counted as JavaScript counts a string: a character outside the Basic Multilingual Plane
counts two. The library's `verifyCitations` has no bound.

**Many citations in one request.** The check reads a brief's citations once per request. A short form finds the full citations
it can point to, and a citation finds the texts keyed by the reporter citation read off it, through an index made once, not by
reading every citation or every key again for each one. 4,000 citations of genuine length, half of them short forms, take about
0.1 s through the library, and so do 4,000 citations looked up against 4,000 texts; before 2026-10-20 they took 17 to 29 s. What
costs time for each citation is reading its quotation against its text and binding the text by its caption: a 67-citation brief
from this package's test fixtures, repeated to 4,000 citations against its own texts, takes about 3 ms a citation. No door
bounds the number of citations. Over HTTP a request is at most 4 MiB, and the service's check budget (60 s by default) answers
413 to a check that runs past it; MCP and the command line have no time budget.

## From a .docx

```
node packages/intake/dist/cli.js brief brief.docx --out brief.json --report brief.report.json
```

The intake package's `brief` command reads a Word brief and writes `brief.json`: every quotation (a double-quoted stretch of
three words or more, or a block quotation, a paragraph indented half an inch or more) with its citation, and the paragraph it
sits in kept in the id ("p12-q1", "fn3-q1"). "Id.", "supra" and short forms ("Harborline, 912 F.3d at 458") are resolved to the
full citation that came before them, in reading order, a footnote read where its reference sits; the citation written to the
file is the reporter citation or database number, the pin and the parentheticals the brief prints after it ("912 F.3d 455, 458
(8th Cir. 2019) (quoting …)"), with the case name the full citation prints. A "(quoting …)" the brief writes inside the quotation
stays there: the engine reads it as the brief's own. Whatever the reader cannot resolve (a short form with no full citation before
it, a quotation with no citation after or before it) is printed first, under `NOT READ`, with the passage around it, and is still
written to the file so the engine answers can't tell for it; the command then exits 2. The report (`--report`) lists every
quotation, resolved or not, by paragraph. It reads no PDF, calls nothing, and is a prototype with no measured accuracy: read its
`NOT READ` list, then run the engine on what it wrote.

## Replaying a verdict under an older rule

A verdict names its rule and replays under it, byte for byte, so an issuer could choose the oldest rule that passes a quotation
and the replay would still say VERIFIED. Two things tell the relying party. **Today's reading:** when today's default reads the
same inputs differently, the replay prints a second line under its headline, and its JSON carries the same reading as `rule_now`:

```
verify replay: outcome VERIFIED: re-performed with legal (ruleset legal@0.0.1, engine 0.6.0) and byte-identical, issued_at aside.
verify replay: PASS: 1 of 1 check ran and held
  under today's default legal@0.5.3 (engine 0.7.1) this quotation reads can't tell: SELECTIVE_QUOTE (elided condition), not PASS
```

**A floor on the rule:** `--require-ruleset 'legal@>=0.5.3'` fails, with exit 1, a replay whose verdict names an older legal rule;
the verdict still re-performs, and the replay says why it fails. Quote the value: a shell reads `>` as a redirect. A legal
replay's scope line says what it was checked against, and states no evidence floor. Details: [REPLAY.md](REPLAY.md).

## Running it on your own briefs

A pilot is a blind run on briefs your firm has already filed or drafted, scored by your own people. Nothing here needs a vendor
in the room.

**What the firm runs.** One command, on one machine the firm controls (a litigation-support workstation or a server inside the
firm's network), with Node.js and this repository built from source (see the README's Install). A paralegal prepares two
things: the brief's citations as `brief.json` (each quotation's id, cite, case name and quoted words, exactly as the brief prints
them, with any parenthetical it carries, in the quotation or after the citation: "(citation omitted)", "(cleaned up)",
"(quoting …)"; from a Word brief, the `brief` command writes this file, see "From a .docx"); and the opinion texts, as UTF-8
text files, one per cited opinion, as the vendor delivered them, converted once and kept unedited (see
[LEGAL-TEXT.md](LEGAL-TEXT.md)). That text runs as it comes. What still answers can't tell: a footnote call in another form inside
the quoted words, unless the quotation says "(footnote omitted)"; a majority footnote printed after the dissents; a parallel
citation with no key of its own. All of this was tested on mock-ups of vendor layouts typed by cold readers, not on real
downloads.

**What it keeps, and where.** The engine writes nothing unless asked. Its report goes to the screen; with `--json` the verdict
goes to stdout, and with `--bundle <file>` a replay bundle is written where you say. The verdict holds every quoted passage it
compared, the claims and their remedies, and each text's sha256, length and stated origin; not the whole texts. **The bundle
holds every quotation of the brief and every opinion text in full, in one JSON file.** For a privileged draft, that file is work
product: keep it with the matter file, or destroy it on purpose when the matter's retention schedule says so.

**What never leaves the building.** The engine calls no AI model and makes no outbound network call: not the command, not the
HTTP server, which only listens on a port you choose. The library's webhook dispatcher, which POSTs a verdict to a URL, runs only
when an integrator writes code that passes it to the library's HTTP service, and nothing shipped here does. The engine runs on a
machine with no network connection.

**How a blind run is scored.**

1. Before the run, someone outside the drafting team picks the briefs and writes down, per quotation, whether it is accurate
   as quoted, from the printed opinions. Seal that list (a hash of the file, kept by someone else, is enough).
2. Run the command on each brief, against the opinion texts the firm would use.
3. Score each answer against the list. A PASS on a quotation the list says is not accurate is the number that matters: it is
   the quotation the check would let through. Count can't tell answers apart: each is work for a person, not an error.
4. Keep the bundles of any answer you dispute. Anyone can replay a bundle and get the same answer, byte for byte.

The engine's own numbers come from public opinions and fixed rules for altering quotations. Your briefs are the number your
risk committee should read.

## The record

[`CHANGELOG.md`](../CHANGELOG.md), under "Legal rule 0.5.4", carries what this page used to carry for each earlier rule: what each
rule added and what each earlier rule gets wrong ("Changelog"); each time the default moved, with the rows it moved on; the cold
readers' adversarial briefs, the first to the tenth, with their tables; the notes on which blind rows are post-hoc and why; the
replication table on both blind sets; and the earlier runs on the first blind set. [BENCH.md](BENCH.md) cites some of these by
the section names they had here.
