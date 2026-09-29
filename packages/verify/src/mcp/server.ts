/**
 * MCP server — expose the verifier as a tool any agent (Claude, Cursor, a customer's own) can call before it acts.
 *
 * This is the "agent pre-action verification layer" made concrete: an agent about to post a payment or file a brief
 * calls `verify_document` and gets back a PASS / FAIL / can't-tell proof object it can gate the action on.
 *
 * Dependency-free by design — a minimal, compliant JSON-RPC 2.0 handler over newline-delimited stdio. No SDK, so the
 * package keeps a single runtime dependency. Swap in the official MCP SDK later
 * without changing `verify()` or the tool contracts.
 *
 * `handleRequest` is pure w.r.t. I/O (it only calls `verify`, which is itself pure but for an injectable clock), so it
 * is unit-tested directly; `stdio.ts` is the thin transport around it.
 *
 * Earned voice and the structured twin (their JSON adapters are shared with the HTTP surface, ../http/surfaces.ts):
 *   voice_assess    a workflow's rung (ALWAYS the one a person granted) and any open proposal, from a chain export;
 *                   with from_book the rung is read from the chain's GRANT in force, never from a flag
 *   opinion_render  the courtroom opinion (a dispute, or a voice question): COUNSEL, never a VERDICT
 *   verify_twin     extracted values vs the filing's own inline-XBRL facts: a standard, replayable VERDICT
 *   action_check    one proposed tool call at a rung: {verdict, notice, disposition} (POST /v1/action/check)
 *   reconcile_completeness  the book (a chain export) against the customer's payment population (POST /v1/reconcile)
 *   succession_replay       the replay reviewed before carrying a grant to a new ruleset version (POST /v1/succession/replay)
 *   grant_cosign    dual authorization: the unsigned GRANT_COSIGN to sign, or a signed one checked at the ledger's door on
 *                   the chain export and the chain line to append (the managed tier: POST /v1/grant/cosign)
 * The server holds no state: the book of record arrives as the chain export (ledger.chainJSONL()) in the arguments.
 */

import { verify, type VerifyOptions } from '../verify.js'
import { verifyAction, type ActionSources, type ProposedAction } from '../action/index.js'
import { verifyCitations, type Citation, type OpinionSources } from '../legal/index.js'
import { verifyInvoiceMatch, splitApLayout, type ApDocuments } from '../ap/index.js'
import { verifyDeclarative } from '../declarative/evaluate.js'
import { isDeclarativeRuleset, type DeclarativeRuleset } from '../declarative/types.js'
import { verifyAgainstSource } from '../textmatch/index.js'
import { mineRules, caseTableFromRows } from '../mine/index.js'
import type { MineOptions, MineSchema } from '../mine/types.js'
import { ENGINE_VERSION } from '../version.js'
import { voiceFromJson, opinionFromJson, twinFromJson, actionCheckFromJson, reconcileFromJson } from '../http/surfaces.js'
import { successionFromJson } from '../http/succession.js'
import { opinionJSON } from '../opinion/index.js'
import { cosignFromJson } from '../http/cosign.js'

