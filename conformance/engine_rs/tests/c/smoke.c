/* SPDX-License-Identifier: Apache-2.0 */
/* A C caller of include/riposte_record.h: reads the files named on the command line and prints each exit code.
 *   smoke <frag.json> <issuer.pub.pem> <ledger.jsonl> <ledger.head.json> <key.pub.pem>
 * Prototype; no measured accuracy. */
#include <stdio.h>
#include <stdlib.h>
#include "riposte_record.h"

static uint8_t *slurp(const char *path, size_t *len) {
    FILE *f = fopen(path, "rb");
    uint8_t *b;
    long n;
    if (!f) { fprintf(stderr, "cannot read %s\n", path); exit(3); }
    fseek(f, 0, SEEK_END);
    n = ftell(f);
    fseek(f, 0, SEEK_SET);
    b = (uint8_t *)malloc(n > 0 ? (size_t)n : 1);
    *len = fread(b, 1, (size_t)n, f);
    fclose(f);
    return b;
}

int main(int argc, char **argv) {
    size_t fl, il, ll, hl, kl;
    uint8_t *frag, *issuer, *ledger, *head, *key;
    if (argc != 6) { fprintf(stderr, "usage: smoke <frag.json> <issuer.pem> <ledger.jsonl> <head.json> <key.pem>\n"); return 3; }
    frag = slurp(argv[1], &fl);
    issuer = slurp(argv[2], &il);
    ledger = slurp(argv[3], &ll);
    head = slurp(argv[4], &hl);
    key = slurp(argv[5], &kl);
    printf("abi %u\n", riposte_record_abi_version());
    printf("verify_frag %d\n", riposte_verify_frag(frag, fl));
    printf("verify_frag_issued %d\n", riposte_verify_frag_issued(frag, fl, issuer, il));
    printf("verify_ledger(head, key) %d\n", riposte_verify_ledger(ledger, ll, head, hl, key, kl, 0));
    printf("verify_ledger(no head, no key, require_signed) %d\n", riposte_verify_ledger(ledger, ll, NULL, 0, NULL, 0, 1));
    ledger[ll / 2] ^= 1; /* one bit flipped in the middle of the ledger */
    printf("verify_ledger(one bit flipped) %d\n", riposte_verify_ledger(ledger, ll, head, hl, key, kl, 0));
    free(frag); free(issuer); free(ledger); free(head); free(key);
    return 0;
}
