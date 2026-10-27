# Refused release checks: changes that touched a file the check judges with

The maintainers' release check (not part of this tree) refuses, writes nothing else and exits 3 when the files changed
since its last cleared run include one it judges with: a preregistration or its amendment, a timestamp proof or hash pin,
a bench run record, a bench result or a file a run record names, a pin, a model attestation record, a drift baseline, a
seal list, or the check itself. A person who has read the change runs the check again with `--judge-change "<reason>"`,
and the maintainers keep that reason in their log. Each refusal adds one row here, whoever ran the check and whether or not
the change is allowed later, so the rows over the checks run in the same days are the rate of attempts. The check appends
rows and never edits them: it keeps the length and digest of this file as it last saw it, and a change that is not an
append is itself refused. Paths are as the maintainers' tree names them; a path whose name the export scan refuses is
written as its kind, and the check's own log names it.

| date | miss | kind | paths | invoker |
|---|---|---|---|---|