export const PROTOCOL_VERSION = '2025-06-18'
export const SERVER_INFO = { name: 'verify', version: ENGINE_VERSION } as const

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: unknown
}
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const TOOLS = [
  {
    name: 'verify_document',
    description:
      'Deterministically verify an already-extracted document (invoice or construction pay application). Returns a ' +
      'replayable proof object: per-claim PASS / FAIL / INSUFFICIENT_DATA with the operands and their provenance. ' +
      'Never guesses — a field it cannot verify abstains with a reason. Call this before acting on extracted numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        extraction: { type: 'object', description: 'The already-extracted document data (from any extractor or your own LLM).' },
        ruleset: { type: 'string', enum: ['invoice', 'pay-app'], description: 'Which ruleset to apply. Default "invoice".' },
        references: {
          type: 'object',
          description: 'Optional reference documents for cross-checks.',
          properties: {
            contract: { type: 'object' },
            evidence: { type: 'array', items: { type: 'object' } },
            history: { type: 'array', items: { type: 'object' }, description: 'Prior documents of the same kind (e.g. the previous pay application).' },
          },
        },
        source: {
          type: 'object',
          description: 'The source document text, for the "does it appear in the document" axis (digital-born text).',
          properties: {
            text: { type: 'string' },
            quotes: { type: 'array', items: { type: 'object' } },
            values: { type: 'array', items: { type: 'object' } },
          },
          required: ['text'],
        },
      },
      required: ['extraction'],
    },
  },
  {
    name: 'verify_quotes',
    description:
      'Given a source document\'s text and a list of quotations (and/or numeric values), check whether each appears ' +
      'VERBATIM in the source. A quote whose citation points at real text but whose words differ FAILs and returns the ' +
      'passage the source actually carries. Use for legal cite-checking and for confirming an extracted value is really ' +
      'in the document. Whether a source stands for a proposition is NOT decided here (that is semantic).',
    inputSchema: {
      type: 'object',
      properties: {
        source_text: { type: 'string' },
        quotes: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, quote: { type: 'string' }, label: { type: 'string' } }, required: ['id', 'quote'] },
        },
        values: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, value: { type: 'number' }, field: { type: 'string' } }, required: ['id', 'value', 'field'] },
        },
      },
      required: ['source_text'],
    },
  },
  {
    name: 'verify_action',
    description:
      'Before an AI agent executes a consequential action (move money, file a document, submit a claim), verify every ' +
      'value it is about to use is GROUNDED — that each amount, code, account number or id traces to an approved source ' +
      '(an allow-list of permitted values, or the source document the agent read). A schema check proves an argument is ' +
      'well-formed; this proves it was not invented. Returns PASS / FAIL / can\'t-tell with a replayable proof; execute ' +
      'only on PASS. Does NOT judge planning, permissions, or destructive-action safety.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'object',
          description: 'The proposed action.',
          properties: { tool: { type: 'string' }, arguments: { type: 'object' } },
          required: ['tool', 'arguments'],
        },
        sources: {
          type: 'object',
          description: 'What counts as an approved source for the argument values.',
          properties: {
            text: { type: 'string', description: 'The source document text the agent read.' },
            allowed: { type: 'object', description: 'Per-argument allow-lists of approved values, keyed by argument name.' },
            require: { type: 'array', items: { type: 'string' }, description: 'Which arguments must be grounded (default: all scalar arguments).' },
          },
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'verify_citations',
    description:
      'Cite-check a legal brief: for each citation, verify the quoted passage appears VERBATIM in the supplied opinion ' +
      'text. Catches the failure existence-checkers miss — a real case quoted for words it does not contain (a misquote ' +
      'FAILs and returns what the opinion actually says). Whether a case STANDS FOR a proposition is semantic and is a ' +
      'declared abstention, not a verdict. Florida and California now require this verification.',
    inputSchema: {
      type: 'object',
      properties: {
        citations: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, cite: { type: 'string' }, case_name: { type: 'string' }, quote: { type: 'string' }, proposition: { type: 'string' }, source_key: { type: 'string' } }, required: ['id'] },
        },
        sources: { type: 'object', description: 'Opinion texts keyed by cite / case_name / source_key.' },
      },
      required: ['citations'],
    },
  },
  {
    name: 'verify_invoice_match',
    description:
      'Accounts-payable three-way match BEFORE paying: invoice (free text, as received) vs the ERP purchase order vs the ' +
      'goods receipt. Checks, in order: PO number matches; no line bills more than was received; no unit price more than ' +
      '2% over the PO; the stated total adds up (freight only if the PO allows it). Returns decision = approve | hold_no_po | ' +
      'hold_quantity | hold_price | hold_total | abstain, payable (true/false/null), the six-field grounding (what is wrong ' +
      'and where), and a replayable proof object. Deterministic — no model. ABSTAINS instead of guessing when it cannot read ' +
      'the documents unambiguously; route those to a human. Pass either {invoice, purchase_order, goods_receipt} or {layout}.',
    inputSchema: {
      type: 'object',
      properties: {
        invoice: { type: 'string', description: 'The invoice as received (email body / text).' },
        purchase_order: { type: 'string', description: 'ERP purchase order text: "PO-123 | Vendor: … | Freight: …" + numbered lines "N. item | qty Q | unit USD P".' },
        goods_receipt: { type: 'string', description: 'ERP goods receipt text: numbered lines "N. item | received R".' },
        layout: { type: 'string', description: 'Alternatively, all three in one text: INVOICE MESSAGE … PURCHASE ORDER (ERP) … GOODS RECEIPT (ERP) ….' },
        price_tolerance: { type: 'number', description: 'Max fractional unit-price overcharge (default 0.02).' },
      },
    },
  },
  {
    name: 'verify_declared',
    description:
      'Verify a document against a DECLARATIVE ruleset supplied as JSON — teach the checker a new document type (any ' +
      'language, any table that must foot) with no code: field aliases per role, computed formulas, and checks. Returns ' +
      'the same PASS / FAIL / can\'t-tell proof object. Use this to check document types the built-in rulesets don\'t cover.',
    inputSchema: {
      type: 'object',
      properties: {
        extraction: { type: 'object', description: 'The already-extracted document data.' },
        ruleset: {
          type: 'object',
          description: 'The declarative ruleset: { id, version, lineArrayKeys?, fields, computed?, checks, tolerance? }.',
          properties: {
            id: { type: 'string' }, version: { type: 'string' },
            fields: { type: 'object' }, computed: { type: 'object' }, checks: { type: 'array' },
          },
          required: ['id', 'version', 'fields', 'checks'],
        },
      },
      required: ['extraction', 'ruleset'],
    },
  },
  {
    name: 'mine_rules',
    description:
      'Propose the rules behind a set of labelled decisions (rule mining). Give it cases {id, label, fields, lines?} and a ' +
      'schema {approve, fields, lines?} that types each field and says which label means APPROVE. It returns CANDLES: ' +
      'candidate rules that explain the non-approved cases, each with its exact grounding p-value. It returns the MORGUE: ' +
      'every rejected candidate and why it died. It returns a compiled declarative ruleset that verify_declared can enforce. ' +
      'Deterministic, no model. Candles are proposals for a human to ratify, never rules on their own.',
    inputSchema: {
      type: 'object',
      properties: {
        cases: { type: 'array', items: { type: 'object', required: ['id', 'label', 'fields'], properties: { id: { type: 'string' }, label: { type: 'string' }, fields: { type: 'object' }, lines: { type: 'array', items: { type: 'object' } } } } },
        schema: { type: 'object', required: ['approve', 'fields'], properties: { approve: {}, fields: { type: 'object' }, lines: { type: 'object' } } },
        max_approved_violation_rate: { type: 'number', description: 'Tolerate this fraction of approved exceptions per rule (default 0).' },
        thresholds: { type: 'boolean', description: 'Also learn a constant per numeric document field (X <= c, X >= c). Default false.' },
        ruleset_id: { type: 'string', description: 'Id for the compiled ruleset (default "mined").' },
      },
      required: ['cases', 'schema'],
    },
  },
  {
    name: 'voice_assess',
    description:
      'A workflow\'s earned voice, read from the book of record: the rung it runs at (record | advise | gate | autonomy), ' +
      'which is ALWAYS the rung a person granted (Riposte never changes it), and any open proposal: a PROMOTION one rung ' +
      'up when the reviewed evidence clears the declared bar, or an URGENT DEMOTION one rung down, with the failing cases ' +
      'listed for dispute, when it no longer does. A proposal waits for a person. The chain\'s content is re-hashed first; ' +
      'nothing is proposed from a chain that fails. The policy\'s bars are a business decision: there is no default. ' +
      'Returns basis (an open demotion\'s: failure = urgent, unevidenced = a standing notice) and, when the rung is read ' +
      'from the book, evidence (the evidence audit: draws, what counts, what was set aside and why, surveillance findings, ' +
      'canaries). Deterministic, no model.',
    inputSchema: {
      type: 'object',
      properties: {
        ledger: { type: ['string', 'object'], description: 'The book of record: the chain export (ledger.chainJSONL(), one event per line with its payload) as a string, or { events, payloads }.' },
        policy: { type: 'object', description: 'The declared promotion policy (promotion-policy-v0): the bound method and, per consequence tier, the bars for advise, gate and autonomy.' },
        workflow_id: { type: 'string', description: 'tenant/ruleset@version, e.g. "acme/invoice@0.0.1".' },
        consequence_tier: { type: 'string', description: 'The workflow\'s declared consequence tier (a tier in the policy). Optional when a grant names one.' },
        granted: { type: 'string', enum: ['record', 'advise', 'gate', 'autonomy'], description: 'The rung a person granted (default record).' },
        grant: { type: 'object', description: 'The person\'s grant record {level, signer_id, signed_at, policy, consequence_tier}: the assessment then runs under exactly the settings it names.' },
        bounds: { type: 'string', description: 'The bounds autonomy acts within, in words (e.g. "PO-matched invoices under $5,000").' },
        from_book: { type: 'boolean', description: 'Read the rung, tier, bounds and policy version from the GRANT in force on the book (a person\'s signed decision), cited in assessment.book; a proposal a person declined is held back until the evidence changes. granted / grant / bounds are then refused; consequence_tier only while nothing is granted.' },
        trusted_keys: { type: 'object', description: 'With from_book: { "<signer_id>": "<public key PEM>" | [...] }. A chain export carries no anchors: without trusted_keys or root_keys every decision on it is unanchored and has NO effect on the rung (D-ANCHOR); each is listed in no_effect with its notice.' },
        root_keys: { type: ['string', 'array'], items: { type: 'string' }, description: 'With from_book: the root public key(s) (PEM); the key registry on the book anchors the signers it registers.' },
      },
      required: ['ledger', 'policy', 'workflow_id'],
    },
  },
  {
    name: 'action_check',
    description:
      'Check one proposed tool call at a rung, before it runs: every consequential argument value is grounded against the ' +
      'declared sources (verify_action; approved records bind values that belong together, so a mix-and-match FAILs), ' +
      'and the rung decides what happens to the call. Returns the disposition: hold (a ' +
      'FAIL or ABSTAIN at gate/autonomy: it waits for a person), review (a PASS at gate: a person reviews it), surface (a ' +
      'FAIL or ABSTAIN at advise: shown in-flow, not held), record (at record: a notice, not held), or proceed; plus the ' +
      'replayable verdict and the notice (every FAIL/ABSTAIN with its evidence and its own dispute path). The rung is ' +
      'the one a person granted: pass it as level (default record). Deterministic, no model.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'object',
          description: 'The proposed tool call.',
          properties: { tool: { type: 'string' }, arguments: { type: 'object' } },
          required: ['tool'],
        },
        sources: {
          type: 'object',
          description: 'What counts as an approved source for the argument values.',
          properties: {
            text: { type: 'string', description: 'The source document text the agent read.' },
            allowed: { type: 'object', description: 'Per-argument allow-lists of approved values, keyed by argument name.' },
            // the same field, rule and text as POST /v1/action/check (src/http/openapi.ts); both validate through actionFromJson
            records: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: { type: ['string', 'number'] } },
              description: 'Approved records: each one argument values approved together (e.g. one invoice\'s amount and payee account); every record names the same arguments. The arguments they name are grounded only when they all equal ONE record: a value approved for one record combined with another record\'s value FAILs (mix-and-match), and a partial tuple (a record-named argument missing) abstains. Verdicts that use records name rule action@0.1.0.' },
            require: { type: 'array', items: { type: 'string' }, description: 'Which arguments must be grounded (default: all scalar arguments).' },
          },
        },
        level: { type: 'string', enum: ['record', 'advise', 'gate', 'autonomy'], description: 'The rung a person granted the workflow (default record, the day-1 default).' },
      },
      required: ['action'],
    },
  },
  {
    name: 'opinion_render',
    description:
      'Render the courtroom opinion over the book of record: the question, the candidate readings with cited cells, the ' +
      'authorities quoted, precedent, the footing consequences of each reading, the ruling and its scope, the steelmanned ' +
      'dissent and what would overturn it, plus every premise with the replayable ids it cites and the Riposte check that ' +
      'verified it (if a premise fails, the opinion is WITHHELD: it proposes nothing). Two questions: a DISPUTE of one ' +
      'recorded verdict ({dispute: {verdict_id, claim_id?}}: FACT replays, LAW goes to a person; UPHOLD or REFER), or a ' +
      'VOICE question for a workflow (a proposal from voice_assess, or the workflow and its settings: PROMOTE, NOT_YET, ' +
      'RETAIN or an urgent DEMOTE). An opinion is COUNSEL: generated, dismissible, never a VERDICT. It proposes; a person ' +
      'decides. Returns the Markdown (or JSON) text and the opinion as structured content. Deterministic, no model, no clock.',
    inputSchema: {
      type: 'object',
      properties: {
        ledger: { type: ['string', 'object'], description: 'The book of record: the chain export (ledger.chainJSONL()) as a string, or { events, payloads }.' },
        dispute: {
          type: 'object',
          description: 'A dispute of one recorded verdict (every FAIL notice carries its verdict_id and claim_id).',
          properties: { verdict_id: { type: 'string' }, claim_id: { type: 'string', description: 'Default: the claim that drove the verdict\'s outcome.' } },
          required: ['verdict_id'],
        },
        inputs: { description: 'For a dispute: the verdict\'s original inputs, to also verify the verdict is FOR them (input binding).' },
        policy: { type: 'object', description: 'For a voice question: the declared promotion policy (promotion-policy-v0).' },
        proposal: { type: 'object', description: 'For a voice question: a proposal from voice_assess to argue. It must be exactly what the evidence produces, or the opinion is withheld.' },
        workflow_id: { type: 'string', description: 'For a voice question without a proposal: tenant/ruleset@version.' },
        consequence_tier: { type: 'string' },
        granted: { type: 'string', enum: ['record', 'advise', 'gate', 'autonomy'] },
        grant: { type: 'object' },
        bounds: { type: 'string' },
        format: { type: 'string', enum: ['markdown', 'json'], description: 'The text content: the rendered opinion (default) or its JSON. The structured content is always the opinion JSON.' },
        tenant_id: { type: 'string', description: 'Read one tenant\'s records and decisions only (a chain shared by several tenants): precedent, evidence and grants are that tenant\'s own; the chain is still verified whole.' },
        from_book: { type: 'boolean', description: 'For a voice question: read the rung, tier and bounds from the GRANT in force on the book (verify opinion --from-book); give workflow_id, and consequence_tier only while nothing is granted.' },
        trusted_keys: { type: 'object', description: '{ "<signer_id>": "<public key PEM>" | [...] }: anchor the signers of the decisions on the chain. A chain export carries no anchors: without them its GRANTs and DECLINEs have no effect (D-ANCHOR), and the opinion names each one.' },
        root_keys: { type: ['string', 'array'], items: { type: 'string' }, description: 'The root public key(s) (PEM): the key registry on the book anchors the signers it registers.' },
      },
      required: ['ledger'],
    },
  },
  {
    name: 'verify_twin',
    description:
      'Structured-twin check: judge extracted financial-statement values against the filing\'s OWN binding structured ' +
      'record, its inline-XBRL facts, never a table re-read from the HTML. Each claim {id, field, value} binds through a ' +
      'declared concept / period / scale map (25 fields: assets, revenue, net_income, cash_from_operations, …). PASS on a ' +
      'match; FAIL with a diagnosis (SCALE, PERIOD, CONCEPT, DIMENSION, UNLOCATED); ABSTAIN with an explicit reason ' +
      '(absence proves nothing). Returns {verdict, judgments, twin}: a standard replayable Verdict plus the per-claim ' +
      'judgments. ruleset 0.2 (map_version 0.2.0) binds only concepts the filing\'s presentation linkbase places on a face ' +
      'statement (supply pre / filing_summary / schema, or presentation). Deterministic, no network.',
    inputSchema: {
      type: 'object',
      properties: {
        html: { type: 'string', description: 'The filing\'s primary inline-XBRL document (the .htm), as text.' },
        period_end: { type: 'string', description: 'The fiscal period end, YYYY-MM-DD.' },
        claims: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, field: { type: 'string' }, value: { type: 'number' } }, required: ['id', 'field', 'value'] },
        },
        tolerance: { type: 'number', description: 'Absolute tolerance on magnitudes (default 0.5, whole currency units).' },
        period_tolerance_days: { type: 'number', description: 'How far a context date may sit from period_end (default 7: 52/53-week years).' },
        map_version: { type: 'string', enum: ['0.1.0', '0.2.0', '0.2.1'], description: '0.1.0 (default): whole-document binding. 0.2.0: statement-anchored binding through the presentation linkbase, decimals-aware matching. 0.2.1 (opt-in): 0.2 plus concept families, the cash roll as tie-break (ABSTAIN AMBIGUOUS_LINE = AMBIGUOUS_REFERENCE when undecided), and a strict linkbase reading; it FAILED its pre-registered held-out check (2026-09-28), stated in every result\'s map_status.' },
        ruleset: { type: 'string', enum: ['0.1', '0.2', '0.2.1', '0.1.0', '0.2.0'], description: 'The twin ruleset (the CLI\'s --ruleset): 0.1 = map 0.1.0 (default), 0.2 = map 0.2.0, 0.2.1 = map 0.2.1 (opt-in, prereg FAIL stated). With map_version too, the two must agree.' },
        pre: { type: 'string', description: 'For ruleset 0.2, flat: the presentation linkbase (*_pre.xml). Without pre or schema every claim abstains NO_PRESENTATION_LINKBASE.' },
        filing_summary: { type: 'string', description: 'For ruleset 0.2, flat: EDGAR FilingSummary.xml.' },
        schema: { type: 'string', description: 'For ruleset 0.2, flat: the extension schema (*.xsd); its embedded linkbase is read when there is no pre.' },
        presentation: {
          type: 'object',
          description: 'For map 0.2.0: the filing\'s presentation texts, nested (or pass pre / filing_summary / schema flat: one way, not both).',
          properties: { pre: { type: 'string', description: 'The presentation linkbase (*_pre.xml).' }, filing_summary: { type: 'string', description: 'EDGAR FilingSummary.xml.' }, schema: { type: 'string', description: 'The extension schema (*.xsd).' } },
        },
        producer: { type: 'string', description: 'Who produced the extraction (recorded, never trusted).' },
      },
      required: ['html', 'period_end', 'claims'],
    },
  },
  {
    name: 'reconcile_completeness',
    description:
      'Completeness reconciliation: did every payment go through the control? Reconciles the book of record (a chain export) ' +
      'against the customer\'s payment population (an AP payment register or GL payments extract, CSV or JSONL). The whole book ' +
      'is verified first; then every row lands in one class (MATCHED, MISMATCHED, PAID_DESPITE_HOLD = a payment the control held ' +
      'and nobody reviewed before it was paid, CHECKED_AFTER_PAYMENT, AMBIGUOUS, BYPASSED = no verdict for it, UNREADABLE) and every ' +
      'in-period verdict in one (MATCHED, ORPHAN, AMBIGUOUS, UNKEYED). Declared, never guessed. Returns the Markdown (or JSON) ' +
      'text and the report as structured content; report_hash is clock-free. It proves the book covers the population given, not ' +
      'that the population is complete.',
    inputSchema: {
      type: 'object',
      properties: {
        ledger: { type: ['string', 'object'], description: 'The book of record: the chain export (ledger.chainJSONL()) as a string, or { events, payloads }.' },
        population: {
          type: ['object', 'array'],
          description: '{ format: "csv" | "jsonl", text | base64, delimiter? } (the export itself; base64 binds its exact bytes), or { rows: [...] }, or an array of row objects.',
        },
        mapping: { type: 'object', description: 'The declared completeness mapping (completeness-mapping-v0): key fields, population columns, book field sources, normalization, tolerances.' },
        extractions: { type: 'array', description: 'The checked extractions (or proposed actions) for extraction book sources; each is used only if its hash is on the book.' },
        tenant_id: { type: 'string', description: 'Read one tenant\'s records only (a chain shared by several tenants).' },
        workflows: { type: 'array', items: { type: 'string' } },
        rulesets: { type: 'array', items: { type: 'string' } },
        period: { type: 'object', properties: { since: { type: 'string' }, until: { type: 'string' } } },
        rungs: { type: 'object', description: 'A declared rung per workflow, used only for a workflow with no anchored GRANT on the book.' },
        interval: { type: 'object' },
        include_matched: { type: 'boolean' },
        trusted_keys: { type: 'object', description: '{ "<signer_id>": "<public key PEM>" | [...] }: anchor the chain\'s signers. Without anchors a GRANT has no effect on any rung.' },
        root_keys: { type: ['string', 'array'], items: { type: 'string' }, description: 'The root public key(s) (PEM): the key registry on the book anchors the signers it registers.' },
        policy: { type: 'object', description: 'The declared promotion policy: the rung a record was held at is read with the GRANTs it admits (tier, max_rung, the signatures autonomy needs), whatever policy a grant names.' },
        format: { type: 'string', enum: ['markdown', 'json'], description: 'The text content: the rendered report (default) or its JSON. The structured content is always the report.' },
      },
      required: ['ledger', 'population', 'mapping'],
    },
  },
  {
    name: 'succession_replay',
    description:
      'Carrying a grant to a new ruleset version: a new version is a new workflow and starts at record, and only a person carries ' +
      'the grant in force, with a signed GRANT that carries this replay. Without "check": the grant in force on "from" (under ' +
      '"policy" when given), and every verdict recorded under "from" re-performed under the "to" ruleset with the inputs supplied: ' +
      'counts, each change and its direction, how many loosen (a change to PASS needs its own stated reason), and each verdict not ' +
      're-performed with why. With "signer_id", "reason" and "policy": also the unsigned GRANT, to be signed where the person\'s key ' +
      'lives (no private key is ever passed here). With "check" (a succession GRANT\'s decision id): its signed replay re-performed ' +
      'over its own span; ok when byte-identical. Read-only: nothing is appended.',
    inputSchema: {
      type: 'object',
      properties: {
        ledger: { type: ['string', 'object'], description: 'The book of record: the chain export (ledger.chainJSONL()) as a string, or { events, payloads }.' },
        inputs: { type: ['array', 'object'], description: '[{ verdict_id, inputs }] or { "<verdict_id>": inputs }: the inputs each recorded verdict was issued on.' },
        from: { type: 'string', description: '<tenant>/<ruleset>@<old version>' },
        to: { type: 'string', description: '<tenant>/<ruleset>@<new version>' },
        check: { type: 'string', description: 'A succession GRANT\'s decision id (or a unique prefix of 12+ hex characters).' },
        ruleset: { type: 'object', description: 'The new version as a declarative ruleset, when this build does not hold it.' },
        tolerance: { type: 'object', description: '{ rel, absCap }: the rounding-tolerance override the old verdicts were issued under.' },
        policy: { type: 'object', description: 'The declared promotion policy: the grant in force is read under it.' },
        signer_id: { type: 'string' },
        reason: { type: 'string' },
        loosening_reason: { type: 'string' },
        level: { type: 'string', enum: ['record', 'advise', 'gate', 'autonomy'] },
        signed_at: { type: 'string' },
        note: { type: 'string' },
        trusted_keys: { type: 'object', description: '{ "<signer_id>": "<public key PEM>" | [...] }: anchor the chain\'s signers.' },
        root_keys: { type: ['string', 'array'], items: { type: 'string' }, description: 'The root public key(s) (PEM).' },
      },
      required: ['ledger', 'inputs'],
    },
  },
  {
    name: 'grant_cosign',
    description:
      'Dual authorization: a second person\'s signature on a GRANT whose tier requires more than one (grant_signatures). Until it ' +
      'is co-signed the grant is PENDING: on the book, with no effect on any rung. Without "cosign" this returns the unsigned ' +
      'GRANT_COSIGN for "grant" and "signer_id", to be signed with the co-signer\'s own key where it lives (no private key is ever ' +
      'passed here). With "cosign" (the signed GRANT_COSIGN) it is put through the ledger\'s door on the chain export, under the ' +
      'anchors given, and the chain line to append is returned. The door refuses a co-signature that would not count: the grant\'s ' +
      'own signer or key, a repeat signer or key, an unanchored or revoked co-signer, a superseded grant. Also returns the grant\'s ' +
      'signatures, whether it is in force, and any pending notice, read under "policy" when given.',
    inputSchema: {
      type: 'object',
      properties: {
        ledger: { type: ['string', 'object'], description: 'The book of record: the chain export (ledger.chainJSONL()) as a string, or { events, payloads }.' },
        grant: { type: 'string', description: 'The grant\'s decision id (or a unique prefix of 12+ hex characters). With "cosign", the one it names.' },
        signer_id: { type: 'string', description: 'The co-signer (without "cosign").' },
        signed_at: { type: 'string', description: 'When the co-signer signs (ISO-8601; without "cosign"; default now).' },
        note: { type: 'string' },
        cosign: { type: 'object', description: 'The signed GRANT_COSIGN: { decision, alg, public_key, signature, decision_id }.' },
        policy: { type: 'object', description: 'The declared promotion policy: a GRANT of autonomy needs at least its tier\'s grant_signatures, whatever policy the grant names.' },
        trusted_keys: { type: 'object', description: '{ "<signer_id>": "<public key PEM>" | [...] }: anchor the chain\'s signers.' },
        root_keys: { type: ['string', 'array'], items: { type: 'string' }, description: 'The root public key(s) (PEM): the key registry on the book anchors the signers it registers.' },
      },
      required: ['ledger'],
    },
  },
] as const

