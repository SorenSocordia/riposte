# Amendment to the AP stress results, 2026-10-05: re-banked under engine 0.6.0

The five holdout stress files in `bench/ap/results/` were first written on 2026-09-23. Since then the production AP pack
gained a fifth check, duplicate detection, so a fresh run of `bench/ap/stress.ts` no longer matched the shipped files byte
for byte. The files were re-run and re-banked on 2026-10-05. This record says what changed.

**Re-run under:** engine 0.6.0, ruleset ap-threeway@0.2.0, `checker_sha256` `a682a5851fca926e27d3218c32532c2d2be7baab3b6b55aa2a7670e3dfd986fe`
(the sha256 over the AP pack's nine source files, sorted by name). Each re-banked row carries those three fields.

**What did not change, across all 3,000 rows:** every row's case id, case kind, gold decision, the decision made, the
wrong flag, and the perturbed invoice text. So every count in the stress table is unchanged: 0 wrong among 2,755 decided.

**What changed, in each row's reasons:**
- all 3,000 rows gain one reason: "duplicate check not run: no payment history supplied, so this bill was not compared with
  what is already booked (pass history to enable it)". The benchmark supplies no payment history;
- the 841 rows that passed every check say "all five checks passed" where they said "all four checks passed".

No other field moved. After re-banking, a fresh run of each holdout seed is identical to the banked files byte for byte.

| file | sha256 as shipped 2026-09-23 | sha256 re-banked 2026-10-05 |
|---|---|---|
| `stress-P1_order-holdout1.jsonl` | `b999644dcf99a3eda4678cc147efd302e4ecc392b2ccbf95ef52c6ac64f2f5d2` | `948a58dacaa868c81db8d12c6cdbc7876e9eb7bce777cce1cf5b8353eb33d2fa` |
| `stress-P2_wording-holdout1.jsonl` | `2a1b126430558cdb40c12718aac0f463a74771fc4b8fbd3aed7e528ba5cd0262` | `4e482912f86ab3c5be09ffd581695fa760018ca9558eaca97f22c0f8bc27f74e` |
| `stress-P3_numbers-holdout1.jsonl` | `c9922fb2cb0b5d9fc5e76d5f833fd760517fc3072508dc775b89a54e77989709` | `bc6de90570aa6685bfc4bda1efa9b6dd67761a62406d357641768be6ecd1d391` |
| `stress-P4_ocr-holdout1.jsonl` | `7d2a9b0d45918a9bbc8b08ff14db65ef7ff7c67ac639f289818e9c3675ab82cd` | `554a82a9549033945e5664bb6d7b61af367a96aadbbf28b45128658012c0e945` |
| `stress-P5_layout-holdout1.jsonl` | `15811bc7298eccc6ec986e2d7f332ed315515936879c6ce201604dedeca4fb9d` | `36106c579172987645b9fa38b1345745431a1edea002df182876ef86b498d461` |
| `stress-P6_all-holdout1.jsonl` | `e045ad201d3ea945845784cc236398cb50db28252836e7c95584b3ebe832bd73` | `48380303264b48cd0d7acadb5bbc8b9ecfa0bdf152df64ae777cdd851e50982e` |
| `stress-P1_order-holdout2.jsonl` | `dc14d7c30630f6b9ec0e15e2b201865b686ac7cbaee97f8c1d7c307b5ef86c84` | `0d3ad94abb4d045bc6df1c5291896b4c5bc3dcf7ed8c8fca14eb121aaee35f1d` |
| `stress-P2_wording-holdout2.jsonl` | `45fe1ea64e7595c748c94d2a939fa1e7ffd8ac4b630b468c9a392e1e3acff032` | `7434cdf84301ff0f94b64034668b6526d953d22eb008c8eefdfa3193c5b1dda2` |
| `stress-P3_numbers-holdout2.jsonl` | `481be7b437ae874ac7e1a4989ee867612d3452c08c684b518cc3b700d7d2b011` | `2af2a668932c0880d21ff249ae649402d9295ada050c89533b17464edce3b0a9` |
| `stress-P4_ocr-holdout2.jsonl` | `641226a931596d6742a0b92519b27202f5559e2583e960fc78467cde2d0ee85f` | `d02910126b70b6fe8a6b3a2a80be5b2d5c7886ef7079091fff9d412481176783` |
| `stress-P5_layout-holdout2.jsonl` | `400e29bd2f109e111f2f3773a42dfdba1d8148b3add4a17a55270463a3e629d8` | `b2a84ffefdf154138a2c1884b0127f9977efd40135fe166bbf44a268507dfea3` |
| `stress-P6_all-holdout2.jsonl` | `29abf2e9acd661ce557df59c71c3db88edf1fa663196f914d57d86e8f761d990` | `b71d127c32d27b2e2efad250c4da7b28ac0017ee45f62ad9879bdb4a117085ae` |
| `stress-P1_order-holdout3.jsonl` | `620f87a723ec9ee9e5446030659f1c300136aeabdc8f3d6d512308f4148fb262` | `c744962121228df87550d752d1b97c85acc74f87670d353270f6e852ad14378d` |
| `stress-P2_wording-holdout3.jsonl` | `c26ba1d60cd55a973e18be4764b39f7572da5e7c868f75c334055517d26f1b1a` | `ff49833b308edd6ad3472672f4db0ac1c8b21fa9e5017c592d5395aed53b5959` |
| `stress-P3_numbers-holdout3.jsonl` | `791a890c31ab8870686b26974d165ee6c0f665c7fc5f7409d0d6ead6aa028ef9` | `6410e794e06a36c5baf5556a6601a4d54685935b8829bbd18517459a250ab6bd` |
| `stress-P4_ocr-holdout3.jsonl` | `1605642b7197bcbf13975ade648a2ce413aeb62bec2efac43c43e9a4b2db97b9` | `fdd7880f7c54f4a43c16c649af8a3553c72fb57141f57f4724e6b4385e5d10a7` |
| `stress-P5_layout-holdout3.jsonl` | `1eceb7ef7d830cc2192c601382edc827d06b3ac7a7aa7c026f58ebe7f6f6b40e` | `0aef06282a459d3302b931478d2d34a96efb3ccc8212569afea369ef40def5f4` |
| `stress-P6_all-holdout3.jsonl` | `cf709a4a09f472e95338b7b7442359366265b39645323f0df490f092136b3222` | `aba4c80448d4916cd8a9bb25f7f5aa66096d03d142c8fa4a1f57b6127f876742` |
| `stress-P1_order-holdout4.jsonl` | `c71a5edd1ae728978740fb816bf99ea7ad118b15b3fb0264058dcf7c1029b26f` | `d1c34db565da3cc9c0ea04f0f2e09db9680e36bc59866ac89f1107abe390489a` |
| `stress-P2_wording-holdout4.jsonl` | `a306e0c20d30fd8307823fc1e6de97e81bbe75e85fc396710f7a75737b8a0e49` | `cfb8c9526f65be07e4ba028c06dc80c2ca285f9bc585b567bfbbb72d798f6e27` |
| `stress-P3_numbers-holdout4.jsonl` | `5828b9bf2215f7615a62ac3aa6c893a2c5dbce54ae6b4020c20d2db4724ba215` | `15c35222a2be9264a00f3c3371d0f10ca1331b7b6051c6fc0715a6db7a50a6fb` |
| `stress-P4_ocr-holdout4.jsonl` | `41637d83fb4e58a063ee0f30c1bbc2a4d89460bd8e6b6c45af8897c52c05f304` | `da61e420583edebe69eac5021c56624956e8824e3235318cf539696e4b511f13` |
| `stress-P5_layout-holdout4.jsonl` | `7b989e2317d9f818c5ab4139ae7cd0750d6e007abb62ec0e229d5a016243673f` | `c591817377a106dc941ceea3bf075fdf984aa67e6e5b087bfcf42c089437d9ef` |
| `stress-P6_all-holdout4.jsonl` | `7be91cb47e0e94598e08e196e03cfa987b0a7311c39673a011bfb7dc872dc7df` | `c1a397c60a163845afb4df7ddfd8666ce47c0d580898e04253f45abcbfa163dd` |
| `stress-P1_order-holdout5.jsonl` | `b544a7d1c4cdd9207d93a910f0aebaf15318c81326c8e57b3af3a88f8d7b1ec3` | `c7395fb8b780b968c710788a326671f717d9ee415119314c311da76bc2574035` |
| `stress-P2_wording-holdout5.jsonl` | `71b9c1e520ef6a3ba66fe5a1961894b151927ba1d6310d38fcdfdb0f43ce790d` | `b10d0332d89311fd6d37d3be52ff65cce2fac35e2ad339849df4463976990cbe` |
| `stress-P3_numbers-holdout5.jsonl` | `e45bda41bfaa19e679bb82d29622de38ffeed5e0b22b759f43fd621309eba201` | `e7dceb4fc9a565e2340c0b4bdc108cf75b364cc963cd0a2cf1733faf4dc8cc3d` |
| `stress-P4_ocr-holdout5.jsonl` | `a0325b169a42de3bcb5e92d0a13e9c973ea0900d3a48b3ac6a7702355b73dd80` | `cf688e70f703a19a656a2598bd0968bedac26a33a0d5898e172a90d7bf85b44c` |
| `stress-P5_layout-holdout5.jsonl` | `a3cc793964d44290d22c10dd03696215cbe651ba0c0f01b3eb09e42ea20b21f1` | `f82c22d73b57463f61f7253ddd7945e2c1eb59eb86fab56ec40893945ecbc33f` |
| `stress-P6_all-holdout5.jsonl` | `853a7f5724faf59faff0c551d87b873875f995d1c6c5b2909f24160208163713` | `de3e518d5b12b1ca6d7469209910fd0fe7a38ad8eea4217ecfb31f2477703d56` |


## Second amendment, 2026-10-05: the harness states an empty payment history

**Why.** Under engine 0.6.0, a bill sent with no payment history is held for a person: the duplicate check could not run, so
nothing may approve it. The benchmark's 100 invoices have no payment history by construction. The harness used to send none
at all. From this amendment it sends an empty one (`history: []`): the history is known, and it is empty. The duplicate check
then runs, finds no booked invoice to compare, and passes. This is a change to the protocol, stated here, never a silent
one. The generator, the perturbations, the seeds and the gold labels are unchanged.

**Re-run under:** engine 0.6.0, ruleset ap-threeway@0.2.0, `checker_sha256`
`29644c7f64fe6cf9c7495508996ce1d0c044d34d0102a7413cd83848d0ca00d6` (the AP pack's nine source files after its last change of
2026-10-05). The five holdout seeds were re-banked with `stress.ts --seed holdout<N> --bank`. A fresh run of each seed is then
identical to the banked files, byte for byte. The seeds were first re-banked under this amendment at digest `32d95b52…`; the
pack then changed one word in `report.ts`, the plain-English text for a person, which the stress harness never calls. They
were re-banked once more, and only `checker_sha256` moved, on every row. The pack changed once more that afternoon, in its
duplicate check, which the harness's empty history never reaches; the files were re-banked again (the dated lines below).

**What moved, across all 3,000 rows:**
- **no decision moved.** Every row's case id, case kind, gold decision, the decision made, the wrong flag and the perturbed
  invoice text are unchanged. So the count is unchanged: **0 wrong of 2,755 decided** (of 3,000 perturbed invoices);
- the 841 approved rows read "all checks passed; the payment history supplied is empty, so the duplicate check had no booked
  invoice to compare", where they read "all five checks passed" and the no-history line;
- the other 2,159 rows lose the line "duplicate check not run: no payment history supplied …";
- every row's `checker_sha256` is the new digest.

The blind run 1 and the disclosed run 2 use their own frozen checkers, not this pack. Re-run on 2026-10-05 after this
amendment, both are identical to the shipped files, byte for byte.

| file | sha256 after the first amendment | sha256 after this one |
|---|---|---|
| `stress-P1_order-holdout1.jsonl` | `948a58dacaa868c81db8d12c6cdbc7876e9eb7bce777cce1cf5b8353eb33d2fa` | `a975f16efb3ed1c70038411d9ef8847d887ac60b5cdb5b193551ea9b0c8eaa80` |
| `stress-P2_wording-holdout1.jsonl` | `4e482912f86ab3c5be09ffd581695fa760018ca9558eaca97f22c0f8bc27f74e` | `3a955e9eb04f2961c16248b0068c6f9d4d2684fa1c423b431e7a3633dd90be8d` |
| `stress-P3_numbers-holdout1.jsonl` | `bc6de90570aa6685bfc4bda1efa9b6dd67761a62406d357641768be6ecd1d391` | `946d940b3043ba1935ac19b0e682afed1a8c0259ba86c216227d043d4bd74d00` |
| `stress-P4_ocr-holdout1.jsonl` | `554a82a9549033945e5664bb6d7b61af367a96aadbbf28b45128658012c0e945` | `e3ac511f3590935306b3411bec8bf6f3b2dec69257d600c925f015798d4737d4` |
| `stress-P5_layout-holdout1.jsonl` | `36106c579172987645b9fa38b1345745431a1edea002df182876ef86b498d461` | `206893a0fabbff1539c81e022e5279dc5e85cc06cbd804958d6d274a520990ff` |
| `stress-P6_all-holdout1.jsonl` | `48380303264b48cd0d7acadb5bbc8b9ecfa0bdf152df64ae777cdd851e50982e` | `8568a597163e8b5634dfeb6abf82b206511ef6ac6dffd67906c8754e42d2489b` |
| `stress-P1_order-holdout2.jsonl` | `0d3ad94abb4d045bc6df1c5291896b4c5bc3dcf7ed8c8fca14eb121aaee35f1d` | `fee7e31b01602da8e28c44b3121f1e1b05a3d0abaf5843ad57ad62accf76d32c` |
| `stress-P2_wording-holdout2.jsonl` | `7434cdf84301ff0f94b64034668b6526d953d22eb008c8eefdfa3193c5b1dda2` | `8512e29e50bb86debad9eba86dcd4b1804bee681e18e51e319c0de2b6f5a4b45` |
| `stress-P3_numbers-holdout2.jsonl` | `2af2a668932c0880d21ff249ae649402d9295ada050c89533b17464edce3b0a9` | `0fb3d6d2ef2f93cea3ad2b7a43f27cce26828fbccfff7b1bf439dcb3744e13a6` |
| `stress-P4_ocr-holdout2.jsonl` | `d02910126b70b6fe8a6b3a2a80be5b2d5c7886ef7079091fff9d412481176783` | `d32e466332cb16d953ca4ed0553445fab1558f65802180f484abea60ae39a2cc` |
| `stress-P5_layout-holdout2.jsonl` | `b2a84ffefdf154138a2c1884b0127f9977efd40135fe166bbf44a268507dfea3` | `3493acee4b8da401816c6780e415a4940a4bd522b751c4070f2746a0ac25faa1` |
| `stress-P6_all-holdout2.jsonl` | `b71d127c32d27b2e2efad250c4da7b28ac0017ee45f62ad9879bdb4a117085ae` | `7e8cae84401b197ef213cf5c1c06ac1b0cea0baeef1b409f8a8bea6447bf19c7` |
| `stress-P1_order-holdout3.jsonl` | `c744962121228df87550d752d1b97c85acc74f87670d353270f6e852ad14378d` | `46d8fc71a59d1f0850b441dd512ce50567900890f3a1f0b484f548a6306cd0c0` |
| `stress-P2_wording-holdout3.jsonl` | `ff49833b308edd6ad3472672f4db0ac1c8b21fa9e5017c592d5395aed53b5959` | `ce1f952f4bda89c4ffb09dddfb68f038374bdae7be933ae8f40f92a14c815198` |
| `stress-P3_numbers-holdout3.jsonl` | `6410e794e06a36c5baf5556a6601a4d54685935b8829bbd18517459a250ab6bd` | `7906454c2b01fa9edacbe1ef6d9652f6d602c469c00b399d99a2e28f58a13c84` |
| `stress-P4_ocr-holdout3.jsonl` | `fdd7880f7c54f4a43c16c649af8a3553c72fb57141f57f4724e6b4385e5d10a7` | `ce89ac828bcd0f7c5a6ec4f122114db006533abe28ee0d1c419c7c8459c8d370` |
| `stress-P5_layout-holdout3.jsonl` | `0aef06282a459d3302b931478d2d34a96efb3ccc8212569afea369ef40def5f4` | `4418839042e1dcca6c7d6d7e85aa5c904156e574503b36cde2218f36240e299a` |
| `stress-P6_all-holdout3.jsonl` | `aba4c80448d4916cd8a9bb25f7f5aa66096d03d142c8fa4a1f57b6127f876742` | `039bbaa170dc29970a32d639f85977f6b36c9ee6b90494b2d189cb8a5faf5bbe` |
| `stress-P1_order-holdout4.jsonl` | `d1c34db565da3cc9c0ea04f0f2e09db9680e36bc59866ac89f1107abe390489a` | `f9c3c5765489bbb750f8cd75424ec116ed0ba458b38cac22855d9f598872a932` |
| `stress-P2_wording-holdout4.jsonl` | `cfb8c9526f65be07e4ba028c06dc80c2ca285f9bc585b567bfbbb72d798f6e27` | `b152b347ff0978e862bcaad17ce01b712a693bf960b373ffd64f02ff71fcd407` |
| `stress-P3_numbers-holdout4.jsonl` | `15c35222a2be9264a00f3c3371d0f10ca1331b7b6051c6fc0715a6db7a50a6fb` | `eadec288721cd793348400408e7e60664f4f59fd4a533d83c42d648b6d7df96a` |
| `stress-P4_ocr-holdout4.jsonl` | `da61e420583edebe69eac5021c56624956e8824e3235318cf539696e4b511f13` | `182a94de27187522ecdedf5ca51e45fb33e808951b6a390aadaf038beed911c6` |
| `stress-P5_layout-holdout4.jsonl` | `c591817377a106dc941ceea3bf075fdf984aa67e6e5b087bfcf42c089437d9ef` | `fa34e7e2a593e27fdd19379eb1d5621517a5a40e0251fea2d567de321fa013a9` |
| `stress-P6_all-holdout4.jsonl` | `c1a397c60a163845afb4df7ddfd8666ce47c0d580898e04253f45abcbfa163dd` | `4d970c98773dfb01eb37631d72deba49edc9daa3d73e01ed43595aed635c50a5` |
| `stress-P1_order-holdout5.jsonl` | `c7395fb8b780b968c710788a326671f717d9ee415119314c311da76bc2574035` | `9118f1e0a498af55af925afbb111bfbef160ad1ec4499f176f1c88039cb1fe86` |
| `stress-P2_wording-holdout5.jsonl` | `b10d0332d89311fd6d37d3be52ff65cce2fac35e2ad339849df4463976990cbe` | `2de18662f80754d12db27895e9a3e0cdd623ce95b859874f76ba5707e84c68ad` |
| `stress-P3_numbers-holdout5.jsonl` | `e7dceb4fc9a565e2340c0b4bdc108cf75b364cc963cd0a2cf1733faf4dc8cc3d` | `5a5881ba0aed4f5465110bb7f96554a482c50c79cdd589dce5cade2a5123f3cf` |
| `stress-P4_ocr-holdout5.jsonl` | `cf688e70f703a19a656a2598bd0968bedac26a33a0d5898e172a90d7bf85b44c` | `65f94f904d25712e6851337f65113be19c7b42ba05e0dec134a445506867fb4c` |
| `stress-P5_layout-holdout5.jsonl` | `f82c22d73b57463f61f7253ddd7945e2c1eb59eb86fab56ec40893945ecbc33f` | `b4bdad0de9b5e28f92c444055a1e37d600a0ed91f8617bf6a986ce459b21a52d` |
| `stress-P6_all-holdout5.jsonl` | `de3e518d5b12b1ca6d7469209910fd0fe7a38ad8eea4217ecfb31f2477703d56` | `45612f28c4faff21888f6cb55a2ba50f21de22aa2555092d4c232a6b7a120eee` |

**Re-bank, 2026-10-05 18:55Z (same protocol, digest only).** The AP pack's last change, one word in `report.ts`, moved its
digest from `32d95b5277df1427d4aeed52e56f36cfb096767a0894847120fb2975e2e40d75` to
`25f43c7d93a09486fb3346176158477fd95096ce1e2cbf0138fc362583adc1f7`. The 30 holdout files were re-banked under it. Against the
previous bank only `checker_sha256` moved, on all 3,000 rows; a fresh run is identical, 30 of 30.

**Re-bank, 2026-10-05 19:25Z (same protocol, digest only).** The AP pack's duplicate check gained a look-alike vendor rule (a
word cut short, such as "Gl." for "Glass"), which reads vendor names only on booked rows, so it never runs with the harness's
empty history. Its digest moved from `25f43c7d93a09486fb3346176158477fd95096ce1e2cbf0138fc362583adc1f7` to
`29644c7f64fe6cf9c7495508996ce1d0c044d34d0102a7413cd83848d0ca00d6`. The 30 holdout files were re-banked under it. Against the
previous bank only `checker_sha256` moved, on all 3,000 rows; a fresh run is identical, 30 of 30. The table above gives each
file's sha256 after this last re-bank.

