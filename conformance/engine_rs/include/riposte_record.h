/* SPDX-License-Identifier: Apache-2.0 */
/*
 * riposte_record.h: the C ABI of the record tier reader in Rust (conformance/engine_rs). Prototype; no measured accuracy.
 * Written by hand (no header generator was at hand when it was written); src/lib.rs is the source it follows, ABI version 1.
 *
 * Every function reads buffers it is given and returns an exit code; none writes, signs or re-performs anything. A pointer may
 * be NULL only where a function says so. Text arguments (PEM keys, head records) must be UTF-8. A return of -1 is an internal
 * error caught at the boundary.
 *
 * Link: riposte_record.dll.lib + riposte_record.dll (Windows), libriposte_record.so or .dylib, or the static library
 * (riposte_record.lib / libriposte_record.a, with the platform's system libraries). For wasm32-unknown-unknown the same names
 * are exports of riposte_record.wasm; riposte_alloc and riposte_free give the host buffers in the module's memory.
 */
#ifndef RIPOSTE_RECORD_H
#define RIPOSTE_RECORD_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define RIPOSTE_RECORD_ABI_VERSION 1
#define RIPOSTE_RECORD_INTERNAL_ERROR (-1)

/* The ABI version the library was built with (1). */
uint32_t riposte_record_abi_version(void);

/*
 * One frag.json (riposte.frag/0.1.0), its bytes:
 *   2  the id recomputes over lock + claim + proof and the signature verifies by the key the frag carries (the issuer, the
 *      cover sentence, the record and the pins are outside one buffer, so this is "intact, and some of it cannot be told here")
 *   3  not a frag (not UTF-8, refused by the strict JSON reader, or not the frag's shape)
 *   4  tampered: the id does not recompute, or the signature does not verify
 * ptr may be NULL only when len is 0.
 */
int32_t riposte_verify_frag(const uint8_t *ptr, size_t len);

/*
 * The same, with the issuer's Ed25519 public key in PEM (issuer_ptr, issuer_len; not NULL):
 *   0  the id recomputes and the issuer's key signed it
 *   3  not a frag, or the key is not UTF-8
 *   4  tampered, or signed by another key, or the issuer key cannot be read
 */
int32_t riposte_verify_frag_issued(const uint8_t *ptr, size_t len, const uint8_t *issuer_ptr, size_t issuer_len);

/*
 * A receipts ledger (one JSON entry per line), as `riposte-ledger verify` answers it:
 *   0  verified: the hash chain holds, every signature present verifies, the head record (if given) agrees or is behind
 *   1  not verified: a broken chain, a line the strict reader refuses, a signature that does not verify or is not the pinned
 *      key's, an unsigned entry under a pinned key or require_signed, a cut or rewrite the head record shows, a torn tail
 *   3  the bytes cannot be read as a ledger (not UTF-8, a line before the last that is not JSON), or a key that cannot be read
 * head_ptr: the head record's bytes (<ledger>.head.json), or NULL not to read one (--no-sidecar).
 * key_ptr: an Ed25519 public key in PEM to pin, or NULL for none. require_signed: nonzero to require every entry signed.
 */
int32_t riposte_verify_ledger(const uint8_t *ledger_ptr, size_t ledger_len,
                              const uint8_t *head_ptr, size_t head_len,
                              const uint8_t *key_ptr, size_t key_len,
                              int32_t require_signed);

/* A buffer of len bytes for a host without its own allocator (a WebAssembly host); free it with riposte_free(ptr, len). */
uint8_t *riposte_alloc(size_t len);
void riposte_free(uint8_t *ptr, size_t len);

#ifdef __cplusplus
}
#endif

#endif /* RIPOSTE_RECORD_H */
