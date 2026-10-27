/**
 * OpenAPI 3.1 description of the HTTP surface. Served at GET /v1/openapi.json. Kept deliberately compact — the verdict
 * schema's source of truth is `src/verdict/schema.ts` / `docs/VERDICT-SCHEMA-v0.md`; this documents the endpoints so an
 * SDK generator or an API console can consume them. The transport (serve.ts) caps every request body (413; 4 MiB by
 * default, `verify serve --max-body` to set it, and 32 MiB for /v1/twin, /v1/opinion, /v1/reconcile and /v1/succession/replay)
 * and answers a request slower than its deadlines with 408.
 * Under `verify serve` every POST is checked in a worker under a time and heap budget (budget.ts, 2026-10-06): past it the answer
 * is 413 with x-verify-exit 2, and past the queue 503.
 */

import { ENGINE_VERSION } from '../version.js'
import { MAX_CITE_CHARS } from '../legal/cite-bound.js'

const verdictRef = { type: 'object', description: 'The Verdict proof object — see docs/VERDICT-SCHEMA-v0.md.' }
const jsonBody = (required: string[], props: Record<string, unknown>) => ({
  required: true,
  content: { 'application/json': { schema: { type: 'object', required, properties: props } } },
})
const verdictResponse = { '200': { description: 'A Verdict.', content: { 'application/json': { schema: verdictRef } } }, '400': { description: 'Bad request.' }, '413': { description: "The body is over the transport cap (4 MiB by default), or, under `verify serve`, the check ran past the service's budget: \"input too large to check within the service's budget; run it with the command line\", with x-verify-gate INSUFFICIENT_DATA and x-verify-exit 2. Never a verdict." }, '503': { description: 'The service is checking as many requests as it holds (Retry-After: 1). Nothing was checked.' } }

