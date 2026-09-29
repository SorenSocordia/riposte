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
 *   verify notice verdict.json --level gate               # one action at a rung: every FAIL/ABSTAIN with evidence + dispute path
 *   verify voice --ledger chain.jsonl --policy policy.json --workflow acme/invoice@0.0.1 --tier low --granted gate
 *   verify voice --from-book --ledger chain.jsonl --policy policy.json --workflow acme/invoice@0.0.1   # the rung from the book
 *   verify opinion --ledger chain.jsonl --policy policy.json --proposal proposal.json   # the courtroom opinion (Markdown)
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

import { readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { verify, type VerifyOptions, type Json } from './verify.js'
import { isDeclarativeRuleset, type DeclarativeRuleset } from './declarative/types.js'
import type { TolerancePolicy } from './tolerance.js'
import { lintRuleset } from './declarative/lint.js'
import { measureRuleset, renderMeasurement, type LabeledCase } from './declarative/measure.js'
import type { Verdict } from './verdict/schema.js'
import { verifyReplay, type ReplayCheck, type ReplayOptions } from './protocol/replay.js'
import { verifyInvoiceMatch, splitApLayout, type ApDocuments } from './ap/index.js'
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
  makeReview, makeKeyRegister, makeKeyRevoke, canaryCommitment, isRole, ROLES, keyFingerprint,
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

interface Args { file?: string; ruleset?: string; labels?: string; inputs?: string; invoice?: string; po?: string; receipt?: string; contract?: string; evidence: string[]; history: string[]; source?: string; help: boolean }

function parse(argv: string[]): Args {
  const a: Args = { evidence: [], history: [], help: false }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] as string
    switch (t) {
      case '-h': case '--help': a.help = true; break
      case '--ruleset': a.ruleset = argv[++i]; break
      case '--labels': a.labels = argv[++i]; break
      case '--inputs': a.inputs = argv[++i]; break
      case '--invoice': a.invoice = argv[++i]; break
      case '--po': a.po = argv[++i]; break
      case '--receipt': a.receipt = argv[++i]; break
      case '--contract': a.contract = argv[++i]; break
      case '--evidence': a.evidence.push(argv[++i] as string); break
      case '--history': a.history.push(argv[++i] as string); break
      case '--source': a.source = argv[++i]; break
      default: if (!t.startsWith('-') || t === '-') a.file = t
    }
  }
  return a
}

