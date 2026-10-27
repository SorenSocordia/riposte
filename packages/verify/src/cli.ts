/**
 * `verify` CLI — the boring, shippable surface.
 *
 *   verify invoice.json                                   # built-in invoice ruleset
 *   verify payapp.json --ruleset pay-app --history prev.json
 *   verify invoice.json --ruleset peppol.json            # a DECLARATIVE ruleset from a JSON file
 *   verify invoice.json --contract contract.json --evidence receipt.json --source invoice.txt
 *   cat invoice.json | verify -                           # read the extraction from stdin
 *   verify lint --ruleset peppol.json                     # validate a declarative ruleset
 *   verify measure --ruleset peppol.json --labels set.json   # mint a measured DeclaredAccuracy
 *   verify mine cases.jsonl --schema schema.json          # mine candidate rules from labelled approve/hold cases
 *   verify mine invoice_cases.jsonl --ap --ruleset-out mined.json   # Distil-style AP cases → report + enforceable ruleset
 *   verify twin --html primary.htm --period-end 2024-12-31 --claims claims.json   # agent values vs the filing's iXBRL twin
 *   verify notice verdict.json --level gate               # one action at a rung: every FAIL/can't tell with evidence + dispute path
 *   verify voice --ledger chain.jsonl --policy policy.json --workflow acme/invoice@0.0.1 --tier low --granted gate
 *   verify voice --from-book --ledger chain.jsonl --policy policy.json --workflow acme/invoice@0.0.1   # the rung from the book
 *   verify opinion --ledger chain.jsonl --policy policy.json --proposal proposal.json   # the written opinion (Markdown)
 *   verify opinion --ledger chain.jsonl --dispute <verdict_id> [--claim <claim_id>] [--json]
 *   verify opinion --from-book --ledger chain.jsonl --policy policy.json --workflow acme/invoice@0.0.1 --trusted-keys keys.json
 *   verify replay verdict.json --extraction invoice.json  # RE-PERFORM the check; exit 0 only when the outcome is re-derived
 *   verify reconcile --ledger chain.jsonl --population payments.csv --mapping mapping.json --extractions docs.jsonl --md
 *   verify ledger repair chain.jsonl                      # a torn last line (a crash mid-append): back up, truncate, log it
 *   verify ledger export chain.jsonl --out copy.jsonl     # the chain export, streamed (never over a file)
 *   verify anchor checkpoint --ledger chain.jsonl --key witness.pem --signer auditor --out witness.jsonl   # sign the head, outside the book
 *   verify anchor verify --ledger chain.jsonl --witness witness.jsonl --trusted-keys witness-keys.json    # the book against its checkpoints
 *
 * A person's decisions on the book of record (signed Ed25519, appended through the ledger's door; src/ledger/decisions.ts):
 *   verify keygen --out owner.pem --signer owner                        # a local signing key (custody is the operator's)
 *   verify grant --ledger chain.jsonl --key owner.pem --signer owner --workflow acme/invoice@0.0.1 --level gate --tier low --policy policy.json
 *   verify succession --ledger chain.jsonl --from acme/invoice@0.0.1 --to acme/invoice@0.1.0 --inputs inputs.jsonl --reason "…" --signer owner --policy policy.json --root-keys root.pub.pem --dry-run
 *   verify decline --ledger chain.jsonl --key owner.pem --signer owner --policy policy.json --assessment voice.json --reason "month-end noise"
 *   verify revise-policy --ledger chain.jsonl --key owner.pem --signer owner --from policy.json --draft next.json --reason "…"
 *   verify revise-policy --ledger chain.jsonl --key owner.pem --signer owner --revised policy-0.2.0.json
 *   verify report --ledger chain.jsonl --policy policy.json --month 2026-09   # the day-1 audit report (Markdown)
 *   verify rule --ledger chain.jsonl --dispute <verdict_id> --ruling SET_ASIDE --reason "…" --key k.pem --signer lead >> rulings.jsonl
 *   verify statute --ledger chain.jsonl --rulings rulings.jsonl --rule SUM_INT --domain invoice   # precedent → COUNSEL
 *
 * Evidence integrity (src/ledger/{sampling,registry}.ts, src/surveillance/):
 *   verify sample commit --ledger chain.jsonl --policy policy.json --workflow acme/invoice@0.0.1   # daily: commit due draws
 *   verify queue --ledger chain.jsonl --policy policy.json --workflow acme/invoice@0.0.1          # a reviewer's queue
 *   verify review --sign --ledger chain.jsonl --key r.pem --signer ana --verdict <id> --decision UPHELD
 *   verify key register --ledger chain.jsonl --root root.pem --subject ana --public-key ana.pub.pem --roles reviewer
 *   verify canary seal --ledger chain.jsonl --key a.pem --signer ctl --workflow wf --verdicts id1,id2 --secret-out s.json
 *   verify policy lint --policy policy.json
 *
 * Prints JSON to stdout. Exit code: 0 = PASS/ok, 1 = FAIL/not-ok, 2 = INSUFFICIENT_DATA, 3 = usage/error.
 * `verify replay` reads 2 as "structure verified; outcome NOT re-performed" (DECISION R1-EXIT, 2026-09-28).
 * Deterministic (no clock in the output beyond issued_at). No network. The decision verbs are the exception: a decision is
 * clocked (signed_at defaults to now; the ledger stamps recorded_at), because it is a person's act at a time.
 * Nothing throws out of run(): an unexpected error is reported and exits 3.
 *
 * Every verb that reads a book reads it streamed (readChainFile: never as one string, so a book past the runtime's string
 * ceiling still reads). A torn last line (an append that did not finish) is read as the whole events before it, said on
 * stderr with the repair command, and refused by every verb that appends (exit 1). An unparseable line before the last
 * is corruption: refused (exit 1) everywhere.
 */

import { readFileSync, writeFileSync, existsSync, rmSync, statSync, readdirSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname, resolve as resolvePath, basename, relative, isAbsolute } from 'node:path'
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { verify, type VerifyOptions, type Json } from './verify.js'
import { isDeclarativeRuleset, type DeclarativeRuleset } from './declarative/types.js'
import { toleranceProblem, type TolerancePolicy } from './tolerance.js'
import { lintRuleset } from './declarative/lint.js'
import { measureRuleset, renderMeasurement, type LabeledCase } from './declarative/measure.js'
import type { Verdict } from './verdict/schema.js'
import { verifyReplay, declarativeReplayNeeds, replayNeedsSentence, replayRulesetRef, notReperformedFields, replayInputProblem, type ReplayCheck, type ReplayOptions } from './protocol/replay.js'
import { isReplayBundle, replayBundles, bundlesFromText, renderCaseReplay, replayReading, strictProblems, strictNotes, notABundleHint, presentedOf, renderGate, renderGateNow, renderAnyRuleNow, carriedKeys, carriedLine, allowedKeys, allowedLine, replayExit, replayAdvice, unknownKeys, unknownKeysReason, ALLOW_UNKNOWN_KEYS_LINE, ISSUED_AT_MISSING, AP_REPLAY_SCOPE, type GateReading } from './protocol/replay-case.js'
import { AP_DERIVED_KEYS, apDerivable, apDerivedKeysIn, checkApFields, apFieldsHeadline, apDifferenceLine, apFieldsBlock, type ApFieldsCheck } from './protocol/replay-ap.js'
import { legalScopeLines, parseRulesetRequirement, rulesetRequirementProblem, unappliedRequirements, type RulesetRequirement } from './legal/replay-notice.js'
import { decodeUtf8Strict, parseJsonStrict, HashInputRefused } from './protocol/hash-input.js'
import { ENGINE_VERSION, ENGINE_VERSIONS } from './version.js'
import { answerOf, renderRemedies } from './verdict/remedy.js'
import { apPolicyOf, parseTaxPolicy, verifyInvoiceMatch, splitApLayout, type ApDocuments, type ApPolicy, type PriorInvoice } from './ap/index.js'
import { apInputDocuments, apProofOf, validateApInput, verifyBillMatch } from './ap/structured.js'
import { formatApReport } from './ap/report.js'
import { formatPayAppReport } from './rulesets/pay-app/report.js'
import {
  mine, compileRuleset, apCasesToTable, AP_MINE_SCHEMA, parseJsonl, caseTableFromRows,
  type MineSchema, type MineReport, type CompiledRuleset, type DistilApCase,
} from './mine/index.js'
import {
  assessVoice, assessVoiceFromLedger, workflowCalibration, workflowCalibrations, lintPolicy, policyRevisionDecision, revisePolicy,
  grantUnderPolicy, declineOnBook, VOICE_LADDER,
  type PromotionPolicy, type VoiceProposal, type VoiceLevel, type WorkflowDeclaration, type VoiceAssessment, type Grant, type TierRequirements,
  type StandingDecline, type DeclineCitation,
} from './verdict/voice.js'
import type { BoundMethod } from './verdict/bounds.js'
import { actionNotice, renderActionNotice } from './verdict/notices.js'
import { hashOf } from './verdict/canonical.js'
import {
  verifyAgainstTwin, parseTwinPresentation, FS_CORE_TWIN_MAP, FS_CORE_TWIN_MAP_V02, FS_CORE_TWIN_MAP_V021,
  type TwinClaim, type TwinConceptMap, type TwinPresentationInput,
} from './twin/index.js'
import { verifyEinvoiceTwin, type EinvoiceClaim, type EinvoiceProfile } from './twin-einvoice/index.js'
import {
  promotionOpinion, disputeOpinion, renderOpinion, opinionJSON, openSnapshot, snapshotOfLedger,
  disputeRuling, signRuling, verifySignedRuling, parseRulingBook, statuteFromRulings, statuteCounsel, statuteMineFiles, LAW_RULINGS,
  type LedgerSnapshot, type Opinion, type LawRuling, type OpinionScope,
} from './opinion/index.js'
import {
  MemoryLedger, openFileLedger, readChainFile, repairTornTail, writeChainFile, TornTailError, LedgerFileCorrupt, LedgerReadOnly,
  renderTenantReport, signDecision, DecisionRefused, GENESIS, SampleRefused,
  makeReview, makeKeyRegister, makeKeyRevoke, canaryCommitment, isRole, ROLES, keyFingerprint, legacyKeyFingerprint,
  type Ledger, type SignedDecision, type TrustedKeys, type DecisionEntry, type TenantReportOptions, type RootKeys, type Role,
  type BookDecision, type Signable, type CanarySealDecision, type FileLedger, type RepairReport, type ChainSnapshot,
} from './ledger/index.js'
import {
  reconcileCompleteness, renderCompletenessReport, readPopulation, CompletenessRefused, PopulationRefused,
  type CompletenessMapping, type CompletenessOptions, type CompletenessReport, type CsvDelimiter,
} from './reconcile/completeness/index.js'
import { monthPeriod, declarationsOverridden } from './ledger/report.js'
import { makeCosign, grantInForce, noEffect as bookNoEffect, successionNotice, loosens, type GrantDecision, type GrantSignatures } from './ledger/decisions.js'
import { successionReplay, checkSuccessionReplay, successionGrant, type SuccessionReplayResult } from './ledger/succession.js'
import { generateSigningKeypair, verifyEnvelope, type SignedVerdict } from './protocol/envelope.js'
import { gateLabel, gateStatus, gateStatusOpen, heldSuspectClaims, openClaims, gateHeadline } from './verdict/aggregation.js'
import { scopeLines } from './verdict/scope.js'
import { verdictExit, apExit } from './verdict/exit.js'
import { openCase, fileMove, caseStatus, replayCase, loadCase, CaseRefused } from './arbitration/case.js'
import { verifyInputs } from './protocol/inputs.js'
import { resolveDeclarativeRuleset } from './rulesets/declarative.js'
import { carriedRulesetNames, carriedDefaultVersion } from './protocol/ruleset-names.js'
import { extractionSchema, legalVersionOf, validateContract, type ContractRuleset } from './extract/schema.js'
import { compileSchematron } from './compile/compile.js'
import { compareWithHand, renderComparison } from './compile/compare.js'
import { markHandEdits } from './compile/diff.js'
import type { QuoteAssertion } from './textmatch/index.js'
import { InputRefused, extractionProblem } from './protocol/input.js'
import { voiceSurface, declarationFromJson, type VoiceSurface } from './http/surfaces.js'
import { governedRead, governedSignatures, governing } from './http/dual.js'
import { commitDueSamples, reviewQueue, sealCanaries, revealCanaries, newSalt } from './surveillance/index.js'
import {
  checkpoint, verifyAgainstCheckpoints, verifyCheckpoint, verifyCheckpointSignature, latestCheckpoint, fileWitness, dirWitness,
  readWitnessFile, readWitnessDir, CheckpointRefused, WitnessStoreCorrupt,
  type Checkpoint, type AnchorReport, type WitnessAnchors, type PublishReceipt,
} from './anchor/index.js'

export interface CliIO { out: (s: string) => void; err: (s: string) => void }
const PROCESS_IO: CliIO = { out: s => { process.stdout.write(s) }, err: s => { process.stderr.write(s) } }

const BUILTIN = new Set(['invoice', 'pay-app'])

interface Args { file?: string; files: string[]; ruleset?: string; labels?: string; inputs?: string; input?: string; invoice?: string; po?: string; receipt?: string; contract?: string; evidence: string[]; history: string[]; source?: string; quotes?: string; gate: boolean; allowOpen: boolean; help: boolean; caseDir?: string; parties?: string; archiveFiles: string[]; suppliedChoices?: string; payerRole?: string; unknown: string[] }

/** The flags parse() reads (for the "did you mean" of an unknown option). */
const PARSE_FLAGS = ['--ruleset', '--labels', '--inputs', '--input', '--invoice', '--po', '--receipt', '--contract', '--evidence', '--history', '--source', '--quotes', '--gate', '--allow-open', '--case-dir', '--parties', '--archive-file', '--supplied-choices', '--payer-role', '--help'] as const

/** `--name=value` is read as `--name value` (2026-10-05: a stranger typed `--extraction=file`). */
function splitEquals(argv: readonly string[]): string[] {
  return argv.flatMap(t => (/^--[A-Za-z][\w-]*=/.test(t) ? [t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1)] : [t]))
}

function parse(argv0: string[]): Args {
  const argv = splitEquals(argv0)
  const a: Args = { files: [], evidence: [], history: [], gate: false, allowOpen: false, help: false, archiveFiles: [], unknown: [] }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] as string
    switch (t) {
      case '-h': case '--help': a.help = true; break
      case '--ruleset': a.ruleset = argv[++i]; break
      case '--labels': a.labels = argv[++i]; break
      case '--inputs': a.inputs = argv[++i]; break
      case '--input': a.input = argv[++i]; break
      case '--invoice': a.invoice = argv[++i]; break
      case '--po': a.po = argv[++i]; break
      case '--receipt': a.receipt = argv[++i]; break
      case '--contract': a.contract = argv[++i]; break
      case '--evidence': a.evidence.push(argv[++i] as string); break
      case '--history': a.history.push(argv[++i] as string); break
      case '--source': a.source = argv[++i]; break
      case '--quotes': a.quotes = argv[++i]; break
      case '--gate': a.gate = true; break
      case '--allow-open': a.allowOpen = true; break
      case '--case-dir': a.caseDir = argv[++i]; break
      case '--parties': a.parties = argv[++i]; break
      case '--archive-file': a.archiveFiles.push(argv[++i] as string); break
      case '--supplied-choices': a.suppliedChoices = argv[++i]; break
      // 2026-10-13: who pays a pay application, for the words its report prints (owner prints the AIA title; payer, the default, does not)
      case '--payer-role': a.payerRole = argv[++i]; break
      // An option nobody reads is refused (2026-10-05): `--rulset x` used to check the document under the DEFAULT ruleset.
      default: if (!t.startsWith('-') || t === '-') { a.file = t; a.files.push(t) } else a.unknown.push(t)
    }
  }
  return a
}

/** The version a carried declarative ruleset name resolves to for new verdicts (for the help text; '?' if this build lacks it). */
function carriedVersion(name: string): string {
  return carriedDefaultVersion(name) // protocol/ruleset-names.ts: the MCP descriptions read the same function
}

const USAGE = `riposte-verify <extraction.json | -> [options]        check a document (also: verify check <extraction.json> [options])
  --ruleset invoice|pay-app|<name>|<file.json>   a built-in name, a declarative ruleset this build carries by name
                                (peppol-en16931 = ${carriedVersion('peppol-en16931')}, peppol-en16931@0.1.0, e-invoice = peppol-en16931), or a
                                declarative ruleset file (default: invoice)
  --contract <file.json>        contract / PO reference
  --evidence <file.json>        receipt / delivery evidence (repeatable)
  --history <file.json>         prior document of the same kind (repeatable)
  --source <file.txt>           source document text: the passages a declarative ruleset's "quotes" require, and any
                                --quotes, are checked against it VERBATIM. Read as UTF-8 and hashed byte for byte
  --quotes <file.json>          passages to find verbatim in --source: [{ "id", "quote", "label"? }]
  --archive-file <file>         an archive file as bytes (repeatable; engine 0.5.0, declarative): archive provenance whose file
                                is not text (FITS) is content- and checksum-verified from these bytes (docs/EVIDENCE.md)
  --supplied-choices <file.json>  values a reviewer supplies for the ruleset's choice slots: { "ID": { "value", "source" } }
                                (engine 0.5.0, declarative; docs/CHOICES.md); bound into the verdict's inputs
  --case-dir <dir> --parties <parties.json>   an OPEN verdict (engine 0.3.0, declarative) opens its arbitration case there,
                                automatically (docs/EVIDENCE.md; then verify case move / status / replay)
  --gate                        print the gate's own message instead of the headline: the open checks of a PASS-WITH-OPEN,
                                each struck field of an OPEN (engine 0.3.0: a struck load-bearing field; suspect is a flag,
                                never a FAIL) with the checks it would unlock, then the verdict's scope lines. The exit code
                                is the same with or without it (it is the default reading, below)
  --allow-open                  exit 0 on a PASS-WITH-OPEN verdict whose checks that ran all held and whose open checks each
                                wait on a reference not given (REFERENCE_NOT_PROVIDED) or a field the document does not carry
                                (FIELD_MISSING). An open check whose figure is there but unreadable ("1600.0O"), ambiguous or
                                out of scope, and a struck field (OPEN), stay exit 2, named. Stated on stderr on every run; the
                                verdict still records gate_status PASS_WITH_OPEN. Not with --gate
    Prints the verdict (JSON) on stdout and a headline on stderr: PASS, PASS-WITH-OPEN, FAIL or INSUFFICIENT_DATA, with the
    count of checks behind it. Engine 0.6.0 records the same word in the verdict as gate_status.
    Fails closed: exit 0 only on a clean PASS (every check ran and held).
    Exit 0 PASS · 1 FAIL (or HELD-SUSPECT) · 2 PASS-WITH-OPEN, OPEN or INSUFFICIENT_DATA (--allow-open: 0 on a PASS-WITH-OPEN
    whose open checks each wait on a reference or a field the document does not carry) · 3 usage or an unreadable input

riposte-verify case open --dir <case-dir> --verdict <verdict.json> --inputs <inputs.json> --parties <parties.json> [--document <file>]
               [--dispute <claim_id>] [--now <iso>]
riposte-verify case move --dir <case-dir> --move <move.json> [--evidence <file>] [--now <iso>]
riposte-verify case status --dir <case-dir> [--now <iso>] [--json]
riposte-verify case replay --dir <case-dir> [--reread]
    arbitration (docs/EVIDENCE.md): an OPEN verdict (a struck load-bearing field) or a disputed FAIL opens a case; signed
    moves resolve it: CORRECT (a document the engine reads itself: a PDF, a UBL XML), STRIKE (a field or a document),
    CORROBORATE (a statement signed by an enrolled source, E0, or an independent document). A move carrying a value is refused
    and recorded by its hash. Each accepted move records a linked re-verdict (before/after, both replayable). Clock: working
    days from the parties file (default 5; 2 with a suspect field); expiry is UNSUPPORTED, never PASS. move/status/replay are
    asynchronous (a PDF re-read). Exit 0 · 1 refused (the reason is printed) · 3 usage

riposte-verify lint --ruleset <file.json | name>       validate a declarative ruleset. Exit 0 clean · 1 errors · 3 usage
riposte-verify extract-schema <ruleset | legal[@v]> [--validate <envelope.json>]
    the extraction contract's JSON Schema for a ruleset, generated from its fields block: every field term with its
    provenance {page, line, raw, reader}, "UNREADABLE" with the readings for a value that could not be read, every field
    read or named in not_printed. --validate checks an envelope against it. A ruleset with "require_contract": true reads
    only an envelope that validates. Exit 0 · 1 the envelope breaks the contract (violations printed, first one first) · 3
riposte-verify compile-ruleset <a.sch> [<b.sch> ...] --structure <structure.tsv | structure.xml> --out <ruleset.json>
              [--profile <id>] [--version <v>] [--name <text>] [--aliases <aliases.json>] [--scope aliases | <terms.json>]
              [--sources <sources.json>] [--report <report.json>] [--against <hand-ruleset.json | name>]...
    compile schematron asserts into a declarative ruleset skeleton (docs/COMPILER.md): every assert becomes an arithmetic,
    presence or membership check quoting its text and citing {file, sha256, line, pattern, rule context, assert id, flag},
    or an uncompiled entry in the compile report with its reason; none is dropped. --structure maps XPath to business terms
    (a TSV of path, cardinality, BT ids, name, default; or the published structure XML with its parts beside it).
    --aliases adds extraction paths per term; --scope compiles only checks whose terms it lists. --against compares the
    result with a hand-written ruleset, check by check, and writes <out>.comparison.json and .md.
    Exit 0 compiled and linted clean · 1 written, but lint found errors · 3 usage or an input it cannot read
riposte-verify compile-ruleset --diff <compiled.json> <edited.json> --out <file.json>
    mark every check and field a person changed after compiling hand_edited: true, and list the edits (removals too) in
    compiled_from.hand_edits. Exit 0 · 3
riposte-verify measure --ruleset <file.json | name> --labels <set.json>   measured accuracy on a labeled set. Exit 0 · 3
riposte-verify replay <verdict.json | envelope.json> [--inputs <inputs.json> | --extraction <doc.json> [--ruleset <r>] [--contract <f>]
              [--evidence <f>]... [--history <f>]... [--source <file>] [--quotes <f.json>]] [--tolerance <json>] [--document <f>]
              [--pre <f>] [--filing-summary <f>] [--schema <f>] [--trusted-key <public.pem | keygen.json | fingerprint>] [--strict]
              [--lenient-remedies] [--require-ruleset <ruleset>@>=<version>]... [--allow-unknown-keys]
    check a verdict you were handed. Its verdict_id binds the INPUTS, not the outcome, so with the inputs the check is
    RE-PERFORMED here (the engine for the verdict's ruleset, under the engine version the verdict names) and the recomputed
    verdict is byte-compared with the presented one; the first differing field is named. A match names the ruleset
    id@version and the engine that decided it. Not compared, and named on every run: issued_at (a missing one is said to be
    missing), the fields added after the engine (channel, ledger, declared_accuracy, action_context, case) and
    document.producer (docs/REPLAY.md). --inputs is the object the verdict's input_hash commits to; --extraction builds it
    from the same flags \`verify <doc>\` takes. --tolerance restates a rounding override the verdict was issued under
    ({"rel":…,"absCap":…}). The filing and e-invoice comparisons commit their inputs to the document by hash: --document (and, for a filing at ruleset 0.2 or later, the linkbase
    files) re-performs them. A signed envelope's signature is checked too, and its key's full fingerprint (sha256 of its DER
    bytes, as riposte-ledger fingerprint prints it) is printed. --trusted-key pins the key it must be signed with (a public
    key file, verify keygen's JSON, an inline PEM such as "$(cat k.pub.pem)", or the 64-hex fingerprint; the older form,
    sha256 of the base64 text, is accepted this release, with a note): any other key, or no signature, FAILS. --strict FAILS as well when something was not re-performed: an annotation field is present, remedies were absent
    and re-derived, an envelope's key is not pinned with --trusted-key, or issued_at is missing; document.producer is the
    issuer's label and is reported, not failed. A malformed issued_at, a key repeated in one JSON object, a byte-order mark, a number past the double range,
    an undeclared annotation member (action_context.approved) or a key a bundle or envelope does not define is refused (exit 3) with or without --strict; --allow-unknown-keys carries such a key, saying so.
    A verdict of engine 0.0.1 or 0.1.0 that carries no remedies FAILS at remedies: a replayed file must carry what the
    verdict said. --lenient-remedies (for a verdict issued before remedies existed) compares its core instead and reports
    the re-derived remedies; --strict still fails it. From engine 0.2.0 a verdict binds its remedies, so no flag applies.
    A declarative verdict names what it was issued on: always --extraction and --ruleset, and --source, --quotes,
    --supplied-choices or --archive-file when it says so. Give some but not all and the replay names the flags left out
    (exit 3) before any hash is compared. Give none and only the structure is checked (exit 2), and the flags are named.
    When input_hash differs, it prints the recorded and the computed hash and names the input that disagrees where the
    verdict records it. --ruleset takes a name this build carries: without @version (peppol-en16931) it means the version
    the verdict names. On a match it prints the headline (PASS, PASS-WITH-OPEN, FAIL, INSUFFICIENT_DATA) and the remedies.
    A legal verdict under an older rule whose inputs today's default rule reads differently gets a second line ("under
    today's default legal@<version> this quotation reads can't tell: …"; rule_now in the JSON). --require-ruleset legal@>=0.4.0
    (any ruleset id; repeatable) FAILS a verdict that names that ruleset at an older version, in words.
    Exit 0 VERIFIED (re-performed, byte-identical) · 1 FAILED (the binding, the re-performed outcome, the signature, the
    trusted key, --strict, or --require-ruleset) · 2 structure verified, outcome NOT re-performed (no inputs, or nothing here
    re-performs them) · 3 not a verdict, a usage error, an input refused or unreadable, or an input the verdict names was left out
riposte-verify replay <bundle.json | cases.jsonl | folder> [--trusted-key <k>] [--strict] [--lenient-remedies] [--require-ruleset <r>@>=<v>]... [--allow-unknown-keys]
    a BUNDLE is { "verdict": <verdict or envelope>, "inputs": <its inputs>, "options"?: { "tolerance", "document" } }: it
    carries its own inputs. A .jsonl holds one bundle per line; a folder, its *.json and *.jsonl files in name order (a
    folder inside it is not walked, and is named). Each case: MATCH · DIVERGED (the field named) · NOT_REPERFORMED ·
    REFUSED, with the fields that were not re-performed printed under it. A case whose remedies were deleted DIVERGES at
    remedies unless --lenient-remedies is given; one whose bundle has a key it does not define is REFUSED (as above). A bare verdict in a folder is refused with the
    single-verdict command to run instead. A case under a rule older than --require-ruleset asks for is marked REQUIRED.
    Exit 0 all match · 1 any diverged, a --strict failure, or a --require-ruleset failure · 2 some not re-performed · 3 refused
riposte-verify reconcile --ledger <chain.jsonl> --population <payments.csv|.jsonl> --mapping <mapping.json> [--format csv|jsonl]
                 [--delimiter ,|;|tab|'|'] [--extractions <docs.json|.jsonl>] [--tenant <id>] [--workflow <id>]... [--ruleset <id>]...
                 [--since <iso>] [--until <iso>] [--rungs <json|file>] [--include-matched] [--policy <policy.json>] [--trusted-keys <k>]
                 [--root-keys <r>] [--json | --md]
    completeness: did every payment go through the control? The whole ledger is verified first; then every row of the
    customer's payment population lands in one class (MATCHED · MISMATCHED · PAID_DESPITE_HOLD · CHECKED_AFTER_PAYMENT ·
    AMBIGUOUS · BYPASSED · UNREADABLE) and every in-period verdict in one (MATCHED · ORPHAN · AMBIGUOUS · UNKEYED). The
    mapping declares the columns, keys and ledger fields (completeness-mapping-v0); --extractions supplies the checked
    documents a mapping reads ledger fields from (each used only if its hash is on the ledger). The population is read as
    bytes, so the report binds its sha256. Prints the report JSON (--md: the Markdown an auditor reads). Only an anchored
    GRANT sets a rung (--trusted-keys / --root-keys); --policy is the deployment's declared policy, and a GRANT it does not
    admit (its tier, max_rung, the signatures autonomy needs there) sets no rung, whatever policy the grant names. Exit 0
    clean (every row MATCHED) · 2 exceptions a person must look at (any PAID_DESPITE_HOLD, MISMATCHED, BYPASSED, or any row
    not MATCHED) · 1 REFUSED (the ledger does not verify; a mapping or population value it will not read; a corrupt ledger)
    · 3 usage
riposte-verify ledger repair <chain.jsonl>
    a ledger whose last line is torn (an append that did not finish: a crash mid-write) reads, but takes no append. This
    backs the file up (<ledger>.torn-<time>.bak, never over a file), truncates it to its last whole line, logs what it
    removed to <ledger>.repairs.jsonl, and prints exactly what it removed (offset, bytes, sha256, base64). A ledger whose
    last line is whole is left alone. Run it with no writer open on the ledger. Exit 0 repaired (or nothing to repair) ·
    1 REFUSED (an unparseable line before the last is corruption, not a torn tail: restore from a backup) · 3
riposte-verify ledger export <chain.jsonl> --out <file>
    the ledger's chain export (the bytes ledger.chainJSONL() gives), streamed: a ledger of any size. Never over a file (exit
    1). Copied as written, not verified (verify report --ledger <file> checks it). Exit 0 · 1 refused · 3
riposte-verify anchor checkpoint --ledger <chain.jsonl> --key <witness.pem> --signer <witness_id> --out <witness.jsonl | dir/>
                         [--length <n>] [--book-id <id>] [--root-keys <root.pub.pem>]
    a WITNESS (a party with no write access to the ledger) signs a checkpoint of the chain head ({length, head, as_of,
    prev_checkpoint}, Ed25519) and appends it to its witness store: a file (one line per checkpoint) or a directory (one
    file each, never overwritten). Point --out at storage the ledger's writer cannot rewrite (WORM, another account). The
    ledger is verified first, and a ledger that no longer holds what the store's last checkpoint anchored is never extended.
    --root-keys: the witness key must be registered on the ledger with the witness role (not key_admin), or nothing is
    written. Prints the checkpoint and the witness_keys entry readers anchor it with. Exit 0 signed (or already anchored)
    · 2 REWRITTEN / TRUNCATED: the ledger contradicts the store's last checkpoint (its position is named; nothing is
    signed) · 1 REFUSED (a ledger that does not verify, not an Ed25519 private key, a position past the ledger's end, a
    store entry that does not verify; nothing is written) · 3 usage
riposte-verify anchor verify --ledger <chain.jsonl> --witness <witness.jsonl | dir/> (--trusted-keys <witness-keys.json> | --root-keys <root.pub.pem>)
                     [--book-id <id>]
    the ledger against its independently held checkpoints. A rewrite that recomputes the whole chain verifies internally,
    and fails here at the first checkpoint whose prefix it touches. --trusted-keys anchors each witness by its public key,
    held out of band ({"<witness_id>": "<public PEM>"}); --root-keys reads witnesses registered on the ledger (weaker: a
    rewriter can drop a later revocation). Prints the report JSON; a checkpoint that does not count, and a checkpoint
    missing from the store, are said on stderr. Exit 0 every counted checkpoint held · 2 REWRITTEN / BROKEN / TRUNCATED at
    an anchored position (named, with the events the change lies in) · 1 REFUSED (no checkpoint counts; the ledger does
    not verify past its last anchored position; a corrupt store) · 3 usage
riposte-verify ap <layout.txt> | --invoice <f> --po <f> --receipt <f>   AP three-way match
  --input <ap-input.json | ->           structured input instead (a bill, its PO, item receipts, payment_history;
                                        docs/AP-INPUT.md), with its replayable proof. Invalid input: exit 3, typed errors
  --history <history.json>              the invoices already booked, text path: a JSON array ([] = none booked; - reads
                                        stdin). Without it the duplicate and PO balance checks do not run (exit 2)
  --price-tolerance <fraction>          unit price allowed over the PO's (default 0.02; "5%" reads 0.05); bound into the proof
  --freight allow|person, --tax person|allow|rate:<pct>  a PO silent on freight, or (--input) on tax: person (default) or the rule; bound
  --gate | --allow-open                --gate is the default reading (accepted; it changes nothing). --allow-open exits 0
                                        only on a bill held because no payment history was given, and says so. Not both
    Prints the result (JSON) on stdout and, on stderr, the decision with its reasons and the verdict's headline (PASS,
    PASS-WITH-OPEN, FAIL, INSUFFICIENT_DATA). It fails closed: a bill a check could not run on goes to a person.
    Exit 0 approve (every check ran) · 1 hold · 2 a person decides · 3 usage or an input that cannot be read
riposte-verify citations <citations.json> --sources <dir> [--ruleset legal[@version]] [--bind strict|parties] [--json] [--bundle <file>]
    a brief's citations, each quotation checked verbatim against the opinion text supplied for its cite. A text is used only
    when its caption names the cite (its parties and reporter citation); otherwise the answer is can't tell (INSUFFICIENT_DATA).
    It does not check that an authority exists or is good law. <citations.json> is an array of { id, cite?, case_name?, quote?,
    proposition?, source_key? } or { "citations": [...] }; --sources holds a sources.json manifest or one <key>.txt per text
    (docs/LEGAL.md). --bind strict (the default) needs the reporter citation and every party in the caption; parties also uses a
    text whose caption names every party, and each such answer stays open ("bound by parties only"). The report goes to
    stderr; --json prints the verdict on stdout. --bundle <file> writes { verdict, inputs } for verify replay: it holds every
    quotation and every opinion text.
    Exit 0 PASS · 1 FAIL · 2 a citation could not be checked, and none failed · 3 usage or an input that cannot be read
riposte-verify mine <cases.jsonl> --schema <schema.json>   mine candidate rules from labelled approve/hold cases (JSON report)
  --ap                                  cases are Distil-style AP layouts {id,input,decision}; built-in AP schema unless --schema
  --max-approved-violation-rate <r>     tolerate approved exceptions (default 0 = none)
  --ruleset-out <file>                  also write the compiled ruleset (never over a file: exit 1; enforce: verify <doc> --ruleset <file>)
  --ruleset-id <id>                     id of the compiled ruleset (default "mined")
  --thresholds                          also learn a constant per numeric document field (X <= c, X >= c)
    Exit 0 · 1 refused (the --ruleset-out file exists) · 3 usage

riposte-verify twin --html <primary.htm> --period-end YYYY-MM-DD --claims <claims.json> [--tolerance 0.5] [--period-tolerance-days 7]
            [--ruleset 0.1|0.2|0.2.1] [--pre <x_pre.xml>] [--filing-summary <FilingSummary.xml>] [--schema <x.xsd>]
    compare extracted values with the filing's own inline-XBRL facts. claims.json is
    [{"id","field","value"}] (or {"claims":[...]}). Prints {verdict, judgments, twin}. --ruleset 0.1 (default) binds against
    the whole document; 0.2 and 0.2.1 bind only through the face statements named by the filing's presentation linkbase
    (--pre, --filing-summary, --schema): without one every claim is INSUFFICIENT_DATA (NO_PRESENTATION_LINKBASE).
    Exit 0 PASS · 1 FAIL · 2 INSUFFICIENT_DATA (can't tell) · 3 usage
riposte-verify twin-einvoice <invoice.xml> --claims <claims.json> [--profile peppol-bis3|zatca-ksa|ksef-fa3] [--no-consistency]
    compare extracted values with the binding e-invoice XML itself (Peppol BIS 3.0, ZATCA, KSeF FA(3)).
    claims.json is [{"id","field","value","currency?"}] (or {"claims":[...]}). Prints {verdict, judgments, consistency,
    twin} as JSON on stdout, and on stderr the headline and one line per claim in words (FAIL, INSUFFICIENT_DATA, PASS).
    It fails closed, as check does. Exit 0 PASS · 1 FAIL · 2 PASS-WITH-OPEN or INSUFFICIENT_DATA (can't tell) · 3 usage
riposte-verify notice <verdict.json> [--level record|advise|gate|autonomy] [--json]
    one action's notice at a rung (default record): every FAIL and can't tell with its evidence and its own dispute path, at
    every rung. Surfaced at record/advise; held at gate/autonomy. Exit 0 PROCEED · 1 HOLD · 2 SURFACED (not held)
riposte-verify voice --ledger <chain.jsonl> --policy <policy.json> --workflow <id> --tier <tier> [--granted <level> | --grant <grant.json>] [--bounds <text>] [--surface]
riposte-verify voice --from-book --ledger <chain.jsonl> --policy <policy.json> --workflow <id> [--tier <tier>] [--trusted-keys <keys.json>] [--root-keys <root.pub.pem>] [--surface]
    a workflow's voice (record | advise | gate | autonomy) from the ledger. The rung is ALWAYS what a person granted
    (default record); Riposte only PROPOSES: a promotion, or an URGENT demotion with the failing cases listed for dispute.
    --grant names the signer and the policy version + tier the grant was made under. --from-book reads the rung, tier,
    bounds and policy version from the GRANT in force on the ledger (a person's signed decision, see verify grant), cites
    it, and holds back a proposal a person declined until the evidence changes (said on stderr: "Kept at <rung> by
    <person>, <time>; stands until …" / "Not now: <person>, <time>; re-raises when …"); --tier only while nothing is
    granted. Only an ANCHORED signer's decision moves a rung (--trusted-keys / --root-keys). --surface prints the voice
    surface MCP voice_assess / HTTP GET /v1/voice return. Exit 0 · 1 the chain (or a signed decision on it) did not verify
    · 2 an urgent demotion proposal is open (evidence of failure: a miss under the grant). A rung granted above what the
    record supports, with nothing gone wrong (basis unevidenced), is a standing notice: 0
riposte-verify opinion --from-book --ledger <chain.jsonl> --policy <policy.json> --workflow <id> [--tier <tier>] [--tenant <id>] [--trusted-keys <keys.json>] [--root-keys <root.pub.pem>] [--json]
riposte-verify opinion --ledger <chain.jsonl> --policy <policy.json> (--proposal <proposal.json> | --workflow <id> --tier <tier> [--granted <level> | --grant <grant.json>] [--bounds <text>]) [--tenant <id>] [--trusted-keys <keys.json>] [--json]
riposte-verify opinion --ledger <chain.jsonl> --dispute <verdict_id> [--claim <claim_id>] [--tenant <id>] [--trusted-keys <keys.json>] [--json]
    the written opinion (Markdown; --json prints the source of truth). Every premise is checked by Riposte's own code.
    --from-book reads the rung from the GRANT in force (cited as the decision a ruling would amend); a standing decline is
    DECLINED, never a fresh ask. --tenant reads one tenant's records and decisions on a shared ledger. Exit 0 · 1 withheld
    (a premise failed its check)
riposte-verify rule --ledger <chain.jsonl> --dispute <verdict_id> [--claim <claim_id>] --ruling STANDS|SET_ASIDE --reason <text>
            --key <person.pem> --signer <id> [--tenant <id>] [--inputs <inputs.json>] [--note <text>] [--signed-at <iso>] [--trusted-keys <keys.json>]
    a person's signed ruling on LAW over the dispute opinion Riposte derives from the ledger (a verified one proposing
    UPHOLD or REFER on a deterministic PASS/FAIL finding). Prints ONE JSON line: \`verify rule … >> rulings.jsonl\`.
    Exit 0 · 1 REFUSED (a withheld opinion, an abstention, a key the trusted keys do not anchor) · 3
riposte-verify statute --ledger <chain.jsonl> --rulings <rulings.jsonl> --rule <rule_id> --domain <domain> [--outcome FAIL|PASS] [--tenant <id>]
               [--rows-out <rows.jsonl> --schema-out <schema.json>] [--inputs <by-verdict.json>] [--trusted-keys <keys.json>]
    precedent → statute: every ruling re-verified against the ledger, the rulings mined as a case table, each candidate rule
    returned as COUNSEL (never a VERDICT; a person adopts one by writing it into a ruleset). --rows-out/--schema-out write
    the table for verify mine (never over a file). Exit 0 · 1 the ledger did not verify · 3
riposte-verify report --ledger <chain.jsonl> [--policy <policy.json>] [--declarations <d.json>] [--tenant <id>] [--month YYYY-MM] [--as-of <iso>] [--trusted-keys <keys.json>] [--root-keys <root.pub.pem>]
    the tenant ledger report (Markdown), the day-1 audit report: volume, the human-overturn rate, per-rule calibration,
    what Riposte is asking a person to decide (and what a person declined, in words: who, when, what would re-raise it),
    FAIL / INSUFFICIENT_DATA notices by rung, and tamper-evidence. A workflow's rung is read from the GRANT in force on the ledger,
    which the report cites; --declarations ([{workflow_id, consequence_tier, granted?, bounds?}]) covers workflows with no
    grant, and never overrides one. Exit 0 · 1 the ledger did not verify

A person's decisions (Ed25519-signed, appended to the ledger; only a person moves a rung):
riposte-verify keygen --out <person.pem> [--signer <id>]
    an Ed25519 keypair for local signing: the PRIVATE key to <person.pem> (never overwritten), the public key to
    <person>.pub.pem, and the --trusted-keys entry on stdout. KEY CUSTODY IS THE OPERATOR'S: Riposte keeps no copy; revoke
    a key on the ledger with verify key revoke. Exit 0 · 1 refused (a file is already there) · 3 error
riposte-verify grant --ledger <chain.jsonl> --key <person.pem> --signer <id> --workflow <id> --level record|advise|gate|autonomy
             --tier <tier> --policy <policy.json> [--bounds <text>] [--answers <proposal_id>] [--note <text>] [--signed-at <iso>]
    a person sets a workflow's rung, either direction: a GRANT under the policy version (by hash) and the consequence tier
    (the policy must lint, declare the tier, and allow the rung at it). autonomy needs --bounds (a person writes them, even
    "all"). The latest ANCHORED GRANT for a workflow is its rung. At a tier declaring grant_signatures (dual authorization)
    a GRANT of autonomy is PENDING, and moves nothing, until another person co-signs it; stderr says so.
riposte-verify grant --cosign <grant_decision_id> --ledger <chain.jsonl> --key <person.pem> --signer <id> [--trusted-keys <k> | --root-keys <r>]
             [--policy <policy.json>] [--note <text>] [--signed-at <iso>]
    a second person's signature on a pending GRANT (a GRANT_COSIGN, riding in a GRANT event: the chain format is unchanged).
    It names the grant (its decision id, or a unique prefix of 12+ characters) and restates its workflow and level. The
    ledger refuses one that would not count: the grant's own signer, a repeat signer, the same key or two ids on one key, a
    co-signer with no anchored key or a revoked one, an unanchored or superseded grant (exit 1; the ledger is untouched).
    Prints the entry and the grant's signatures ("2 of 2: in force" / "1 of 2: pending"); --policy is the declared policy:
    a GRANT of autonomy needs its tier's count, whatever policy the grant names
riposte-verify succession --ledger <chain.jsonl> --from <tenant>/<ruleset>@<old> --to <tenant>/<ruleset>@<new> --inputs <inputs.jsonl>
                  --reason <text> --signer <id> --key <person.pem> --policy <policy.json> (--trusted-keys <k> | --root-keys <r>)
                  [--ruleset <declarative.json>] [--tolerance <json|file>] [--loosening-reason <text>] [--level <rung>]
                  [--grant <decision_id>] [--note <text>] [--signed-at <iso>] [--dry-run]
    a person carries the grant in force on one ruleset version to the next. A new version is a new workflow and starts at
    record; nothing carries by itself. Riposte finds the grant in force on --from under --policy, re-performs every verdict
    recorded under --from with the new ruleset (--inputs: one { "verdict_id", "inputs" } per line, the inputs each was
    issued on; --ruleset for a declarative ruleset this build does not hold), and prints that replay BEFORE signing: how
    many were re-performed, every outcome that changes and its direction, and every verdict not re-performed and why.
    Then it signs a GRANT on --to carrying the replay (at the old rung or below, never above; the same tier; autonomy keeps
    its signature count, so a two-signature tier is pending until co-signed). A change to PASS lets through what the old
    rules held: it needs --loosening-reason. --dry-run prints the replay and the GRANT it would sign and appends nothing
    (with --key it also tries the append on a copy). --grant pins the grant you reviewed: refused if another is in force.
    Exit 0 appended (or dry run) · 1 REFUSED, ledger untouched (a ledger that does not verify, nothing in force to carry, a
    pinned grant no longer in force, a raised rung, a loosening without its reason, a replay that re-performed nothing,
    a signer the ledger does not accept) · 3 usage
riposte-verify succession --check <decision_id> --ledger <chain.jsonl> --inputs <inputs.jsonl> [--ruleset <r>] [--tolerance <t>]
                  [--trusted-keys <k>] [--root-keys <r>]
    anyone holding the documents re-performs the replay a succession on the ledger carries, over its own span. Exit 0 the
    same replay, byte for byte · 1 it differs (each difference named), or the grant carries no succession · 3 usage
riposte-verify decline --ledger <chain.jsonl> --key <person.pem> --signer <id> --policy <policy.json> (--assessment <assessment.json> | --workflow <id> --proposal <proposal_id> [--tier <tier>])
               --reason <text> [--note <text>] [--signed-at <iso>]
    a person's "no" to the proposal the LEDGER raises now: Riposte reads the ledger again under --policy and signs a DECLINE
    only for the live proposal named (by the assessment the person read, verify voice --from-book's output, or by id), so a
    doctored assessment file never becomes a signed decline. It moves nothing and stops the re-raise until the evidence
    changes; stderr says it: "Kept at <rung> by <person>, <time>; stands until …" or "Not now: <person>, <time>; re-raises when …"
riposte-verify revise-policy --ledger <chain.jsonl> --key <person.pem> --signer <id> --from <prior.json> --draft <next.json> --reason <text> [--signed-at <iso>] [--out <policy-next.json>]
    a person revises the policy at a review, and Riposte builds the revision (revisePolicy): who (--signer), when, why,
    what changed, and the hash of the version it supersedes. --draft is the next version: { version, method?, tiers? }
    (a full policy file is fine; a revision inside it is replaced). --out writes the revised policy (never overwrites it)
riposte-verify revise-policy --ledger <chain.jsonl> --key <person.pem> --signer <id> --revised <policy.json>
    appends a revision already built with revisePolicy. --signer must be the revision's revised_by
  grant | decline | revise-policy | review | canary also take [--trusted-keys <keys.json>] ({"<signer_id>": "<public PEM>" |
  [...]}) and [--root-keys <root.pub.pem>] (the root public key: the key registry on the ledger anchors signers).
  Then only a key anchored to the signer is accepted. Without them the signer is UNANCHORED: the signature proves the key
  holder decided, not which person, and an unanchored decision moves no rung. The ledger file must exist (an empty file
  is a new ledger); a ledger that does not verify takes no decision. Exit 0 appended · 1 REFUSED (the reason is printed;
  nothing is appended) · 3 usage/error

Evidence integrity (the draw, the queue, signed reviews, the key registry, canaries):
riposte-verify sample commit --ledger <chain.jsonl> --policy <policy.json> --workflow <id> [--tier <tier>] [--trusted-keys <k>] [--root-keys <r>]
    the scheduled step (run it daily): commit every closed period's random review draw that is due. The seed is the chain,
    so nobody chooses the sample. Exit 0 committed (or nothing due) · 1 REFUSED · 3
riposte-verify queue --ledger <chain.jsonl> --policy <policy.json> --workflow <id> [--tier <tier>] [--trusted-keys <k>] [--root-keys <r>]
    a reviewer's queue: every drawn, still-unreviewed item, oldest first, with its deadline. Exit 0 · 1 the ledger did not
    verify
riposte-verify review --sign --ledger <chain.jsonl> --key <person.pem> --signer <id> --verdict <verdict_id> --decision UPHELD|OVERTURNED
              [--procedure re-performed|inspected] [--tenant <id>] [--note <text>] [--signed-at <iso>]
    a person's review as a SIGNED decision (the evidence a rung rests on; an agent can forge neither a clean record nor a
    reversal)
riposte-verify key register --ledger <chain.jsonl> (--root <root.pem> | --key <admin.pem> --signer <id> --root-keys <root.pub.pem>)
                    --subject <id> --public-key <person.pub.pem> --roles key_admin,policy_author,reviewer,grant_signer,witness [--tenants <t1,t2>]
riposte-verify key revoke --ledger <chain.jsonl> (--root <root.pem> | --key <pem> --signer <id> --root-keys <root.pub.pem>)
                  --subject <id> --public-key <person.pub.pem> --reason <text>
    the key registry on the ledger: a key joins with its roles (segregation of duties), or leaves prospectively. Signed by
    the registry ROOT or a registered key_admin; every reader anchors with --root-keys (the root's public key, held out of band)
riposte-verify canary seal --ledger <chain.jsonl> --key <author.pem> --signer <id> --workflow <id> --verdicts <id,id,… | ids.json> --secret-out <secret.json>
riposte-verify canary reveal --ledger <chain.jsonl> --key <author.pem> --signer <id> --secret <secret.json> [--seal <decision_id>]
    reviewer attention, measured without telling the reviewer: seal known-bad recorded items (the ledger holds only a salted
    commitment; the ids and salt go to --secret-out, never overwritten: keep it secret), then the sealer reveals them
riposte-verify policy lint --policy <policy.json>
    the promotion policy's errors AND warnings (an unreachable bar: a min_n below its zero-miss n; sidedness). Exit 0 · 1 errors

Over HTTP:
riposte-verify serve [--port N] [--host ADDRESS] [--allow-host NAME]... [--check-timeout-ms N] [--check-heap-mb N] [--check-workers N] [--max-body BYTES]
    the engine's pure core as a JSON HTTP service (OpenAPI 3.1 at GET /v1/openapi.json), until stopped. --port: default
    $PORT, else 8080 (0 picks a free port, printed when listening). --host: default 127.0.0.1, this machine only; any
    other address, such as 0.0.0.0, prints a warning, because the server has no authentication: anyone who can reach the
    port can call it. A request is answered only when its Host header names localhost, 127.0.0.1, ::1 or the --host
    address (for 0.0.0.0 or ::, any address of this machine); else 421, and a request with no Host header is 400.
    --allow-host adds a name, such as the public name a proxy forwards. A request body is read only when sent with
    Content-Type: application/json, as UTF-8 (a charset other than utf-8 is 415).
    Each POST is checked in a worker thread under a budget: --check-timeout-ms (default 60000), --check-heap-mb (default
    512) and --check-workers (checks at once, default 2; up to 16 more wait, each at most the time budget, then 503). A
    check past its time or heap is stopped and answered 413, "input too large to check within the service's budget; run it
    with the command line", with x-verify-exit 2; the server stays up. The environment can set them too (VERIFY_CHECK_TIMEOUT_MS, VERIFY_CHECK_HEAP_MB,
    VERIFY_CHECK_WORKERS); a flag wins.
    The request body is counted as it streams and capped before it is parsed: 4 MiB (4194304 bytes) by default, 32 MiB on
    the four routes that carry a whole document (/v1/twin, /v1/opinion, /v1/reconcile, /v1/succession/replay); past the cap
    the answer is 413, naming the cap. --max-body BYTES (a positive whole number) sets the 4 MiB default, as the environment
    variable VERIFY_MAX_BODY_BYTES does (the flag wins); neither changes the four routes' 32 MiB.
    POST /v1/replay sets x-verify-exit to the replay's exit, as \`verify replay\` on a folder gives it (0 every case matched,
    1 one diverged, 2 one was not re-performed, 3 one was refused), and its status to match: 409 when one diverged, 422 when
    one was refused, else 200.
    Exit 3 a usage error, or the port could not be bound

Exit codes are per command (each block above lists its own); 3 is always a usage error or an input that cannot be read.
Text and JSON inputs are read as UTF-8: invalid UTF-8, a JSON byte-order mark, a JSON number past the double range, a
JSON number that cannot be represented exactly (9007199254740993 reads as 9007199254740992; write amounts as strings with
two decimals) and JSON nested more than 256 levels deep ("nesting too deep, limit 256") are refused (exit 3), never hashed.

GLOSSARY
  verdict         the JSON a check returns: outcome, gate_status (engine 0.6.0), claims, remedies, and the hashes that
                  bind it to its inputs. A replay re-performs it.
  bundle          a verdict together with the inputs it is bound to: { "verdict", "inputs", "options"? }
  envelope        a verdict signed with Ed25519: { "verdict", "alg", "public_key", "signature" }
  PASS-WITH-OPEN  every check that ran held, but some could not run; a gate holds (recorded as PASS_WITH_OPEN)
  OPEN            a struck load-bearing field: a value a check needs could not be read or was withdrawn
  ledger          the hash-chained, append-only file of verdicts and signed decisions (the "book of record";
                  --from-book reads from it)
  rung            a workflow's autonomy level, granted by a person: record, advise, gate or autonomy
  verify twin, verify twin-einvoice
                  compare extracted values with the document's own machine-readable copy: a filing's inline XBRL,
                  an e-invoice's XML`

