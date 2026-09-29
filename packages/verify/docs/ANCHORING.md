# Anchoring the book of record

The ledger is a hash chain. Each event carries the hash of the one before it, so an edit to any past event breaks every
hash after it. That catches a careless edit. It does not catch a careful one. Someone with write access to the book file
can change an old verdict and **recompute every hash after it**, and the rewritten chain then verifies on its own. Nothing
inside the book can show the difference.

Anchoring fixes that by keeping a small, signed statement of the chain head **outside the book**, where the book's writer
can't reach it. This page says what that statement proves and what it doesn't, how to run it, and what it changes (and
doesn't change) about the regulatory wording.

Module: `src/anchor/` (`checkpoint.ts`, `witness.ts`, `rfc3161.ts`). Tests: `test/anchor.test.ts`, `test/anchor-rfc3161.test.ts`.

## The checkpoint

```
{ checkpoint_version, book_id?, length, head, as_of, prev_checkpoint?, witness_id }   signed Ed25519 by a WITNESS key
```

A checkpoint says: *the first `length` events of this book hash to `head`, and the chain's own clock read `as_of` at that
point.*

- **`as_of`** comes from the chain, not from the witness. It is the running maximum of the event timestamps.
- **`prev_checkpoint`** links each checkpoint to the one before it, so the checkpoints form a chain of their own. If one is
  deleted from the witness store, the gap shows.
- **The signature** covers `riposte:checkpoint:v0\n` + the canonical body. That prefix separates checkpoint signatures from
  decision signatures, so neither can be replayed as the other.
- **Deterministic:** the same book and the same key give byte-identical checkpoints.

| Call | What it does |
|---|---|
| `checkpoint(book, { key, witness_id, length?, prev?, book_id? })` | Verifies the book first and signs nothing over a broken one. Refuses a position the book hasn't reached. Refuses a `prev` whose anchored head the book no longer holds: a witness never extends a rewritten history. |
| `verifyAgainstCheckpoints(book, checkpoints, anchors)` | Checks the book against every checkpoint and reports the **first anchored position that fails**, plus the range of events the change must lie in. |
| `verifyCheckpoint(cp, book, anchors)` | The same check for a single checkpoint. |

Statuses `verifyAgainstCheckpoints` reports, per checkpoint:

| Status | Meaning |
|---|---|
| `held` | The book's first `length` events verify and reach the anchored head at the anchored clock. |
| `rewritten` | They verify internally but reach a different head, or a different clock. The anchored prefix was changed. |
| `broken` | The book doesn't verify internally inside the anchored prefix: it was edited without recomputing. |
| `truncated` | The book ends before `length`. Anchored events were removed, or the checkpoint belongs to another book. |
| `refused` | The checkpoint doesn't count: it is malformed, was altered after signing, or wasn't signed by an anchored witness. |
| `unverified` | It was signed under the book's own registry, which can't be read past a break in the book. |

**The attack this exists for** (`test/anchor.test.ts`, "THE INSIDER REWRITE"):

1. An insider re-records the whole history through the engine, swapping one held payment (FAIL) for a PASS.
2. The forged book passes every internal check: `verifyChain`, `verifyChainAgainst`, and the full content read
   (`readDecisionBook`, which also holds event headers to their payloads).
3. Checked against checkpoints at 2, 5 and 8 events, the forgery **fails at the checkpoint at 5**. The report names events
   2 to 4 as the range the change lies in.

The same file also tests that:

- a checkpoint over the forged book signed by the insider under the witness's name is refused;
- a checkpoint past the end of the book is refused;
- a book truncated past a checkpoint is reported as truncated.

## What anchoring proves, and what it doesn't

**It proves** that the anchored prefix is exactly what existed when the checkpoint was made. Once the checkpoint is
published somewhere with a trusted time (an RFC 3161 token, or the retention date of an object-lock store), it also proves
the prefix existed **by then**.

**It doesn't prove:**

- **That the content was right.** A checkpoint pins what was recorded, not whether the verdict was correct. Accuracy is the
  review record's job, measured through overturn rates.
- **That nothing was left out before recording.** An invoice that was paid but never verified never reaches the book. That
  is **completeness**, and it's `reconcile`'s job: the payment population is checked against the book.
- **Anything after the last checkpoint.** Events since the latest checkpoint are only as safe as the book file itself. The
  checkpoint interval is your exposure window.
- **Every header timestamp.** `as_of` binds the running maximum. The content check (`verifyContent` / `readDecisionBook`)
  holds each event's header to its hashed payload.
- **A way to recover the original.** A checkpoint tells you a rewrite happened; it doesn't give you back what was there
  before. Recovering the original needs a retained copy of the book (see the recipe below).

**Who the witness is decides what the checkpoint is worth:**

- **Out-of-band witness keys (`witness_keys`), the strong mode.** The witness is a party **without write access to the
  book**: the customer's internal audit, a separate operations team, or the external auditor. Its public key reaches the
  verifier by a route that doesn't pass through the book.
- **A key registered on the book with the `witness` role (`root_keys`), the weaker mode.** The registry is signed by the
  root key, so a rewriter can't add a witness. But the grant of the role lives inside the book the checkpoint protects, so
  a rewriter could drop a later revocation of a compromised witness key.
  - A key that also administers the key registry is never accepted as a witness.
  - The `witness` role isn't in the registry's role list yet. Until it's added, this route refuses every checkpoint.

## RFC 3161 time-stamps, verified offline

A time-stamp authority (TSA) is a third party that signs a statement that a given digest existed by a given time. RFC 3161
§1 (raw text, rfc-editor.org): *"The TSA's role is to time-stamp a datum to establish evidence indicating that a datum
existed before a particular time."*

The digest to send a TSA is `checkpointDigest(cp)`: the SHA-256 of exactly what the witness signed. Getting the token is
a network call, so it belongs to the deployment. The engine makes none.

`verifyCheckpointTimestamp(cp, token, { tsa_certs?, tsa_roots? })` checks the token offline, with no new dependency (a
minimal DER reader plus `node:crypto`). It checks all of the following:

- the token is a CMS SignedData with exactly one signer, whose content is a TSTInfo;
- the stamped imprint is SHA-256 and equals the checkpoint's digest;
- the signed `contentType` and `messageDigest` attributes are correct;
- the signing-certificate attribute (v1 or v2) names the TSA certificate;
- that certificate is trusted: either **pinned**, or **issued directly by a supplied root**;
- the certificate carries the `timeStamping` extended key usage and was valid at the token's time;
- the RSA (PKCS#1 v1.5) or ECDSA signature verifies.

It refuses the following rather than guessing:

- RSA-PSS and EdDSA TSA signers;
- SHA-1 digests;
- certificate chains longer than one level;
- revocation checking (CRL/OCSP).

The test fixture comes from a throwaway OpenSSL TSA (RSA and EC signers), and OpenSSL's own `ts -verify` accepted both
tokens. The TSA's private keys were deleted after issuing.

## The operational recipe

1. **Choose the witness.** Generate an Ed25519 key for a party that has no write access to the book. Give its public key
   to whoever verifies (for example, your auditor) out of band. Don't store the witness's private key on the host that
   writes the book.
2. **Checkpoint on a schedule.** At least once a day at close, and also:
   - at each sampling-period close;
   - before any export handed to an auditor.

   Each checkpoint names the previous one (`prev`), so the witness verifies the book against its own last checkpoint before
   it signs.
3. **Publish where the writer can't reach.**
   - `dirWitness(dir)` writes one file per checkpoint and never overwrites. Point it at a directory synced to an object-lock
     bucket in compliance mode, with retention at least as long as the book's.
   - `fileWitness(path)` appends one line per checkpoint and refuses a fork. Use it on WORM media.
   - Optionally, also send `checkpointDigest(cp)` to an RFC 3161 TSA and keep the token next to the checkpoint.
4. **Keep a copy of the book, too.** Ship the chain export (`verify ledger export`) or its daily segments to the same
   locked storage. A checkpoint shows that a rewrite happened. The retained copy is what lets you re-create the original.
5. **Verify before relying on the book.** Run `verifyAgainstCheckpoints(book, checkpoints, { witness_keys })` before an
   audit, before a promotion decision, and on a schedule. The auditor runs it independently, with their own copy of the
   checkpoints and the witness key they hold.

## The regulatory wording, corrected

Until now the product said the ledger is *designed toward* SEC Rule 17a-4(f)'s audit-trail alternative and PCAOB AS 1215's
retention requirement. That was the honest verb for a chain that anyone with write access could recompute. Anchoring closes
that specific gap. It doesn't make a deployment compliant by itself.

**SEC Rule 17a-4(f)(2)** (17 CFR 240.17a-4, raw text from the eCFR). An electronic recordkeeping system must:

> (i)(A) Preserve a record for the duration of its applicable retention period in a manner that maintains a complete
> time-stamped audit trail that includes: (1) All modifications to and deletions of the record or any part thereof; (2) The
> date and time of actions that create, modify, or delete the record; (3) If applicable, the identity of the individual
> creating, modifying, or deleting the record; and (4) Any other information needed to maintain an audit trail of the record
> in a way that maintains security, signatures, and data to ensure the authenticity and reliability of the record and will
> permit re-creation of the original record if it is modified or deleted; or (B) Preserve the records exclusively in a
> non-rewriteable, non-erasable format;

The same paragraph goes on to further duties: (ii) verify automatically the completeness and accuracy of the processes for
storing and retaining records, and more beyond that.

**PCAOB AS 1215.16** (raw text, pcaobus.org):

> Audit documentation must not be deleted or discarded after the documentation completion date, however, information may
> be added. Any documentation added must indicate the date the information was added, the name of the person who prepared
> the additional documentation, and the reason for adding it.

AS 1215 governs the **auditor's** documentation. The book is evidence an auditor may use, so the comparison is by analogy.

**The corrected verb.** With anchoring configured, the ledger **supports** a customer's audit-trail approach:

- corrections are appends, never edits;
- every event is time-stamped by the chain;
- signed decisions carry who and when;
- a rewrite of anchored history is detectable by a party outside the book.

Whether a deployment **satisfies** 17a-4(f) or any retention rule is the customer's determination, with its compliance
counsel and auditor. This product doesn't make that claim.

**What the customer must still do** before anyone can make that determination:

- **Storage controls.** Keep the witness store and the retained copies of the book on locked (WORM / object-lock)
  storage, with retention at least as long as the rule's.
- **The witness key.** Held by a party without write access to the book, and never on the writing host.
- **Access controls.** Decide and review who can write the book file, operate the ledger, and administer its key
  registry.
- **Identity binding.** Tie each signing key to a person (the registry records the binding; the customer's identity
  process makes it true).
- **The rule's other elements.** The rest of 17a-4(f), such as the automatic verification in (f)(2)(ii) and the
  undertakings, are organizational or vendor duties this engine doesn't perform.
- **A schedule.** Checkpoint, publish and verify on a cadence the customer sets and evidences.