## Third amendment, 2026-10-06 00:18Z (20:18 EDT on 2026-10-05): re-banked after a cold review found the files no longer reproduced

**Why.** In cold review round 4, a methods reviewer ran `npx tsx bench/ap/stress.ts --seed holdout1` on the released tree and
got all six files "DIFFERS from the shipped file", exit 1. The rows carried `checker_sha256`
`29644c7f64fe6cf9c7495508996ce1d0c044d34d0102a7413cd83848d0ca00d6`, but that tree's AP pack hashed to
`7703e993781391a1…`. The pack had changed after the last re-bank above, nobody re-banked, and nothing checked. So the line
above, "a fresh run is identical, 30 of 30", was no longer true of the tree that shipped. This amendment re-banks the files
under the pack this tree builds. From now on `bench check` reads every banked row and compares its `checker_sha256`, engine
version and ruleset with what the tree builds, using the same digest function as the harness, and fails when they differ
(`docs/bench/_stress.json` names the files). So this claim can no longer go stale without a failing check.

**Nine, eleven, then thirteen source files.** The digest is the sha256 over every `*.ts` file in the AP pack's folder, so a
new file moves it as an edit does. The last re-bank above (`29644c7f…`, the tree handed to round 3's reviewers) covered nine
files: `ap-input-schema.ts`, `decide.ts`, `duplicate.ts`, `from-text.ts`, `index.ts`, `line-math.ts`, `parse.ts`,
`report.ts` and `structured.ts`. The next release added `po-balance.ts` (amounts billed to date against the order) and
`words.ts` (the plain-figure wording), making eleven (`7703e993…`, the tree the reviewer ran). This round adds `tax.ts` (tax
billed against the order's tax terms) and `vendor.ts` (the bill's vendor against the order's vendor), making thirteen.

**Re-run under:** engine 0.6.0, ruleset ap-threeway@0.2.0, `checker_sha256`
`fd0e639d2d67d25f29f1317b163a22f1971c52815a06cffd3bbe10af77e2180c` (13 source files). The protocol is the second
amendment's (an empty payment history); the generator, the perturbations, the seeds and the gold labels are unchanged.

**No decision moved.** Before banking, each seed was run into a new folder and compared row by row with the banked files. A
decision here is a row's case id, case kind, gold decision, decision made, wrong flag and perturbed invoice text.

| seed | rows | decisions moved | rows whose reasons changed | rows whose checker_sha256 moved |
|---|---|---|---|---|
| holdout1 | 600 | 0 | 195 | 600 |
| holdout2 | 600 | 0 | 194 | 600 |
| holdout3 | 600 | 0 | 184 | 600 |
| holdout4 | 600 | 0 | 189 | 600 |
| holdout5 | 600 | 0 | 194 | 600 |
| all five | 3,000 | 0 | 956 | 3,000 |

No other field moved. Every count is unchanged: **0 wrong of 2,755 decided** (of 3,000 perturbed invoices).

**Which reasons changed, and why.** Both changes are wording that shipped in the round-4 tree; this round's vendor and tax
checks change no row's reasons on these invoices.
- **All 417 rows held on the total** now give the figures in words: "The lines add to 8,990.00; the bill says 9,017.00; over
  by 27.00." where they read "Stated total 9017; lines 8990 = 8990. Does not add up."
- **All 539 rows held on price** now name the tolerance: "(max … at the 2% price tolerance)" where they read "(max …)".
- The 841 approved rows, and the rows held for quantity or a missing PO and the 245 sent to a person, read as before.

In `stress-P1_order-holdout1.jsonl`, the file the reviewer compared, 35 of 100 rows changed: 16 held on the total and 19 held
on price.

**The vendor check and these seeds (a disclosure).** During this round, a trial run against the AP pack as it then stood
moved 13 of the 3,000 decisions from approve to a person, 0 of them wrong: OCR-style noise had turned the header "From:" into
"Frmo:", so the new vendor check found no sender. The pack's text path was changed before this re-bank. It finds the order's
vendor by its name on a line, or by a sender's address built from that name, and it now allows one swapped pair of
neighbouring letters in the word "From" and in the address (never two, never a dropped or changed letter), which is the
noise this generator makes. So "no decision moved" was reached after a change made with these seeds' results in view, and
it is not independent of them.

**A fresh run after the re-bank is identical, 30 of 30.** From the repository root, for each seed:

```
npx tsx bench/ap/stress.ts --seed holdout1        (and holdout2 … holdout5)
engine 0.6.0 · ruleset ap-threeway@0.2.0 · checker_sha256 fd0e639d2d67d25f29f1317b163a22f1971c52815a06cffd3bbe10af77e2180c (sha256 over 13 AP pack source files)
TOTAL wrong decisions across all perturbations: 0
compare: stress-P1_order-holdout1.jsonl: IDENTICAL to the shipped file
compare: stress-P2_wording-holdout1.jsonl: IDENTICAL to the shipped file
compare: stress-P3_numbers-holdout1.jsonl: IDENTICAL to the shipped file
compare: stress-P4_ocr-holdout1.jsonl: IDENTICAL to the shipped file
compare: stress-P5_layout-holdout1.jsonl: IDENTICAL to the shipped file
compare: stress-P6_all-holdout1.jsonl: IDENTICAL to the shipped file
```

Each of the five runs exits 0, and all 30 files compare IDENTICAL. `node packages/verify/dist/cli.js bench check
packages/verify/docs/bench` prints "MATCH stress: 30 of 30 banked file(s), 3,000 row(s), carry checker_sha256 fd0e639d…, the
digest this tree's AP pack builds (13 source files in packages/verify/src/ap), under engine 0.6.0 and ap-threeway@0.2.0".

| file | sha256 after the second amendment's last re-bank | sha256 after this one |
|---|---|---|
| `stress-P1_order-holdout1.jsonl` | `a975f16efb3ed1c70038411d9ef8847d887ac60b5cdb5b193551ea9b0c8eaa80` | `8a6089f2e50002dc47166f0f60a2770692f42dc2dfd9520698770008490dafa2` |
| `stress-P2_wording-holdout1.jsonl` | `3a955e9eb04f2961c16248b0068c6f9d4d2684fa1c423b431e7a3633dd90be8d` | `a79e75e85a51c05739a34e2377456425aae9d1956a02ad701b5455b38570e2a6` |
| `stress-P3_numbers-holdout1.jsonl` | `946d940b3043ba1935ac19b0e682afed1a8c0259ba86c216227d043d4bd74d00` | `e63abb53cd78d0dfda2abf95db95829efc5303739e9c482f348f92b1866103c4` |
| `stress-P4_ocr-holdout1.jsonl` | `e3ac511f3590935306b3411bec8bf6f3b2dec69257d600c925f015798d4737d4` | `613a3e44714897fc04f01c104795a65ca5cece66e75ed8b8981d42133704ab5b` |
| `stress-P5_layout-holdout1.jsonl` | `206893a0fabbff1539c81e022e5279dc5e85cc06cbd804958d6d274a520990ff` | `14620f656e3139895f5700e0b2373dc735a74f1f3312d00768021833f7ffebd9` |
| `stress-P6_all-holdout1.jsonl` | `8568a597163e8b5634dfeb6abf82b206511ef6ac6dffd67906c8754e42d2489b` | `dbd1c2b1cc0cc0ff01157586f956b8253db44cdff01b1ebb60d2ff314b0af9a2` |
| `stress-P1_order-holdout2.jsonl` | `fee7e31b01602da8e28c44b3121f1e1b05a3d0abaf5843ad57ad62accf76d32c` | `17cb02005ede673093da56cc7c037521ca92fa644ec7503a1340afd32f5509b9` |
| `stress-P2_wording-holdout2.jsonl` | `8512e29e50bb86debad9eba86dcd4b1804bee681e18e51e319c0de2b6f5a4b45` | `2fff86b38f02b6cc35167c5a28c8b6bdadc4416e0b722f5ed5fb687d420a8162` |
| `stress-P3_numbers-holdout2.jsonl` | `0fb3d6d2ef2f93cea3ad2b7a43f27cce26828fbccfff7b1bf439dcb3744e13a6` | `05ed24de9b61fc7ae5cc9c5d77894608ba3e946d1a63086399963c84ec8818b6` |
| `stress-P4_ocr-holdout2.jsonl` | `d32e466332cb16d953ca4ed0553445fab1558f65802180f484abea60ae39a2cc` | `be54fed45fbfa77426246f3ffed12afb7d39ba4cd2f50df98948936b5463f534` |
| `stress-P5_layout-holdout2.jsonl` | `3493acee4b8da401816c6780e415a4940a4bd522b751c4070f2746a0ac25faa1` | `84986c5bb8a765070b63938378027f6127c4ff13319662639f4c887e767903f9` |
| `stress-P6_all-holdout2.jsonl` | `7e8cae84401b197ef213cf5c1c06ac1b0cea0baeef1b409f8a8bea6447bf19c7` | `453e84fb1757de925abeddf29d4dc4cff5aa3a27ae63815f64ac56cfe17370e8` |
| `stress-P1_order-holdout3.jsonl` | `46d8fc71a59d1f0850b441dd512ce50567900890f3a1f0b484f548a6306cd0c0` | `b6cd128dfdba28169bf6257fc9605f5576668f64a73e4229431572e63cd7d76b` |
| `stress-P2_wording-holdout3.jsonl` | `ce1f952f4bda89c4ffb09dddfb68f038374bdae7be933ae8f40f92a14c815198` | `c5c0a3d3138ae8913aa9b10bbc204c5e18908cb18b17e609841060fdcf296476` |
| `stress-P3_numbers-holdout3.jsonl` | `7906454c2b01fa9edacbe1ef6d9652f6d602c469c00b399d99a2e28f58a13c84` | `50be88b349de3aa51377ef82f7bedd4b2105bd359e4346b9b501fb5df23d118e` |
| `stress-P4_ocr-holdout3.jsonl` | `ce89ac828bcd0f7c5a6ec4f122114db006533abe28ee0d1c419c7c8459c8d370` | `3d7259f069f134c8e7b5fc8ddfc6f60069478fed4344d1be5bfdc3740781a412` |
| `stress-P5_layout-holdout3.jsonl` | `4418839042e1dcca6c7d6d7e85aa5c904156e574503b36cde2218f36240e299a` | `eb60ea2abbfec3d6d061cce58d0c1a5c40375a4be5c5f6102450e7beaf4a7ed0` |
| `stress-P6_all-holdout3.jsonl` | `039bbaa170dc29970a32d639f85977f6b36c9ee6b90494b2d189cb8a5faf5bbe` | `61ad75efa9d439190c7c8aa9156a0f84a947da59c3688b392949f64ec19f2e25` |
| `stress-P1_order-holdout4.jsonl` | `f9c3c5765489bbb750f8cd75424ec116ed0ba458b38cac22855d9f598872a932` | `2a1379736f32685bf6e8a0a8e8a42a83df838307bf42405a4ed1d3516104e2ee` |
| `stress-P2_wording-holdout4.jsonl` | `b152b347ff0978e862bcaad17ce01b712a693bf960b373ffd64f02ff71fcd407` | `1e83ae1f84ecfa0c4479207d4a642ca90853e5e1bb395719b373c0be2707f972` |
| `stress-P3_numbers-holdout4.jsonl` | `eadec288721cd793348400408e7e60664f4f59fd4a533d83c42d648b6d7df96a` | `fc33ea86296f22ca67045a09e0a73027cff4ef450f763ff1ea8f64c67413b827` |
| `stress-P4_ocr-holdout4.jsonl` | `182a94de27187522ecdedf5ca51e45fb33e808951b6a390aadaf038beed911c6` | `58972caa66d83a6d001487bdb0aaf32d32b6ed295e20309c7afec748aec9ce1e` |
| `stress-P5_layout-holdout4.jsonl` | `fa34e7e2a593e27fdd19379eb1d5621517a5a40e0251fea2d567de321fa013a9` | `387eb12a24ce25f58bc9cd343eaff935838db00a8c931f974b88fd3ffabcadb9` |
| `stress-P6_all-holdout4.jsonl` | `4d970c98773dfb01eb37631d72deba49edc9daa3d73e01ed43595aed635c50a5` | `0269e193cbd8a92eaaf00684fd2b1959bcfe4fcb579823fcf9e38a30831634ee` |
| `stress-P1_order-holdout5.jsonl` | `9118f1e0a498af55af925afbb111bfbef160ad1ec4499f176f1c88039cb1fe86` | `9a00d718378132d2be379996b57563b9fb2b0827fe549b5748995696a92b8933` |
| `stress-P2_wording-holdout5.jsonl` | `2de18662f80754d12db27895e9a3e0cdd623ce95b859874f76ba5707e84c68ad` | `c754c9be5db2179656492124f883917c933c0acfbeab2e0df69013a297e08e62` |
| `stress-P3_numbers-holdout5.jsonl` | `5a5881ba0aed4f5465110bb7f96554a482c50c79cdd589dce5cade2a5123f3cf` | `f7ca6536915ef53ee5365297730c38b4689213f903041767f2a0a5846058c846` |
| `stress-P4_ocr-holdout5.jsonl` | `65f94f904d25712e6851337f65113be19c7b42ba05e0dec134a445506867fb4c` | `bdf324828a1155d81819ab7578611fecea9703d46b5e541a0d12d9476f0eab6b` |
| `stress-P5_layout-holdout5.jsonl` | `b4bdad0de9b5e28f92c444055a1e37d600a0ed91f8617bf6a986ce459b21a52d` | `02b8a35555fcd8270c0e7745ef2a166c19b7be4ad9a2b29c6d6ce795d8152d64` |
| `stress-P6_all-holdout5.jsonl` | `45612f28c4faff21888f6cb55a2ba50f21de22aa2555092d4c232a6b7a120eee` | `d914a41b78f77ab2f463ccbeaf4019de84e33ebfeaa4b071c89ee2c638912955` |

## Fourth amendment, 2026-10-06 06:07Z (02:07 EDT): re-banked, digest only, under a pack of fifteen files

**Why.** The AP pack changed again after the third amendment, so `bench check` read the banked rows as not naming this
tree: they carried `checker_sha256` `fd0e639d2d67d25f29f1317b163a22f1971c52815a06cffd3bbe10af77e2180c` (13 source files),
and the pack hashed to `b041e2b5dd2268e515de2fe0f4d8afba8274d99a82b3f12c36796ad291cc6ba4`. Two files were added:
`remittance.ts` (a request to change payment details, or bank-account details printed on a bill, goes to the controller) and
`qty-to-date.ts` (a PO line's quantity already invoiced, when the input carries it, is netted against the quantity received).
Other files changed too: the vendor check reads the sender's domain first, an IBAN or account number is never read as a
stated total, and leading zeros in an invoice number are normalised. The fifteen files are `ap-input-schema.ts`,
`decide.ts`, `duplicate.ts`, `from-text.ts`, `index.ts`, `line-math.ts`, `parse.ts`, `po-balance.ts`, `qty-to-date.ts`,
`remittance.ts`, `report.ts`, `structured.ts`, `tax.ts`, `vendor.ts` and `words.ts`.

**Re-run under:** engine 0.6.0, ruleset ap-threeway@0.2.0, `checker_sha256`
`b041e2b5dd2268e515de2fe0f4d8afba8274d99a82b3f12c36796ad291cc6ba4` (15 source files). The protocol is the second
amendment's (an empty payment history); the generator, the perturbations, the seeds and the gold labels are unchanged.

**Nothing but the digest moved.** Before banking, each seed was run into a new folder and compared row by row with the
banked files, as in the third amendment. After banking, the new files were compared with a copy of the old ones, with the
same result.

| seed | rows | decisions moved | rows whose reasons changed | rows whose checker_sha256 moved | other fields moved |
|---|---|---|---|---|---|
| holdout1 | 600 | 0 | 0 | 600 | 0 |
| holdout2 | 600 | 0 | 0 | 600 | 0 |
| holdout3 | 600 | 0 | 0 | 600 | 0 |
| holdout4 | 600 | 0 | 0 | 600 | 0 |
| holdout5 | 600 | 0 | 0 | 600 | 0 |
| all five | 3,000 | 0 | 0 | 3,000 | 0 |

Every count is unchanged: **0 wrong of 2,755 decided** (of 3,000 perturbed invoices). The new checks do not fire on these
invoices: none carries payment text, every sender is built from the vendor's name, and the input carries no quantity
invoiced to date.

**What this does not show (a disclosure).** These seeds stopped being a holdout at the third amendment, and this re-bank
does not restore that. Before it, the maintainers ran all five seeds on the final pack (at 05:54Z) and compared them with
the banked rows; by their record no change to the pack followed that run. One threshold in the new vendor check (a name
built inside a sender's domain counts only from six letters) was set after five of the benchmark's 100 base invoices, the
invoices these seeds perturb, were flagged by an earlier version of the check. So "nothing moved" says the rows reproduce
under this pack. It is not independent evidence that the pack generalises.

**A fresh run after the re-bank is identical, 30 of 30.** From the repository root, for each seed:

```
npx tsx bench/ap/stress.ts --seed holdout1        (and holdout2 … holdout5)
engine 0.6.0 · ruleset ap-threeway@0.2.0 · checker_sha256 b041e2b5dd2268e515de2fe0f4d8afba8274d99a82b3f12c36796ad291cc6ba4 (sha256 over 15 AP pack source files)
TOTAL wrong decisions across all perturbations: 0
compare: stress-P1_order-holdout1.jsonl: IDENTICAL to the shipped file
compare: stress-P2_wording-holdout1.jsonl: IDENTICAL to the shipped file
compare: stress-P3_numbers-holdout1.jsonl: IDENTICAL to the shipped file
compare: stress-P4_ocr-holdout1.jsonl: IDENTICAL to the shipped file
compare: stress-P5_layout-holdout1.jsonl: IDENTICAL to the shipped file
compare: stress-P6_all-holdout1.jsonl: IDENTICAL to the shipped file
```

Each of the five runs exits 0, and all 30 files compare IDENTICAL. This is the sixth time the files have been written
since they were first banked on 2026-09-23: the first amendment, the second amendment and its two digest-only re-banks,
the third amendment, and this one.

| file | sha256 after the third amendment | sha256 after this one |
|---|---|---|
| `stress-P1_order-holdout1.jsonl` | `8a6089f2e50002dc47166f0f60a2770692f42dc2dfd9520698770008490dafa2` | `983e9d2d33f801ea44dd419c398c83f67d1764562fbe8cfc487891c9908aabe9` |
| `stress-P2_wording-holdout1.jsonl` | `a79e75e85a51c05739a34e2377456425aae9d1956a02ad701b5455b38570e2a6` | `91ff0bbc6cbe63b1cc1c7cb676bb4dc4ccbeab5862d046f31a357039051091b8` |
| `stress-P3_numbers-holdout1.jsonl` | `e63abb53cd78d0dfda2abf95db95829efc5303739e9c482f348f92b1866103c4` | `121ace87ef68fb31b0d3e73a984eb57a6e638374606d431e6529763b06ff8f19` |
| `stress-P4_ocr-holdout1.jsonl` | `613a3e44714897fc04f01c104795a65ca5cece66e75ed8b8981d42133704ab5b` | `807df11edbf90d942ddeaa949173752475de5db608e836c59eb919dbfd1320c6` |
| `stress-P5_layout-holdout1.jsonl` | `14620f656e3139895f5700e0b2373dc735a74f1f3312d00768021833f7ffebd9` | `e1376f766b92026757adcc502dbba405e5b1a867927c0050c4d4b859823969be` |
| `stress-P6_all-holdout1.jsonl` | `dbd1c2b1cc0cc0ff01157586f956b8253db44cdff01b1ebb60d2ff314b0af9a2` | `78833a91f2b2d369e949a325f81794a9c266c095717baf4424ee4f332a5a99d5` |
| `stress-P1_order-holdout2.jsonl` | `17cb02005ede673093da56cc7c037521ca92fa644ec7503a1340afd32f5509b9` | `a5a437e0d67b0605eb98598ba0003cf390ee27b1f29e1209cc07161b974e5b25` |
| `stress-P2_wording-holdout2.jsonl` | `2fff86b38f02b6cc35167c5a28c8b6bdadc4416e0b722f5ed5fb687d420a8162` | `1d2d705e5b3dcc3e69142b8245919aaeafd31874bb04e49bf98b2f888d349ce2` |
| `stress-P3_numbers-holdout2.jsonl` | `05ed24de9b61fc7ae5cc9c5d77894608ba3e946d1a63086399963c84ec8818b6` | `b5220cc97e6f17106630cf4702664db27780d1ecc9f6adf2b6dbb83208ea0aca` |
| `stress-P4_ocr-holdout2.jsonl` | `be54fed45fbfa77426246f3ffed12afb7d39ba4cd2f50df98948936b5463f534` | `3a46b38a8f1ebde19ef20baf2d92d4b17ad7e9ef394cc978d162e2169fbf010d` |
| `stress-P5_layout-holdout2.jsonl` | `84986c5bb8a765070b63938378027f6127c4ff13319662639f4c887e767903f9` | `a6c49938001d3ab718e065e2dc4eab151256aff687e584a2db67221521174933` |
| `stress-P6_all-holdout2.jsonl` | `453e84fb1757de925abeddf29d4dc4cff5aa3a27ae63815f64ac56cfe17370e8` | `409a5555d7149f8ae75a4b7e8e20a2aa12b636ca64ebf8ffa6fae7fbb8aa871e` |
| `stress-P1_order-holdout3.jsonl` | `b6cd128dfdba28169bf6257fc9605f5576668f64a73e4229431572e63cd7d76b` | `e6618028b3d2c31b2bfb5f9eee0f8902619df09f665e769165d25707577d88ff` |
| `stress-P2_wording-holdout3.jsonl` | `c5c0a3d3138ae8913aa9b10bbc204c5e18908cb18b17e609841060fdcf296476` | `e2de5dfb973000c8f7d3645ffdca5d69973ef4fbd05be876d475fa9116b83213` |
| `stress-P3_numbers-holdout3.jsonl` | `50be88b349de3aa51377ef82f7bedd4b2105bd359e4346b9b501fb5df23d118e` | `d0e26b42617293133f02885dd970bc63b7963f9203c2aeafc4d93999ce6023c1` |
| `stress-P4_ocr-holdout3.jsonl` | `3d7259f069f134c8e7b5fc8ddfc6f60069478fed4344d1be5bfdc3740781a412` | `0c8030654dde65bbde12dc9a91c5516b2c0916ad9743066d1c10e59073334870` |
| `stress-P5_layout-holdout3.jsonl` | `eb60ea2abbfec3d6d061cce58d0c1a5c40375a4be5c5f6102450e7beaf4a7ed0` | `9d92b5ded4b9b3c8679336042053fd571e9c7e4824b94a424db26fae8443eec4` |
| `stress-P6_all-holdout3.jsonl` | `61ad75efa9d439190c7c8aa9156a0f84a947da59c3688b392949f64ec19f2e25` | `d954bf9367712966a72227ceafe35b427ed49151ee505ab14aed26a30c5b31e5` |
| `stress-P1_order-holdout4.jsonl` | `2a1379736f32685bf6e8a0a8e8a42a83df838307bf42405a4ed1d3516104e2ee` | `934c7293d1d1e4aafe81928c08c39acda19a1c326ec3f33651642dfedaf03037` |
| `stress-P2_wording-holdout4.jsonl` | `1e83ae1f84ecfa0c4479207d4a642ca90853e5e1bb395719b373c0be2707f972` | `dccf742195bfe0ec969097163cfc789d7229d4f59a3716afbd3306baf8fcde00` |
| `stress-P3_numbers-holdout4.jsonl` | `fc33ea86296f22ca67045a09e0a73027cff4ef450f763ff1ea8f64c67413b827` | `ef2e2db77b605860acdefc5e93ca5113126e8ea19c9e65dfd96302e6adcc80f1` |
| `stress-P4_ocr-holdout4.jsonl` | `58972caa66d83a6d001487bdb0aaf32d32b6ed295e20309c7afec748aec9ce1e` | `55559a3f1afcfe3e56d55c01a878d5fe3b5944bb9381e671781d42c36d370c0c` |
| `stress-P5_layout-holdout4.jsonl` | `387eb12a24ce25f58bc9cd343eaff935838db00a8c931f974b88fd3ffabcadb9` | `f023f0e314820045e3ab91f7e28c0a052f4865ae0f40d18b37f50aa3e7d2aa53` |
| `stress-P6_all-holdout4.jsonl` | `0269e193cbd8a92eaaf00684fd2b1959bcfe4fcb579823fcf9e38a30831634ee` | `c654082782b7971f05c52d5492859785a12d789a0c697e7c704780273a93fa39` |
| `stress-P1_order-holdout5.jsonl` | `9a00d718378132d2be379996b57563b9fb2b0827fe549b5748995696a92b8933` | `cfab9f08e4ecf5e1e2532272f1be1cd4273bef84eb2cce5c9873e6744e20fdf5` |
| `stress-P2_wording-holdout5.jsonl` | `c754c9be5db2179656492124f883917c933c0acfbeab2e0df69013a297e08e62` | `0368b72a72d1ea424301794649ec24ec8f52b419b81bdb7c7941b98d7ea995dd` |
| `stress-P3_numbers-holdout5.jsonl` | `f7ca6536915ef53ee5365297730c38b4689213f903041767f2a0a5846058c846` | `49b15f49bd7620d125bff48efd157096fa2ae904370cdb5858a519b57de98508` |
| `stress-P4_ocr-holdout5.jsonl` | `bdf324828a1155d81819ab7578611fecea9703d46b5e541a0d12d9476f0eab6b` | `bd769eb5151da76bae8b56ed05a642e55c1afcf1eb2194742eb11809aac037e5` |
| `stress-P5_layout-holdout5.jsonl` | `02b8a35555fcd8270c0e7745ef2a166c19b7be4ad9a2b29c6d6ce795d8152d64` | `d56511b36a45802dc4df9328c2766302192bcb539774a593ba73dcbf33ad1935` |
| `stress-P6_all-holdout5.jsonl` | `d914a41b78f77ab2f463ccbeaf4019de84e33ebfeaa4b071c89ee2c638912955` | `d1c71f22faa9467430404220ca2dca431d31c96531d52eea3195234d3c0f5e3d` |

## Fifth amendment, 2026-10-06 08:35Z (04:35 EDT): re-banked, digest only (comment hygiene, no behaviour)

**Why.** Comments in the AP pack's files were rewritten to drop internal work labels. No code, string or test changed in
`packages/verify/src/ap/`, but the digest is the sha256 over the files' bytes, so it moved from
`b041e2b5dd2268e515de2fe0f4d8afba8274d99a82b3f12c36796ad291cc6ba4` to
`716018c7d51a17db0ffd4e42e877f6cea8c4a0548c824bf18e8f9105c37819a2` over the same fifteen files.

**Nothing but the digest moved.** The protocol is the fourth amendment's. Before banking, each seed was run into a new
folder and compared row by row with the banked files; after banking, the new files were compared with a copy of the old
ones. On all 3,000 rows: 0 decisions moved, 0 reasons changed, 0 other fields moved, and `checker_sha256` moved on every
row. Every count is unchanged: **0 wrong of 2,755 decided** (of 3,000 perturbed invoices). A fresh run after the re-bank
is identical, 30 of 30, and each of the five runs exits 0. This is the seventh time the files have been written since
they were first banked on 2026-09-23.

| file | sha256 after the fourth amendment | sha256 after this one |
|---|---|---|
| `stress-P1_order-holdout1.jsonl` | `983e9d2d33f801ea44dd419c398c83f67d1764562fbe8cfc487891c9908aabe9` | `b1bad3bb06b0d1d47fe3ee6c24e0015e325a51f38a464df785a99be1a612eaac` |
| `stress-P2_wording-holdout1.jsonl` | `91ff0bbc6cbe63b1cc1c7cb676bb4dc4ccbeab5862d046f31a357039051091b8` | `8503fe4bc5e42782c6b9a8da97b83c28c79b836830e9464a834c7b699f0094b8` |
| `stress-P3_numbers-holdout1.jsonl` | `121ace87ef68fb31b0d3e73a984eb57a6e638374606d431e6529763b06ff8f19` | `9dec53b18194db7bb4fc4ef0913878b439464f8d204db460af143e8ff9deaf2f` |
| `stress-P4_ocr-holdout1.jsonl` | `807df11edbf90d942ddeaa949173752475de5db608e836c59eb919dbfd1320c6` | `6c93226802f3617b3c74cdd605cf91b2c0cca74559547438458e35161346dcce` |
| `stress-P5_layout-holdout1.jsonl` | `e1376f766b92026757adcc502dbba405e5b1a867927c0050c4d4b859823969be` | `512de4bf7ef7ddf49d83156bdfb23ff2a3ff19c8303c44e0f126187e1a233267` |
| `stress-P6_all-holdout1.jsonl` | `78833a91f2b2d369e949a325f81794a9c266c095717baf4424ee4f332a5a99d5` | `db8f2ae03ab3f22fd3ef0b1c94f48539680d16a18771baa25d76dfdd4bbc81ab` |
| `stress-P1_order-holdout2.jsonl` | `a5a437e0d67b0605eb98598ba0003cf390ee27b1f29e1209cc07161b974e5b25` | `1c04f43b2e0d13149d054d72f32db42cb7472ed217cee81912482c89b2a309bf` |
| `stress-P2_wording-holdout2.jsonl` | `1d2d705e5b3dcc3e69142b8245919aaeafd31874bb04e49bf98b2f888d349ce2` | `88f39cf5550e9a5d5fb9deb692b623aad910b83f4d0833fab5768c4642889d8f` |
| `stress-P3_numbers-holdout2.jsonl` | `b5220cc97e6f17106630cf4702664db27780d1ecc9f6adf2b6dbb83208ea0aca` | `f09bc6437ef84c867464d1c36a0f290106a24a0633c4ffff4e6e776c4eb2e1af` |
| `stress-P4_ocr-holdout2.jsonl` | `3a46b38a8f1ebde19ef20baf2d92d4b17ad7e9ef394cc978d162e2169fbf010d` | `c782e234fad51871f98646956c179f322f808db37c5f98946f25d9b41262c405` |
| `stress-P5_layout-holdout2.jsonl` | `a6c49938001d3ab718e065e2dc4eab151256aff687e584a2db67221521174933` | `61259164786ac2bab3b97031c83d3ab5fad3a5ff5f97d38a3b7c6aa89ff03e63` |
| `stress-P6_all-holdout2.jsonl` | `409a5555d7149f8ae75a4b7e8e20a2aa12b636ca64ebf8ffa6fae7fbb8aa871e` | `3ce5912f26d9b0ce618826efe52192af085641d8e21c18896ccb4435c9ab588f` |
| `stress-P1_order-holdout3.jsonl` | `e6618028b3d2c31b2bfb5f9eee0f8902619df09f665e769165d25707577d88ff` | `fa20742f808f8f77e8e37973b63804b786b1306939a35de0b085df1857ca1ca5` |
| `stress-P2_wording-holdout3.jsonl` | `e2de5dfb973000c8f7d3645ffdca5d69973ef4fbd05be876d475fa9116b83213` | `321206caad8e479bfde352eff74ebf77945a77e7318c94d007ae5a0fe4c25b26` |
| `stress-P3_numbers-holdout3.jsonl` | `d0e26b42617293133f02885dd970bc63b7963f9203c2aeafc4d93999ce6023c1` | `2f05dc8f37ff57b9e00df7f4f9f2b037f9139d010807189b558b0a0c3eb8783b` |
| `stress-P4_ocr-holdout3.jsonl` | `0c8030654dde65bbde12dc9a91c5516b2c0916ad9743066d1c10e59073334870` | `bfa387a744c505b80ec443eb8956913665dd9878e42f1e3c9ea7d5530044e546` |
| `stress-P5_layout-holdout3.jsonl` | `9d92b5ded4b9b3c8679336042053fd571e9c7e4824b94a424db26fae8443eec4` | `26265b2c5da7472a9e55d0712a0f5a80ee51bcdf5133051cc5a67c4dc9332c86` |
| `stress-P6_all-holdout3.jsonl` | `d954bf9367712966a72227ceafe35b427ed49151ee505ab14aed26a30c5b31e5` | `ca14b79a706ecabb8cd63b389a6798af7137e8cdd311b9793302fcea4d3fa292` |
| `stress-P1_order-holdout4.jsonl` | `934c7293d1d1e4aafe81928c08c39acda19a1c326ec3f33651642dfedaf03037` | `c91aff9cc8accda62a49cc00e3d6a1d252361c015dce59300a788638bb6dcbb1` |
| `stress-P2_wording-holdout4.jsonl` | `dccf742195bfe0ec969097163cfc789d7229d4f59a3716afbd3306baf8fcde00` | `f6129110b02428fdc2787633f59c22d8936fea59c3cc17d9f1e04ac3f31c825e` |
| `stress-P3_numbers-holdout4.jsonl` | `ef2e2db77b605860acdefc5e93ca5113126e8ea19c9e65dfd96302e6adcc80f1` | `40633d65ad18ee127eca1775e3767d28e45eaa7b26be1d669679143014fedbdf` |
| `stress-P4_ocr-holdout4.jsonl` | `55559a3f1afcfe3e56d55c01a878d5fe3b5944bb9381e671781d42c36d370c0c` | `36a7dd42ff488f08d86355ec14d12caeb5a59f054d8948a9dc89548189ad11c2` |
| `stress-P5_layout-holdout4.jsonl` | `f023f0e314820045e3ab91f7e28c0a052f4865ae0f40d18b37f50aa3e7d2aa53` | `36881d5961a77ed9fab598166f427b850cad72ce92df293ad745802d9639833b` |
| `stress-P6_all-holdout4.jsonl` | `c654082782b7971f05c52d5492859785a12d789a0c697e7c704780273a93fa39` | `876c3fa5042b32672c4c9615d8b3d3ceccf99f4b11629a35c6df21e1699bbc19` |
| `stress-P1_order-holdout5.jsonl` | `cfab9f08e4ecf5e1e2532272f1be1cd4273bef84eb2cce5c9873e6744e20fdf5` | `950986df251c2c4df8c5577b3d0b61ab7c63cf31d723544b93baf1920984fddf` |
| `stress-P2_wording-holdout5.jsonl` | `0368b72a72d1ea424301794649ec24ec8f52b419b81bdb7c7941b98d7ea995dd` | `36c297fdc0e7e7f4f6f184c73a60dad88a9617625c251354e5ca090e0bc4e123` |
| `stress-P3_numbers-holdout5.jsonl` | `49b15f49bd7620d125bff48efd157096fa2ae904370cdb5858a519b57de98508` | `c2ed28a911389221497b1c7646ebdce632769afc9afb12b78b5f0924ea6f6de5` |
| `stress-P4_ocr-holdout5.jsonl` | `bd769eb5151da76bae8b56ed05a642e55c1afcf1eb2194742eb11809aac037e5` | `890044321a45f8ffa17d3689fae12a82d5df37cd6ba23a2a629fbc0fcefbf6cf` |
| `stress-P5_layout-holdout5.jsonl` | `d56511b36a45802dc4df9328c2766302192bcb539774a593ba73dcbf33ad1935` | `2a1370fa27d1302db92e1ebfbcf58e3082a39738dcb3b0089e1600260ed53ee8` |
| `stress-P6_all-holdout5.jsonl` | `d1c71f22faa9467430404220ca2dca431d31c96531d52eea3195234d3c0f5e3d` | `7b8afdd392d6866e96184f1934548b38dcc9101250fe570fd69b26ecfa6e7acf` |

## Sixth amendment, 2026-10-06 11:45Z (07:45 EDT): re-banked, digest only, after the payment-redirection, sender-domain and tax checks

**Why.** The AP pack changed in behaviour. The emailed-bill path gained readings that send a bill to a person: a line that
redirects payment (a list of 25 phrasings: changed or new bank details, Zelle and the other payment apps, a payment link,
an email address or phone number as the payee), a free-mail sender for a vendor with its own domain, and a look-alike of
the vendor's domain. Its "Not checked" block now says what it scanned instead of asserting that nothing was there. Tax is
checked to the cent against the stated rate, rounding one minor unit per taxable line, never within the price tolerance.
A possible resubmission passes when the netted quantities show units received and not yet invoiced. The pack is still
fifteen files, and the digest moved from
`716018c7d51a17db0ffd4e42e877f6cea8c4a0548c824bf18e8f9105c37819a2` to
`2ee0594b2158655849b3a157b83509f6812b0e6e2416888d9b6d92e7224daef1`.

**Nothing but the digest moved.** The protocol is the fourth amendment's, run after the last change to the AP pack and to
the shared engine code it calls. Before banking, each seed was run into a new folder and compared row by row with the
banked files; after banking, the new files were compared with a copy of the old ones. On all 3,000 rows: 0 decisions
moved, 0 reasons changed, 0 other fields moved, and `checker_sha256` moved on every row. No changed check altered a row
of these perturbed invoices. Every count is unchanged: **0 wrong
of 2,755 decided** (of 3,000 perturbed invoices). A fresh run after the re-bank is identical, 30 of 30, and each of the five
runs exits 0. This is the eighth time the files have been written since they were first banked on 2026-09-23. It shows the
rows reproduce under the new pack, not that the new checks work: the seeds were not built to contain the cases they catch.

| file | sha256 after the fifth amendment | sha256 after this one |
|---|---|---|
| `stress-P1_order-holdout1.jsonl` | `b1bad3bb06b0d1d47fe3ee6c24e0015e325a51f38a464df785a99be1a612eaac` | `e1e75a47e3d188612cd1d7474fefd59b3c8e648136a5fbb1fc60af7f76316dc5` |
| `stress-P2_wording-holdout1.jsonl` | `8503fe4bc5e42782c6b9a8da97b83c28c79b836830e9464a834c7b699f0094b8` | `ed8859e6940ae5f6df3d9d989665880706a60dbb6f0b1310f72bb1e9a942af4e` |
| `stress-P3_numbers-holdout1.jsonl` | `9dec53b18194db7bb4fc4ef0913878b439464f8d204db460af143e8ff9deaf2f` | `ffbf7db2c12875cc317fe15cf3bafe03b44894366614a6dd188133dc83bb2754` |
| `stress-P4_ocr-holdout1.jsonl` | `6c93226802f3617b3c74cdd605cf91b2c0cca74559547438458e35161346dcce` | `e91a4230e07616f5576e6db28e54a87e723a1ad795ffd20fd3d64540d5293904` |
| `stress-P5_layout-holdout1.jsonl` | `512de4bf7ef7ddf49d83156bdfb23ff2a3ff19c8303c44e0f126187e1a233267` | `f7de28a864403b3738cf8648536886f2514f4d6ebf554607a2eedecf207a794b` |
| `stress-P6_all-holdout1.jsonl` | `db8f2ae03ab3f22fd3ef0b1c94f48539680d16a18771baa25d76dfdd4bbc81ab` | `0ede473c3f512b8f429f5f30fee69bcc7674f7c4070ea471e545022b8582fc41` |
| `stress-P1_order-holdout2.jsonl` | `1c04f43b2e0d13149d054d72f32db42cb7472ed217cee81912482c89b2a309bf` | `71c2c2c5bbfecc2d85dcc57fa9fa353d9355c8c2d86e7d8bd964021526e10a8a` |
| `stress-P2_wording-holdout2.jsonl` | `88f39cf5550e9a5d5fb9deb692b623aad910b83f4d0833fab5768c4642889d8f` | `c344a8b937fe0b86dcef0b94e6b29b00f6c7b84821a6253cb1ecec44c2b16725` |
| `stress-P3_numbers-holdout2.jsonl` | `f09bc6437ef84c867464d1c36a0f290106a24a0633c4ffff4e6e776c4eb2e1af` | `b57f9514687d3f0f0d0aa0a0bf21d2e0628490c3dae2d39a4c4b044026746969` |
| `stress-P4_ocr-holdout2.jsonl` | `c782e234fad51871f98646956c179f322f808db37c5f98946f25d9b41262c405` | `e68bacb53658b0737ba8af57d05f41da5a04d9d0ca082e82b65c18bb4a09b8d0` |
| `stress-P5_layout-holdout2.jsonl` | `61259164786ac2bab3b97031c83d3ab5fad3a5ff5f97d38a3b7c6aa89ff03e63` | `5d8cf53e965b2f013d66318c84c41a2e4b5c2125fe2f52b5a90e367fff6172bb` |
| `stress-P6_all-holdout2.jsonl` | `3ce5912f26d9b0ce618826efe52192af085641d8e21c18896ccb4435c9ab588f` | `a6e91b1d058b2222107096b939b77f28ce8c0b6f0c59d16044ac7a3a37f3b6b4` |
| `stress-P1_order-holdout3.jsonl` | `fa20742f808f8f77e8e37973b63804b786b1306939a35de0b085df1857ca1ca5` | `79e465234a391d65e1334c4cccf9601ec2b099905c5d46862c0719babb993bdc` |
| `stress-P2_wording-holdout3.jsonl` | `321206caad8e479bfde352eff74ebf77945a77e7318c94d007ae5a0fe4c25b26` | `d2a12aafb801838e17d0b4d57928a139ea9940ac2d073e58c2dd83c311dec8a1` |
| `stress-P3_numbers-holdout3.jsonl` | `2f05dc8f37ff57b9e00df7f4f9f2b037f9139d010807189b558b0a0c3eb8783b` | `f6a75058573b81a4e015726ac4ca07e2ef429285616951d88b1f79c5ca4d9d31` |
| `stress-P4_ocr-holdout3.jsonl` | `bfa387a744c505b80ec443eb8956913665dd9878e42f1e3c9ea7d5530044e546` | `bcc8bed5c1c674add9b89936026ce491b2358c1a3de09d7cfe6d2fb135335630` |
| `stress-P5_layout-holdout3.jsonl` | `26265b2c5da7472a9e55d0712a0f5a80ee51bcdf5133051cc5a67c4dc9332c86` | `f4f908fd65baa5980f484f45a5fd60282a7155aa87a58f79b4e8e934eda63454` |
| `stress-P6_all-holdout3.jsonl` | `ca14b79a706ecabb8cd63b389a6798af7137e8cdd311b9793302fcea4d3fa292` | `b813ba99044bd07a3ba6e19a439d58537a2533038dd9559d07259a04007957c1` |
| `stress-P1_order-holdout4.jsonl` | `c91aff9cc8accda62a49cc00e3d6a1d252361c015dce59300a788638bb6dcbb1` | `7a558372916c9bc60fe727374214bc6b246bad87d9cc6f3854eb62c9d2de9b0e` |
| `stress-P2_wording-holdout4.jsonl` | `f6129110b02428fdc2787633f59c22d8936fea59c3cc17d9f1e04ac3f31c825e` | `c393546faa0b707d3b20f77b0bd4b88f240f340ea2a8756b623ac8b139b70287` |
| `stress-P3_numbers-holdout4.jsonl` | `40633d65ad18ee127eca1775e3767d28e45eaa7b26be1d669679143014fedbdf` | `71bf13f37fd11941947214464d23c72c4e7f78643547e77aca232c6b2cb8ad58` |
| `stress-P4_ocr-holdout4.jsonl` | `36a7dd42ff488f08d86355ec14d12caeb5a59f054d8948a9dc89548189ad11c2` | `016c010b455bc705026e166eb4a4dff114878e13f22c852dc68dcce627dae3ba` |
| `stress-P5_layout-holdout4.jsonl` | `36881d5961a77ed9fab598166f427b850cad72ce92df293ad745802d9639833b` | `f3daa18a4eea684fd89b586e60da83f0ecd58a1aa1b7a7551e85a16a0f11995f` |
| `stress-P6_all-holdout4.jsonl` | `876c3fa5042b32672c4c9615d8b3d3ceccf99f4b11629a35c6df21e1699bbc19` | `0d274660cf381dd7a57cc906f3778e50a9222c20a13beaf21e3db5cc36a054b8` |
| `stress-P1_order-holdout5.jsonl` | `950986df251c2c4df8c5577b3d0b61ab7c63cf31d723544b93baf1920984fddf` | `03ab2650e1f2abc33e7b4c6f135b26c2b493ba5d7ee15ca4365423d7cbb3eccd` |
| `stress-P2_wording-holdout5.jsonl` | `36c297fdc0e7e7f4f6f184c73a60dad88a9617625c251354e5ca090e0bc4e123` | `366a906cfe77d6282659857555bf7925c93acd09226a77abce7833f6956fbf8f` |
| `stress-P3_numbers-holdout5.jsonl` | `c2ed28a911389221497b1c7646ebdce632769afc9afb12b78b5f0924ea6f6de5` | `520f07ea1ae6458db443e01d234d13534d46e8e77409f55946aff599d7b6485e` |
| `stress-P4_ocr-holdout5.jsonl` | `890044321a45f8ffa17d3689fae12a82d5df37cd6ba23a2a629fbc0fcefbf6cf` | `b5ba73574e0d711b8b164e5220294d5d807796c4fafce7ea55ad9ca83ef06e8f` |
| `stress-P5_layout-holdout5.jsonl` | `2a1370fa27d1302db92e1ebfbcf58e3082a39738dcb3b0089e1600260ed53ee8` | `665dc5a654972d219f4070ece84bf7164c75c553c0087986f9ba2cc605b2b514` |
| `stress-P6_all-holdout5.jsonl` | `7b8afdd392d6866e96184f1934548b38dcc9101250fe570fd69b26ecfa6e7acf` | `4542e8272b287873fb0560ce7de0c6bda8f16e98e1db4ae9c8081b31f3a4eef3` |

## Seventh amendment, 2026-10-13: re-banked under engine 0.7.0, after the emailed-bill readings

**Why.** The engine moved to 0.7.0, and the AP pack changed in behaviour. On an emailed bill the sender is now the address in
angle brackets; a sender whose domain is not built from the vendor's name goes to a person when no domain is on file, and a
hyphen the vendor's name does not carry is a look-alike; payment-instruction sentences are read as sentences; a partial bill is
ordinary, and a bill line that matches no purchase-order line, or does not name the item of the line it is paired with, is its
own claim; a tax line is read and checked against the rate the purchase order states; a suffixed invoice number is read whole.
A sixteenth file joined the pack (`v070.ts`, the engine gate). The rows named engine 0.6.0 and `checker_sha256`
`2ee0594b2158655849b3a157b83509f6812b0e6e2416888d9b6d92e7224daef1` (fifteen files).

**Re-run under:** engine 0.7.0, ruleset ap-threeway@0.2.0, `checker_sha256`
`fb6455c4025bc8d633f9a5eacc5a3c7002fc3d7bbf67b4983492141f76d9cdba` (16 source files). The protocol is the fourth amendment's:
before banking, each seed was run into a new folder and compared row by row with the banked files; after banking, the new files
were compared with a copy of the old ones, with the same result.

| seed | rows | decisions moved | rows whose reasons changed | rows whose checker_sha256 and engine_version moved | other fields moved |
|---|---|---|---|---|---|
| holdout1 | 600 | 0 | 34 | 600 | 0 |
| holdout2 | 600 | 0 | 27 | 600 | 0 |
| holdout3 | 600 | 0 | 32 | 600 | 0 |
| holdout4 | 600 | 0 | 34 | 600 | 0 |
| holdout5 | 600 | 0 | 22 | 600 | 0 |
| all five | 3,000 | 0 | 149 | 3,000 | 0 |

**What the reasons say now.** 148 rows read fewer invoice lines than the purchase order has and leave an amount on the invoice
unread (the perturbation broke a line's numbers): they still go to a person on the same check, and the reason now says why:
"read 3 invoice line(s) but the PO has 6, and an amount on the invoice (490.4, in "- 24 x BUCKET MOP W/WRINGER @ 62.10 USD = 1
490.40 USD") was not read as a line: cannot tell whether the bill is partial", where it said "read 3 invoice line(s) but the PO
has 6". One row whose line match was too weak to trust now names
the bill line and its nearest purchase-order line (`ap.bill_line[n].quantity`), on the same decision.

**A first re-run moved decisions, and the readings were corrected before banking.** The first run of the new pack, on the
same seeds, moved 120 decisions and made 5 wrong. Three causes: the item-word reading did not read a word with its vowels
dropped inside a compound ("HNDTRCK") or two neighbouring letters swapped ("WRIE"), as the perturbations write them; a
partial bill was read even when an amount on the bill was left unread, so a line the perturbation made unreadable counted as
not billed and a later hold took the label (the 5 wrong rows); and a forward marker garbled in scanning left the forwarder's
address read as the bill's sender. Each was corrected (swaps and consonant skeletons read; a partial bill only when every
amount was read; every sender's address read for one built from the vendor's name), and the run above is the corrected pack's.

Every count is unchanged: **0 wrong of 2,755 decided** (of 3,000 perturbed invoices). A fresh run after the re-bank is
identical, 30 of 30, and each of the five runs exits 0. This is the ninth time the files have been written since they were
first banked on 2026-09-23. As the sixth amendment said, this shows the rows reproduce under the new pack, not that the new
readings work: the seeds were not built to contain the bills they catch.

| file | sha256 after the sixth amendment | sha256 after this one |
|---|---|---|
| `stress-P1_order-holdout1.jsonl` | `e1e75a47e3d188612cd1d7474fefd59b3c8e648136a5fbb1fc60af7f76316dc5` | `166b4a77504320b20944801b01a4d1106eabb5fe1bac6f2d4b1369178a9ec7fe` |
| `stress-P2_wording-holdout1.jsonl` | `ed8859e6940ae5f6df3d9d989665880706a60dbb6f0b1310f72bb1e9a942af4e` | `a1d6467bc427e48347011cdb3eb7f369f5da15709cb830aa844f3ac05e660d9e` |
| `stress-P3_numbers-holdout1.jsonl` | `ffbf7db2c12875cc317fe15cf3bafe03b44894366614a6dd188133dc83bb2754` | `a3646ec79ef26c734802a8fc755f7d6182c9482686ae634a7d04e3791a9ad59b` |
| `stress-P4_ocr-holdout1.jsonl` | `e91a4230e07616f5576e6db28e54a87e723a1ad795ffd20fd3d64540d5293904` | `c2acb22293a28e168e52a12410063f7d8c6f9cc64a43b4e2f5930ff389e5239b` |
| `stress-P5_layout-holdout1.jsonl` | `f7de28a864403b3738cf8648536886f2514f4d6ebf554607a2eedecf207a794b` | `70d676300bde22436fd1587355976438e093c0e8fe6a73439f56ec39cdbf9e99` |
| `stress-P6_all-holdout1.jsonl` | `0ede473c3f512b8f429f5f30fee69bcc7674f7c4070ea471e545022b8582fc41` | `838260e7bc73783168d0c3e04d01bafbe142d7bb2fc992770791c407d73c63d0` |
| `stress-P1_order-holdout2.jsonl` | `71c2c2c5bbfecc2d85dcc57fa9fa353d9355c8c2d86e7d8bd964021526e10a8a` | `4f57c6ba556d5ab71456338a4f825c0523993bfbdd10d6d6b018e9b53048d110` |
| `stress-P2_wording-holdout2.jsonl` | `c344a8b937fe0b86dcef0b94e6b29b00f6c7b84821a6253cb1ecec44c2b16725` | `dcef978415c8a8f7c84f6e226af88b0c76a05043fe817672f2ed55b88a2d5c32` |
| `stress-P3_numbers-holdout2.jsonl` | `b57f9514687d3f0f0d0aa0a0bf21d2e0628490c3dae2d39a4c4b044026746969` | `a56bf0a530ddd102de4d19b90d70bc19b635c77e5ecf48ffd291b1ba3dccce47` |
| `stress-P4_ocr-holdout2.jsonl` | `e68bacb53658b0737ba8af57d05f41da5a04d9d0ca082e82b65c18bb4a09b8d0` | `888d26df714c985fdf219af487afbcc2418b931f004ec567a59ba7618e16ab72` |
| `stress-P5_layout-holdout2.jsonl` | `5d8cf53e965b2f013d66318c84c41a2e4b5c2125fe2f52b5a90e367fff6172bb` | `13a0dffa882bc599b8f2946a77a3a31b18c0e0ad97bda616005c0025e6298f01` |
| `stress-P6_all-holdout2.jsonl` | `a6e91b1d058b2222107096b939b77f28ce8c0b6f0c59d16044ac7a3a37f3b6b4` | `69d79cebb320a32746fc6a22b1bd3e1055907db580e310d84c4105a6af234cba` |
| `stress-P1_order-holdout3.jsonl` | `79e465234a391d65e1334c4cccf9601ec2b099905c5d46862c0719babb993bdc` | `251799d8f6f09c79c48594aa4c286ad1b6b25c52ec754ee8996a5d0d0607e1ad` |
| `stress-P2_wording-holdout3.jsonl` | `d2a12aafb801838e17d0b4d57928a139ea9940ac2d073e58c2dd83c311dec8a1` | `171de68ea376ba4cc9e9a0560565b135bfe8ddd192bcc3b5f2e7c27f0fc0d6b5` |
| `stress-P3_numbers-holdout3.jsonl` | `f6a75058573b81a4e015726ac4ca07e2ef429285616951d88b1f79c5ca4d9d31` | `b3e0668850f25b5bb6c5b0120cc0a318be5cc355773f738f6e5a55830d5bc29e` |
| `stress-P4_ocr-holdout3.jsonl` | `bcc8bed5c1c674add9b89936026ce491b2358c1a3de09d7cfe6d2fb135335630` | `4bb0e93ca0b1d154af44f9fd4f85851ecbef4d31dc28a6ac56423d15c6938887` |
| `stress-P5_layout-holdout3.jsonl` | `f4f908fd65baa5980f484f45a5fd60282a7155aa87a58f79b4e8e934eda63454` | `9214a5c310f69d807a9a3a780b28fcc4c78167f037c66d5ca9b74eb6779d44ab` |
| `stress-P6_all-holdout3.jsonl` | `b813ba99044bd07a3ba6e19a439d58537a2533038dd9559d07259a04007957c1` | `92e25f4adebb4f45c5ac478a4a892229f243b2e0ba1d45485c0232aa1ca98b5f` |
| `stress-P1_order-holdout4.jsonl` | `7a558372916c9bc60fe727374214bc6b246bad87d9cc6f3854eb62c9d2de9b0e` | `f12ddd58ac5eb1b489f5fe1acb3f569f06e397ff707e205dc61136035a5519e9` |
| `stress-P2_wording-holdout4.jsonl` | `c393546faa0b707d3b20f77b0bd4b88f240f340ea2a8756b623ac8b139b70287` | `7844169ca3ef1fc3be10ee5fcc174757fde32c97f1d8d64b9a408551a3dca552` |
| `stress-P3_numbers-holdout4.jsonl` | `71bf13f37fd11941947214464d23c72c4e7f78643547e77aca232c6b2cb8ad58` | `0aaae0407e2e687553406326b83414a43be1431c8ac5495601979df0b4cbc2ce` |
| `stress-P4_ocr-holdout4.jsonl` | `016c010b455bc705026e166eb4a4dff114878e13f22c852dc68dcce627dae3ba` | `c2622b43275cc80bed6ceb292d69009885d347130f24eae7e9418bbe0a84ba51` |
| `stress-P5_layout-holdout4.jsonl` | `f3daa18a4eea684fd89b586e60da83f0ecd58a1aa1b7a7551e85a16a0f11995f` | `a789adce5c92fbb22c60ce4f62c7fb734db944236d3813557a3e940f18bb1c52` |
| `stress-P6_all-holdout4.jsonl` | `0d274660cf381dd7a57cc906f3778e50a9222c20a13beaf21e3db5cc36a054b8` | `f378a48020dd29bb5b930896a733189ff338d773dc896d839ea3b2abaefe405c` |
| `stress-P1_order-holdout5.jsonl` | `03ab2650e1f2abc33e7b4c6f135b26c2b493ba5d7ee15ca4365423d7cbb3eccd` | `ff5b96c9866f8cdaaa6bf3f8e5ed1a6849613f35af730502ca4f2512df479fd8` |
| `stress-P2_wording-holdout5.jsonl` | `366a906cfe77d6282659857555bf7925c93acd09226a77abce7833f6956fbf8f` | `a58634564df0a21afc1ddb5f0b6bb149d17a223026c53fdf245cec55fd2265ab` |
| `stress-P3_numbers-holdout5.jsonl` | `520f07ea1ae6458db443e01d234d13534d46e8e77409f55946aff599d7b6485e` | `4506f6d75324e350121ea8a2d60ced0a0783f2dd01a3ff0a7b2c30f9f0ef0656` |
| `stress-P4_ocr-holdout5.jsonl` | `b5ba73574e0d711b8b164e5220294d5d807796c4fafce7ea55ad9ca83ef06e8f` | `da8defa53c83b693bb2e7e703c4a56b46dec3ac6e269bd7700ee491d43c31865` |
| `stress-P5_layout-holdout5.jsonl` | `665dc5a654972d219f4070ece84bf7164c75c553c0087986f9ba2cc605b2b514` | `b58bd3e3687b213aaf754da8c2145f831dc87bcf61c60cae960122dafcbcb2ca` |
| `stress-P6_all-holdout5.jsonl` | `4542e8272b287873fb0560ce7de0c6bda8f16e98e1db4ae9c8081b31f3a4eef3` | `bde1986678f8a251b353b2c6557378f2ffa5292232f5ac3c442fcd879c3f0184` |

## Eighth amendment, 2026-10-13: re-banked, digest only, after a domain on file stopped reading a swap back

**Why.** Under engine 0.7.0 a domain on file (the purchase order's "Email:" field, or a booked bill's sender) now passes only
as written: the same domain with two neighbouring letters swapped is a look-alike for the controller, both domains named, where
the seventh amendment's pack read the swap back as a scanning slip. One file of the pack changed (`vendor.ts`), so the digest
moved from `fb6455c4025bc8d633f9a5eacc5a3c7002fc3d7bbf67b4983492141f76d9cdba` to
`bf1606f3d9b26852d27cbccc82bf7a3d68478948ea105a989c5bf9ffcbaa4bba` over the same sixteen files, under the same engine 0.7.0 and
ruleset ap-threeway@0.2.0. The perturbations carry no domain on file, so no row reads differently.

**Nothing but the digest moved.** The protocol is the fourth amendment's. Before banking, each seed was run into a new
folder and compared row by row with the banked files; after banking, the new files were compared with a copy of the old
ones. On all 3,000 rows: 0 decisions moved, 0 reasons changed, 0 other fields moved, and `checker_sha256` moved on every
row. Every count is unchanged: **0 wrong of 2,755 decided** (of 3,000 perturbed invoices). A fresh run after the re-bank
is identical, 30 of 30, and each of the five runs exits 0. This is the tenth time the files have been written since they
were first banked on 2026-09-23.

| file | sha256 after the seventh amendment | sha256 after this one |
|---|---|---|
| `stress-P1_order-holdout1.jsonl` | `166b4a77504320b20944801b01a4d1106eabb5fe1bac6f2d4b1369178a9ec7fe` | `c0391066f5c3cc9b2b6cad2f8ef50ac07aa066d98933de7a2930d271288dd95a` |
| `stress-P2_wording-holdout1.jsonl` | `a1d6467bc427e48347011cdb3eb7f369f5da15709cb830aa844f3ac05e660d9e` | `b818c82da23b38be162afc2e9582c4cee77d2bba1216006191cf44e19cbce5ad` |
| `stress-P3_numbers-holdout1.jsonl` | `a3646ec79ef26c734802a8fc755f7d6182c9482686ae634a7d04e3791a9ad59b` | `99012a98185d2205eee4152a0ac89b6e06f5144cb77b60dc2ea25110e4454b15` |
| `stress-P4_ocr-holdout1.jsonl` | `c2acb22293a28e168e52a12410063f7d8c6f9cc64a43b4e2f5930ff389e5239b` | `02209dfc51cc48e498b687efef6927898e932c2d36cbc777d8d8b64a81f4c7bd` |
| `stress-P5_layout-holdout1.jsonl` | `70d676300bde22436fd1587355976438e093c0e8fe6a73439f56ec39cdbf9e99` | `74b6f176ed84d6246d8cf2a8aa11fd07a442662269b16a0744eb32108dfd8f5c` |
| `stress-P6_all-holdout1.jsonl` | `838260e7bc73783168d0c3e04d01bafbe142d7bb2fc992770791c407d73c63d0` | `67311913ab3fc0f34d79ca3c46f7b8e4a24b4466075fd9282225a8bf596f6834` |
| `stress-P1_order-holdout2.jsonl` | `4f57c6ba556d5ab71456338a4f825c0523993bfbdd10d6d6b018e9b53048d110` | `1095d105fe9c61a6b0c177482fbcf86ad4d8197ac7077d7196b05cb47c85b222` |
| `stress-P2_wording-holdout2.jsonl` | `dcef978415c8a8f7c84f6e226af88b0c76a05043fe817672f2ed55b88a2d5c32` | `8a717cc55532a4172d215b3528aab486af50897dd7350bc6529b8bd86e99c534` |
| `stress-P3_numbers-holdout2.jsonl` | `a56bf0a530ddd102de4d19b90d70bc19b635c77e5ecf48ffd291b1ba3dccce47` | `0156cc6b6bcf292d6e4de102bedefaabe36f7b853dbab8ef3a45daa70518aa2b` |
| `stress-P4_ocr-holdout2.jsonl` | `888d26df714c985fdf219af487afbcc2418b931f004ec567a59ba7618e16ab72` | `418694f5f66b254a86e1d419e2be79754ed3141b57a350914b11e902d33aeb07` |
| `stress-P5_layout-holdout2.jsonl` | `13a0dffa882bc599b8f2946a77a3a31b18c0e0ad97bda616005c0025e6298f01` | `d0a2f134e00393d45342638b0d54878b911f8af7bfa084bd289617d907e7d7cd` |
| `stress-P6_all-holdout2.jsonl` | `69d79cebb320a32746fc6a22b1bd3e1055907db580e310d84c4105a6af234cba` | `7b4839706be3e33f134e5de184532cb9c7b5d483e2028d93e6d13624382ba05e` |
| `stress-P1_order-holdout3.jsonl` | `251799d8f6f09c79c48594aa4c286ad1b6b25c52ec754ee8996a5d0d0607e1ad` | `e1d8debfac6d66f48626be9df5b9671d07d9344df22834dc2337a34ddd93f9b9` |
| `stress-P2_wording-holdout3.jsonl` | `171de68ea376ba4cc9e9a0560565b135bfe8ddd192bcc3b5f2e7c27f0fc0d6b5` | `4f9b9eff74dde5a9eea5fc22f8efdd03680ca712f157f42ced4f792aa6fedf88` |
| `stress-P3_numbers-holdout3.jsonl` | `b3e0668850f25b5bb6c5b0120cc0a318be5cc355773f738f6e5a55830d5bc29e` | `4f20117e7d89b9028abf83cd72c5f34766e576b3a3b77b19777070395257ccb2` |
| `stress-P4_ocr-holdout3.jsonl` | `4bb0e93ca0b1d154af44f9fd4f85851ecbef4d31dc28a6ac56423d15c6938887` | `4b3785ecd67a619bccc88d373de03d1f7917e2ddde1a300bce862bd245d2d1f5` |
| `stress-P5_layout-holdout3.jsonl` | `9214a5c310f69d807a9a3a780b28fcc4c78167f037c66d5ca9b74eb6779d44ab` | `bec1fed666c55cf952c4b8b0b2cb6abaab0ff84a367e1cf78f2ba775a048f6ac` |
| `stress-P6_all-holdout3.jsonl` | `92e25f4adebb4f45c5ac478a4a892229f243b2e0ba1d45485c0232aa1ca98b5f` | `a2c6932b6005616c4984ac473ca5593f971c0fffc50521057b0acafa502fc210` |
| `stress-P1_order-holdout4.jsonl` | `f12ddd58ac5eb1b489f5fe1acb3f569f06e397ff707e205dc61136035a5519e9` | `3628b28569637fafade7c051b28ec831bbc586e31126176c2d6762129aa438d5` |
| `stress-P2_wording-holdout4.jsonl` | `7844169ca3ef1fc3be10ee5fcc174757fde32c97f1d8d64b9a408551a3dca552` | `17a5e984462e974f00943a895fc551aab0f54acb18377684f5d588724bd3deaa` |
| `stress-P3_numbers-holdout4.jsonl` | `0aaae0407e2e687553406326b83414a43be1431c8ac5495601979df0b4cbc2ce` | `0b40a0a0322c3a15c3d998a18551753a6d698e9836405162a2440b77074a236c` |
| `stress-P4_ocr-holdout4.jsonl` | `c2622b43275cc80bed6ceb292d69009885d347130f24eae7e9418bbe0a84ba51` | `309c3cf848a111b86bf14a4f32c5bac95344145752634fe357618f3f26388b27` |
| `stress-P5_layout-holdout4.jsonl` | `a789adce5c92fbb22c60ce4f62c7fb734db944236d3813557a3e940f18bb1c52` | `028bbb942c4eba6653b7708089cd26925ffa7b853138890887d030ebd7bdbbfb` |
| `stress-P6_all-holdout4.jsonl` | `f378a48020dd29bb5b930896a733189ff338d773dc896d839ea3b2abaefe405c` | `d892f87e0ca6ae4c40a570aa197b6d4ee7856439cb0c7121e11eda537daed98b` |
| `stress-P1_order-holdout5.jsonl` | `ff5b96c9866f8cdaaa6bf3f8e5ed1a6849613f35af730502ca4f2512df479fd8` | `1c508dd81ae7da13c8dbb9fdcc0bb3bce95afff2a6ecfef0e2056bc80d5e6294` |
| `stress-P2_wording-holdout5.jsonl` | `a58634564df0a21afc1ddb5f0b6bb149d17a223026c53fdf245cec55fd2265ab` | `3ee59ad3d589adcdba8e2f869103d80e1fd4cdfc95a13bdd707f0536af898d57` |
| `stress-P3_numbers-holdout5.jsonl` | `4506f6d75324e350121ea8a2d60ced0a0783f2dd01a3ff0a7b2c30f9f0ef0656` | `d13e1d17f39a56ae064cf2327fc96267b196ba211d98ebb7f7fbf86193996edb` |
| `stress-P4_ocr-holdout5.jsonl` | `da8defa53c83b693bb2e7e703c4a56b46dec3ac6e269bd7700ee491d43c31865` | `90ad705e3754e46d4ff66cfd31b5e6c62c89310691e8572f8782c6dc0bcaeb93` |
| `stress-P5_layout-holdout5.jsonl` | `b58bd3e3687b213aaf754da8c2145f831dc87bcf61c60cae960122dafcbcb2ca` | `33277c4230fd6f40b7167a65d9d38108048ffcc25bab2cac004c5f9d0a3fde03` |
| `stress-P6_all-holdout5.jsonl` | `bde1986678f8a251b353b2c6557378f2ffa5292232f5ac3c442fcd879c3f0184` | `b8c84daf8d27e1b88c9e227a43167ed53384e1fcef334077d658d7ceaea6b411` |

## Ninth amendment, 2026-10-13: re-banked, engine label only, when engine 0.7.1 was opened

**Why.** The release pass opened engine 0.7.1 above 0.7.0 (the legal default `legal@0.5.3`; invoice explanations in words; replay,
HTTP and ledger answers). Each row records the engine that read it, so all 3,000 rows named 0.7.0 while the tree reads them under
0.7.1. No file of the AP pack changed: the digest stays `bf1606f3d9b26852d27cbccc82bf7a3d68478948ea105a989c5bf9ffcbaa4bba` over
the same sixteen files, under ruleset ap-threeway@0.2.0.

**Nothing but the engine label moved.** The protocol is the fourth amendment's. Before banking, each seed was run into a new
folder and compared row by row with the banked files; after banking, the new files were compared with a copy of the old ones. On
all 3,000 rows: 0 decisions moved, 0 reasons changed, 0 other fields moved, and `engine_version` moved on every row, from 0.7.0 to
0.7.1; `checker_sha256` did not move. The 2,400 rows of the other stress files in the folder were not written. Every count is
unchanged: **0 wrong of 2,755 decided** (of 3,000 perturbed invoices). A fresh run after the
re-bank is identical, 30 of 30, and each of the five runs exits 0. The files were first banked on 2026-09-23 (the seventh and
eighth amendments each call their write the tenth; this one does not restate a count).

| file | sha256 after the eighth amendment | sha256 after this one |
|---|---|---|
| `stress-P1_order-holdout1.jsonl` | `c0391066f5c3cc9b2b6cad2f8ef50ac07aa066d98933de7a2930d271288dd95a` | `331a4822ad9e8fd688eb003b932abcc94329285c7acbfd4c1a0c422a7494462b` |
| `stress-P2_wording-holdout1.jsonl` | `b818c82da23b38be162afc2e9582c4cee77d2bba1216006191cf44e19cbce5ad` | `8f8a43bdd38ffe93b141899240d16d00a2d7ed5faea6cba82b2b480c22d71e58` |
| `stress-P3_numbers-holdout1.jsonl` | `99012a98185d2205eee4152a0ac89b6e06f5144cb77b60dc2ea25110e4454b15` | `d709880cc056ff772c0843b3cca7fdfd36c50717a6767fa003aa15d84dc88921` |
| `stress-P4_ocr-holdout1.jsonl` | `02209dfc51cc48e498b687efef6927898e932c2d36cbc777d8d8b64a81f4c7bd` | `a57ed5298e1c93c08ccac415c83b3844387f010dc041f2cbcf48d890f755fff5` |
| `stress-P5_layout-holdout1.jsonl` | `74b6f176ed84d6246d8cf2a8aa11fd07a442662269b16a0744eb32108dfd8f5c` | `e59f40b28a8c0aa40a11cc7e00db23873373e886ec9e53dc2d3f2ae69e936a3d` |
| `stress-P6_all-holdout1.jsonl` | `67311913ab3fc0f34d79ca3c46f7b8e4a24b4466075fd9282225a8bf596f6834` | `144da7b339240dc871b50b0a817f650ebdad82ae6cf7ca23f3c5d855d2870b7d` |
| `stress-P1_order-holdout2.jsonl` | `1095d105fe9c61a6b0c177482fbcf86ad4d8197ac7077d7196b05cb47c85b222` | `84f22cd161f1ddcfa429483c7fbd06a22d6ca3eba7726a9ed5ac02cbb12b6b40` |
| `stress-P2_wording-holdout2.jsonl` | `8a717cc55532a4172d215b3528aab486af50897dd7350bc6529b8bd86e99c534` | `799871ff503d2a3699954effa1ca10dfbf500fc60415fd38df6ec6168305d12a` |
| `stress-P3_numbers-holdout2.jsonl` | `0156cc6b6bcf292d6e4de102bedefaabe36f7b853dbab8ef3a45daa70518aa2b` | `ee1029c42de44dac27120767054efa06442ebf56cf8338f474f6d8a6695bf270` |
| `stress-P4_ocr-holdout2.jsonl` | `418694f5f66b254a86e1d419e2be79754ed3141b57a350914b11e902d33aeb07` | `6b6f2f59cb1e2ac52a884793dd8a35fbfa9ea5790083aaaeac59b0b419abac0e` |
| `stress-P5_layout-holdout2.jsonl` | `d0a2f134e00393d45342638b0d54878b911f8af7bfa084bd289617d907e7d7cd` | `2b82ef0081baea9cce5bb0973e846db37ec8f87e3e3bccdf912596333d98f3db` |
| `stress-P6_all-holdout2.jsonl` | `7b4839706be3e33f134e5de184532cb9c7b5d483e2028d93e6d13624382ba05e` | `cfc1dc3c3358a5522b9daff3054486007cf0db6021986b0d5069cdd370bb197a` |
| `stress-P1_order-holdout3.jsonl` | `e1d8debfac6d66f48626be9df5b9671d07d9344df22834dc2337a34ddd93f9b9` | `2fa944bc55b8721d345cfed723db8fb467bcd5afba3a1279acbc03955b421c69` |
| `stress-P2_wording-holdout3.jsonl` | `4f9b9eff74dde5a9eea5fc22f8efdd03680ca712f157f42ced4f792aa6fedf88` | `a38c7c218269edfb00186ee75aac2f5736cec2ea64f51bfa0c3b7065ae0fc266` |
| `stress-P3_numbers-holdout3.jsonl` | `4f20117e7d89b9028abf83cd72c5f34766e576b3a3b77b19777070395257ccb2` | `15b1d8ac0bd8529b67aa47428412dc1af516176e7186ed31892631f15b84fee3` |
| `stress-P4_ocr-holdout3.jsonl` | `4b3785ecd67a619bccc88d373de03d1f7917e2ddde1a300bce862bd245d2d1f5` | `60989dd37b18c00412e535e57452ba7349afad164de55e56d58039c36a517d0a` |
| `stress-P5_layout-holdout3.jsonl` | `bec1fed666c55cf952c4b8b0b2cb6abaab0ff84a367e1cf78f2ba775a048f6ac` | `d87b601d1fa604951abd2212190754e56373a13fbfcfb7942e97395145656eac` |
| `stress-P6_all-holdout3.jsonl` | `a2c6932b6005616c4984ac473ca5593f971c0fffc50521057b0acafa502fc210` | `6ede0f32823135b5cb1fddefee532b5e8e56029eee6ee0f294f920922c00594b` |
| `stress-P1_order-holdout4.jsonl` | `3628b28569637fafade7c051b28ec831bbc586e31126176c2d6762129aa438d5` | `c49d867323ea6d0643dc65ed106f1e5e96eef3e2316666e202d84055a9ff6cfd` |
| `stress-P2_wording-holdout4.jsonl` | `17a5e984462e974f00943a895fc551aab0f54acb18377684f5d588724bd3deaa` | `260862e1a4dcff1bd7bf4305654505254aac79bea3a27b8834977c2779b17ded` |
| `stress-P3_numbers-holdout4.jsonl` | `0b40a0a0322c3a15c3d998a18551753a6d698e9836405162a2440b77074a236c` | `89840fe1099f12097f8df76f49edf539d03630194936c77f6c68e261f339932a` |
| `stress-P4_ocr-holdout4.jsonl` | `309c3cf848a111b86bf14a4f32c5bac95344145752634fe357618f3f26388b27` | `f6c9f2a6876486bb9d77370071a92dc8ca1d67bc78cb72b59a6391e5c909004d` |
| `stress-P5_layout-holdout4.jsonl` | `028bbb942c4eba6653b7708089cd26925ffa7b853138890887d030ebd7bdbbfb` | `b8310b126f80f8d958ef98724bee8986f24865fb3f1a6cff94c66a7f3d6ec137` |
| `stress-P6_all-holdout4.jsonl` | `d892f87e0ca6ae4c40a570aa197b6d4ee7856439cb0c7121e11eda537daed98b` | `f081a727f63520ad9e9a98bf9ad10965d028cfda14afcf831806cd1a145b2868` |
| `stress-P1_order-holdout5.jsonl` | `1c508dd81ae7da13c8dbb9fdcc0bb3bce95afff2a6ecfef0e2056bc80d5e6294` | `4ab7de62a2c4d993c8d42c6071f6f60e61b3c860f04def7dc3e1032789bd3e83` |
| `stress-P2_wording-holdout5.jsonl` | `3ee59ad3d589adcdba8e2f869103d80e1fd4cdfc95a13bdd707f0536af898d57` | `d630b8eefab7deb444aed462d269cb4f16843611aa959d01f2b149fbf34a354f` |
| `stress-P3_numbers-holdout5.jsonl` | `d13e1d17f39a56ae064cf2327fc96267b196ba211d98ebb7f7fbf86193996edb` | `5dfc3805f31c436cd995f3521868a84d1297143887541921a48e3622d2591f8f` |
| `stress-P4_ocr-holdout5.jsonl` | `90ad705e3754e46d4ff66cfd31b5e6c62c89310691e8572f8782c6dc0bcaeb93` | `d5696a0c02e5c499eae46f014f5d5e3de284d65b351580453ceb885dfb61fdcf` |
| `stress-P5_layout-holdout5.jsonl` | `33277c4230fd6f40b7167a65d9d38108048ffcc25bab2cac004c5f9d0a3fde03` | `2270fcfe10b9683f49f7442648b1337a165bda9e83d288c179453e3bf2a8266f` |
| `stress-P6_all-holdout5.jsonl` | `b8c84daf8d27e1b88c9e227a43167ed53384e1fcef334077d658d7ceaea6b411` | `2663b5df7a22deca62530218931c52a3d8ad0c9bae1450f320985422cee598f7` |

**Correction, 2026-10-14 00:29Z (20:29 EDT on 2026-10-13), appended below the ninth amendment; its text above is unchanged.** The ninth amendment says "the seventh and eighth amendments each call their write the tenth". They do not: the seventh calls its write the ninth time the files have been written since they were first banked on 2026-09-23, and the eighth calls its write the tenth, and both counts are right. The ninth amendment's write is the eleventh.

## Tenth amendment, 2026-10-14: re-banked when engine 0.7.2 opened and ap-threeway@0.3.0 became the default

**Why.** The release pass opened engine 0.7.2 above 0.7.1, and with it `ap-threeway@0.3.0` became the default for a bill that names no
ruleset (an announced change of payment details goes to the controller; a pole count, a subtotal line that is the lines' sum, a
distributor's invoice number and a price per thousand are read; docs/AP-INPUT.md, the CHANGELOG's 0.7.2 entry). Five files of the
AP pack changed for it, so the digest moved from `bf1606f3d9b26852d27cbccc82bf7a3d68478948ea105a989c5bf9ffcbaa4bba` to
`5fb35b2610c373b7c80ad931406995837b09f9e6a6a11277bc7ce96ff0a46973` over the same sixteen files.

**Nothing but the three provenance fields moved.** The protocol is the fourth amendment's. Before banking, each seed was run into a
new folder and compared row by row with the banked files; after banking, the new files were compared with a copy of the old ones. On
all 3,000 rows: 0 decisions moved, 0 reasons changed, and three fields moved on every row: `engine_version` 0.7.1 to 0.7.2,
`ruleset` ap-threeway@0.2.0 to ap-threeway@0.3.0, and `checker_sha256` as above. None of the banked invoices carries a subtotal
line, a price per thousand, a pole count, a plain distributor number or an announced change, which is why the new readings move no
row here; this table measures that the perturbations still decide as before, not the new readings themselves. Every count is
unchanged: **0 wrong of 2,755 decided** (of 3,000 perturbed invoices). A fresh run after the re-bank is identical, 30 of 30, and each
of the five runs exits 0. The 2,400 rows of the other stress files in the folder were not written.

| file | sha256 after the ninth amendment | sha256 after this one |
|---|---|---|
| `stress-P1_order-holdout1.jsonl` | `331a4822ad9e8fd688eb003b932abcc94329285c7acbfd4c1a0c422a7494462b` | `a6b0ff3ebb44c5552e7b4ecd62f9de7bfbf059dff690990d560f3e91797dbba5` |
| `stress-P2_wording-holdout1.jsonl` | `8f8a43bdd38ffe93b141899240d16d00a2d7ed5faea6cba82b2b480c22d71e58` | `7abbcfc42da2a9ed1dd3d16881357fe8d51f5adcc0e79d5b2383b932356d4225` |
| `stress-P3_numbers-holdout1.jsonl` | `d709880cc056ff772c0843b3cca7fdfd36c50717a6767fa003aa15d84dc88921` | `198d47465cef3cf04418dcf916cdbd45ea5383069322211f5087195792d3f2f8` |
| `stress-P4_ocr-holdout1.jsonl` | `a57ed5298e1c93c08ccac415c83b3844387f010dc041f2cbcf48d890f755fff5` | `1fd0ef44f1e3de789aa084a2ee19cf26a8623f16b17d5d01a629b003dde956b9` |
| `stress-P5_layout-holdout1.jsonl` | `e59f40b28a8c0aa40a11cc7e00db23873373e886ec9e53dc2d3f2ae69e936a3d` | `b901e2bcb9c10c1578f78a24995df33d4dde4d9fdbfcd3e0cb7a826240b61a6d` |
| `stress-P6_all-holdout1.jsonl` | `144da7b339240dc871b50b0a817f650ebdad82ae6cf7ca23f3c5d855d2870b7d` | `d5dfbd77347cee87d9a697d1604d7ca571f822f6778408c8c9b3dd3cb790a8a3` |
| `stress-P1_order-holdout2.jsonl` | `84f22cd161f1ddcfa429483c7fbd06a22d6ca3eba7726a9ed5ac02cbb12b6b40` | `c0e026731e24d0597960a112714340008c001d83ac54fb3aec7b5620c2486d58` |
| `stress-P2_wording-holdout2.jsonl` | `799871ff503d2a3699954effa1ca10dfbf500fc60415fd38df6ec6168305d12a` | `8b1e6fb39a428da5d18f32f5e1328c282e359bd4adc366b227c4a38232e9268f` |
| `stress-P3_numbers-holdout2.jsonl` | `ee1029c42de44dac27120767054efa06442ebf56cf8338f474f6d8a6695bf270` | `5916a8f2d7fb168a63c2aa708b1896e5aef98f912dde262bf5b52b34b9ee440f` |
| `stress-P4_ocr-holdout2.jsonl` | `6b6f2f59cb1e2ac52a884793dd8a35fbfa9ea5790083aaaeac59b0b419abac0e` | `96bc19266f7e72a39cede5714562327da0dfc36c191f55c9c43ea25f2be6b238` |
| `stress-P5_layout-holdout2.jsonl` | `2b82ef0081baea9cce5bb0973e846db37ec8f87e3e3bccdf912596333d98f3db` | `5ea4f75763f796f445718855eda8295ee076172e5185427a8a1a4442ce0d8bee` |
| `stress-P6_all-holdout2.jsonl` | `cfc1dc3c3358a5522b9daff3054486007cf0db6021986b0d5069cdd370bb197a` | `7468c5f2e25ff41834ceeb8d5544a07124838f9ebec5defc72997fdbf475bb42` |
| `stress-P1_order-holdout3.jsonl` | `2fa944bc55b8721d345cfed723db8fb467bcd5afba3a1279acbc03955b421c69` | `3849a83130a0119b8c363701746bbf5a8570a387c35d84eb1b0db82e4d8bfba0` |
| `stress-P2_wording-holdout3.jsonl` | `a38c7c218269edfb00186ee75aac2f5736cec2ea64f51bfa0c3b7065ae0fc266` | `132676ede46e0a3be588e8b036665a58c62d199ec1ddd6d30d25983de0a64876` |
| `stress-P3_numbers-holdout3.jsonl` | `15b1d8ac0bd8529b67aa47428412dc1af516176e7186ed31892631f15b84fee3` | `9606f58cfb97bf851538dd5a32c8e708aad18989508a801e69b55bb456e8ecd8` |
| `stress-P4_ocr-holdout3.jsonl` | `60989dd37b18c00412e535e57452ba7349afad164de55e56d58039c36a517d0a` | `a0b6b1cdab270032b72c4cd7c1faa6c6ac55ec0549af760038197178e40f955a` |
| `stress-P5_layout-holdout3.jsonl` | `d87b601d1fa604951abd2212190754e56373a13fbfcfb7942e97395145656eac` | `6bd6bdb95345f3c1e98304d724e59162007de52605d7ad90bab7086db1ade23b` |
| `stress-P6_all-holdout3.jsonl` | `6ede0f32823135b5cb1fddefee532b5e8e56029eee6ee0f294f920922c00594b` | `186a9f36f7acbac379cb3d94cf96e1b8027ed8e4dbb1854bfe3da8f7b36b0e89` |
| `stress-P1_order-holdout4.jsonl` | `c49d867323ea6d0643dc65ed106f1e5e96eef3e2316666e202d84055a9ff6cfd` | `8bd42b9a37000f9f4caafcf9b1486814d41449062d5f44b9f2e410eb60d46234` |
| `stress-P2_wording-holdout4.jsonl` | `260862e1a4dcff1bd7bf4305654505254aac79bea3a27b8834977c2779b17ded` | `88417ae7242d1a3b03d45cc88ba7940e2e0652e3d106e6c31e6515adc185fbb3` |
| `stress-P3_numbers-holdout4.jsonl` | `89840fe1099f12097f8df76f49edf539d03630194936c77f6c68e261f339932a` | `895ac21f841869ae78a232c38f282634b14e8bc6a6b9c69cd429929f3c8eb21b` |
| `stress-P4_ocr-holdout4.jsonl` | `f6c9f2a6876486bb9d77370071a92dc8ca1d67bc78cb72b59a6391e5c909004d` | `e38ea20c5619044ff8a97394776c62f42b724cfde6796a801495301e9dd1c501` |
| `stress-P5_layout-holdout4.jsonl` | `b8310b126f80f8d958ef98724bee8986f24865fb3f1a6cff94c66a7f3d6ec137` | `265edddbdbd4f5b191d6d90aed4b4da7a4aee8629fbd831d259fa88245f9ef7a` |
| `stress-P6_all-holdout4.jsonl` | `f081a727f63520ad9e9a98bf9ad10965d028cfda14afcf831806cd1a145b2868` | `2001a9bbfe575514f42a084ee9cb91400010a8bc1071129129a322b9be100bd8` |
| `stress-P1_order-holdout5.jsonl` | `4ab7de62a2c4d993c8d42c6071f6f60e61b3c860f04def7dc3e1032789bd3e83` | `775e12949af39e046a53c28eeccc638bc4903fe07f37b081747fc33f5909941e` |
| `stress-P2_wording-holdout5.jsonl` | `d630b8eefab7deb444aed462d269cb4f16843611aa959d01f2b149fbf34a354f` | `62ade72effebd2013c31ddecd91d45dcd326f6a4a2f7561f9e0925bd0b6ce450` |
| `stress-P3_numbers-holdout5.jsonl` | `5dfc3805f31c436cd995f3521868a84d1297143887541921a48e3622d2591f8f` | `caa08a6cdb82505d3e2c5c137fe211c0e44d81247429f56956f1d881830fe089` |
| `stress-P4_ocr-holdout5.jsonl` | `d5696a0c02e5c499eae46f014f5d5e3de284d65b351580453ceb885dfb61fdcf` | `4f79be155ea02ad49ef58c1ef17a241f52df0c87714f791e35fc6fc868a9222d` |
| `stress-P5_layout-holdout5.jsonl` | `2270fcfe10b9683f49f7442648b1337a165bda9e83d288c179453e3bf2a8266f` | `2a10c8f5d6cbcab8a7eb5b58e70c0f5f976f4571e4b2d59114b802f823eb9f7b` |
| `stress-P6_all-holdout5.jsonl` | `2663b5df7a22deca62530218931c52a3d8ad0c9bae1450f320985422cee598f7` | `d05e2f86f3e288344c28bbad06ed66bb8636aebf020d3e765efc7bd97cfe5a24` |

## Eleventh amendment, 2026-10-14: re-banked, digest only, after the verdict door held ap-threeway@0.3.0 to the line recompute

**Why.** The same day as the tenth, one file of the AP pack changed: `src/ap/line-math.ts`, the check the book and the HTTP service run
on a recorded verdict, now holds an ap-threeway@0.3.0 verdict to the line recompute it already held 0.2.0 to (the CHANGELOG's 0.7.2
entry). The check reads recorded verdicts only; it decides no bill. The digest moved from
`5fb35b2610c373b7c80ad931406995837b09f9e6a6a11277bc7ce96ff0a46973` to `70cba0d1d3913cfe324c49da2c206cd38bed35aabc705bb1c005e93523ef114d`.

**Nothing but the digest moved.** The protocol is the fourth amendment's. On all 3,000 rows: 0 decisions moved, 0 reasons changed, and
`checker_sha256` moved on every row; `engine_version` (0.7.2) and `ruleset` (ap-threeway@0.3.0) did not. **0 wrong of 2,755 decided.**
A fresh run after the re-bank is identical, 30 of 30, and each of the five runs exits 0.

| file | sha256 after the tenth amendment | sha256 after this one |
|---|---|---|
| `stress-P1_order-holdout1.jsonl` | `a6b0ff3ebb44c5552e7b4ecd62f9de7bfbf059dff690990d560f3e91797dbba5` | `c4e03ee6ccc94b0ff3fef454f46b4f4241e600cd3640e5354d59c16ebd6cfdad` |
| `stress-P2_wording-holdout1.jsonl` | `7abbcfc42da2a9ed1dd3d16881357fe8d51f5adcc0e79d5b2383b932356d4225` | `43dbcb29de466a17dea471841d4e2305d7feef7e7918aa42054ab0bc052f943a` |
| `stress-P3_numbers-holdout1.jsonl` | `198d47465cef3cf04418dcf916cdbd45ea5383069322211f5087195792d3f2f8` | `d651b101dfa0e8164a19c445d8ac2d6333d1d1fbbc5ec6212ca083a56d658ad3` |
| `stress-P4_ocr-holdout1.jsonl` | `1fd0ef44f1e3de789aa084a2ee19cf26a8623f16b17d5d01a629b003dde956b9` | `e02ec0e7489bc25362a98045d096acce45e2b7bce6a0f235b94f7e4b7b98c059` |
| `stress-P5_layout-holdout1.jsonl` | `b901e2bcb9c10c1578f78a24995df33d4dde4d9fdbfcd3e0cb7a826240b61a6d` | `cfd9ef68bb319332905222c23077f5ae8263a9160b1628e3ed7e68180f867680` |
| `stress-P6_all-holdout1.jsonl` | `d5dfbd77347cee87d9a697d1604d7ca571f822f6778408c8c9b3dd3cb790a8a3` | `4ed01badda853cd099dd9ed77f76f874ad0dc249b9f6c1bdff15c049dae6fb89` |
| `stress-P1_order-holdout2.jsonl` | `c0e026731e24d0597960a112714340008c001d83ac54fb3aec7b5620c2486d58` | `d4b959d258160233feb0290d33ef46a85efaa2cd26482e66e53f8ea7dcbce2e7` |
| `stress-P2_wording-holdout2.jsonl` | `8b1e6fb39a428da5d18f32f5e1328c282e359bd4adc366b227c4a38232e9268f` | `90d0183de6d98106f8ae7de66b7cd61c8824024bae0e08c3c0320cbac2f414b0` |
| `stress-P3_numbers-holdout2.jsonl` | `5916a8f2d7fb168a63c2aa708b1896e5aef98f912dde262bf5b52b34b9ee440f` | `bac8b1adae4f9cc64a0877a990ac5fdf9901bc51853aab435fd456090128938a` |
| `stress-P4_ocr-holdout2.jsonl` | `96bc19266f7e72a39cede5714562327da0dfc36c191f55c9c43ea25f2be6b238` | `3a9347abe8d912b3ac8ca93d14a91d9b2ffe6f3a178142a5d1fc1170be63aa2c` |
| `stress-P5_layout-holdout2.jsonl` | `5ea4f75763f796f445718855eda8295ee076172e5185427a8a1a4442ce0d8bee` | `1e38b4a494da4d6488db06a7f9106f880a10bd9c588e73d7a0837b2b227ecc61` |
| `stress-P6_all-holdout2.jsonl` | `7468c5f2e25ff41834ceeb8d5544a07124838f9ebec5defc72997fdbf475bb42` | `f15742955b81603ebeb4442a1d0e01361cb1a3a5952c824cbca5b8d5ff261e0e` |
| `stress-P1_order-holdout3.jsonl` | `3849a83130a0119b8c363701746bbf5a8570a387c35d84eb1b0db82e4d8bfba0` | `6f9cd5470af173589dd1d7433ac5892c54cec808d0880bbe655830dd81f68996` |
| `stress-P2_wording-holdout3.jsonl` | `132676ede46e0a3be588e8b036665a58c62d199ec1ddd6d30d25983de0a64876` | `4369dfc35ed6211fbd500ba53e3b2920402de551422263f30f113e9d9c8859f3` |
| `stress-P3_numbers-holdout3.jsonl` | `9606f58cfb97bf851538dd5a32c8e708aad18989508a801e69b55bb456e8ecd8` | `fcaf863e83bde4ce84558c7f6ba1f967ade7aa792d13910fb363ccab7306ff79` |
| `stress-P4_ocr-holdout3.jsonl` | `a0b6b1cdab270032b72c4cd7c1faa6c6ac55ec0549af760038197178e40f955a` | `e94929b219f00372483dd834fa6f6dda74142f0e438be3b357927648f2d27131` |
| `stress-P5_layout-holdout3.jsonl` | `6bd6bdb95345f3c1e98304d724e59162007de52605d7ad90bab7086db1ade23b` | `4f573d176fcdab5bf163b6a512bc52226558185ea3fab839943f494f63409541` |
| `stress-P6_all-holdout3.jsonl` | `186a9f36f7acbac379cb3d94cf96e1b8027ed8e4dbb1854bfe3da8f7b36b0e89` | `8c169e7b7fade2c03ab150636961c3b985450fa42b8a29ee6c924433b38ad187` |
| `stress-P1_order-holdout4.jsonl` | `8bd42b9a37000f9f4caafcf9b1486814d41449062d5f44b9f2e410eb60d46234` | `2f2fbaea253e366e1f99b6d1231c9b2b69d4da27baefc297a00567a52b57108b` |
| `stress-P2_wording-holdout4.jsonl` | `88417ae7242d1a3b03d45cc88ba7940e2e0652e3d106e6c31e6515adc185fbb3` | `325f82339235ae007801bd1723873247bb9b06dd776bb30177feef50ea22f41c` |
| `stress-P3_numbers-holdout4.jsonl` | `895ac21f841869ae78a232c38f282634b14e8bc6a6b9c69cd429929f3c8eb21b` | `4eccacd244c7b562ff0b4080ccba5dfac1a683f4b04066c76a4efa633569db02` |
| `stress-P4_ocr-holdout4.jsonl` | `e38ea20c5619044ff8a97394776c62f42b724cfde6796a801495301e9dd1c501` | `191e929b8af163eea6a727e2208b1204566ee66ea224de2c8c9532b21ad2dfe5` |
| `stress-P5_layout-holdout4.jsonl` | `265edddbdbd4f5b191d6d90aed4b4da7a4aee8629fbd831d259fa88245f9ef7a` | `c2eb86f8b24946eae7aa7f19a04eae02017956fd30908018bd037e13018eef13` |
| `stress-P6_all-holdout4.jsonl` | `2001a9bbfe575514f42a084ee9cb91400010a8bc1071129129a322b9be100bd8` | `76995ee02e4fa45b5c87a643008ae977a22f1921fce39edf3d6a7066b007f30e` |
| `stress-P1_order-holdout5.jsonl` | `775e12949af39e046a53c28eeccc638bc4903fe07f37b081747fc33f5909941e` | `e1eefd190451208788249571e5b2d75888c73d9da7cf893c19f62b9939f914a9` |
| `stress-P2_wording-holdout5.jsonl` | `62ade72effebd2013c31ddecd91d45dcd326f6a4a2f7561f9e0925bd0b6ce450` | `add47545574e49136f043ef533e153de5363c832979025f688c9e9ecf656ea82` |
| `stress-P3_numbers-holdout5.jsonl` | `caa08a6cdb82505d3e2c5c137fe211c0e44d81247429f56956f1d881830fe089` | `833ccabd7cfa353b56206938ac59205c2b6c6f6e27a33c3f70d1ec86340999cb` |
| `stress-P4_ocr-holdout5.jsonl` | `4f79be155ea02ad49ef58c1ef17a241f52df0c87714f791e35fc6fc868a9222d` | `01a08a38c3d38f81482dd51c37bf4ab8b7c36215c65ba0f4b48bfa7a4c80c8da` |
| `stress-P5_layout-holdout5.jsonl` | `2a10c8f5d6cbcab8a7eb5b58e70c0f5f976f4571e4b2d59114b802f823eb9f7b` | `74b4f0de403a12ed91b48f31e42b087b2abe795494d27f89a08c69ab2b0eac63` |
| `stress-P6_all-holdout5.jsonl` | `d05e2f86f3e288344c28bbad06ed66bb8636aebf020d3e765efc7bd97cfe5a24` | `8ecf8c3fcb163c711d3f410bbf3095e3c2bdb1d8b661c18fa3351dc64187ab7b` |

## Twelfth amendment, 2026-10-20: re-banked, digest only, after ap-threeway@0.4.0 joined the pack as a selectable ruleset

**Why.** Six emailed bills from the cold reviews of 2026-10-06 and 2026-10-13 approved under engine 0.7.2 and ap-threeway@0.3.0 when
they should have gone to a person (the opening step of a payment redirection; a bank-detail phrase spelled apart or in look-alike
letters; a Reply-To at another domain; a vendor-name domain under another ending than .com with no domain on file). Re-run on
2026-10-19 they still approved. ap-threeway@0.4.0 reads them (the CHANGELOG's
"Accounts payable (2026-10-19)" entry); it is selectable and NOT the default under 0.7.2, so the default these rows measure is
unchanged. Its readings live in the AP pack's source files, so the pack digest moved from
`70cba0d1d3913cfe324c49da2c206cd38bed35aabc705bb1c005e93523ef114d` to `3b93e3e2ff5b375dcf9b04f36f86af747554999962e03960953e96cc11251033`.

**Nothing but the digest moved.** The protocol is the fourth amendment's. On all 3,000 rows: 0 decisions moved, 0 reasons changed, and
`checker_sha256` moved on every row; `engine_version` (0.7.2) and `ruleset` (ap-threeway@0.3.0) did not. **0 wrong of 2,755 decided**
(841 approve, 1,914 hold, 245 can't tell). A fresh run after the re-bank is identical, 30 of 30, and each of the ten runs exits 0
(`--pack products/verify/src/ap`, the lab's path to the same sixteen files).

| file | sha256 after the eleventh amendment | sha256 after this one |
|---|---|---|
| `stress-P1_order-holdout1.jsonl` | `c4e03ee6ccc94b0ff3fef454f46b4f4241e600cd3640e5354d59c16ebd6cfdad` | `38f8971ba44cd05c36aa606a00b2639d97db8fc4b31835e8ec2a8e2e6f10f113` |
| `stress-P2_wording-holdout1.jsonl` | `43dbcb29de466a17dea471841d4e2305d7feef7e7918aa42054ab0bc052f943a` | `98a6a91d2e13bee548436e792941d0b19eeb53a3b8355b42a55e49021032b90d` |
| `stress-P3_numbers-holdout1.jsonl` | `d651b101dfa0e8164a19c445d8ac2d6333d1d1fbbc5ec6212ca083a56d658ad3` | `14ff41644df3f6f3c3c71e90bdec565a076d88f7be899a6e126f7a2f37cc0695` |
| `stress-P4_ocr-holdout1.jsonl` | `e02ec0e7489bc25362a98045d096acce45e2b7bce6a0f235b94f7e4b7b98c059` | `3119f11feca729e285fa398e59eeac18a88636f748c98349364b9cbadabf34ba` |
| `stress-P5_layout-holdout1.jsonl` | `cfd9ef68bb319332905222c23077f5ae8263a9160b1628e3ed7e68180f867680` | `9b6be43cd5c23cf3cbd48761099620f0ef0f9aaa8b028ac0cde3f3382ce290db` |
| `stress-P6_all-holdout1.jsonl` | `4ed01badda853cd099dd9ed77f76f874ad0dc249b9f6c1bdff15c049dae6fb89` | `22da7591056bdd4323752dbb32b42acf2c6a153d8469b0e9da2d79b429e20322` |
| `stress-P1_order-holdout2.jsonl` | `d4b959d258160233feb0290d33ef46a85efaa2cd26482e66e53f8ea7dcbce2e7` | `01b12de3b4a65e8065c305ed4db615ad4525d094d2395df44028d684d4437076` |
| `stress-P2_wording-holdout2.jsonl` | `90d0183de6d98106f8ae7de66b7cd61c8824024bae0e08c3c0320cbac2f414b0` | `ddbb43ffd3be60b66d256ebda9834ebd004c4f61441ef7defa97d89e50fdc6ef` |
| `stress-P3_numbers-holdout2.jsonl` | `bac8b1adae4f9cc64a0877a990ac5fdf9901bc51853aab435fd456090128938a` | `376b675877bee8623f7b553597876356374ff67a7dbd24dc93560b250361fbc7` |
| `stress-P4_ocr-holdout2.jsonl` | `3a9347abe8d912b3ac8ca93d14a91d9b2ffe6f3a178142a5d1fc1170be63aa2c` | `e41eb8d2290962fc01db752522f0abda11d42c6a75db5ad1e51d5806ba8165ba` |
| `stress-P5_layout-holdout2.jsonl` | `1e38b4a494da4d6488db06a7f9106f880a10bd9c588e73d7a0837b2b227ecc61` | `bbe26e96ad25c129a5afa1ab8bcf746c400b2c6f4141bd01a8e03904dfda4222` |
| `stress-P6_all-holdout2.jsonl` | `f15742955b81603ebeb4442a1d0e01361cb1a3a5952c824cbca5b8d5ff261e0e` | `537cfb64b89aac081d61dbe24dd46b5b86b106e88c166513c89392c2ec9f3909` |
| `stress-P1_order-holdout3.jsonl` | `6f9cd5470af173589dd1d7433ac5892c54cec808d0880bbe655830dd81f68996` | `a9f0c4bc241faf4602c3abb26863ee69aec76e6e0b4a222eec6beff2e95d537b` |
| `stress-P2_wording-holdout3.jsonl` | `4369dfc35ed6211fbd500ba53e3b2920402de551422263f30f113e9d9c8859f3` | `400fd1f2caa9cf0abde6e089cc20e207af6c0182575ba852f491ce579f46c150` |
| `stress-P3_numbers-holdout3.jsonl` | `fcaf863e83bde4ce84558c7f6ba1f967ade7aa792d13910fb363ccab7306ff79` | `d9f461b124b0a89de8ae8a59c359f2382ab0c9fe38b6f023b4a71bd3dfef48f4` |
| `stress-P4_ocr-holdout3.jsonl` | `e94929b219f00372483dd834fa6f6dda74142f0e438be3b357927648f2d27131` | `747f4b60802b3ff84f516915a42e70a63608ca3ae512b047252ccddb2f64b773` |
| `stress-P5_layout-holdout3.jsonl` | `4f573d176fcdab5bf163b6a512bc52226558185ea3fab839943f494f63409541` | `c5689668a173ebc09f50347a081bda637209bee223df5882460ff8de53ede23f` |
| `stress-P6_all-holdout3.jsonl` | `8c169e7b7fade2c03ab150636961c3b985450fa42b8a29ee6c924433b38ad187` | `30c20ed124441f4930b061c430404a6cf063670e01fb98cef39677298d1b722b` |
| `stress-P1_order-holdout4.jsonl` | `2f2fbaea253e366e1f99b6d1231c9b2b69d4da27baefc297a00567a52b57108b` | `b959251936a2e675ac9245cf3cd6285550a65463e7b84bdb302cc6f043d4bf81` |
| `stress-P2_wording-holdout4.jsonl` | `325f82339235ae007801bd1723873247bb9b06dd776bb30177feef50ea22f41c` | `8cedab5079054dd922220653b55eea14a254c16be36333cc3943dc22a83883ee` |
| `stress-P3_numbers-holdout4.jsonl` | `4eccacd244c7b562ff0b4080ccba5dfac1a683f4b04066c76a4efa633569db02` | `03ed566ca3d370a068939d1d4f0db3010cda3e2c31ab7a9ad1b110404939d38e` |
| `stress-P4_ocr-holdout4.jsonl` | `191e929b8af163eea6a727e2208b1204566ee66ea224de2c8c9532b21ad2dfe5` | `e73e296b2a12bfb98808484aec635d8b452ded7a21181d09cc43f9ac1da1c4fa` |
| `stress-P5_layout-holdout4.jsonl` | `c2eb86f8b24946eae7aa7f19a04eae02017956fd30908018bd037e13018eef13` | `9286064ee5013d530378582a83c292f48ba0151ffcf6a050fe4ea791dd6070da` |
| `stress-P6_all-holdout4.jsonl` | `76995ee02e4fa45b5c87a643008ae977a22f1921fce39edf3d6a7066b007f30e` | `62932e81efede770e855daf69e1a44f3efa972efd8e8717c5f13b1ecfbc28e95` |
| `stress-P1_order-holdout5.jsonl` | `e1eefd190451208788249571e5b2d75888c73d9da7cf893c19f62b9939f914a9` | `438268de6e57a1b793622c29cf6446eca892e4450caf22ae96514b4a9d1aa895` |
| `stress-P2_wording-holdout5.jsonl` | `add47545574e49136f043ef533e153de5363c832979025f688c9e9ecf656ea82` | `943aded1fae7d0db2cc6b8a07a364140b447b19050dac1c61c32505d36e409ed` |
| `stress-P3_numbers-holdout5.jsonl` | `833ccabd7cfa353b56206938ac59205c2b6c6f6e27a33c3f70d1ec86340999cb` | `7875277d51ebff1cfafabca07ddbb2cb2b6aa758074d477cb946f57a87ca92a3` |
| `stress-P4_ocr-holdout5.jsonl` | `01a08a38c3d38f81482dd51c37bf4ab8b7c36215c65ba0f4b48bfa7a4c80c8da` | `a7c3108a672773eb9a6d43611b5d992ce6944f268a648aa66e1f18732909178c` |
| `stress-P5_layout-holdout5.jsonl` | `74b4f0de403a12ed91b48f31e42b087b2abe795494d27f89a08c69ab2b0eac63` | `5e6edd99b6dd25b717e342b5e2f46a4b36bc1820db9c29fc4f5919ff53ca7609` |
| `stress-P6_all-holdout5.jsonl` | `8ecf8c3fcb163c711d3f410bbf3095e3c2bdb1d8b661c18fa3351dc64187ab7b` | `f4fd8bdca76604378fe4a3d9c4819bafeca3691e4f45010ee91ea75e5a416569` |
