/**
 * Publishing checkpoints: where a checkpoint goes so the book's writer cannot take it back (2026-09-28).
 *
 * A checkpoint anchors nothing while it sits beside the book it protects. It must reach storage that the party with write
 * access to the book cannot rewrite: a WORM / object-lock bucket the customer controls, a separate account, an auditor's
 * system, an RFC 3161 time-stamp authority, a transparency log. The engine makes no network call, so it ships only FILE
 * writers, meant to point at such storage (a locally mounted object-lock volume, a directory a sync agent ships to one).
 * Anything that talks to a network is a CheckpointWriter the deployment supplies. Publication is OFF by default: nothing
 * here runs unless a deployment calls it.
 *
 *   fileWitness(path)  one canonical JSON line per checkpoint, appended and fsynced. Refuses a line that would fork the
 *                      log: after a book's first checkpoint, each one names the last as its prev_checkpoint.
 *   dirWitness(dir)    one file per checkpoint, created exclusively (never overwritten): suits object-lock buckets, where
 *                      each object is written once and retained.
 *
 * The external-target contract (not shipped; see docs/ANCHORING.md): publish(cp) sends checkpointDigest(cp) (32 bytes, the
 * sha256 of exactly what the witness signed) and returns a receipt whose `evidence` is what the target handed back, e.g. an
 * RFC 3161 TimeStampToken (base64 DER), which ./rfc3161.ts verifies offline against a pinned TSA certificate.
 */

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalize } from '../verdict/canonical.js'
import { CheckpointRefused, verifyCheckpointSignature, type Checkpoint } from './checkpoint.js'

export interface PublishReceipt {
  /** The writer's name for its target. */
  target: string
  checkpoint_id: string
  /** Where it went (a path, a URL, an object key). */
  location: string
  /** False when the checkpoint was already there (publishing is idempotent). */
  appended: boolean
  /** What an external target returned as its own proof (e.g. { kind: 'rfc3161', data: <base64 DER TimeStampToken> }). */
  evidence?: { kind: string; data: string }
}

/** Where checkpoints are published. The engine ships file writers only; a network target is the deployment's. */
export interface CheckpointWriter {
  readonly target: string
  publish(cp: Checkpoint): PublishReceipt | Promise<PublishReceipt>
}

export class WitnessStoreCorrupt extends Error {
  constructor(readonly path: string, readonly line: number, reason: string) {
    super(`${path}:${line}: ${reason}`)
    this.name = 'WitnessStoreCorrupt'
  }
}

function assertPublishable(cp: Checkpoint): void {
  const sig = verifyCheckpointSignature(cp)
  if (!sig.ok) throw new CheckpointRefused(`not published: ${sig.reason}`)
}

/** The latest checkpoint of a book in a list (by length, then list order). */
export function latestCheckpoint(cps: readonly Checkpoint[], book_id?: string): Checkpoint | undefined {
  let best: Checkpoint | undefined
  for (const cp of cps) if (cp.body.book_id === book_id && (!best || cp.body.length >= best.body.length)) best = cp
  return best
}

/** Would appending `cp` after `existing` fork the book's checkpoint log? (undefined: it links.) */
function forkProblem(existing: readonly Checkpoint[], cp: Checkpoint): string | undefined {
  const last = latestCheckpoint(existing, cp.body.book_id)
  if (!last) return undefined
  if (cp.body.prev_checkpoint !== last.checkpoint_id) {
    return `the witness store's last checkpoint of this book is ${last.checkpoint_id.slice(0, 12)}… (length ${last.body.length}); a new one names it as prev_checkpoint (got ${cp.body.prev_checkpoint?.slice(0, 12) ?? 'none'})`
  }
  return undefined
}

/** Read a witness file (one checkpoint per line). A missing file is an empty store. Lines are parsed, not verified. */
export function readWitnessFile(path: string): Checkpoint[] {
  if (!existsSync(path)) return []
  const out: Checkpoint[] = []
  const lines = readFileSync(path, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (!line.trim()) return
    try {
      out.push(JSON.parse(line) as Checkpoint)
    } catch {
      throw new WitnessStoreCorrupt(path, i + 1, 'not a JSON checkpoint')
    }
  })
  return out
}

/** Append-only witness file. Idempotent for a checkpoint already present; refuses one that forks the book's log. */
export function fileWitness(path: string): CheckpointWriter {
  return {
    target: `file:${path}`,
    publish(cp: Checkpoint): PublishReceipt {
      assertPublishable(cp)
      const existing = readWitnessFile(path)
      if (existing.some(e => e.checkpoint_id === cp.checkpoint_id)) return { target: `file:${path}`, checkpoint_id: cp.checkpoint_id, location: path, appended: false }
      const fork = forkProblem(existing, cp)
      if (fork) throw new CheckpointRefused(`not published: ${fork}`)
      const fd = openSync(path, 'a')
      try {
        writeSync(fd, canonicalize(cp) + '\n')
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      return { target: `file:${path}`, checkpoint_id: cp.checkpoint_id, location: path, appended: true }
    },
  }
}

const fileNameOf = (cp: Checkpoint): string =>
  `${(cp.body.book_id ?? 'book').replace(/[^A-Za-z0-9._-]/g, '_')}-${String(cp.body.length).padStart(12, '0')}-${cp.checkpoint_id.slice(0, 16)}.json`

/** Read a witness directory (one checkpoint per *.json file, in name order). */
export function readWitnessDir(dir: string): Checkpoint[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => {
    try {
      return JSON.parse(readFileSync(join(dir, f), 'utf8')) as Checkpoint
    } catch {
      throw new WitnessStoreCorrupt(join(dir, f), 1, 'not a JSON checkpoint')
    }
  })
}

/** One file per checkpoint, created exclusively ('wx': an existing object is never overwritten). */
export function dirWitness(dir: string): CheckpointWriter {
  return {
    target: `dir:${dir}`,
    publish(cp: Checkpoint): PublishReceipt {
      assertPublishable(cp)
      mkdirSync(dir, { recursive: true })
      const existing = readWitnessDir(dir)
      const location = join(dir, fileNameOf(cp))
      if (existing.some(e => e.checkpoint_id === cp.checkpoint_id)) return { target: `dir:${dir}`, checkpoint_id: cp.checkpoint_id, location, appended: false }
      const fork = forkProblem(existing, cp)
      if (fork) throw new CheckpointRefused(`not published: ${fork}`)
      const fd = openSync(location, 'wx')
      try {
        writeSync(fd, canonicalize(cp) + '\n')
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      return { target: `dir:${dir}`, checkpoint_id: cp.checkpoint_id, location, appended: true }
    },
  }
}