const USAGE = `riposte-verify <extraction.json | -> [options]        verify a document
  --ruleset invoice|pay-app|<file.json>   built-in name OR a declarative ruleset file (default: invoice)
  --contract <file.json>        contract / PO reference
  --evidence <file.json>        receipt / delivery evidence (repeatable)
  --history <file.json>         prior document of the same kind (repeatable)
  --source <file.txt>           source document text (values checked against it)

riposte-verify lint --ruleset <file.json>              validate a declarative ruleset
riposte-verify measure --ruleset <file.json> --labels <set.json>   measured accuracy on a labeled set
riposte-verify replay <verdict.json | envelope.json> [--inputs <inputs.json> | --extraction <doc.json> [--ruleset <r>] [--contract <f>]
              [--evidence <f>]... [--history <f>]... [--source <f.txt>]] [--tolerance <json>] [--document <f>] [--pre <f>]
              [--filing-summary <f>] [--schema <f>]
    check a verdict you were handed. The verdict_id binds the INPUTS, not the outcome, so with the inputs the check is
    RE-PERFORMED here (the engine for the verdict's ruleset) and the recomputed verdict byte-compared with the presented one
    (issued_at and post-engine annotations aside; the first differing field is named). --inputs is the object the verdict's
    input_hash commits to; --extraction builds verify()'s from the same flags \`verify <doc>\` takes. --tolerance restates a
    rounding override the verdict was issued under ({"rel":…,"absCap":…}: input_hash does not commit to it). The twins'
    inputs commit to the document by hash: --document (and, for twin v0.2+, the linkbase files) re-performs them. A signed
    envelope's signature is checked too. Exit 0 outcome VERIFIED (re-performed, byte-identical) · 1 FAILED (the binding, the
    re-performed outcome, or the envelope signature) · 2 structure verified, outcome NOT re-performed (no inputs, or nothing
    here re-performs them) · 3 not a verdict / usage
riposte-verify reconcile --ledger <chain.jsonl> --population <payments.csv|.jsonl> --mapping <mapping.json> [--format csv|jsonl]
                 [--delimiter ,|;|tab|'|'] [--extractions <docs.json|.jsonl>] [--tenant <id>] [--workflow <id>]... [--ruleset <id>]...
                 [--since <iso>] [--until <iso>] [--rungs <json|file>] [--include-matched] [--policy <policy.json>] [--trusted-keys <k>]
                 [--root-keys <r>] [--json | --md]
    completeness: did every payment go through the control? The whole book is verified first; then every row of the
    customer's payment population lands in one class (MATCHED · MISMATCHED · PAID_DESPITE_HOLD · CHECKED_AFTER_PAYMENT ·
    AMBIGUOUS · BYPASSED · UNREADABLE) and every in-period verdict in one (MATCHED · ORPHAN · AMBIGUOUS · UNKEYED). The
    mapping declares the columns, keys and book fields (completeness-mapping-v0); --extractions supplies the checked
    documents a mapping reads book fields from (each used only if its hash is on the book). The population is read as bytes,
    so the report binds its sha256. Prints the report JSON (--md: the Markdown an auditor reads). Only an anchored GRANT
    sets a rung (--trusted-keys / --root-keys); --policy is the deployment's declared policy, and a GRANT it does not admit
    (its tier, max_rung, the signatures autonomy needs there) sets no rung, whatever policy the grant names. Exit 0 clean
    (every row MATCHED) · 2 exceptions a person must look at (any PAID_DESPITE_HOLD, MISMATCHED, BYPASSED, or any row not
    MATCHED) · 1 REFUSED (the book does not verify; a mapping or population value it will not read; a corrupt book) · 3 usage
riposte-verify ledger repair <chain.jsonl>
    a book whose last line is torn (an append that did not finish: a crash mid-write) reads, but takes no append. This
    backs the file up (<book>.torn-<time>.bak, never over a file), truncates it to its last whole line, logs what it
    removed to <book>.repairs.jsonl, and prints exactly what it removed (offset, bytes, sha256, base64). A book whose
    last line is whole is left alone. Run it with no writer open on the book. Exit 0 repaired (or nothing to repair) ·
    1 REFUSED (an unparseable line before the last is corruption, not a torn tail: restore from a backup) · 3
riposte-verify ledger export <chain.jsonl> --out <file>
    the book's chain export (the bytes ledger.chainJSONL() gives), streamed: a book of any size. Never over a file (exit
    1). Copied as written, not verified (verify report --ledger <file> checks it). Exit 0 · 1 refused · 3
riposte-verify anchor checkpoint --ledger <chain.jsonl> --key <witness.pem> --signer <witness_id> --out <witness.jsonl | dir/>
                         [--length <n>] [--book-id <id>] [--root-keys <root.pub.pem>]
    a WITNESS (a party with no write access to the book) signs a checkpoint of the chain head ({length, head, as_of,
    prev_checkpoint}, Ed25519) and appends it to its witness store: a file (one line per checkpoint) or a directory (one
    file each, never overwritten). Point --out at storage the book's writer cannot rewrite (WORM, another account). The
    book is verified first, and a book that no longer holds what the store's last checkpoint anchored is never extended.
    --root-keys: the witness key must be registered on the book with the witness role (not key_admin), or nothing is
    written. Prints the checkpoint and the witness_keys entry readers anchor it with. Exit 0 signed (or already anchored)
    · 2 REWRITTEN / TRUNCATED: the book contradicts the store's last checkpoint (its position is named; nothing is
    signed) · 1 REFUSED (a book that does not verify, not an Ed25519 private key, a position past the book's end, a
    store entry that does not verify; nothing is written) · 3 usage
riposte-verify anchor verify --ledger <chain.jsonl> --witness <witness.jsonl | dir/> (--trusted-keys <witness-keys.json> | --root-keys <root.pub.pem>)
                     [--book-id <id>]
    the book against its independently held checkpoints. A rewrite that recomputes the whole chain verifies internally,
    and fails here at the first checkpoint whose prefix it touches. --trusted-keys anchors each witness by its public key,
    held out of band ({"<witness_id>": "<public PEM>"}); --root-keys reads witnesses registered on the book (weaker: a
    rewriter can drop a later revocation). Prints the report JSON; a checkpoint that does not count, and a checkpoint
    missing from the store, are said on stderr. Exit 0 every counted checkpoint held · 2 REWRITTEN / BROKEN / TRUNCATED at
    an anchored position (named, with the events the change lies in) · 1 REFUSED (no checkpoint counts; the book does
    not verify past its last anchored position; a corrupt store) · 3 usage
riposte-verify ap <layout.txt> | --invoice <f> --po <f> --receipt <f>   AP three-way match (exit 0 approve · 1 hold · 2 abstain)
riposte-verify mine <cases.jsonl> --schema <schema.json>   mine candidate rules from labelled approve/hold cases (JSON report)
  --ap                                  cases are Distil-style AP layouts {id,input,decision}; built-in AP schema unless --schema
  --max-approved-violation-rate <r>     tolerate approved exceptions (default 0 = none)
  --ruleset-out <file>                  also write the compiled ruleset (never over a file: exit 1; enforce: verify <doc> --ruleset <file>)
  --ruleset-id <id>                     id of the compiled ruleset (default "mined")
  --thresholds                          also learn a constant per numeric document field (X <= c, X >= c)

riposte-verify twin --html <primary.htm> --period-end YYYY-MM-DD --claims <claims.json> [--tolerance 0.5] [--period-tolerance-days 7]
            [--ruleset 0.1|0.2|0.2.1] [--pre <x_pre.xml>] [--filing-summary <FilingSummary.xml>] [--schema <x.xsd>]
    structured-twin mode (CREDENCE-1): check extracted values against the filing's own inline-XBRL facts. claims.json is
    [{"id","field","value"}] (or {"claims":[...]}). Prints {verdict, judgments, twin}. --ruleset 0.1 (default) binds against
    the whole document; 0.2 (CREDENCE-2) and 0.2.1 bind only through the face statements named by the filing's presentation
    linkbase (--pre, --filing-summary, --schema): without one every claim ABSTAINs (NO_PRESENTATION_LINKBASE).
    Exit 0 PASS · 1 FAIL · 2 ABSTAIN
riposte-verify twin-einvoice <invoice.xml> --claims <claims.json> [--profile peppol-bis3|zatca-ksa|ksef-fa3] [--no-consistency]
    e-invoice twin: check extracted values against the binding e-invoice XML itself (Peppol BIS 3.0, ZATCA, KSeF FA(3)).
    claims.json is [{"id","field","value","currency?"}] (or {"claims":[...]}). Prints {verdict, judgments, consistency,
    twin}. Exit 0 PASS · 1 FAIL · 2 ABSTAIN
riposte-verify notice <verdict.json> [--level record|advise|gate|autonomy] [--json]
    one action's notice at a rung (default record): every FAIL and ABSTAIN with its evidence and its own dispute path, at
    every rung. Surfaced at record/advise; held at gate/autonomy. Exit 0 PROCEED · 1 HOLD · 2 SURFACED (not held)
riposte-verify voice --ledger <chain.jsonl> --policy <policy.json> --workflow <id> --tier <tier> [--granted <level> | --grant <grant.json>] [--bounds <text>] [--surface]
riposte-verify voice --from-book --ledger <chain.jsonl> --policy <policy.json> --workflow <id> [--tier <tier>] [--trusted-keys <keys.json>] [--root-keys <root.pub.pem>] [--surface]
    a workflow's voice (record | advise | gate | autonomy) from the book of record. The rung is ALWAYS what a person granted
    (default record); Riposte only PROPOSES: a promotion, or an URGENT demotion with the failing cases listed for dispute.
    --grant names the signer and the policy version + tier the grant was made under. --from-book reads the rung, tier,
    bounds and policy version from the GRANT in force on the book (a person's signed decision, see verify grant), cites
    it, and holds back a proposal a person declined until the evidence changes (said on stderr: "Kept at <rung> by
    <person>, <time>; stands until …" / "Not now: <person>, <time>; re-raises when …"); --tier only while nothing is
    granted. Only an ANCHORED signer's decision moves a rung (--trusted-keys / --root-keys). --surface prints the voice
    surface MCP voice_assess / HTTP GET /v1/voice return. Exit 0 · 1 the chain (or a signed decision on it) did not verify
    · 2 an urgent demotion proposal is open (evidence of failure: a miss under the grant). A rung granted above what the
    record supports, with nothing gone wrong (basis unevidenced), is a standing notice: 0
riposte-verify opinion --from-book --ledger <chain.jsonl> --policy <policy.json> --workflow <id> [--tier <tier>] [--tenant <id>] [--trusted-keys <keys.json>] [--root-keys <root.pub.pem>] [--json]
riposte-verify opinion --ledger <chain.jsonl> --policy <policy.json> (--proposal <proposal.json> | --workflow <id> --tier <tier> [--granted <level> | --grant <grant.json>] [--bounds <text>]) [--tenant <id>] [--trusted-keys <keys.json>] [--json]
riposte-verify opinion --ledger <chain.jsonl> --dispute <verdict_id> [--claim <claim_id>] [--tenant <id>] [--trusted-keys <keys.json>] [--json]
    the courtroom opinion (Markdown; --json prints the source of truth). Every premise is checked by Riposte's own code.
    --from-book reads the rung from the GRANT in force (cited as the decision a ruling would amend); a standing decline is
    DECLINED, never a fresh ask. --tenant reads one tenant's records and decisions on a shared book. Exit 0 · 1 withheld
    (a premise failed its check)
riposte-verify rule --ledger <chain.jsonl> --dispute <verdict_id> [--claim <claim_id>] --ruling STANDS|SET_ASIDE --reason <text>
            --key <person.pem> --signer <id> [--tenant <id>] [--inputs <inputs.json>] [--note <text>] [--signed-at <iso>] [--trusted-keys <keys.json>]
    a person's signed ruling on LAW over the dispute opinion Riposte derives from the book (a verified one proposing
    UPHOLD or REFER on a deterministic PASS/FAIL finding). Prints ONE JSON line: \`verify rule … >> rulings.jsonl\`.
    Exit 0 · 1 REFUSED (a withheld opinion, an abstention, a key the trusted keys do not anchor) · 3
riposte-verify statute --ledger <chain.jsonl> --rulings <rulings.jsonl> --rule <rule_id> --domain <domain> [--outcome FAIL|PASS] [--tenant <id>]
               [--rows-out <rows.jsonl> --schema-out <schema.json>] [--inputs <by-verdict.json>] [--trusted-keys <keys.json>]
    precedent → statute: every ruling re-verified against the book, the rulings mined as a case table, each candidate rule
    returned as COUNSEL (never a VERDICT; a person adopts one by writing it into a ruleset). --rows-out/--schema-out write
    the table for verify mine (never over a file). Exit 0 · 1 the book did not verify · 3
riposte-verify report --ledger <chain.jsonl> [--policy <policy.json>] [--declarations <d.json>] [--tenant <id>] [--month YYYY-MM] [--as-of <iso>] [--trusted-keys <keys.json>] [--root-keys <root.pub.pem>]
    the tenant book-of-record report (Markdown), the day-1 audit report: volume, the human-overturn rate, per-rule
    calibration, what Riposte is asking a person to decide (and what a person declined, in words: who, when, what would
    re-raise it), FAIL/ABSTAIN notices by rung, and tamper-evidence. A workflow's rung is read from the GRANT in force on
    the book, which the report cites; --declarations ([{workflow_id, consequence_tier, granted?, bounds?}]) covers
    workflows with no grant, and never overrides one. Exit 0 · 1 the book did not verify

A person's decisions (Ed25519-signed, appended to the book through the ledger's door; only a person moves a rung):
riposte-verify keygen --out <person.pem> [--signer <id>]
    an Ed25519 keypair for local signing: the PRIVATE key to <person.pem> (never overwritten), the public key to
    <person>.pub.pem, and the --trusted-keys entry on stdout. KEY CUSTODY IS THE OPERATOR'S: Riposte keeps no copy; revoke
    a key on the book with verify key revoke. Exit 0 · 1 refused (a file is already there) · 3 error
riposte-verify grant --ledger <chain.jsonl> --key <person.pem> --signer <id> --workflow <id> --level record|advise|gate|autonomy
             --tier <tier> --policy <policy.json> [--bounds <text>] [--answers <proposal_id>] [--note <text>] [--signed-at <iso>]
    a person sets a workflow's rung, either direction: a GRANT under the policy version (by hash) and the consequence tier
    (the policy must lint, declare the tier, and allow the rung at it). autonomy needs --bounds (a person writes them, even
    "all"). The latest ANCHORED GRANT for a workflow is its rung. At a tier declaring grant_signatures (dual authorization)
    a GRANT of autonomy is PENDING, and moves nothing, until another person co-signs it; stderr says so.
riposte-verify grant --cosign <grant_decision_id> --ledger <chain.jsonl> --key <person.pem> --signer <id> [--trusted-keys <k> | --root-keys <r>]
             [--policy <policy.json>] [--note <text>] [--signed-at <iso>]
    a second person's signature on a pending GRANT (a GRANT_COSIGN, riding in a GRANT event: the chain format is unchanged).
    It names the grant (its decision id, or a unique prefix of 12+ characters) and restates its workflow and level. The door
    refuses one that would not count: the grant's own signer, a repeat signer, the same key or two ids on one key, a
    co-signer with no anchored key or a revoked one, an unanchored or superseded grant (exit 1; the book is untouched).
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
    (with --key it also asks the door, on a copy). --grant pins the grant you reviewed: refused if another is in force.
    Exit 0 appended (or dry run) · 1 REFUSED, book untouched (a book that does not verify, nothing in force to carry, a
    pinned grant no longer in force, a raised rung, a loosening without its reason, a replay that re-performed nothing,
    a signer the door does not take) · 3 usage
riposte-verify succession --check <decision_id> --ledger <chain.jsonl> --inputs <inputs.jsonl> [--ruleset <r>] [--tolerance <t>]
                  [--trusted-keys <k>] [--root-keys <r>]
    anyone holding the documents re-performs the replay a succession on the book carries, over its own span. Exit 0 the
    same replay, byte for byte · 1 it differs (each difference named), or the grant carries no succession · 3 usage
riposte-verify decline --ledger <chain.jsonl> --key <person.pem> --signer <id> --policy <policy.json> (--assessment <assessment.json> | --workflow <id> --proposal <proposal_id> [--tier <tier>])
               --reason <text> [--note <text>] [--signed-at <iso>]
    a person's "no" to the proposal the BOOK raises now: Riposte reads the book again under --policy and signs a DECLINE only
    for the live proposal named (by the assessment the person read, verify voice --from-book's output, or by id), so a
    doctored assessment file never becomes a signed decline. It moves nothing and stops the re-raise until the evidence
    changes; stderr says it: "Kept at <rung> by <person>, <time>; stands until …" or "Not now: <person>, <time>; re-raises when …"
riposte-verify revise-policy --ledger <chain.jsonl> --key <person.pem> --signer <id> --from <prior.json> --draft <next.json> --reason <text> [--signed-at <iso>] [--out <policy-next.json>]
    a person revises the policy at a review, and Riposte builds the revision (revisePolicy): who (--signer), when, why,
    what changed, and the hash of the version it supersedes. --draft is the next version: { version, method?, tiers? }
    (a full policy file is fine; a revision inside it is replaced). --out writes the revised policy (never overwrites it)
riposte-verify revise-policy --ledger <chain.jsonl> --key <person.pem> --signer <id> --revised <policy.json>
    appends a revision already built with revisePolicy. --signer must be the revision's revised_by
  grant | decline | revise-policy | review | canary also take [--trusted-keys <keys.json>] ({"<signer_id>": "<public PEM>" |
  [...]}) and [--root-keys <root.pub.pem>] (the root public key: the key registry on the book anchors signers).
  Then only a key anchored to the signer passes the door. Without them the signer is UNANCHORED: the signature proves the
  key holder decided, not which person, and an unanchored decision moves no rung. The ledger file must exist (an empty
  file is a new book); a book that does not verify takes no decision. Exit 0 appended · 1 REFUSED (the reason is printed;
  nothing is appended) · 3 usage/error

Evidence integrity (the draw, the queue, signed reviews, the key registry, canaries):
riposte-verify sample commit --ledger <chain.jsonl> --policy <policy.json> --workflow <id> [--tier <tier>] [--trusted-keys <k>] [--root-keys <r>]
    the scheduled step (run it daily): commit every closed period's random review draw that is due. The seed is the chain,
    so nobody chooses the sample. Exit 0 committed (or nothing due) · 1 REFUSED · 3
riposte-verify queue --ledger <chain.jsonl> --policy <policy.json> --workflow <id> [--tier <tier>] [--trusted-keys <k>] [--root-keys <r>]
    a reviewer's queue: every drawn, still-unreviewed item, oldest first, with its deadline. Exit 0 · 1 the book did not verify
riposte-verify review --sign --ledger <chain.jsonl> --key <person.pem> --signer <id> --verdict <verdict_id> --decision UPHELD|OVERTURNED
              [--procedure re-performed|inspected] [--tenant <id>] [--note <text>] [--signed-at <iso>]
    a person's review as a SIGNED decision (the evidence a rung rests on; an agent can forge neither a clean record nor a slap)
riposte-verify key register --ledger <chain.jsonl> (--root <root.pem> | --key <admin.pem> --signer <id> --root-keys <root.pub.pem>)
                    --subject <id> --public-key <person.pub.pem> --roles key_admin,policy_author,reviewer,grant_signer,witness [--tenants <t1,t2>]
riposte-verify key revoke --ledger <chain.jsonl> (--root <root.pem> | --key <pem> --signer <id> --root-keys <root.pub.pem>)
                  --subject <id> --public-key <person.pub.pem> --reason <text>
    the key registry on the book: a key joins with its roles (segregation of duties), or leaves prospectively. Signed by the
    registry ROOT or a registered key_admin; every reader anchors with --root-keys (the root's public key, held out of band)
riposte-verify canary seal --ledger <chain.jsonl> --key <author.pem> --signer <id> --workflow <id> --verdicts <id,id,… | ids.json> --secret-out <secret.json>
riposte-verify canary reveal --ledger <chain.jsonl> --key <author.pem> --signer <id> --secret <secret.json> [--seal <decision_id>]
    reviewer attention, measured without telling the reviewer: seal known-bad recorded items (the book holds only a salted
    commitment; the ids and salt go to --secret-out, never overwritten: keep it secret), then the sealer reveals them
riposte-verify policy lint --policy <policy.json>
    the promotion policy's errors AND warnings (an unreachable bar: a min_n below its zero-miss n; sidedness). Exit 0 · 1 errors

Exit: 0 PASS/ok · 1 FAIL/not-ok · 2 INSUFFICIENT_DATA · 3 error`

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path === '-' ? 0 : path, 'utf8')) as Json
}

