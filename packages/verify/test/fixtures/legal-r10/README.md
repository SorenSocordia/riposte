# Briefs and opinion texts from two cold reviews, 2026-10-19

From a cold review, 2026-10-19: a tenth review round's brief, probes and bracket briefs (`review/`), and a legal-operations buyer's
briefs (`buyer/`); AI agents in those roles, not people; copied byte for byte (their files are dated 2026-10-19 18:01 to 19:05). The
opinion texts are fictional mock-ups of Westlaw, Lexis, state-court and district-court layouts the reviewers typed from memory: invented
parties, courts and reporter-shaped citations. They test the check's mechanics, not the law, and no layout here was taken from a real
download. The test that reads them is `test/legal-055.test.ts`.

- `review/brief.json`: 42 quotations against `review/ops/` (a Westlaw-shaped Marlowe with a ligature, a page break and a concurrence
  "dubitante", a Lexis-shaped Pellham, a Lexis-shaped Fennick whose plurality is stated only in its "Judges:" line, a state-court Carrow
  under "OPINION ANNOUNCING THE JUDGMENT OF THE COURT"). `expectations.md` is the reviewer's own key, written before the first run;
  `run1.txt` is what the shipped rule answered. `brief-brackets.json` and `brief-ins.json` are the bracket probes.
- `review/probe/`: 19 adverb cuts ("are . . . enforced" for "are rarely enforced") and 15 separate-opinion designation styles
  (`styles.txt`), one short text each under `ops/`; `run.txt` is what the shipped rule answered.