/** The binary this build is installed as: `verify` in the lab, `riposte-verify` in the public tree (the export renames USAGE). */
const BIN = USAGE.slice(0, USAGE.indexOf(" "))

/**
 * The first screen (2026-10-05): what a buyer runs first, with each command's exit codes, in 40 lines or fewer. Every
 * command's own options: `verify <command> --help`; the whole reference: `verify --help all` (USAGE, below).
 */
const HELP = `${BIN} checks extracted documents deterministically. Every answer is a verdict anyone can replay.

Start with one of these:

${BIN} ap <layout.txt>                       AP three-way match: invoice, purchase order, goods receipt
${BIN} ap --input <ap-input.json>            the same, from structured input (docs/AP-INPUT.md)
    exit 0 approve · 1 hold · 2 abstain (a person decides; also when a check could not run) · 3 usage or unreadable input

${BIN} check <extraction.json> [--ruleset <name | file.json>] [--source <file.txt>] [--allow-open]
    check extracted values against a ruleset (default: invoice). The verdict is JSON on stdout; the headline on
    stderr reads PASS, PASS-WITH-OPEN (every check that ran held, some could not run), FAIL or INSUFFICIENT_DATA.
    \`${BIN} <extraction.json>\` is the same command. It fails closed: only a clean PASS exits 0.
    exit 0 PASS · 1 FAIL · 2 PASS-WITH-OPEN (--allow-open: 0 when each open check waits on a reference or a missing field) or
    INSUFFICIENT_DATA · 3 usage error or unreadable input

${BIN} replay <verdict.json> --extraction <file> --ruleset <name | file> [--source <file>]
${BIN} replay <bundle.json | cases.jsonl | folder>
    re-perform a verdict you were handed and byte-compare it with the original. --trusted-key pins the signing key;
    --strict also fails on anything that was not re-performed.
    exit 0 verified · 1 failed (tampered, foreign inputs, untrusted key) · 2 structure checked, not re-performed
    · 3 usage error, unreadable input, a key or an annotation member the format does not define, or an input the verdict
    names was left out

More:
  ${BIN} <command> --help    one command's options (ap, check, replay, lint, extract-schema, measure, ...)
  ${BIN} --help all          every command: rulesets, the ledger, signed decisions, reconcile, anchors, filing and e-invoice comparisons
  ${BIN} --version           this build's version and the engines whose verdicts it replays

Text and JSON inputs are read as UTF-8: a file that is not valid UTF-8, a JSON file that starts with a byte-order
mark, and a JSON number past the double range (1e999) are refused (exit 3), never hashed.`

/** The verbs a shared note in USAGE applies to ("grant | decline | revise-policy | review | canary also take ..."). */
const SHARED_NOTE = /^ {2}([a-z-]+(?: \| [a-z-]+)+) also take /

/** USAGE as command blocks, in order: the verbs each block documents and its text. The first block is `check` (verify <doc>). */
function usageBlocks(): { verbs: string[]; text: string }[] {
  const out: { verbs: string[]; lines: string[] }[] = []
  let cur: { verbs: string[]; lines: string[] } | undefined
  for (const line of USAGE.split('\n')) {
    const head = /^(?:riposte-)?verify (\S+)/.exec(line)
    const shared = SHARED_NOTE.exec(line)
    if (head) {
      const verb = head[1]!.startsWith('<') ? 'check' : head[1]!
      if (cur && cur.verbs.length === 1 && cur.verbs[0] === verb && cur.lines.every(l => /^(?:riposte-)?verify /.test(l) || /^\s/.test(l))) cur.lines.push(line)
      else { cur = { verbs: [verb], lines: [line] }; out.push(cur) }
    } else if (shared) {
      cur = { verbs: shared[1]!.split(' | '), lines: [line] }
      out.push(cur)
    } else if (cur && /^\s+\S/.test(line)) cur.lines.push(line)
    else cur = undefined
  }
  return out.map(b => ({ verbs: b.verbs, text: b.lines.join('\n') }))
}

/** One command's help (2026-10-05): its blocks of USAGE, or undefined when there is no such command. */
function helpFor(verb: string): string | undefined {
  const blocks = usageBlocks().filter(b => b.verbs.includes(verb))
  return blocks.length ? `${blocks.map(b => b.text).join('\n')}\n(every command: ${BIN} --help all)` : undefined
}

/** Print a command's help on stderr (the first screen when it has none of its own). Exit 0. */
function printHelp(io: CliIO, verb: string): number {
  io.err(`${helpFor(verb) ?? HELP}\n`)
  return 0
}

/**
 * How the reader can type this CLI again, for the hints a usage error prints (2026-10-05: `see: riposte-verify replay --help`
 * could not be typed in a source checkout, where nothing by that name is on PATH). Run as `node <path>/cli.js` from a checkout,
 * a hint names that command, the path relative to the current folder; run from TypeScript, `npx tsx <path>/cli.ts`; installed
 * (the path runs through node_modules) or called in-process (tests, a host), the binary's name.
 */
export function invokedAs(main: string | undefined = process.argv[1], cwd: string = process.cwd()): string {
  if (!main || !/[\\/]cli\.[cm]?[jt]s$/.test(main) || /[\\/]node_modules[\\/]/.test(main)) return BIN
  let p = relative(cwd, main)
  if (!p || isAbsolute(p)) p = main
  p = p.split(/[\\/]/).join('/')
  const shown = /[\s"'$`&|;()<>]/.test(p) ? JSON.stringify(p) : p
  return /\.[cm]?ts$/.test(p) ? `npx tsx ${shown}` : `node ${shown}`
}

/** The one-line pointer that follows a usage error (never the whole reference). */
const seeHelp = (verb: string): string => `see: ${invokedAs()} ${verb.split(' ')[0] === 'check' || verb === '' ? 'check' : verb.split(' ')[0]} --help`

/** Edit distance (for "did you mean"). */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0]![j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
  }
  return d[a.length]![b.length]!
}

/** " (did you mean --ruleset?)" for an unknown option close to a known one, else "". */
function didYouMean(unknown: string, known: readonly string[]): string {
  const name = unknown.replace(/=.*$/, '')
  let best: string | undefined, bestD = 3
  for (const k of known) { const dd = editDistance(name, k); if (dd < bestD) { best = k; bestD = dd } }
  return best !== undefined && best !== name ? ` (did you mean ${best}?)` : ''
}

/** The unknown options of a verb, as one usage line with a suggestion per option. */
function unknownOptions(unknown: readonly string[], known: readonly string[]): string {
  return `unknown option(s) ${unknown.map(u => `${u}${didYouMean(u, known)}`).join(', ')}`
}

/**
 * A text input, read under the hash contract (2026-10-05; src/protocol/hash-input.ts): the file's bytes decoded as UTF-8
 * with a FATAL decoder. Bytes that are not UTF-8 are refused with their offset, never replaced by U+FFFD (three source files that
 * differed in one byte used to share one input_hash). A byte-order mark is kept, as before. `-` (or 0) is stdin.
 */
function readText(path: string | 0): string {
  if (path !== 0 && path !== '-' && isFolder(path)) throw new Error(`${path} is a folder, not a file`)
  return decodeUtf8Strict(readFileSync(path === '-' ? 0 : path), path === 0 || path === '-' ? 'stdin' : path)
}

/** True when `path` names a folder (false when it names a file or nothing). */
function isFolder(path: string): boolean {
  try { return statSync(path).isDirectory() } catch { return false }
}

/** A JSON input, read under the hash contract: UTF-8 (readText), no byte-order mark, no number past the double range. */
function readJson(path: string | 0): Json {
  return parseJsonStrict(readText(path), path === 0 || path === '-' ? 'stdin' : path) as Json
}

/**
 * A declarative ruleset named on the command line (2026-10-03): a name this build carries resolves to its embedded,
 * verbatim copy (`peppol-en16931` → 0.2.0, `peppol-en16931@0.1.0`, `e-invoice`; rulesets/declarative.ts); anything else is
 * read as a JSON file. A file whose path is exactly a carried name is read by writing it as a path (`./peppol-en16931`).
 */
function readRulesetArg(arg: string): Json {
  const named = resolveDeclarativeRuleset(arg)
  if (named !== undefined) return named as unknown as Json
  // 2026-10-05: a mistyped name used to answer with a raw ENOENT on a file nobody meant
  if (!existsSync(arg)) throw new ArgRefused(`no ruleset named "${arg}"${didYouMean(arg, knownRulesetNames())}; known: ${knownRulesetNames().join(', ')}; or the path of a ruleset JSON file`)
  return readJson(arg)
}

/** A command-line value that names nothing usable (a ruleset name nobody carries, a --source that is not a file): exit 3, said plainly. */
class ArgRefused extends Error {}

/** Every ruleset name `--ruleset` takes: the built-in ones, then each carried declarative id, id@version and domain name. */
function knownRulesetNames(): string[] {
  return [...BUILTIN, ...carriedRulesetNames()]
}

/** `--source <file>`: the page text, read from a file (2026-10-05: `--source "some text"` used to answer with a raw ENOENT). */
function readSourceArg(path: string): string {
  if (path !== '-' && !existsSync(path)) throw new ArgRefused(`--source takes a file path (the source document's text, read as UTF-8); there is no file named ${JSON.stringify(path)}`)
  return readText(path)
}

/** A labels file is either an array of {extraction,label} or an object { cases: [...] }. */
function readLabels(path: string): LabeledCase[] {
  const raw = readJson(path) as unknown
  const arr = Array.isArray(raw) ? raw : (raw as { cases?: unknown }).cases
  if (!Array.isArray(arr)) throw new Error('labels file must be an array of {extraction,label} or { "cases": [...] }')
  return arr as LabeledCase[]
}

function runLint(argv: string[], io: CliIO): number {
  const a = parse(argv)
  if (a.help) return printHelp(io, 'lint')
  if (a.unknown.length) return usageError(io, 'lint', unknownOptions(a.unknown, PARSE_FLAGS))
  if (!a.ruleset) return usageError(io, 'lint', 'needs --ruleset <file.json | name>')
  let ruleset: DeclarativeRuleset
  try { ruleset = readRulesetArg(a.ruleset) as unknown as DeclarativeRuleset } catch (e) { io.err(`error reading ruleset: ${(e as Error).message}\n`); return 3 }
  const result = lintRuleset(ruleset)
  io.out(`${JSON.stringify(result, null, 2)}\n`)
  return result.ok ? 0 : 1
}

function runMeasure(argv: string[], io: CliIO): number {
  const a = parse(argv)
  if (a.help) return printHelp(io, 'measure')
  if (a.unknown.length) return usageError(io, 'measure', unknownOptions(a.unknown, PARSE_FLAGS))
  if (!a.ruleset || !a.labels) return usageError(io, 'measure', 'needs --ruleset <file.json | name> and --labels <set.json>')
  let ruleset: DeclarativeRuleset, cases: LabeledCase[]
  try {
    ruleset = readRulesetArg(a.ruleset) as unknown as DeclarativeRuleset
    cases = readLabels(a.labels)
  } catch (e) { io.err(`error reading input: ${(e as Error).message}\n`); return 3 }
  const m = measureRuleset(ruleset, cases)
  io.out(`${renderMeasurement(m)}\n${JSON.stringify(m.accuracy, null, 2)}\n`)
  return 0
}

