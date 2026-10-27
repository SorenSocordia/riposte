# Emailed bills from two cold reviews, approved under ap-threeway@0.3.0

Six emailed bills a cold reader wrote in the role of a controller at a 60-person mechanical and electrical subcontractor,
with the payment history each was run with. Every company, number, address and person in them is made up. On 2026-10-19,
under engine 0.7.2 and ruleset `ap-threeway@0.3.0` (the default), each was approved, exit 0, by the shipped command:

```
node dist/cli.js ap <bill> --history <history>
```

The reader expected each to go to a person. The test that reads them is `test/ap-040.test.ts`: under `ap-threeway@0.3.0`
each still approves, and under `ap-threeway@0.4.0` each goes to a person, the line named.

From the review of 2026-10-13 (the third finding of its three fixes: "never print APPROVE on a sentence that mentions payment,
wiring, an account, instructions or banking"), run with `r9-history.json`:

- `r9-t02-bec-reply-confirm.txt`: "Our accounting department is transitioning to a different financial partner this week.
  Before releasing payment on this invoice, please reply to this email so our controller can confirm the current wiring
  information with you."
- `r9-v01.txt`: the reader's clean bill with "Please reply to confirm the current wiring information before releasing
  payment."
- `r9-v02.txt`: the same bill with "We are moving to a new financial partner this week."

From the review of 2026-10-06, run with `r7-hist-domain.json` (the vendor's booked bill came from `ar@aldinejan.com`):

- `r7-e03-obfusc.txt`: "Our b-a-n-k  d e t a i l s have changed, see attached." (the words spelled apart with hyphens and
  spaces, two spaces between them).
- `r7-e01-replyto.txt`: sent from `ar@aldinejan.com` with `Reply-To: aldine.accounts@protonmail.com`. The reader: "A
  mismatched Reply-To is the first thing my clerk is trained to look at."
- `r7-d11-net.txt` (added 2026-10-20), run with `r7-hist-empty.json` (an empty payment history, so no domain is on file):
  sent from `ar@aldinejan.net`. The reader: "With no domain on file, the Cyrillic homograph, an unrelated domain and
  `aldinejan.net` were approved." The first two go to a person under engine 0.7.2; this one still approved, 14 of 14.

The three bills of 2026-10-13 and the histories are copied byte for byte. The three bills of 2026-10-06 are kept as written,
except that one item reads "first aid case" where the reader wrote another word for the same thing (on three lines: the bill
line, the purchase-order line and the goods-receipt line). The checks match lines by their words and figures, and no result
depends on it: under 0.3.0 the reader's own file and this one both approve, 14 of 14.

| file | sha256 | the reader's file, where it differs |
|---|---|---|
| `r7-e01-replyto.txt` | `f1907c4df8ce46083e1e10be8cea96e9da36907c302212a4a65b4e7dbba1ac04` | `57fd6f5aa7c70b896a1b02796de5a2a8b13b6f99b7527d15bfbe15e16bfd47e7` |
| `r7-e03-obfusc.txt` | `085699d39311b6fad2b307d8b612ac4fa80eaf4cb99e294d4a0857ed15c14f1f` | `407040ce9595749572633828d8d488533ccf05dc97b4e56577ed9bdf3d1165a4` |
| `r7-d11-net.txt` | `75bfa2bf5cab54edc5887837d12f83f02097c189a8af5a6f32dba29ab9b88091` | `1e31521291e63782628d9b2ca2346b8711a97012c61663a36c94cd2a10b7017d` |
| `r7-hist-domain.json` | `c9394806ab7dceb7cd35e0d463e1b0f8cc33b74d0e6bfb05cb3838b952ee9a8f` | |
| `r7-hist-empty.json` | `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570` | |
| `r9-history.json` | `36c98ddb490fec5387d7c2c7adde11b96b50590f597cdb3a4d000dd038a0ae3a` | |
| `r9-t02-bec-reply-confirm.txt` | `a734354be5a392e4c513184c6343cd739a18f84c620502aa27251ed7b624fa24` | |
| `r9-v01.txt` | `32fe269cfd8458d0ed17ef403d0c365e843132c384f918b4c7ddafb36880ba41` | |
| `r9-v02.txt` | `da828debf4ae1fa1e3fc0ddb8b8045b6f5a4e1f8eadf8f795c04088bd24dd02a` | |
