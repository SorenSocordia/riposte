# riposte-verify

The deterministic engine behind [Riposte](../../README.md). You bring the data a person, an extraction tool or an LLM already
produced. It recomputes what can be recomputed, cross-checks it against the reference documents you supply and, when you give
it the source text and ask for that check, confirms that values and quotes really appear in it. The answer is **PASS**,
**FAIL**, or **INSUFFICIENT_DATA** (can't tell), and every answer is a proof object you can replay with this open-source
engine, with no model, on your own machine. A replay shows the answer is what the stated rules give on those inputs, not
that the inputs were read off the document correctly. It calls no model, and it reads a document itself in two places only: the `ap`
command's email text, and a document filed in an arbitration case
([the engineers' page](../../docs/doors/engineers.md#what-the-engine-reads-itself)).

- **Built-in rulesets:** invoices, AIA G702/G703 pay applications, the AP three-way match (invoice ↔ PO ↔ goods receipt), and
  verbatim legal quotations. Any other document type can be defined as pure JSON: fields, formulas and checks, with no engine
  code. Examples in [`docs/examples`](docs/examples) include Peppol BIS 3.0 / EN 16931, KSeF FA(3), ZATCA, a four-way match
  and a financial statement.
- **Proofs:** each claim records its operands, the provenance of every value, and the variance. The verdict id is
  deterministic (input hash + ruleset@version + engine version label). While engine 0.7.1 is an open label, it does not
  pin the code, so a later 0.7.1 build may give a different id
  ([CHANGELOG.md](CHANGELOG.md)). Verdicts can be signed with Ed25519, and replayed with this
  engine on your own machine, with no model. A signature says only which key signed; pin the issuer's key before relying on it.
- **Honesty rules:** a comparison that couldn't be made is not a FAIL, and a missing reference is not the extraction's fault.
  There is no verdict on a fuzzy-matched field, and none against an ambiguous multi-candidate reference.
- **System of record:** an append-only, hash-chained verdict ledger that persists to disk, plus the human's later
  agree/disagree. The overturn rate that results is the real-world accuracy signal.
- **Surfaces:** a library, a CLI, HTTP with an OpenAPI 3.1 document, a typed SDK client, and an MCP server over stdio. The only
  runtime dependency is `jsonpath-plus`. The checks make no network calls. Three things can, each only when you use it:
  `bench stamp <file> --tsa <url>` runs curl to send that file's sha256 to the timestamp authority you name; the webhook
  dispatcher POSTs a verdict once an integrator wires it into the HTTP service; and the typed SDK client calls the server
  address its caller gives it.

Start with **[QUICKSTART.md](QUICKSTART.md)**, or with the page for your role that [the repository README](../../README.md)
lists (accounts payable, e-invoices, legal operations, engineers, methods reviewers). More detail:
- [docs/BENCHMARK-AP.md](docs/BENCHMARK-AP.md): the AP benchmark (its headline run's order of events rests on the authors'
  file times, and its preregistration has no recorded hash, so the bench tool lists it among refused runs).
- [docs/VERDICT-SCHEMA-v0.md](docs/VERDICT-SCHEMA-v0.md): the proof object.
- [docs/RULESETS.md](docs/RULESETS.md): adding a document type.
- [docs/DEPLOY.md](docs/DEPLOY.md): on-prem and air-gapped deployment.
- [docs/LEGAL.md](docs/LEGAL.md): the verbatim quotation check for legal briefs, and its published accuracy.
- [docs/MISSES.md](docs/MISSES.md): every miss from every bench run, including the open ones.
- [The glossary](../../docs/GLOSSARY.md): the terms these pages use.

```bash
npm test                  # the full suite: rulesets, honesty rules, seeded fuzzers, 10,000+ byte-identical replays;
                          # one file starts the HTTP server on 127.0.0.1 at a random port (QUICKSTART, "What npm test does")
npm run test:determinism  # determinism and version pinning only; no server
```

Apache-2.0.