function runVerify(argv: string[], io: CliIO): number {
  const a = parse(argv)
  if (a.help) return printHelp(io, 'check')
  if (a.unknown.length) { io.err(`verify: ${unknownOptions(a.unknown, PARSE_FLAGS)}\n${seeHelp('check')}\n`); return 3 }
  if (!a.file) { io.err(`verify: needs <extraction.json> (or - for stdin)\n${seeHelp('check')}\n`); return 3 }
  // 2026-10-05: `verify replya x.json` used to check x.json (the last word won); one extraction per call
  if (a.files.length > 1) { io.err(`verify: one extraction per call (got ${a.files.join(', ')})\n${seeHelp('check')}\n`); return 3 }
  if (a.gate && a.allowOpen) { io.err(`verify: --gate and --allow-open read an open verdict two ways: give one\n${seeHelp('check')}\n`); return 3 }
  // 2026-10-13: --payer-role names who pays a pay application; it changes the words of the report, never the verdict
  if (a.payerRole !== undefined && a.payerRole !== 'owner' && a.payerRole !== 'payer') { io.err(`verify: --payer-role ${JSON.stringify(a.payerRole ?? '')}: give owner (the AIA owner pays this application) or payer (anyone else, the default)\n${seeHelp('check')}\n`); return 3 }
  if (a.payerRole !== undefined && a.ruleset !== 'pay-app') { io.err(`verify: --payer-role applies to a pay application (--ruleset pay-app)\n${seeHelp('check')}\n`); return 3 }
  // 2026-10-05: a folder is a replay target, never an extraction (it used to answer with a raw EISDIR)
  if (a.file !== '-' && isFolder(a.file)) { io.err(`verify: ${a.file} is a folder, not an extraction.\ndid you mean: ${invokedAs()} replay ${a.file}\n`); return 3 }
  let extraction: Json
  try { extraction = readJson(a.file) } catch (e) { io.err(`error reading extraction: ${(e as Error).message}\n`); return 3 }
  // 2026-10-05: a verdict, an envelope or a bundle handed to check is a replay the caller forgot to ask for, never a fresh
  // check of the verdict's own fields (it used to answer INSUFFICIENT_DATA, exit 2, with a new verdict about the old one)
  const verdictLike = verdictShape(extraction)
  if (verdictLike) { io.err(`verify: ${a.file} looks like ${verdictLike}, not an extraction.\ndid you mean: ${invokedAs()} replay ${a.file}\n`); return 3 }
  // The library's own refusal (src/protocol/input.ts): no document to bind a verdict to.
  const problem = extractionProblem(extraction)
  if (problem) { io.err(`verify: input refused: ${problem}\n`); return 3 }

  const opts: VerifyOptions = {}
  try {
    if (a.ruleset) {
      opts.ruleset = BUILTIN.has(a.ruleset) ? (a.ruleset as 'invoice' | 'pay-app') : (readRulesetArg(a.ruleset) as unknown as DeclarativeRuleset)
    }
    const references: NonNullable<VerifyOptions['references']> = {}
    if (a.contract) references.contract = readJson(a.contract)
    if (a.evidence.length) references.evidence = a.evidence.map(readJson)
    if (a.history.length) references.history = a.history.map(readJson)
    if (Object.keys(references).length) opts.references = references
    if (a.quotes && !a.source) throw new Error('--quotes are found in --source: give the source text too')
    if (a.source) opts.source = { text: readSourceArg(a.source), ...(a.quotes ? { quotes: readQuotes(a.quotes) } : {}) }
    // Engine 0.5.0: archive bytes and the judge's choice values, declarative rulesets only
    if ((a.archiveFiles.length || a.suppliedChoices) && !isDeclarativeRuleset(opts.ruleset)) throw new Error('--archive-file and --supplied-choices are read by a declarative ruleset only')
    if (a.archiveFiles.length) opts.archive_files = a.archiveFiles.map(archiveFileArg)
    if (a.suppliedChoices) opts.supplied_choices = readJson(a.suppliedChoices) as unknown as NonNullable<VerifyOptions['supplied_choices']>
  } catch (e) {
    if (e instanceof ArgRefused) { io.err(`verify: ${e.message}\n${seeHelp('check')}\n`); return 3 }
    io.err(`error reading reference: ${(e as Error).message}\n`); return 3
  }

  let verdict: Verdict
  try { verdict = verify(extraction, opts) } catch (e) {
    if (e instanceof InputRefused) { io.err(`verify: input refused: ${e.message}\n`); return 3 }
    throw e
  }
  io.out(`${JSON.stringify(verdict, null, 2)}\n`)
  // Engine 0.3.0: with --case-dir and --parties, an OPEN verdict opens its case automatically (nobody has to ask)
  if (a.caseDir !== undefined || a.parties !== undefined) {
    if (!a.caseDir || !a.parties) { io.err('verify: --case-dir and --parties go together (an OPEN verdict opens its case there)\n'); return 3 }
    if (gateStatusOpen(verdict) === 'OPEN') {
      if (!isDeclarativeRuleset(opts.ruleset)) io.err('verify: the verdict is OPEN, but a case opens on a declarative verdict only; none opened\n')
      else {
        try {
          const st = openCase({ dir: a.caseDir, verdict, inputs: verifyInputs(extraction, { ruleset: opts.ruleset, ...(opts.source ? { source: opts.source } : {}), ...(opts.supplied_choices ? { supplied_choices: opts.supplied_choices } : {}), ...(opts.archive_files ? { archive_files: opts.archive_files } : {}) }), parties: readJson(a.parties), now: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') })
          io.err(`verify: the verdict is OPEN: case ${st.record.case_id} opened in ${a.caseDir} (${st.record.clock.working_days} working days, ${st.record.clock.kind}; deadline ${st.record.clock.deadline})\n`)
        } catch (e) { io.err(`verify: the verdict is OPEN, but the case did not open: ${(e as Error).message}\n`) }
      }
    }
  }
  const scope = scopeLines(verdict).map(l => `  ${l}`).join('\n')
  const closing = scope ? `\n${scope}\n` : '\n'
  // Engine 0.3.0: a struck load-bearing field leaves the verdict OPEN: not PASS, not FAIL, nothing booked as a FAIL.
  if (a.gate && gateStatusOpen(verdict) === 'OPEN') {
    const unlock = new Map((verdict.would_unlock ?? []).map(w => [w.field, w.claims]))
    const lines = (verdict.struck ?? []).map(s => `${s.field}${s.path !== undefined ? ` (${s.path})` : ''}: ${s.reason}${s.reason === 'suspect' && s.candidates ? ` (${s.candidates.failing} of ${s.candidates.checked} readings one step away fail a check, e.g. ${JSON.stringify(s.candidates.shown[0]?.read_as ?? '?')}; a flag, not a FAIL)` : ''} → unlocks ${(unlock.get(s.field) ?? []).join(', ')}`)
    io.err(`verify: OPEN: ${verdict.counts?.checks_computed ?? 0} check(s) computed, ${verdict.counts?.checks_struck ?? 0} wait on ${lines.length} struck field(s):\n${lines.map(l => `  ${l}`).join('\n')}\n  Nothing is booked as a FAIL. It resolves by evidence (a CORRECT or CORROBORATE in a case: verify case open), by a STRIKE, or by its clock.${closing}`)
    return 2
  }
  // Engine 0.2.0: a claim held as suspect is booked as a FAIL at the gate (verdict/aggregation.ts), whatever the outcome says.
  if (a.gate && gateLabel(verdict) === 'HELD-SUSPECT') {
    const held = heldSuspectClaims(verdict).map(c => `${c.claim_id} (${(c.suspect?.reported ?? []).map(r => `${r.role} ${JSON.stringify(r.raw)}`).join(', ')})`)
    io.err(`verify: HELD-SUSPECT: ${held.length} check(s) could not read a value, and a reading of it one character away fails the check: ${held.join(', ')}. The gate books it as a FAIL.\n`)
    return 1
  }
  if (a.gate && gateStatus(verdict) === 'PASS-WITH-OPEN') {
    const open = openClaims(verdict).map(c => `${c.claim_id} (${c.insufficiency?.reason ?? 'undecided'})`)
    io.err(`verify: PASS-WITH-OPEN: every check that ran held, but ${open.length} could not run: ${open.join(', ')}. A gate holds.${closing}`)
    return 2
  }
  if (a.gate && scope) io.err(`verify: ${gateStatusOpen(verdict)}${closing}`)
  if (a.gate) return verdict.outcome === 'PASS' ? 0 : verdict.outcome === 'FAIL' ? 1 : 2
  // 2026-10-05: the headline names the gate status, never a bare PASS when a check could not run.
  io.err(`verify: ${gateHeadline(verdict)}\n`)
  // 2026-10-05: fail closed by default. The exit code is the gate's reading: 0 only on a clean PASS. "A CI user wiring exit
  // codes gets fail-open by default" (a cold reader, cold review round 2): PASS-WITH-OPEN used to exit 0 unless --gate was given.
  // (verdict/exit.ts: the one reading the CLI, HTTP and MCP share)
  const reading = verdictExit(verdict, a.allowOpen)
  if (reading.gate === 'HELD-SUSPECT') io.err(`  exit 1: ${reading.words}\n`)
  else if (reading.allow_open) io.err(`  ${reading.words.replace('allow-open', '--allow-open')}\n`)
  else if ((reading.gate === 'PASS-WITH-OPEN' || reading.gate === 'OPEN') && verdict.outcome === 'PASS') {
    // 2026-10-19: --allow-open stated and not applied (an open check it does not accept, or a struck field): say why, never "pass --allow-open"
    if (a.allowOpen) io.err(`  exit 2: ${reading.words.replace('allow-open', '--allow-open')}. Supply what they need (--gate names each)\n`)
    else {
      // 2026-10-19: --allow-open is suggested only where it would apply; elsewhere the line says it would not, and why
      const would = verdictExit(verdict, true).exit === 0
      io.err(`  exit 2: ${reading.words}. Supply what they need (--gate names each)${would ? ', or pass --allow-open to exit 0 on an open verdict' : '; --allow-open would not apply here: it accepts only checks that wait on a reference or a field the document does not carry, with no field struck'}\n`)
    }
  }
  // 2026-10-05: a pay application gets the plain-English block `ap` prints for a bill: each failed or open check, the
  // fields it read, who may clear it (src/rulesets/pay-app/report.ts). The JSON on stdout is unchanged.
  if (opts.ruleset === 'pay-app') io.err(formatPayAppReport(verdict, { extraction, ...(a.payerRole === 'owner' ? { payer_role: 'owner' as const } : {}) }))
  return reading.exit
}

/**
 * What a file handed to `check` looks like when it is a replay target (2026-10-05): "a verdict", "a signed envelope" or "a
 * replay bundle", or undefined for anything else (an extraction). A verdict is what replay.ts would bind: verdict_id, input_hash,
 * ruleset {id, version} and engine_version.
 */
function verdictShape(x: unknown): string | undefined {
  if (!isObj(x)) return undefined
  const binds = (v: unknown): boolean => isObj(v) && typeof v.verdict_id === 'string' && typeof v.input_hash === 'string' && typeof v.engine_version === 'string' && isObj(v.ruleset)
  if (binds(x)) return 'a verdict (it carries verdict_id, input_hash, ruleset and engine_version)'
  if (isObj(x.verdict) && typeof x.signature === 'string' && typeof x.public_key === 'string') return 'a signed envelope (a verdict with its signature)'
  if (binds(x.verdict) && 'inputs' in x) return 'a replay bundle (a verdict with its inputs)'
  return undefined
}

/** --quotes: [{ id, quote, label? }] (or { quotes: [...] }), non-empty strings. */
function readQuotes(path: string): QuoteAssertion[] {
  const raw = readJson(path) as unknown
  const list: unknown = Array.isArray(raw) ? raw : (raw !== null && typeof raw === 'object' ? (raw as { quotes?: unknown }).quotes : undefined)
  const ok = Array.isArray(list) && list.every(q => q !== null && typeof q === 'object'
    && typeof (q as QuoteAssertion).id === 'string' && (q as QuoteAssertion).id.length > 0
    && typeof (q as QuoteAssertion).quote === 'string' && (q as QuoteAssertion).quote.length > 0
    && ((q as QuoteAssertion).label === undefined || typeof (q as QuoteAssertion).label === 'string'))
  if (!ok) throw new Error(`${path}: --quotes is [{ "id", "quote", "label"? }] with non-empty strings`)
  return list as QuoteAssertion[]
}

/** --archive-file <path> (engine 0.5.0): the file's bytes as the evaluator takes them, named by the file's base name. */
function archiveFileArg(path: string): { name: string; base64: string } {
  return { name: basename(path), base64: readFileSync(path).toString('base64') }
}

const REPLAY_FLAGS: FlagSpec = {
  inputs: 'value', extraction: 'value', ruleset: 'value', contract: 'value', evidence: 'multi', history: 'multi', source: 'value', quotes: 'value',
  tolerance: 'value', document: 'value', pre: 'value', 'filing-summary': 'value', schema: 'value',
  // Engine 0.5.0: with --extraction and a declarative ruleset, the archive bytes and the judge's choice values the verdict bound
  'archive-file': 'multi', 'supplied-choices': 'value',
  // 2026-10-05: pin the signing key; fail on anything that was not re-performed
  'trusted-key': 'value', strict: 'bool',
  // 2026-10-13: an emailed-bill result read from three files is re-performed from them
  invoice: 'value', po: 'value', receipt: 'value',
  // 2026-10-05: accept an engine-0.0.1/0.1.0 verdict whose remedies are absent (compare its core, report the re-derived ones)
  'lenient-remedies': 'bool',
  // 2026-10-05: the relying party's floor on the verdict's rule, e.g. legal@>=0.4.0 (legal/replay-notice.ts)
  'require-ruleset': 'multi',
  // 2026-10-19: read a bundle or envelope with keys its format does not define as before (carried, not checked) instead of refusing it
  'allow-unknown-keys': 'bool',
}
/** The flags that build verify()'s inputs from the documents themselves (the same flags `verify <doc>` takes). */
const DOC_FLAGS = ['ruleset', 'contract', 'source', 'quotes'] as const

/**
 * How a pinned set of fingerprints names `pem`: by its fingerprint ('current'), by the older fingerprint form ('older', still
 * accepted for this release; 2026-10-05), or not at all (undefined).
 */
function trustMatch(trust: ReadonlySet<string>, pem: string): 'current' | 'older' | undefined {
  const fp = keyFingerprint(pem)
  if (fp !== undefined && trust.has(fp)) return 'current'
  const old = legacyKeyFingerprint(pem)
  return old !== undefined && trust.has(old) ? 'older' : undefined
}

/** The note printed when --trusted-key matched by the older fingerprint form. */
const olderFormNote = (fp: string | undefined): string =>
  `verify replay: note: --trusted-key matched this key by the older fingerprint form (sha256 of the key's base64 text), which this release still accepts; pin ${fp ?? 'the key\'s fingerprint'} instead (sha256 over the key's DER bytes)\n`

/**
 * `--trusted-key <k>` (2026-10-05): the key a replayed envelope must be signed with, as the set of key fingerprints it names.
 * `k` is a public key file (a PEM block, or verify keygen's JSON: its public_key and trusted_keys), an inline PEM, or a key
 * fingerprint (64 hex, as replay prints it: sha256 over the key's DER bytes; the older form, sha256 of the base64 text, is matched
 * too for this release, trustMatch). A private key is refused: the trusted key is the public half.
 */
function readTrustedKeyArg(k: string): Set<string> {
  const fps = new Set<string>()
  const addPem = (pem: string): void => {
    const fp = keyFingerprint(pem)
    if (fp === undefined) throw new Error('--trusted-key: not an Ed25519 public key')
    fps.add(fp)
  }
  if (/^[0-9a-f]{64}$/i.test(k.trim())) { fps.add(k.trim().toLowerCase()); return fps }
  const text = k.includes('-----BEGIN') ? k : existsSync(k) ? readText(k) : undefined
  // 2026-10-05: a prefix is refused on purpose. 12 hex digits are 48 bits, which a determined forger can grind a key to match.
  if (text === undefined && /^[0-9a-f]{8,63}$/i.test(k.trim())) throw new Error(`--trusted-key ${k}: a fingerprint prefix is not a pin (a key can be ground to match a short prefix): pass the full 64-hex fingerprint, which replay prints on stderr as "signing key fingerprint"`)
  if (text === undefined) throw new Error(`--trusted-key ${k}: no such file, and not a PEM public key or a 64-hex key fingerprint`)
  if (/PRIVATE KEY-----/.test(text)) throw new Error('--trusted-key holds a PRIVATE key: pass the PUBLIC key (the .pub.pem verify keygen wrote), and keep the private key to the signer')
  const t = text.trim()
  if (t.startsWith('{')) {
    const raw = parseJsonStrict(t, `--trusted-key ${k}`)
    const pems: string[] = []
    if (isObj(raw) && typeof raw.public_key === 'string') pems.push(raw.public_key)
    const tk = isObj(raw) && isObj(raw.trusted_keys) ? raw.trusted_keys : isObj(raw) && raw.public_key === undefined ? raw : undefined
    if (tk) for (const v of Object.values(tk)) for (const x of Array.isArray(v) ? v : [v]) if (typeof x === 'string') pems.push(x)
    if (!pems.length) throw new Error(`--trusted-key ${k}: no public key in it (expected verify keygen's output, or { "<signer>": "<public PEM>" })`)
    for (const pem of new Set(pems)) addPem(pem)
    return fps
  }
  const blocks = t.match(PEM_PUBLIC) ?? []
  if (!blocks.length) throw new Error(`--trusted-key ${k}: no -----BEGIN PUBLIC KEY----- block in it`)
  for (const pem of blocks) addPem(pem)
  return fps
}

/** "PASS-WITH-OPEN: 3 of 13 checks could not run", with the AP gate's decision first when there is one (2026-10-05). */
function replayHeadline(verdict: Verdict, gate?: GateReading): string {
  const words = gateHeadline(verdict)
  if (!gate) return words
  // 2026-10-05: an approve the gate does not pay on (payable not true) reads A PERSON DECIDES (replay-case.ts renderGate)
  return `${renderGate(gate)} · verdict ${words}`
}

/**
 * The FAILED lines for an input_hash that does not match (2026-10-05): what failed, both hashes labelled for what
 * they are, then one line per thing the replay can say about which input disagrees.
 */
function inputMismatchLines(result: ReplayCheck): string[] {
  const reason = result.reason ?? ''
  const cut = reason.indexOf('this verdict is not for these inputs')
  const rest = cut < 0 ? '' : reason.slice(cut + 'this verdict is not for these inputs'.length).replace(/^[:.]\s*/, '')
  return [
    'FAILED: input_hash does not match the supplied inputs: this verdict is not for these inputs',
    `  recorded ${result.recorded_input_hash ?? '?'} (in the verdict)`,
    `  computed ${result.computed_input_hash ?? result.expected_input_hash ?? '?'} (from the inputs given here)`,
    ...topLevelClauses(rest).map(s => `  ${s}`),
  ]
}

/** A reason split into its clauses at "; " and at sentence ends, never inside parentheses. */
function topLevelClauses(text: string): string[] {
  const out: string[] = []
  let depth = 0, cur = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    const sentenceEnd = ch === '.' && text[i + 1] === ' ' && /[A-Z]/.test(text[i + 2] ?? '')
    if (depth === 0 && ((ch === ';' && text[i + 1] === ' ') || sentenceEnd)) { out.push(cur); cur = ''; i++; continue }
    cur += ch
  }
  out.push(cur)
  return out.map(s => s.trim().replace(/\.$/, '')).filter(Boolean)
}

/**
 * `verify replay`: check a verdict someone handed you (2026-09-28). The verdict_id binds the INPUTS, not the
 * outcome, so the binding alone never says the outcome is right. Given the inputs, the check is RE-PERFORMED here and the
 * recomputed verdict byte-compared with the presented one (issued_at and post-engine annotations aside):
 *   exit 0  REPERFORMED     the outcome was re-performed and is byte-identical: the outcome is verified
 *   exit 1  FAILED          the binding does not hold, the re-performed verdict differs (the first differing field is
 *                           named), a signed envelope's signature does not verify, its key is not the --trusted-key, or a
 *                           --strict replay found something that was not re-performed
 *   exit 2  STRUCTURE_ONLY  structure verified; outcome NOT re-performed (no inputs, or nothing here can re-perform them)
 *   exit 3  not a verdict, or a usage/input error
 * The file may be a signed envelope ({ verdict, alg, public_key, signature }, signVerdict): its signature is checked too.
 * The first stderr line of a match is unchanged since 2026-10-04 (the drift bank digests it); what was added on 2026-10-05 follows it.
 */
function runReplay(argv: string[], io: CliIO): number {
  const verb = 'replay'
  const f = parseFlags(argv, REPLAY_FLAGS, { positional: 1 })
  if (f.help) return printHelp(io, 'replay')
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  const file = f.args[0]
  if (!file) { io.err(`verify replay: needs <verdict.json> (a verdict, a signed envelope, or a bundle), a cases.jsonl, or a folder of bundles\n${helpFor('replay') ?? ''}\n`); return 3 }
  const strict = f.on.has('strict')
  const lenientRemedies = f.on.has('lenient-remedies')
  const allowUnknown = f.on.has('allow-unknown-keys')
  let trust: Set<string> | undefined
  try { trust = f.v['trusted-key'] !== undefined ? readTrustedKeyArg(f.v['trusted-key']) : undefined } catch (e) { return inputError(io, verb, e) }
  // 2026-10-05: --require-ruleset <id>@>=<version>, repeatable; a verdict naming that ruleset at an older version FAILS
  let reqs: RulesetRequirement[] = []
  try { reqs = (f.multi['require-ruleset'] ?? []).map(parseRulesetRequirement) } catch (e) { return usageError(io, verb, (e as Error).message) }
  const docFlags = [...DOC_FLAGS.filter(n => f.v[n] !== undefined), ...(f.multi.evidence ? ['evidence'] : []), ...(f.multi.history ? ['history'] : []), ...(f.multi['archive-file'] ? ['archive-file'] : []), ...(f.v['supplied-choices'] !== undefined ? ['supplied-choices'] : [])]
  const anyInputFlag = f.v.inputs !== undefined || f.v.extraction !== undefined || docFlags.length > 0
  // A folder of bundles, or a .jsonl of them: every case replayed on its own inputs (2026-10-02).
  const isDir = isFolder(file)
  if (isDir || /\.jsonl$/i.test(file)) {
    if (anyInputFlag) return usageError(io, verb, 'a folder or .jsonl of bundles carries each case\'s own inputs: give no --inputs / --extraction')
    return runReplayCases(file, isDir, io, { ...(trust ? { trust } : {}), strict, lenientRemedies, reqs, allowUnknown })
  }
  // 2026-10-13: the output of `ap` on an emailed bill, re-performed from the text and payment history it was read from. The
  // file is read once and shared, so `replay -` (stdin, one stream) reads what it was given
  let once: { v: unknown } | { e: unknown } | undefined
  const readOnce = (): unknown => {
    once ??= (() => { try { return { v: readJson(file) } } catch (e) { return { e } } })()
    if ('e' in once) throw once.e
    return once.v
  }
  let apText: { verdict: unknown; inputs: unknown; note: string } | null = null
  try {
    const t = apTextReplay(file, f, readOnce)
    // ruled 2026-10-13: a refusal (exit 3) compared none of the files `read` records, so `read` is named as carried, not checked
    if (t && 'exit' in t) {
      const unread = t.exit === 3 ? carriedKeys(readOnce()) : []
      io.err(`${t.message}${unread.length ? `verify replay: ${carriedLine(unread)}\n` : ''}`)
      return t.exit
    }
    apText = t
  } catch (e) { return inputError(io, verb, asReplayRefusal(e)) }
  if (!apText && (f.v.invoice !== undefined || f.v.po !== undefined || f.v.receipt !== undefined)) {
    return usageError(io, verb, '--invoice, --po and --receipt re-perform the output of `ap --invoice --po --receipt` (an emailed bill read from three files); this file is not one')
  }
  // 2026-10-04: a declarative verdict names the inputs it was issued with. A call that gives some of them but not all is
  // told in one line exactly which flags this verdict needs, before any hash is compared: a usage error, never a failed binding.
  const short = !apText && f.v.inputs === undefined && anyInputFlag ? shortOfInputs(file, f) : undefined
  if (short !== undefined) { io.err(`verify replay: ${short}\n`); return 3 }
  if (f.v.inputs !== undefined && (f.v.extraction !== undefined || docFlags.length)) {
    return usageError(io, verb, '--inputs is the whole input a verdict is bound to; --extraction [--ruleset/--contract/--evidence/--history/--source] builds it from the documents. Give one, not both')
  }
  if (!apText && f.v.extraction === undefined && docFlags.length) return usageError(io, verb, `${docFlags.map(n => `--${n}`).join(', ')} build verify()'s inputs with --extraction <doc.json>`)
  let raw: unknown, inputs: unknown, opts: ReplayOptions
  try {
    raw = apText ? apText.verdict : readOnce()
    inputs = apText ? apText.inputs : f.v.inputs !== undefined ? readJson(f.v.inputs) : f.v.extraction !== undefined ? verifyInputsFrom(f, presentedVerdict(raw)) : undefined
    opts = replayOptions(f)
    if (lenientRemedies) opts.lenientRemedies = true
  } catch (e) { return inputError(io, verb, asReplayRefusal(e)) }
  // 2026-10-13: the keys the file carries outside the verdict and its inputs (replay-case.ts carriedKeys), read off the file as
  // given: named on the line under the first, listed in the JSON, and refused by --strict
  // 2026-10-13, ruled: `id` and `note` at a bundle's top level are allowed, named apart; `read` is carried unless the files it
  // records were given and compared, which is what a non-null apText means
  const carried = carriedKeys(apText ? readOnce() : raw, { readUsed: apText !== null })
  const allowed = allowedKeys(apText ? readOnce() : raw)
  // 2026-10-19: a bundle or a signed envelope with a key its format does not define is refused (exit 3), each key named, before
  // anything is hashed, unless --allow-unknown-keys says to carry it as before (replay-case.ts unknownKeys). The output of `ap` is
  // not a bundle: a key it never writes fails its replay below, by name.
  const unknown = apText ? undefined : unknownKeys(raw)
  if (unknown && unknown.keys.length && !allowUnknown) {
    const reason = unknownKeysReason(unknown.kind, unknown.keys)
    io.out(`${JSON.stringify({ ok: false, status: 'REFUSED', refused: true, reason, unknown_keys: unknown.keys }, null, 2)}\n`)
    io.err(`verify replay: input refused: ${reason}\n`)
    return 3
  }
  // 2026-10-06: the file `ap --input` writes carries its proof ({ verdict, inputs }) as a member: that is what is replayed,
  // and the run says so (after its first line). A file whose own verdict is not its proof's is refused as a failed binding.
  const apProof = !apText && f.v.inputs === undefined && !anyInputFlag ? apProofOf(raw) : null
  const proofNote = apText ? apText.note : apProof ? 'verify replay: this file is the output of `ap --input`; its proof member (the verdict and the inputs it was issued on) was replayed\n' : ''
  if (apProof && !apProof.same) { io.err('verify replay: FAILED: the file\'s verdict is not the verdict in its proof member; the file was changed after `ap --input` wrote it\n'); return 1 }
  if (apProof) raw = apProof.proof
  // 2026-10-19: the file whose AP fields are compared once its verdict re-performs (protocol/replay-ap.ts): the output of `ap`
  // (emailed bill or structured input: every derived field, and any key `ap` never writes), or a bundle that states them
  const apFile: { file: Record<string, unknown>; whole: boolean } | undefined = apText !== null || apProof
    ? { file: readOnce() as Record<string, unknown>, whole: true }
    : isReplayBundle(raw) && apDerivedKeysIn(raw).length > 0 && apDerivable(raw) ? { file: raw as unknown as Record<string, unknown>, whole: false } : undefined
  // A bundle ({ verdict, inputs, options? }) carries its own inputs (2026-10-02).
  if (isReplayBundle(raw)) {
    if (anyInputFlag) return usageError(io, verb, 'the bundle carries its own inputs: give no --inputs / --extraction')
    const b = raw
    inputs = b.inputs
    if (isObj(b.options)) {
      if (opts.tolerance === undefined && isObj(b.options.tolerance)) opts.tolerance = b.options.tolerance as unknown as TolerancePolicy
      if (opts.document === undefined && typeof b.options.document === 'string') opts.document = b.options.document
    }
    raw = b.verdict
  }
  const envelope = isObj(raw) && isObj(raw.verdict) && typeof raw.signature === 'string' && typeof raw.public_key === 'string'
  const verdict = (envelope ? (raw as { verdict: unknown }).verdict : raw) as Verdict
  if (f.v.extraction !== undefined && f.v.ruleset !== undefined && BUILTIN.has(f.v.ruleset) && isObj(verdict) && isObj(verdict.ruleset) && verdict.ruleset.id !== f.v.ruleset) {
    return usageError(io, verb, `--ruleset ${f.v.ruleset} is not the verdict's ruleset (${String(verdict.ruleset.id)}): a check is re-performed under the ruleset that made it`)
  }
  const result: ReplayCheck = verifyReplay(verdict, inputs, opts)
  let sig: { alg: string; signature_ok: boolean; key_fingerprint?: string; reason?: string; trusted?: boolean; older_fingerprint_form?: true } | undefined
  // 2026-10-13: the older-fingerprint note is printed under the first line, never before it ("by the trusted key" leads)
  let olderNote = ''
  if (envelope) {
    const ec = verifyEnvelope(raw as unknown as SignedVerdict)
    const pem = String((raw as { public_key: unknown }).public_key)
    const fp = keyFingerprint(pem)
    const match = trust ? trustMatch(trust, pem) : undefined
    sig = { alg: String((raw as { alg?: unknown }).alg), signature_ok: ec.signature_ok, ...(fp ? { key_fingerprint: fp } : {}), ...(ec.reason ? { reason: ec.reason } : {}), ...(trust ? { trusted: match !== undefined } : {}), ...(match === 'older' ? { older_fingerprint_form: true as const } : {}) }
    if (match === 'older') olderNote = olderFormNote(fp)
  }
  // The answer in the public words, once the outcome was re-performed and matched (the remedies are in reperformed.remedies),
  // with what a person acts on: the checks that could not run and, for AP, the gate's decision (2026-10-03).
  const reading = result.status === 'REPERFORMED' ? replayReading(verdict, inputs) : undefined
  const answer = reading ? { answer: answerOf(verdict.outcome), ...reading } : {}
  // 2026-10-19: once the verdict re-performed, the AP gate's fields beside it are derived again and compared (protocol/replay-ap.ts).
  // For the output of `ap`, the keys it never writes (carried, above) are differences too, so they are refused, not carried; a
  // result whose inputs the gate cannot read again fails closed. A bundle's fields that were compared are no longer carried.
  let apCheck: ApFieldsCheck | undefined
  if (apFile && result.status === 'REPERFORMED') {
    apCheck = checkApFields(apFile.file, verdict, inputs, { whole: apFile.whole, unknown: apFile.whole ? carried : [] })
    if (!apCheck && apFile.whole) apCheck = { ok: false, differences: [{ field: 'decision', stated: apFile.file.decision, rederived: '(the gate cannot read these inputs again)' }] }
  }
  const apFailed = apCheck !== undefined && !apCheck.ok
  const shownCarried = apCheck === undefined ? carried : apFile?.whole ? [] : carried.filter(k => !(AP_DERIVED_KEYS as readonly string[]).includes(k))
  // 2026-10-05: what a strict replay fails on, for a verdict that re-performed (only computed, and printed, under --strict)
  const strictList = strict && result.status === 'REPERFORMED' ? strictProblems(verdict, result.reperformed?.remedies_not_carried === true, envelope && !trust, shownCarried) : []
  // 2026-10-05: the issuer's producer label is reported under --strict, never failed (replay-case.ts strictNotes)
  const strictNoteList = strict && result.status === 'REPERFORMED' ? strictNotes(verdict, envelope && trust !== undefined && sig?.trusted === true) : []
  const strictBlock = strict ? { strict: { ok: result.status === 'REPERFORMED' && strictList.length === 0, problems: strictList, ...(strictNoteList.length ? { notes: strictNoteList } : {}) } } : {}
  // 2026-10-05: the relying party's floor on the rule, read off the verdict (its id binds ruleset and version)
  const reqProblem = reqs.length && !result.refused ? rulesetRequirementProblem(reqs, verdict) : undefined
  const reqUnapplied = reqs.length && !result.refused ? unappliedRequirements(reqs, [verdict]) : []
  const requireBlock = reqs.length ? { require_ruleset: { ok: reqProblem === undefined, required: reqs.map(r => r.written), ...(reqProblem ? { problem: reqProblem } : {}), ...(reqUnapplied.length ? { not_applied: reqUnapplied.map(r => r.written) } : {}) } } : {}
  const carriedBlock = { ...(shownCarried.length ? { carried_not_checked: shownCarried } : {}), ...(allowed.length ? { carried_allowed: allowed } : {}) }
  // 2026-10-19: --allow-unknown-keys is stated in the JSON and on the line under the carried keys, whatever the file carried
  const allowBlock = allowUnknown ? { allow_unknown_keys: 'stated' } : {}
  // 2026-10-19: a file whose AP fields differ is a failed replay in the JSON too (status FAILED, ok false, and the differences);
  // the block is absent on a match, so a genuine file's JSON reads exactly as before
  const apBlock = apCheck && apFailed ? { ok: false, status: 'FAILED', reason: apFieldsHeadline(apCheck), ap_result: apFieldsBlock(apCheck) } : {}
  io.out(`${JSON.stringify(sig ? { envelope: sig, ...answer, ...result, ...apBlock, ...carriedBlock, ...strictBlock, ...requireBlock, ...allowBlock } : { ...answer, ...result, ...apBlock, ...carriedBlock, ...strictBlock, ...requireBlock, ...allowBlock }, null, 2)}\n`)
  // 2026-10-13: what follows the first line, whatever it is: the older-fingerprint note, the keys carried outside the verdict
  // and its inputs, and a --require-ruleset that applies to no verdict here (REPLAY.md, "The order of the lines")
  const follow = `${olderNote}${shownCarried.length ? `verify replay: ${carriedLine(shownCarried)}\n` : ''}${allowUnknown ? `verify replay: ${ALLOW_UNKNOWN_KEYS_LINE}\n` : ''}${allowed.length ? `verify replay: ${allowedLine(allowed)}\n` : ''}${reqUnapplied.length ? `verify replay: note: --require-ruleset ${reqUnapplied.map(r => r.written).join(', ')} does not apply: the verdict is ${isObj(verdict) && isObj(verdict.ruleset) ? `${String(verdict.ruleset.id)}@${String(verdict.ruleset.version)}` : 'not of that ruleset'}\n` : ''}`
  // A refusal (the file is not a verdict: nothing could be derived from it) is an input error, not a failed binding.
  if (result.refused) { io.err(`verify replay: input refused: ${result.reason ?? 'not a verdict'}\n${follow}`); return 3 }
  if (sig && !sig.signature_ok) { io.err(`verify replay: FAILED: the envelope's signature does not verify (${sig.reason ?? 'altered, or another key'})\n${follow}`); return 1 }
  // 2026-10-05: --trusted-key. A valid signature by another key, or no signature, is not the trusted signer's.
  if (trust && !sig) { io.err(`verify replay: FAILED: the verdict is not signed, and --trusted-key requires an envelope signed by the trusted key\n${follow}`); return 1 }
  // 2026-10-05: the full fingerprint, on its own line, so a reader can pin it without digging it out of the JSON
  const fpLine = sig?.key_fingerprint !== undefined
    ? `verify replay: signing key fingerprint ${sig.key_fingerprint}${sig.trusted === true ? ' (the trusted key)' : ` (to pin it: --trusted-key ${sig.key_fingerprint})`}\n` : ''
  if (trust && sig && !sig.trusted) {
    io.err(`verify replay: FAILED: the envelope is signed by key ${sig.key_fingerprint?.slice(0, 12) ?? '?'}…, which is not the trusted key (${[...trust].map(x => `${x.slice(0, 12)}…`).join(', ')}): its signature verifies, but it proves only that the holder of that other key issued it\n${follow}${fpLine}  trusted: ${[...trust].join(', ')}\n`)
    return 1
  }
  const signed = sig ? (trust
    ? ` The envelope's signature verifies, by the trusted key (${sig.key_fingerprint?.slice(0, 12) ?? '?'}…).`
    : ` The envelope's signature verifies (key ${sig.key_fingerprint?.slice(0, 12) ?? '?'}…): the body, outcome included, is what that key holder issued; anchor the key to its holder out of band.`) : ''
  if (result.status === 'FAILED') {
    // 2026-10-05: an input_hash refusal on several lines (recorded and computed, then which input); every other kind of
    // failure keeps its one line.
    const lines = result.input_ok === false && result.id_ok ? inputMismatchLines(result) : [`FAILED: ${result.reason ?? 'the verdict does not replay'}`]
    io.err(`${lines.map((l, i) => (i === 0 ? `verify replay: ${l}` : l)).join('\n')}\n${follow}${proofNote}`)
    return 1
  }
  if (result.status === 'REPERFORMED') {
    // 2026-10-06: a --require-ruleset failure leads, so the head of the log never reads VERIFIED alone
    if (reqProblem) io.err(`verify replay: FAILED: ${reqProblem}.\n`)
    // 2026-10-19: the AP fields beside the verdict are not what it derives: FAILED, each field named with what the file states
    // and what the re-performed verdict derives, then what the verdict really decides. Never "outcome VERIFIED" (exit 1, strict or not).
    if (apCheck && apFailed) {
      io.err(`verify replay: FAILED: ${apFieldsHeadline(apCheck)}\n${apCheck.differences.map(d => `  ${apDifferenceLine(d)}\n`).join('')}${follow}${fpLine}${proofNote}verify replay: what the re-performed verdict decides: ${replayHeadline(verdict, reading?.gate)}\n`)
      return 1
    }
    // 2026-10-05: the line names the rule version that decided the outcome (ruleset id@version), and says so when the
    // verdict carries no issued_at, with or without --strict (--strict also fails it). The drift bank digests this line.
    io.err(`verify replay: outcome VERIFIED: re-performed with ${result.reperformed?.engine} (ruleset ${verdict.ruleset.id}@${verdict.ruleset.version}, engine ${verdict.engine_version}) and byte-identical${verdict.issued_at === undefined ? `; ${ISSUED_AT_MISSING}` : ', issued_at aside'}.${result.reperformed?.annotations?.length ? ` Not re-performed (not the engine's output): ${result.reperformed.annotations.join(', ')}.` : ''}${signed}\n${follow}${fpLine}${proofNote}`)
    const rem = renderRemedies(result.reperformed?.remedies)
    // 2026-10-05: on an AP proof the gate's decision is printed above, so the scope's "a check, not a decision" line
    // says how the two relate. The verdict's own scope.statements (hashed) are unchanged.
    // 2026-10-06: a legal verdict states no evidence floor, so its scope line says what it was checked against instead (legal/replay-notice.ts)
    const sc = (isObj(verdict) && isObj(verdict.ruleset) && verdict.ruleset.id === 'legal' ? legalScopeLines(verdict) : scopeLines(verdict)).map(l => (reading?.gate && l === 'This is a check, not a decision.' ? AP_REPLAY_SCOPE : l))
    const absent = result.reperformed?.remedies_not_carried ? '\n  remedies absent; re-derived: the verdict carries no remedies (issued before engine 0.2.0 bound them, or removed since); these are this build\'s, and its core matched' : ''
    // 2026-10-05: today's default legal rule's reading of the same inputs, when it differs (legal/replay-notice.ts); from
    // 2026-10-06 the same for a declarative or built-in verdict (protocol/rule-now.ts)
    const ruleNow = reading?.rule_now ? renderAnyRuleNow(reading.rule_now, verdict.engine_version).map(l => `\n  ${l}`).join('') : ''
    io.err(`verify replay: ${replayHeadline(verdict, reading?.gate)}${reading?.gate_now ? `\n  ${renderGateNow(reading.gate_now)}` : ''}${ruleNow}${rem.length ? `${rem.map(l => `\n  remedy: ${l}`).join('')}` : ''}${absent}${sc.length ? `\n${sc.map(l => `  ${l}`).join('\n')}` : ''}\n`)
    if (strictNoteList.length) io.err(`${strictNoteList.map(p => `verify replay: strict note: ${p}`).join('\n')}\n`)
    if (strictList.length) {
      // 2026-10-13: "in the file", since a key carried beside the verdict is one of the things listed
      io.err(`verify replay: STRICT: FAILED: the outcome re-performed byte-identical, but not everything in the file was:\n${strictList.map(p => `  ${p}`).join('\n')}\n`)
      return 1
    }
    return reqProblem ? 1 : 0
  }
  // 2026-10-04: with no inputs at all, a declarative verdict's exit-2 line names the exact flags it needs.
  const needs = inputs === undefined ? declarativeReplayNeeds(verdict) : undefined
  // 2026-10-13: an emailed-bill result written before `ap` recorded what it read: the recipe names the files that re-perform it
  const apOld = inputs === undefined && apTextResult(raw) !== null
  const how = needs ? ` ${replayNeedsSentence(needs).replace(/^t/, 'T').replace(': pass ', ': to re-perform it, pass ')} (or --inputs <inputs.json>).`
    : apOld ? ` To re-perform it: replay ${file} --source <the bill's text file> --history <the payment history file, when one was given>.`
    : ' To re-perform it, pass the inputs (--inputs <inputs.json>, or --extraction <doc.json> with the flags the verdict was made with).'
  // 2026-10-06: a --require-ruleset failure leads here too
  if (reqProblem) io.err(`verify replay: FAILED: ${reqProblem}.\n`)
  io.err(`verify replay: ${result.not_reperformed ?? 'structure verified; outcome NOT re-performed'}.${signed}${how}${reqProblem ? '' : ' Exit 2.'}\n${follow}${fpLine}${proofNote}`)
  return reqProblem ? 1 : 2
}

/**
 * A refusal met while a replay reads its files, in the words true of a replay (2026-10-13; replay-case.ts replayAdvice): a
 * number that cannot be represented exactly is not fixed by writing it as a string, because that changes the input the verdict
 * is bound to. The error is the same object, its message reworded, so the refusal keeps its class.
 */
function asReplayRefusal(e: unknown): unknown {
  if (e instanceof Error) e.message = replayAdvice(e.message)
  return e
}

/** The output of `ap` on an emailed bill (an ap-threeway verdict beside its decision), with its `read` member when it has one; else null. */
function apTextResult(x: unknown): { verdict: Record<string, unknown>; read: Record<string, unknown> | null } | null {
  if (!isObj(x) || !isObj(x.verdict) || !isObj(x.verdict.ruleset) || x.verdict.ruleset.id !== 'ap-threeway' || typeof x.decision !== 'string') return null
  return { verdict: x.verdict, read: isObj(x.read) ? x.read : null }
}

/**
 * `replay <result> --source <bill.txt> [--history <history.json>]` (2026-10-13): the output of `ap` on an emailed bill records,
 * in its `read` member, the sha256 of the text and of the payment history it read (never the documents) and the policy. Given
 * the same files, the replay rebuilds the inputs ({ ap, policy }) and re-performs the verdict; a file left out is named (exit 3),
 * and a file that is not the one the result was read from is a failed replay (exit 1), named before any hash is compared. A
 * result read from three files takes --invoice, --po and --receipt. A result written before `ap` recorded `read` is
 * re-performed under the default policy when its files are given. Null when the file is not such a result, or the call gives
 * --inputs or --extraction (the general path answers those).
 */
function apTextReplay(file: string, f: Flags, readFile: () => unknown): { exit: number; message: string } | { verdict: unknown; inputs: unknown; note: string } | null {
  if (f.v.inputs !== undefined || f.v.extraction !== undefined || isFolder(file) || /\.jsonl$/i.test(file)) return null
  let x: unknown
  try { x = readFile() } catch { return null }
  const r = apTextResult(x)
  if (!r) return null
  const histories = f.multi.history ?? []
  const given = { source: f.v.source !== undefined, history: histories.length > 0, invoice: f.v.invoice !== undefined, po: f.v.po !== undefined, receipt: f.v.receipt !== undefined }
  const anyGiven = Object.values(given).some(Boolean)
  const refuse = (message: string): { exit: number; message: string } => ({ exit: 3, message: `verify replay: ${message}\n` })
  const read = r.read
  if (!read && !anyGiven) return null // the general path: structure verified, with the recipe
  if (histories.length > 1) return refuse('one --history file: the payment history the result was read with')
  const three = read?.form === 'three files'
  const textFlags = three ? ['invoice', 'po', 'receipt'] as const : ['source'] as const
  const wrong = three ? (given.source ? ['--source'] : []) : [...(given.invoice ? ['--invoice'] : []), ...(given.po ? ['--po'] : []), ...(given.receipt ? ['--receipt'] : [])]
  if (wrong.length) return refuse(`this result was read from ${three ? 'three files (--invoice, --po, --receipt)' : 'one file (--source)'}: give no ${wrong.join(', ')}`)
  const historyRead = read ? typeof read.history_sha256 === 'string' : given.history
  if (read && given.history && !historyRead) return refuse('this result was read with no payment history: give no --history')
  const missing = [...textFlags.filter((k) => !given[k]).map((k) => `--${k}`), ...(historyRead && !given.history ? ['--history'] : [])]
  if (missing.length) {
    const recipe = `${three ? '--invoice <the invoice text> --po <the purchase order text> --receipt <the goods receipt text>' : '--source <the bill\'s text file>'}${historyRead ? ' --history <the payment history file>' : ''}`
    return refuse(`this is the output of \`ap\` on an emailed bill: it records the sha256 of the text${historyRead ? ' and of the payment history' : ''} it read, never the documents, so the replay needs those files: replay ${file} ${recipe}; this call leaves out ${missing.join(', ')}`)
  }
  // the files, each against the sha256 the result records
  const texts: Record<string, string> = {}
  for (const k of textFlags) texts[k] = readText(f.v[k]!)
  const historyFile = historyRead ? readPaymentHistoryText(histories[0]!) : null
  if (read) {
    const check: [string, string, string][] = [...textFlags.map((k) => [k, texts[k]!, `${k === 'source' ? 'text' : k}_sha256`] as [string, string, string]), ...(historyFile ? [['history', historyFile.text, 'history_sha256'] as [string, string, string]] : [])]
    for (const [flag, text, key] of check) {
      const got = textSha256(text), want = read[key]
      if (typeof want === 'string' && got !== want) {
        return { exit: 1, message: `verify replay: FAILED: --${flag} ${f.v[flag] ?? histories[0]} is not the ${flag === 'history' ? 'payment history' : 'text'} this result was read from (its sha256 is ${got.slice(0, 12)}…; the result records ${want.slice(0, 12)}…)\n` }
      }
    }
  }
  const docs = three ? { invoice: texts.invoice!, purchase_order: texts.po!, goods_receipt: texts.receipt! } : splitApLayout(texts.source!)
  if (!docs) return refuse(`--source ${f.v.source}: the file must contain the "PURCHASE ORDER (ERP)" and "GOODS RECEIPT (ERP)" section markers`)
  const policy = read && isObj(read.policy) ? read.policy : apPolicyOf(undefined)
  return {
    verdict: r.verdict,
    inputs: { ap: historyFile ? { ...docs, history: historyFile.rows } : docs, policy },
    note: read
      ? 'verify replay: this file is the output of `ap` on an emailed bill; it was re-performed from the files given, whose sha256 are the ones it records\n'
      : 'verify replay: this file is the output of `ap` on an emailed bill and records no sha256 of what it read; it was re-performed from the files given, under the default policy\n',
  }
}

/** The verdict a replay file presents: an envelope's body, else the file itself (a bundle is unwrapped later, and takes no flags). */
function presentedVerdict(raw: unknown): unknown {
  return isObj(raw) && isObj(raw.verdict) && typeof raw.signature === 'string' && typeof raw.public_key === 'string' ? raw.verdict : raw
}

/**
 * The one line a replay prints when it was given some of the inputs a declarative verdict was issued with but not all, or
 * undefined (not a declarative verdict, nothing missing, or a file that does not read: each reported as before). Flags no
 * declarative verdict takes (--contract, --evidence, --history) keep their own error.
 */
function shortOfInputs(file: string, f: Flags): string | undefined {
  if (f.v.contract !== undefined || f.multi.evidence || f.multi.history) return undefined
  let raw: unknown
  try { raw = readJson(file) } catch { return undefined }
  if (isReplayBundle(raw)) return undefined
  const verdict = presentedVerdict(raw)
  let ruleset: unknown
  if (f.v.ruleset !== undefined && !BUILTIN.has(f.v.ruleset)) { try { ruleset = readRulesetArg(replayRulesetRef(f.v.ruleset, verdict)) } catch { ruleset = undefined } }
  const needs = declarativeReplayNeeds(verdict, ruleset)
  if (!needs) return undefined
  const given = {
    extraction: f.v.extraction !== undefined, ruleset: f.v.ruleset !== undefined, source: f.v.source !== undefined, quotes: f.v.quotes !== undefined,
    'supplied-choices': f.v['supplied-choices'] !== undefined, 'archive-file': f.multi['archive-file']?.length ?? 0,
  }
  const line = replayNeedsSentence(needs, given)
  return line.includes('; this call leaves out ') ? line : undefined
}

/**
 * `verify replay <folder | cases.jsonl>`: replay every bundle ({ verdict, inputs, options? }) on its own inputs (2026-10-02).
 * A folder's *.json and *.jsonl files are read in name order (not recursively: a folder inside it is named, with the command
 * that replays it). Prints the summary JSON on stdout and one line per case on stderr. Exit 0 every case MATCHes · 1 any
 * DIVERGED (the field named), or a --strict failure · 2 none diverged but some were not re-performed · 3 a case is not a
 * bundle, or nothing to replay.
 * 2026-10-05: every case prints the same disclosure a single replay prints (the fields not re-performed, remedies
 * absent and re-derived), the headline in gate words, and, for a bare verdict or an extraction, the command to run instead.
 * The case JSON and the last stderr line (the summary) read exactly as before, so the drift bank's digests do not move.
 */
function runReplayCases(path: string, isDir: boolean, io: CliIO, o: { trust?: Set<string>; strict?: boolean; lenientRemedies?: boolean; reqs?: RulesetRequirement[]; allowUnknown?: boolean } = {}): number {
  const verb = 'replay'
  const items: { name: string; bundle: unknown }[] = []
  const skipped: string[] = []
  try {
    const entries = isDir ? readdirSync(path).sort() : [path]
    for (const n of entries) {
      const fp = isDir ? join(path, n) : n
      if (isDir && isFolder(fp)) { skipped.push(n); continue }
      if (isDir && !/\.jsonl?$/i.test(n)) continue
      const name = isDir ? fp.slice(path.length).replace(/^[\\/]+/, '') : fp
      let text: string
      // a file the hash contract refuses (not UTF-8) is a refused case, named, never the end of the whole replay
      try { text = readText(fp) } catch (e) { items.push({ name, bundle: { __unparseable: (e as Error).message } }); continue }
      items.push(...bundlesFromText(name, text))
    }
  } catch (e) { return inputError(io, verb, asReplayRefusal(e)) }
  // 2026-10-13: a refused case's words as a replay says them (replay-case.ts replayAdvice)
  for (const it of items) {
    const b = it.bundle as { __unparseable?: unknown }
    if (isObj(b) && typeof b.__unparseable === 'string') b.__unparseable = replayAdvice(b.__unparseable)
  }
  if (!items.length) return usageError(io, verb, `${path} holds no bundles (*.json or *.jsonl)${skipped.length ? `; it holds the folder(s) ${skipped.map(s => `${s}/`).join(', ')}, which a folder replay does not walk: replay each on its own (${invokedAs()} replay ${join(path, skipped[0]!)})` : ''}`)
  const olderMatched = new Set<string>()
  const s = replayBundles(items, { ...(o.trust ? { isTrusted: (pem: string) => { const m = trustMatch(o.trust!, pem); if (m === 'older') olderMatched.add(keyFingerprint(pem) ?? ''); return m !== undefined } } : {}), ...(o.strict ? { strict: true } : {}), ...(o.lenientRemedies ? { lenientRemedies: true } : {}), ...(o.allowUnknown ? { allowUnknownKeys: true } : {}) })
  // 2026-10-05: --require-ruleset, per case, read off each presented verdict; the JSON carries it only when asked
  const reqs = o.reqs ?? []
  const reqProblems = reqs.length ? s.cases.map((c, i) => (c.result === 'REFUSED' ? undefined : rulesetRequirementProblem(reqs, presentedOf(items[i]!.bundle)))) : []
  const reqFailed = reqProblems.filter(p => p !== undefined).length
  const reqUnapplied = reqs.length ? unappliedRequirements(reqs, items.map(it => presentedOf(it.bundle))) : []
  const reqBlock = reqs.length ? { require_ruleset: { required: reqs.map(r => r.written), failed: reqFailed, ...(reqUnapplied.length ? { not_applied: reqUnapplied.map(r => r.written) } : {}), cases: Object.fromEntries(s.cases.flatMap((c, i) => (reqProblems[i] !== undefined ? [[c.name, reqProblems[i]]] : []))) } } : {}
  io.out(`${JSON.stringify(skipped.length ? { ...s, skipped_folders: skipped, ...reqBlock } : { ...s, ...reqBlock }, null, 2)}\n`)
  const needsOf = (v: unknown): string => {
    const n = declarativeReplayNeeds(v)
    return n ? n.needs.map(x => x.flag.replace(/ \(or its file\)$/, '')).join(' ') : '--inputs <inputs.json>'
  }
  // 2026-10-06: a --require-ruleset failure leads the case lines too (and still closes them)
  if (reqFailed > 0) io.err(`verify replay: FAILED: ${reqFailed} case(s) were issued under a rule older than --require-ruleset ${reqs.map(r => r.written).join(', ')} asks for (each is marked REQUIRED below)\n`)
  s.cases.forEach((c, i) => {
    const bundle = items[i]!.bundle
    const hint = c.result === 'REFUSED' && isDir && !c.name.includes('#')
      ? notABundleHint(bundle, join(path, c.name), needsOf, invokedAs()) : undefined
    io.err(`${renderCaseReplay(c, { verdict: presentedOf(bundle), notReperformed: s.fields_not_reperformed?.[c.name] ?? [], carried: s.carried_not_checked?.[c.name] ?? [], allowed: s.carried_allowed?.[c.name] ?? [], ...(hint ? { hint } : {}) })}${reqProblems[i] !== undefined ? `\n    REQUIRED: ${reqProblems[i]}` : ''}\n`)
  })
  for (const d of skipped) io.err(`SKIPPED         ${d}/\n    a folder: a folder replay does not walk into folders. Replay it on its own: ${invokedAs()} replay ${join(path, d)}\n`)
  // 2026-10-13: the older-fingerprint note after the case lines, never before them (as one verdict prints it under its first line)
  for (const fp of olderMatched) io.err(olderFormNote(fp || undefined))
  if (reqUnapplied.length) io.err(`verify replay: note: --require-ruleset ${reqUnapplied.map(r => r.written).join(', ')} applies to no case here (no verdict of that ruleset)\n`)
  // 2026-10-19: --allow-unknown-keys, stated before the summary line (which stays the last word on the cases)
  if (o.allowUnknown) io.err(`verify replay: ${ALLOW_UNKNOWN_KEYS_LINE}\n`)
  io.err(`verify replay: ${s.total} case(s): ${s.matched} match · ${s.diverged} diverged · ${s.not_reperformed} not re-performed · ${s.refused} refused\n`)
  if (o.strict && (s.strict_failed ?? 0) > 0) io.err(`verify replay: STRICT: FAILED: ${s.strict_failed} matching case(s) carry something that was not re-performed (each is listed above)\n`)
  if (reqFailed > 0) io.err(`verify replay: FAILED: ${reqFailed} case(s) were issued under a rule older than --require-ruleset ${reqs.map(r => r.written).join(', ')} asks for (each is listed above)\n`)
  // 2026-10-13: a refused case wins (exit 3): a case that cannot be read is never hidden by a sibling's exit 1 (replayExit)
  return replayExit(s, reqFailed)
}

/**
 * verify()'s inputs from the documents, exactly as `verify <doc> [--ruleset] [--contract] [--evidence]… [--history]… [--source]`
 * binds them. Since 2026-10-04, a carried ruleset name given without @version means the version `verdict` names.
 */
function verifyInputsFrom(f: Flags, verdict?: unknown): Record<string, unknown> {
  const extraction = readJson(f.v.extraction as string)
  const rs = f.v.ruleset !== undefined && !BUILTIN.has(f.v.ruleset) ? replayRulesetRef(f.v.ruleset, verdict) : f.v.ruleset
  // 2026-10-03: the same builder verify() hashes with (protocol/inputs.ts), so a replay binds what `verify <doc>` bound,
  // including a declarative ruleset's source text (`--source`, and `--quotes` if the verdict was issued with them).
  if (f.v.quotes !== undefined && f.v.source === undefined) throw new Error('--quotes are found in --source: give the source text too')
  const source = f.v.source !== undefined ? { text: readSourceArg(f.v.source), ...(f.v.quotes !== undefined ? { quotes: readQuotes(f.v.quotes) } : {}) } : undefined
  if (rs !== undefined && !BUILTIN.has(rs)) {
    const refs = [...(f.v.contract !== undefined ? ['contract'] : []), ...(f.multi.evidence ? ['evidence'] : []), ...(f.multi.history ? ['history'] : [])]
    if (refs.length) throw new Error(`a declarative ruleset's verdict is bound to { extraction, ruleset, source? } only, so ${refs.map(n => `--${n}`).join(', ')} cannot be part of it`)
    const archive_files = f.multi['archive-file'] ? f.multi['archive-file'].map(archiveFileArg) : undefined
    const supplied_choices = f.v['supplied-choices'] !== undefined ? readJson(f.v['supplied-choices']) : undefined
    return verifyInputs(extraction, { ruleset: readRulesetArg(rs), ...(source ? { source } : {}), ...(supplied_choices !== undefined ? { supplied_choices } : {}), ...(archive_files ? { archive_files } : {}) })
  }
  if (f.multi['archive-file'] || f.v['supplied-choices'] !== undefined) throw new Error('--archive-file and --supplied-choices are read by a declarative ruleset only')
  return verifyInputs(extraction, {
    references: {
      ...(f.v.contract !== undefined ? { contract: readJson(f.v.contract) } : {}),
      evidence: (f.multi.evidence ?? []).map(readJson),
      history: (f.multi.history ?? []).map(readJson),
    },
    ...(source ? { source } : {}),
  })
}

/** --tolerance <json | file>: the rounding-tolerance override a verdict was issued under. */
function readTolerance(v: string): TolerancePolicy {
  const t = v.trim()
  const raw = (t.startsWith('{') ? parseJsonStrict(t, '--tolerance') : readJson(t)) as unknown
  // 2026-10-05: the one strict shape (tolerance.ts toleranceProblem), and the override restated whole: roundingCap and
  // rounding used to be dropped here, so a verdict issued under a capped override could not be restated from the command line
  const problem = toleranceProblem(raw)
  if (problem) throw new Error(`--tolerance (inline JSON or a file): ${problem}`)
  return raw as TolerancePolicy
}

/** --tolerance <json | file> (the override a verdict was issued under), --document, and the twin linkbase files. */
function replayOptions(f: Flags): ReplayOptions {
  const o: ReplayOptions = {}
  if (f.v.tolerance !== undefined) o.tolerance = readTolerance(f.v.tolerance)
  if (f.v.document !== undefined) o.document = readText(f.v.document)
  const linkbase = readLinkbase({ ...(f.v.pre !== undefined ? { pre: f.v.pre } : {}), ...(f.v['filing-summary'] !== undefined ? { filingSummary: f.v['filing-summary'] } : {}), ...(f.v.schema !== undefined ? { schema: f.v.schema } : {}) })
  if (Object.keys(linkbase).length) o.presentation = linkbase
  return o
}

/** `verify ap --input <json>`: the structured path. The proof ({ verdict, inputs }) replays with `verify replay`. */
function runApStructured(path: string, io: CliIO, allowOpen = false, policyIn?: ApPolicy): number {
  let raw: unknown
  try { raw = readJson(path) } catch (e) {
    io.err(`${JSON.stringify({ error: `could not read the AP input: ${(e as Error).message}`, code: 'ap_input.not_json' })}\n`)
    return 3
  }
  const checked = validateApInput(raw)
  if (!checked.ok) { io.err(`${JSON.stringify({ error: 'the AP input does not validate', errors: checked.errors }, null, 2)}\n`); return 3 }
  // the policy the verdict was made under, every field resolved: the proof's inputs carry exactly what input_hash bound
  const policy = apPolicyOf(policyIn)
  const r = verifyBillMatch(checked.input, { policy })
  const d = apExit(r, allowOpen)
  io.out(`${JSON.stringify({ ...r, proof: { verdict: r.verdict, inputs: { ap_structured: apInputDocuments(checked.input), policy } }, ...apChoice(d, allowOpen) }, null, 2)}\n`)
  apHeadline(io, r, d, allowOpen, 'structured input')
  io.err(formatApReport(r, { documents: apInputDocuments(checked.input) }))
  return d.exit
}

/**
 * The caller's stated choice in the decision object on stdout (2026-10-05: a script reading stdout sees it too), only when
 * --allow-open was given: `"exit"` is this run's exit code; `"allow_open"` is "stated" when the flag changed it, else "stated, not
 * applied". The verdict inside is unchanged, and without the flag the object is exactly what it was. (`verify check` prints the
 * verdict bare, with no wrapper to carry this, so there the choice is said on stderr only.)
 */
function apChoice(d: { exit: number; allow_open?: true }, allowOpen: boolean): { exit?: number; allow_open?: string } {
  return allowOpen ? { exit: d.exit, allow_open: d.allow_open ? 'stated' : 'stated, not applied' } : {}
}

/**
 * The AP headline on stderr (2026-10-05), after the JSON on stdout: the decision a person acts on and the verdict's gate
 * status (never a bare PASS when a check could not run). The readable report follows it (src/ap/report.ts formatApReport: why,
 * the lines read, what was not checked). 2026-10-05: the decision is read failing closed (verdict/exit.ts apExit), so an
 * approve on which a check could not run reads A PERSON DECIDES and exits 2. "verify ap printed APPROVE, payable: true, exit 0 on
 * a bill whose duplicate check never ran, while the library gate said REVIEW" (a cold reader in the controller's role, cold review round 2).
 *   verify ap: HOLD (hold_quantity) · verdict FAIL: 1 of 12 checks failed
 *   verify ap: A PERSON DECIDES (every check that ran passed, but ap.duplicate could not run) · verdict PASS-WITH-OPEN: 1 of 12 checks could not run
 * 2026-10-13: then a labelled line naming the path, "read from: emailed text" or "read from: structured input".
 */
function apHeadline(io: CliIO, r: { decision: string; payable?: boolean | null; verdict: Verdict }, d: ReturnType<typeof apExit>, allowOpen: boolean, path: 'emailed text' | 'structured input'): void {
  const word = d.word.replace('allow-open', '--allow-open') // never APPROVE when the decision is abstain: the flag moves the exit, not the decision
  // --allow-open is never silently inert: when it changes nothing, it says why (it accepts only a bill held for want of a payment
  // history: src/ap/decide.ts abstainsOnlyForMissingHistory)
  const inert = allowOpen && !d.allow_open && d.exit !== 0
    ? `  --allow-open changes nothing here: the AP gate decided ${r.decision} (exit ${d.exit}). It accepts only a bill held because no payment history was given, with every other check passed; no flag turns any other decision into a payment\n` : ''
  // 2026-10-13: the path the bill came through, on its own labelled line after the headline block. The headline keeps its
  // shape byte for byte: scripts and examples parse it
  io.err(`verify ap: ${word} · verdict ${gateHeadline(r.verdict)}\n${d.allow_open ? `  ${d.words.replace('allow-open', '--allow-open')}\n` : ''}${inert}read from: ${path}\n`)
}

/**
 * `ap --price-tolerance <fraction>` (2026-10-05): taken out of argv before the shared parser, which serves every
 * verb and must keep refusing an option the verb does not read. A fraction from 0 to 1 ("0.05"), or a percent ("5%"); it becomes
 * the verdict's policy.price_tolerance (src/ap/index.ts apPolicyOf), bound into its input_hash and carried by the proof.
 */
function takePriceTolerance(argv0: readonly string[]): { argv: string[]; value?: number; error?: string } {
  const argv: string[] = []
  let raw: string | undefined, seen = 0
  for (let i = 0; i < argv0.length; i++) {
    const t = argv0[i]!
    if (t === '--price-tolerance') { seen++; raw = argv0[++i]; continue }
    if (t.startsWith('--price-tolerance=')) { seen++; raw = t.slice('--price-tolerance='.length); continue }
    argv.push(t)
  }
  if (!seen) return { argv }
  if (seen > 1) return { argv, error: '--price-tolerance given twice' }
  if (raw === undefined || raw.startsWith('--')) return { argv, error: '--price-tolerance needs a value: a fraction such as 0.05, or a percent such as 5%' }
  const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(%?)\s*$/.exec(raw)
  const v = m ? Number(m[1]) / (m[2] ? 100 : 1) : NaN
  if (!Number.isFinite(v) || v < 0 || v > 1) return { argv, error: `--price-tolerance ${JSON.stringify(raw)} is not a fraction from 0 to 1 (0.05) or a percent from 0% to 100% (5%)` }
  return { argv, value: Math.round(v * 1e9) / 1e9 }
}

/**
 * `ap --freight allow|person` (2026-10-05): freight billed on a purchase order that does not say whether freight is
 * allowed. person (the default, the behaviour before): a person decides. allow: the freight is added into the total as an allowed
 * charge. A PO that says no is never overridden. It becomes the verdict's policy.freight (src/ap/index.ts apPolicyOf), bound into
 * its input_hash and carried by the proof (only when allow, so a default run hashes as before). Taken out of argv as
 * --price-tolerance is.
 */
function takeFreight(argv0: readonly string[]): { argv: string[]; value?: 'allow' | 'person'; error?: string } {
  const argv: string[] = []
  let raw: string | undefined, seen = 0
  for (let i = 0; i < argv0.length; i++) {
    const t = argv0[i]!
    if (t === '--freight') { seen++; raw = argv0[++i]; continue }
    if (t.startsWith('--freight=')) { seen++; raw = t.slice('--freight='.length); continue }
    argv.push(t)
  }
  if (!seen) return { argv }
  if (seen > 1) return { argv, error: '--freight given twice' }
  if (raw !== 'allow' && raw !== 'person') return { argv, error: `--freight ${raw === undefined ? 'needs a value' : JSON.stringify(raw)}: give allow (freight on a PO that does not say is added to the total) or person (a person decides, the default)` }
  return { argv, value: raw }
}

/**
 * `ap --tax person|allow|rate:<pct>` (2026-10-06): tax billed on a purchase order that states no tax terms
 * (structured input only: the text path reads no tax line). person (the default): a person decides. allow: the tax is accepted as
 * billed, and the answer says so. rate:8.25%: the tax is checked against that rate. A purchase order that states its tax terms is
 * never overridden. It becomes the verdict's policy.tax (src/ap/index.ts apPolicyOf), bound into its input_hash and carried by the
 * proof (never for person, so a default run hashes as before). Taken out of argv as --freight is.
 */
function takeTax(argv0: readonly string[]): { argv: string[]; value?: 'person' | 'allow' | { rate: number }; error?: string } {
  const argv: string[] = []
  let raw: string | undefined, seen = 0
  for (let i = 0; i < argv0.length; i++) {
    const t = argv0[i]!
    if (t === '--tax') { seen++; raw = argv0[++i]; continue }
    if (t.startsWith('--tax=')) { seen++; raw = t.slice('--tax='.length); continue }
    argv.push(t)
  }
  if (!seen) return { argv }
  if (seen > 1) return { argv, error: '--tax given twice' }
  const p = parseTaxPolicy(raw)
  return 'error' in p ? { argv, error: p.error } : { argv, value: p.value }
}

function runAp(argv0: string[], io: CliIO): number {
  const tx = takeTax(argv0)
  const fr = takeFreight(tx.argv)
  const tol = takePriceTolerance(fr.argv)
  const argv = tol.argv
  const a = parse(argv)
  if (a.help) return printHelp(io, 'ap')
  if (a.unknown.length) return usageError(io, 'ap', unknownOptions(a.unknown, PARSE_FLAGS))
  if (a.payerRole !== undefined) return usageError(io, 'ap', '--payer-role applies to a pay application (verify <payapp.json> --ruleset pay-app)')
  if (a.gate && a.allowOpen) return usageError(io, 'ap', '--gate and --allow-open read an open verdict two ways: give one')
  if (a.files.length > 1) return usageError(io, 'ap', `one layout file per call (got ${a.files.join(', ')})`)
  if (a.history.length > 1) return usageError(io, 'ap', 'one --history file per call (a JSON array of the invoices already booked)')
  if (tol.error !== undefined) return usageError(io, 'ap', tol.error)
  if (fr.error !== undefined) return usageError(io, 'ap', fr.error)
  if (tx.error !== undefined) return usageError(io, 'ap', tx.error)
  if (tx.value !== undefined && tx.value !== 'person' && a.input === undefined) return usageError(io, 'ap', '--tax applies to structured input (--input) only: on the text path a taxed bill on a purchase order that states no tax rate goes to a person')
  const policy = tol.value !== undefined || fr.value !== undefined || tx.value !== undefined ? { ...(tol.value !== undefined ? { price_tolerance: tol.value } : {}), ...(fr.value !== undefined ? { freight: fr.value } : {}), ...(tx.value !== undefined ? { tax: tx.value } : {}) } : undefined
  // stdin is one stream: at most one input may be read from it (2026-10-05: `--history /dev/stdin` failed on Git Bash; `-` is the way)
  const fromStdin = [a.file, a.input, a.invoice, a.po, a.receipt, a.history[0]].filter((v) => v === '-').length
  if (fromStdin > 1) return usageError(io, 'ap', 'only one input can be read from stdin (-): give the others as files')
  if (a.input !== undefined) {
    if (a.history.length) return usageError(io, 'ap', 'the structured input carries its own payment_history: give no --history with --input')
    return runApStructured(a.input, io, a.allowOpen, policy)
  }
  if (!a.file && !(a.invoice && a.po && a.receipt)) return usageError(io, 'ap', 'needs <layout.txt>, or --invoice <f> --po <f> --receipt <f>, or --input <ap-input.json>')
  let docs: ApDocuments | null
  // 2026-10-13: the result records the sha256 of the text it read (and of the history), so `replay` re-performs it from the same
  // files and names a file that is not the one it was read from (`read` below)
  let texts: Record<string, string>
  try {
    texts = a.file ? { text: readText(a.file) } : { invoice: readText(a.invoice as string), po: readText(a.po as string), receipt: readText(a.receipt as string) }
    docs = a.file ? splitApLayout(texts.text!) : { invoice: texts.invoice!, purchase_order: texts.po!, goods_receipt: texts.receipt! }
  } catch (e) { io.err(`error reading documents: ${(e as Error).message}\n`); return 3 }
  if (!docs) { io.err('layout file must contain the "PURCHASE ORDER (ERP)" and "GOODS RECEIPT (ERP)" section markers\n'); return 3 }
  // 2026-10-05: the text path states the book as the structured path's payment_history does (`[]` = nothing booked). Without it
  // the duplicate check does not run, and under engine 0.6.0 the gate sends the bill to a person.
  let historyText: string | null = null
  if (a.history.length) {
    try { const h = readPaymentHistoryText(a.history[0]!); docs = { ...docs, history: h.rows }; historyText = h.text } catch (e) { return usageError(io, 'ap', (e as Error).message) }
  }
  let r: ReturnType<typeof verifyInvoiceMatch>
  try { r = verifyInvoiceMatch(docs, { ...(policy ? { policy } : {}), ...(a.ruleset !== undefined ? { ruleset: a.ruleset } : {}) }) } catch (e) { return usageError(io, 'ap', (e as Error).message) }
  const d = apExit(r, a.allowOpen)
  // `read`: what the verdict was read from, by sha256 (never the documents), and the policy it was made under. `replay <result>
  // --source <bill.txt> [--history <history.json>]` re-performs it from those files (three files: --invoice, --po, --receipt)
  const read = {
    form: a.file ? 'one file' : 'three files',
    ...Object.fromEntries(Object.entries(texts).map(([k, t]) => [`${k}_sha256`, textSha256(t)])),
    history_sha256: historyText === null ? null : textSha256(historyText),
    policy: apPolicyOf(policy),
  }
  io.out(`${JSON.stringify({ ...r, read, ...apChoice(d, a.allowOpen) }, null, 2)}\n`)
  apHeadline(io, r, d, a.allowOpen, 'emailed text')
  io.err(formatApReport(r, { documents: docs }))
  return d.exit
}

/**
 * `verify ap --history <file>`: the invoices already booked, a JSON array of { invoice_number, po_number?, total?, vendor?,
 * vendor_id?, vendor_tax_id?, paid_on?, no_purchase_order? } (src/ap/index.ts PriorInvoice; `[]` = a known, empty book), read under the hash contract.
 */
function readPaymentHistory(path: string): PriorInvoice[] {
  return readPaymentHistoryText(path).rows
}

/** The sha256 of a text input's bytes (UTF-8, as read under the hash contract): what an emailed-bill result records it read. */
const textSha256 = (text: string): string => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')

/** readPaymentHistory, with the file's text (2026-10-13: an emailed-bill result records the sha256 of the history it read). */
function readPaymentHistoryText(path: string): { rows: PriorInvoice[]; text: string } {
  let raw: unknown, text: string
  try { text = readText(path); raw = parseJsonStrict(text, path === '-' ? 'stdin' : path) } catch (e) { throw new Error(`--history ${path}: ${(e as Error).message}`) }
  const shape = 'a JSON array of the invoices already booked: [{ "invoice_number", "po_number"?, "total"?, "vendor"?, "vendor_id"?, "vendor_tax_id"?, "paid_on"?, "no_purchase_order"? }] ([] = none booked)'
  if (!Array.isArray(raw)) throw new Error(`--history ${path} must be ${shape}`)
  const bad = raw.findIndex(x => !isObj(x) || typeof x.invoice_number !== 'string' || x.invoice_number.trim() === '')
  if (bad >= 0) throw new Error(`--history ${path}: entry [${bad}] has no invoice_number string; the file must be ${shape}`)
  return { rows: raw as PriorInvoice[], text }
}

export interface MineArgs {
  file?: string
  schema?: string
  ap: boolean
  /** the raw --max-approved-violation-rate text (validated in runMine) */
  rate?: string
  rulesetOut?: string
  rulesetId?: string
  /** --thresholds: add the C family (learned constants per numeric document field) */
  thresholds: boolean
  help: boolean
  /** flags `verify mine` does not know. A typo must not silently mine with defaults. */
  unknown: string[]
}

export function parseMineArgs(argv: string[]): MineArgs {
  const a: MineArgs = { ap: false, thresholds: false, help: false, unknown: [] }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] as string
    switch (t) {
      case '-h': case '--help': a.help = true; break
      case '--schema': a.schema = argv[++i]; break
      case '--ap': a.ap = true; break
      case '--max-approved-violation-rate': a.rate = argv[++i]; break
      case '--ruleset-out': a.rulesetOut = argv[++i]; break
      case '--ruleset-id': a.rulesetId = argv[++i]; break
      case '--thresholds': a.thresholds = true; break
      default: if (t.startsWith('-') && t !== '-') a.unknown.push(t); else a.file = t
    }
  }
  return a
}

/**
 * The pure core of `verify mine`: JSONL text (+ schema) → { report, compiled }. No I/O.
 * With `ap`, each line is a Distil-style AP case, turned into the case table by the AP adapter (schema defaults to the
 * AP schema). Otherwise each line is a case-table row `{ id, label, fields, lines? }` and a schema is required.
 */
export function mineFromJsonl(text: string, opts: { schema?: MineSchema; ap?: boolean; maxApprovedViolationRate?: number; thresholds?: boolean; rulesetId?: string }): { report: MineReport; compiled: CompiledRuleset } {
  const rows = parseJsonl(text)
  const table = opts.ap ? apCasesToTable(rows as DistilApCase[]) : caseTableFromRows(rows)
  const schema = opts.schema ?? (opts.ap ? AP_MINE_SCHEMA : undefined)
  if (!schema) throw new Error('a schema is required (or use the AP adapter)')
  const report = mine(table, schema, { ...(opts.maxApprovedViolationRate !== undefined ? { maxApprovedViolationRate: opts.maxApprovedViolationRate } : {}), ...(opts.thresholds ? { thresholds: true } : {}) })
  return { report, compiled: compileRuleset(report, opts.rulesetId !== undefined ? { id: opts.rulesetId } : {}) }
}

function runMine(argv: string[], io: CliIO): number {
  const a = parseMineArgs(argv)
  if (a.help) { return printHelp(io, 'mine') }
  if (a.unknown.length) { io.err(`verify mine: unknown option(s) ${a.unknown.join(', ')}\n${seeHelp('mine')}\n`); return 3 }
  if (!a.file || (!a.schema && !a.ap)) { io.err(`verify mine needs <cases.jsonl> and --schema <schema.json> (or --ap)\n${seeHelp('mine')}\n`); return 3 }
  let rate: number | undefined
  if (a.rate !== undefined) {
    rate = Number(a.rate)
    if (a.rate.trim() === '' || !Number.isFinite(rate) || rate < 0 || rate >= 1) { io.err(`--max-approved-violation-rate must be a number in [0, 1) (got "${a.rate}")\n`); return 3 }
  }
  // 2026-09-28: the compiled ruleset is never written over a file, like keygen's keys (exit 1, refused).
  if (a.rulesetOut && existsSync(a.rulesetOut)) return refused(io, 'mine', `${a.rulesetOut} already exists: a compiled ruleset is never written over a file (choose another --ruleset-out)`)
  let text: string, schema: MineSchema | undefined
  try {
    text = readText(a.file === '-' ? 0 : a.file)
    schema = a.schema ? (readJson(a.schema) as unknown as MineSchema) : undefined
  } catch (e) { io.err(`error reading input: ${(e as Error).message}\n`); return 3 }
  let out: { report: MineReport; compiled: CompiledRuleset }
  try {
    out = mineFromJsonl(text, { ap: a.ap, ...(schema ? { schema } : {}), ...(rate !== undefined ? { maxApprovedViolationRate: rate } : {}), ...(a.thresholds ? { thresholds: true } : {}), ...(a.rulesetId !== undefined ? { rulesetId: a.rulesetId } : {}) })
  } catch (e) { io.err(`verify mine: ${(e as Error).message}\n`); return 3 }
  if (a.rulesetOut) {
    try { writeFileSync(a.rulesetOut, `${JSON.stringify(out.compiled.ruleset, null, 2)}\n`, { flag: 'wx' }) } catch (e) {
      if ((e as { code?: string }).code === 'EEXIST') return refused(io, 'mine', `${a.rulesetOut} already exists: a compiled ruleset is never written over a file (choose another --ruleset-out)`)
      io.err(`error writing ruleset: ${(e as Error).message}\n`); return 3
    }
  }
  io.out(`${JSON.stringify(out, null, 2)}\n`)
  return 0
}

export interface OpinionArgs {
  ledger?: string
  policy?: string
  workflow?: string
  tier?: string
  granted?: string
  level?: string
  grant?: string
  bounds?: string
  proposal?: string
  dispute?: string
  claim?: string
  json: boolean
  /** `--from-book`: read the rung from the GRANT in force on the book, not a flag (verify voice, verify opinion). */
  fromBook: boolean
  /** `--trusted-keys <keys.json>`: anchor signers to people when reading the book. */
  trustedKeys?: string
  /** `--root-keys <root.pub.pem>`: the root public key; the key registry on the book anchors signers. */
  rootKeys?: string
  /** `verify opinion --tenant <id>`: read one tenant's records and decisions only (a shared book). */
  tenant?: string
  /** `verify voice --surface`: print the MCP/HTTP voice surface. */
  surface: boolean
  help: boolean
  /** flags `verify voice` / `verify opinion` do not know. A typo must not silently change the question. */
  unknown: string[]
}

export function parseOpinionArgs(argv: string[]): OpinionArgs {
  const a: OpinionArgs = { json: false, fromBook: false, surface: false, help: false, unknown: [] }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] as string
    switch (t) {
      case '-h': case '--help': a.help = true; break
      case '--ledger': a.ledger = argv[++i]; break
      case '--policy': a.policy = argv[++i]; break
      case '--workflow': a.workflow = argv[++i]; break
      case '--tier': a.tier = argv[++i]; break
      case '--granted': a.granted = argv[++i]; break
      case '--grant': a.grant = argv[++i]; break
      case '--level': a.level = argv[++i]; break
      case '--bounds': a.bounds = argv[++i]; break
      case '--proposal': a.proposal = argv[++i]; break
      case '--dispute': a.dispute = argv[++i]; break
      case '--claim': a.claim = argv[++i]; break
      case '--json': a.json = true; break
      case '--from-book': a.fromBook = true; break
      case '--trusted-keys': a.trustedKeys = argv[++i]; break
      case '--root-keys': a.rootKeys = argv[++i]; break
      case '--tenant': a.tenant = argv[++i]; break
      case '--surface': a.surface = true; break
      default: a.unknown.push(t)
    }
  }
  return a
}