/** A labels file is either an array of {extraction,label} or an object { cases: [...] }. */
function readLabels(path: string): LabeledCase[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
  const arr = Array.isArray(raw) ? raw : (raw as { cases?: unknown }).cases
  if (!Array.isArray(arr)) throw new Error('labels file must be an array of {extraction,label} or { "cases": [...] }')
  return arr as LabeledCase[]
}

function runLint(argv: string[], io: CliIO): number {
  const a = parse(argv)
  if (a.help || !a.ruleset) { io.err(`${USAGE}\n`); return a.help ? 0 : 3 }
  let ruleset: DeclarativeRuleset
  try { ruleset = readJson(a.ruleset) as unknown as DeclarativeRuleset } catch (e) { io.err(`error reading ruleset: ${(e as Error).message}\n`); return 3 }
  const result = lintRuleset(ruleset)
  io.out(`${JSON.stringify(result, null, 2)}\n`)
  return result.ok ? 0 : 1
}

function runMeasure(argv: string[], io: CliIO): number {
  const a = parse(argv)
  if (a.help || !a.ruleset || !a.labels) { io.err(`${USAGE}\n`); return a.help ? 0 : 3 }
  let ruleset: DeclarativeRuleset, cases: LabeledCase[]
  try {
    ruleset = readJson(a.ruleset) as unknown as DeclarativeRuleset
    cases = readLabels(a.labels)
  } catch (e) { io.err(`error reading input: ${(e as Error).message}\n`); return 3 }
  const m = measureRuleset(ruleset, cases)
  io.out(`${renderMeasurement(m)}\n${JSON.stringify(m.accuracy, null, 2)}\n`)
  return 0
}

