# Getting text from Westlaw and Lexis

The citations check reads opinion texts as UTF-8 text files. Westlaw and Lexis deliver PDF, Word or RTF. This page says how to
turn a download into the text file the check reads, what to keep, and what the check reads out of it. The rule it applies is
in [LEGAL.md](LEGAL.md); everything here holds under `legal@0.5.4`, the default from engine 0.7.2 (and under `legal@0.5.3`, engine 0.7.1's).

## Convert once, keep what you ran

The verdict records the sha256 of each text file it checked (`opinion_sources[].sha256`), and a replay refuses a file whose
bytes moved. Another conversion of the same download, by another tool or another version of one, can give different bytes.
So convert each download once, keep that text file with the matter, and say in `sources.json` how it was made:

```
{ "509 U.S. 579": { "file": "daubert.txt", "source": "Westlaw PDF, converted with pdftotext -enc UTF-8 -nopgbrk", "retrieved_at": "2026-10-06" } }
```

To print a file's sha256 yourself: `sha256sum daubert.txt` (Linux, macOS, Git Bash), or
`Get-FileHash daubert.txt -Algorithm SHA256` (Windows PowerShell). It is the number the verdict records.

## From a PDF

Use `pdftotext`, from the Poppler or Xpdf tools:

```
pdftotext -enc UTF-8 -nopgbrk daubert.pdf daubert.txt
```

- `-enc UTF-8` writes UTF-8. pdftotext writes no byte-order mark.
- `-nopgbrk` leaves out the form feed it otherwise puts between pages. The check reads it as a space either way.
- Do not use `-layout`. It pads lines with spaces to keep columns, and on a two-column page it can interleave the columns.

The text keeps each page's footer and the next page's running header where the page broke, often in the middle of a
sentence: "© 2026 Thomson Reuters. No claim to original U.S. Government Works. 9", then the case name with its citation,
then the line of parallel citations ("127 S.Ct. 1955, 167 L.Ed.2d 929, 75 USLW 4337, 2007-1 Trade Cases P 75,709"). Leave them
in. The check reads a run of such lines out of the comparison, as one break between words (see "What the check reads out",
below).

A scanned PDF has no text layer, and pdftotext returns little or nothing. Optical character recognition makes errors
("éffecting", "assur-anee"), and the check reports each one as a difference or a can't tell. Ask the vendor for the
download with a text layer, or for the Word file, instead.

A PDF's text layer can print "fi" and "fl" as one character, a ligature ("ﬁ"). Leave it in. Under legal@0.5.5 the check reads it
as its letters; under legal@0.5.4, the default today, a quotation across one answers FAIL naming the ligature, so compare it with
the printed page.

## From Word or RTF

Open the file in Word and save it as Plain Text, choosing the Unicode (UTF-8) encoding when Word asks. Any word processor
that saves plain text as UTF-8 will do. If the saved file begins with a byte-order mark, the check refuses it and says so,
naming the offset. Save it again as UTF-8 without the mark (in Windows Notepad: Save as, encoding "UTF-8", not "UTF-8 with
BOM"). The check never strips a mark on its own: two files that differ by one would share one hash.

## What to keep

Keep the whole download, unedited, as converted:

- **the caption at the top**: the case name and the reporter citation. The check binds a text to its cite by its caption;
  a text that is only an excerpt has none and binds nothing;
- **the headings**: "Synopsis", "West Headnotes", "Syllabus", "Opinion", "Core Terms", "LexisNexis Headnotes", and each
  separate opinion's designation, join clause and all ("Justice STEVENS, with whom Justice GINSBURG joins except as to Part IV,
  dissenting."). They tell the check where the opinion starts and stops, so headnote and dissent words are never passed as the
  majority's;
- **the vendor's lines**: the KeyCite flag, the Lexis "Reporter" block, the "All Citations" lines at the end, star paging,
  headnote numbers and footnote calls. The check reads each of them for what it is;
- **the footnotes**, where the download prints them.

Do not move the caption, delete a heading, or remove a page mark by hand. A copy edited that way no longer matches the
vendor's file, and its verdict records the edited copy's hash.

## What the check reads out

These are read out of the comparison, on both the text's side and the quotation's, and named on the answer that relied on
them. The text itself is never changed: every answer's evidence points into the file as you supplied it.

| what | example | named on the answer as |
|---|---|---|
| star paging | `*248`, `**2510`, `[*249]` | "star paging ignored (*248)" |
| a Westlaw headnote number between sentences | `[9] Second, …` | "a headnote number ignored ([9])" |
| a Lexis headnote marker | `HN4[ ] To the contrary, …` | "a headnote number ignored (HN4[ ])" |
| a footnote numeral glued to sentence punctuation | `counted.4 This` | "a footnote numeral ignored ("counted.4")" |
| a PDF's page footer and running header | `© 2026 Thomson Reuters. … 9`, then the case name and citations | "a page break's footer and running header read out (…)" |

A run of page furniture needs one of the vendor's own lines to start it: the Thomson Reuters footer, a Westlaw banner line, a
"Page N of M" line, or a KeyCite flag line. Next to one, a line that is only a case name with its citation, only a page number,
a KeyCite treatment line, or only parallel citations belongs to the run. A line of parallel citations is read by its shape,
not by a list of reporters: items between commas, each an optional volume ("127", a looseleaf "2007-1"), reporter words that
open with a capital ("S.Ct.", "L.Ed.2d", "USLW", "Trade Cases", "Fed. Sec. L. Rep. (CCH)") and a page or paragraph ("1955", "P
75,709", "¶ 94,224", a Westlaw number), with one reporter word that carries a period or is written in capitals. A citation line
standing alone in the opinion is never read out. A quotation across a page break whose footer was lost in conversion, leaving a
bare running header, answers can't tell when the header's words are all it lacks, never FAIL.

Other footnote calls are not read out on their own: a Lexis `n7`, a bracketed call glued to a word (`immaterial.[4]`), an
`FN6`, superscript digits. A quotation that matches only with one read out answers can't tell, naming it. If the quotation
leaves the call out on purpose, say so after it with "(footnote omitted)" and it is read out.

When the check reads a download's caption, it skips the KeyCite flag and the treatment line under it ("Declined to Extend by
Nease v. Ford Motor Co., …"), and a page footer or banner line at the top. The "All Citations" lines at the end of a Westlaw
download name the text, as a Lexis header's "Reporter" line does.

## What this was tested on

Every vendor layout on this page was tested on mock-ups that cold readers (AI agents in a buyer's role, not people) typed
from memory, and on public-archive texts. None was tested on a real Westlaw or Lexis download. Run your first pilot brief
against downloads your firm already has, and read every can't tell and FAIL against the printed page.