/** The book-reading flags given to a verb that does not take them (they must not be silently ignored). */
function bookFlags(a: OpinionArgs): string[] {
  return [
    ...(a.fromBook ? ['--from-book'] : []), ...(a.trustedKeys !== undefined ? ['--trusted-keys'] : []), ...(a.rootKeys !== undefined ? ['--root-keys'] : []),
    ...(a.tenant !== undefined ? ['--tenant'] : []), ...(a.surface ? ['--surface'] : []),
  ]
}

/** --trusted-keys / --root-keys from the lenient voice/opinion parser. */
function opinionAnchors(a: OpinionArgs): Anchors {
  const trusted = a.trustedKeys !== undefined ? readTrustedKeys(a.trustedKeys) : undefined
  const root = a.rootKeys !== undefined ? readRootKeys(a.rootKeys) : undefined
  return { ...(trusted ? { trusted } : {}), ...(root ? { root } : {}) }
}

/** The book at `path` as a snapshot, streamed; a read verb (a torn last line is said, and the whole events read). */
function readSnapshot(path: string, io: CliIO, verb: string): LedgerSnapshot {
  return readBookFile(path, { io, verb })
}

/** Build the workflow declaration from flags, or say why not (a message). */
function declarationOf(a: OpinionArgs, snap: LedgerSnapshot): WorkflowDeclaration | string {
  if (!a.workflow) {
    const known = workflowCalibrations(openSnapshot(snap).records).map(c => `  ${c.workflow_id} (${c.records} verdicts)`)
    return `--workflow is required. Workflows on this ledger:\n${known.join('\n') || '  (none)'}`
  }
  let grant: Grant | undefined
  if (a.grant) {
    try { grant = readJson(a.grant) as unknown as Grant } catch (e) { return `error reading grant: ${(e as Error).message}` }
  }
  const tier = a.tier ?? grant?.consequence_tier
  if (!tier) return '--tier is required (a consequence tier declared in the policy), or --grant'
  const granted = (a.granted ?? grant?.level ?? 'record') as VoiceLevel
  if (!VOICE_LADDER.includes(granted)) return `--granted must be one of ${VOICE_LADDER.join(', ')}`
  return { workflow_id: a.workflow, consequence_tier: tier, granted, ...(a.bounds !== undefined ? { bounds: a.bounds } : {}), ...(grant ? { grant } : {}) }
}

function runVoice(argv: string[], io: CliIO): number {
  const a = parseOpinionArgs(argv)
  if (a.help) { return printHelp(io, 'voice') }
  const foreign = [...a.unknown, ...(a.tenant !== undefined ? ['--tenant'] : [])]
  if (foreign.length) { io.err(`verify voice: unknown option(s) ${foreign.join(', ')}\n${seeHelp('voice')}\n`); return 3 }
  if (!a.ledger || !a.policy) { io.err(`verify voice needs --ledger <chain.jsonl> and --policy <policy.json>\n${seeHelp('voice')}\n`); return 3 }
  if (a.fromBook) return runVoiceFromBook(a, io)
  if (a.trustedKeys !== undefined || a.rootKeys !== undefined) { io.err(`verify voice: --trusted-keys / --root-keys anchor the signers of the decisions on the book; use them with --from-book\n${seeHelp('voice')}\n`); return 3 }
  let snap: LedgerSnapshot, policy: PromotionPolicy
  try {
    snap = readSnapshot(a.ledger, io, 'voice')
    policy = readJson(a.policy) as unknown as PromotionPolicy
  } catch (e) { return bookFileRefused(io, 'voice', e) ?? (io.err(`error reading input: ${(e as Error).message}\n`), 3) }
  const decl = declarationOf(a, snap)
  if (typeof decl === 'string') { io.err(`verify voice: ${decl}\n`); return 3 }
  const view = openSnapshot(snap)
  if (a.surface) {
    const { workflow_id, ...settings } = decl
    let s: VoiceSurface
    try { s = voiceSurface(view, workflow_id, settings, policy) } catch (e) { io.err(`verify voice: ${(e as Error).message}\n`); return 3 }
    return printSurface(s, io)
  }
  let assessment: VoiceAssessment
  try { assessment = assessVoice(workflowCalibration(view.records, decl.workflow_id), decl, policy) } catch (e) { io.err(`verify voice: ${(e as Error).message}\n`); return 3 }
  const chain = { content_verified: view.content_verified, ...(view.chain ? { ok: view.chain.ok, length: view.chain.length, head: view.chain.head } : {}) }
  io.out(`${JSON.stringify({ chain, assessment }, null, 2)}\n`)
  if (!view.content_verified) return 1
  return urgentDemotion(assessment.proposal) ? 2 : 0
}