function runVerify(argv: string[], io: CliIO): number {
  const a = parse(argv)
  if (a.help || !a.file) { io.err(`${USAGE}\n`); return a.help ? 0 : 3 }
  let extraction: Json
  try { extraction = readJson(a.file) } catch (e) { io.err(`error reading extraction: ${(e as Error).message}\n`); return 3 }
  // The library's own refusal (src/protocol/input.ts): no document to bind a verdict to.
  const problem = extractionProblem(extraction)
  if (problem) { io.err(`verify: input refused: ${problem}\n`); return 3 }

  const opts: VerifyOptions = {}
  try {
    if (a.ruleset) {
      opts.ruleset = BUILTIN.has(a.ruleset) ? (a.ruleset as 'invoice' | 'pay-app') : (readJson(a.ruleset) as unknown as DeclarativeRuleset)
    }
    const references: NonNullable<VerifyOptions['references']> = {}
    if (a.contract) references.contract = readJson(a.contract)
    if (a.evidence.length) references.evidence = a.evidence.map(readJson)
    if (a.history.length) references.history = a.history.map(readJson)
    if (Object.keys(references).length) opts.references = references
    if (a.source) opts.source = { text: readFileSync(a.source, 'utf8') }
  } catch (e) { io.err(`error reading reference: ${(e as Error).message}\n`); return 3 }

  let verdict: Verdict
  try { verdict = verify(extraction, opts) } catch (e) {
    if (e instanceof InputRefused) { io.err(`verify: input refused: ${e.message}\n`); return 3 }
    throw e
  }
  io.out(`${JSON.stringify(verdict, null, 2)}\n`)
  return verdict.outcome === 'PASS' ? 0 : verdict.outcome === 'FAIL' ? 1 : 2
}

const REPLAY_FLAGS: FlagSpec = {
  inputs: 'value', extraction: 'value', ruleset: 'value', contract: 'value', evidence: 'multi', history: 'multi', source: 'value',
  tolerance: 'value', document: 'value', pre: 'value', 'filing-summary': 'value', schema: 'value',
}
/** The flags that build verify()'s inputs from the documents themselves (the same flags `verify <doc>` takes). */
const DOC_FLAGS = ['ruleset', 'contract', 'source'] as const

/**
 * `verify replay`: check a verdict someone handed you (red-team R1, 2026-09-28). The verdict_id binds the INPUTS, not the
 * outcome, so the binding alone never says the outcome is right. Given the inputs, the check is RE-PERFORMED here and the
 * recomputed verdict byte-compared with the presented one (issued_at and post-engine annotations aside):
 *   exit 0  REPERFORMED     the outcome was re-performed and is byte-identical: the outcome is verified
 *   exit 1  FAILED          the binding does not hold, the re-performed verdict differs (the first differing field is
 *                           named), or a signed envelope's signature does not verify
 *   exit 2  STRUCTURE_ONLY  structure verified; outcome NOT re-performed (no inputs, or nothing here can re-perform them)
 *   exit 3  not a verdict, or a usage/input error
 * The file may be a signed envelope ({ verdict, alg, public_key, signature }, signVerdict): its signature is checked too.
 */
