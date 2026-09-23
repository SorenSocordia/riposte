#!/usr/bin/env node
import { createRequire as __riposteRequire } from 'node:module'; const require = __riposteRequire(import.meta.url);

// packages/receipts/src/attest-cli.ts
import { readFileSync } from "node:fs";

// packages/receipts/src/model-attest.ts
var ALIASES = /* @__PURE__ */ new Set(["opus", "sonnet", "haiku", "fable", "default", "auto", "best", "latest"]);
var PLACEHOLDER = /^<.*>$/;
function isFloatingAlias(id) {
  const s = id.trim().toLowerCase();
  return ALIASES.has(s) || s.endsWith("-latest");
}
function modelMatches(expected, resolved) {
  if (expected === resolved) return true;
  return resolved.startsWith(`${expected}-`) && /^\d{8}$/.test(resolved.slice(expected.length + 1));
}
var MAX_VIOLATIONS = 20;
function attestModels(events, policy = {}) {
  const sessionModel = events.find((e) => e.type === "session_model")?.model;
  const fromHost = !policy.allowed?.length && !policy.declared && Boolean(sessionModel);
  const expected = policy.allowed?.length ? policy.allowed : policy.declared ? [policy.declared] : sessionModel ? [sessionModel] : null;
  const out = {
    outcome: "PASS",
    models: {},
    first: null,
    last: null,
    replies: 0,
    switches: [],
    violations: [],
    violation_count: 0,
    skipped: 0,
    host_switches: [],
    expected,
    reasons: []
  };
  const floating = (expected ?? []).filter(isFloatingAlias);
  let pendingRequest = false;
  let pendingHost = null;
  for (const e of events) {
    if (e.type === "switch_requested") {
      pendingRequest = true;
      continue;
    }
    if (e.type === "host_switch") {
      pendingHost = e.reason;
      out.host_switches.push({ reason: e.reason, ...e.from ? { from: e.from } : {}, ...e.to ? { to: e.to } : {}, ...e.at ? { at: e.at } : {} });
      continue;
    }
    if (e.type === "session_model") continue;
    const m = typeof e.model === "string" ? e.model.trim() : "";
    if (!m || PLACEHOLDER.test(m)) {
      out.skipped++;
      continue;
    }
    const n = out.replies++;
    out.models[m] = (out.models[m] ?? 0) + 1;
    if (out.first === null) out.first = m;
    if (out.last !== null && m !== out.last) {
      const cause = pendingRequest ? "user_command" : pendingHost ? "host_fallback" : "unrecorded";
      out.switches.push({ from: out.last, to: m, ...e.at ? { at: e.at } : {}, reply: n, announced: cause === "user_command", cause, ...cause === "host_fallback" ? { host_reason: pendingHost } : {} });
      pendingRequest = false;
      pendingHost = null;
    }
    out.last = m;
    if (expected && !floating.length && !expected.some((x) => modelMatches(x, m))) {
      out.violation_count++;
      if (out.violations.length < MAX_VIOLATIONS) out.violations.push({ reply: n, model: m, ...e.at ? { at: e.at } : {} });
    }
  }
  if (floating.length) {
    out.outcome = "ABSTAIN";
    out.reasons.push(`declared model ${floating.map((f) => `"${f}"`).join(", ")} is a floating alias \u2014 it resolves to whatever is served today, so nothing can be attested against it. Pin an exact model id.`);
    if (out.first) out.reasons.push(`(for the record: replies came from ${Object.keys(out.models).join(", ")})`);
    return out;
  }
  if (!out.replies) {
    out.outcome = "ABSTAIN";
    out.reasons.push(events.length ? "no reply recorded which model produced it \u2014 cannot attest" : "no replies to attest");
    return out;
  }
  const silent = out.switches.filter((s) => !s.announced);
  if (out.violation_count) {
    out.outcome = "FAIL";
    const wrong = [...new Set(out.violations.map((v) => v.model))];
    out.reasons.push(`${out.violation_count} of ${out.replies} replies came from ${wrong.join(", ")} \u2014 declared ${expected.join(" | ")}`);
  }
  if (silent.length && policy.failOnSilentSwitch !== false) {
    out.outcome = "FAIL";
    const host = silent.filter((s) => s.cause === "host_fallback");
    const bare = silent.filter((s) => s.cause === "unrecorded");
    const list = (ss) => `${ss.slice(0, 3).map((s) => `${s.from} \u2192 ${s.to}${s.at ? ` at ${s.at}` : ""}`).join("; ")}${ss.length > 3 ? "; \u2026" : ""}`;
    if (host.length) out.reasons.push(`${host.length} model switch${host.length > 1 ? "es" : ""} made by the host, not asked for (${[...new Set(host.map((s) => s.host_reason))].join(", ")}): ${list(host)}`);
    if (bare.length) out.reasons.push(`${bare.length} silent model switch${bare.length > 1 ? "es" : ""} (nothing announced the change): ${list(bare)}`);
  }
  if (out.violation_count && out.host_switches.length && !out.switches.some((s) => s.cause === "host_fallback")) {
    out.reasons.push(`the host itself switched models: ${out.host_switches.map((h) => `${h.from ?? "?"} \u2192 ${h.to ?? "?"} (${h.reason})`).join("; ")}`);
  }
  if (fromHost && out.outcome !== "ABSTAIN") out.reasons.push(`(expected model taken from the host's own session start: ${sessionModel})`);
  if (out.outcome === "PASS") {
    const names = Object.keys(out.models);
    out.reasons.push(names.length === 1 ? `all ${out.replies} replies came from ${names[0]}${expected ? "" : " (no declared model \u2014 consistency only)"}` : `${out.replies} replies across ${names.join(", ")}; every change was announced${expected ? " and every model was expected" : ""}`);
  }
  if (out.skipped) out.reasons.push(`${out.skipped} event(s) carried no model (missing or placeholder) and were not attested`);
  return out;
}
var MODEL_COMMAND = /^\s*<command-name>\/?model<\/command-name>/;
function eventsFromClaudeCodeTranscript(jsonl) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = j.message ?? {};
    const at = typeof j.timestamp === "string" ? { at: j.timestamp } : {};
    if (j.type === "system" && j.subtype === "init" && typeof j.model === "string") {
      out.push({ type: "session_model", model: j.model, ...at });
      continue;
    }
    if (j.type === "system" && j.subtype === "model_refusal_fallback") {
      const cat = typeof j.api_refusal_category === "string" ? ` (${j.api_refusal_category})` : "";
      out.push({ type: "host_switch", reason: `safety-refusal fallback${cat}`, ...typeof j.original_model === "string" ? { from: j.original_model } : {}, ...typeof j.fallback_model === "string" ? { to: j.fallback_model } : {}, ...at });
      continue;
    }
    const command = j.type === "user" ? msg.content : j.type === "system" && j.subtype === "local_command" ? j.content : void 0;
    if (command !== void 0) {
      if (typeof command === "string" && MODEL_COMMAND.test(command)) out.push({ type: "switch_requested", ...typeof j.timestamp === "string" ? { at: j.timestamp } : {} });
      continue;
    }
    if (j.type !== "assistant") continue;
    const id = typeof msg.id === "string" ? msg.id : void 0;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push({ type: "reply", model: typeof msg.model === "string" ? msg.model : null, ...typeof j.timestamp === "string" ? { at: j.timestamp } : {}, ...id ? { id } : {} });
  }
  return out;
}