/**
 * Exit 2 is an URGENT demotion: evidence OF failure (DECISION D-UNEVIDENCED, 2026-09-28). A demotion whose basis is
 * 'unevidenced' (a person granted above what the book supports, and nothing has gone wrong) is a standing notice: exit 0.
 * A proposal without a basis (older output) is read as urgent, the conservative reading.
 */
function urgentDemotion(p: VoiceProposal | null | undefined): boolean {
  return p?.kind === 'DEMOTION_PROPOSAL' && (p as { basis?: string }).basis !== 'unevidenced'
}

/** `verify voice --surface`: the MCP voice_assess / HTTP GET /v1/voice shape, with voice's exit codes. */
function printSurface(s: VoiceSurface, io: CliIO): number {
  io.out(`${JSON.stringify(s, null, 2)}\n`)
  if (!s.verified) return 1
  return urgentDemotion(s.open_proposal) ? 2 : 0
}

/**
 * `verify voice --from-book`: the rung READ FROM THE BOOK (the GRANT in force; a person's signed decision), through
 * assessVoiceFromLedger. Wiring only: the book is verified, read and cited by src/verdict/voice.ts. A book that does not
 * verify (a tampered, mis-signed or, with --trusted-keys / --root-keys, unanchored decision) grants nothing: exit 1.
 * A person's standing decline is said on stderr in Riposte's own words (D-DECLINED-COPY).
 */
function runVoiceFromBook(a: OpinionArgs, io: CliIO): number {
  const flags = [...(a.granted !== undefined ? ['--granted'] : []), ...(a.grant !== undefined ? ['--grant'] : []), ...(a.bounds !== undefined ? ['--bounds'] : [])]
  if (flags.length) {
    io.err(`verify voice: --from-book reads the rung, tier and bounds from the GRANT in force on the book, so ${flags.join(', ')} cannot be passed with it (a flag never overrides a person's signed grant)\n${seeHelp('voice')}\n`)
    return 3
  }
  let ledger: Ledger, policy: PromotionPolicy, anchors: Anchors
  try {
    anchors = opinionAnchors(a)
    ledger = openBookReadOnly(a.ledger as string, anchors, io, 'voice')
    policy = readJson(a.policy as string) as unknown as PromotionPolicy
  } catch (e) { return bookFileRefused(io, 'voice', e) ?? (io.err(`error reading input: ${(e as Error).message}\n`), 3) }
  const check = ledger.verifyContent()
  const chain = { content_verified: check.ok, ok: check.ok, length: check.length, head: check.head, ...(check.ok ? {} : { broken_at: check.brokenAt, reason: check.reason }) }
  if (!check.ok) {
    io.out(`${JSON.stringify({ chain }, null, 2)}\n`)
    io.err(`verify voice: the book of record does not verify${check.brokenAt !== undefined ? ` at event ${check.brokenAt}` : ''} (${check.reason ?? 'unknown'}): a tampered, mis-signed or unanchored book grants nothing, and no rung is read from it\n`)
    return 1
  }
  if (!a.workflow) {
    const known = workflowCalibrations(ledger.all()).map(c => `  ${c.workflow_id} (${c.records} verdicts)`)
    io.err(`verify voice: --workflow is required. Workflows on this ledger:\n${known.join('\n') || '  (none)'}\n`)
    return 3
  }
  if (a.surface) {
    // The surface reads the book itself (the GRANT in force; --tier only while nothing is granted).
    let s: VoiceSurface
    try {
      s = voiceSurface(openSnapshot(snapshotOfLedger(ledger)), a.workflow, { book: ledger, ...(a.tier !== undefined ? { consequence_tier: a.tier } : {}) }, policy)
    } catch (e) { io.err(`verify voice: ${(e as Error).message}\n`); return 3 }
    return printSurface(s, io)
  }
  let assessment: VoiceAssessment
  try {
    assessment = assessVoiceFromLedger(ledger, a.workflow, policy, { ...(a.tier !== undefined ? { consequence_tier: a.tier } : {}), ...anchorOpts(anchors) })
  } catch (e) { io.err(`verify voice: ${(e as Error).message}\n`); return 3 }
  io.out(`${JSON.stringify({ chain, assessment }, null, 2)}\n`)
  for (const n of noEffect(assessment)) io.err(`verify voice: note: ${n}\n`)
  const words = declineWords(assessment)
  if (words) io.err(`verify voice: ${words}\n`)
  return urgentDemotion(assessment.proposal) ? 2 : 0
}

/** Open a book file as a Ledger, read-only (nothing is ever written back), anchored with trusted/root keys when given. */
function openBookReadOnly(path: string, a: Anchors, io: CliIO, verb: string): Ledger {
  return new MemoryLedger({ seed: readBookFile(path, { io, verb }), ...anchorOpts(a) })
}

const repairHint = (path: string): string => `From the command line: verify ledger repair ${path}`

/**
 * A book file, streamed (readChainFile: never one string, so a book past the runtime's string ceiling reads). A read verb
 * passes `reader`: a torn last line is then said on stderr, with the repair command, and the whole events before it are
 * read (the book is read-only until repaired; nothing was dropped). A verb that appends passes nothing, and a torn tail
 * throws TornTailError (exit 1). An unparseable line before the last throws LedgerFileCorrupt (exit 1) either way.
 */
function readBookFile(path: string, reader?: { io: CliIO; verb: string }): Seed {
  const r = readChainFile(path, reader ? { allowTornTail: true } : {})
  if (r.torn && reader) reader.io.err(`verify ${reader.verb}: note: ${new TornTailError(path, r.torn).message} ${repairHint(path)}\n`)
  return { events: r.events, payloads: r.payloads }
}

/**
 * A book file that cannot be read as a whole book is REFUSED (exit 1) with the ledger's own message, which says what to do:
 * a torn tail on a verb that appends (and the command that repairs it), corruption before the last line, a read-only book.
 * Anything else: undefined (the caller's own error handling).
 */
function bookFileRefused(io: CliIO, verb: string, e: unknown): number | undefined {
  if (!(e instanceof TornTailError || e instanceof LedgerFileCorrupt || e instanceof LedgerReadOnly)) return undefined
  return refused(io, verb, `${e.message}${e instanceof TornTailError ? ` ${repairHint(e.path)}` : ''}`)
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

/** A trusted-keys file: { "<signer_id>": "<SPKI PEM>" | ["<PEM>", ...] }, or keygen's output ({ trusted_keys: {...} }). */
function readTrustedKeys(path: string): TrustedKeys {
  const raw = readJson(path) as unknown
  const keys = isObj(raw) && isObj(raw.trusted_keys) ? raw.trusted_keys : raw
  if (!isObj(keys)) throw new Error('trusted keys must be { "<signer_id>": "<public key PEM>" | ["<PEM>", ...] } (or verify keygen\'s output)')
  for (const [id, k] of Object.entries(keys)) {
    if (!(typeof k === 'string' || (Array.isArray(k) && k.every(x => typeof x === 'string')))) throw new Error(`the trusted key for '${id}' must be a public key PEM or an array of them`)
  }
  return keys as TrustedKeys
}

function runNotice(argv: string[], io: CliIO): number {
  const a = parseOpinionArgs(argv)
  const file = a.unknown.find(t => !t.startsWith('-') || t === '-')
  const unknown = [...a.unknown.filter(t => t !== file), ...bookFlags(a)]
  if (a.help) { return printHelp(io, 'notice') }
  if (unknown.length || !file) { io.err(`verify notice needs <verdict.json>${unknown.length ? ` (unknown option(s) ${unknown.join(', ')})` : ''}\n${seeHelp('notice')}\n`); return 3 }
  let verdict: Verdict
  try { verdict = readJson(file) as unknown as Verdict } catch (e) { io.err(`error reading verdict: ${(e as Error).message}\n`); return 3 }
  if (!verdict || !Array.isArray((verdict as { claims?: unknown }).claims)) { io.err('verify notice: not a verdict (no claims)\n'); return 3 }
  const level = (a.level ?? 'record') as VoiceLevel
  if (!VOICE_LADDER.includes(level)) { io.err(`verify notice: --level must be one of ${VOICE_LADDER.join(', ')}\n`); return 3 }
  const n = actionNotice(verdict, level)
  io.out(a.json ? `${JSON.stringify(n, null, 2)}\n` : renderActionNotice(n))
  return n.action === 'HOLD' ? 1 : n.action === 'SURFACE' ? 2 : 0
}

/**
 * `verify opinion`: the written opinion. Three questions:
 *   --from-book --workflow <wf> [--tier t]      the rung read from the book of record (the GRANT in force; --tier only while
 *                                               nothing is granted): promotionOpinion({ workflow_id })
 *   --proposal <p.json> | --workflow --tier ... the flag path (a supplied proposal, or a declared rung)
 *   --dispute <verdict_id> [--claim c]          one finding, disputed
 * Every form takes [--tenant t] (one tenant's records and decisions on a shared book) and [--trusted-keys] [--root-keys].
 */
function runOpinion(argv: string[], io: CliIO): number {
  const a = parseOpinionArgs(argv)
  if (a.help) { return printHelp(io, 'opinion') }
  const unknown = [...a.unknown, ...(a.surface ? ['--surface'] : [])]
  if (unknown.length) { io.err(`verify opinion: unknown option(s) ${unknown.join(', ')}\n${seeHelp('opinion')}\n`); return 3 }
  if (!a.ledger) { io.err(`verify opinion needs --ledger <chain.jsonl>\n${seeHelp('opinion')}\n`); return 3 }
  if (a.fromBook) {
    const foreign = [
      ...(a.granted !== undefined ? ['--granted'] : []), ...(a.grant !== undefined ? ['--grant'] : []), ...(a.bounds !== undefined ? ['--bounds'] : []),
      ...(a.proposal !== undefined ? ['--proposal'] : []), ...(a.dispute !== undefined ? ['--dispute'] : []), ...(a.claim !== undefined ? ['--claim'] : []),
      ...(a.level !== undefined ? ['--level'] : []),
    ]
    if (foreign.length) { io.err(`verify opinion: --from-book reads the rung, tier and bounds from the GRANT in force on the book, so ${foreign.join(', ')} cannot be passed with it (a flag never overrides a person's signed grant)\n${seeHelp('opinion')}\n`); return 3 }
    if (!a.policy || !a.workflow) { io.err(`verify opinion --from-book needs --policy <policy.json> and --workflow <id>\n${seeHelp('opinion')}\n`); return 3 }
  }
  let snap: LedgerSnapshot, anchors: Anchors
  try {
    snap = readSnapshot(a.ledger, io, 'opinion')
    anchors = opinionAnchors(a)
  } catch (e) { return bookFileRefused(io, 'opinion', e) ?? (io.err(`error reading ledger: ${(e as Error).message}\n`), 3) }
  const scope: OpinionScope | undefined = a.tenant !== undefined ? { tenant_id: a.tenant } : undefined
  const read = { ...(scope ? { scope } : {}), ...anchorOpts(anchors) }
  let op: Opinion
  try {
    if (a.dispute) {
      op = disputeOpinion({ snapshot: snap, verdict_id: a.dispute, ...(a.claim !== undefined ? { claim_id: a.claim } : {}), ...read })
    } else {
      if (!a.policy) { io.err(`verify opinion needs --policy <policy.json> (or --dispute <verdict_id>)\n${seeHelp('opinion')}\n`); return 3 }
      const policy = readJson(a.policy) as unknown as PromotionPolicy
      if (a.fromBook) {
        op = promotionOpinion({ snapshot: snap, policy, workflow_id: a.workflow as string, ...(a.tier !== undefined ? { consequence_tier: a.tier } : {}), ...read })
      } else if (a.proposal) {
        op = promotionOpinion({ snapshot: snap, policy, proposal: readJson(a.proposal) as unknown as VoiceProposal, ...read })
      } else {
        const decl = declarationOf(a, snap)
        if (typeof decl === 'string') { io.err(`verify opinion: ${decl}\n`); return 3 }
        op = promotionOpinion({ snapshot: snap, policy, declaration: decl, ...read })
      }
    }
  } catch (e) { io.err(`verify opinion: ${(e as Error).message}\n`); return 3 }
  io.out(a.json ? `${opinionJSON(op)}\n` : renderOpinion(op))
  return op.verified ? 0 : 1
}

export interface TwinArgs {
  html?: string; periodEnd?: string; claims?: string; tolerance?: string; periodToleranceDays?: string
  /** --ruleset 0.1 | 0.2 | 0.2.1: the twin map (default 0.1: document binding, unchanged). */
  ruleset?: string
  /** v0.2+: the filing's presentation linkbase (`*_pre.xml`), EDGAR's FilingSummary.xml, and the extension schema (`*.xsd`). */
  pre?: string; filingSummary?: string; schema?: string
  help: boolean; unknown: string[]
}

export function parseTwinArgs(argv: string[]): TwinArgs {
  const a: TwinArgs = { help: false, unknown: [] }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] as string
    switch (t) {
      case '-h': case '--help': a.help = true; break
      case '--html': a.html = argv[++i]; break
      case '--period-end': a.periodEnd = argv[++i]; break
      case '--claims': a.claims = argv[++i]; break
      case '--tolerance': a.tolerance = argv[++i]; break
      case '--period-tolerance-days': a.periodToleranceDays = argv[++i]; break
      case '--ruleset': a.ruleset = argv[++i]; break
      case '--pre': a.pre = argv[++i]; break
      case '--filing-summary': a.filingSummary = argv[++i]; break
      case '--schema': a.schema = argv[++i]; break
      default: a.unknown.push(t)
    }
  }
  return a
}

/** The twin maps `verify twin --ruleset` selects: v0.1 (document binding, the default), v0.2 (statement-anchored), v0.2.1. */
export const TWIN_MAPS: Readonly<Record<string, TwinConceptMap>> = { '0.1': FS_CORE_TWIN_MAP, '0.2': FS_CORE_TWIN_MAP_V02, '0.2.1': FS_CORE_TWIN_MAP_V021 }

/** `verify twin`: wiring only; the twin's logic lives in src/twin/ (CREDENCE-1, CREDENCE-2). */
function runTwin(argv: string[], io: CliIO): number {
  const a = parseTwinArgs(argv)
  if (a.help) { return printHelp(io, 'twin') }
  if (a.unknown.length) { io.err(`verify twin: unknown option(s) ${a.unknown.join(', ')}\n${seeHelp('twin')}\n`); return 3 }
  if (!a.html || !a.periodEnd || !a.claims) { io.err(`verify twin needs --html <primary.htm>, --period-end YYYY-MM-DD and --claims <claims.json>\n${seeHelp('twin')}\n`); return 3 }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.periodEnd)) { io.err(`verify twin: --period-end must be YYYY-MM-DD (got "${a.periodEnd}")\n`); return 3 }
  const version = a.ruleset ?? '0.1'
  const map = Object.prototype.hasOwnProperty.call(TWIN_MAPS, version) ? TWIN_MAPS[version] : undefined
  if (!map) { io.err(`verify twin: --ruleset must be one of ${Object.keys(TWIN_MAPS).join(', ')} (got "${version}")\n`); return 3 }
  const statement = (map.binding ?? 'document') === 'statement'
  const linkbase = [...(a.pre !== undefined ? ['--pre'] : []), ...(a.filingSummary !== undefined ? ['--filing-summary'] : []), ...(a.schema !== undefined ? ['--schema'] : [])]
  if (!statement && linkbase.length) {
    io.err(`verify twin: ${linkbase.join(', ')} belong${linkbase.length === 1 ? 's' : ''} to the statement-anchored twin (--ruleset 0.2 or 0.2.1); v0.1 binds against the whole document and would ignore ${linkbase.length === 1 ? 'it' : 'them'}\n${seeHelp('twin')}\n`)
    return 3
  }
  const num = (label: string, raw: string | undefined): number | undefined | string => {
    if (raw === undefined) return undefined
    const n = Number(raw)
    return raw.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : `${label} must be a non-negative number (got "${raw}")`
  }
  const tolerance = num('--tolerance', a.tolerance)
  const periodToleranceDays = num('--period-tolerance-days', a.periodToleranceDays)
  for (const x of [tolerance, periodToleranceDays]) if (typeof x === 'string') { io.err(`verify twin: ${x}\n`); return 3 }
  let html: string, claims: TwinClaim[], linkFiles: TwinPresentationInput = {}
  try {
    html = readText(a.html)
    const raw = readJson(a.claims) as unknown
    const arr = Array.isArray(raw) ? raw : (raw as { claims?: unknown })?.claims
    if (!Array.isArray(arr)) throw new Error('claims file must be an array of {id, field, value} or { "claims": [...] }')
    claims = arr as TwinClaim[]
    for (const c of claims) {
      if (!c || typeof c.id !== 'string' || typeof c.field !== 'string' || typeof c.value !== 'number') throw new Error('each claim needs id (string), field (string) and value (number)')
    }
    linkFiles = readLinkbase(a)
  } catch (e) { io.err(`error reading input: ${(e as Error).message}\n`); return 3 }
  let r
  try {
    // v0.2+: the filing's own presentation linkbase anchors each field to a face statement. Without one, every claim
    // is INSUFFICIENT_DATA (NO_PRESENTATION_LINKBASE): the statement-anchored twin never falls back to the whole document.
    const presentation = statement ? parseTwinPresentation(linkFiles, { links: map.links === 'strict' ? 'strict' : 'v0.2' }) : undefined
    r = verifyAgainstTwin(html, claims, {
      periodEnd: a.periodEnd, map,
      ...(statement ? { presentation: presentation ?? null } : {}),
      ...(typeof tolerance === 'number' ? { tolerance } : {}),
      ...(typeof periodToleranceDays === 'number' ? { periodToleranceDays } : {}),
    })
  } catch (e) { io.err(`verify twin: ${(e as Error).message}\n`); return 3 }
  io.out(`${JSON.stringify(r, null, 2)}\n`)
  if (statement && r.twin.presentation == null) io.err(`verify twin: no presentation linkbase was read (--pre / --filing-summary / --schema): the ${map.id}@${map.version} twin binds only through the filing's face statements, so every claim is can't tell (INSUFFICIENT_DATA, NO_PRESENTATION_LINKBASE)\n`)
  return r.verdict.outcome === 'PASS' ? 0 : r.verdict.outcome === 'FAIL' ? 1 : 2
}

/** The linkbase files named by --pre / --filing-summary / --schema, read as text (each optional). */
function readLinkbase(a: { pre?: string; filingSummary?: string; schema?: string }): TwinPresentationInput {
  return {
    ...(a.pre !== undefined ? { pre: readText(a.pre) } : {}),
    ...(a.filingSummary !== undefined ? { filingSummary: readText(a.filingSummary) } : {}),
    ...(a.schema !== undefined ? { schema: readText(a.schema) } : {}),
  }
}

/** `verify twin-einvoice`: wiring only; the logic lives in src/twin-einvoice/ (the XML is the binding record). */
function runTwinEinvoice(argv: string[], io: CliIO): number {
  let xmlPath: string | undefined, claimsPath: string | undefined, profile: string | undefined, consistency = true
  const unknown: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === '--help' || t === '-h') { return printHelp(io, 'twin-einvoice') }
    else if (t === '--claims') claimsPath = argv[++i]
    else if (t === '--profile') profile = argv[++i]
    else if (t === '--no-consistency') consistency = false
    else if (!t.startsWith('--') && xmlPath === undefined) xmlPath = t
    else unknown.push(t)
  }
  if (unknown.length) { io.err(`verify twin-einvoice: unknown option(s) ${unknown.join(', ')}\n${seeHelp('twin-einvoice')}\n`); return 3 }
  if (!xmlPath || !claimsPath) { io.err(`verify twin-einvoice needs <invoice.xml> and --claims <claims.json>\n${seeHelp('twin-einvoice')}\n`); return 3 }
  if (profile !== undefined && !['peppol-bis3', 'zatca-ksa', 'ksef-fa3'].includes(profile)) { io.err(`verify twin-einvoice: --profile must be peppol-bis3, zatca-ksa or ksef-fa3 (got "${profile}")\n`); return 3 }
  let xml: string, claims: EinvoiceClaim[]
  try {
    xml = readText(xmlPath)
    const raw = readJson(claimsPath) as unknown
    const arr = Array.isArray(raw) ? raw : (raw as { claims?: unknown })?.claims
    if (!Array.isArray(arr)) throw new Error('claims file must be an array of {id, field, value} or { "claims": [...] }')
    claims = arr as EinvoiceClaim[]
    for (const c of claims) {
      if (!c || typeof c.id !== 'string' || typeof c.field !== 'string' || (typeof c.value !== 'number' && typeof c.value !== 'string')) throw new Error('each claim needs id (string), field (string) and value (number or string)')
    }
  } catch (e) { io.err(`error reading input: ${(e as Error).message}\n`); return 3 }
  let r
  try {
    r = verifyEinvoiceTwin(xml, claims, { consistency, ...(profile ? { profile: profile as EinvoiceProfile } : {}) })
  } catch (e) { io.err(`verify twin-einvoice: ${(e as Error).message}\n`); return 3 }
  // 2026-10-05: the side reports say INSUFFICIENT_DATA where the twin's own word is ABSTAIN; the verdict always did
  const word = <T extends { outcome: string }>(x: T): Omit<T, 'outcome'> & { outcome: string } => ({ ...x, outcome: x.outcome === 'ABSTAIN' ? 'INSUFFICIENT_DATA' : x.outcome })
  const shown = { ...r, judgments: r.judgments.map(word), consistency: r.consistency.map(word) }
  io.out(`${JSON.stringify(shown, null, 2)}\n`)
  // 2026-10-05: one rule for every command, JSON on stdout and the words on stderr; and the exit reads the gate, failing
  // closed like `check` (a PASS on which a claim could not be judged exits 2, never 0)
  const reading = verdictExit(r.verdict)
  const say = (o: string): string => o.padEnd(17)
  const lines = shown.judgments.map(j => `  ${say(j.outcome)} ${j.claim_id} (${j.field} = ${JSON.stringify(j.value)}): ${j.detail}`)
  const footing = shown.consistency
  const held = footing.filter(c => c.outcome === 'PASS')
  if (footing.length && held.length === footing.length) lines.push(`  ${say('PASS')} the XML's own figures: ${held.length} of ${footing.length} business rules hold (${[...new Set(held.map(c => c.rule_id))].join(', ')})`)
  else for (const c of footing.filter(x => x.outcome !== 'PASS')) lines.push(`  ${say(c.outcome)} ${c.rule_id} on the XML's own figures: ${c.detail}`)
  io.err(`verify twin-einvoice: ${gateHeadline(r.verdict)}\n${lines.join('\n')}${lines.length ? '\n' : ''}${reading.exit === 2 && r.verdict.outcome === 'PASS' ? `  exit 2: ${reading.words}\n` : ''}`)
  return reading.exit
}

// ── a person's decisions on the book of record (wiring only: src/ledger/decisions.ts + src/verdict/voice.ts) ─────────

/** A verb's flags: 'value' takes the next argument; 'bool' is a switch; 'multi' takes a value and may repeat. */
type FlagSpec = Readonly<Record<string, 'value' | 'bool' | 'multi'>>

export interface Flags {
  /** Flag values by name (without the leading --). */
  v: Record<string, string>
  on: Set<string>
  /** Values of the repeatable ('multi') flags, in order. */
  multi: Record<string, string[]>
  /** Positional arguments (only when the verb takes them: parseFlags(argv, spec, { positional: n })). */
  args: string[]
  help: boolean
  /** What a person must fix before anything is read or signed: unknown, repeated or valueless flags. */
  problems: string[]
}

/**
 * Strict flag parsing for the verbs that sign or read a person's decisions. A typo, a repeated flag or a flag left without
 * its value is a usage error (exit 3), never a silent default: a signature must mean exactly what the person typed.
 * A verb that takes positional arguments says how many (`positional`); one more is a usage error too.
 */
export function parseFlags(argv0: readonly string[], spec: FlagSpec, opts: { positional?: number } = {}): Flags {
  // 2026-10-05: `--name=value` reads as `--name value`; an unknown option is named with the known one it is closest to,
  // and the value typed after it is not reported a second time as an "unexpected argument".
  const argv = splitEquals(argv0)
  const f: Flags = { v: {}, on: new Set(), multi: {}, args: [], help: false, problems: [] }
  const unknown: string[] = []
  const maxArgs = opts.positional ?? 0
  let afterUnknown = false
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] as string
    if (t === '-h' || t === '--help') { f.help = true; afterUnknown = false; continue }
    const name = t.startsWith('--') ? t.slice(2) : ''
    const kind = name && Object.prototype.hasOwnProperty.call(spec, name) ? spec[name] : undefined
    if (!kind) {
      if (afterUnknown && !t.startsWith('-')) { afterUnknown = false; continue } // the unknown option's value
      if (maxArgs > 0 && (!t.startsWith('-') || t === '-')) {
        if (f.args.length < maxArgs) f.args.push(t)
        else f.problems.push(`unexpected argument ${t}`)
        continue
      }
      unknown.push(t)
      afterUnknown = t.startsWith('--')
      continue
    }
    afterUnknown = false
    if (kind !== 'multi' && (Object.prototype.hasOwnProperty.call(f.v, name) || f.on.has(name))) f.problems.push(`${t} is given twice`)
    if (kind === 'bool') { f.on.add(name); continue }
    const val = argv[i + 1]
    // 2026-10-05: an inline PEM ("$(cat k.pub.pem)") starts with five dashes; it is a value, never an option
    if (val === undefined || (val.startsWith('--') && !val.startsWith('-----BEGIN '))) { f.problems.push(`${t} needs a value`); continue }
    if (kind === 'multi') (f.multi[name] ??= []).push(val)
    else f.v[name] = val
    i++
  }
  if (unknown.length) f.problems.unshift(unknownOptions(unknown, [...Object.keys(spec).map(k => `--${k}`), '--help']))
  return f
}

const need = (f: Flags, names: readonly string[]): string[] => names.filter(n => f.v[n] === undefined).map(n => `--${n}`)

/** A usage error: the one line that says what is wrong, then a one-line pointer to the command's help (never the reference). */
function usageError(io: CliIO, verb: string, msg: string): number {
  io.err(`verify ${verb}: ${msg}\n${seeHelp(verb)}\n`)
  return 3
}
function inputError(io: CliIO, verb: string, e: unknown, what = 'error reading input'): number {
  const book = bookFileRefused(io, verb, e)
  if (book !== undefined) return book
  io.err(`verify ${verb}: ${what}: ${e instanceof Error ? e.message : String(e)}\n`)
  return 3
}
function refused(io: CliIO, verb: string, reason: string): number {
  io.err(`verify ${verb}: REFUSED: ${reason}\n`)
  return 1
}
/** A library refusal (DecisionRefused, or a helper saying no to its input) is exit 1; anything else reading input is 3. */
const refusedOr3 = (io: CliIO, verb: string, e: unknown, what: string): number =>
  e instanceof DecisionRefused ? refused(io, verb, e.message) : inputError(io, verb, e, what)

/** --trusted-keys (a static signer → key map) and --root-keys (the root public key: the registry on the book anchors signers). */
const ANCHOR_FLAGS: FlagSpec = { 'trusted-keys': 'value', 'root-keys': 'value' }
const DECISION_COMMON: FlagSpec = { ledger: 'value', key: 'value', signer: 'value', ...ANCHOR_FLAGS }
const GRANT_FLAGS: FlagSpec = { ...DECISION_COMMON, workflow: 'value', level: 'value', tier: 'value', policy: 'value', bounds: 'value', answers: 'value', note: 'value', 'signed-at': 'value', cosign: 'value' }
const DECLINE_FLAGS: FlagSpec = { ...DECISION_COMMON, policy: 'value', assessment: 'value', workflow: 'value', proposal: 'value', tier: 'value', reason: 'value', note: 'value', 'signed-at': 'value' }
const REVISE_FLAGS: FlagSpec = { ...DECISION_COMMON, revised: 'value', from: 'value', draft: 'value', reason: 'value', 'signed-at': 'value', out: 'value' }
/** The flags of revise-policy's draft form (--from/--draft): Riposte builds the revision; a --revised body carries its own. */
const DRAFT_ONLY = ['from', 'draft', 'reason', 'signed-at', 'out'] as const
const KEYGEN_FLAGS: FlagSpec = { out: 'value', signer: 'value' }
const REPORT_FLAGS: FlagSpec = { ledger: 'value', policy: 'value', declarations: 'value', tenant: 'value', month: 'value', 'as-of': 'value', ...ANCHOR_FLAGS }

/** How the book is read: a static signer → key map, and/or the root public key(s) (then the registry on the book anchors). */
interface Anchors { trusted?: TrustedKeys; root?: RootKeys }

const anchorOpts = (a: Anchors): { trusted_keys?: TrustedKeys; root_keys?: RootKeys } =>
  ({ ...(a.trusted ? { trusted_keys: a.trusted } : {}), ...(a.root ? { root_keys: a.root } : {}) })
const isAnchoredRead = (a: Anchors): boolean => a.trusted !== undefined || a.root !== undefined

/** --trusted-keys / --root-keys, read from their files (each optional). */
function readAnchors(f: Flags): Anchors {
  const trusted = f.v['trusted-keys'] !== undefined ? readTrustedKeys(f.v['trusted-keys']) : undefined
  const root = f.v['root-keys'] !== undefined ? readRootKeys(f.v['root-keys']) : undefined
  return { ...(trusted ? { trusted } : {}), ...(root ? { root } : {}) }
}

const PEM_PUBLIC = /-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g

/**
 * A root-keys file: one or more Ed25519 PUBLIC keys (SPKI PEM blocks, concatenated), a JSON array of them, or verify keygen's
 * output ({ public_key }). A private key is refused: the root's private key never belongs on a reader's command line.
 */
function readRootKeys(path: string): RootKeys {
  const text = readText(path)
  if (/PRIVATE KEY-----/.test(text)) throw new Error(`${path} holds a PRIVATE key: --root-keys takes the root's PUBLIC key (the .pub.pem verify keygen wrote); keep the private key offline`)
  const t = text.trim()
  let pems: string[]
  if (t.startsWith('{') || t.startsWith('[')) {
    const raw = parseJsonStrict(t, path) // 2026-10-05: a key written twice could change which root key a reader trusts
    const arr = Array.isArray(raw) ? raw : isObj(raw) && typeof raw.public_key === 'string' ? [raw.public_key] : undefined
    if (!arr || !arr.every(x => typeof x === 'string')) throw new Error('root keys must be PEM public key block(s), a JSON array of them, or verify keygen\'s output ({ public_key })')
    pems = arr as string[]
  } else {
    pems = t.match(PEM_PUBLIC) ?? []
  }
  if (!pems.length) throw new Error(`${path} holds no public key (a -----BEGIN PUBLIC KEY----- block)`)
  for (const pem of pems) if (keyFingerprint(pem) === undefined) throw new Error(`${path}: a root key must be an Ed25519 public key (SPKI PEM)`)
  return pems.map(p => `${p.trim()}\n`)
}

interface DecisionInputs extends Anchors { ledgerPath: string; keyPem: string; signer: string }

/** The book file a verb appends to: it must already exist (an empty file is a new book), so a path typo never makes one. */
function existingBook(path: string): string {
  if (!existsSync(path)) throw new Error(`no ledger at ${path}: a decision is appended to an existing book of record (create the file first; an empty file is a new book)`)
  return path
}

/** What every decision verb reads: the book (it must already exist), the person's private key, the signer, the anchors. */
function readDecisionInputs(f: Flags): DecisionInputs {
  const ledgerPath = existingBook(f.v.ledger as string)
  const keyPem = readText(f.v.key as string)
  return { ledgerPath, keyPem, signer: f.v.signer as string, ...readAnchors(f) }
}

type Seed = ChainSnapshot

/** The book at `path` read under these anchors: its seed, or why it could not be read, or why it does not verify. Never throws. */
function verifiedSeed(path: string, a: Anchors): { seed: Seed } | { error: unknown } | { broken: string } {
  let seed: Seed
  try { seed = readBookFile(path) } catch (e) { return { error: e } }
  let check
  try { check = new MemoryLedger({ ...anchorOpts(a), seed }).verifyContent() } catch (e) { return { error: e } }
  if (!check.ok) return { broken: `the book of record does not verify${check.brokenAt !== undefined ? ` at event ${check.brokenAt}` : ''} (${check.reason ?? 'unknown'})` }
  return { seed }
}

/** DecisionRefused / SampleRefused (the door said no) are exit 1; anything else is an input or I/O error, exit 3. */
const refusedOrLib = (io: CliIO, verb: string, e: unknown, what: string): number =>
  e instanceof SampleRefused ? refused(io, verb, e.message) : refusedOr3(io, verb, e, what)

/**
 * Change the book the same way twice: first on an in-memory copy (so a refusal leaves the file byte-identical), then on the
 * file ledger itself. A book that does not verify takes nothing. `act` is the one library call (decide, reviewSigned,
 * commitSample, ...): DecisionRefused / SampleRefused are exit 1, anything else exit 3.
 */
function appendTwice<T>(verb: string, io: CliIO, path: string, a: Anchors, act: (l: Ledger) => T): { value: T } | { code: number } {
  // The book is read once, streamed, as the file ledger that will take the append (opening writes nothing). A torn tail or
  // a corrupt line refuses (exit 1) with the ledger's message.
  let book: FileLedger
  try { book = openFileLedger(path, anchorOpts(a)) } catch (e) { return { code: inputError(io, verb, e, 'error reading ledger') } }
  try {
    if (book.torn) return { code: inputError(io, verb, new TornTailError(path, book.torn)) }
    const check = book.verifyContent()
    if (!check.ok) return { code: refused(io, verb, `the book of record does not verify${check.brokenAt !== undefined ? ` at event ${check.brokenAt}` : ''} (${check.reason ?? 'unknown'}): nothing is appended to a book that does not verify`) }
    try { act(new MemoryLedger({ ...anchorOpts(a), seed: book.snapshot() })) } catch (e) { return { code: refusedOrLib(io, verb, e, 'error at the door') } }
    // A chain export (ledger.chainJSONL()) ends without a newline; the file ledger writes the missing one before its first
    // append (fixed in src/ledger/file.ts), so events never fuse onto one line.
    try { return { value: act(book) } } catch (e) { return { code: refusedOrLib(io, verb, e, 'error writing ledger') } }
  } finally {
    book.close()
  }
}

function unanchoredNote(io: CliIO, verb: string, a: Anchors, signer: string): void {
  if (isAnchoredRead(a)) return
  io.err(`verify ${verb}: note: no --trusted-keys or --root-keys, so signer '${signer}' is UNANCHORED: the signature proves the key holder decided, not which person, and an unanchored decision moves no rung (D-ANCHOR). Anchor signers with --trusted-keys <keys.json> or --root-keys <root.pub.pem>.\n`)
}

/**
 * Append a person's signed decision to a file ledger through the library's door (`ledger.decide`), twice (appendTwice).
 * Prints the appended entry (its seq, entry_hash and decision_id) and the new head.
 */
function appendDecision<D extends BookDecision>(
  verb: string, io: CliIO, inp: DecisionInputs, signed: SignedDecision<D>, notes?: (l: Ledger, entry: DecisionEntry<D>) => string[],
): number {
  const r = appendTwice(verb, io, inp.ledgerPath, inp, l => { const entry = l.decide(signed); return { entry, notes: notes ? notes(l, entry) : [] } })
  if ('code' in r) return r.code
  const entry = r.value.entry
  io.out(`${JSON.stringify({ appended: entry, anchored: isAnchoredRead(inp), chain: { length: entry.seq + 1, head: entry.entry_hash } }, null, 2)}\n`)
  unanchoredNote(io, verb, inp, signed.decision.signer_id)
  for (const n of r.value.notes) io.err(`verify ${verb}: note: ${n}\n`)
  return 0
}

/**
 * `verify grant`: a person sets a workflow's rung (either direction) as a signed GRANT on the book. The GRANT is built by the
 * library's grantUnderPolicy (the policy lints, the tier is declared, the rung is within the tier's max_rung), so the CLI,
 * MCP and HTTP refuse the same way.
 */
function runGrant(argv: string[], io: CliIO): number {
  const verb = 'grant'
  const f = parseFlags(argv, GRANT_FLAGS)
  if (f.help) { return printHelp(io, 'grant') }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  if (f.v.cosign !== undefined) return runGrantCosign(f, io)
  const missing = need(f, ['ledger', 'key', 'signer', 'workflow', 'level', 'tier', 'policy'])
  if (missing.length) return usageError(io, verb, `needs ${missing.join(', ')}`)
  const level = f.v.level as VoiceLevel
  if (!VOICE_LADDER.includes(level)) return usageError(io, verb, `--level must be one of ${VOICE_LADDER.join(', ')} (got "${f.v.level}")`)
  let inp: DecisionInputs, policy: PromotionPolicy
  try {
    inp = readDecisionInputs(f)
    policy = readJson(f.v.policy as string) as unknown as PromotionPolicy
  } catch (e) { return inputError(io, verb, e) }
  if (!isObj(policy) || !Array.isArray((policy as { tiers?: unknown }).tiers)) return inputError(io, verb, new Error('--policy must be a promotion policy ({ policy_id, version, tiers, ... })'))
  let signed: SignedDecision
  try {
    const d = grantUnderPolicy(policy, {
      workflow_id: f.v.workflow as string, level, consequence_tier: f.v.tier as string,
      ...(f.v.bounds !== undefined ? { bounds: f.v.bounds } : {}),
      ...(f.v.answers !== undefined ? { answers: f.v.answers } : {}),
      ...(f.v.note !== undefined ? { note: f.v.note } : {}),
      signer_id: inp.signer, signed_at: f.v['signed-at'] ?? new Date().toISOString(),
    })
    signed = signDecision(d, inp.keyPem)
  } catch (e) { return refusedOr3(io, verb, e, 'error reading key') }
  // D-DUAL: a GRANT of autonomy at a tier declaring grant_signatures is pending until co-signed: said, never silent.
  return appendDecision(verb, io, inp, signed, (l, entry) =>
    bookNoEffect(l.decisionBook(), { workflow_id: f.v.workflow as string, policies: [policy] })
      .filter(n => n.decision_id === entry.decision_id && n.pending)
      .map(n => `${n.notice}. Co-sign with: verify grant --cosign ${entry.decision_id} --ledger <book> --key <pem> --signer <id>`))
}