function runReplay(argv: string[], io: CliIO): number {
  const verb = 'replay'
  const f = parseFlags(argv, REPLAY_FLAGS, { positional: 1 })
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  const file = f.args[0]
  if (!file) return usageError(io, verb, 'needs <verdict.json> (a verdict, or a signed envelope)')
  const docFlags = [...DOC_FLAGS.filter(n => f.v[n] !== undefined), ...(f.multi.evidence ? ['evidence'] : []), ...(f.multi.history ? ['history'] : [])]
  if (f.v.inputs !== undefined && (f.v.extraction !== undefined || docFlags.length)) {
    return usageError(io, verb, '--inputs is the whole input a verdict is bound to; --extraction [--ruleset/--contract/--evidence/--history/--source] builds it from the documents. Give one, not both')
  }
  if (f.v.extraction === undefined && docFlags.length) return usageError(io, verb, `${docFlags.map(n => `--${n}`).join(', ')} build verify()'s inputs with --extraction <doc.json>`)
  let raw: unknown, inputs: unknown, opts: ReplayOptions
  try {
    raw = readJson(file)
    inputs = f.v.inputs !== undefined ? readJson(f.v.inputs) : f.v.extraction !== undefined ? verifyInputsFrom(f) : undefined
    opts = replayOptions(f)
  } catch (e) { return inputError(io, verb, e) }
  const envelope = isObj(raw) && isObj(raw.verdict) && typeof raw.signature === 'string' && typeof raw.public_key === 'string'
  const verdict = (envelope ? (raw as { verdict: unknown }).verdict : raw) as Verdict
  if (f.v.extraction !== undefined && f.v.ruleset !== undefined && BUILTIN.has(f.v.ruleset) && isObj(verdict) && isObj(verdict.ruleset) && verdict.ruleset.id !== f.v.ruleset) {
    return usageError(io, verb, `--ruleset ${f.v.ruleset} is not the verdict's ruleset (${String(verdict.ruleset.id)}): a check is re-performed under the ruleset that made it`)
  }
  const result: ReplayCheck = verifyReplay(verdict, inputs, opts)
  let sig: { alg: string; signature_ok: boolean; key_fingerprint?: string; reason?: string } | undefined
  if (envelope) {
    const ec = verifyEnvelope(raw as unknown as SignedVerdict)
    const fp = keyFingerprint(String((raw as { public_key: unknown }).public_key))
    sig = { alg: String((raw as { alg?: unknown }).alg), signature_ok: ec.signature_ok, ...(fp ? { key_fingerprint: fp } : {}), ...(ec.reason ? { reason: ec.reason } : {}) }
  }
  io.out(`${JSON.stringify(sig ? { envelope: sig, ...result } : result, null, 2)}\n`)
  // A refusal (the file is not a verdict: nothing could be derived from it) is an input error, not a failed binding.
  if (result.refused) { io.err(`verify replay: input refused: ${result.reason ?? 'not a verdict'}\n`); return 3 }
  if (sig && !sig.signature_ok) { io.err(`verify replay: FAILED: the envelope's signature does not verify (${sig.reason ?? 'altered, or another key'})\n`); return 1 }
  const signed = sig ? ` The envelope's signature verifies (key ${sig.key_fingerprint?.slice(0, 12) ?? '?'}…): the body, outcome included, is what that key holder issued; anchor the key to its holder out of band.` : ''
  if (result.status === 'FAILED') { io.err(`verify replay: FAILED: ${result.reason ?? 'the verdict does not replay'}\n`); return 1 }
  if (result.status === 'REPERFORMED') {
    io.err(`verify replay: outcome VERIFIED: re-performed with ${result.reperformed?.engine} (engine ${verdict.engine_version}) and byte-identical, issued_at aside.${result.reperformed?.annotations?.length ? ` Not re-performed (not the engine's output): ${result.reperformed.annotations.join(', ')}.` : ''}${signed}\n`)
    return 0
  }
  io.err(`verify replay: ${result.not_reperformed ?? 'structure verified; outcome NOT re-performed'}.${signed} To re-perform it, pass the inputs (--inputs <inputs.json>, or --extraction <doc.json> with the flags the verdict was made with). Exit 2.\n`)
  return 2
}

/** verify()'s inputs from the documents, exactly as `verify <doc> [--ruleset] [--contract] [--evidence]… [--history]… [--source]` binds them. */
function verifyInputsFrom(f: Flags): Record<string, unknown> {
  const extraction = readJson(f.v.extraction as string)
  const rs = f.v.ruleset
  if (rs !== undefined && !BUILTIN.has(rs)) {
    const refs = [...(['contract', 'source'] as const).filter(n => f.v[n] !== undefined), ...(f.multi.evidence ? ['evidence'] : []), ...(f.multi.history ? ['history'] : [])]
    if (refs.length) throw new Error(`a declarative ruleset's verdict is bound to { extraction, ruleset } only, so ${refs.map(n => `--${n}`).join(', ')} cannot be part of it`)
    return { extraction, ruleset: readJson(rs) }
  }
  return {
    extraction,
    references: {
      contract: f.v.contract !== undefined ? readJson(f.v.contract) : null,
      evidence: (f.multi.evidence ?? []).map(readJson),
      history: (f.multi.history ?? []).map(readJson),
    },
    source: f.v.source !== undefined ? { text: readFileSync(f.v.source, 'utf8') } : null,
  }
}

/** --tolerance <json | file>: the rounding-tolerance override a verdict was issued under. */
function readTolerance(v: string): TolerancePolicy {
  const t = v.trim()
  const raw = JSON.parse(t.startsWith('{') ? t : readFileSync(t, 'utf8')) as unknown
  if (!isObj(raw) || typeof raw.rel !== 'number' || typeof raw.absCap !== 'number' || !(raw.rel >= 0) || !(raw.absCap >= 0)) {
    throw new Error('--tolerance must be { "rel": <fraction ≥ 0>, "absCap": <amount ≥ 0> } (inline JSON or a file)')
  }
  return { rel: raw.rel, absCap: raw.absCap }
}

/** --tolerance <json | file> (the override a verdict was issued under), --document, and the twin linkbase files. */
function replayOptions(f: Flags): ReplayOptions {
  const o: ReplayOptions = {}
  if (f.v.tolerance !== undefined) o.tolerance = readTolerance(f.v.tolerance)
  if (f.v.document !== undefined) o.document = readFileSync(f.v.document, 'utf8')
  const linkbase = readLinkbase({ ...(f.v.pre !== undefined ? { pre: f.v.pre } : {}), ...(f.v['filing-summary'] !== undefined ? { filingSummary: f.v['filing-summary'] } : {}), ...(f.v.schema !== undefined ? { schema: f.v.schema } : {}) })
  if (Object.keys(linkbase).length) o.presentation = linkbase
  return o
}

function runAp(argv: string[], io: CliIO): number {
  const a = parse(argv)
  if (a.help || (!a.file && !(a.invoice && a.po && a.receipt))) { io.err(`${USAGE}\n`); return a.help ? 0 : 3 }
  let docs: ApDocuments | null
  try {
    docs = a.file ? splitApLayout(readFileSync(a.file, 'utf8'))
      : { invoice: readFileSync(a.invoice as string, 'utf8'), purchase_order: readFileSync(a.po as string, 'utf8'), goods_receipt: readFileSync(a.receipt as string, 'utf8') }
  } catch (e) { io.err(`error reading documents: ${(e as Error).message}\n`); return 3 }
  if (!docs) { io.err('layout file must contain the "PURCHASE ORDER (ERP)" and "GOODS RECEIPT (ERP)" section markers\n'); return 3 }
  const r = verifyInvoiceMatch(docs)
  io.out(`${JSON.stringify(r, null, 2)}\n`)
  return r.decision === 'approve' ? 0 : r.decision === 'abstain' ? 2 : 1
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
  if (a.help) { io.err(`${USAGE}\n`); return 0 }
  if (a.unknown.length) { io.err(`verify mine: unknown option(s) ${a.unknown.join(', ')}\n${USAGE}\n`); return 3 }
  if (!a.file || (!a.schema && !a.ap)) { io.err(`verify mine needs <cases.jsonl> and --schema <schema.json> (or --ap)\n${USAGE}\n`); return 3 }
  let rate: number | undefined
  if (a.rate !== undefined) {
    rate = Number(a.rate)
    if (a.rate.trim() === '' || !Number.isFinite(rate) || rate < 0 || rate >= 1) { io.err(`--max-approved-violation-rate must be a number in [0, 1) (got "${a.rate}")\n`); return 3 }
  }
  // N2 (red-team, 2026-09-28): the compiled ruleset is never written over a file, like keygen's keys (exit 1, refused).
  if (a.rulesetOut && existsSync(a.rulesetOut)) return refused(io, 'mine', `${a.rulesetOut} already exists: a compiled ruleset is never written over a file (choose another --ruleset-out)`)
  let text: string, schema: MineSchema | undefined
  try {
    text = readFileSync(a.file === '-' ? 0 : a.file, 'utf8')
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
  if (a.help) { io.err(`${USAGE}\n`); return 0 }
  const foreign = [...a.unknown, ...(a.tenant !== undefined ? ['--tenant'] : [])]
  if (foreign.length) { io.err(`verify voice: unknown option(s) ${foreign.join(', ')}\n${USAGE}\n`); return 3 }
  if (!a.ledger || !a.policy) { io.err(`verify voice needs --ledger <chain.jsonl> and --policy <policy.json>\n${USAGE}\n`); return 3 }
  if (a.fromBook) return runVoiceFromBook(a, io)
  if (a.trustedKeys !== undefined || a.rootKeys !== undefined) { io.err(`verify voice: --trusted-keys / --root-keys anchor the signers of the decisions on the book; use them with --from-book\n${USAGE}\n`); return 3 }
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
    io.err(`verify voice: --from-book reads the rung, tier and bounds from the GRANT in force on the book, so ${flags.join(', ')} cannot be passed with it (a flag never overrides a person's signed grant)\n${USAGE}\n`)
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
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
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
  if (a.help) { io.err(`${USAGE}\n`); return 0 }
  if (unknown.length || !file) { io.err(`verify notice needs <verdict.json>${unknown.length ? ` (unknown option(s) ${unknown.join(', ')})` : ''}\n${USAGE}\n`); return 3 }
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
 * `verify opinion`: the courtroom opinion. Three questions:
 *   --from-book --workflow <wf> [--tier t]      the rung read from the book of record (the GRANT in force; --tier only while
 *                                               nothing is granted): promotionOpinion({ workflow_id }) (SW4)
 *   --proposal <p.json> | --workflow --tier ... the flag path (a supplied proposal, or a declared rung)
 *   --dispute <verdict_id> [--claim c]          one finding, disputed
 * Every form takes [--tenant t] (one tenant's records and decisions on a shared book) and [--trusted-keys] [--root-keys].
 */
function runOpinion(argv: string[], io: CliIO): number {
  const a = parseOpinionArgs(argv)
  if (a.help) { io.err(`${USAGE}\n`); return 0 }
  const unknown = [...a.unknown, ...(a.surface ? ['--surface'] : [])]
  if (unknown.length) { io.err(`verify opinion: unknown option(s) ${unknown.join(', ')}\n${USAGE}\n`); return 3 }
  if (!a.ledger) { io.err(`verify opinion needs --ledger <chain.jsonl>\n${USAGE}\n`); return 3 }
  if (a.fromBook) {
    const foreign = [
      ...(a.granted !== undefined ? ['--granted'] : []), ...(a.grant !== undefined ? ['--grant'] : []), ...(a.bounds !== undefined ? ['--bounds'] : []),
      ...(a.proposal !== undefined ? ['--proposal'] : []), ...(a.dispute !== undefined ? ['--dispute'] : []), ...(a.claim !== undefined ? ['--claim'] : []),
      ...(a.level !== undefined ? ['--level'] : []),
    ]
    if (foreign.length) { io.err(`verify opinion: --from-book reads the rung, tier and bounds from the GRANT in force on the book, so ${foreign.join(', ')} cannot be passed with it (a flag never overrides a person's signed grant)\n${USAGE}\n`); return 3 }
    if (!a.policy || !a.workflow) { io.err(`verify opinion --from-book needs --policy <policy.json> and --workflow <id>\n${USAGE}\n`); return 3 }
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
      if (!a.policy) { io.err(`verify opinion needs --policy <policy.json> (or --dispute <verdict_id>)\n${USAGE}\n`); return 3 }
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
  if (a.help) { io.err(`${USAGE}\n`); return 0 }
  if (a.unknown.length) { io.err(`verify twin: unknown option(s) ${a.unknown.join(', ')}\n${USAGE}\n`); return 3 }
  if (!a.html || !a.periodEnd || !a.claims) { io.err(`verify twin needs --html <primary.htm>, --period-end YYYY-MM-DD and --claims <claims.json>\n${USAGE}\n`); return 3 }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.periodEnd)) { io.err(`verify twin: --period-end must be YYYY-MM-DD (got "${a.periodEnd}")\n`); return 3 }
  const version = a.ruleset ?? '0.1'
  const map = Object.prototype.hasOwnProperty.call(TWIN_MAPS, version) ? TWIN_MAPS[version] : undefined
  if (!map) { io.err(`verify twin: --ruleset must be one of ${Object.keys(TWIN_MAPS).join(', ')} (got "${version}")\n`); return 3 }
  const statement = (map.binding ?? 'document') === 'statement'
  const linkbase = [...(a.pre !== undefined ? ['--pre'] : []), ...(a.filingSummary !== undefined ? ['--filing-summary'] : []), ...(a.schema !== undefined ? ['--schema'] : [])]
  if (!statement && linkbase.length) {
    io.err(`verify twin: ${linkbase.join(', ')} belong${linkbase.length === 1 ? 's' : ''} to the statement-anchored twin (--ruleset 0.2 or 0.2.1); v0.1 binds against the whole document and would ignore ${linkbase.length === 1 ? 'it' : 'them'}\n${USAGE}\n`)
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
    html = readFileSync(a.html, 'utf8')
    const raw = JSON.parse(readFileSync(a.claims, 'utf8')) as unknown
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
    // ABSTAINs (NO_PRESENTATION_LINKBASE): the statement-anchored twin never falls back to the whole document.
    const presentation = statement ? parseTwinPresentation(linkFiles, { links: map.links === 'strict' ? 'strict' : 'v0.2' }) : undefined
    r = verifyAgainstTwin(html, claims, {
      periodEnd: a.periodEnd, map,
      ...(statement ? { presentation: presentation ?? null } : {}),
      ...(typeof tolerance === 'number' ? { tolerance } : {}),
      ...(typeof periodToleranceDays === 'number' ? { periodToleranceDays } : {}),
    })
  } catch (e) { io.err(`verify twin: ${(e as Error).message}\n`); return 3 }
  io.out(`${JSON.stringify(r, null, 2)}\n`)
  if (statement && r.twin.presentation == null) io.err(`verify twin: no presentation linkbase was read (--pre / --filing-summary / --schema): the ${map.id}@${map.version} twin binds only through the filing's face statements, so every claim abstains (NO_PRESENTATION_LINKBASE)\n`)
  return r.verdict.outcome === 'PASS' ? 0 : r.verdict.outcome === 'FAIL' ? 1 : 2
}

/** The linkbase files named by --pre / --filing-summary / --schema, read as text (each optional). */
function readLinkbase(a: { pre?: string; filingSummary?: string; schema?: string }): TwinPresentationInput {
  return {
    ...(a.pre !== undefined ? { pre: readFileSync(a.pre, 'utf8') } : {}),
    ...(a.filingSummary !== undefined ? { filingSummary: readFileSync(a.filingSummary, 'utf8') } : {}),
    ...(a.schema !== undefined ? { schema: readFileSync(a.schema, 'utf8') } : {}),
  }
}

/** `verify twin-einvoice`: wiring only; the logic lives in src/twin-einvoice/ (the XML is the binding record). */
function runTwinEinvoice(argv: string[], io: CliIO): number {
  let xmlPath: string | undefined, claimsPath: string | undefined, profile: string | undefined, consistency = true
  const unknown: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === '--help' || t === '-h') { io.err(`${USAGE}\n`); return 0 }
    else if (t === '--claims') claimsPath = argv[++i]
    else if (t === '--profile') profile = argv[++i]
    else if (t === '--no-consistency') consistency = false
    else if (!t.startsWith('--') && xmlPath === undefined) xmlPath = t
    else unknown.push(t)
  }
  if (unknown.length) { io.err(`verify twin-einvoice: unknown option(s) ${unknown.join(', ')}\n${USAGE}\n`); return 3 }
  if (!xmlPath || !claimsPath) { io.err(`verify twin-einvoice needs <invoice.xml> and --claims <claims.json>\n${USAGE}\n`); return 3 }
  if (profile !== undefined && !['peppol-bis3', 'zatca-ksa', 'ksef-fa3'].includes(profile)) { io.err(`verify twin-einvoice: --profile must be peppol-bis3, zatca-ksa or ksef-fa3 (got "${profile}")\n`); return 3 }
  let xml: string, claims: EinvoiceClaim[]
  try {
    xml = readFileSync(xmlPath, 'utf8')
    const raw = JSON.parse(readFileSync(claimsPath, 'utf8')) as unknown
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
  io.out(`${JSON.stringify(r, null, 2)}\n`)
  return r.verdict.outcome === 'PASS' ? 0 : r.verdict.outcome === 'FAIL' ? 1 : 2
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
export function parseFlags(argv: readonly string[], spec: FlagSpec, opts: { positional?: number } = {}): Flags {
  const f: Flags = { v: {}, on: new Set(), multi: {}, args: [], help: false, problems: [] }
  const unknown: string[] = []
  const maxArgs = opts.positional ?? 0
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] as string
    if (t === '-h' || t === '--help') { f.help = true; continue }
    const name = t.startsWith('--') ? t.slice(2) : ''
    const kind = name && Object.prototype.hasOwnProperty.call(spec, name) ? spec[name] : undefined
    if (!kind) {
      if (maxArgs > 0 && (!t.startsWith('-') || t === '-')) {
        if (f.args.length < maxArgs) f.args.push(t)
        else f.problems.push(`unexpected argument ${t}`)
        continue
      }
      unknown.push(t)
      continue
    }
    if (kind !== 'multi' && (Object.prototype.hasOwnProperty.call(f.v, name) || f.on.has(name))) f.problems.push(`${t} is given twice`)
    if (kind === 'bool') { f.on.add(name); continue }
    const val = argv[i + 1]
    if (val === undefined || val.startsWith('--')) { f.problems.push(`${t} needs a value`); continue }
    if (kind === 'multi') (f.multi[name] ??= []).push(val)
    else f.v[name] = val
    i++
  }
  if (unknown.length) f.problems.unshift(`unknown option(s) ${unknown.join(', ')}`)
  return f
}

const need = (f: Flags, names: readonly string[]): string[] => names.filter(n => f.v[n] === undefined).map(n => `--${n}`)

function usageError(io: CliIO, verb: string, msg: string): number {
  io.err(`verify ${verb}: ${msg}\n${USAGE}\n`)
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
  const text = readFileSync(path, 'utf8')
  if (/PRIVATE KEY-----/.test(text)) throw new Error(`${path} holds a PRIVATE key: --root-keys takes the root's PUBLIC key (the .pub.pem verify keygen wrote); keep the private key offline`)
  const t = text.trim()
  let pems: string[]
  if (t.startsWith('{') || t.startsWith('[')) {
    const raw = JSON.parse(t) as unknown
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
  const keyPem = readFileSync(f.v.key as string, 'utf8')
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
    // append (N1, fixed in src/ledger/file.ts), so events never fuse onto one line.
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
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
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
  const raw = readFileSync(path, 'utf8')
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  const rows: unknown = text.trim().startsWith('[') ? JSON.parse(text) : text.split(/\r?\n/).filter(l => l.trim() !== '').map((l, i) => {
    try { return JSON.parse(l) as unknown } catch (e) { throw new Error(`--inputs line ${i + 1}: ${(e as Error).message}`) }
  })
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
  const raw = readJson(path) as unknown
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
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
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
    keyPem = f.v.key !== undefined ? readFileSync(f.v.key, 'utf8') : undefined
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
 * never become a signed decline (N4, closing C6: an assessment's hash is recomputable by anyone; the book is not). Name the
 * proposal either with the assessment the person read (--assessment: the output of verify voice --from-book, which must
 * match its own hash and cite this book) or directly (--workflow + --proposal). --policy is the policy the book is read under.
 */
function runDecline(argv: string[], io: CliIO): number {
  const verb = 'decline'
  const f = parseFlags(argv, DECLINE_FLAGS)
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
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
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
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
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
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
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
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

// ── precedent → statute (SW4): a person's signed ruling on LAW, and the rulebook the rulings imply ────────────────────

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
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
  if (f.problems.length) return usageError(io, verb, f.problems.join('; '))
  const missing = need(f, ['ledger', 'dispute', 'ruling', 'reason', 'key', 'signer'])
  if (missing.length) return usageError(io, verb, `needs ${missing.join(', ')}`)
  const ruling = f.v.ruling as LawRuling
  if (!LAW_RULINGS.includes(ruling)) return usageError(io, verb, `--ruling must be one of ${LAW_RULINGS.join(', ')} (got "${f.v.ruling}")`)
  let snap: LedgerSnapshot, keyPem: string, anchors: Anchors, inputs: unknown
  try {
    snap = readSnapshot(f.v.ledger as string, io, verb)
    keyPem = readFileSync(f.v.key as string, 'utf8')
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
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
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
    rulings = parseRulingBook(readFileSync(f.v.rulings as string, 'utf8'))
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
  if (sub === '-h' || sub === '--help') { io.err(`${USAGE}\n`); return 0 }
  if (sub !== 'commit') return usageError(io, 'sample', `the verb is \`verify sample commit\` (got ${sub === undefined ? 'nothing' : `"${sub}"`})`)
  const f = parseFlags(rest, SAMPLE_FLAGS)
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
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
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
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
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
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
  const text = readFileSync(path, 'utf8')
  if (/PRIVATE KEY-----/.test(text)) throw new Error(`${path} holds a PRIVATE key: register the PUBLIC key (the .pub.pem verify keygen wrote)`)
  const t = text.trim()
  const pem = t.startsWith('{') ? (JSON.parse(t) as { public_key?: unknown }).public_key : (t.match(PEM_PUBLIC) ?? [])[0]
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
  if (sub === '-h' || sub === '--help') { io.err(`${USAGE}\n`); return 0 }
  if (sub !== 'register' && sub !== 'revoke') return usageError(io, 'key', `the verbs are \`verify key register\` and \`verify key revoke\` (got ${sub === undefined ? 'nothing' : `"${sub}"`})`)
  const verb = `key ${sub}`
  const f = parseFlags(rest, KEY_FLAGS)
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
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
    keyPem = readFileSync((f.v.root ?? f.v.key) as string, 'utf8')
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
  if (sub === '-h' || sub === '--help') { io.err(`${USAGE}\n`); return 0 }
  if (sub !== 'seal' && sub !== 'reveal') return usageError(io, 'canary', `the verbs are \`verify canary seal\` and \`verify canary reveal\` (got ${sub === undefined ? 'nothing' : `"${sub}"`})`)
  const verb = `canary ${sub}`
  const f = parseFlags(rest, CANARY_FLAGS)
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
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
  if (sub === '-h' || sub === '--help') { io.err(`${USAGE}\n`); return 0 }
  if (sub !== 'lint') return usageError(io, 'policy', `the verb is \`verify policy lint\` (got ${sub === undefined ? 'nothing' : `"${sub}"`})`)
  const verb = 'policy lint'
  const f = parseFlags(rest, { policy: 'value' })
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
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
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
  const t = text.trim()
  if (t.startsWith('[') || /^\{\s*"extractions"\s*:/.test(t)) {
    const raw = JSON.parse(t) as unknown
    const arr = Array.isArray(raw) ? raw : isObj(raw) ? raw.extractions : undefined
    if (!Array.isArray(arr)) throw new Error('--extractions must be a JSON array, { "extractions": [...] }, or JSONL (one extraction per line)')
    return arr
  }
  return text.split(/\r?\n/).filter(l => l.trim() !== '').map((l, i) => {
    try { return JSON.parse(l) as unknown } catch (e) { throw new Error(`--extractions line ${i + 1}: ${(e as Error).message}`) }
  })
}

/** --rungs: inline JSON ({"<workflow>": "gate"}) or a file holding it. */
function readRungs(v: string): Record<string, VoiceLevel> {
  const raw = JSON.parse(v.trim().startsWith('{') ? v : readFileSync(v, 'utf8')) as unknown
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
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
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
  if (sub === '-h' || sub === '--help') { io.err(`${USAGE}\n`); return 0 }
  if (sub !== 'repair' && sub !== 'export') return usageError(io, 'ledger', `the verbs are \`verify ledger repair <book>\` and \`verify ledger export <book> --out <file>\` (got ${sub === undefined ? 'nothing' : `"${sub}"`})`)
  const verb = `ledger ${sub}`
  const f = parseFlags(rest, LEDGER_FLAGS, { positional: 1 })
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
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
  if (sub === '-h' || sub === '--help') { io.err(`${USAGE}\n`); return 0 }
  if (sub !== 'checkpoint' && sub !== 'verify') return usageError(io, 'anchor', `the verbs are \`verify anchor checkpoint\` and \`verify anchor verify\` (got ${sub === undefined ? 'nothing' : `"${sub}"`})`)
  const verb = `anchor ${sub}`
  const f = parseFlags(rest, sub === 'checkpoint' ? ANCHOR_CHECKPOINT_FLAGS : ANCHOR_VERIFY_FLAGS)
  if (f.help) { io.err(`${USAGE}\n`); return 0 }
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
  try { keyPem = readFileSync(f.v.key as string, 'utf8') } catch (e) { return inputError(io, verb, e, 'error reading --key') }
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

const VERBS: Readonly<Record<string, (argv: string[], io: CliIO) => number>> = {
  lint: runLint, measure: runMeasure, replay: runReplay, ap: runAp, mine: runMine, voice: runVoice, notice: runNotice,
  twin: runTwin, 'twin-einvoice': runTwinEinvoice, opinion: runOpinion,
  grant: runGrant, succession: runSuccession, decline: runDecline, 'revise-policy': runRevisePolicy, keygen: runKeygen, report: runReport,
  rule: runRule, statute: runStatute, sample: runSample, queue: runQueue, review: runReview, key: runKey, canary: runCanary,
  policy: runPolicy, reconcile: runReconcile, ledger: runLedger, anchor: runAnchor,
}

export function run(argv: string[], io: CliIO = PROCESS_IO): number {
  try {
    const [first, ...rest] = argv
    const verb = first !== undefined && Object.prototype.hasOwnProperty.call(VERBS, first) ? VERBS[first] : undefined
    return verb ? verb(rest, io) : runVerify(argv, io)
  } catch (e) {
    // Nothing throws out of run(): an unexpected error is reported, never a stack trace from the process.
    io.err(`verify: internal error: ${e instanceof Error ? e.message : String(e)}\n`)
    return 3
  }
}

// Run when invoked directly.
if (process.argv[1] && (process.argv[1].endsWith('cli.js') || process.argv[1].endsWith('cli.ts'))) {
  process.exit(run(process.argv.slice(2)))
}
