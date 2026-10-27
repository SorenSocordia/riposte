# Pattern dialect riposte.pattern/0.1.0: spec sheet

This sheet says what the pattern dialect is, what it means, what it refuses and why, how a pattern outside it is rewritten
into it, and how the two translators in this folder are checked against one contract. A rule written as data names its
text patterns in this dialect; JavaScript and Python each read a pattern through their own translator and give the same
answer on the same text, or say they can't tell.

| file | what it is |
|---|---|
| `SPEC.md` | this sheet |
| `translate.mjs` | the dialect read into a JavaScript `RegExp` (Node.js 20 or later, no dependencies) |
| `translate.py` | the dialect read into Python's standard `re` (Python 3.10 or later, standard library only) |
| `unicode-classes.json` | the pinned class table: letters, numbers and marks of Unicode 16.0, the repertoire, the cased characters, the AP pack's look-alike letters |
| `gen-unicode.mjs` | writes the table from Node.js's own Unicode tables; `--check` compares the file with them |
| `rewrite.mjs` | the catalogue of rewrites: a JavaScript literal written into the dialect with the same meaning |
| `vectors.json` | the contract: constructs, refusals, rewrites, table cases, folds, and the worked example's 33 readings |
| `check.mjs`, `check.py` | run the vectors through a translator and print `passed N, failures M` |

## What it does

- It defines one small pattern language, measured from what the AP and legal packs' 744 regular expression literals use
  (`packages/verify/src/ap/*.ts`, `packages/verify/src/legal/*.ts`, on 2026-10-20), plus one escape a rewrite writes.
- Each translator resolves every class to explicit code point ranges and writes case-insensitivity out letter by letter, so
  neither consults its host's Unicode tables or case folding. JavaScript runs the result with the `u` flag; Python with
  `re.ASCII`, which then governs `\b` alone.
- A pattern answers **match**, **no match** or **can't tell**; on a match it also gives the first match's span in UTF-16
  code units of the text, the unit evidence spans use.

## What it does not do

- It changes no ruleset. The packs keep their own regular expressions; a rule that reads patterns through this dialect is a
  new ruleset version, and none exists yet.
- Capture groups are numbered as written and both translators keep them, but what a group captured is outside this
  version's contract: the answer and the whole match's span are in it. (JavaScript clears a group inside a repeated group on
  each repetition; Python keeps the last value.)
- It does not normalise text. NFKC, accent stripping and case mapping are the business of a normalising step that carries
  its own data; the table holds the look-alike map for that step, and `fold()` applies it character by character only so
  both engines can be checked to read the same map.
- It promises no speed. Both translators keep the pattern's structure, so a pattern that backtracks without bound does so in
  both engines.

## The text a pattern reads

A text is a sequence of Unicode code points. A character outside the Basic Multilingual Plane is one character to every
construct (JavaScript reads it through the `u` flag, Python natively). A lone surrogate is a code point outside the
repertoire. Spans count UTF-16 code units from the start of the text, so a character outside the Basic Multilingual Plane
before a match moves its span by two.

## Grammar

```
Pattern      ::= Disjunction
Disjunction  ::= Alternative ( "|" Alternative )*
Alternative  ::= Term*
Term         ::= Assertion | Atom Quantifier?
Assertion    ::= "^" | "$" | "\b" | "\B"
               | "(?=" Disjunction ")" | "(?!" Disjunction ")"
               | "(?<=" Disjunction ")" | "(?<!" Disjunction ")"           (a lookbehind matches a fixed number of characters)
Quantifier   ::= ( "*" | "+" | "?" | "{" N "}" | "{" N ",}" | "{" N "," N "}" ) "?"?      (N: ASCII digits, at most 1000)
Atom         ::= Char | "." | Class | "\" ClassEscape | "\" CharEscape | "(" Disjunction ")" | "(?:" Disjunction ")"
Class        ::= "[" "^"? ClassItem+ "]"
ClassItem    ::= ClassAtom | ClassAtom "-" ClassAtom                        (a range: two characters, low to high)
ClassAtom    ::= ClassChar | "\" ClassEscape | "\" CharEscape
ClassEscape  ::= "d" | "D" | "w" | "W" | "s" | "S" | "p{" Name "}" | "P{" Name "}"      (Name: L, Lu, Ll, N, Mn)
CharEscape   ::= "n" | "r" | "t" | "u" Hex Hex Hex Hex | "u{" Hex+ "}" | SyntaxChar | "/" | "-"
SyntaxChar   ::= one of  ^ $ \ . * + ? ( ) [ ] { } |
Char         ::= any character of the Basic Multilingual Plane but SyntaxChar
ClassChar    ::= any character of the Basic Multilingual Plane but "\" and "]"
Flags        ::= "" | "i"
```