export const OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'Verify — deterministic document & action verification',
    version: ENGINE_VERSION,
    description: 'Verify already-extracted document data and proposed agent actions. PASS / FAIL / INSUFFICIENT_DATA with a replayable proof. A figure that does not read as exactly one number is not guessed: a lone "1,500" or "1.500" with no declared number_locale, a document that writes figures in both number formats ("1,500.00" beside "1.500,00") or in two scripts of digits, and a stray no-break space each leave the checks that need that figure at INSUFFICIENT_DATA, with the reason. Every request body must be sent with Content-Type: application/json, as UTF-8 (else 415; a charset other than utf-8 is 415, "send UTF-8"), and a server started with `verify serve` answers only a Host header naming localhost, 127.0.0.1, ::1, the address it is bound to, or a name given with --allow-host (else 421; a request with no Host header is 400). A JSON number that cannot be represented exactly (9007199254740993 reads as 9007199254740992) is refused with a 400 naming its path: write amounts as strings with two decimals. A body nested more than 256 levels deep is refused with a 400 ("nesting too deep, limit 256").',
  },
  paths: {
    '/v1/health': { get: { summary: 'Health + engine version.', responses: { '200': { description: 'ok' } } } },
    '/v1/openapi.json': { get: { summary: 'This OpenAPI 3.1 description.', responses: { '200': { description: 'The spec.' } } } },
    '/v1/verify': {
      post: {
        summary: 'Verify a document under a built-in ruleset (invoice / pay-app).',
        requestBody: jsonBody(['extraction'], { extraction: { type: 'object' }, ruleset: { type: 'string', enum: ['invoice', 'pay-app'] }, references: { type: 'object' }, source: { type: 'object' }, tolerance: { type: 'object' }, producer: { type: 'string' } }),
        responses: verdictResponse,
      },
    },
    '/v1/verify/declared': {
      post: {
        summary: 'Verify a document under a DECLARATIVE (JSON) ruleset — any document type, any language, no code.',
        requestBody: jsonBody(['extraction', 'ruleset'], { extraction: { type: 'object' }, ruleset: { oneOf: [{ type: 'object' }, { type: 'string', description: 'A ruleset this build carries by name: peppol-en16931 (= the default for the engine: 0.3.0 under engine 0.6.0, 0.2.0 before it), peppol-en16931@0.1.0, peppol-en16931@0.2.0, peppol-en16931@0.3.0, e-invoice (= the default e-invoice ruleset).' }] } }),
        responses: verdictResponse,
      },
    },
    '/v1/verify/action': {
      post: {
        summary: 'Ground a proposed agent action against an allow-list or source before it executes.',
        requestBody: jsonBody(['action'], { action: { type: 'object' }, sources: { type: 'object' } }),
        responses: verdictResponse,
      },
    },
    '/v1/action/check': {
      post: {
        summary: 'Check one proposed tool call at a rung: the verify_action verdict, its notice (every FAIL / INSUFFICIENT_DATA with its evidence and a dispute path), and the disposition the hold adapters deliver.',
        description: 'Dispositions: hold (a FAIL or INSUFFICIENT_DATA at gate / autonomy: it waits for a person) · review (a PASS at gate: a person reviews it) · surface (a FAIL or INSUFFICIENT_DATA at advise: shown in-flow, not held) · record (a FAIL or INSUFFICIENT_DATA at record: a notice, not held) · proceed (a PASS at record / advise, or at autonomy within the declared bounds). `holds` is true for hold and review. Stateless: the rung is `level` (default record, the day-1 default). Managed tier: name `workflow_id` and the rung is read from the book of record instead (the GRANT in force, else the declared settings, else record); a `level` may restate it, never change it. The verdict is recorded to the caller’s book like any other.',
        requestBody: jsonBody(['action'], {
          action: { type: 'object', required: ['tool'], properties: { tool: { type: 'string' }, arguments: { type: 'object' } } },
          sources: { type: 'object', properties: {
            text: { type: 'string' }, allowed: { type: 'object' }, require: { type: 'array', items: { type: 'string' } },
            records: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: { type: ['string', 'number'] } },
              description: 'Approved records: each one argument values approved together (e.g. one invoice\'s amount and payee account); every record names the same arguments. The arguments they name are grounded only when they all equal ONE record: a value approved for one record combined with another record\'s value FAILs (mix-and-match), and a partial tuple (a record-named argument missing) is INSUFFICIENT_DATA (can’t tell). Verdicts that use records name rule action@0.1.0, or action@0.2.0 when a value matches only in another written form.' },
            fields: { type: 'object', additionalProperties: { type: 'object', required: ['type'], properties: { type: { type: 'string', enum: ['text', 'amount', 'identifier', 'date', 'rate'] }, currency: { type: 'string', pattern: '^[A-Z]{3}$' }, case_insensitive: { type: 'boolean' }, whitespace_insensitive: { type: 'boolean' }, order: { type: 'string', enum: ['DMY', 'MDY'] }, unit: { type: 'string', enum: ['percent', 'fraction'] } } },
              description: 'How each argument compares with its approved values (rule action@0.2.0), keyed by argument. Undeclared, a JSON number equals the same number written as a plain numeral (980.5 and "980.50"). amount: thousands separators and trailing zeros, and a currency symbol or ISO code when currency is declared. identifier: case_insensitive and whitespace_insensitive when declared. date: ISO and month-name forms, and D/M/Y or M/D/Y only in the declared order. rate: percent and fraction in the declared unit. Leading zeros, scale, sign, another record\'s value and ambiguous dates are never the same value. An invalid declaration is refused.' },
          } },
          level: { type: 'string', enum: ['record', 'advise', 'gate', 'autonomy'] },
          workflow_id: { type: 'string', description: '(managed tier) tenant/ruleset@version: read the rung from the book of record. The deployment’s declared policy governs every GRANT, whatever policy the grant names: one still pending a second signature (a tier declaring grant_signatures), at a tier the policy does not declare, or above the tier’s max_rung has no effect on it, and the response lists it in no_effect with its notice; notices says when the grant in force names another policy.' },
        }),
        responses: {
          '200': { description: 'ActionCheckSurface: tool, level, level_source (request | default | grant | declaration | none), workflow_id?, disposition, holds, call_hash, verdict (a standard replayable Verdict), notice, notice_markdown.' },
          '400': { description: 'Bad request (no action, malformed sources, an unknown rung).' },
          '401': { description: 'Unauthorized (managed tier).' },
          '404': { description: '(managed tier) The workflow is not the caller’s.' },
          '409': { description: '(managed tier) The request states a rung other than the one on record, or the book of record does not verify (it grants nothing).' },
        },
      },
    },
    '/v1/verify/citations': {
      post: {
        summary: 'Cite-check: does each quotation appear verbatim in the supplied opinion text.',
        requestBody: jsonBody(['citations'], { citations: { type: 'array', items: { type: 'object', properties: { cite: { type: 'string', maxLength: MAX_CITE_CHARS }, case_name: { type: 'string', maxLength: MAX_CITE_CHARS }, source_key: { type: 'string', maxLength: MAX_CITE_CHARS } } } }, sources: { type: 'object', propertyNames: { maxLength: MAX_CITE_CHARS } }, ruleset: { type: 'string', description: 'legal@0.5.5 (selectable from engine 0.7.2, the default from the first engine after it; see the CHANGELOG section Legal rule 0.5.5); legal@0.5.4 (the default from engine 0.7.2; docs/LEGAL.md says what it reads); legal@0.5.3 (the default under engine 0.7.1); legal@0.5.2 (the default under engines 0.6.0 and 0.7.0: it reads as legal@0.5.1 does, prints how the sentence begins beside a quotation that begins mid-sentence and answers INSUFFICIENT_DATA when those words report someone else\'s position (a party, a dissent, another court) or state a counterfactual, names a plurality, reads Westlaw PDF page headers and footers and Lexis headnote markers out, and skips a KeyCite flag when it reads the caption); legal@0.5.1 (from earlier that day: it reads as legal@0.5.0 does, and never calls a quotation that stops before its sentence ends "verbatim" (its PASS prints how the sentence continues, and a continuation that limits or negates the quoted words answers INSUFFICIENT_DATA), reads em dashes, en dashes and "--" as one dash, reads "(citation omitted)", "(cleaned up)", "(footnote omitted)" and "(internal quotation marks omitted)" for what they excuse, and reads Westlaw headnote numbers out); legal@0.5.0, which reads the sections of the text, so words found only in editorial matter such as headnotes, a synopsis or the syllabus, or in a separate opinion, answer INSUFFICIENT_DATA naming where they are, and every PASS says where it matched; it looks a citation up by its reporter citation with the pin page, case name and parenthetical read off, binds the Reporter block of a Lexis header, and answers INSUFFICIENT_DATA on every footnote-call form it does not read out; legal@0.0.1 was the default before engine 0.6.0); legal@0.4.0, which reads a quotation that begins mid-sentence for a cut-off condition or negation, reads star paging and footnote numerals out of the comparison, and reads a short form as a pin cite to a full citation the same brief gives; legal@0.3.0, which binds each text by its caption; legal@0.2.0; legal@0.1.0, which reads quotation conventions (brackets, ellipses, quotation marks, "(cleaned up)") and names the ones it relied on; or legal@0.2.0, which also refuses an alteration that changes the meaning (a swapped word, modal, negation or quantifier in a bracket; an omitted condition; inner quotation marks dropped or added).' } }),
        responses: { ...verdictResponse, '400': { description: `Bad request; or citation text over ${MAX_CITE_CHARS} characters (a cite, case name or source key, or the key of a text), refused before anything is read or hashed, naming the bound and the length. Never a verdict.` } },
      },
    },
    '/v1/verify/quotes': {
      post: {
        summary: 'Does a quoted passage / numeric value appear in a source text.',
        requestBody: jsonBody(['source_text'], { source_text: { type: 'string' }, quotes: { type: 'array' }, values: { type: 'array' } }),
        responses: { '200': { description: 'source hash + per-assertion claims.' } },
      },
    },
    '/v1/verify/batch': {
      post: {
        summary: 'Verify many documents in one call; returns an outcome summary + each verdict.',
        requestBody: jsonBody(['items'], { items: { type: 'array', items: { type: 'object' } } }),
        responses: { '200': { description: 'Batch result: count, per-outcome summary, and the verdicts.' }, '400': { description: 'Bad request.' } },
      },
    },
    '/v1/ruleset/lint': {
      post: {
        summary: 'Validate a declarative ruleset before it runs (structure, formulas, role references).',
        requestBody: jsonBody(['ruleset'], { ruleset: { type: 'object' } }),
        responses: { '200': { description: 'Lint result: ok, errors[], warnings[].' }, '400': { description: 'Bad request.' } },
      },
    },
    '/v1/ruleset/measure': {
      post: {
        summary: 'Mint a measured DeclaredAccuracy: run a declarative ruleset over a labeled set (never estimated).',
        requestBody: jsonBody(['ruleset', 'cases'], { ruleset: { type: 'object' }, cases: { type: 'array', items: { type: 'object', required: ['extraction', 'label'], properties: { extraction: { type: 'object' }, label: { type: 'string', enum: ['CLEAN', 'ERROR'] } } } } }),
        responses: { '200': { description: 'accuracy (fp/fn/abstain + measured_on hash), metrics, and per-case rows.' }, '400': { description: 'Bad request.' } },
      },
    },
    '/v1/mine': {
      post: {
        summary: 'Propose the rules behind labelled decisions (rule mining): candles with exact p-values, the morgue, and a compiled declarative ruleset.',
        requestBody: jsonBody(['cases', 'schema'], { cases: { type: 'array', items: { type: 'object', required: ['id', 'label', 'fields'] } }, schema: { type: 'object', required: ['approve', 'fields'] }, max_approved_violation_rate: { type: 'number' }, thresholds: { type: 'boolean' }, ruleset_id: { type: 'string' } }),
        responses: { '200': { description: '{ report, compiled }: candles (proposals for a human), morgue, explained holds, and the compiled ruleset.' }, '400': { description: 'Bad request (including a malformed case table or schema).' } },
      },
    },
    '/v1/twin': {
      post: {
        summary: 'Structured-twin check: extracted financial-statement values against the filing’s own inline-XBRL facts (never a table re-read from the HTML). PASS / FAIL with a diagnosis / INSUFFICIENT_DATA (can’t tell) with a reason.',
        description: 'map_version 0.1.0 (default; ruleset 0.1) binds over the whole document; 0.2.0 (ruleset 0.2) binds only concepts the filing’s presentation linkbase places on a face statement (supply pre / filing_summary / schema flat, or presentation nested; without a linkbase every claim is INSUFFICIENT_DATA, NO_PRESENTATION_LINKBASE). 0.2.1 (ruleset 0.2.1, opt-in) is 0.2 plus us-gaap scope-variant concept families, the cash roll as the tie-break between disagreeing face lines (INSUFFICIENT_DATA AMBIGUOUS_LINE, the insufficiency AMBIGUOUS_REFERENCE, when it cannot decide), an exact power-of-ten SCALE FAIL against anchored figures, and a strict linkbase reading. It FAILED its pre-registered held-out check (2026-09-28) and every 0.2.1 result says so in map_status. The body may be up to 32 MiB (a whole filing); most routes take 4 MiB. In the managed tier the verdict is recorded to the caller’s book like any other.',
        requestBody: jsonBody(['html', 'period_end', 'claims'], {
          html: { type: 'string', description: 'The primary inline-XBRL document, as text.' },
          period_end: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          claims: { type: 'array', items: { type: 'object', required: ['id', 'field', 'value'], properties: { id: { type: 'string' }, field: { type: 'string' }, value: { type: 'number' } } } },
          tolerance: { type: 'number', minimum: 0 },
          period_tolerance_days: { type: 'number', minimum: 0 },
          map_version: { type: 'string', enum: ['0.1.0', '0.2.0', '0.2.1'] },
          ruleset: { type: 'string', enum: ['0.1', '0.2', '0.2.1', '0.1.0', '0.2.0'], description: 'The twin ruleset: 0.1 = map 0.1.0 (default), 0.2 = map 0.2.0, 0.2.1 = map 0.2.1 (opt-in; held-out prereg FAIL, stated in map_status). With map_version too, the two must agree.' },
          pre: { type: 'string', description: 'For ruleset 0.2, flat: the presentation linkbase (*_pre.xml).' },
          filing_summary: { type: 'string', description: 'For ruleset 0.2, flat: EDGAR FilingSummary.xml.' },
          schema: { type: 'string', description: 'For ruleset 0.2, flat: the extension schema (*.xsd).' },
          presentation: { type: 'object', description: 'The same texts, nested (one way, not both).', properties: { pre: { type: 'string' }, filing_summary: { type: 'string' }, schema: { type: 'string' } } },
          producer: { type: 'string' },
        }),
        responses: { '200': { description: '{ verdict, judgments, twin, map_status? }: a standard replayable Verdict (the VERDICT channel), the per-claim judgments, the twin’s identity (sha256, facts, contexts), and for map 0.2.1 its measured status ({ map_version, offered: opt-in, measured, detail }).' }, '400': { description: 'Bad request (including a ruleset and a map_version that disagree, or presentation texts sent both flat and nested).' }, '413': { description: 'The body is over the transport cap (32 MiB for this route).' } },
      },
    },
    '/v1/opinion': {
      post: {
        summary: 'The courtroom opinion over the book of record: a dispute of one recorded verdict, or a voice question for a workflow. COUNSEL (generated, dismissible), never a VERDICT: it proposes, a person decides.',
        description: 'One question per opinion: { dispute: { verdict_id, claim_id? } }, or { policy, proposal }, or { policy, workflow_id, consequence_tier, granted | grant, bounds? }. Every premise is checked by Riposte’s own code; if one fails the ruling is WITHHELD. Stateless: supply "ledger" (the chain export), and optionally "tenant_id" to read one tenant of a shared chain. Managed tier: omit "ledger" to read the caller’s own book under the declared policy and the settings on record (a request may restate them, not change them); the opinion is scoped to the caller’s tenant, so on a shared book its precedent, evidence and grants are the caller’s own.',
        requestBody: jsonBody([], {
          ledger: { oneOf: [{ type: 'string', description: 'The chain export (ledger.chainJSONL()).' }, { type: 'object', required: ['events', 'payloads'], properties: { events: { type: 'array' }, payloads: { type: 'array' } } }] },
          dispute: { type: 'object', required: ['verdict_id'], properties: { verdict_id: { type: 'string' }, claim_id: { type: 'string' } } },
          inputs: { description: 'For a dispute: the original inputs, to verify the verdict is FOR them.' },
          policy: { type: 'object', description: 'The declared promotion policy (promotion-policy-v0).' },
          proposal: { type: 'object', description: 'A proposal (from GET /v1/voice/{workflow} or voice_assess) to argue.' },
          workflow_id: { type: 'string' },
          consequence_tier: { type: 'string' },
          granted: { type: 'string', enum: ['record', 'advise', 'gate', 'autonomy'] },
          grant: { type: 'object' },
          bounds: { type: 'string' },
          tenant_id: { type: 'string', description: 'Read one tenant’s records and decisions only (a shared chain). In the managed tier it is the caller’s own; another is refused.' },
          from_book: { type: 'boolean', description: 'For a voice question: read the rung from the GRANT in force on the book (workflow_id; consequence_tier only while nothing is granted).' },
          trusted_keys: { type: 'object', description: 'With a supplied "ledger": anchor its signers ({ signer_id: PEM | [PEM] }). A chain export carries no anchors, so without them its decisions have no effect (D-ANCHOR) and the opinion names each. Refused in the managed tier: its ledger carries its own anchors.' },
          root_keys: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'With a supplied "ledger": the root public key(s); the key registry on the book anchors the signers it registers.' },
        }),
        responses: {
          '200': { description: '{ opinion, markdown }: the opinion (the source of truth; its id re-derives from its content) and its reading copy.' },
          '400': { description: 'Bad request (no ledger, no policy for a voice question, a verdict not on the book, two questions at once).' },
          '413': { description: 'The body is over the transport cap (32 MiB for this route: a chain export). A book that large is read by the managed tier from its own ledger.' },
          '401': { description: 'Unauthorized (managed tier).' },
          '404': { description: '(managed tier) The workflow or verdict is not on the caller’s book.' },
          '409': { description: '(managed tier) The request states settings other than those on record (the GRANT in force, or the declared settings).' },
        },
      },
    },
    '/v1/grant/cosign': {
      post: {
        summary: '(managed tier) Dual authorization: a second person’s signed co-signature on a GRANT whose tier requires more than one signature (grant_signatures). Until it is co-signed the grant is PENDING and moves no rung.',
        description: 'The body is the signed GRANT_COSIGN itself, made offline with the co-signer’s own key (makeCosign + signDecision): it names the grant by decision_id and restates its workflow and level. It goes through the ledger’s door, which verifies the signature and the anchoring and refuses a co-signature that would not count (the grant’s own signer, a repeat signer, the same key or two ids on one key, an unanchored or superseded grant). It rides in a GRANT event; the chain format is unchanged.',
        requestBody: jsonBody(['decision', 'public_key', 'signature'], {
          decision: { type: 'object', required: ['kind', 'workflow_id', 'grant', 'level', 'signer_id', 'signed_at'], properties: { kind: { type: 'string', enum: ['GRANT_COSIGN'] }, workflow_id: { type: 'string' }, grant: { type: 'string' }, level: { type: 'string' }, signer_id: { type: 'string' }, signed_at: { type: 'string' }, note: { type: 'string' } } },
          alg: { type: 'string', enum: ['ed25519'] },
          public_key: { type: 'string' },
          signature: { type: 'string' },
          decision_id: { type: 'string' },
        }),
        responses: {
          '200': { description: '{ tenant_id, appended, grant: { decision_id, workflow_id, level, signatures: { required, signers, cosigns, complete }, in_force }, no_effect }: the entry, the grant’s signatures as the book now stands, and any notice still standing (a grant that needs more signatures stays pending).' },
          '400': { description: 'Not a signed GRANT_COSIGN.' },
          '401': { description: 'Unauthorized.' },
          '404': { description: 'The grant is not on the caller’s tenant’s book, or not the managed tier (no ledger).' },
          '409': { description: 'The door refused it (nothing is appended), or the book of record does not verify.' },
        },
      },
    },
    '/v1/reconcile': {
      post: {
        summary: 'Completeness reconciliation: the book of record against the customer’s payment population (an AP payment register, a GL payments extract). Every payment lands in one class; PAID_DESPITE_HOLD is the control override.',
        description: 'Completeness: did every payment go through the control? The whole book is verified first (nothing is reconciled against a book that does not verify), then every population row lands in exactly one class (MATCHED, MISMATCHED, PAID_DESPITE_HOLD, CHECKED_AFTER_PAYMENT, AMBIGUOUS, BYPASSED, UNREADABLE) and every in-period verdict in one (MATCHED, ORPHAN, AMBIGUOUS, UNKEYED). Declared, never guessed: the mapping names each column and key rule; amounts are exact decimals; dates are never sniffed. The report binds the book head and length, the population (sha256 of the exact bytes when sent as text or base64, and rows_hash), the mapping and the options, and carries a clock-free report_hash. Completeness of the population itself is the customer’s responsibility: this proves the book covers the population given. Stateless: supply "ledger" (the chain export), optionally "tenant_id" and "trusted_keys" / "root_keys". Managed tier: omit "ledger"; the caller’s own book is read with the ledger’s own anchors, the scope is the caller’s tenant whatever the body says (another tenant or its workflow is refused), and on a shared book the report’s summary of the book is the caller’s slice. The body may be up to 32 MiB (a payment register).',
        requestBody: jsonBody(['population', 'mapping'], {
          population: {
            oneOf: [
              { type: 'object', required: ['format'], properties: { format: { type: 'string', enum: ['csv', 'jsonl'] }, text: { type: 'string' }, base64: { type: 'string', description: 'The export’s exact bytes (its sha256 is bound as the file was).' }, delimiter: { type: 'string', enum: [',', ';', '\t', '|'] } } },
              { type: 'object', required: ['rows'], properties: { rows: { type: 'array', items: { type: 'object' } } } },
              { type: 'array', items: { type: 'object' } },
            ],
          },
          mapping: { type: 'object', description: 'The declared completeness mapping (completeness-mapping-v0): key fields, population columns, book field sources, key normalization, tolerances.' },
          ledger: { oneOf: [{ type: 'string', description: 'The chain export (ledger.chainJSONL()).' }, { type: 'object', required: ['events', 'payloads'], properties: { events: { type: 'array' }, payloads: { type: 'array' } } }], description: 'Stateless only: the book of record. Refused in the managed tier, which reads the caller’s own book.' },
          extractions: { type: 'array', description: 'The checked extractions (or proposed actions), for extraction book sources; each is used only if its hash is on the book.' },
          tenant_id: { type: 'string', description: 'Read one tenant’s records only (a shared chain). In the managed tier it is the caller’s own; another is refused.' },
          workflows: { type: 'array', items: { type: 'string' } },
          rulesets: { type: 'array', items: { type: 'string' } },
          period: { type: 'object', properties: { since: { type: 'string' }, until: { type: 'string' } }, description: 'The period the population covers, on the book’s clock (since inclusive, until exclusive).' },
          rungs: { type: 'object', description: 'A declared rung per workflow, used only for a workflow with no anchored GRANT on the book.' },
          interval: { type: 'object', properties: { method: { type: 'string' }, confidence: { type: 'number' }, sidedness: { type: 'string' } } },
          include_matched: { type: 'boolean' },
          trusted_keys: { type: 'object', description: 'Stateless only: anchor the chain’s signers ({ signer_id: PEM | [PEM] }). Without anchors a GRANT has no effect and the rung falls back to the declared one, then record.' },
          root_keys: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'Stateless only: the root public key(s); the key registry on the book anchors the signers it registers.' },
          policy: { type: 'object', description: 'Stateless only: the declared promotion policy; the rung a record was held at is read with the GRANTs it admits, whatever policy a grant names. The managed tier reads under its own declared policy and refuses one here.' },
        }),
        responses: {
          '200': { description: '{ report, markdown } (managed tier: { tenant_id, report, markdown }): the CompletenessReport (binds, population and book by class, coverage with its bound, $ totals by currency, every exception with its row and verdict, resolved holds, clean, boundary, report_hash) and its reading copy. clean is true only when every row is MATCHED.' },
          '400': { description: 'Bad request, or a refused input: a mapping, population value or book the engine will not reconcile (the message names the row, line and column).' },
          '401': { description: 'Unauthorized (managed tier).' },
          '404': { description: '(managed tier) Another tenant, or another tenant’s workflow.' },
          '409': { description: '(managed tier) The book of record does not verify: nothing is reconciled against it.' },
          '413': { description: 'The body is over the transport cap (32 MiB for this route).' },
        },
      },
    },
    '/v1/replay': {
      post: {
        summary: 'Re-perform proof bundles (a verdict and the inputs it is bound to): MATCH, DIVERGED (naming the first field), NOT_REPERFORMED or REFUSED. Read-only.',
        description: 'The verify replay command over HTTP (2026-10-03). Give { bundle } or { bundles: [...] } (at most 1000; each a bundle or { name, bundle }), or a bundle itself. A bundle is { verdict, inputs, options? }: what verify ap --input, the AP gate and the MCP tools hand back. The answer is { summary: { total, matched, diverged, not_reperformed, refused, cases, carried_not_checked?, carried_allowed? }, lines }, each line as the CLI prints it; for an AP proof it leads with the gate decision. A key a bundle carries beside verdict, inputs and options (or beside a signed envelope\'s four members) is not checked: the case\'s line names it ("carried, not checked: <keys>") and summary.carried_not_checked lists it by case. A bundle\'s top-level id and note are the two allowed caller keys: the line names them ("carried (allowed): id, note") and summary.carried_allowed lists them by case. The answer carries x-verify-exit, the replay\'s exit, as verify replay on a folder gives it: 0 every case matched, 1 a case diverged, 2 a case was not re-performed, 3 a case was refused (a refusal wins). The status follows the exit (2026-10-19), so a client or proxy that reads only the status never takes a forgery for a success: 409 when a case diverged (the presented verdict, or an AP field beside it, is not what its own inputs re-perform to), 422 when a case was refused, 200 when every case matched, or none diverged and some were not re-performed; the body is the same summary in every case. A request that names no bundle is 400. A bundle that states the AP gate\'s fields (decision, payable, grounding, reasons, not_checked) beside an AP verdict has them derived again from the re-performed verdict and compared: one that differs diverges, named.',
        requestBody: jsonBody([], { bundle: { type: 'object' }, bundles: { type: 'array', items: { type: 'object' } } }),
        responses: {
          200: { description: 'the replay summary and one rendered line per case; x-verify-exit is 0 (every case matched) or 2 (none diverged, some were not re-performed)', headers: { 'x-verify-exit': { description: 'the replay\'s exit: 0 every case matched, 2 a case was not re-performed', schema: { type: 'string', enum: ['0', '2'] } } } },
          409: { description: 'a case diverged: the same summary and lines; x-verify-exit is 1', headers: { 'x-verify-exit': { description: 'the replay\'s exit: 1 a case diverged', schema: { type: 'string', enum: ['1'] } } } },
          422: { description: 'a case was refused (not a bundle, not a verdict, or refused before hashing): the same summary and lines; x-verify-exit is 3 (a refused case wins over a diverged one)', headers: { 'x-verify-exit': { description: 'the replay\'s exit: 3 a case was refused', schema: { type: 'string', enum: ['3'] } } } },
          400: { description: 'the request names no bundle, or too many; no x-verify-exit' },
        },
      },
    },
    '/v1/succession/replay': {
      post: {
        summary: 'The replay a person reviews before carrying a grant to a new ruleset version, or a signed succession’s replay re-performed. Read-only: nothing is signed or appended.',
        description: 'A new ruleset version is a new workflow and starts at record; a person carries the grant in force with a signed GRANT that carries this replay (verify succession). Without "check": the grant in force on "from" (under "policy" when given) and every verdict recorded under "from" re-performed under the "to" ruleset with the inputs supplied: counts, each change and its direction, how many loosen (a change to PASS, which needs its own stated reason), and each verdict not re-performed with why. With "signer_id", "reason" and "policy": also the unsigned GRANT, to be signed where the person’s key lives. With "check" (a succession GRANT’s decision id): its signed replay re-performed over its own span; ok when byte-identical.',
        requestBody: jsonBody(['ledger', 'inputs'], {
          ledger: { oneOf: [{ type: 'string', description: 'The chain export (ledger.chainJSONL()).' }, { type: 'object', required: ['events', 'payloads'], properties: { events: { type: 'array' }, payloads: { type: 'array' } } }] },
          inputs: { oneOf: [{ type: 'array', items: { type: 'object', required: ['verdict_id', 'inputs'], properties: { verdict_id: { type: 'string' }, inputs: { type: 'object' } } } }, { type: 'object', description: '{ "<verdict_id>": inputs }' }], description: 'The inputs each recorded verdict was issued on; a verdict without them is counted as not re-performed.' },
          from: { type: 'string', description: '<tenant>/<ruleset>@<old version>' },
          to: { type: 'string', description: '<tenant>/<ruleset>@<new version>' },
          check: { type: 'string', description: 'A succession GRANT’s decision id (or a unique prefix of 12+ hex characters): re-perform its replay.' },
          ruleset: { type: 'object', description: 'The new version as a declarative ruleset, when this build does not hold it.' },
          tolerance: { type: 'object', properties: { rel: { type: 'number' }, absCap: { type: 'number' } } },
          policy: { type: 'object', description: 'The declared promotion policy: the grant in force is read under it.' },
          signer_id: { type: 'string' }, reason: { type: 'string' }, loosening_reason: { type: 'string' }, level: { type: 'string' }, signed_at: { type: 'string' }, note: { type: 'string' },
          trusted_keys: { type: 'object' },
          root_keys: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        }),
        responses: {
          '200': { description: '{ surface_version, from, to, carries, replay, not_reperformed, loosens, unsigned?, chain } or, with "check", { surface_version, from, to, check: { ok, differences, signed, reperformed, book }, chain }.' },
          '400': { description: 'Bad request, a book that does not verify, or a refused succession (a raised rung, a loosening without its reason, nothing to carry).' },
          '413': { description: 'The body is over the transport cap (32 MiB for this route).' },
        },
      },
    },
    '/v1/voice/{workflow}': {
      get: {
        summary: '(managed tier) A workflow’s voice: the rung it runs at (ALWAYS the one a person granted; nothing here changes it) and any open proposal (a promotion, or an URGENT demotion with its failing cases for dispute).',
        description: 'Read from the caller’s book of record under the deployment’s declared policy. BOOK FIRST: the rung is the GRANT in force on the book (a person’s signed decision; cited in assessment.book, and a proposal a person declined is held back until the evidence changes); the deployment’s declared settings cover only workflows with no GRANT. An undeclared, ungranted workflow is at record, the day-1 default, and nothing is weighed. Nothing is proposed from a book whose content does not verify.',
        parameters: [{ name: 'workflow', in: 'path', required: true, schema: { type: 'string' }, description: 'The workflow id, tenant/ruleset@version, URL-encoded (e.g. acme%2Finvoice%400.0.1).' }],
        responses: {
          '200': { description: 'VoiceSurface: workflow_id, level (= granted), earned, declared, handling, open_proposal, basis (the open demotion’s: failure = urgent, unevidenced = a standing notice; else null), no_effect (decisions for the workflow on the book with NO effect, each with its notice: a signer not anchored, or a GRANT PENDING the signatures its tier requires, with pending: { required, signed_by }), evidence (the book’s evidence audit behind the assessment: draws, what counts, what was set aside and why, surveillance findings, canaries, reviewers; null when the tier declares none), book (chain status), verified, note, and the full assessment.' },
          '400': { description: 'Bad workflow id.' },
          '401': { description: 'Unauthorized.' },
          '404': { description: 'Not a workflow of the caller’s tenant, or not the managed tier (no ledger).' },
          '409': { description: 'The settings on record are refused by the policy (an undeclared tier, a grant made under other settings): a person’s to correct. Or the book of record does not verify: a tampered, mis-signed or unanchored book grants nothing, and no rung is read from it.' },
        },
      },
    },
    '/v1/queue/{workflow}': {
      get: {
        summary: '(managed tier) The reviewer’s queue for a workflow: every item drawn for review (a random, chain-seeded draw anyone can re-derive) and not yet reviewed, oldest period first, each with the date it is due by.',
        description: 'Read from the caller’s book of record under the deployment’s declared policy. The draw rates follow the tier: the GRANT in force’s, else the deployment’s declared tier for the workflow. With no policy, no tier, or a tier without a sampling plan, nothing is drawn and the note says so. An item left unreviewed past its due date is a deviation: under autonomy it raises an urgent, failure-basis demotion proposal.',
        parameters: [{ name: 'workflow', in: 'path', required: true, schema: { type: 'string' }, description: 'The workflow id, tenant/ruleset@version, URL-encoded (e.g. acme%2Finvoice%400.0.1).' }],
        responses: {
          '200': { description: 'ReviewQueueSurface: tenant_id, workflow_id, policy (id, version, hash; null when none), consequence_tier, items [{ verdict_id, stratum (PASS | FAIL), period_start, due_by, rung }], count, note.' },
          '400': { description: 'Bad workflow id.' },
          '401': { description: 'Unauthorized.' },
          '404': { description: 'Not a workflow of the caller’s tenant, or not the managed tier (no ledger).' },
          '409': { description: 'The book of record does not verify (no draw is read from it), or the settings on record are refused by the policy (a tier it does not declare, a grant made under another policy).' },
        },
      },
    },
    '/v1/ledger/stats': { get: { summary: '(managed tier) Verdict counts + real-world overturn rate for the caller’s tenant.', responses: { '200': { description: 'LedgerStats.' }, '401': { description: 'Unauthorized.' } } } },
    '/v1/ledger/report': { get: { summary: '(managed tier) The tenant book-of-record report (Markdown): volume, overturn, calibration, what Riposte is asking for this month (open proposals with their rulings; FAIL / INSUFFICIENT_DATA notices by rung), tamper-evidence.', responses: { '200': { description: 'tenant_id + markdown.' }, '401': { description: 'Unauthorized.' } } } },
    '/v1/ledger/calibration': { get: { summary: '(managed tier) Per-rule human-overturn calibration + the flagged review queue.', responses: { '200': { description: 'CalibrationReport.' }, '401': { description: 'Unauthorized.' } } } },
  },
} as const