/** "2 of 2: in force", "1 of 2: pending", in words. */
function signaturesWords(s: GrantSignatures, inForce: boolean): string {
  const of = `${s.signers.length} of ${s.required} signature(s) (${s.signers.join(', ')})`
  return s.complete ? `${of}: ${inForce ? 'in force' : 'complete, but not the grant in force (a later grant supersedes it)'}` : `${of}: pending`
}

/**
 * `verify grant --cosign <grant_decision_id>` (D-DUAL): a second person co-signs a GRANT, as a signed GRANT_COSIGN built by
 * makeCosign (it restates the grant's workflow and level; it rides in a GRANT event). The grant is found on the book as the
 * door reads it; the door refuses a co-signature that would not count, and a refusal appends nothing. Prints the entry and
 * the grant's signatures as the book then stands. --policy (optional) raises the count to the grant's tier.
 */
function runGrantCosign(f: Flags, io: CliIO): number {
  const verb = 'grant --cosign'
  const foreign = ['workflow', 'level', 'tier', 'bounds', 'answers'].filter(n => f.v[n] !== undefined)
  if (foreign.length) return usageError(io, verb, `a co-signature names the grant and restates only what it says: ${foreign.map(n => `--${n}`).join(', ')} cannot be passed with --cosign`)
  const missing = need(f, ['ledger', 'key', 'signer'])
  if (missing.length) return usageError(io, verb, `needs ${missing.join(', ')}`)
  const ref = f.v.cosign as string
  if (!/^[0-9a-f]{12,}$/.test(ref)) return usageError(io, verb, `--cosign takes the grant's decision id (hex), or a unique prefix of at least 12 characters (got "${ref}")`)
  let inp: DecisionInputs, policy: PromotionPolicy | undefined
  try {
    inp = readDecisionInputs(f)
    createPrivateKey(inp.keyPem)
    policy = f.v.policy !== undefined ? (readJson(f.v.policy) as unknown as PromotionPolicy) : undefined
  } catch (e) { return inputError(io, verb, e) }
  const signed_at = f.v['signed-at'] ?? new Date().toISOString()
  const r = appendTwice(verb, io, inp.ledgerPath, inp, l => {
    const hits = l.decisionBook().decisions.filter(e => e.signed.decision.kind === 'GRANT' && e.decision_id.startsWith(ref))
    if (hits.length !== 1) {
      throw new DecisionRefused(hits.length ? `--cosign ${ref} names ${hits.length} grants on the book: give more of the decision id` : `no GRANT ${ref} on the book: a co-signature names a grant already on it`)
    }
    const grant = hits[0] as DecisionEntry<GrantDecision>
    const cosign = makeCosign(grant, { signer_id: inp.signer, signed_at, ...(f.v.note !== undefined ? { note: f.v.note } : {}) })
    const entry = l.decide(signDecision<BookDecision>(cosign, inp.keyPem))
    const after = l.decisionBook()
    const g = (after.decisions.find(e => e.decision_id === grant.decision_id) ?? grant) as DecisionEntry<GrantDecision>
    // Read under --policy as a deployment reads it (http/dual.ts): a grant of autonomy needs its tier's count there, whatever it names.
    const gov = governedRead(after, policy)
    const signatures = governedSignatures(g, after, policy)
    const inForce = grantInForce(after.decisions, g.signed.decision.workflow_id, governing(policy))?.decision_id === g.decision_id
    const notices = gov.no_effect({ workflow_id: g.signed.decision.workflow_id }).filter(n => n.decision_id === g.decision_id || n.decision_id === entry.decision_id).map(n => n.notice)
    return { entry, grant: g, signatures, inForce, notices }
  })
  if ('code' in r) return r.code
  const { entry, grant, signatures, inForce, notices } = r.value
  const gd = grant.signed.decision
  io.out(`${JSON.stringify({ appended: entry, anchored: isAnchoredRead(inp), chain: { length: entry.seq + 1, head: entry.entry_hash }, grant: { decision_id: grant.decision_id, workflow_id: gd.workflow_id, level: gd.level, signatures, in_force: inForce } }, null, 2)}\n`)
  unanchoredNote(io, verb, inp, inp.signer)
  io.err(`verify ${verb}: GRANT ${grant.decision_id.slice(0, 12)}… (${gd.workflow_id} → ${gd.level}): ${signaturesWords(signatures, inForce)}\n`)
  for (const n of notices) io.err(`verify ${verb}: note: ${n}\n`)
  return 0
}

// ── RULESET_SUCCESSION: a person carries a grant to a new ruleset version, with the replay they signed ──────────────────

const SUCCESSION_FLAGS: FlagSpec = {
  ...DECISION_COMMON, from: 'value', to: 'value', inputs: 'value', ruleset: 'value', tolerance: 'value', reason: 'value',
  'loosening-reason': 'value', level: 'value', policy: 'value', grant: 'value', note: 'value', 'signed-at': 'value',
  'dry-run': 'bool', check: 'value',
}
/** What only the signing form takes: --check re-performs a succession already on the book, and signs nothing. */
const SUCCESSION_SIGN_ONLY = ['from', 'to', 'reason', 'loosening-reason', 'level', 'policy', 'grant', 'note', 'signed-at', 'key', 'signer'] as const
/** How many changes and not-re-performed verdicts stderr lists one by one (stdout carries every one). */
const SUCCESSION_LISTED = 20

/** --inputs: JSONL (or a JSON array) of { verdict_id, inputs }, the inputs each recorded verdict was issued on. */
function readSuccessionInputs(path: string): Map<string, unknown> {
  const raw = readText(path)
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  // 2026-10-05: the inputs are hashed, so a number past the double range is refused here too (parseJsonStrict)
  const rows: unknown = text.trim().startsWith('[') ? parseJsonStrict(text, `--inputs ${path}`)
    : text.split(/\r?\n/).filter(l => l.trim() !== '').map((l, i) => parseJsonStrict(l, `--inputs line ${i + 1}`))
  if (!Array.isArray(rows)) throw new Error('--inputs must be JSONL (one { "verdict_id", "inputs" } per line) or a JSON array of them')
  const out = new Map<string, unknown>()
  rows.forEach((r, i) => {
    if (!isObj(r) || typeof r.verdict_id !== 'string' || !isObj(r.inputs)) throw new Error(`--inputs item ${i + 1} must be { "verdict_id": "<id>", "inputs": { ... } }`)
    if (out.has(r.verdict_id)) throw new Error(`--inputs gives verdict ${r.verdict_id} twice`)
    out.set(r.verdict_id, r.inputs)
  })
  return out
}

function readDeclarativeRuleset(path: string): DeclarativeRuleset {
  const raw = readRulesetArg(path) as unknown
  if (!isDeclarativeRuleset(raw)) throw new Error(`--ruleset ${path} is not a declarative ruleset (id, version, fields, checks); a built-in ruleset is found by the --to version`)
  return raw
}

/** The replay a person reviews before signing, in words, on stderr. */
function saySuccessionReplay(io: CliIO, verb: string, g: DecisionEntry<GrantDecision>, to: string, r: SuccessionReplayResult): void {
  const gd = g.signed.decision
  const rp = r.replay
  const dirs = new Map<string, number>()
  for (const c of rp.changed) dirs.set(`${c.from}→${c.to}`, (dirs.get(`${c.from}→${c.to}`) ?? 0) + 1)
  const by = [...dirs].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} ${n}`).join(', ')
  const loose = rp.changed.filter(loosens).length
  io.err(`verify ${verb}: carries GRANT ${g.decision_id.slice(0, 12)}… (${gd.workflow_id} at ${gd.level}, tier ${gd.consequence_tier}, by ${gd.signer_id}, seq ${g.seq}) to ${to}\n`)
  io.err(`verify ${verb}: replay under ${to}: ${rp.recorded} verdict(s) recorded under ${gd.workflow_id}, ${rp.reperformed} re-performed, ${rp.changed.length} changed${by ? ` (${by})` : ''}`
    + `${rp.reperformed < rp.recorded ? `; ${rp.recorded - rp.reperformed} not re-performed (what the new ruleset says of them is unknown)` : ''}`
    + `${loose ? `; ${loose} loosen (a recorded hold the new ruleset passes: needs --loosening-reason)` : ''}\n`)
  const list = (rows: string[]): void => {
    for (const l of rows.slice(0, SUCCESSION_LISTED)) io.err(`verify ${verb}:   ${l}\n`)
    if (rows.length > SUCCESSION_LISTED) io.err(`verify ${verb}:   … and ${rows.length - SUCCESSION_LISTED} more (every one is on stdout)\n`)
  }
  list(rp.changed.map(c => `${c.from}→${c.to} ${c.verdict_id}${loosens(c) ? ' (loosens)' : ''}`))
  list(r.not_reperformed.map(n => `not re-performed ${n.verdict_id}: ${n.reason}`))
}

const carriesOf = (g: DecisionEntry<GrantDecision>) => {
  const gd = g.signed.decision
  return { decision_id: g.decision_id, workflow_id: gd.workflow_id, level: gd.level, consequence_tier: gd.consequence_tier, signer_id: gd.signer_id, seq: g.seq }
}

/**
 * `verify succession`: a person carries the grant in force on one ruleset version to the next (RULESET_SUCCESSION, D-SUCC-SHAPE:
 * a GRANT on the new workflow carrying the replay). Riposte reads the book under the anchors, finds the grant in force on
 * --from under the declared --policy, re-performs every verdict recorded under --from with the new ruleset (the inputs from
 * --inputs), and prints that replay BEFORE anything is signed. --dry-run stops there (with --key, the door is asked on a
 * copy). Otherwise successionGrant builds the GRANT (never above the old rung; a loosening needs --loosening-reason),
 * signDecision signs it, and it goes through the ledger's door twice (appendTwice): a refusal leaves the book byte-identical.
 */
function runSuccession(argv: string[], io: CliIO): number {
  const verb = 'succession'
  const f = parseFlags(argv, SUCCESSION_FLAGS)
  if (f.help) { return printHelp(io, 'succession') }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  if (f.v.check !== undefined) return runSuccessionCheck(f, io)
  const dry = f.on.has('dry-run')
  const missing = need(f, ['ledger', 'from', 'to', 'inputs', 'reason', 'signer', 'policy', ...(dry ? [] : ['key'])])
  if (missing.length) return usageError(io, verb, `needs ${missing.join(', ')}`)
  if (f.v['trusted-keys'] === undefined && f.v['root-keys'] === undefined) {
    return usageError(io, verb, 'needs --trusted-keys or --root-keys: only an anchored grant is in force, so only an anchored grant is carried (D-ANCHOR)')
  }
  const level = f.v.level as VoiceLevel | undefined
  if (level !== undefined && !VOICE_LADDER.includes(level)) return usageError(io, verb, `--level must be one of ${VOICE_LADDER.join(', ')} (got "${f.v.level}")`)
  const pin = f.v.grant
  if (pin !== undefined && !/^[0-9a-f]{12,}$/.test(pin)) return usageError(io, verb, `--grant takes the decision id of the grant you reviewed (hex), or a prefix of at least 12 characters (got "${pin}")`)
  const from = f.v.from as string, to = f.v.to as string
  let ledgerPath: string, anchors: Anchors, policy: PromotionPolicy, inputs: Map<string, unknown>
  let ruleset: DeclarativeRuleset | undefined, tolerance: TolerancePolicy | undefined, keyPem: string | undefined
  try {
    ledgerPath = existingBook(f.v.ledger as string)
    anchors = readAnchors(f)
    policy = readJson(f.v.policy as string) as unknown as PromotionPolicy
    inputs = readSuccessionInputs(f.v.inputs as string)
    ruleset = f.v.ruleset !== undefined ? readDeclarativeRuleset(f.v.ruleset) : undefined
    tolerance = f.v.tolerance !== undefined ? readTolerance(f.v.tolerance) : undefined
    keyPem = f.v.key !== undefined ? readText(f.v.key) : undefined
    if (keyPem !== undefined) createPrivateKey(keyPem)
  } catch (e) { return inputError(io, verb, e) }
  if (!isObj(policy) || !Array.isArray((policy as { tiers?: unknown }).tiers)) return inputError(io, verb, new Error('--policy must be a promotion policy ({ policy_id, version, tiers, ... })'))
  // The book as it stands, verified under the anchors. A torn tail or a corrupt line refuses, as for any verb that appends.
  let led: MemoryLedger
  try { led = new MemoryLedger({ ...anchorOpts(anchors), seed: readBookFile(ledgerPath) }) } catch (e) { return inputError(io, verb, e, 'error reading ledger') }
  const check = led.verifyContent()
  if (!check.ok) return refused(io, verb, `the book of record does not verify${check.brokenAt !== undefined ? ` at event ${check.brokenAt}` : ''} (${check.reason ?? 'unknown'}): nothing is carried on a book that does not verify`)
  // Only the grant in force is carried (read as the deployment reads it: anchored, fully signed, admitted by --policy).
  const g = grantInForce(led.decisionBook().decisions, from, governing(policy))
  if (!g) return refused(io, verb, `nothing is granted on ${from} under ${policy.policy_id}@${policy.version} (no anchored, fully signed grant the policy admits): there is no grant to carry`)
  if (pin !== undefined && !g.decision_id.startsWith(pin)) {
    return refused(io, verb, `the grant in force on ${from} is GRANT ${g.decision_id.slice(0, 12)}… (${g.signed.decision.level}, seq ${g.seq}), not ${pin}: only the grant in force is carried (a decision since the one you reviewed replaced it; run --dry-run again)`)
  }
  let r: SuccessionReplayResult
  try {
    r = successionReplay(led, from, to, { inputs: v => inputs.get(v.verdict_id), ...(ruleset ? { ruleset } : {}), ...(tolerance ? { tolerance } : {}) })
  } catch (e) { return refusedOr3(io, verb, e, 'error replaying') }
  saySuccessionReplay(io, verb, g, to, r)
  // DECISION D-C3-NO-EVIDENCE (fork: here): a replay that re-performed none of the verdicts recorded is no replay. The library
  // allows partial coverage (D-SUCC-COVERAGE) and says it; the command line refuses to sign on none.
  if (r.replay.recorded > 0 && r.replay.reperformed === 0) {
    return refused(io, verb, `the replay re-performed none of the ${r.replay.recorded} verdict(s) recorded under ${from}, so it shows nothing of what the new ruleset says of them: supply the inputs they were issued on (--inputs), and for a ruleset this build does not hold, the ruleset (--ruleset)`)
  }
  let d: GrantDecision
  try {
    d = successionGrant({
      from: g, to, replay: r.replay, reason: f.v.reason as string, signer_id: f.v.signer as string, signed_at: f.v['signed-at'] ?? new Date().toISOString(),
      ...(level !== undefined ? { level } : {}),
      ...(f.v['loosening-reason'] !== undefined ? { loosening_reason: f.v['loosening-reason'] } : {}),
      ...(f.v.note !== undefined ? { note: f.v.note } : {}),
    }, policy)
  } catch (e) { return refusedOr3(io, verb, e, 'error building the grant') }
  const summary = { carries: carriesOf(g), replay: r.replay, not_reperformed: r.not_reperformed }
  if (dry) {
    // With the key, the door is asked on the in-memory copy (never the file): the refusals the real run would meet, now.
    if (keyPem !== undefined) {
      try { led.decide(signDecision(d, keyPem)) } catch (e) { return refusedOrLib(io, verb, e, 'error at the door') }
    }
    io.out(`${JSON.stringify({ dry_run: true, ...summary, grant: d, door: keyPem !== undefined ? 'takes it' : 'not asked (no --key)' }, null, 2)}\n`)
    io.err(`verify ${verb}: dry run: nothing is signed or appended. The GRANT it would sign is on stdout; to sign it, run again without --dry-run (--grant ${g.decision_id.slice(0, 12)} refuses if the grant in force has changed by then).\n`)
    return 0
  }
  let signed: SignedDecision
  try { signed = signDecision(d, keyPem as string) } catch (e) { return refusedOr3(io, verb, e, 'error reading key') }
  const res = appendTwice(verb, io, ledgerPath, anchors, l => {
    const entry = l.decide(signed) as DecisionEntry<GrantDecision>
    const after = l.decisionBook()
    const inForce = grantInForce(after.decisions, to, governing(policy))?.decision_id === entry.decision_id
    return { entry, inForce, notices: governedRead(after, policy).no_effect({ workflow_id: to }).filter(n => n.decision_id === entry.decision_id) }
  })
  if ('code' in res) return res.code
  const { entry, inForce, notices } = res.value
  io.out(`${JSON.stringify({ appended: entry, anchored: true, chain: { length: entry.seq + 1, head: entry.entry_hash }, ...summary, in_force: inForce }, null, 2)}\n`)
  if (inForce) io.err(`verify ${verb}: ${successionNotice(entry)}\n`)
  // D-DUAL carries over on autonomy: pending until co-signed, said with the command; any other no-effect is said too.
  for (const n of notices) {
    io.err(`verify ${verb}: note: ${n.notice}${n.pending ? `. Co-sign with: verify grant --cosign ${entry.decision_id} --ledger <book> --key <pem> --signer <id> --policy <policy.json>` : ''}\n`)
  }
  return 0
}

/**
 * `verify succession --check <decision_id>`: re-perform the replay a succession GRANT on the book carries, over its own span,
 * with the inputs supplied (checkSuccessionReplay). Exit 0 when this build gives the replay the person signed, byte for byte ·
 * 1 when it differs (each difference named), or the grant carries no succession · 3 usage.
 */
function runSuccessionCheck(f: Flags, io: CliIO): number {
  const verb = 'succession --check'
  const foreign = SUCCESSION_SIGN_ONLY.filter(n => f.v[n] !== undefined).map(n => `--${n}`)
  if (f.on.has('dry-run')) foreign.push('--dry-run')
  if (foreign.length) return usageError(io, verb, `--check re-performs a succession already on the book and signs nothing: ${foreign.join(', ')} cannot be passed with it`)
  const missing = need(f, ['ledger', 'inputs'])
  if (missing.length) return usageError(io, verb, `needs ${missing.join(', ')}`)
  const ref = f.v.check as string
  if (!/^[0-9a-f]{12,}$/.test(ref)) return usageError(io, verb, `--check takes the succession GRANT's decision id (hex), or a unique prefix of at least 12 characters (got "${ref}")`)
  let anchors: Anchors, inputs: Map<string, unknown>, ruleset: DeclarativeRuleset | undefined, tolerance: TolerancePolicy | undefined
  try {
    anchors = readAnchors(f)
    inputs = readSuccessionInputs(f.v.inputs as string)
    ruleset = f.v.ruleset !== undefined ? readDeclarativeRuleset(f.v.ruleset) : undefined
    tolerance = f.v.tolerance !== undefined ? readTolerance(f.v.tolerance) : undefined
  } catch (e) { return inputError(io, verb, e) }
  let led: Ledger
  try { led = openBookReadOnly(f.v.ledger as string, anchors, io, verb) } catch (e) { return inputError(io, verb, e, 'error reading ledger') }
  const bookCheck = led.verifyContent()
  if (!bookCheck.ok) return refused(io, verb, `the book of record does not verify${bookCheck.brokenAt !== undefined ? ` at event ${bookCheck.brokenAt}` : ''} (${bookCheck.reason ?? 'unknown'})`)
  const hits = led.decisionBook().decisions.filter(e => e.signed.decision.kind === 'GRANT' && e.decision_id.startsWith(ref))
  if (hits.length !== 1) return refused(io, verb, hits.length ? `--check ${ref} names ${hits.length} grants on the book: give more of the decision id` : `no GRANT ${ref} on the book`)
  const g = hits[0] as DecisionEntry<GrantDecision>
  const s = g.signed.decision.succeeds
  if (!s) return refused(io, verb, `GRANT ${g.decision_id.slice(0, 12)}… carries no succession: there is no replay to check`)
  let c: ReturnType<typeof checkSuccessionReplay>
  try {
    c = checkSuccessionReplay(led, g, { inputs: v => inputs.get(v.verdict_id), ...(ruleset ? { ruleset } : {}), ...(tolerance ? { tolerance } : {}) })
  } catch (e) { return refusedOr3(io, verb, e, 'error replaying') }
  io.out(`${JSON.stringify({ decision_id: g.decision_id, workflow_id: g.signed.decision.workflow_id, from: s.from, ok: c.ok, differences: c.differences, signed: s.replay, reperformed: c.replay, ...(g.replay ? { book: g.replay } : {}) }, null, 2)}\n`)
  if (g.replay && !g.replay.matches) io.err(`verify ${verb}: note: the book reads this succession with no effect: its replay does not match the book (${g.replay.reason ?? 'unknown'})\n`)
  if (c.ok) {
    io.err(`verify ${verb}: OK: this build re-performs the replay ${g.signed.decision.signer_id} signed, byte for byte (${s.replay.recorded} recorded, ${s.replay.reperformed} re-performed, ${s.replay.changed.length} changed)\n`)
    return 0
  }
  io.err(`verify ${verb}: DIFFERS from the replay ${g.signed.decision.signer_id} signed:\n`)
  for (const d of c.differences) io.err(`verify ${verb}:   ${d}\n`)
  return 1
}

/** A voice assessment from a file: the bare assessment, or `verify voice` / voice-surface output carrying one. */
function readAssessment(path: string): VoiceAssessment {
  const raw = readJson(path) as unknown
  const a = isObj(raw) && raw.assessment_version === undefined && isObj(raw.assessment) ? raw.assessment : raw
  if (!isObj(a) || a.assessment_version !== 'voice-v0' || typeof a.assessment_hash !== 'string') {
    throw new Error('not a voice assessment (verify voice --from-book prints { chain, assessment }; either shape is accepted)')
  }
  return a as unknown as VoiceAssessment
}

/**
 * `verify decline`: a person's "no" to the proposal the BOOK raises now (declineOnBook). Riposte re-derives the assessment
 * from the book itself and signs a DECLINE only for the live proposal the person names, so a doctored assessment file can
 * never become a signed decline (an assessment's hash is recomputable by anyone; the book is not). Name the
 * proposal either with the assessment the person read (--assessment: the output of verify voice --from-book, which must
 * match its own hash and cite this book) or directly (--workflow + --proposal). --policy is the policy the book is read under.
 */
function runDecline(argv: string[], io: CliIO): number {
  const verb = 'decline'
  const f = parseFlags(argv, DECLINE_FLAGS)
  if (f.help) { return printHelp(io, 'decline') }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  const missing = need(f, ['ledger', 'key', 'signer', 'policy', 'reason'])
  if (missing.length) return usageError(io, verb, `needs ${missing.join(', ')}${f.v.policy === undefined ? ' (--policy: the book is read again under it, and only the proposal it raises now is declined)' : ''}`)
  const byFile = f.v.assessment !== undefined
  if (byFile && (f.v.workflow !== undefined || f.v.proposal !== undefined)) return usageError(io, verb, 'name the proposal once: --assessment <verify voice --from-book output>, or --workflow <id> --proposal <proposal_id>')
  if (!byFile && (f.v.workflow === undefined || f.v.proposal === undefined)) return usageError(io, verb, 'needs --assessment <verify voice --from-book output>, or --workflow <id> --proposal <proposal_id>')
  let inp: DecisionInputs, policy: PromotionPolicy, a: VoiceAssessment | undefined, events: Seed['events']
  try {
    inp = readDecisionInputs(f)
    policy = readJson(f.v.policy as string) as unknown as PromotionPolicy
    a = byFile ? readAssessment(f.v.assessment as string) : undefined
    events = readBookFile(inp.ledgerPath).events
  } catch (e) { return inputError(io, verb, e) }
  let workflow_id = f.v.workflow as string
  let proposal_id = f.v.proposal as string
  let tier = f.v.tier
  if (a) {
    const { assessment_hash, ...body } = a
    if (hashOf(body) !== assessment_hash) {
      return refused(io, verb, 'the assessment does not match its own hash (it was altered after Riposte made it): a person declines what Riposte showed them. Re-run verify voice --from-book')
    }
    const bk = a.book as { head?: unknown; length?: unknown; grant?: unknown } | undefined
    if (!bk) {
      return refused(io, verb, 'the assessment was not read from the book of record (it has no `book` citation): decline a book-read one (verify voice --from-book), so the decline names the grant in force')
    }
    const len = bk.length
    const at = len === 0 ? GENESIS : Number.isInteger(len) && (len as number) > 0 ? events[(len as number) - 1]?.entry_hash : undefined
    if (typeof bk.head !== 'string' || at !== bk.head) {
      return refused(io, verb, `the assessment was read from another book: its head ${String(bk.head).slice(0, 12)}… is not event ${String(len)} of ${inp.ledgerPath}`)
    }
    if (!a.proposal) return refused(io, verb, 'there is no proposal on this assessment to decline')
    if (a.policy?.hash !== hashOf(policy)) {
      return refused(io, verb, `the assessment was made under ${a.policy?.policy_id}@${a.policy?.version}, and --policy is ${String(policy?.policy_id)}@${String(policy?.version)}: decline under the policy the book was read with`)
    }
    if (events.length > (len as number)) {
      io.err(`verify decline: note: the book has moved on by ${events.length - (len as number)} event(s) since this assessment; the book is read again, and only the proposal it raises now can be declined\n`)
    }
    workflow_id = a.workflow_id
    proposal_id = a.proposal.proposal_id
    // With nothing granted the tier is the one the person read at; a grant in force names its own.
    if (tier === undefined && !bk.grant) tier = a.consequence_tier
  }
  // The book, read the way the door will read it (the ledger's own anchors), re-derives the proposal; only the live one is declined.
  const read = verifiedSeed(inp.ledgerPath, inp)
  if ('error' in read) return inputError(io, verb, read.error, 'error reading ledger')
  if ('broken' in read) return refused(io, verb, `${read.broken}: a decision is never appended to a book that does not verify`)
  const signed_at = f.v['signed-at'] ?? new Date().toISOString()
  let d
  try {
    d = declineOnBook(new MemoryLedger({ ...anchorOpts(inp), seed: read.seed }), workflow_id, policy, proposal_id,
      { signer_id: inp.signer, signed_at, reason: f.v.reason as string, ...(f.v.note !== undefined ? { note: f.v.note } : {}) },
      { ...anchorOpts(inp), ...(tier !== undefined ? { consequence_tier: tier } : {}) })
  } catch (e) { return refused(io, verb, (e as Error).message) } // no open proposal; another proposal is live now; the tier disagrees
  // The person read the proposal under one grant; if a person has since replaced it, the "no" was about another question.
  const sawGrant = (a?.book as { grant?: { decision_id?: unknown } } | undefined)?.grant?.decision_id
  if (a && sawGrant !== d.under_grant) {
    return refused(io, verb, `a decline answers a proposal made under the grant in force: the assessment was read under ${sawGrant ? `GRANT ${String(sawGrant).slice(0, 12)}…` : 'no grant'}, and the grant in force is now ${d.under_grant ? `GRANT ${d.under_grant.slice(0, 12)}…` : 'none'}. Read the book again (verify voice --from-book) and decide on what it shows now`)
  }
  let signed: SignedDecision
  try { signed = signDecision(d, inp.keyPem) } catch (e) { return refusedOr3(io, verb, e, 'error reading key') }
  const code = appendDecision(verb, io, inp, signed)
  if (code === 0) sayDecline(io, verb, inp, workflow_id, policy, tier)
  return code
}

/**
 * D-DECLINED-COPY, in the CLI's words: after a decline is appended, read the book once more and say what now stands.
 *   a kept demotion:     "Kept at <rung> by <person>, <signed_at>; stands until <what would re-raise it>"
 *   a declined promotion: "Not now: <person>, <signed_at>; re-raises when <what would re-raise it>"
 */
function sayDecline(io: CliIO, verb: string, a: Anchors & { ledgerPath: string }, workflow_id: string, policy: PromotionPolicy, tier: string | undefined): void {
  try {
    const book = new MemoryLedger({ ...anchorOpts(a), seed: readBookFile(a.ledgerPath) })
    const after = assessVoiceFromLedger(book, workflow_id, policy, { ...anchorOpts(a), ...(tier !== undefined ? { consequence_tier: tier } : {}) })
    const s = declineWords(after)
    if (s) io.err(`verify ${verb}: ${s}\n`)
  } catch { /* the words are a courtesy; the decline is on the book either way */ }
}

/** D-ANCHOR: the decisions on the book that have no effect (an unanchored signer), each with the library's own notice. */
function noEffect(a: VoiceAssessment): string[] {
  const list = (a.book as { no_effect?: { notice?: unknown }[] } | undefined)?.no_effect ?? []
  return list.map(x => x.notice).filter((n): n is string => typeof n === 'string')
}

/** The standing decline (or the lapsed one) on a book-read assessment, in Riposte's own words (D-DECLINED-COPY). */
function declineWords(a: VoiceAssessment): string | undefined {
  const d: StandingDecline | undefined = a.book?.declined
  if (d) {
    return d.proposal_kind === 'DEMOTION_PROPOSAL'
      ? `Kept at ${a.granted} by ${d.signer_id}, ${d.signed_at}; stands until ${d.re_raise_when}`
      : `Not now: ${d.signer_id}, ${d.signed_at}; re-raises when ${d.re_raise_when}`
  }
  const l: DeclineCitation | undefined = a.book?.decline_lapsed
  if (l) return `Asked again: ${l.signer_id} declined this at ${l.signed_at} ("${l.reason}"), and that no longer stands: ${l.why}`
  return undefined
}

/**
 * `verify revise-policy`: append a person's policy revision as a signed POLICY_REVISION. Two forms:
 *   --from <prior.json> --draft <next.json> --reason <text> [--signed-at <iso>] [--out <policy-next.json>]
 *       Riposte builds the revision itself (revisePolicy: who, when, why, what changed, the superseded hash), so a person
 *       never hand-builds the revised body. The signer is the reviser; --out writes the revised policy (never overwrites).
 *   --revised <policy.json>   a revision already built with revisePolicy (its revised_by must be the signer).
 */
function runRevisePolicy(argv: string[], io: CliIO): number {
  const verb = 'revise-policy'
  const f = parseFlags(argv, REVISE_FLAGS)
  if (f.help) { return printHelp(io, 'revise-policy') }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  const drafting = DRAFT_ONLY.filter(n => f.v[n] !== undefined)
  if (f.v.revised === undefined && (f.v.from !== undefined || f.v.draft !== undefined)) return runReviseDraft(f, io)
  if (f.v.revised === undefined) {
    const missing = need(f, ['ledger', 'key', 'signer'])
    return usageError(io, verb, `needs --revised <policy.json> (a revision built with revisePolicy), or --from <prior.json> --draft <next.json> --reason <text> (build it here)${missing.length ? `; and ${missing.join(', ')}` : ''}`)
  }
  if (drafting.length) {
    return usageError(io, verb, `${drafting.map(n => `--${n}`).join(', ')} belong${drafting.length === 1 ? 's' : ''} to the draft form (--from <prior.json> --draft <next.json> --reason <text>); a --revised policy already carries its reason, time and body`)
  }
  const missing = need(f, ['ledger', 'key', 'signer', 'revised'])
  if (missing.length) return usageError(io, verb, `needs ${missing.join(', ')}`)
  let inp: DecisionInputs, revised: unknown
  try {
    inp = readDecisionInputs(f)
    revised = readJson(f.v.revised as string)
  } catch (e) { return inputError(io, verb, e) }
  if (!isObj(revised)) return inputError(io, verb, new Error('--revised must be a promotion policy (the output of revisePolicy)'))
  let d
  try { d = policyRevisionDecision(revised as unknown as PromotionPolicy) } catch (e) { return refused(io, verb, (e as Error).message) }
  if (d.signer_id !== inp.signer) {
    return refused(io, verb, `the revision records revised_by '${d.signer_id}', so --signer '${inp.signer}' cannot sign it: a person signs their own revision`)
  }
  let signed: SignedDecision
  try { signed = signDecision(d, inp.keyPem) } catch (e) { return refusedOr3(io, verb, e, 'error reading key') }
  return appendDecision(verb, io, inp, signed)
}

/**
 * revise-policy's draft form: the prior version (the one in force) and the next one ({ version, method?, tiers? }; a full
 * policy file is fine, and a `revision` inside it is replaced), plus the person's reason. revisePolicy computes what changed
 * and chains the revision to the prior's hash; the signer is the reviser and --signed-at (default now) the time.
 */
function runReviseDraft(f: Flags, io: CliIO): number {
  const verb = 'revise-policy'
  const missing = need(f, ['ledger', 'key', 'signer', 'from', 'draft', 'reason'])
  if (missing.length) return usageError(io, verb, `the draft form needs ${missing.join(', ')}`)
  let inp: DecisionInputs, prior: unknown, draft: unknown
  try {
    inp = readDecisionInputs(f)
    prior = readJson(f.v.from as string)
    draft = readJson(f.v.draft as string)
  } catch (e) { return inputError(io, verb, e) }
  if (!isObj(prior)) return inputError(io, verb, new Error('--from must be the prior promotion policy (the version in force)'))
  if (!isObj(draft)) return inputError(io, verb, new Error('--draft must be the next version: { version, method?, tiers? } (a full policy file is fine)'))
  const priorPolicy = prior as unknown as PromotionPolicy
  const lint = lintPolicy(priorPolicy)
  if (!lint.ok) return refused(io, verb, `the prior policy (--from) does not lint (${lint.errors.join('; ')}): a revision supersedes a declared, valid version`)
  if (draft.policy_id !== undefined && draft.policy_id !== priorPolicy.policy_id) {
    return refused(io, verb, `the draft is policy '${String(draft.policy_id)}', not '${priorPolicy.policy_id}': a revision supersedes a version of the same policy`)
  }
  const out = f.v.out
  if (out !== undefined && existsSync(out)) return refused(io, verb, `${out} already exists: the revised policy is never written over a file (choose another --out)`)
  let revised: PromotionPolicy
  try {
    revised = revisePolicy(priorPolicy, {
      version: draft.version as string,
      ...(draft.method !== undefined ? { method: draft.method as BoundMethod } : {}),
      ...(draft.tiers !== undefined ? { tiers: draft.tiers as TierRequirements[] } : {}),
    }, { revised_by: inp.signer, revised_at: f.v['signed-at'] ?? new Date().toISOString(), reason: f.v.reason as string })
  } catch (e) { return refused(io, verb, (e as Error).message) } // no change, the same version, a draft that does not lint
  let d
  try { d = policyRevisionDecision(revised) } catch (e) { return refused(io, verb, (e as Error).message) } // e.g. a bad --signed-at
  let signed: SignedDecision
  try { signed = signDecision(d, inp.keyPem) } catch (e) { return refusedOr3(io, verb, e, 'error reading key') }
  const code = appendDecision(verb, io, inp, signed)
  if (code !== 0 || out === undefined) return code
  try { writeFileSync(out, `${JSON.stringify(revised, null, 2)}\n`, { flag: 'wx' }) } catch (e) {
    return inputError(io, verb, e, `the revision IS on the book, but the revised policy was not written (its body is appended.signed.decision.policy_body above)`)
  }
  io.err(`verify revise-policy: wrote the revised policy ${revised.policy_id}@${revised.version} to ${out} (use it as --policy for grants under the new version)\n`)
  return 0
}

const custodyWarning = (priv: string, signer: string | undefined): string => [
  'verify keygen: KEY CUSTODY IS YOURS (the operator\'s).',
  `  ${priv} is an Ed25519 PRIVATE key. Whoever holds it can sign grants, declines and policy revisions${signer ? ` as '${signer}'` : ''}: it moves rungs.`,
  '  Riposte keeps no copy and cannot recover it. If it leaks, revoke it on the book (verify key revoke, once the key registry anchors signers).',
  '  Keep it out of every agent\'s reach: an agent that can read this file can sign as you, and "only a person moves a rung" then rests on nothing.',
  '  Back it up offline. Mode 0600 is requested; Windows ignores it, so restrict the file\'s ACL yourself.',
  '  A signature proves the KEY HOLDER decided, not which person: anchor the public key to the person with --trusted-keys.',
  '',
].join('\n')

/** `verify keygen`: an Ed25519 keypair for local signing (the primitive the verdict envelope uses). Never overwrites. */
function runKeygen(argv: string[], io: CliIO): number {
  const verb = 'keygen'
  const f = parseFlags(argv, KEYGEN_FLAGS)
  if (f.help) { return printHelp(io, 'keygen') }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  if (f.v.out === undefined) return usageError(io, verb, 'needs --out <person.pem>')
  const out = f.v.out
  const pub = /\.pem$/i.test(out) ? `${out.slice(0, -4)}.pub.pem` : `${out}.pub.pem`
  const taken = [out, pub].filter(p => existsSync(p))
  if (taken.length) {
    return refused(io, verb, `${taken.join(' and ')} already exist${taken.length === 1 ? 's' : ''}: a key is never overwritten (the old private key would be lost for good). Choose another --out`)
  }
  const kp = generateSigningKeypair()
  try {
    writeFileSync(out, kp.privateKeyPem, { flag: 'wx', mode: 0o600 })
    writeFileSync(pub, kp.publicKeyPem, { flag: 'wx' })
  } catch (e) { return inputError(io, verb, e, 'error writing key') }
  const signer = f.v.signer
  io.err(custodyWarning(out, signer))
  io.out(`${JSON.stringify({
    alg: 'ed25519', private_key_path: out, public_key_path: pub, public_key: kp.publicKeyPem,
    ...(signer !== undefined ? { signer_id: signer, trusted_keys: { [signer]: kp.publicKeyPem } } : {}),
  }, null, 2)}\n`)
  return 0
}

