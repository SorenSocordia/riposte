# Timestamp authority roots

The bench preregs in `docs/bench/<id>/` carry RFC 3161 timestamps from DigiCert's timestamp authority (`<prereg>.tsr`,
beside each prereg it covers). These files are the public roots that DigiCert's timestamp chain ends at. They ship here so
a reader can verify the stamps without fetching anything.

| file | certificate | SHA-256 fingerprint |
|---|---|---|
| `digicert-assured-id-root-ca.pem` | DigiCert Assured ID Root CA, self-signed, valid 2006-11-10 to 2031-11-10 | `3E:90:99:B5:01:5E:8F:48:6C:00:BC:EA:9D:11:1E:E7:21:FA:BA:35:5A:89:BC:F1:DF:69:56:1E:3D:C6:32:5C` |
| `digicert-trusted-root-g4.pem` | DigiCert Trusted Root G4, self-signed, valid 2013-08-01 to 2038-01-15 | `55:2F:7B:DC:F1:A7:AF:9E:6C:E6:72:01:7F:4F:12:AB:F7:72:40:C7:8E:76:1A:C2:03:D1:D9:D2:0A:C8:99:88` |
| `digicert-roots.pem` | both roots above, in that order, in one file | the two fingerprints above |

## Where they come from

DigiCert publishes both roots at these addresses:

- DigiCert Assured ID Root CA: <https://cacerts.digicert.com/DigiCertAssuredIDRootCA.crt.pem>
- DigiCert Trusted Root G4: <https://cacerts.digicert.com/DigiCertTrustedRootG4.crt.pem>

The two single-root files were exported from an operating system's trusted root store. On 2026-10-05 the certificates
served at the two addresses above had the same SHA-256 fingerprints as the files here. Compare the fingerprints with your
own trusted copy before you rely on them: a root is only as good as the place you got it from.

## The stamp rule

From 2026-10-05, every preregistration is stamped by the timestamp authority before its run. The bench page,
`docs/BENCH.md`, states the rule. From the repository root, this sends the file's sha256 (never the file) and writes the
query beside it as `<prereg>.tsq` and the authority's signed reply as `<prereg>.tsr`:

```bash
node packages/verify/dist/cli.js bench stamp packages/verify/docs/bench/<id>/PREREG.md --tsa http://timestamp.digicert.com
```

Without `--tsa`, the command writes the query and contacts nothing. Each table's Stamp line on the bench page gives the
stamp's time beside the run's time, and says when a stamp came after its run.

## Verifying a stamp

Each stamp carries the rest of its chain itself: the responder certificate, DigiCert's G4 timestamping CA, and Trusted
Root G4 cross-signed by Assured ID Root CA. `bench stamp-verify` passes those as untrusted intermediates and trusts
only the roots given with `--ca`. From the repository root:

```bash
node packages/verify/dist/cli.js bench stamp-verify packages/verify/docs/bench/x1-einvoice-pdf/PREREG.md \
  packages/verify/docs/bench/x1-einvoice-pdf/PREREG.md.tsr --ca packages/verify/docs/bench/_tsa/digicert-roots.pem
```

`node packages/verify/dist/cli.js bench check packages/verify/docs/bench` checks every stamp a table's `run.json` lists
against `digicert-roots.pem`.

With OpenSSL alone, extract the token's certificates first and pass them as `-untrusted`. OpenSSL 1.1.1 does not use the
certificates inside the token unless they are passed this way, and `-CAfile` alone fails with "unable to get local issuer
certificate". From the repository root:

```bash
D=packages/verify/docs/bench/x1-einvoice-pdf
openssl ts -reply -in $D/PREREG.md.tsr -token_out -out token.p7
openssl pkcs7 -inform DER -in token.p7 -print_certs -out embedded.pem
openssl ts -verify -data $D/PREREG.md -in $D/PREREG.md.tsr -CAfile packages/verify/docs/bench/_tsa/digicert-roots.pem -untrusted embedded.pem
```
