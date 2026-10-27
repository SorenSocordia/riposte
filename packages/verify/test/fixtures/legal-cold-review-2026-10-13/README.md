# Briefs and opinion texts from two cold reviews, 2026-10-13

From a cold review, 2026-10-13: a legal-operations buyer's own briefs and opinion texts (`buyer/`), and a ninth review round's brief,
opinion texts and probe (`round9/`); AI agents in those roles, not people; copied byte for byte (their files are dated 2026-10-14 01:00
to 01:40). The opinion texts are mock-ups of Westlaw and Lexis layouts the reviewers typed; they test the check's mechanics, not the law.
The test that reads them is `test/legal-054.test.ts`.

- `buyer/brief.json`: 37 quotations (genuine, altered, misattributed) against `buyer/opinions/` (a Westlaw-shaped Harborline with a page
  break, a Lexis-shaped Delacroix, a Westlaw-shaped Okonkwo); `answer-key.txt` is the reviewer's sealed key. `brief2.json` and
  `answer-key2.txt` are its second brief (not read by the test; kept for the record). `brief3.json` writes "(quoting …)" inside the
  quotation twice; `brief4.json` writes it in the citation field.
- `round9/brief1.json`: 37 quotations against `round9/opinions/` (a Westlaw-shaped Harlan, a Lexis-shaped Kessler, a slip-opinion Dorsett
  with a plurality, and a Calloway district order cited by its Westlaw number). `round9/probe.mjs` is the reviewer's probe of twelve
  designation styles and twelve lead-ins, `probe-results.txt` what the shipped engine answered; `make-probe.mjs` writes the same texts
  into `probe/` for the test (`probe/labels.json` maps each id to its style or lead-in).

