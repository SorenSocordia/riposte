# Clarifications to PREREG.md (written before any engine call, while writing the build harness)

PREREG.md is unchanged (its hashes stand). These are readings of its words that the harness had to fix, written before the
set was built and hashed into `PREREG.sha256` with the harness before the first engine call. None depends on any engine
output.

1. **"followed by a full citation".** The next citation after the closing quotation mark must be the full `<vol> U. S.
   <page>` citation. A candidate is skipped when, between the closing mark and that citation, there is a short form
   (`<vol> U. S., at <page>`) or another reporter citation (`<number> <reporter words> <number>`, e.g. `457 F. 2d 895`):
   the quoted words may then belong to that other authority.
2. **Capital letters in "altered" and "bracket-changed".** The replacement word takes the capitalisation of the word it
   replaces (first letter upper case when the original's is), and keeps the punctuation attached to it.
3. **"elided" with a clause word.** The removal starts at the word and stops before the next comma or semicolon (which is
   kept), or at the end of the quotation; the removed text is replaced by ` . . . ` and runs of spaces are collapsed.
4. **Exclusion by name** is a case-insensitive substring match of an excluded name in the candidate's CAP
   `name_abbreviation`; by cite, an exact match with spaces removed. The test-fixture names applied are listed in
   `items/EXCLUDED.json`, together with every cite and case name taken from X2's manifest and bench rows.
5. **Words** are whitespace-separated tokens; "letters" are Unicode letters.
