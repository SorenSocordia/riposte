// SPDX-License-Identifier: Apache-2.0
//! riposte-record: the record tier read in Rust (verify only). Prototype; no measured accuracy.
//!
//!   riposte-record ledger verify|summary|fingerprint|verify-signature ...
//!   riposte-record frag open <frag folder> [--tree <root>] [--record <frags.jsonl>] [--issuer <ISSUER.json | key.pem>]
//!   riposte-record workgraph open|status|digest|charter check ...
//!   riposte-record vectors [<vectors.json>] [--words]
//!
//! Exit codes are each command's own (see README.md); `vectors` exits 0 when every case outside the named list passes.

use riposte_record::{frag, ledger, vectors, workgraph};
use std::io::Write;
use std::path::PathBuf;

const USAGE: &str = "prototype; no measured accuracy\n\
usage: riposte-record ledger <verify|summary|fingerprint|verify-signature> ...\n\
\x20      riposte-record frag open <frag folder> [--tree <root>] [--record <frags.jsonl>] [--issuer <ISSUER.json | key.pem>]\n\
\x20      riposte-record workgraph <open|status|digest|charter> ...\n\
\x20      riposte-record vectors [<vectors.json>] [--words]\n\
a reader of the record (tier 1): it verifies, and never issues, signs or re-performs";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let (code, out, err) = match args.first().map(String::as_str) {
        Some("ledger") => {
            let r = ledger::ledger_cli(&args[1..], &cwd);
            (r.code, r.out, r.err)
        }
        Some("frag") => {
            let r = frag::frag_cli(&args[1..], &cwd);
            (r.code, r.out, r.err)
        }
        Some("workgraph") => {
            let store = std::env::var("WORKGRAPH_STORE").ok();
            let r = workgraph::workgraph_cli(&args[1..], &cwd, store.as_deref());
            (r.code, r.out, r.err)
        }
        Some("vectors") => {
            let words = args.iter().any(|a| a == "--words");
            let path = args
                .iter()
                .skip(1)
                .find(|a| !a.starts_with("--"))
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("record").join("vectors.json"));
            match vectors::load(&path) {
                Err(e) => (3, String::new(), format!("cannot read the vectors: {}\n", e)),
                Ok(cases) => {
                    let outcomes = vectors::run(&cases, &std::env::temp_dir(), words);
                    let total = outcomes.len();
                    let words_off: Vec<String> = outcomes
                        .iter()
                        .filter_map(|o| o.words_failure.as_ref().map(|w| format!("WORDS {}, {}: {}\n", o.part, o.name, w)))
                        .collect();
                    let t = vectors::tally(outcomes);
                    let mut s = vectors::report(&t, total);
                    if words {
                        s = words_off.concat() + &s + &format!("with --words: {} command cases differ in their whole streams\n", words_off.len());
                    }
                    (if t.failed.is_empty() { 0 } else { 1 }, s, String::new())
                }
            }
        }
        _ => (if args.is_empty() { 0 } else { 3 }, String::new(), format!("{}\n", USAGE)),
    };
    let _ = std::io::stdout().write_all(out.as_bytes());
    let _ = std::io::stderr().write_all(err.as_bytes());
    std::process::exit(code);
}
