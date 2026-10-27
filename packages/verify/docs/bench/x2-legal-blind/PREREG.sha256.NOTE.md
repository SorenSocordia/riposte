# The hash list beside this note

PREREG.sha256 holds two hash sets, 42 seconds apart (2026-10-03T10:49:49Z and 10:50:31Z). The first was superseded before any engine call, when the run's own integrity check stopped on CRLF line endings in the opinion texts. Three lines changed between the sets and one was added: PREREG.md (its re-hash note added), items/MANIFEST.json (the per-text hashes, after the texts were rewritten with LF line endings and the manifest made to hash raw bytes), harness/build_manifest.py (the script that builds that manifest), and a new line for the script that fetched the texts. The first manifest's bytes were not kept, so this tree cannot show that no item changed between the two sets; that rests on the authors' re-hash note in PREREG.md. The run is held to the second set.

This note was written on 2026-10-05, after the run, to explain the hash list; it is not part of the prereg's record.
