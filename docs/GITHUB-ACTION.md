# Riposte in GitHub Actions: findings as code-scanning alerts

`.github/actions/riposte-verify` is a composite action. It checks extracted documents in your repository with Riposte's
deterministic rules and writes the result as SARIF 2.1.0. GitHub's code-scanning upload step then turns each finding into
an alert on the line it is about.

- **FAIL** is an error-level alert: a check ran and did not hold, for example a unit price above the contracted rate.
- **Can't tell** (`INSUFFICIENT_DATA`) is a warning-level alert: a check could not run because an input was missing or not
  supplied, so a person decides. It is not a failure, but by default it fails the job, as the command-line checks do: see
  `fail-on` below to loosen that.
- **PASS** produces no alert.

Every alert names its verdict id and the command that re-performs the check from the saved proof:
`riposte-verify replay riposte-proofs/<verdict id>.json`.

## Use it

Copy [`.github/workflows/examples/riposte-verify.yml`](../.github/workflows/examples/riposte-verify.yml) to
`.github/workflows/` in your repository and point `files` at your documents. Pin every `uses:` to a full commit SHA, with its
release tag in a comment, as the example does for the third-party actions. This action has no release yet, so pin it to a
commit SHA of this repository: the example writes `REPLACE_WITH_COMMIT_SHA` in its place, and a copy does not run until
you put the commit there.

```yaml
permissions:
  contents: read
  security-events: write      # required to upload SARIF
steps:
  - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803     # v6.1.0
  - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020   # v7.0.0
    with:
      node-version: 22
  - id: riposte
    uses: SorenSocordia/riposte/.github/actions/riposte-verify@REPLACE_WITH_COMMIT_SHA   # the 40-character commit you reviewed
    with:
      files: |
        extractions/**/*.json
      ruleset: invoice
  - if: ${{ !cancelled() }}                                         # upload even when the check step failed
    uses: github/codeql-action/upload-sarif@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2   # v4.38.2
    with:
      sarif_file: riposte.sarif
```

The upload step's `if: ${{ !cancelled() }}` matters: the check step fails the job on a FAIL or a can't tell, and the alerts
should still be uploaded. To keep the proofs, add an `actions/upload-artifact` step (pinned by SHA) for `riposte-proofs/`, as the example does. Anyone
can then download a proof and run its replay.

## Inputs

| input | default | meaning |
|---|---|---|
| `files` | (required) | One glob per line, relative to `working-directory`: `**`, `*`, `?`, `{a,b}`, and a leading `!` excludes. |
| `ruleset` | `invoice` | `invoice`, `pay-app`, or a declarative ruleset file. An inputs file's own `"ruleset"` overrides it. |
| `fail-on` | `insufficient-data` | `insufficient-data`: the step fails when a check FAILs, when a check can't tell (a PASS with a check that could not run included), or when a file could not be checked. This is the default: the Action fails closed, as the command-line checks do. To loosen it, set `fail`: the step fails only when a check FAILs, and can't tell passes as a warning alert. `none`: never. The older value `abstain` is read as `insufficient-data`. |
| `sarif-file` | `riposte.sarif` | Where the SARIF log is written. |
| `proof-dir` | `riposte-proofs` | Where each verdict's replay bundle is written. |
| `category` | (empty) | The SARIF `automationDetails` category. Needed only for more than one Riposte upload per commit. |
| `working-directory` | `.` | The folder the globs and file paths are relative to. Alert locations stay relative to the repository root. |
| `cli` | (empty) | A prebuilt `riposte-sarif.mjs`. When empty, the action builds the checker from its own repository: `npm ci` from the `package-lock.json` at its root, then the adapters bundle. With no lockfile there the build step fails, exit 1, and says so (below). |

Outputs: `sarif-file`, `proof-dir`, `files`, `pass`, `fail`, `insufficient-data`, `refused` and `outcome`. `outcome` is
FAIL if any file FAILed, else INSUFFICIENT_DATA if any file could not tell or could not be checked, else PASS-WITH-OPEN if a
PASS has a check that could not run, else PASS. Before 2026-10-05 the default was `fail`, and the can't-tell count was the
output `abstain`; set `fail-on: fail` to keep the old behaviour. The step also writes a Markdown digest to the
job summary.

## What a file can be

- **An extracted document** (JSON): the fields your extraction produced. It is checked with `ruleset`.
- **An inputs object**, the same shape `riposte-verify replay` takes:
  `{ "extraction": {...}, "references": { "contract", "evidence", "history" }, "source": { "text": "..." }, "ruleset": "pay-app" }`.
  References turn on the cross-document checks, such as the contract rate or the quantities received. Source text turns on
  the checks against the document's own words.

A file that is not JSON, or that holds nothing a verdict can bind to, is not checked. It is listed as a tool notification
and in the job summary, never as a FAIL.

## Where the alerts point

Each alert points where the verdict's own provenance points. A field path such as `line_items[*].unit_price` becomes the
line and column of that property in your file. Contract and delivery-record values become related locations. A field that
is missing has no line, so the alert points at the nearest parent that exists, else the document, and the result's
`properties.riposte.located` says which.

## Safety

Inputs reach the scripts only as environment variables and quoted arguments, never interpolated into a script (GitHub's
guidance on script injection). The check itself makes no network calls. The default build step runs `npm ci` in the
action's own repository, which fetches the dependencies its `package-lock.json` pins from the npm registry; pass `cli` to
skip it. The step installs only from that lockfile. If the commit you pinned has none, the step fails, exit 1, with an
error annotation naming the folder, and nothing is installed: it never falls back to an `npm install` that would resolve
versions on the day the job runs. `npm ci` from the lockfile installs under npm 10.9, the npm Node 22 bundles, as well as
under npm 11; a plain `npm install` with no lockfile stops under npm 10.9 (`ci/NPM-INSTALL.md`).

## Not verified

The action was run locally, act-style: `action.yml` was parsed, its expressions evaluated, and its steps run in bash
against sample documents. On 2026-10-19 both steps ran the same way inside the `node:22` container image (Node 22.23.3,
npm 10.9.9). From a copy of this tree with a generated `package-lock.json`, the build step installed with `npm ci` and the
check step wrote the SARIF file and the proof. From the same copy without the lockfile, the build step failed, exit 1, with
the error annotation, and installed nothing. It has not run on GitHub's runners yet. The upload step's handling of this SARIF follows GitHub's
documentation, and has not yet been observed in a repository.
