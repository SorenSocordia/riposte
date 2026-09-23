# riposte-verify

The deterministic engine behind [Riposte](../../README.md). You bring the data an LLM or an extraction tool already produced.
It recomputes what can be recomputed, cross-checks it against the reference documents, and confirms that values and quotes
really appear in the source. The answer is **PASS**, **FAIL**, or **INSUFFICIENT_DATA**, and every answer is a proof object you
can replay without the engine.

- **Built-in rulesets:** invoices, AIA G702/G703 pay applications, the AP three-way match (invoice ↔ PO ↔ goods receipt), and
  legal citations and quotes. Any other document type can be defined as pure JSON: fields, formulas and checks, with no engine
  code. Examples in [`docs/examples`](docs/examples) include Peppol BIS 3.0 / EN 16931, KSeF FA(3), ZATCA, a four-way match
  and a financial statement.
- **Proofs:** each claim records its operands, the provenance of every value, and the variance. The verdict id is
  deterministic (input hash + ruleset@version + engine version). Verdicts can be signed with Ed25519 and replayed without the
  engine.
- **Honesty rules:** a comparison that couldn't be made is not a FAIL, and a missing reference is not the extraction's fault.
  There is no verdict on a fuzzy-matched field, and none against an ambiguous multi-candidate reference.
- **System of record:** an append-only, hash-chained verdict ledger that persists to disk, plus the human's later
  agree/disagree. The overturn rate that results is the real-world accuracy signal.
- **Surfaces:** a library, a CLI, HTTP with an OpenAPI 3.1 document, a typed SDK client, and an MCP server over stdio. The only
  runtime dependency is `jsonpath-plus`, and nothing goes out over the network at runtime.

Start with **[QUICKSTART.md](QUICKSTART.md)**. More detail:
- [docs/BENCHMARK-AP.md](docs/BENCHMARK-AP.md): the AP benchmark (blind, pre-registered).
- [docs/VERDICT-SCHEMA-v0.md](docs/VERDICT-SCHEMA-v0.md): the proof object.
- [docs/RULESETS.md](docs/RULESETS.md): adding a document type.
- [docs/DEPLOY.md](docs/DEPLOY.md): on-prem and air-gapped deployment.

```bash
npm test                  # the full suite: rulesets, honesty rules, seeded fuzzers, 10,000+ byte-identical replays
npm run test:determinism  # determinism and version pinning only
```

Apache-2.0.
