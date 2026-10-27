// SPDX-License-Identifier: Apache-2.0
//! `cargo test`: every case of conformance/record/vectors.json (riposte.record-vectors/0.1.0) run against this crate. Each case
//! this reader does not meet is NAMED (src/vectors.rs, NAMED) with its reason; every other case must pass. Both counts print.

use riposte_record::vectors;
use std::path::PathBuf;

fn cases_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("record").join("vectors.json")
}

#[test]
fn record_vectors() {
    let cases = vectors::load(&cases_path()).expect("vectors.json reads");
    let tmp = PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
    let outcomes = vectors::run(&cases, &tmp, false);
    let total = outcomes.len();
    assert_eq!(total, 272, "the frozen file holds 272 cases");
    let t = vectors::tally(outcomes);
    let report = vectors::report(&t, total);
    println!("{}", report);
    assert!(t.named_passing.is_empty(), "a named case passes: take it off the named list\n{}", report);
    assert!(t.failed.is_empty(), "cases outside the named list fail\n{}", report);
}

#[test]
fn named_cases_exist_in_the_file() {
    let cases = vectors::load(&cases_path()).expect("vectors.json reads");
    for (part, name, _) in vectors::NAMED {
        let found = cases
            .get(part)
            .and_then(|p| p.as_arr())
            .map_or(false, |a| a.iter().any(|c| riposte_record::json::is_str(c.get("name"), name)));
        assert!(found, "named case not in the file: {}, {}", part, name);
    }
}
