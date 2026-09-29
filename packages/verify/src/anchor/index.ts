/**
 * External anchoring of the book of record. See ./checkpoint.ts (signed checkpoints of the chain head, and the check of a book
 * against them), ./witness.ts (where checkpoints are published; file writers only, no network), ./rfc3161.ts (a time-stamp
 * authority's token over a checkpoint, verified offline) and docs/ANCHORING.md.
 */

export {
  checkpoint, signCheckpoint, verifyCheckpoint, verifyAgainstCheckpoints, verifyCheckpointSignature, checkpointBodyProblem,
  checkpointMessage, checkpointDigest, checkpointId, CheckpointRefused, CHECKPOINT_VERSION, CHECKPOINT_SIGNING_PREFIX, WITNESS_ROLE,
} from './checkpoint.js'
export type {
  Checkpoint, CheckpointBody, CheckpointOptions, CheckpointCheck, CheckpointStatus, AnchorReport, AnchorCheckOptions, WitnessAnchors,
  WitnessKeys, WitnessVia, Book,
} from './checkpoint.js'
export { fileWitness, dirWitness, readWitnessFile, readWitnessDir, latestCheckpoint, WitnessStoreCorrupt } from './witness.js'
export type { CheckpointWriter, PublishReceipt } from './witness.js'
export { verifyTimestampToken, verifyCheckpointTimestamp } from './rfc3161.js'
export type { TimestampTrust, TimestampCheck } from './rfc3161.js'