A hyphen in a class is a range only between two characters; at the start, at the end or after a range it is itself. The
pattern text holds no character outside the Basic Multilingual Plane (write `\u{...}`), so a refusal's position, an index
into the pattern, is the same in every language.

## Meaning

| construct | means | JavaScript writes | Python writes |
|---|---|---|---|
| a character, `\uXXXX`, `\u{...}`, `\n` `\r` `\t`, `\` before a syntax character, `/` or `-` | that code point | the code point, escaped | the code point, escaped |
| `.` | any code point but LF, CR, U+2028, U+2029 | `[^\u000A\u000D\u2028\u2029]` | the same |
| `\d` / `\D` | `0` to `9` / any other code point | `[0-9]` / its negation | the same |
| `\w` / `\W` | `A-Z`, `a-z`, `0-9`, `_` / any other | the class / its negation | the same |
| `\s` / `\S` | the 25 code points of ECMAScript white space and line terminators: TAB, LF, VT, FF, CR, SP, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF / any other | the class / its negation | the same |
| `\b` / `\B` | a boundary / no boundary between a `\w` character and anything else (the text's two ends count as not `\w`) | `\b` / `\B` (no `i` flag is ever written, so both read ASCII) | `\b` under `re.ASCII` / `\B` written out as lookarounds (before 3.14, Python's `\B` fails on an empty text) |
| `^` / `$` | the start / the very end of the text (never before a final line feed) | `^` / `$` | `\A` / `\Z` |
| `[...]`, `[^...]` | the union of its items / every code point outside it | explicit ranges | explicit ranges |
| `\p{X}` / `\P{X}` | the code points the table lists for X (L, Lu, Ll, N, Mn) / every other code point | explicit ranges from the table | explicit ranges from the table |
| quantifiers | greedy, or lazy with `?`; leftmost match first, alternatives tried left to right, as both engines backtrack | as written | as written |
| `(...)`, `(?:...)`, lookarounds | as in ECMAScript | as written | as written |
| flag `i` | an ASCII letter also matches its other case; nothing else folds | each letter as a two-letter class, no flag | the same |

Under `i`, the long s (U+017F) is not an s, the Kelvin sign (U+212A) is not a k and the dotted capital I (U+0130) is not an
i: JavaScript's `u` and `i` flags together, and Python's `re.IGNORECASE` without `re.ASCII`, fold some of these, and the
dialect folds none.

## The class table and can't tell

`unicode-classes.json` (schema `riposte.unicode-classes/0.1.0`) pins Unicode **16.0**: the classes L, Lu, Ll, N and Mn
as `[low, high]` code point ranges, the **repertoire** (every code point assigned in 16.0, surrogates aside), the
**cased** code points above ASCII (those that take part in case mapping or case folding), and **maps.LOOKALIKE** (52
Cyrillic and Greek letters the AP pack reads as Latin, copied by a parse of `packages/verify/src/ap/remittance.ts`).
`gen-unicode.mjs` writes it from Node.js's own tables and names the version; `gen-unicode.mjs --check` exits 1 when the file
and the running Node.js differ. A new Unicode version is a new table file and a new dialect version.

**The rule.** A pattern that names a table class answers **can't tell** on a text holding a code point outside the
repertoire (a code point unassigned in 16.0, or a lone surrogate), because a later Unicode may classify it differently.
A pattern that names no table class answers on any text: its meaning depends on no Unicode version. Both translators carry
the rule in `test()` and `first_match`/`firstMatch()`; a caller that compiles a translated source itself checks
`usesTable`/`uses_table` and the repertoire first.

Both translators read the table they are given, never their host's: the vectors include letters added in Unicode 14.0 and
16.0 (U+0870, U+1E290, U+1C89), which Python 3.10 (Unicode 13.0) and Python 3.12 (Unicode 15.0) do not know as letters,
and two cases run under a doctored table whose letters start at `b`.

## Refusals

A pattern outside the dialect is refused before any text is read, with a code and the position it starts at. Every refusal
has a vector.

| code | refused | why |
|---|---|---|
| `usage` | a pattern or flags that are not strings | |
| `flag` | any flag but `i` | `g`, `y` and `d` are a call's business; `m` and `s` read lines and the dot differently in the two languages; the dialect always reads code points |
| `outside-plane` | a lone surrogate, or a character outside the Basic Multilingual Plane written as itself | positions must count alike; write `\u{...}` |
| `backreference` | `\1` to `\9`, `\k<...>` | JavaScript matches a group that took no part as empty, Python fails; no pack pattern uses one |
| `named-group` | `(?<name>...)` | the two languages spell it differently; no pack pattern uses one |
| `group-syntax` | any other `(?` form: inline flags, comments, Python's `(?P`, scoped modifiers | each means something else, or nothing, in the other language |
| `property` | a property class outside the table | the dialect reads only what the table pins |
| `escape` | `\x`, `\c`, `\0`, `\f`, `\v`, `\A`, `\Z`, `\z`, an escaped letter or quote, `[\b]`, a malformed `\u` | JavaScript without `u` reads `\A` as A, Python as the start; the others are unused by the packs |
| `lookbehind-width` | a lookbehind whose branches differ in length, or that holds `?`, `*`, `+` or a range count | Python refuses it; R-LB-SPLIT rewrites the bounded ones |
| `quantified-assertion` | a quantifier on `^`, `$`, `\b`, `\B` or a lookaround | JavaScript without `u` allows some, Python refuses them |
| `nothing-to-repeat` | a quantifier with nothing before it, or after another | |
| `count` | a count above 1000, or a lower bound above the upper | |
| `brace` | a lone `{`, `}` or `]`, or `{,n}` | JavaScript without `u` reads them as characters, newer Python reads `{,n}` as a count |
| `class-range` | a range from or to a class escape, or high to low | |
| `empty-class` | `[]`, `[^]` | Python reads `[]` as the start of a class holding `]` |
| `unclosed` | an unclosed group or class, a `)` with no group | |
| `trailing-backslash` | a pattern ending in `\` | |
| `case-fold` | under `i`, a character above ASCII that has another case | the dialect folds ASCII letters only, so the pattern would not mean what it seems to |
| `cased-class-fold` | under `i`, `\p{Lu}` or `\p{Ll}` | JavaScript's `u` and `i` flags read them as letters of either case |

## Rewrites

A JavaScript literal is in the dialect as written when its source parses and its flags are `i`, `g` or `u` (`g` set aside
as a call's business, `u` because the dialect reads code points). Otherwise a rewrite from this catalogue may bring it in.
`rewrite.mjs` applies them; each has vectors whose expected answers are the original literal's, and the rewritten form must
give them through either translator.

- **R-LB-SPLIT.** A lookbehind whose branches have different lengths, or that holds a bounded quantifier, is expanded into
  its fixed-length branches and written as one lookbehind per length: `(?<!A|B)` as `(?<!A)(?<!B)`, `(?<=A|B)` as
  `(?:(?<=A)|(?<=B))`. Refused when a branch is unbounded, a capturing group would be copied, or more than 256 branches
  would be written.
- **R-UFOLD.** A literal read under JavaScript's `u` and `i` flags folds by Unicode simple case folding: `s` matches the
  long s, `\w` and `\b` count the long s and the Kelvin sign as word characters, and `\p{Lu}` matches letters of either case.
  R-UFOLD writes that meaning out without the `i` flag: each letter and class with every character that folds to it, `\b` as
  lookarounds over that word class, and the characters of a folded table class outside the Basic Multilingual Plane by
  `\u{...}` (the reason that escape is in the grammar). It reproduces JavaScript's own `RegExp` and was measured against it
  over every code point for each construct the packs use under these flags.

A literal read **without** the `u` flag reads UTF-16 code units: its negated classes, `\W`, `\S`, `\D` and the dot can take
half of a surrogate pair. No rewrite restores that, since the dialect reads code points; such a literal answers differently
on text holding a character outside the Basic Multilingual Plane, and a rule version that adopts the dialect takes that on
knowingly.

## Translating by hand, for a third reader

Parse by the grammar; refuse as the table above says, at the same positions. Resolve every class, escape class, dot and
table class into sorted code point ranges; under `i`, add the other case of each ASCII letter, and write a letter outside a
class as its two-letter class. Write ranges with escapes your engine reads as code points, `\b` with ASCII word characters,
`\B` as lookarounds where your engine misreads an empty text, `^` and `$` as the start and the very end. Apply the
can't-tell rule before matching. Report spans in UTF-16 code units. Then run `vectors.json`.

## The vectors

`vectors.json` (schema `riposte.pattern-vectors/0.1.0`) pins the table by its sha256 and holds:

| part | what each case says |
|---|---|
| `constructs` | a pattern, its flags, probe texts and, for each, the answer and the first match's span; `oracle` is `js` (JavaScript's `RegExp` on the pattern and its flags) or `js-u` (with the `u` flag added); a probe with `why` states its answer by the dialect's own rule (can't tell; a character outside the Basic Multilingual Plane) |
| `refusals` | a pattern refused with its code at its position |
| `rewrites` | `from` (a JavaScript literal), `to` (its dialect form) and probes answered as the literal answers |
| `table_cases` | patterns run under `doctored_table` instead of the pinned table |
| `folds` | `fold(text, "LOOKALIKE")` |
| `worked` | the eight patterns of the AP pack's opening step of a payment redirection (`ap-threeway@0.4.0`), its formula, and 33 probe sentences with each pattern's answer and the shipped reading's |

The vectors were written from JavaScript's own `RegExp` and the shipped AP code, and a builder refused to write them while
`translate.mjs` disagreed with any of them. A formula combines answers as `all`, `any` and `not`; were a pattern to answer
can't tell, `all` and `any` would read it as unknown (Kleene's three values).

## Programs and exit codes

| program | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| `node translate.mjs <pattern> [flags]`, `python translate.py <pattern> [flags]` | translated (the source and flags printed as JSON) | | | refused (`refused at <position>: <reason>`), or a usage error |
| the same with `--test <text>` | match | no match | can't tell | refused, or a usage error |
| `node check.mjs`, `python check.py` | every case as expected | at least one was not | | the vectors or the translator cannot be read |
| `node gen-unicode.mjs [--check]` | written, or the file matches this Node.js | the file differs (`--check`) | | the look-alike map's source cannot be read and the file holds no copy |

`check.mjs` also checks the rewrite catalogue (`rewrite.mjs` writes each `to` from its `from`); `check.py` checks each
rewrite's written form on its probes. Both check the table's sha256 and the worked example's 264 pattern answers and 33
readings.

## Vocabulary

Answers: match, no match, can't tell. A pattern is in the dialect, refused (with a code), or rewritten (by a named rewrite).
The table is the pinned class table; the repertoire is the set of code points it classifies.