// packages/receipts/src/attest-command.ts
var ATTEST_USAGE = "riposte-attest <transcript.jsonl> [--declared <exact-id>] [--allow <exact-id>]... [--allow-silent-switch]";
var CODES = { PASS: 0, FAIL: 1, ABSTAIN: 2 };
function parseAttestArgs(argv2) {
  const out = { policy: {} };
  for (let i = 0; i < argv2.length; i++) {
    const a = argv2[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--declared" || a === "--allow") {
      const v = argv2[++i];
      if (!v || v.startsWith("--")) return { ...out, error: `${a} needs a model id` };
      if (a === "--declared") out.policy.declared = v;
      else (out.policy.allowed ??= []).push(v);
    } else if (a === "--allow-silent-switch") out.policy.failOnSilentSwitch = false;
    else if (a.startsWith("--")) return { ...out, error: `unknown option ${a}` };
    else if (out.path) return { ...out, error: "one transcript at a time" };
    else out.path = a;
  }
  return out;
}
function attestCli(argv2, readFile, stdin) {
  const args = parseAttestArgs(argv2);
  if (args.help) return { code: 0, out: "", err: `${ATTEST_USAGE}
` };
  if (args.error) return { code: 3, out: "", err: `${args.error}
${ATTEST_USAGE}
` };
  let path = args.path;
  if (!path && stdin?.trim()) {
    try {
      const hook = JSON.parse(stdin);
      if (typeof hook.transcript_path === "string") path = hook.transcript_path;
    } catch {
    }
  }
  if (!path) return { code: 3, out: "", err: `no transcript given
${ATTEST_USAGE}
` };
  let text;
  try {
    text = readFile(path);
  } catch (e) {
    return { code: 3, out: "", err: `cannot read ${path}: ${e.message}
` };
  }
  const a = attestModels(eventsFromClaudeCodeTranscript(text), args.policy);
  return { code: CODES[a.outcome], out: `${JSON.stringify(a, null, 2)}
`, err: `${a.outcome}: ${a.reasons.join(" \xB7 ")}
` };
}

// packages/receipts/src/attest-cli.ts
var argv = process.argv.slice(2);
var needStdin = !parseAttestArgs(argv).path && !process.stdin.isTTY;
var r = attestCli(argv, (p) => readFileSync(p, "utf8"), needStdin ? readFileSync(0, "utf8") : void 0);
process.stdout.write(r.out);
process.stderr.write(r.err);
process.exitCode = r.code;