| file | sha256 |
|---|---|
| `buyer/answer-key.txt` | `15cde0bf1c5c233b073cefb847160a6d18bc39286c7161526978e03684d4ffbd` |
| `buyer/answer-key2.txt` | `6d784c7750cfc475da7c821848356457cf0e4ba4e4d767c484d35d8deefe042d` |
| `buyer/brief.json` | `4eefb660e15c892247eb30f8b6ab52be27af382570419a6f152cfa3a4c456887` |
| `buyer/brief2.json` | `044c071e4ce80f82587b7430c8fb77f50a0885fcde9f76303ed5937833b87c54` |
| `buyer/brief3.json` | `2a659c736e5c34f0301bf60e6291d9e839acd5d5d31240f1099c8481d82f8633` |
| `buyer/brief4.json` | `e6ff731434df257d4f8b7cfaec0d74f8dedd9f1e01496cb5a17d2f4e18cf7d6a` |
| `buyer/opinions/delacroix-967-F3d-812.txt` | `783ef3e15170720690985d36099ce0b560d87c2eabe40905e4e7bfffa05296cd` |
| `buyer/opinions/harborline-912-F3d-455.txt` | `7775c5f952939da06bf7a6f7f87157b8d64f0b0b370902e2cd09b8f999d19020` |
| `buyer/opinions/okonkwo-341-FSupp3d-220.txt` | `3ac8b94b9cc2802667566fc973fcdf5d5381124d0c066fd62d9f06050270aa06` |
| `buyer/opinions/sources.json` | `580d4b83a23e1d7e12e7fc37628d0818f72d4e75455d087fd888eb8f8231fadc` |
| `round9/brief1.json` | `592518b043332e99131612925bbfb5853bbad53de642541fb4afddd08d4435c3` |
| `round9/make-probe.mjs` | `238d53cb6906be3bde5af8806d8d45643c1d8df2901a7faa65e798f204533274` |
| `round9/opinions/calloway-dct.txt` | `77ec0b5646a7df6cfaddf89514af24804c11c1a1ca6f40bf5e203a7efc4ba040` |
| `round9/opinions/dorsett-plurality.txt` | `54c0127b5c19b66947082120db5f9df8ce8a72ed3ccf2cd7fa3ab6967bda1474` |
| `round9/opinions/harlan-westlaw.txt` | `942574c23dc080ffb89ce497744ff3a859793f484636ed37d954402593bed08b` |
| `round9/opinions/kessler-lexis.txt` | `6e1c29b0a880149d6cd052324ed7233be290c2d2ea815e46da763606db68861a` |
| `round9/opinions/sources.json` | `ab2795608ce88cce4c2331ff3ab2bb8d917449bee7e526ebe30743dbc4411b1f` |
| `round9/probe-results.txt` | `b09d5b22e94eaf8abfd69d9f6c4855d6191694157f59c9a43594d1829461d834` |
| `round9/probe.mjs` | `fb2b7f3b195abf6f6e463319bcc8dc1f8e8be8aacc5a8b848a36af375262cd56` |
| `round9/probe/900.txt` | `26f15fd5d2f73e655f9bf1e14fb31dd80700e5d615d3f9ccd9afc82cffd84fbe` |
| `round9/probe/901.txt` | `c1d00d38a048d1438b7e692c332e51017a3960621839ea463318bce2788b62cc` |
| `round9/probe/902.txt` | `71c3968e1d8909e2e145ea808a045ddc751f6d160f2f0b005b080b93bcebc146` |
| `round9/probe/903.txt` | `fd007b1d5f9589caf6361cade49b6e68d2f5d3e59de1d6c6dce1e2e2eb9d6466` |
| `round9/probe/904.txt` | `af8d262d4a32160ad44a80d1f384b8790df13dc92173fc56247911bf31d1bb29` |
| `round9/probe/905.txt` | `1bee4782a8ab3cd89a686ba621ff931980025226a80a1ab19c2ea98e360bef0a` |
| `round9/probe/906.txt` | `bc5061f9cb4e03522de3cfdf1610161f35c3c7de6d53088ace5d5ce647e3b1ed` |
| `round9/probe/907.txt` | `5cea317930fb0ba7531a43f33efb217e7c6d5dcce6837feda573daca3c9c2a56` |
| `round9/probe/908.txt` | `a9ca17fd18b01d1db10a23edd889367a407c30fea3db74b81485cf1660ba47dd` |
| `round9/probe/909.txt` | `cbfef2e828afc2a5efe3a7ae6c0853b74acbb1fe101ec5f9999d6269db2d7fd4` |
| `round9/probe/910.txt` | `6862324ad55d8d9777dbce4f4bf3dd9d8812a1b5b0c94d594841dfd7dc5b7578` |
| `round9/probe/911.txt` | `9558c1d578430a86e847f3170a1d829e85e26c52bb588a387a372693c7f44b61` |
| `round9/probe/912.txt` | `41877965d4cb94fab03de6f3de3c3068bb47ed33f206f58a6600cd759d25cbd7` |
| `round9/probe/913.txt` | `88d8f73e8b6a9c6e553d41a9e2b8ae23ab3184210e0bd7c9a69115ec917fbcfb` |
| `round9/probe/914.txt` | `bbf04bcbecd66722bba1d604750333c22fbf027ecd52e7a746bbe32b00f483da` |
| `round9/probe/915.txt` | `43604deeb5751fad215a5dddbabed70bf2168f041290cc0e565d4044b9ef4753` |
| `round9/probe/916.txt` | `0c080977a8c7ae85f09343f5ab221c86d0b5a1b29c0049b1e406db20b1d06a1f` |
| `round9/probe/917.txt` | `8b8232b3593ccf5459a8266e427c4a041674277551a21f6d645c5cf5800a59fd` |
| `round9/probe/918.txt` | `0d61d3323c61057953840bb57a54c91e4777c598109c286b0485f9353b11f4f9` |
| `round9/probe/919.txt` | `b3d05021604eab2e909db6ffa8b4663c1836dbb6c9d53f04f113f572f8ba8c93` |
| `round9/probe/920.txt` | `92a76581cc56c5e748bb270dbb88419d2872430649a5b953189be594cdc8141b` |
| `round9/probe/921.txt` | `b6626bce47b72cf8f15ca74f0a0345c55581671deb92ecf5b9b3cd62d201098b` |
| `round9/probe/922.txt` | `8692e3cfe238d2953726ef2e9b87c2623c49c1ab1f1e69d0d8eecc88a17dc773` |
| `round9/probe/923.txt` | `f93326e2e521dfaa0f4ffa95775a8e5ea04e08f24ec0c5da7121e408e019b3d6` |
| `round9/probe/brief.json` | `681358bdf7b069c6c33fd1269dd8b3d11f837ca560852054d5dc2a86ec80e8d5` |
| `round9/probe/labels.json` | `64e52969b3d478fb9b28b19adc1f6bc74ecf0ebee50049d463d76479511546b1` |
| `round9/probe/sources.json` | `93cd47ad4ee41701c2bf9c01d07a25b8d5d50ce6b984f2487fda3426cce17fed` |
