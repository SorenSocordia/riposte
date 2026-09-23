/**
 * OpenAPI 3.1 description of the HTTP surface. Served at GET /v1/openapi.json. Kept deliberately compact — the verdict
 * schema's source of truth is `src/verdict/schema.ts` / `docs/VERDICT-SCHEMA-v0.md`; this documents the endpoints so an
 * SDK generator or an API console can consume them.
 */

import { ENGINE_VERSION } from '../version.js'

const verdictRef = { type: 'object', description: 'The Verdict proof object — see docs/VERDICT-SCHEMA-v0.md.' }
const jsonBody = (required: string[], props: Record<string, unknown>) => ({
  required: true,
  content: { 'application/json': { schema: { type: 'object', required, properties: props } } },
})
const verdictResponse = { '200': { description: 'A Verdict.', content: { 'application/json': { schema: verdictRef } } }, '400': { description: 'Bad request.' } }

export const OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'Verify — deterministic document & action verification',
    version: ENGINE_VERSION,
    description: 'Verify already-extracted document data and proposed agent actions. PASS / FAIL / INSUFFICIENT_DATA with a replayable proof. Never guesses.',
  },
  paths: {
    '/v1/health': { get: { summary: 'Health + engine version.', responses: { '200': { description: 'ok' } } } },
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
        requestBody: jsonBody(['extraction', 'ruleset'], { extraction: { type: 'object' }, ruleset: { type: 'object' } }),
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
    '/v1/verify/citations': {
      post: {
        summary: 'Cite-check: does each quotation appear verbatim in the supplied opinion text.',
        requestBody: jsonBody(['citations'], { citations: { type: 'array', items: { type: 'object' } }, sources: { type: 'object' } }),
        responses: verdictResponse,
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
    '/v1/ledger/stats': { get: { summary: '(managed tier) Verdict counts + real-world overturn rate for the caller’s tenant.', responses: { '200': { description: 'LedgerStats.' }, '401': { description: 'Unauthorized.' } } } },
    '/v1/ledger/report': { get: { summary: '(managed tier) The tenant book-of-record report (Markdown): volume, overturn, calibration, tamper-evidence.', responses: { '200': { description: 'tenant_id + markdown.' }, '401': { description: 'Unauthorized.' } } } },
    '/v1/ledger/calibration': { get: { summary: '(managed tier) Per-rule human-overturn calibration + the flagged review queue.', responses: { '200': { description: 'CalibrationReport.' }, '401': { description: 'Unauthorized.' } } } },
  },
} as const
