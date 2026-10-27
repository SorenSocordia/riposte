# Briefs and opinion texts from a cold review, 2026-10-12

From a cold review, 2026-10-12: a legal-operations reader's own briefs and opinion texts (an AI agent in that role, not a
person), copied byte for byte. The opinion texts are mock-ups it typed from memory; they test the check's mechanics, not the
law. The test that reads them is `test/legal-053.test.ts`.

- `brief1.json`: 36 quotations (genuine, altered and misattributed) against `opinions/`: a Westlaw-shaped Twombly with a page
  break inside the opinion, a Lexis-shaped Celotex, and public-archive layouts of Bazzle, Rotkiske and Daubert.
- `brief2.json`: 8 variants against `opinions2/` (a plain and a joined dissent designation, a shorter running header, the
  district court's opinion keyed under the Supreme Court cite).
- `brief3.json`: 8 separate-opinion designation styles, one per text in `opinions3/`, made by `make-designations.mjs`.

| file | sha256 |
|---|---|
| `brief1.json` | `636f700c9fa72bfc50d04f7c4e201bc30a1f9a322c2c041b49e9dbfbe9feebf6` |
| `brief2.json` | `f4183f42894c66f24ea5cc8508982d461bbd6881dbf8cf9ca233432cbf07b376` |
| `brief3.json` | `6e6793b73e17713c55bc9a59d409e194599a5ab44ecd23d126ce4ac058d22609` |
| `make-designations.mjs` | `c9a9bbee7b885cbd099bbad8595bd3efb1e77fff808ccd6489517cf2cf5b1ce4` |
| `opinions/bazzle.txt` | `a296af356109ec6807f36b4104314d8ead14378ad2cda096314891d70c35804e` |
| `opinions/celotex-lexis.txt` | `9438168c70aa17a5797ffd6668a795dd32a6fddc3d3fd3e545a9393407a877c6` |
| `opinions/daubert.txt` | `59f428159f4287a8b61995a79d33eacfabe7bc85811d435646429d5b6c4591ab` |
| `opinions/rotkiske.txt` | `a33dc89ab345720ddebf3e4972351ef8258d8ec32db5be8ed270e23e15039fd7` |
| `opinions/sources.json` | `ac7281ca9951655dbbe5309019384b5f5d65f0daaf5ea50550e887ee126984bd` |
| `opinions/twombly-westlaw.txt` | `32fbbd7546b0d9a1637088cd834bd8cee8fb586a8fea367a14e681a83d955309` |
| `opinions2/sources.json` | `06817ace20c05e2ea88d888101b013c07993ed6f15b00681232e669158c208a1` |
| `opinions2/twombly-district-court.txt` | `9aa32740f4e0496f0b28f386b08a7ecc0eba78494248fddd9173800039e3368e` |
| `opinions2/twombly-v1-plain-dissent-line.txt` | `4461210306034ae30e661418d9436befcfdc0cdfabfb27e499d882131d181be9` |
| `opinions2/twombly-v1b-with-whom.txt` | `6afec2a24f76bb3204cae6eeb5ddd935b04089d4237454dc89dba3dc293c1e81` |
| `opinions2/twombly-v2-short-parallel-no-Bd.txt` | `af5046cf2f4f28c301aa5ddb15b881ff94566b25da8e84dc9acdcd206262d657` |
| `opinions3/desig-A.txt` | `6e186bd7e1d107daa49d1fb7ba3cd9527ba6f5f2c0764c84b8d5e30f1af2e851` |
| `opinions3/desig-B.txt` | `353ffd709178dcd064314482b34c741f72524adb31ceb726424d97b86184598c` |
| `opinions3/desig-C.txt` | `2c3654d513d3ca5bf36feadff353a37d9c155e09bfeece3d5abf3468131e1fa0` |
| `opinions3/desig-D.txt` | `bc59a5b56e96186a279634e324ac655734cfd6a5aeb9bc309676bb079742ec8e` |
| `opinions3/desig-E.txt` | `5578a0fd7e85468b72fdb196dff872720c16d1bfb12db0ada50d059127bd300d` |
| `opinions3/desig-F.txt` | `0606954e166794eee2c2834b85ee5fe71eab4ad0076c4e99a857ce92b626a90f` |
| `opinions3/desig-G.txt` | `4f48b09a97c193d65a651c14cf0dea2256ab6c43c92779a11cb6ff9c09cf69c2` |
| `opinions3/desig-H.txt` | `b6251c4a2317d5b74c4f41bce4e610f1bdd3db7a4a8a6467d8919524017adf7e` |
| `opinions3/sources.json` | `86d88391333e2a35200bc45d75e5cf0a658d493ae42017994e0e3bdd339b63a8` |
