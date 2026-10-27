Written before the first run, 2026-10-19 ~18:05. Ideal = what a careful cite-checker should answer. Guess = what I expect this engine to answer, from LEGAL.md.
M01 genuine (ligature fi in text)            ideal PASS        guess PASS
M02 "only" dropped, no ellipsis              ideal FAIL        guess FAIL
M03 West headnote as holding                 ideal CANT        guess CANT
M04 hedge "generally" dropped by ellipsis    ideal CANT        guess PASS (known limit: no trigger word)
M05 genuine across star paging, Bluebook pin ideal PASS        guess PASS
M06 party argument after "Marlowe argues"    ideal CANT        guess CANT
M07 cut before "if" with no comma            ideal CANT        guess CANT? (continuation has "not")
M08 genuine across mid-sentence page break   ideal PASS        guess PASS
M10 ellipsis over "not" in not-X-but-Y       ideal FAIL/CANT   guess CANT
M11 after "We decline to hold that" (+dissent says "I would hold that") ideal CANT  guess PASS (court's "We")
M12 after "The arbitrator reasoned that"     ideal CANT        guess ?
M13 after "Nothing in the agreement suggests that" ideal CANT  guess ?
M14 ellipsis over "rarely" (meaning inverted) ideal FAIL/CANT  guess PASS
M15 ellipsis over "ordinarily"               ideal CANT        guess PASS
M16 after "The district court held that", then "cannot stand" ideal CANT guess CANT
M17 after "In the district court's words,"   ideal CANT        guess PASS?
M18 [noun] for "It" (accepted alteration)    ideal PASS/CANT   guess FAIL (by design)
M19 cut drops 2 of 3 required elements       ideal CANT        guess PASS with continuation
M20 "concurring dubitante:" separate opinion ideal CANT        guess PASS as majority?
M21 dissent with "*1215 " glued to designation ideal CANT      guess ?
M23 must -> may, no bracket                  ideal FAIL        guess FAIL
M25 fabricated                               ideal CANT        guess CANT
M26 Synopsis holdings line                   ideal CANT        guess CANT
M27 WL-number cite                           ideal PASS        guess PASS
M29 "not" removed (contradicted)             ideal FAIL        guess FAIL
M30 "AFFIRMED" cut before "in part and REVERSED in part" ideal CANT guess PASS w/ continuation
M31 curly apostrophe + NBSP in text          ideal PASS        guess PASS
P01 plurality (designation in body)          ideal PASS+plurality note guess PASS+note
P02 dissent ("with whom ... joins, dissenting.") ideal CANT    guess CANT
P03 Lexis "Concur" heading                   ideal CANT        guess CANT
P04 "asks us to hold that"                   ideal CANT        guess CANT
P05 Lexis headnote                           ideal CANT        guess CANT
P07 cut before ", but ... only"              ideal CANT        guess CANT
P08 genuine whole sentence, Lexis "n3" glued after final period ideal PASS guess ?
P09 cut before "only by conduct", no comma   ideal CANT        guess ?
P11 Lexis-number cite, fictional reporter    ideal PASS        guess PASS?
P12 headnote paraphrase                      ideal CANT or FAIL guess CANT
F01 plurality named only in Judges: line     ideal PASS+plurality note guess PASS "majority"
C01 "OPINION ANNOUNCING THE JUDGMENT OF THE COURT" ideal PASS+plurality note guess PASS "majority"?
C02 "JUSTICE MOYLE, DISSENTING" caps         ideal CANT        guess ?
C03 "JUSTICE HAVERFORD, CONCURRING" caps     ideal CANT        guess ?
H01 no text supplied                         ideal CANT        guess CANT
