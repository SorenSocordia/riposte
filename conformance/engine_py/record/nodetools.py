# Where the Node tools are, for the tests that compare this folder's readers with them. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
The tests beside this file compare each reader with its Node tool when that tool is built, and are skipped with "can't tell"
when it is not. A tool is looked for, in order:

  1. under $RIPOSTE_NODE_PACKAGES, a folder holding the packages by name (verify/, receipts/, frag/, workgraph/), each built
     to dist/;
  2. the exported repository's layout: packages/<name>/dist/ under the repository root (after npm install && npm run build);
  3. the development layout: <name>/dist/ beside this overlay's folder.

$RIPOSTE_NODE names the node executable (default: node on the PATH). Node 20 or later is needed (the packages' engines field).
In the development layout the frag package resolves `verify` and `receipts` through a resolve hook handed to node as a data:
URL (no link is made on disk), as that package's own test configuration aliases them.
"""

import json
import os
import re
import shutil
import subprocess
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
CLI_FILE = {"verify": "cli.js", "receipts": "ledger-cli.js", "frag": "cli.js", "workgraph": "cli.js"}


def node_exe():
    exe = os.environ.get("RIPOSTE_NODE") or shutil.which("node")
    if not exe:
        return None
    try:
        v = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=60).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.match(r"v(\d+)\.(\d+)", v)
    if not m or (int(m.group(1)), int(m.group(2))) < (20, 6):
        return None
    return exe


def package_dir(name):
    """(folder, layout) of a built package, or (None, None)."""
    env = os.environ.get("RIPOSTE_NODE_PACKAGES")
    candidates = []
    if env:
        candidates.append((os.path.join(env, name), "env"))
    candidates.append((os.path.join(ROOT, "packages", name), "exported"))
    candidates.append((os.path.join(os.path.dirname(ROOT), name), "development"))
    for d, layout in candidates:
        if os.path.isfile(os.path.join(d, "dist", CLI_FILE[name])):
            return d, layout
    return None, None


def _hook_arg(verify_dir, receipts_dir):
    to_url = lambda p: urllib.parse.urljoin("file:", urllib.request.pathname2url(os.path.abspath(p)))
    hook = ("export async function resolve(s, c, n) {"
            " const m = { verify: %s, receipts: %s, 'riposte-verify': %s, 'riposte-ai': %s };"
            " for (const k of Object.keys(m)) {"
            "  if (s === k) return n(m[k] + '/dist/index.js', c);"
            "  if (s.startsWith(k + '/')) return n(m[k] + s.slice(k.length), c);"
            " }"
            " return n(s, c) }") % (json.dumps(to_url(verify_dir)), json.dumps(to_url(receipts_dir)), json.dumps(to_url(verify_dir)), json.dumps(to_url(receipts_dir)))
    reg = "import { register } from 'node:module'; register('data:text/javascript,' + encodeURIComponent(%s))" % json.dumps(hook)
    return "--import=data:text/javascript," + urllib.parse.quote(reg)


def command(name):
    """The argv prefix that runs a package's command line, or None when it is not built or no Node 20+ is found."""
    exe = node_exe()
    d, layout = package_dir(name)
    if not exe or not d:
        return None
    cli = os.path.join(d, "dist", CLI_FILE[name])
    if name == "frag" and layout in ("development", "env") and not os.path.exists(os.path.join(d, "node_modules", "verify")):
        v, _ = package_dir("verify")
        r, _ = package_dir("receipts")
        if not v or not r:
            return None
        return [exe, _hook_arg(v, r), cli]
    return [exe, cli]


def run(argv, cwd=None, timeout=300):
    """(exit, stdout bytes, stderr bytes)."""
    p = subprocess.run(argv, cwd=cwd, capture_output=True, timeout=timeout)
    return p.returncode, p.stdout, p.stderr


def cases_file():
    """work-frags.json of the work graph package, in either layout, or None."""
    for d in (os.path.join(ROOT, "packages", "workgraph"), os.path.join(os.path.dirname(ROOT), "workgraph")):
        p = os.path.join(d, "conformance", "work-frags.json")
        if os.path.isfile(p):
            return p
    return None


def package_path(name, *parts):
    """A file of a package in either layout (source files ship in both), or None."""
    for d in (os.path.join(ROOT, "packages", name), os.path.join(os.path.dirname(ROOT), name)):
        p = os.path.join(d, *parts)
        if os.path.exists(p):
            return p
    return None


def tree_root():
    """A repository root the frag reader can compare pins against: the exported root, or the development root."""
    if os.path.isdir(os.path.join(ROOT, "packages", "verify", "src")):
        return ROOT
    if os.path.isdir(os.path.join(os.path.dirname(ROOT), "verify", "src")):
        return os.path.dirname(ROOT)
    return None