function ok(id: JsonRpcResponse['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}
function err(id: JsonRpcResponse['id'], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}
const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

/** MCP tool result carrying both a text rendering and the structured verdict. */
function toolResult(structured: unknown): unknown {
  return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured as Record<string, unknown>, isError: false }
}

function callTool(name: string, args: unknown): unknown {
  if (!isObj(args)) throw new Error('tool arguments must be an object')
  if (name === 'verify_document') {
    if (!isObj(args.extraction)) throw new Error('verify_document requires an "extraction" object')
    const opts: VerifyOptions = {}
    if (args.ruleset === 'invoice' || args.ruleset === 'pay-app') opts.ruleset = args.ruleset
    if (isObj(args.references)) opts.references = args.references as VerifyOptions['references']
    if (isObj(args.source)) opts.source = args.source as VerifyOptions['source']
    return toolResult(verify(args.extraction, opts))
  }
  if (name === 'verify_quotes') {
    if (typeof args.source_text !== 'string') throw new Error('verify_quotes requires "source_text"')
    const quotes = Array.isArray(args.quotes) ? (args.quotes as { id: string; quote: string; label?: string }[]) : []
    const values = Array.isArray(args.values) ? (args.values as { id: string; value: number; field: string }[]) : []
    return toolResult(verifyAgainstSource(args.source_text, quotes, values))
  }
  if (name === 'verify_action') {
    if (!isObj(args.action) || typeof (args.action as Record<string, unknown>).tool !== 'string') throw new Error('verify_action requires an "action" with a "tool" and "arguments"')
    const sources: ActionSources = isObj(args.sources) ? (args.sources as ActionSources) : {}
    return toolResult(verifyAction(args.action as unknown as ProposedAction, sources))
  }
  if (name === 'verify_citations') {
    if (!Array.isArray(args.citations)) throw new Error('verify_citations requires a "citations" array')
    const sources: OpinionSources = isObj(args.sources) ? (args.sources as OpinionSources) : {}
    return toolResult(verifyCitations(args.citations as Citation[], sources))
  }
  if (name === 'verify_invoice_match') {
    const docs: ApDocuments | null = typeof args.layout === 'string' ? splitApLayout(args.layout)
      : (typeof args.invoice === 'string' && typeof args.purchase_order === 'string' && typeof args.goods_receipt === 'string')
        ? { invoice: args.invoice, purchase_order: args.purchase_order, goods_receipt: args.goods_receipt } : null
    if (!docs) throw new Error('verify_invoice_match requires {invoice, purchase_order, goods_receipt} strings or a {layout} string with the three ERP section markers')
    const policy = typeof args.price_tolerance === 'number' ? { price_tolerance: args.price_tolerance } : undefined
    return toolResult(verifyInvoiceMatch(docs, policy ? { policy } : {}))
  }
  if (name === 'mine_rules') {
    if (!Array.isArray(args.cases)) throw new Error('mine_rules requires a "cases" array')
    if (!isObj(args.schema)) throw new Error('mine_rules requires a "schema" object')
    const opts: MineOptions = {}
    if (typeof args.max_approved_violation_rate === 'number') opts.maxApprovedViolationRate = args.max_approved_violation_rate
    if (args.thresholds === true) opts.thresholds = true
    return toolResult(mineRules(caseTableFromRows(args.cases), args.schema as unknown as MineSchema, opts, typeof args.ruleset_id === 'string' ? { id: args.ruleset_id } : {}))
  }
  if (name === 'voice_assess') return toolResult(voiceFromJson(args))
  if (name === 'opinion_render') {
    if (args.format !== undefined && args.format !== 'markdown' && args.format !== 'json') throw new Error('opinion_render "format" must be markdown or json')
    const { opinion, markdown } = opinionFromJson(args)
    // The reading copy (or the JSON) as text; the opinion itself as structured content. It is COUNSEL, never a VERDICT.
    return { content: [{ type: 'text', text: args.format === 'json' ? opinionJSON(opinion) : markdown }], structuredContent: opinion as unknown as Record<string, unknown>, isError: false }
  }
  if (name === 'verify_twin') return toolResult(twinFromJson(args))
  if (name === 'action_check') return toolResult(actionCheckFromJson(args))
  if (name === 'reconcile_completeness') {
    if (args.format !== undefined && args.format !== 'markdown' && args.format !== 'json') throw new Error('reconcile_completeness "format" must be markdown or json')
    const { report, markdown } = reconcileFromJson(args)
    // The reading copy (or the JSON) as text; the report itself as structured content.
    return { content: [{ type: 'text', text: args.format === 'json' ? JSON.stringify(report, null, 2) : markdown }], structuredContent: report as unknown as Record<string, unknown>, isError: false }
  }
  if (name === 'grant_cosign') return toolResult(cosignFromJson(args))
  if (name === 'succession_replay') return toolResult(successionFromJson(args))
  if (name === 'verify_declared') {
    if (!isObj(args.extraction)) throw new Error('verify_declared requires an "extraction" object')
    if (!isDeclarativeRuleset(args.ruleset)) throw new Error('verify_declared requires a valid declarative "ruleset" (fields + checks, no compute)')
    return toolResult(verifyDeclarative(args.extraction, args.ruleset as DeclarativeRuleset))
  }
  throw new Error(`unknown tool: ${name}`)
}

/**
 * Handle one JSON-RPC message. Returns a response, or `null` for notifications (no id / notifications/*), which get no reply.
 */
export function handleRequest(req: JsonRpcRequest): JsonRpcResponse | null {
  const id = req.id ?? null
  const isNotification = req.id === undefined || req.method.startsWith('notifications/')

  try {
    switch (req.method) {
      case 'initialize':
        return ok(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO })
      case 'tools/list':
        return ok(id, { tools: TOOLS })
      case 'tools/call': {
        const p = req.params
        if (!isObj(p) || typeof p.name !== 'string') return err(id, -32602, 'invalid params: expected { name, arguments }')
        try {
          return ok(id, callTool(p.name, p.arguments))
        } catch (e) {
          // Tool-level failures are reported as an isError tool result, not a protocol error (per MCP).
          return ok(id, { content: [{ type: 'text', text: `verify error: ${(e as Error).message}` }], isError: true })
        }
      }
      case 'ping':
        return ok(id, {})
      default:
        if (isNotification) return null
        return err(id, -32601, `method not found: ${req.method}`)
    }
  } catch (e) {
    if (isNotification) return null
    return err(id, -32603, `internal error: ${(e as Error).message}`)
  }
}

export { TOOLS }