/** A declarations file: [{ workflow_id, consequence_tier, granted?, bounds?, grant? }] or { declarations: [...] }. */
function readDeclarations(path: string): Record<string, unknown>[] {
  const raw = readJson(path) as unknown
  const arr = Array.isArray(raw) ? raw : isObj(raw) ? raw.declarations : undefined
  if (!Array.isArray(arr)) throw new Error('declarations must be an array of { workflow_id, consequence_tier, granted?, bounds?, grant? } (or { "declarations": [...] })')
  for (const d of arr) {
    if (!isObj(d)) throw new Error('each declaration must be an object { workflow_id, consequence_tier, ... }')
    declarationFromJson(d) // the surfaces' own validation (the same rules MCP and HTTP apply)
  }
  return arr as Record<string, unknown>[]
}

/** `verify report`: the tenant book-of-record report (renderTenantReport), the day-1 audit report. Wiring only. */
function runReport(argv: string[], io: CliIO): number {
  const verb = 'report'
  const f = parseFlags(argv, REPORT_FLAGS)
  if (f.help) { return printHelp(io, 'report') }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  if (f.v.ledger === undefined) return usageError(io, verb, 'needs --ledger <chain.jsonl>')
  let period: ReturnType<typeof monthPeriod> | undefined
  if (f.v.month !== undefined) {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(f.v.month)
    if (!m) return usageError(io, verb, `--month must be YYYY-MM (got "${f.v.month}")`)
    period = monthPeriod(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)))
  }
  let ledger: Ledger, policy: PromotionPolicy | undefined, declared: Record<string, unknown>[]
  try {
    ledger = openBookReadOnly(f.v.ledger, readAnchors(f), io, verb)
    policy = f.v.policy !== undefined ? (readJson(f.v.policy) as unknown as PromotionPolicy) : undefined
    declared = f.v.declarations !== undefined ? readDeclarations(f.v.declarations) : []
  } catch (e) { return inputError(io, verb, e) }
  // BOOK FIRST: the report reads each workflow's rung from the GRANT in force on the book (report.ts readRung); the
  // declarations cover only workflows with no GRANT (books that predate signed grants) and never override one.
  const book = ledger.decisionBook()
  if (book.ok) {
    for (const o of declarationsOverridden(book.decisions, declared as { workflow_id: string }[])) {
      io.err(`verify report: note: the declaration for ${o.workflow_id} (${o.declared.granted ?? '-'}, tier ${o.declared.consequence_tier ?? '-'}) disagrees with the GRANT in force on the book (${o.grant.level}, tier ${o.grant.consequence_tier}); the book governs: a declaration never overrides a person's signed grant\n`)
    }
  }
  const opts: TenantReportOptions = {
    ...(f.v.tenant !== undefined ? { tenant_id: f.v.tenant } : {}),
    ...(f.v['as-of'] !== undefined ? { as_of: f.v['as-of'] } : {}),
    ...(period ? { period } : {}),
    voice: { ...(policy ? { policy } : {}), book: ledger, declarations: declared.map(d => declarationFromJson(d)) },
  }
  io.out(renderTenantReport(ledger, opts))
  return book.ok ? 0 : 1
}

// ── precedent → statute: a person's signed ruling on LAW, and the rulebook the rulings imply ────────────────────

const RULE_FLAGS: FlagSpec = {
  ledger: 'value', dispute: 'value', claim: 'value', ruling: 'value', reason: 'value', key: 'value', signer: 'value', tenant: 'value',
  note: 'value', 'signed-at': 'value', inputs: 'value', ...ANCHOR_FLAGS,
}

/**
 * `verify rule`: a person's signed ruling on LAW over a dispute opinion (opinion/ruling.ts). The opinion is re-derived from
 * the book here (disputeOpinion), and only a VERIFIED one proposing UPHOLD or REFER on a DETERMINISTIC PASS/FAIL finding can
 * be ruled on. Prints the signed ruling as ONE JSON line, for the ruling book: `verify rule … >> rulings.jsonl`.
 * Exit 0 · 1 REFUSED (a withheld opinion, an abstention, a key the trusted keys do not anchor) · 3 usage/input.
 */
function runRule(argv: string[], io: CliIO): number {
  const verb = 'rule'
  const f = parseFlags(argv, RULE_FLAGS)
  if (f.help) { return printHelp(io, 'rule') }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  const missing = need(f, ['ledger', 'dispute', 'ruling', 'reason', 'key', 'signer'])
  if (missing.length) return usageError(io, verb, `needs ${missing.join(', ')}`)
  const ruling = f.v.ruling as LawRuling
  if (!LAW_RULINGS.includes(ruling)) return usageError(io, verb, `--ruling must be one of ${LAW_RULINGS.join(', ')} (got "${f.v.ruling}")`)
  let snap: LedgerSnapshot, keyPem: string, anchors: Anchors, inputs: unknown
  try {
    snap = readSnapshot(f.v.ledger as string, io, verb)
    keyPem = readText(f.v.key as string)
    anchors = readAnchors(f)
    inputs = f.v.inputs !== undefined ? readJson(f.v.inputs) : undefined
  } catch (e) { return inputError(io, verb, e) }
  let op: Opinion
  try {
    op = disputeOpinion({
      snapshot: snap, verdict_id: f.v.dispute as string, ...(f.v.claim !== undefined ? { claim_id: f.v.claim } : {}),
      ...(inputs !== undefined ? { inputs } : {}), ...(f.v.tenant !== undefined ? { scope: { tenant_id: f.v.tenant } } : {}),
      ...anchorOpts(anchors),
    })
  } catch (e) { return refused(io, verb, (e as Error).message) } // e.g. the verdict is not on (this tenant's) book
  let signed
  try {
    const r = disputeRuling(op, { ruling, reason: f.v.reason as string, signer_id: f.v.signer as string, signed_at: f.v['signed-at'] ?? new Date().toISOString(), ...(f.v.note !== undefined ? { note: f.v.note } : {}) })
    signed = signRuling(r, keyPem)
  } catch (e) { return refused(io, verb, (e as Error).message) } // a withheld opinion, an abstention, a judgement-tier finding, not an Ed25519 key
  if (anchors.trusted) {
    const chk = verifySignedRuling(signed, { trusted_keys: anchors.trusted })
    if (!chk.ok || !chk.anchored) return refused(io, verb, `the signing key is not the one anchored to signer '${signed.ruling.signer_id}' (${chk.reason ?? 'not anchored'}): a ruling names the person who made it`)
  }
  io.out(`${JSON.stringify(signed)}\n`)
  io.err(`verify rule: ${signed.ruling.signer_id} ruled ${ruling} on ${signed.ruling.claim_id} of verdict ${signed.ruling.verdict_id} (opinion ${signed.ruling.opinion_id.slice(0, 12)}…, book of ${signed.ruling.book.length} event(s)). Append this line to the ruling book: verify rule … >> rulings.jsonl\n`)
  if (!anchors.trusted) io.err(`verify rule: note: no --trusted-keys, so signer '${signed.ruling.signer_id}' is UNANCHORED: the signature proves the key holder ruled, not which person\n`)
  return 0
}

const STATUTE_FLAGS: FlagSpec = {
  ledger: 'value', rulings: 'value', rule: 'value', domain: 'value', outcome: 'value', tenant: 'value', 'rows-out': 'value', 'schema-out': 'value',
  inputs: 'value', ...ANCHOR_FLAGS,
}

/**
 * `verify statute`: the customer's own rulebook, from people's signed rulings (opinion/statute.ts). Every ruling is re-verified
 * against the book (signature, anchoring, the book it names is a prefix, the opinion re-derives); the rows go to the miner,
 * and each candle comes back as COUNSEL, never a VERDICT: a person adopts a rule by writing it into a ruleset.
 * --rows-out / --schema-out write the case table for `verify mine <rows.jsonl> --schema <schema.json> --thresholds` (never
 * over a file). Exit 0 · 1 the book did not verify · 3 usage/input.
 */
function runStatute(argv: string[], io: CliIO): number {
  const verb = 'statute'
  const f = parseFlags(argv, STATUTE_FLAGS)
  if (f.help) { return printHelp(io, 'statute') }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  const missing = need(f, ['ledger', 'rulings', 'rule', 'domain'])
  if (missing.length) return usageError(io, verb, `needs ${missing.join(', ')}`)
  const outcome = f.v.outcome
  if (outcome !== undefined && outcome !== 'FAIL' && outcome !== 'PASS') return usageError(io, verb, `--outcome must be FAIL or PASS (got "${outcome}")`)
  if ((f.v['rows-out'] === undefined) !== (f.v['schema-out'] === undefined)) return usageError(io, verb, '--rows-out and --schema-out go together (verify mine reads both)')
  const outs = [f.v['rows-out'], f.v['schema-out']].filter((p): p is string => p !== undefined)
  const taken = outs.filter(p => existsSync(p))
  if (taken.length) return refused(io, verb, `${taken.join(' and ')} already exist${taken.length === 1 ? 's' : ''}: the case table is never written over a file`)
  let snap: LedgerSnapshot, rulings: ReturnType<typeof parseRulingBook>, anchors: Anchors, inputs: unknown
  try {
    snap = readSnapshot(f.v.ledger as string, io, verb)
    rulings = parseRulingBook(readText(f.v.rulings as string))
    anchors = readAnchors(f)
    inputs = f.v.inputs !== undefined ? readJson(f.v.inputs) : undefined
    if (inputs !== undefined && !isObj(inputs)) throw new Error('--inputs must be an object of the original inputs by verdict id ({ "<verdict_id>": <inputs> })')
  } catch (e) { return inputError(io, verb, e) }
  let statute, counsel
  try {
    statute = statuteFromRulings({
      snapshot: snap, rulings, rule_id: f.v.rule as string, domain: f.v.domain as string, ...(outcome ? { outcome } : {}),
      ...(f.v.tenant !== undefined ? { scope: { tenant_id: f.v.tenant } } : {}), ...anchorOpts(anchors),
      ...(inputs !== undefined ? { inputs: inputs as Record<string, unknown> } : {}),
    })
  } catch (e) { return refused(io, verb, (e as Error).message) } // a book that does not verify reads no statute
  try { counsel = statuteCounsel(statute) } catch (e) { return inputError(io, verb, e, 'error mining the statute') }
  if (outs.length) {
    const files = statuteMineFiles(statute)
    try {
      writeFileSync(f.v['rows-out'] as string, `${files.cases}\n`, { flag: 'wx' })
      writeFileSync(f.v['schema-out'] as string, `${files.schema}\n`, { flag: 'wx' })
    } catch (e) { return inputError(io, verb, e, 'error writing the case table') }
  }
  io.out(`${JSON.stringify({ statute, counsel: counsel.counsel, report: counsel.report }, null, 2)}\n`)
  io.err(`verify statute: ${statute.rows.length} ruling row(s) on ${statute.rule_id} (${statute.outcome}) · ${statute.excluded.length} excluded · ${statute.superseded.length} superseded → ${counsel.counsel.length} statute candidate(s), each COUNSEL (dismissible; a person adopts a rule by writing it into a ruleset)\n`)
  return 0
}

// ── evidence integrity: the draw, the queue, signed reviews, the key registry, canaries, the policy lint ────────────────

/** A library "no" (plain Error included) as a refusal: the input was read; the library declined it. */
function asRefusal<T>(fn: () => T): T {
  try { return fn() } catch (e) {
    if (e instanceof DecisionRefused || e instanceof SampleRefused) throw e
    throw new DecisionRefused((e as Error).message)
  }
}

const SAMPLE_FLAGS: FlagSpec = { ledger: 'value', policy: 'value', workflow: 'value', tier: 'value', ...ANCHOR_FLAGS }

/**
 * `verify sample commit`: the scheduled step (run it daily). Commits every closed period's random review draw that is due
 * (commitDueSamples; the seed is the chain itself, so nobody chooses the sample). Exit 0 committed (or nothing due) ·
 * 1 REFUSED (the book does not verify; the door refused a draw; the tier or policy is not the grant's) · 3 usage/input.
 */
function runSample(argv: string[], io: CliIO): number {
  const verb = 'sample commit'
  const [sub, ...rest] = argv
  if (sub === '-h' || sub === '--help') { return printHelp(io, 'sample') }
  if (sub !== 'commit') return usageError(io, 'sample', `the verb is \`verify sample commit\` (got ${sub === undefined ? 'nothing' : `"${sub}"`})`)
  const f = parseFlags(rest, SAMPLE_FLAGS)
  if (f.help) { return printHelp(io, 'sample') }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  const missing = need(f, ['ledger', 'policy', 'workflow'])
  if (missing.length) return usageError(io, verb, `needs ${missing.join(', ')}`)
  let path: string, policy: PromotionPolicy, anchors: Anchors
  try {
    path = existingBook(f.v.ledger as string)
    policy = readJson(f.v.policy as string) as unknown as PromotionPolicy
    anchors = readAnchors(f)
  } catch (e) { return inputError(io, verb, e) }
  const wf = f.v.workflow as string
  const r = appendTwice(verb, io, path, anchors, l => {
    const committed = asRefusal(() => commitDueSamples(l, wf, policy, f.v.tier !== undefined ? { consequence_tier: f.v.tier } : {}))
    return { committed, head: l.chainHead(), length: l.events().length }
  })
  if ('code' in r) return r.code
  io.out(`${JSON.stringify({ workflow_id: wf, committed: r.value.committed, count: r.value.committed.length, chain: { length: r.value.length, head: r.value.head } }, null, 2)}\n`)
  io.err(`verify sample commit: ${r.value.committed.length ? `${r.value.committed.length} period draw(s) committed; the review queue is \`verify queue\`` : 'nothing due: every closed period with work to draw is already committed'}\n`)
  return 0
}

const QUEUE_FLAGS: FlagSpec = { ledger: 'value', policy: 'value', workflow: 'value', tier: 'value', ...ANCHOR_FLAGS }

/** `verify queue`: a reviewer's queue (reviewQueue): every drawn, still-unreviewed item, oldest first, with its deadline. Read-only. */
function runQueue(argv: string[], io: CliIO): number {
  const verb = 'queue'
  const f = parseFlags(argv, QUEUE_FLAGS)
  if (f.help) { return printHelp(io, 'queue') }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  const missing = need(f, ['ledger', 'policy', 'workflow'])
  if (missing.length) return usageError(io, verb, `needs ${missing.join(', ')}`)
  let ledger: Ledger, policy: PromotionPolicy
  try {
    ledger = openBookReadOnly(f.v.ledger as string, readAnchors(f), io, verb)
    policy = readJson(f.v.policy as string) as unknown as PromotionPolicy
  } catch (e) { return inputError(io, verb, e) }
  const check = ledger.verifyContent()
  if (!check.ok) return refused(io, verb, `the book of record does not verify${check.brokenAt !== undefined ? ` at event ${check.brokenAt}` : ''} (${check.reason ?? 'unknown'}): no queue is read from it`)
  let items
  try { items = reviewQueue(ledger, f.v.workflow as string, policy, f.v.tier !== undefined ? { consequence_tier: f.v.tier } : {}) } catch (e) { return refused(io, verb, (e as Error).message) }
  io.out(`${JSON.stringify({ workflow_id: f.v.workflow, items, count: items.length, chain: { length: check.length, head: check.head } }, null, 2)}\n`)
  return 0
}

const REVIEW_FLAGS: FlagSpec = {
  sign: 'bool', ledger: 'value', key: 'value', signer: 'value', verdict: 'value', decision: 'value', procedure: 'value', tenant: 'value',
  note: 'value', 'signed-at': 'value', ...ANCHOR_FLAGS,
}
const REVIEW_DECISIONS = ['UPHELD', 'OVERTURNED'] as const
const PROCEDURES = ['re-performed', 'inspected'] as const

/**
 * `verify review --sign`: a person's review of a recorded verdict as a SIGNED decision (makeReview + reviewSigned), so an
 * agent can manufacture neither a clean record nor a slap. The CLI writes only signed reviews. Exit 0 · 1 REFUSED · 3.
 */
function runReview(argv: string[], io: CliIO): number {
  const verb = 'review'
  const f = parseFlags(argv, REVIEW_FLAGS)
  if (f.help) { return printHelp(io, 'review') }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  if (!f.on.has('sign')) return usageError(io, verb, 'a review is written as a person\'s SIGNED decision: pass --sign (with --key and --signer). The CLI writes no unsigned review')
  const missing = need(f, ['ledger', 'key', 'signer', 'verdict', 'decision'])
  if (missing.length) return usageError(io, verb, `needs ${missing.join(', ')}`)
  const decision = f.v.decision as (typeof REVIEW_DECISIONS)[number]
  if (!REVIEW_DECISIONS.includes(decision)) return usageError(io, verb, `--decision must be ${REVIEW_DECISIONS.join(' or ')} (got "${f.v.decision}")`)
  const procedure = f.v.procedure as (typeof PROCEDURES)[number] | undefined
  if (procedure !== undefined && !PROCEDURES.includes(procedure)) return usageError(io, verb, `--procedure must be ${PROCEDURES.join(' or ')} (got "${f.v.procedure}")`)
  let inp: DecisionInputs
  try { inp = readDecisionInputs(f) } catch (e) { return inputError(io, verb, e) }
  let signed: SignedDecision<Signable>
  try {
    const body = makeReview({
      verdict_id: f.v.verdict as string, decision, ...(f.v.tenant !== undefined ? { tenant_id: f.v.tenant } : {}), ...(procedure ? { procedure } : {}),
      ...(f.v.note !== undefined ? { note: f.v.note } : {}), signer_id: inp.signer, signed_at: f.v['signed-at'] ?? new Date().toISOString(),
    })
    signed = signDecision(body, inp.keyPem)
  } catch (e) { return refusedOr3(io, verb, e, 'error reading key') }
  const r = appendTwice(verb, io, inp.ledgerPath, inp, l => {
    const rec = l.reviewSigned(signed as Parameters<Ledger['reviewSigned']>[0])
    return { rec, head: l.chainHead(), length: l.events().length }
  })
  if ('code' in r) return r.code
  const { rec, head, length } = r.value
  io.out(`${JSON.stringify({ reviewed: { verdict_id: rec.verdict.verdict_id, tenant_id: rec.tenant_id, review: rec.review }, anchored: isAnchoredRead(inp), chain: { length, head } }, null, 2)}\n`)
  unanchoredNote(io, verb, inp, inp.signer)
  return 0
}

const KEY_FLAGS: FlagSpec = {
  ledger: 'value', root: 'value', key: 'value', signer: 'value', 'root-keys': 'value', subject: 'value', 'public-key': 'value',
  roles: 'value', tenants: 'value', reason: 'value', note: 'value', 'signed-at': 'value',
}

/** A public key from a file: an SPKI PEM, or verify keygen's output ({ public_key }). */
function readPublicKey(path: string): string {
  const text = readText(path)
  if (/PRIVATE KEY-----/.test(text)) throw new Error(`${path} holds a PRIVATE key: register the PUBLIC key (the .pub.pem verify keygen wrote)`)
  const t = text.trim()
  const pem = t.startsWith('{') ? (parseJsonStrict(t, path) as { public_key?: unknown }).public_key : (t.match(PEM_PUBLIC) ?? [])[0]
  if (typeof pem !== 'string' || keyFingerprint(pem) === undefined) throw new Error(`${path} holds no Ed25519 public key (SPKI PEM)`)
  return `${pem.trim()}\n`
}

const list = (s: string): string[] => s.split(',').map(x => x.trim()).filter(Boolean)

/**
 * `verify key register|revoke`: the key registry on the book (KEY_REGISTER / KEY_REVOKE). Signed by the registry ROOT
 * (--root <root.pem>: its private key; the root's public key anchors the door) or by a registered key_admin (--key <pem>
 * --signer <id> --root-keys <root.pub.pem>). Readers anchor with --root-keys: the root is the one thing that comes from
 * outside the book. Exit 0 appended · 1 REFUSED · 3 usage/input.
 */
function runKey(argv: string[], io: CliIO): number {
  const [sub, ...rest] = argv
  if (sub === '-h' || sub === '--help') { return printHelp(io, 'key') }
  if (sub !== 'register' && sub !== 'revoke') return usageError(io, 'key', `the verbs are \`verify key register\` and \`verify key revoke\` (got ${sub === undefined ? 'nothing' : `"${sub}"`})`)
  const verb = `key ${sub}`
  const f = parseFlags(rest, KEY_FLAGS)
  if (f.help) { return printHelp(io, 'key') }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  const missing = need(f, ['ledger', 'subject', 'public-key', ...(sub === 'revoke' ? ['reason'] : ['roles'])])
  if (missing.length) return usageError(io, verb, `needs ${missing.join(', ')}`)
  if ((f.v.root === undefined) === (f.v.key === undefined)) return usageError(io, verb, 'sign with the registry root (--root <root.pem>) or a registered key_admin\'s key (--key <pem> --signer <id> --root-keys <root.pub.pem>): exactly one')
  if (f.v.key !== undefined && (f.v.signer === undefined || f.v['root-keys'] === undefined)) return usageError(io, verb, 'a registered key_admin signs as --signer <id>, on a book anchored by --root-keys <root.pub.pem>')
  if (sub === 'revoke' && (f.v.roles !== undefined || f.v.tenants !== undefined)) return usageError(io, verb, '--roles / --tenants belong to key register')
  if (sub === 'register' && f.v.reason !== undefined) return usageError(io, verb, '--reason belongs to key revoke')
  let roles: Role[] = []
  if (sub === 'register') {
    const bad = list(f.v.roles as string).filter(r => !isRole(r))
    if (bad.length || !list(f.v.roles as string).length) return usageError(io, verb, `--roles is a comma list of ${ROLES.join(', ')} (got "${f.v.roles}")`)
    roles = list(f.v.roles as string) as Role[]
  }
  let ledgerPath: string, keyPem: string, root: RootKeys, subjectKey: string
  try {
    ledgerPath = existingBook(f.v.ledger as string)
    keyPem = readText((f.v.root ?? f.v.key) as string)
    subjectKey = readPublicKey(f.v['public-key'] as string)
    const given = f.v['root-keys'] !== undefined ? readRootKeys(f.v['root-keys']) : undefined
    if (f.v.root !== undefined) {
      const derived = createPublicKey(createPrivateKey(keyPem)).export({ type: 'spki', format: 'pem' }).toString()
      const fp = keyFingerprint(derived)
      if (fp === undefined) throw new Error('--root must be an Ed25519 private key (verify keygen)')
      if (given && !given.some(k => keyFingerprint(k) === fp)) return refused(io, verb, 'the --root key is not one of --root-keys: the root that signs is the root the book is anchored to')
      root = given ?? [derived]
    } else root = given as RootKeys
  } catch (e) { return inputError(io, verb, e) }
  const signer = f.v.signer ?? 'root'
  let signed: SignedDecision<BookDecision>
  try {
    const common = { subject_id: f.v.subject as string, public_key: subjectKey, signer_id: signer, signed_at: f.v['signed-at'] ?? new Date().toISOString(), ...(f.v.note !== undefined ? { note: f.v.note } : {}) }
    const d = sub === 'register'
      ? makeKeyRegister({ ...common, roles, ...(f.v.tenants !== undefined ? { tenants: list(f.v.tenants) } : {}) })
      : makeKeyRevoke({ ...common, reason: f.v.reason as string })
    signed = signDecision<BookDecision>(d, keyPem)
  } catch (e) { return refusedOr3(io, verb, e, 'error reading key') }
  const code = appendDecision(verb, io, { ledgerPath, keyPem, signer, root }, signed)
  if (code === 0 && f.v.root !== undefined && f.v['root-keys'] === undefined) {
    io.err(`verify ${verb}: note: the root was taken from --root itself. Every reader must anchor with --root-keys <root.pub.pem> (the root's PUBLIC key, held out of band): a book read without it anchors no one\n`)
  }
  return code
}

const CANARY_FLAGS: FlagSpec = {
  ledger: 'value', key: 'value', signer: 'value', workflow: 'value', verdicts: 'value', 'secret-out': 'value', secret: 'value', seal: 'value',
  note: 'value', 'signed-at': 'value', ...ANCHOR_FLAGS,
}

/** --verdicts: a comma list of verdict ids, or a JSON file holding an array of them. */
function readIds(v: string): string[] {
  const ids = /\.json$/i.test(v) && existsSync(v) ? (readJson(v) as unknown) : list(v)
  if (!Array.isArray(ids) || !ids.length || !ids.every(x => typeof x === 'string')) throw new Error('--verdicts is a comma list of verdict ids, or a JSON file holding an array of them')
  return [...new Set(ids as string[])].sort()
}

/**
 * `verify canary seal|reveal`: reviewer attention, measured without telling the reviewer (surveillance/canary.ts).
 *   seal    a policy_author commits to known-bad recorded verdicts; the book carries only a salted commitment. The ids and
 *           the salt go to --secret-out (never overwritten, mode 0600): keep it from every reviewer and agent.
 *   reveal  after the review cycle, the sealer opens the seal with that secret; the book checks it reproduces the commitment.
 * Exit 0 appended · 1 REFUSED · 3 usage/input.
 */
function runCanary(argv: string[], io: CliIO): number {
  const [sub, ...rest] = argv
  if (sub === '-h' || sub === '--help') { return printHelp(io, 'canary') }
  if (sub !== 'seal' && sub !== 'reveal') return usageError(io, 'canary', `the verbs are \`verify canary seal\` and \`verify canary reveal\` (got ${sub === undefined ? 'nothing' : `"${sub}"`})`)
  const verb = `canary ${sub}`
  const f = parseFlags(rest, CANARY_FLAGS)
  if (f.help) { return printHelp(io, 'canary') }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  const missing = need(f, ['ledger', 'key', 'signer', ...(sub === 'seal' ? ['workflow', 'verdicts', 'secret-out'] : ['secret'])])
  if (missing.length) return usageError(io, verb, `needs ${missing.join(', ')}`)
  const foreign = sub === 'seal' ? ['secret', 'seal'].filter(n => f.v[n] !== undefined) : ['workflow', 'verdicts', 'secret-out'].filter(n => f.v[n] !== undefined)
  if (foreign.length) return usageError(io, verb, `${foreign.map(n => `--${n}`).join(', ')} belong${foreign.length === 1 ? 's' : ''} to canary ${sub === 'seal' ? 'reveal' : 'seal'}`)
  let inp: DecisionInputs
  try { inp = readDecisionInputs(f) } catch (e) { return inputError(io, verb, e) }
  const signed_at = f.v['signed-at'] ?? new Date().toISOString()
  const note = f.v.note !== undefined ? { note: f.v.note } : {}

  if (sub === 'seal') {
    const out = f.v['secret-out'] as string
    if (existsSync(out)) return refused(io, verb, `${out} already exists: a canary secret is never written over a file (the old seal could never be revealed)`)
    let ids: string[]
    try { ids = readIds(f.v.verdicts as string) } catch (e) { return inputError(io, verb, e) }
    const salt = newSalt()
    const wf = f.v.workflow as string
    let signed: SignedDecision<BookDecision>
    try {
      signed = signDecision<BookDecision>(sealCanaries({ workflow_id: wf, verdict_ids: ids, salt, signer_id: inp.signer, signed_at, ...note }), inp.keyPem)
    } catch (e) { return refusedOr3(io, verb, e, 'error reading key') }
    const secret = { canary_secret_version: 'canary-secret-v0', workflow_id: wf, verdict_ids: ids, salt, commitment: canaryCommitment(wf, ids, salt), sealed_by: inp.signer, signed_at }
    try { writeFileSync(out, `${JSON.stringify(secret, null, 2)}\n`, { flag: 'wx', mode: 0o600 }) } catch (e) { return inputError(io, verb, e, 'error writing the canary secret (nothing was sealed)') }
    const code = appendDecision(verb, io, inp, signed)
    if (code !== 0) { rmSync(out, { force: true }); return code } // nothing sealed: the secret goes with it
    io.err(`verify canary seal: the ids and salt are in ${out}. KEEP IT SECRET until the reveal: whoever reads it can tell which items are canaries. Windows ignores mode 0600; restrict the file's ACL yourself. Reveal with: verify canary reveal --secret ${out}\n`)
    return 0
  }

  let secret: { workflow_id?: unknown; verdict_ids?: unknown; salt?: unknown }
  try { secret = readJson(f.v.secret as string) as typeof secret } catch (e) { return inputError(io, verb, e) }
  if (!isObj(secret) || typeof secret.workflow_id !== 'string' || typeof secret.salt !== 'string' || !Array.isArray(secret.verdict_ids)) {
    return inputError(io, verb, new Error('--secret must be the file verify canary seal wrote ({ workflow_id, verdict_ids, salt })'))
  }
  const read = verifiedSeed(inp.ledgerPath, inp)
  if ('error' in read) return inputError(io, verb, read.error, 'error reading ledger')
  if ('broken' in read) return refused(io, verb, `${read.broken}: nothing is appended to a book that does not verify`)
  const book = new MemoryLedger({ ...anchorOpts(inp), seed: read.seed }).decisionBook()
  const commitment = canaryCommitment(secret.workflow_id, secret.verdict_ids as string[], secret.salt)
  const seal = book.canaries.find(e => e.signed.decision.kind === 'CANARY_SEAL' && (e.signed.decision as CanarySealDecision).commitment === commitment && (f.v.seal === undefined || e.decision_id === f.v.seal))
  if (!seal) return refused(io, verb, `no CANARY_SEAL on the book matches this secret${f.v.seal !== undefined ? ` and --seal ${f.v.seal}` : ''} (commitment ${commitment.slice(0, 12)}…)`)
  if (seal.signed.decision.signer_id !== inp.signer) return refused(io, verb, `the seal was made by '${seal.signed.decision.signer_id}': only its sealer reveals it`)
  let signed: SignedDecision<BookDecision>
  try {
    const d = revealCanaries(seal as DecisionEntry<CanarySealDecision>, { verdict_ids: secret.verdict_ids as string[], salt: secret.salt, signed_at, ...note })
    signed = signDecision<BookDecision>(d, inp.keyPem)
  } catch (e) { return refusedOr3(io, verb, e, 'error reading key') }
  return appendDecision(verb, io, inp, signed)
}

/** `verify policy lint --policy <policy.json>`: lintPolicy's errors AND warnings (an unreachable bar, sidedness). Exit 0 · 1 errors · 3. */
function runPolicy(argv: string[], io: CliIO): number {
  const [sub, ...rest] = argv
  if (sub === '-h' || sub === '--help') { return printHelp(io, 'policy') }
  if (sub !== 'lint') return usageError(io, 'policy', `the verb is \`verify policy lint\` (got ${sub === undefined ? 'nothing' : `"${sub}"`})`)
  const verb = 'policy lint'
  const f = parseFlags(rest, { policy: 'value' })
  if (f.help) { return printHelp(io, 'policy') }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  if (f.v.policy === undefined) return usageError(io, verb, 'needs --policy <policy.json>')
  let policy: unknown
  try { policy = readJson(f.v.policy) } catch (e) { return inputError(io, verb, e) }
  if (!isObj(policy)) return inputError(io, verb, new Error('--policy must be a promotion policy object'))
  const lint = lintPolicy(policy as unknown as PromotionPolicy)
  io.out(`${JSON.stringify(lint, null, 2)}\n`)
  for (const w of lint.warnings ?? []) io.err(`verify policy lint: warning: ${w}\n`)
  for (const e of lint.errors) io.err(`verify policy lint: error: ${e}\n`)
  return lint.ok ? 0 : 1
}

// ── completeness and the book file (the auditor's first question; a torn tail's repair; a streamed export) ─────────────

const RECONCILE_FLAGS: FlagSpec = {
  ledger: 'value', population: 'value', mapping: 'value', format: 'value', delimiter: 'value', extractions: 'value', tenant: 'value',
  workflow: 'multi', ruleset: 'multi', since: 'value', until: 'value', rungs: 'value', 'include-matched': 'bool', json: 'bool', md: 'bool',
  policy: 'value', ...ANCHOR_FLAGS,
}
const DELIMITER_NAMES: Readonly<Record<string, CsvDelimiter>> = { ',': ',', ';': ';', '|': '|', tab: '\t', '\t': '\t' }

