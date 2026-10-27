# AP stress study, development seeds: the misses, as transcribed

The five wrong decisions the authors' stress write-up of 2026-09-23 records for the development seeds (sha256 in `REPORTS.sha256`), with the fix it names for each.

| miss | kind | description |
|---|---|---|
| default-T061 | development-seed | default seed, case T061: a false hold. OCR-style noise turned "Shipping and handling" into "Shippign and handling", the line was not recognised as freight, and its amount was ignored, so a good invoice failed the total check. The write-up names T061 and T087 and one wrong decision each under OCR letter noise and under all perturbations combined, without pairing them |
| default-T087 | development-seed | default seed, case T087: a false hold with the same cause as T061: the misspelt freight line was not recognised and its amount was ignored, so a good invoice failed the total check (one of the two default-seed wrong decisions; see T061) |
| fresh1-T084 | development-seed | fresh1 seed, case T084: a false hold. The total "$1 555.63", with a space as the thousands separator, was read as 555.63, so a good invoice failed the total check. Each of the three fresh seeds gave this one wrong decision, on the same case, after the first fix |
| fresh2-T084 | development-seed | fresh2 seed, case T084: a false hold. The total "$1 555.63", with a space as the thousands separator, was read as 555.63, so a good invoice failed the total check. Each of the three fresh seeds gave this one wrong decision, on the same case, after the first fix |
| fresh3-T084 | development-seed | fresh3 seed, case T084: a false hold. The total "$1 555.63", with a space as the thousands separator, was read as 555.63, so a good invoice failed the total check. Each of the three fresh seeds gave this one wrong decision, on the same case, after the first fix |

## The fixes the write-up records

- Fix 1: any money amount that is not a line item, the total, freight or a known stray (a previous balance, a quote)
  makes the total check abstain, quoting the amount and its line. The default seed replayed with 0 wrong.
- Fix 2: a space-grouped amount right after a currency marker ("$1 555.63", "USD 1 555.63") is one number; an unanchored
  space-grouped total is ambiguous, and the total check abstains. All earlier seeds replayed with 0 wrong.
