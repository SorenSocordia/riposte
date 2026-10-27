# Security

Report a security issue to **kill@fragarachlabs.com**. That includes any way to make a verdict, a replay, a signature or
the receipt ledger say something that is not true.

## What happens to a report

- **Acknowledged within one business day,** by a person.
- **Confirmed or refused in writing,** with the reason either way.
- **Every confirmed finding is published,** dated, as a row of the misses ledger
  ([`packages/verify/docs/MISSES.md`](packages/verify/docs/MISSES.md)), transcribed from the report, in the same release as
  its fix or an earlier one. The report itself is not published; its sha256 is listed beside the table that holds its rows.
- **No payment is offered for reports** at this time.

## What helps a report

- The commands you ran and what they printed, or the smallest input that shows the problem.
- The engine version (`node packages/verify/dist/cli.js --version`) or the commit you built from.
- Which entry point you used: the command line, the library, HTTP or MCP.

The hash contract, and so what counts as a replay that accepts different inputs or rejects the same ones, is in
[`packages/verify/docs/REPLAY.md`](packages/verify/docs/REPLAY.md).