/**
 * The routes only the managed tier serves, and only with a book of record (createService({ ledger })): the pure core answers
 * each of them 404 with words, or does not know them at all. 2026-10-05: an outside engineer found the spec of
 * `verify serve` advertising /v1/ledger/* routes that server answers 404, so each server now describes only what it serves.
 */
export const MANAGED_PATHS: readonly string[] = ['/v1/grant/cosign', '/v1/voice/{workflow}', '/v1/queue/{workflow}', '/v1/ledger/stats', '/v1/ledger/report', '/v1/ledger/calibration']

/**
 * The OpenAPI description of one server. `ledger`: the managed tier with a book of record, which serves every route in OPENAPI.
 * Without one (the pure core, `verify serve`, or the managed tier with no ledger) MANAGED_PATHS are omitted and the description
 * says so. Deterministic; OPENAPI lists every route.
 */
export function openapiFor(o: { ledger?: boolean } = {}): Omit<typeof OPENAPI, 'info' | 'paths'> & { info: { title: string; version: string; description: string }; paths: Partial<typeof OPENAPI.paths> } {
  if (o.ledger) return OPENAPI
  const paths = Object.fromEntries(Object.entries(OPENAPI.paths).filter(([p]) => !MANAGED_PATHS.includes(p))) as Partial<typeof OPENAPI.paths>
  return {
    ...OPENAPI,
    info: { ...OPENAPI.info, description: `${OPENAPI.info.description} This server holds no book of record, so the routes that need one (${MANAGED_PATHS.join(', ')}) are not served here and not listed.` },
    paths,
  }
}