/** The checked extractions: a JSON array ({ "extractions": [...] } too), or JSONL (one per line). */
function readExtractions(path: string): unknown[] {
  const text = readText(path).replace(/^\uFEFF/, '')
  const t = text.trim()
  if (t.startsWith('[') || /^\{\s*"extractions"\s*:/.test(t)) {
    const raw = parseJsonStrict(t, `--extractions ${path}`)
    const arr = Array.isArray(raw) ? raw : isObj(raw) ? raw.extractions : undefined
    if (!Array.isArray(arr)) throw new Error('--extractions must be a JSON array, { "extractions": [...] }, or JSONL (one extraction per line)')
    return arr
  }
  return text.split(/\r?\n/).filter(l => l.trim() !== '').map((l, i) => {
    return parseJsonStrict(l, `--extractions line ${i + 1}`) // 2026-10-05: the hash contract's reader (a repeated key is refused)
  })
}

/** --rungs: inline JSON ({"<workflow>": "gate"}) or a file holding it. */
function readRungs(v: string): Record<string, VoiceLevel> {
  const raw = (v.trim().startsWith('{') ? parseJsonStrict(v, 'the inline JSON') : readJson(v)) as unknown
  if (!isObj(raw)) throw new Error('--rungs must be { "<workflow_id>": "record" | "advise" | "gate" | "autonomy" }')
  for (const [wf, level] of Object.entries(raw)) {
    if (!VOICE_LADDER.includes(level as VoiceLevel)) throw new Error(`--rungs: ${wf} must be one of ${VOICE_LADDER.join(', ')} (got ${JSON.stringify(level)})`)
  }
  return raw as Record<string, VoiceLevel>
}

/** The rows a person must look at, most severe first (a class with none is left out). */
function exceptionWords(r: CompletenessReport): string {
  const c = r.population.by_class
  return (['PAID_DESPITE_HOLD', 'MISMATCHED', 'BYPASSED', 'AMBIGUOUS', 'UNREADABLE', 'CHECKED_AFTER_PAYMENT'] as const)
    .filter(k => c[k] > 0).map(k => `${k} ${c[k]}`).join(', ')
}

/**
 * `verify reconcile`: completeness, the book of record against the customer's payment population (reconcileCompleteness).
 * The population is read as bytes (its sha256 binds the file as it was); the book is read streamed and verified whole by
 * the engine, under the anchors given. Exit 0 clean (every row MATCHED) · 2 exceptions (a person must look: any row not
 * MATCHED; PAID_DESPITE_HOLD, MISMATCHED and BYPASSED are named first) · 1 REFUSED · 3 usage or an unreadable file.
 */
function runReconcile(argv: string[], io: CliIO): number {
  const verb = 'reconcile'
  const f = parseFlags(argv, RECONCILE_FLAGS)
  if (f.help) { return printHelp(io, 'reconcile') }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  const missing = need(f, ['ledger', 'population', 'mapping'])
  if (missing.length) return usageError(io, verb, `needs ${missing.join(', ')}`)
  if (f.on.has('json') && f.on.has('md')) return usageError(io, verb, '--json prints the report, --md its Markdown: one, not both')
  const popPath = f.v.population as string
  const format = f.v.format ?? (/\.csv$/i.test(popPath) ? 'csv' : /\.(jsonl|ndjson)$/i.test(popPath) ? 'jsonl' : undefined)
  if (format !== 'csv' && format !== 'jsonl') {
    return usageError(io, verb, f.v.format !== undefined ? `--format must be csv or jsonl (got "${f.v.format}")` : `--format csv|jsonl: the population's format is declared, never sniffed (${popPath} has no .csv/.jsonl extension)`)
  }
  let delimiter: CsvDelimiter | undefined
  if (f.v.delimiter !== undefined) {
    delimiter = Object.prototype.hasOwnProperty.call(DELIMITER_NAMES, f.v.delimiter) ? DELIMITER_NAMES[f.v.delimiter] : undefined
    if (!delimiter) return usageError(io, verb, `--delimiter must be one of , ; | tab (got "${f.v.delimiter}")`)
    if (format !== 'csv') return usageError(io, verb, '--delimiter is for a csv population')
  }
  let bytes: Buffer, mapping: unknown, extractions: unknown[] | undefined, rungs: Record<string, VoiceLevel> | undefined, anchors: Anchors
  let policy: PromotionPolicy | undefined
  try {
    bytes = readFileSync(popPath)
    mapping = readJson(f.v.mapping as string)
    extractions = f.v.extractions !== undefined ? readExtractions(f.v.extractions) : undefined
    rungs = f.v.rungs !== undefined ? readRungs(f.v.rungs) : undefined
    anchors = readAnchors(f)
    policy = f.v.policy !== undefined ? (readJson(f.v.policy) as unknown as PromotionPolicy) : undefined
  } catch (e) { return inputError(io, verb, e) }
  if (!isObj(mapping)) return inputError(io, verb, new Error('--mapping must be a completeness mapping object (completeness-mapping-v0)'))
  // D-GOVERNING-POLICY: the rung a record was held at is read with the GRANTs the declared policy admits, whatever a grant names.
  if (policy !== undefined) {
    const lint = isObj(policy) && Array.isArray((policy as { tiers?: unknown }).tiers) ? lintPolicy(policy) : undefined
    if (!lint?.ok) return inputError(io, verb, new Error(`--policy must be a promotion policy that lints${lint ? `: ${lint.errors.join('; ')}` : ' ({ policy_id, version, tiers, ... })'}`))
  }
  let book: Seed
  try { book = readBookFile(f.v.ledger as string, { io, verb }) } catch (e) { return inputError(io, verb, e, 'error reading ledger') }
  const workflows = f.multi.workflow
  const rulesets = f.multi.ruleset
  const scope = { ...(f.v.tenant !== undefined ? { tenant_id: f.v.tenant } : {}), ...(workflows ? { workflows } : {}), ...(rulesets ? { rulesets } : {}) }
  const options: CompletenessOptions = {
    ...(Object.keys(scope).length ? { scope } : {}),
    ...(f.v.since !== undefined || f.v.until !== undefined ? { period: { ...(f.v.since !== undefined ? { since: f.v.since } : {}), ...(f.v.until !== undefined ? { until: f.v.until } : {}) } } : {}),
    ...(extractions ? { extractions } : {}),
    ...(rungs ? { rungs } : {}),
    ...(isAnchoredRead(anchors) ? { anchors: anchorOpts(anchors) } : {}),
    ...(f.on.has('include-matched') ? { include_matched: true } : {}),
    ...(policy ? { policy } : {}),
  }
  let report: CompletenessReport
  try {
    report = reconcileCompleteness(readPopulation(bytes, format, delimiter ? { delimiter } : {}), book, mapping as unknown as CompletenessMapping, options)
  } catch (e) {
    if (e instanceof CompletenessRefused || e instanceof PopulationRefused) return refused(io, verb, e.message)
    return inputError(io, verb, e, 'error reconciling')
  }
  io.out(f.on.has('md') ? renderCompletenessReport(report) : `${JSON.stringify(report, null, 2)}\n`)
  const cov = report.coverage
  const rate = cov.rate === null ? 'no rows' : `${Number((cov.rate * 100).toPrecision(4))}% on the book`
  if (report.book.unanchored_grants.length && !isAnchoredRead(anchors)) {
    io.err(`verify ${verb}: note: ${report.book.unanchored_grants.length} GRANT(s) on the book are not anchored and set no rung (D-ANCHOR): pass --trusted-keys or --root-keys to read them as the book's own\n`)
  }
  if (report.book.by_class.ORPHAN > 0) io.err(`verify ${verb}: note: ${report.book.by_class.ORPHAN} verdict(s) in the period have no payment row (ORPHAN): a window into whether the population is complete\n`)
  if (report.clean) {
    io.err(`verify ${verb}: clean: ${report.population.rows} row(s), every one MATCHED (${rate}); report ${report.report_hash.slice(0, 12)}…\n`)
    return 0
  }
  io.err(`verify ${verb}: EXCEPTIONS a person must look at: ${exceptionWords(report)} (${report.population.rows} row(s), ${rate}); report ${report.report_hash.slice(0, 12)}…\n`)
  return 2
}

const LEDGER_FLAGS: FlagSpec = { ledger: 'value', out: 'value' }
const PREVIEW_CHARS = 2000

/** `verify ledger repair|export`: the book FILE itself (the library's repairTornTail and writeChainFile). */
function runLedger(argv: string[], io: CliIO): number {
  const [sub, ...rest] = argv
  if (sub === '-h' || sub === '--help') { return printHelp(io, 'ledger') }
  if (sub !== 'repair' && sub !== 'export') return usageError(io, 'ledger', `the verbs are \`verify ledger repair <book>\` and \`verify ledger export <book> --out <file>\` (got ${sub === undefined ? 'nothing' : `"${sub}"`})`)
  const verb = `ledger ${sub}`
  const f = parseFlags(rest, LEDGER_FLAGS, { positional: 1 })
  if (f.help) { return printHelp(io, 'ledger') }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  if (f.args[0] !== undefined && f.v.ledger !== undefined) return usageError(io, verb, 'name the book once: <book> or --ledger <book>')
  const path = f.args[0] ?? f.v.ledger
  if (path === undefined) return usageError(io, verb, 'needs <book> (the ledger file)')
  if (!existsSync(path)) return inputError(io, verb, new Error(`no ledger at ${path}`))
  return sub === 'repair' ? ledgerRepair(io, verb, path, f) : ledgerExport(io, verb, path, f)
}

/**
 * `verify ledger repair <book>`: repairTornTail. Prints the repair report (exactly what was removed: offset, bytes, sha256,
 * base64) and says it in words, with the removed bytes as JSON-escaped text. A whole book is left alone (exit 0). An
 * unparseable line before the last is corruption: refused, nothing written, not even a backup (exit 1).
 */
function ledgerRepair(io: CliIO, verb: string, path: string, f: Flags): number {
  if (f.v.out !== undefined) return usageError(io, verb, '--out is for verify ledger export')
  let r: RepairReport
  try { r = repairTornTail(path) } catch (e) { return inputError(io, verb, e, 'error repairing ledger') }
  io.out(`${JSON.stringify(r, null, 2)}\n`)
  if (!r.repaired || !r.removed) { io.err(`verify ${verb}: nothing to repair: ${r.note ?? 'the last line is whole'}; the book is untouched\n`); return 0 }
  const text = Buffer.from(r.removed.base64, 'base64').toString('utf8')
  const shown = JSON.stringify(text.length > PREVIEW_CHARS ? text.slice(0, PREVIEW_CHARS) : text)
  io.err(
    `verify ${verb}: REPAIRED: removed ${r.removed.bytes} byte(s) at byte ${r.removed.offset} (line ${r.removed.line}: ${r.removed.reason}), sha256 ${r.removed.sha256}. ` +
    `The book now ends after ${r.last_good_seq !== undefined ? `event seq ${r.last_good_seq}` : 'no whole event'} (${r.events_kept ?? 0} whole event(s) kept). ` +
    `The untouched copy is ${r.backup}; the repair is logged in ${r.log}.\n` +
    `verify ${verb}: removed, as text: ${shown}${text.length > PREVIEW_CHARS ? ` … (${text.length - PREVIEW_CHARS} more character(s); the base64 in the report is exact)` : ''}\n`,
  )
  return 0
}

/**
 * `verify ledger export <book> --out <file>`: the chain export (the bytes chainJSONL() gives, no final newline), streamed
 * through writeChainFile, so a book past the one-string ceiling exports. Never over a file. A torn tail exports its whole
 * events and says so; nothing is verified here.
 */
function ledgerExport(io: CliIO, verb: string, path: string, f: Flags): number {
  const out = f.v.out
  if (out === undefined) return usageError(io, verb, 'needs --out <file> (never an existing file)')
  if (existsSync(out)) return refused(io, verb, `${out} already exists: an export is never written over a file`)
  let book: Seed
  try { book = readBookFile(path, { io, verb }) } catch (e) { return inputError(io, verb, e, 'error reading ledger') }
  let w: { events: number; bytes: number }
  try { w = writeChainFile(book, out) } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return refused(io, verb, `${out} already exists: an export is never written over a file`)
    return inputError(io, verb, e, 'error writing export')
  }
  const last = book.events[book.events.length - 1]
  io.out(`${JSON.stringify({ out, events: w.events, bytes: w.bytes, head: last?.entry_hash ?? GENESIS }, null, 2)}\n`)
  io.err(`verify ${verb}: ${w.events} event(s), ${w.bytes} byte(s) to ${out}: the book's chain export, copied as written and not verified here (verify report --ledger ${out} checks it)\n`)
  return 0
}

const ANCHOR_CHECKPOINT_FLAGS: FlagSpec = { ledger: 'value', key: 'value', signer: 'value', out: 'value', length: 'value', 'book-id': 'value', 'root-keys': 'value' }
const ANCHOR_VERIFY_FLAGS: FlagSpec = { ledger: 'value', witness: 'value', 'book-id': 'value', ...ANCHOR_FLAGS }

/** A witness store: an existing directory (or a path ending in a separator) holds one checkpoint per file; else a witness file. */
const isWitnessDir = (path: string): boolean => /[\\/]$/.test(path) || (existsSync(path) && statSync(path).isDirectory())
const readWitnessStore = (path: string): Checkpoint[] => (isWitnessDir(path) ? readWitnessDir(path) : readWitnessFile(path))

/** CheckpointRefused / WitnessStoreCorrupt (the anchor module said no) are exit 1; anything else reading input is 3. */
const anchorRefusedOr3 = (io: CliIO, verb: string, e: unknown, what: string): number =>
  e instanceof CheckpointRefused || e instanceof WitnessStoreCorrupt ? refused(io, verb, e.message) : inputError(io, verb, e, what)

const short = (hash: string): string => `${hash.slice(0, 12)}…`
/** The library's reason for a failed checkpoint, plus where the change lies when the reason does not already say. */
const anchorWhy = (c: { reason?: string; within?: { from: number; to: number } }): string =>
  `${c.reason ?? 'the anchored history does not hold'}${c.within && !/lies in events/.test(c.reason ?? '') ? `; the change lies in events ${c.within.from}…${c.within.to}` : ''}`

/** `verify anchor checkpoint|verify`: a witness signs the chain head outside the book; a reader holds the book to it. */
function runAnchor(argv: string[], io: CliIO): number {
  const [sub, ...rest] = argv
  if (sub === '-h' || sub === '--help') { return printHelp(io, 'anchor') }
  if (sub !== 'checkpoint' && sub !== 'verify') return usageError(io, 'anchor', `the verbs are \`verify anchor checkpoint\` and \`verify anchor verify\` (got ${sub === undefined ? 'nothing' : `"${sub}"`})`)
  const verb = `anchor ${sub}`
  const f = parseFlags(rest, sub === 'checkpoint' ? ANCHOR_CHECKPOINT_FLAGS : ANCHOR_VERIFY_FLAGS)
  if (f.help) { return printHelp(io, 'anchor') }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  return sub === 'checkpoint' ? anchorCheckpoint(io, verb, f) : anchorVerify(io, verb, f)
}

/**
 * `verify anchor checkpoint`: the witness signs a checkpoint of the book's head and appends it to its own store. The book is
 * verified first; the store's last checkpoint of this book is the new one's prev, and a book that no longer holds the
 * history it anchored is never extended (exit 2, the position named). Nothing is written unless the checkpoint is signed
 * and (with --root-keys) would count under the book's key registry. The book itself is only read.
 */
function anchorCheckpoint(io: CliIO, verb: string, f: Flags): number {
  const missing = need(f, ['ledger', 'key', 'signer', 'out'])
  if (missing.length) return usageError(io, verb, `needs ${missing.join(', ')}`)
  const lengthArg = f.v.length
  if (lengthArg !== undefined && !/^[1-9]\d*$/.test(lengthArg)) return usageError(io, verb, `--length is a positive whole number of events (got "${lengthArg}")`)
  const ledgerPath = f.v.ledger as string
  const out = f.v.out as string
  const witness_id = f.v.signer as string
  const book_id = f.v['book-id']
  const bookOpt = book_id !== undefined ? { book_id } : {}
  if (!existsSync(ledgerPath)) return inputError(io, verb, new Error(`no ledger at ${ledgerPath}`))

  let keyPem: string
  let root: RootKeys | undefined
  try { keyPem = readText(f.v.key as string) } catch (e) { return inputError(io, verb, e, 'error reading --key') }
  try { root = f.v['root-keys'] !== undefined ? readRootKeys(f.v['root-keys']) : undefined } catch (e) { return inputError(io, verb, e, 'error reading --root-keys') }
  let witnessPub: string
  try {
    const k = createPrivateKey(keyPem)
    if (k.asymmetricKeyType !== 'ed25519') throw new Error(k.asymmetricKeyType)
    witnessPub = createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString()
  } catch {
    return refused(io, verb, `--key must be the witness's Ed25519 PRIVATE key (PKCS8 PEM, as verify keygen writes it); nothing was signed`)
  }

  let seed: Seed
  let store: Checkpoint[]
  try { seed = readBookFile(ledgerPath, { io, verb }) } catch (e) { return inputError(io, verb, e, 'error reading ledger') }
  try { store = readWitnessStore(out) } catch (e) { return anchorRefusedOr3(io, verb, e, 'error reading the witness store') }
  const events = seed.events
  const length = lengthArg !== undefined ? Number(lengthArg) : events.length

  // The store's last checkpoint of this book: the book must still hold what it anchored, or the witness stops here.
  const unreadable = store.filter(cp => !verifyCheckpointSignature(cp).ok).length
  if (unreadable) return refused(io, verb, `${unreadable} checkpoint(s) in ${out} do not verify (altered or malformed): a witness extends only a store it can read. Nothing was signed or written`)
  const prev = latestCheckpoint(store, book_id)
  if (prev) {
    const held = verifyCheckpoint(prev, seed, { witness_keys: { [prev.body.witness_id]: prev.public_key } }, bookOpt)
    if (held.status === 'rewritten' || held.status === 'broken' || held.status === 'truncated') {
      io.out(`${JSON.stringify({ signed: false, last_checkpoint: { checkpoint_id: prev.checkpoint_id, length: prev.body.length }, check: held }, null, 2)}\n`)
      io.err(`verify ${verb}: ${held.status.toUpperCase()} at position ${prev.body.length}: the book no longer holds the history the witness store's last checkpoint (${short(prev.checkpoint_id)}) anchored: ${anchorWhy(held)}. A witness never extends a rewritten history: nothing was signed or written.\n`)
      return 2
    }
    if (!held.ok) return refused(io, verb, `the witness store's last checkpoint of this book (${short(prev.checkpoint_id)}) cannot be held to it: ${held.reason ?? held.status}. Nothing was signed or written`)
    if (prev.body.length === length && prev.body.witness_id === witness_id) {
      io.out(`${JSON.stringify({ signed: false, checkpoint: prev, chain: { length: events.length, head: events[events.length - 1]!.entry_hash } }, null, 2)}\n`)
      io.err(`verify ${verb}: already anchored: ${out} holds a checkpoint of position ${length} (${short(prev.checkpoint_id)}) and the book still holds it. Nothing new to sign; nothing was written.\n`)
      return 0
    }
  }

  let cp: Checkpoint
  try {
    cp = checkpoint(new MemoryLedger({ seed, ...(root ? { root_keys: root } : {}) }), { key: keyPem, witness_id, length, ...(prev ? { prev } : {}), ...bookOpt })
  } catch (e) { return anchorRefusedOr3(io, verb, e, 'error making the checkpoint') }
  if (root) {
    const counts = verifyCheckpoint(cp, seed, { root_keys: root }, bookOpt)
    if (!counts.ok) return refused(io, verb, `this checkpoint would not count under the key registry the root keys anchor: ${counts.reason ?? counts.status}. Nothing was written`)
  }
  let receipt: PublishReceipt
  try { receipt = (isWitnessDir(out) ? dirWitness(out) : fileWitness(out)).publish(cp) as PublishReceipt } catch (e) { return anchorRefusedOr3(io, verb, e, 'error writing the witness store') }

  io.out(`${JSON.stringify({ signed: true, checkpoint: cp, published: receipt, witness_keys: { [witness_id]: witnessPub }, chain: { length: events.length, head: events[events.length - 1]!.entry_hash } }, null, 2)}\n`)
  io.err(
    `verify ${verb}: signed position ${length} (head ${short(cp.body.head)}, as of ${cp.body.as_of}) as witness '${witness_id}', ` +
    `${prev ? `after ${short(prev.checkpoint_id)} (position ${prev.body.length})` : 'the first checkpoint of this book'}; published to ${receipt.location}. ` +
    `Keep the store where the book's writer cannot rewrite it (WORM storage, another account). ` +
    `${root ? 'Readers anchor this witness by --root-keys (it is registered with the witness role).' : `Readers anchor this witness out of band: --trusted-keys with the witness_keys entry printed above.`}\n`,
  )
  return 0
}

/**
 * `verify anchor verify`: the book against its independently held checkpoints. A rewrite that recomputes the whole chain
 * verifies internally, and fails here at the first checkpoint whose prefix it touches (exit 2, the position named).
 */
function anchorVerify(io: CliIO, verb: string, f: Flags): number {
  const missing = need(f, ['ledger', 'witness'])
  if (missing.length) return usageError(io, verb, `needs ${missing.join(', ')}`)
  if (f.v['trusted-keys'] === undefined && f.v['root-keys'] === undefined) {
    return usageError(io, verb, 'needs --trusted-keys <witness-keys.json> (each witness\'s public key, held out of band) or --root-keys <root.pub.pem> (witnesses registered on the book): a checkpoint counts only when its witness is anchored')
  }
  const ledgerPath = f.v.ledger as string
  const witness = f.v.witness as string
  const book_id = f.v['book-id']
  if (!existsSync(ledgerPath)) return inputError(io, verb, new Error(`no ledger at ${ledgerPath}`))
  if (!existsSync(witness)) return inputError(io, verb, new Error(`no witness store at ${witness}`))
  let anchors: Anchors
  try { anchors = readAnchors(f) } catch (e) { return inputError(io, verb, e, 'error reading the anchors') }
  let seed: Seed
  let store: Checkpoint[]
  try { seed = readBookFile(ledgerPath, { io, verb }) } catch (e) { return inputError(io, verb, e, 'error reading ledger') }
  try { store = readWitnessStore(witness) } catch (e) { return anchorRefusedOr3(io, verb, e, 'error reading the witness store') }
  const wa: WitnessAnchors = { ...(anchors.trusted ? { witness_keys: anchors.trusted } : {}), ...(anchors.root ? { root_keys: anchors.root } : {}) }
  let r: AnchorReport
  try { r = verifyAgainstCheckpoints(seed, store, wa, book_id !== undefined ? { book_id } : {}) } catch (e) { return anchorRefusedOr3(io, verb, e, 'error checking the checkpoints') }

  io.out(`${JSON.stringify(r, null, 2)}\n`)
  for (const c of r.checkpoints) {
    if (c.status === 'refused' || c.status === 'unverified') io.err(`verify ${verb}: note: the checkpoint of position ${c.length} (${c.checkpoint_id === '(none)' ? 'no id' : short(c.checkpoint_id)}) does not count (${c.status}): ${c.reason ?? ''}\n`)
  }
  for (const g of r.gaps) io.err(`verify ${verb}: note: a counted checkpoint names ${short(g)} as its predecessor, and the witness store does not hold it: a checkpoint was removed from the store\n`)
  const ff = r.first_failure
  if (ff) {
    io.err(`verify ${verb}: ${ff.status.toUpperCase()} at the checkpoint of position ${ff.length} (${short(ff.checkpoint_id)}, witness '${ff.witness_id ?? '?'}'): ${anchorWhy(ff)}\n`)
    return 2
  }
  const held = r.checkpoints.filter(c => c.status === 'held').length
  if (held === 0) return refused(io, verb, `no checkpoint in ${witness} counts (${r.checkpoints.length} read), so nothing anchors this book`)
  if (!r.ok) return refused(io, verb, `the book does not verify internally at position ${r.verified_through}, past its last anchored position (${r.anchored_through}): the chain's own check catches it (verify report --ledger ${ledgerPath})`)
  io.err(`verify ${verb}: HELD: the book's first ${r.anchored_through} event(s) are the anchored history (${held} checkpoint(s) held${r.content ? ', payloads re-hashed' : ''})${r.anchored_through < r.length ? `; events ${r.anchored_through}…${r.length - 1} are not anchored yet` : ''}.\n`)
  return 0
}

/**
 * `verify extract-schema <ruleset> [--validate <envelope.json>]` (T1, 2026-10-03): the extraction contract's JSON Schema for a
 * ruleset (a carried name, a declarative ruleset file, or `legal` / `legal@<version>`), generated from its fields block. With
 * --validate it checks an envelope against it instead and prints the violations, first one first.
 * Exit 0 printed / valid · 1 the envelope breaks the contract · 3 usage or a ruleset it cannot read.
 */
function runExtractSchema(argv: string[], io: CliIO): number {
  let target: string | undefined, validate: string | undefined, help = false
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] as string
    if (t === '-h' || t === '--help') help = true
    else if (t === '--validate') validate = argv[++i]
    else if (t === '--ruleset') target = argv[++i]
    else if (!t.startsWith('-') && target === undefined) target = t
    else { io.err(`verify extract-schema: unknown argument ${t}\n`); return 3 }
  }
  if (help || target === undefined) { io.err('usage: verify extract-schema <ruleset | legal[@version]> [--validate <envelope.json>]\n'); return help ? 0 : 3 }
  let ruleset: ContractRuleset
  try {
    ruleset = legalVersionOf(target) !== undefined ? target : readRulesetArg(target) as unknown as DeclarativeRuleset
    if (typeof ruleset !== 'string' && !isDeclarativeRuleset(ruleset)) throw new Error(`${target} is not a declarative ruleset (id, version, fields, checks) or the legal ruleset`)
  } catch (e) { io.err(`verify extract-schema: error reading ruleset: ${(e as Error).message}\n`); return 3 }
  if (validate === undefined) { io.out(`${JSON.stringify(extractionSchema(ruleset), null, 2)}\n`); return 0 }
  let env: unknown
  try { env = readJson(validate) } catch (e) { io.err(`verify extract-schema: error reading ${validate}: ${(e as Error).message}\n`); return 3 }
  const violations = validateContract(env, ruleset)
  io.out(`${JSON.stringify({ ok: violations.length === 0, violations }, null, 2)}\n`)
  if (violations.length) io.err(`verify extract-schema: ${violations.length} violation(s); the first: ${violations[0]!.code} at ${violations[0]!.pointer || '(the extraction)'}: ${violations[0]!.message}\n`)
  return violations.length ? 1 : 0
}

/**
 * `verify compile-ruleset` (T2, 2026-10-03): schematron → declarative ruleset skeleton (src/compile, docs/COMPILER.md), or with
 * --diff, mark the hand edits made to a compiled ruleset. Exit 0 written and linted clean · 1 written but lint errors · 3 usage.
 */
function runCompileRuleset(argv: string[], io: CliIO): number {
  const inputs: string[] = []
  const against: string[] = []
  let structure: string | undefined, out: string | undefined, profile: string | undefined, version: string | undefined, name: string | undefined
  let aliases: string | undefined, scope: string | undefined, sources: string | undefined, report: string | undefined
  let diff: [string, string] | undefined, help = false
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] as string
    switch (t) {
      case '-h': case '--help': help = true; break
      case '--structure': structure = argv[++i]; break
      case '--out': out = argv[++i]; break
      case '--profile': profile = argv[++i]; break
      case '--version': version = argv[++i]; break
      case '--name': name = argv[++i]; break
      case '--aliases': aliases = argv[++i]; break
      case '--scope': scope = argv[++i]; break
      case '--sources': sources = argv[++i]; break
      case '--report': report = argv[++i]; break
      case '--against': against.push(argv[++i] as string); break
      case '--diff': diff = [argv[++i] as string, argv[++i] as string]; break
      default:
        if (t.startsWith('-')) { io.err(`verify compile-ruleset: unknown argument ${t}\n`); return 3 }
        inputs.push(t)
    }
  }
  const usage = 'usage: verify compile-ruleset <a.sch> [<b.sch> ...] --structure <tsv|xml> --out <ruleset.json> [--profile <id>] [--aliases <json>] [--scope aliases|<json>] [--against <hand.json>]\n       verify compile-ruleset --diff <compiled.json> <edited.json> --out <file.json>\n'
  if (help) { io.err(usage); return 0 }
  if (diff) {
    if (!out || diff.some(x => !x)) { io.err(usage); return 3 }
    let compiled: DeclarativeRuleset, edited: DeclarativeRuleset
    try { compiled = readJson(diff[0]) as unknown as DeclarativeRuleset; edited = readJson(diff[1]) as unknown as DeclarativeRuleset } catch (e) { io.err(`verify compile-ruleset: error reading: ${(e as Error).message}\n`); return 3 }
    const r = markHandEdits(compiled, edited)
    writeFileSync(out, `${JSON.stringify(r.ruleset, null, 2)}\n`)
    io.err(`verify compile-ruleset --diff: ${r.edits.length} hand edit(s) marked (${r.edits.map(e => `${e.kind} ${e.id} ${e.change}`).join('; ') || 'none'}); wrote ${out}\n`)
    return 0
  }
  if (!inputs.length || !structure || !out) { io.err(usage); return 3 }
  const read = (p: string): string => readText(p)
  let result
  try {
    const structText = read(structure)
    const structDir = dirname(resolvePath(structure))
    result = compileSchematron(inputs.map(p => ({ path: p, text: read(p) })), {
      structure: { file: structure, text: structText, readPart: (href: string) => { const p = join(structDir, href); return existsSync(p) ? read(p) : undefined } },
      ...(profile ? { profile } : {}), ...(version ? { version } : {}), ...(name ? { name } : {}),
      ...(aliases ? { aliases: { file: aliases, text: read(aliases) } } : {}),
      ...(scope ? { scope: scope === 'aliases' ? 'aliases' as const : { file: scope, text: read(scope) } } : {}),
      ...(sources ? { sources: parseJsonStrict(read(sources), sources) as Record<string, string> } : {}),
      read: (href: string, from: string) => { const p = join(dirname(resolvePath(from)), href); return { path: p, text: read(p) } },
    })
  } catch (e) { io.err(`verify compile-ruleset: ${(e as Error).message}\n`); return 3 }
  const reportPath = report ?? out.replace(/(\.json)?$/, '.compile-report.json')
  writeFileSync(out, `${JSON.stringify(result.ruleset, null, 2)}\n`)
  writeFileSync(reportPath, result.reportText)
  const lint = lintRuleset(result.ruleset)
  const t = result.report.total
  io.err(`verify compile-ruleset: ${t.asserts} assert(s): ${t.arithmetic} arithmetic, ${t.presence} presence, ${t.membership} membership, ${t.uncompiled} uncompiled (${t.partial} partial) → ${result.ruleset.checks.length} check(s), ${Object.keys(result.ruleset.fields).length} field(s); wrote ${out} and ${reportPath}; lint ${lint.ok ? 'clean' : `${lint.errors.length} error(s): ${lint.errors[0]}`}\n`)
  if (against.length) {
    const comps = []
    for (const h of against) {
      let hand: DeclarativeRuleset
      try { hand = readRulesetArg(h) as unknown as DeclarativeRuleset } catch (e) { io.err(`verify compile-ruleset: error reading ${h}: ${(e as Error).message}\n`); return 3 }
      const c = compareWithHand(result.ruleset, hand, result.report)
      comps.push(c)
      io.err(`verify compile-ruleset: against ${c.hand}: ${c.summary.reproduced} reproduced, ${c.summary.differs} differ, ${c.summary.no_counterpart} with no counterpart, ${c.summary.unexplained} unexplained\n`)
    }
    const base = out.replace(/(\.json)?$/, '')
    writeFileSync(`${base}.comparison.json`, `${JSON.stringify(comps, null, 1)}\n`)
    writeFileSync(`${base}.comparison.md`, comps.map(renderComparison).join('\n'))
  }
  void basename
  return lint.ok ? 0 : 1
}

/**
 * `verify case open | move | status | replay` (engine 0.3.0; src/arbitration/case.ts). Asynchronous: a move may file a PDF,
 * which the engine re-reads (pdfjs). The process entry runs it; `run()` (synchronous) points a caller here.
 */
export async function runCase(argv: string[], io: CliIO = PROCESS_IO): Promise<number> {
  invoked = true
  const [sub, ...rest] = argv
  const verb = `case ${sub ?? ''}`.trim()
  const flags: Record<string, string> = {}
  const on = new Set<string>()
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i] as string
    if (t === '--json' || t === '--reread') { on.add(t.slice(2)); continue }
    if (t === '-h' || t === '--help') { return printHelp(io, 'case') }
    if (!t.startsWith('--') || rest[i + 1] === undefined) return usageError(io, verb, `unexpected argument ${JSON.stringify(t)}`)
    flags[t.slice(2)] = rest[++i] as string
  }
  const dir = flags.dir
  if (!dir) return usageError(io, verb, 'needs --dir <case-dir>')
  const now = flags.now ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  try {
    if (sub === 'open') {
      for (const k of ['verdict', 'inputs', 'parties']) if (!flags[k]) return usageError(io, verb, `needs --${k}`)
      const raw = readJson(flags.verdict!) as Record<string, unknown>
      const verdict = (isObj(raw.verdict) ? raw.verdict : raw) as unknown as Verdict
      const st = openCase({ dir, verdict, inputs: readJson(flags.inputs!), parties: readJson(flags.parties!), now, ...(flags.document ? { document: new Uint8Array(readFileSync(flags.document)) } : {}), ...(flags.dispute ? { dispute: flags.dispute } : {}) })
      io.out(`${JSON.stringify(st.record, null, 2)}\n`)
      io.err(`verify case open: ${st.record.case_id} opened (${st.record.why}); clock ${st.record.clock.working_days} working days (${st.record.clock.kind}), deadline ${st.record.clock.deadline}\n${scopeLines(st.latest).map(l => `  ${l}`).join('\n')}\n`)
      return 0
    }
    if (sub === 'move') {
      if (!flags.move) return usageError(io, verb, 'needs --move <move.json>')
      const r = await fileMove({ dir, move: new Uint8Array(readFileSync(flags.move)), ...(flags.evidence ? { evidence: new Uint8Array(readFileSync(flags.evidence)) } : {}), now })
      io.out(`${JSON.stringify({ accepted: r.accepted, ...(r.move_id ? { move_id: r.move_id } : {}), ...(r.refusal ? { refusal: r.refusal } : {}), ...(r.before ? { before: r.before } : {}), ...(r.after ? { after: r.after } : {}), ...(r.resolution ? { resolution: r.resolution } : {}), status: r.status }, null, 2)}\n`)
      if (!r.accepted) { io.err(`verify case move: REFUSED (${r.refusal?.code}): ${r.refusal?.detail}. The refusal is on the record, by the move's sha256.\n`); return 1 }
      io.err(`verify case move: accepted ${r.move_id?.slice(0, 12)}…; re-verdict ${r.after?.verdict_id} reads ${r.after?.gate} (was ${r.before?.gate})${r.resolution ? `; the case resolves ${r.resolution}` : '; the case stays open'}\n${scopeLines(r.verdict).map(l => `  ${l}`).join('\n')}\n`)
      return 0
    }
    if (sub === 'status') {
      const s = caseStatus(dir, now)
      io.out(`${JSON.stringify(s, null, 2)}\n`)
      if (!on.has('json')) {
        const st = loadCase(dir)
        io.err(`verify case status: ${s.case_id} ${s.status.toUpperCase()}${s.resolution ? ` (${s.resolution})` : ` until ${s.deadline}`}; latest verdict ${s.latest.verdict_id} reads ${s.latest.gate}; ${s.moves.accepted} move(s) accepted, ${s.moves.refused} refused; ${s.struck.length} struck field(s)${s.struck.length ? `: ${s.struck.map(x => `${x.field} (${x.reason})`).join(', ')}` : ''}\n${scopeLines(st.latest).map(l => `  ${l}`).join('\n')}\n`)
      }
      return 0
    }
    if (sub === 'replay') {
      const r = await replayCase(dir, { reread: on.has('reread') })
      io.out(`${JSON.stringify(r, null, 2)}\n`)
      io.err(`verify case replay: ${r.ok ? 'every verdict re-performed byte for byte, every move signature verified' : 'FAILED'}: ${r.verdicts.length} verdict(s), ${r.moves.length} move(s)${r.ledger.length ? `; ledger: ${r.ledger.join('; ')}` : ''}${on.has('reread') ? `; documents re-read: ${r.moves.filter(m => m.reread === 'same').length} same, ${r.moves.filter(m => m.reread === 'differs').length} differ` : ''}\n`)
      return r.ok ? 0 : 1
    }
    return usageError(io, 'case', `the verbs are \`verify case open | move | status | replay\` (got ${sub === undefined ? 'nothing' : `"${sub}"`})`)
  } catch (e) {
    if (e instanceof CaseRefused) { io.err(`verify ${verb}: REFUSED (${e.code}): ${e.message}\n`); return 1 }
    io.err(`verify ${verb}: error: ${(e as Error).message}\n`)
    return 3
  }
}

const VERBS: Readonly<Record<string, (argv: string[], io: CliIO) => number>> = {
  'extract-schema': runExtractSchema, 'compile-ruleset': runCompileRuleset,
  lint: runLint, measure: runMeasure, replay: runReplay, ap: runAp, mine: runMine, voice: runVoice, notice: runNotice,
  twin: runTwin, 'twin-einvoice': runTwinEinvoice, opinion: runOpinion,
  grant: runGrant, succession: runSuccession, decline: runDecline, 'revise-policy': runRevisePolicy, keygen: runKeygen, report: runReport,
  rule: runRule, statute: runStatute, sample: runSample, queue: runQueue, review: runReview, key: runKey, canary: runCanary,
  policy: runPolicy, reconcile: runReconcile, ledger: runLedger, anchor: runAnchor,
  bench: runBench, // `verify bench emit | index | check` (src/bench/cli-bench.ts): bench tables from preregs, the misses ledger
  citations: runCitations, // `verify citations <citations.json> --sources <dir>` (src/legal/cli-citations.ts, 2026-10-05): a brief's quotations
}
import { runBench } from './bench/cli-bench.js'
import { runCitations } from './legal/cli-citations.js'
import { runServe } from './http/serve.js' // `verify serve` (2026-10-05): long-running, so the process entry starts it, not run()

/** The one line `--version` prints (2026-10-05): the build, and every engine whose verdicts it re-performs. */
export const VERSION_LINE = `${BIN} ${ENGINE_VERSION} (engine ${ENGINE_VERSION}; replays verdicts of engines ${ENGINE_VERSIONS.join(', ')})`

export function run(argv: string[], io: CliIO = PROCESS_IO): number {
  invoked = true
  try {
    const [first, ...rest] = argv
    // 2026-10-05: no arguments prints the first screen (40 lines, not the reference); --version prints the version and
    // exits 0; --help / help take an optional command (`--help replay`) or `all` (the whole reference).
    if (first === undefined) { io.err(`${HELP}\n`); return 3 }
    if (first === '--version' || first === '-V') { io.out(`${VERSION_LINE}\n`); return 0 }
    if (first === '--help' || first === '-h' || first === 'help') {
      const what = rest[0]
      if (what === undefined) { io.err(`${HELP}\n`); return 0 }
      if (what === 'all') { io.err(`${USAGE}\n`); return 0 }
      const h = helpFor(what)
      if (h !== undefined) { io.err(`${h}\n`); return 0 }
      io.err(`verify: no command "${what}"${didYouMean(what, [...Object.keys(VERBS), 'check', 'case'])}\n${HELP}\n`)
      return 3
    }
    if (first === 'check') return runVerify(rest, io)
    if (first === 'case') { io.err('verify case is asynchronous (a move may file a PDF the engine re-reads): call runCase(argv) from the library, or run the CLI\n'); return 3 }
    if (first === 'serve') { if (rest.includes('--help') || rest.includes('-h')) return printHelp(io, 'serve'); io.err('verify serve runs until stopped: call runServe(argv) from the library, or run the CLI\n'); return 3 }
    const verb = first !== undefined && Object.prototype.hasOwnProperty.call(VERBS, first) ? VERBS[first] : undefined
    if (verb) return verb(rest, io)
    // 2026-10-05: a word that is neither a command nor a file (`verify replya verdict.json`) is a mistyped command, never a
    // check of whatever file follows it.
    if (/^[a-z][a-z0-9-]*$/i.test(first) && !existsSync(first)) {
      io.err(`verify: unknown command "${first}"${didYouMean(first, [...Object.keys(VERBS), 'check', 'case', 'help'])} (and no file by that name)\nsee: ${invokedAs()} --help\n`)
      return 3
    }
    return runVerify(argv, io)
  } catch (e) {
    // Nothing throws out of run(): an unexpected error is reported, never a stack trace from the process.
    io.err(`verify: internal error: ${e instanceof Error ? e.message : String(e)}\n`)
    return 3
  }
}

/**
 * Is this file the program? (2026-10-05, a cold reader in cold review round 3: "my first wrapper exited 0 with no output and no error".) Yes when
 * argv[1] names it: `node …/cli.js`, `tsx …/cli.ts`, an npm bin shim that passes the path, or a bin symlink such as `riposte-verify`
 * (compared by real path, so a link whose own name does not end in cli.js still runs the CLI).
 */
export function isProgram(main: string | undefined = process.argv[1]): boolean {
  if (!main) return false
  if (/(^|[\\/])cli\.[cm]?[jt]s$/.test(main)) return true
  try { return realpathSync(main) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
}
/** Set once run() or runCase() is called: a host that imports this module and calls run() is using it, not wrapping it. */
let invoked = false

// Run when invoked directly.
if (isProgram()) {
  const argv = process.argv.slice(2)
  // `verify case …` is asynchronous; let stdout drain before the process ends (exitCode, never exit())
  if (argv[0] === 'case') void runCase(argv.slice(1)).then(code => { process.exitCode = code })
  else if (argv[0] === 'serve') { invoked = true; const r = runServe(argv.slice(1), { help: helpFor('serve') ?? '' }); if (!r.server) process.exitCode = r.code }
  else process.exit(run(argv))
} else if (!process.env.VITEST && process.env.JEST_WORKER_ID === undefined) {
  // A script that imports this module and never calls run() ran no command. It used to end with exit 0 and nothing printed; now it
  // says what happened and how to wrap the CLI, prints the usage, and exits 3. A test runner imports the module for run() and its
  // helpers, so it is left alone.
  process.once('beforeExit', () => {
    if (invoked) return
    process.stderr.write(`${BIN}: no command ran: this module was imported by ${process.argv[1] ?? 'another script'}, not run. To wrap the CLI, call run(process.argv.slice(2)) from this module and exit with the number it returns, or run node with this file's path.\n${HELP}\n`)
    process.exitCode = 3
  })
}
