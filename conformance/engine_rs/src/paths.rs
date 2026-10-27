// SPDX-License-Identifier: Apache-2.0
//! Paths as the readers name them: joined to the working folder and normalized lexically (os.path.normpath), and relative
//! paths written with '/'.

use std::path::{Component, Path, PathBuf};

/// A path with "." removed and ".." taken back lexically.
pub fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// os.path.normpath(os.path.join(cwd, p)): an absolute p stays as it is.
pub fn join_norm(cwd: &Path, p: &str) -> PathBuf {
    normalize(&cwd.join(p))
}

/// The path of `p` under `base`, written with '/'.
pub fn rel_slash(base: &Path, p: &Path) -> String {
    let rel = p.strip_prefix(base).unwrap_or(p);
    rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/")
}
