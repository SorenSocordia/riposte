# Emailed bills from a cold review, 2026-10-12

From a cold review, 2026-10-12: a controller's own emailed bills, payment histories and one pay application, copied byte for
byte. The tests that read them are `test/ap-emailed-bills.test.ts` and `test/pay-app-payer-role.test.ts`.

- `t01-clean.txt`: the clean bill (one PO, two lines, a remit-to post office box). `t01.json` is what `ap` printed for it then.
- `f01`-`f12`: the same bill reworded to redirect payment, sent from another or a look-alike domain, a display name shaped
  like the vendor's address, an item that is not the PO's, or a labor line. `-onfile` variants put the vendor's email on the PO.
- `l01`-`l06`: legitimate variants (printed ACH details, an added surcharge line, a second partial bill, reordered lines, tax).
- `d01`-`d05`: the same number booked, a suffixed number, a one-digit Subject typo, a rebill.
- `hist-empty.json`, `hist-paid.json`, `hist-partial.json`: the payment histories the bills were run with.
- `p04-shortret.json`: a pay application retaining 5% on one line without saying so.

| file | sha256 |
|---|---|
| `d01-exact.txt` | `c783ddf925596fb0a54e039c2374ae7a3825dd2ca08ce00643af0f2c94f273e4` |
| `d02-suffix.txt` | `9cc39fc55de866a23a2a2debabe23c2d310c66644aea7004aa73dd4d5832e81c` |
| `d03-subjtypo.txt` | `680e509c96fe5241514f05bb7fa6886f358fe695093c2332cffe5d9871c32de5` |
| `d05-rebill.txt` | `f39b11dbeb1cb5392ad20a7324c0a42be5ac2ae8b2c06b0855155bfb4e10e9f2` |
| `f01-factoring.txt` | `b5fbaff519ccf6ca4eae0c3c8018f8281a8510915a48da743581612acf798066` |
| `f02-attached.txt` | `42cebc26d06ec196efb80dff4bc723081ddfc1fb6be5a81a7e30b8afa02d31f0` |
| `f03-callus.txt` | `5de6c7299268d9fdd53f53bb68415b474c89867da2615b32df0dd370a4053784` |
| `f04-newaddr.txt` | `2de238451e07bbab272410eca3529c62897eab9f6b39def2b1714634f97466d5` |
| `f05-lockbox.txt` | `fdc851b89125bb4f58bda7603edf778ffa956ea970e0751e7f37c5f1e3f8487b` |
| `f05-lockbox-onfile.txt` | `871146dff66b909201ab6602d6510b9d3f175cfe0fc7e2d07fc038d722c84847` |
| `f06-portal.txt` | `1fb81759c4046827c3112fc1d74a4213473307f4e0a8c3aba2e0abc6aec5afac` |
| `f07-otherdomain.txt` | `70df4586fdb6211241684793a6974dd2fa0d6aac0b2ef75372cfa7e01e811658` |
| `f07-otherdomain-onfile.txt` | `d4c05834697c81817075f4bd21c59710b318b73212b0c2cb9d34ccfb9d2917ab` |
| `f08-displayspoof.txt` | `1b7c5ea605b7927a2be51423bee78b657296173add401e12d2120161fe9f7062` |
| `f08-displayspoof-onfile.txt` | `d97f4e6916187d806392c79950e2bed5502d4ae824ed04db314bc16112682635` |
| `f09-plural.txt` | `8caaf946d7ee198c658b6024aa5a5813f7ee191e104c2ffec392c102448c2b1a` |
| `f10-hyphen.txt` | `41281c051778f4262716cf52d309eb816966803adb9fb88b775d1068dd899232` |
| `f11-wrongitem.txt` | `3ac5cfccd4e22e1277627c812ab0e033cc7ba1bc4a1d3019d69875518a30dbc4` |
| `f12-labor.txt` | `e77fdcd70196b80423e691da98e2a832f9dfddc0eda1bc00ebcf767722944b03` |
| `hist-empty.json` | `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570` |
| `hist-paid.json` | `10f897e9c337222c6b5a9a08dd04d62f452b43281d2fc75735a12b03ea6bff25` |
| `hist-partial.json` | `836c2f0d1ded3172a9f3dd31eb80d78811fce4e0334bcd031e9fcd29d5948629` |
| `l01-achfooter.txt` | `58107ac9d8494fbaa1f68380f8c6655eeaba568f0773296e47778bf1b4d6301f` |
| `l02-extraline.txt` | `6e57d248c5a2267b7128a7d6358875f367c8871b3696df7c0ff0173b96ecc9a1` |
| `l03-secondpartial.txt` | `f39b11dbeb1cb5392ad20a7324c0a42be5ac2ae8b2c06b0855155bfb4e10e9f2` |
| `l04-reordered.txt` | `fe9d4b3f984d76d641cb1fcd19e25475657af274b8e9de219aa354acd8b5dc6f` |
| `l05-salestax.txt` | `b7df0cf58c46c5601a18e7879a247ced0a62f6b7080602b97ecb89daacbdca03` |
| `l06-tax.txt` | `e0ef7f1b1d9dab8022b4ff77a536d9e9c2a7fa90dcb15a477b0ed8e1b04a6bab` |
| `p04-shortret.json` | `0560721daae7b240d11b032c878531ef4ae4a499bca20c0a5b7fed3adea64f30` |
| `t01.json` | `49cb8f8d49f0f85ed27ba85213c2ea4e54cda8eb1a64a0d80c5e1da859125753` |
| `t01-clean.txt` | `c783ddf925596fb0a54e039c2374ae7a3825dd2ca08ce00643af0f2c94f273e4` |
