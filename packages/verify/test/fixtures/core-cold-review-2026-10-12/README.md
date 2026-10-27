# Replay and server fixtures, from a cold review, 2026-10-12

Copied byte for byte from the files two cold readers (AI agents, in a security-minded engineer's role and in a reviewer's
role) wrote while trying to break this tree on 2026-10-12. Nothing in this folder was edited after it was copied; each file's
sha256 is below. The tests that read them are `test/replay-carried-keys.test.ts`, `test/replay-order-and-folders.test.ts`,
`test/http-replay-exit-host-charset.test.ts` and `test/invoice-explanations-in-words.test.ts`.

| file | what it is | sha256 |
|---|---|---|
| `b-extra-top.json` | the shipped legal bundle CT04 with a key `extra` added beside `verdict` and `inputs` | `552847dc528933e75f648065a8c3842ac491f5f3b297576c39b58f38fcb7a536` |
| `folder/b-extra-top.json` | the same file, alone in a folder (folder mode) | `552847dc528933e75f648065a8c3842ac491f5f3b297576c39b58f38fcb7a536` |
| `b-outcome-flip.json` | CT04 with its verdict's `outcome` flipped (a divergence) | `a2519be774d43fd1f06076863168c95b23f2c11da70bca72a51d32bff83421f9` |
| `verdict.json` | an engine 0.6.0 verdict on `invoice.json`, issued by the reader's build | `e796d655405c4c74b78ce7563961077cae464724b3890633f224005e2f1f60f8` |
| `invoice.json` | the engineers' door example the verdict was issued on | `cf8ca968c26a0a57b79edd06012ba40dad5b4760884ed5a01b6a81cadcbf5404` |
| `env-pinA.json` | `verdict.json` in an Ed25519 envelope signed by test key A | `a98ac3a9d183f5e4852c2488f2dad628ad05904df6d41e6dbd2dad368f5a0521` |
| `env-extra-top-pinA.json` | the same envelope with a key `issued_note` added beside `verdict` | `847c12631c811fa2cee39abf51c9476fb827a4942a59f345f86225105fb4a8ac` |
| `a.pub.pem`, `b.pub.pem` | the public halves of the reader's two test keys | `d9c0cc17…bfe` (A), `4adcb898…0cba` (B) |
| `x23-inexact-payable.json` | the shipped e-invoice extraction with `payable_amount` written as `9007199254740993` | `2358f54931d77032640ff57758b395b4f2903b13e7e4e4e2c4aaddefdd41785e` |

The two test keys sign nothing but these files and prove nothing about any issuer.
