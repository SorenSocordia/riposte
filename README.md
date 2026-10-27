# Riposte

**Parry the claim. Answer with proof.**

Riposte re-checks figures and quotations that someone has already read off a business document, and answers **PASS**,
**FAIL** or **can't tell** with a proof you can replay on your own machine; it is not an extractor, a payment system or a
fraud check, and it calls no AI model.

Someone else does the reading: a person, your ERP, an OCR tool or an AI model. The engine reads text itself in two places
only, and the page for each says so: the accounts-payable command's emailed-bill input, and a document filed in an
arbitration case.

## Five doors

Each page has the first command, what an answer means for that reader, what is not checked, and where to read next.

- **[Accounts payable](docs/doors/accounts-payable.md):** vendor bills against PO and goods receipt, and AIA G702/G703 pay applications. On Distil Labs' public 100-invoice benchmark the frozen check made 0 wrong of 82 decided, in a run blind by the authors' records only ([misses ledger](packages/verify/docs/MISSES.md) row r4-13), and 0 wrong of 2,755 decided on 3,000 perturbed copies the authors generated (row r2-61).
  `node packages/verify/dist/cli.js ap packages/verify/docs/examples/ap-three-way.txt`
- **[E-invoices](docs/doors/e-invoice.md):** what your extractor read, against the Peppol BIS 3.0 / EN 16931, ZATCA or KSeF XML itself.
  `echo '[{"id":"total","field":"payable_amount","value":1043.00}]' | node packages/verify/dist/cli.js twin-einvoice packages/verify/test/fixtures/einvoice/peppol-bis3-invoice.xml --claims - --profile peppol-bis3`
- **[Legal operations](docs/doors/legal.md):** quotations in a brief, against the opinion text they cite.
  `node packages/verify/dist/cli.js citations packages/verify/docs/examples/legal-citations.json --sources packages/verify/docs/examples/legal-opinions`
- **[Engineers](docs/doors/engineers.md):** make a verdict, then try to make its replay lie.
  `node packages/verify/dist/cli.js docs/doors/examples/invoice.json > verdict.json`
- **[Methods reviewers](docs/doors/methods.md):** start with what failed, then the numbers and how far each one reaches.
  `npx tsx bench/ap/bench.ts --run 1`

## How to read an answer

Each state has one name on screen and one in a verdict's JSON. A bill from the `ap` command also gets a decision, and the
two answers share the exit codes:

| exit code | a verdict, on screen | the verdict's JSON | a bill's decision (`ap`) |
|---|---|---|---|
| 0 | `PASS`: every check ran and held | `PASS` | approve |
| 1 | `FAIL`: a check found a figure or quotation that does not agree | `FAIL` | hold |
| 2 | `PASS-WITH-OPEN`: every check that ran held, but at least one could not run | `PASS_WITH_OPEN` in `gate_status` (`outcome` stays `PASS`) | A PERSON DECIDES (`abstain` in the JSON) |
| 2 | `INSUFFICIENT_DATA`: can't tell, no check could run | `INSUFFICIENT_DATA` | A PERSON DECIDES |

PASS-WITH-OPEN and A PERSON DECIDES are both exit 2. Only a clean PASS exits 0, so anything that acts on money must read
`gate_status`, not only `outcome`. Every answer that is not a PASS names what would settle it: a missing document, a
re-read, or the person allowed to rule. A replay shows that an answer is what the stated rules give on those inputs, not
that the inputs were read off the document correctly. The structured input path is the product. The emailed-text path is a
convenience with a documented limit, and every approve names which path read the bill. Terms are in the [glossary](docs/GLOSSARY.md).

## Install

From source: not on npm, no installer and no signed release yet. You need git and Node.js 20 or later.

```bash
git clone https://github.com/SorenSocordia/riposte.git && cd riposte
npm install --legacy-peer-deps   # plain npm install works under npm 11.6.2 and fails under npm 10.9.x
npm run build
```

Every command on these pages runs from the repository root. The engine's command is `node packages/verify/dist/cli.js`;
`riposte-verify` is its package name, and building does not install a command by that name. Engine 0.7.2, the one this tree
builds, is an open label, so a verdict issued under it can still change on a later 0.7.2 build; 0.6.0, 0.7.0 and 0.7.1 are closed,
and no version is released yet. The [changelog](packages/verify/CHANGELOG.md) defines "closed" and "released".

## Who stands behind it

Riposte is published by [ENTITY]. The work is done by a small software lab: one person and the AI agents that work for
it. The agents write much of the code, run the studies and audit some of them. Where an agent's work should be weighed
differently, such as an audit, the page that reports it says so.

- **The person behind it:** E. Tucker Anderson.
- **Contact and pilots:** hello@fragarachlabs.com.
- **Reported defects, security issues and replay kills:** kill@fragarachlabs.com ([`SECURITY.md`](SECURITY.md)).
- **Who answers:** both addresses are read by a person. Replies are drafted with the lab's own tools and signed by a person.
- **Price:** [PRICE]
- **Support and accountability:** [SUPPORT-TERMS]

The code is licensed under Apache-2.0, which provides it "as is", without warranty, except where separate written terms
say otherwise.

## What failed, and the numbers

- **What failed:** every miss from every bench table, and every defect logged in each round of cold review, is in the
  [misses ledger](packages/verify/docs/MISSES.md), dated.
- **The numbers:** every table, with its counts, interval, preregistered bar and tier, is on the
  [bench page](packages/verify/docs/BENCH.md); the [methods page](docs/doors/methods.md) says how far each number reaches.

## License

Apache-2.0. Third-party data and its licences are listed in [`NOTICE`](NOTICE).