- `buyer/brief.json`: 67 quotations against `buyer/opinions/` (Westlaw-shaped Harrowgate and Ostrander, a Lexis-shaped Quillon, and a
  district court's slip copy Fenwright); `labels.json` is the buyer's sealed key (`labels.sha256`, sealed 22:58:40Z), `run1.score.txt`
  the shipped rule's score against it. `brief2.json` runs against `opinions2/` (an "Opinion" heading added to the slip, and the
  rejection sentence worded as the manual's example), `brief3.json` against the three judge-line variants in `opinions3/`, `brief4.json`
  against `opinions4/`, and `brief5.json` ("(citation omitted)" over eleven rule, code and Restatement forms, `brief5.forms.json`)
  against `opinions5/`; `run5.txt` and `run2.report.txt` are what the shipped rule answered.

| file | sha256 |
|---|---|
| `buyer/brief.json` | `20a77590f0f0446476da4c18bfc0386b7616b701324b3f4e2c922c741c64f13f` |
| `buyer/brief2.json` | `24b467fa9d516bcfc57923affc1c504d12091e76ff5ce2f3030879f77a94e064` |
| `buyer/brief3.json` | `3a64c4409726376fad75b36567ed442f94d4b1d2396361736d36bd19f3263338` |
| `buyer/brief4.json` | `0b13b7057413d91acd69af2bfda913b968488e068b54046ba511d7e54e920be1` |
| `buyer/brief5.forms.json` | `5121ef5b85b5379b2e536ea056f260bd9e638003360f676fdb5ef01e1ef3d2be` |
| `buyer/brief5.json` | `e656da88b60b804c418ec50bac3ac6b89efa05730231ee57df1819bcbc711055` |
| `buyer/labels.json` | `b301b96de4f7f2c037ed26d5a44ca18605f5504b3d4d1a32b5687d937da2c42c` |
| `buyer/labels.sha256` | `06a923f28f076c944c46ad1ac98a34274fce15494d4af47da7d3a8778ff55e2c` |
| `buyer/opinions/fenwright.txt` | `ebdad8bdbdc15bfd4c4eb671d1e0c6ea76a88736d23973b12d56450cc458600a` |
| `buyer/opinions/harrowgate.txt` | `d9db176a5d607eb5e6d713363492d285e893d8f7c5680711346ae7d15ccee0b7` |
| `buyer/opinions/ostrander.txt` | `a0065ca416f229b4c103cb5ebcb023a2182e634ece35ee021ae9ecb269508d8e` |
| `buyer/opinions/quillon.txt` | `09a9ad4816e4f097e3add425f3967ccecee906224e7a6b879e98deb81926781b` |
| `buyer/opinions/sources.json` | `31b00f1fff018c2ce5a228b048df002b016f325db381d6ac11635552c607dd1e` |
| `buyer/opinions2/fenwright.txt` | `5c9dfa422866af132b9d83c976789bd1c7478b78a3c140bf735b578648042632` |
| `buyer/opinions2/harrowgate.txt` | `d9db176a5d607eb5e6d713363492d285e893d8f7c5680711346ae7d15ccee0b7` |
| `buyer/opinions2/ostrander.txt` | `a0065ca416f229b4c103cb5ebcb023a2182e634ece35ee021ae9ecb269508d8e` |
| `buyer/opinions2/quillon.txt` | `4625b02e61b7221afa63acbaaf20e9920955d3788d9afbe5ebac0b5ec5d35dcd` |
| `buyer/opinions2/sources.json` | `31b00f1fff018c2ce5a228b048df002b016f325db381d6ac11635552c607dd1e` |
| `buyer/opinions3/a/fenwright.txt` | `c0d6bc7c64adb67014c3f755987a2bd734b59e981b9aa6fdf2e2475deabcbf87` |
| `buyer/opinions3/a/sources.json` | `adedbb8c48cf88799076c41fcd3736879bce5065bf2cd3ee0a0626ebdaf691c6` |
| `buyer/opinions3/b/fenwright.txt` | `39c2bc0b5e453f484adcfebae92bb162f5c2d394e5b0fc1e33b2bd6836dbd6de` |
| `buyer/opinions3/b/sources.json` | `adedbb8c48cf88799076c41fcd3736879bce5065bf2cd3ee0a0626ebdaf691c6` |
| `buyer/opinions3/c/fenwright.txt` | `dc70d67bb6e8935866bcde99a69693a2eeb19fa07a51dc13402251607675aba6` |
| `buyer/opinions3/c/sources.json` | `adedbb8c48cf88799076c41fcd3736879bce5065bf2cd3ee0a0626ebdaf691c6` |
| `buyer/opinions4/sources.json` | `1b66e0041fccecda9f3e62cdb4dfeef06eb2d897cd4a1fde68f8d488f4a0db59` |
| `buyer/opinions4/tessaly.txt` | `6652371eb6deeb6581369c8f074a5b98b8e11fc1013526e7c8a853413dd7db4d` |
| `buyer/opinions5/o0.txt` | `6347b6d1b8638066596591c587d13864d96ac1828e2e326e121cde29d49d5bea` |
| `buyer/opinions5/o1.txt` | `0b49b20ba898b3af73d8f6b992bb9431421506516fad33af32bbfd87e7f1c7ea` |
| `buyer/opinions5/o10.txt` | `77b39df93b7d1a0894b232a7473b40513dd6f3f0b639923353493302220ced64` |
| `buyer/opinions5/o2.txt` | `4fb35a4c07f2e860dc8e70c0cf1b4707f42de28e9074713256d053cac71e9642` |
| `buyer/opinions5/o3.txt` | `1d12d5737c9a74763e7ce9e83b791a3e2ced1aa0612b84b696f5ac7f6e961e81` |
| `buyer/opinions5/o4.txt` | `004e5529c871dc2a565a3a5c60c346454fea3fd5a4385d165f4d92f2ee1b7f18` |
| `buyer/opinions5/o5.txt` | `794350167fee1cca82ed956637563c67c9648cd2abed2f3d171891b5bf8b8911` |
| `buyer/opinions5/o6.txt` | `2d41154007ca77353c58576e7887cc6724d41a75f8201d2e3947eeed72f15d04` |
| `buyer/opinions5/o7.txt` | `6a5cfc3f7d99f442abeabf482b40b3e2f8900ead91f0c53bf52ad23bae47dedc` |
| `buyer/opinions5/o8.txt` | `08e4b7f731b1283370eb5a3595c7a3aa92756a2e827cd89fc199d074158faf97` |
| `buyer/opinions5/o9.txt` | `cb74eadeba9b421bcaf1fbe63286eaf3e538d680fc462208b0b692cca43ff95d` |
| `buyer/opinions5/sources.json` | `4f49b028e73d3152476f199a6ca4328d8e91f39ff50b7ec8d74dfb4bc968cdb8` |
| `buyer/run1.score.txt` | `5344a2c70956638760dc40fa7c7e02fc569acdd8ec0e0e39a6b9beafe93902a4` |
| `buyer/run2.report.txt` | `a2fca1371ce478bfc56b0633fa046d475aab45eeea61b6f5deb786a10ac048d1` |
| `buyer/run5.txt` | `dccbd564dd9bd09af098753f41621fb45f424d02712b44c731ad75e9b5babbdf` |
| `review/brief.json` | `2fd65ff1f2fc54dc5c8be8eb5a10b2123b8a618f926a210edad1f0822ce6de69` |
| `review/brief-brackets.json` | `70bcb8ea862335b244ee7e82f2fbcbee2244435307f2eaf2563e87a7d830c692` |
| `review/brief-ins.json` | `a151132878832d72ec970d8fffeb5343c264d59cca680e9fd3fc87a65b96fde0` |
| `review/expectations.md` | `fa573e1b539bb2f399bdefa3fbbbce20a6188c967f35a543bcc8d040199692c7` |
| `review/ops/carrow-wl.txt` | `bd3a0b79146549dbdfab8a9f43ed5f5f96f60ff26e2b0e5c34e7a4a8ba526a55` |
| `review/ops/fennick-lexis.txt` | `11c6c88724a943c753e2e3da7998302afb3856c90f11c2920d83c332cd652670` |
| `review/ops/marlowe-wl.txt` | `d05e2b001ece500800a3cc8a2596f72c4eb433fff427ad9e963979d145d8d5f4` |
| `review/ops/pellham-lexis.txt` | `4c3f90c53f3416bbee2b0c4642728115806187b0b33563d370814bbde115f082` |
| `review/ops/sources.json` | `261961e25b1f623a79c3e7201e66417ca6e8173407a90d699f63d03f60783d2d` |
| `review/probe/brief.json` | `18063598ee6a538476750be9daab8574eaa0bdac605c9c5e5471b46caa118630` |
| `review/probe/ops/a0.txt` | `cd762ec58cb5c22968a60f971d7626a662d4d2179cf54cb7ff8d24a72bb3e683` |
| `review/probe/ops/a1.txt` | `2e2f74d6e596bf1a42e8c23b8a12451f0ff5a354d084735591852b11922bec17` |
| `review/probe/ops/a10.txt` | `9afb2df6b5108e49422025a54a53cf00bae79e5ae0804c9b33fe97e33ce77f4a` |
| `review/probe/ops/a11.txt` | `286089a101b0aa78807af108e13dae833836254c417643b790d87478fb9fbc7d` |
| `review/probe/ops/a12.txt` | `6a76fcef0e4495a675876b8fa20e74573be14b45992f24206e29f09de5ada83b` |
| `review/probe/ops/a13.txt` | `81e2e3d19c9c4a2f684601819dcb68b5f201ca917555c38ac63092fd0ea2de04` |
| `review/probe/ops/a14.txt` | `b5e1db5219bf5471bc4a368dfc20c9a8e0d5f014a791abb77727a879309692ba` |
| `review/probe/ops/a15.txt` | `684141ed590cdf467c10ec6ff1fd23445b1a3698031e1123b76376ad86b678d5` |
| `review/probe/ops/a16.txt` | `63ddf2676be632820f62fa0595ace0e1a2798dd6ae858a89fbb076c77fbe9c00` |
| `review/probe/ops/a17.txt` | `9a4dfbcdc1add890999a32b09d328a078bf579eef850d2a52ef774eef16e22a9` |
| `review/probe/ops/a18.txt` | `4f16bacd76a922815d39900fc67a3efc9a14d7d86f58936739173d37916da6f7` |
| `review/probe/ops/a2.txt` | `618f68e1a7ebf71b90a123019102aa62c8e9360f4baffd2fafe3e6193ad24bbe` |
| `review/probe/ops/a3.txt` | `4d1e99909fbe1a092b5e56508fec3cdea972acaab7d5c2d3f661e12a224bee46` |
| `review/probe/ops/a4.txt` | `b95ffab262b1253a1cdbf6bccf475b2784ba1c3faacab10aa92d4ca2b3f86edf` |
| `review/probe/ops/a5.txt` | `1d005d494be1ff8cbfaf5645fa08d3dd830d595be1e5cfbc390922217e622853` |
| `review/probe/ops/a6.txt` | `a5c38ef4901ed571b0112a7978871dd986af71d4c15286b783fcdc78eca24705` |
| `review/probe/ops/a7.txt` | `422572dca653dcdecaafca56c07d7f1f0e133c4da124aba2bff86a8de3a60f4e` |
| `review/probe/ops/a8.txt` | `8cfdedfaef931cf061fd09707c16c1bd34afaeba5572f7cef9cd2cf0abf87e65` |
| `review/probe/ops/a9.txt` | `4595d41b2c740a792b01374502a2e272828f28da526eafcdaf5c84b2445b29ab` |
| `review/probe/ops/s0.txt` | `af6cbd3fc3ba568a647c49971c05c859b232a51c1fdad1e8d547c5a90c9d3d62` |
| `review/probe/ops/s1.txt` | `d066db1cd18ff5de972d45e2aa1097c8d324f3edbf41d68be673bf42a0ccb934` |
| `review/probe/ops/s10.txt` | `91f93cec5a3cf2787753ab90864775ee520d8d126b6634b2370f3d1ff35b6abe` |
| `review/probe/ops/s11.txt` | `4b5d60b2d58f1f0f3f813afb669b0d8252c339a77052ec9e8d83ce493373dcd3` |
| `review/probe/ops/s12.txt` | `72eab07aa395a7b0d5a874ea821b52f0e5158c93b1c9e7f6bdf6f1e855b410e0` |
| `review/probe/ops/s13.txt` | `9c95bfea0088a7ebbaeaf5a27beacffcb4b0090720d4b9853eb111dd00e5a29d` |
| `review/probe/ops/s14.txt` | `4f3816b763de7dea26c049ebb386234b9c2b82df2892691b54d9eaa1ecbea384` |
| `review/probe/ops/s2.txt` | `aef308cdf88e16a64507c02ac9224d18604c45a9adbc76d3dc265385f888d39b` |
| `review/probe/ops/s3.txt` | `84796108e8c3a60e2b56968ecdd7c547db09473fc2d35ba1da071a741221b090` |
| `review/probe/ops/s4.txt` | `329208e3ffbd8d4ae0e509fa3d151cb4d3383032c037b4af5cc874d9380dbb2f` |
| `review/probe/ops/s5.txt` | `a13ee644253e99ced17386e4e03e5142ea2bee1ce92c1db734f07aab1f951d00` |
| `review/probe/ops/s6.txt` | `8e343f27227461c7db33b9eaa7442e42e380d5b51dc36872c090091ce2490294` |
| `review/probe/ops/s7.txt` | `4885675e3549702795f3444177a6ec31dc5fae4284a514c022fbcc0bf326b5ea` |
| `review/probe/ops/s8.txt` | `377039649978ad53545dac39987d0787f76e64e74caadd74b097f1a702420362` |
| `review/probe/ops/s9.txt` | `036309c1c32abe72a0a17855a6bcaf385297b960c66d4fc317e25c12f230e9b9` |
| `review/probe/ops/sources.json` | `1d65444ac5202cd5daa429ae15e443eb51b2691d8cfcf86d243119577d5d6827` |
| `review/probe/run.txt` | `438190715815220ffb374cb08854c6464a6d018e6c12cdd6cb74d40bd4f66b69` |
| `review/probe/styles.txt` | `61f3d0013e0198598b8e4b64b9887421484a8d6f1f9bbc70d7ca30aa26b64a9c` |
| `review/run1.txt` | `588c78976d7c650f871e2e6d46cfb3e572a1bd7bb5723da3ad95f852cd66a1ac` |
