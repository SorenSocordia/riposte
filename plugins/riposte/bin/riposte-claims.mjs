#!/usr/bin/env node
import { createRequire as __riposteRequire } from 'node:module'; const require = __riposteRequire(import.meta.url);

// packages/receipts/src/claims-cli.ts
import { readFileSync as readFileSync2 } from "node:fs";

// packages/receipts/src/claims.ts
var HEDGE = /\b(?:not|never|no longer|nothing|none|neither|nor|without|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|can't|cannot|couldn't|wouldn't|shouldn't|haven't|hasn't|hadn't|(?:i|you|we|they|it|that|he|she)'ll|when|fail(?:s|ed|ing|ure)?|except|should|would|will|might|may|could|expect(?:s|ed)?|if|unless|until|once|whether|hopefully|probably|likely|try|trying|tried|attempt(?:s|ed)?|want|need)\b/i;
var NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+)`;
var PATTERNS = [
  { kind: "tests_pass", re: new RegExp(String.raw`\b(?:all\s+)?(?:${NUM}\s+(?:[a-z-]+\s+){0,2})?tests?\s+(?:(?:all|now|still)\s+)?(?:pass(?:es|ed|ing)?\b|(?:are|is)\s+(?:all\s+)?(?:passing|green)\b)|\btests?\s+(?:are\s+)?(?:all\s+)?green\b|\btest\s+suite\s+pass(?:es|ed)?\b`, "i") },
  { kind: "build_ok", re: /\b(?:the\s+)?(?:build|compil(?:e|es|ation)|type-?check(?:s|ing)?|tsc)\b(?:\s+(?:is|was|now|all|still))*\s+(?:succeed(?:s|ed)?|pass(?:es|ed)?|clean(?:ly)?|green)\b|\bbuilds?\s+(?:cleanly|clean|successfully|fine)\b|\bno\s+type\s+errors\b/i },
  // not "committed to" (a pledge), "last committed" / "last pushed 2024" (a report about something else), or "… by" (someone else)
  { kind: "committed", re: /\b(?<!last\s)committed\b(?!\s+(?:to|by)\b)|\bmade\s+(?:a|the)\s+commit\b/i },
  { kind: "pushed", re: /\b(?<!last\s)pushed\b(?!\s+(?:back|by)\b)/i },
  { kind: "file_written", re: /\b(?:created|wrote|added|saved)\s+`([^`\s]+\.[A-Za-z0-9]{1,8})`/i }
];
var COMPLETED = /^\s*(?:all\s+)?done\s*[.!—–-]|^\s*(?:all\s+)?done\s*$|(?:^[\s\-*•>#_]*(?:\*\*|__)?|\bI(?:'ve| have)?\s+|\bwe(?:'ve| have)?\s+|\b[a-z]+\s+and\s+)(?:fixed|implemented|resolved|completed|finished)\b(?!\s+(?:by|when)\b)|\b(?:is|are|it's|that's|everything's|everything is)\s+(?:now\s+)?(?:done|fixed|complete|working|resolved)\b|\bworks\s+now\b|\bnow\s+works\b/i;
function prose(text) {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ").replace(/"[^"\n]{1,160}"/g, " ").replace(/“[^”\n]{1,160}”/g, " ");
}
function sentences(text) {
  return prose(text).split(/\n+|(?<=[.!?])\s+(?=[A-Z*_(`"'])/).map((s) => s.trim()).filter(Boolean);
}
var toInt = (s) => s === void 0 ? void 0 : Number(s.replace(/,/g, ""));
function extractClaims(text, opts = {}) {
  const out = [];
  for (const s of sentences(text)) {
    if (HEDGE.test(s.replace(/`[^`]*`/g, " "))) continue;
    if (opts.strict && COMPLETED.test(s.replace(/`[^`]*`/g, " "))) out.push({ kind: "completed", claim: s.length > 200 ? `${s.slice(0, 197)}\u2026` : s });
    for (const { kind, re } of PATTERNS) {
      const m = s.match(re);
      if (!m) continue;
      const claim = s.length > 200 ? `${s.slice(0, 197)}\u2026` : s;
      if (kind === "tests_pass") {
        const n = toInt(m[1]);
        out.push(n === void 0 ? { kind, claim } : { kind, claim, count: n });
      } else if (kind === "file_written") out.push({ kind, claim, path: m[1] });
      else out.push({ kind, claim });
    }
  }
  return out;
}
var SHELL = /^(?:bash|shell|run_command|execute_command|terminal|exec)$/i;
var EDIT_TOOLS = /^(?:edit|write|multiedit|notebookedit|str_replace_based_edit_tool|apply_patch)$/i;
var DOC_FILE = /\.(?:md|mdx|txt|rst)$/i;
var TEST_CMD = /\b(?:vitest|jest|mocha|pytest|py\.test|phpunit|rspec|ava|tap)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:go|cargo|dotnet|mix|deno)\s+test\b|\bnode\s+--test\b/i;
var BUILD_CMD = /\btsc(?:\.cmd)?\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|typecheck)\b|\b(?:cargo|go|dotnet)\s+build\b|\bmake\b|\b(?:gradle|mvn|webpack)\b|\b(?:vite|next)\s+build\b/i;
var COMMIT_CMD = /\bgit\s+(?:-[^\s]+\s+(?:[^\s-][^\s]*\s+)?)*commit\b/i;
var PUSH_CMD = /\bgit\s+(?:-[^\s]+\s+(?:[^\s-][^\s]*\s+)?)*push\b/i;
var ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
function shellRuns(steps, upTo, cmd) {
  const results = /* @__PURE__ */ new Map();
  for (let i = 0; i < upTo; i++) {
    const s = steps[i];
    if (s.kind === "tool_result") results.set(s.id, s);
  }
  const runs = [];
  for (let i = 0; i < upTo; i++) {
    const s = steps[i];
    if (s.kind !== "tool_use" || !SHELL.test(s.name) || typeof s.input.command !== "string" || !cmd.test(s.input.command)) continue;
    const result = results.get(s.id);
    runs.push(result ? { use: s, result, index: i } : { use: s, index: i });
  }
  return runs;
}
function editAfter(steps, after, upTo) {
  for (let i = upTo - 1; i > after; i--) {
    const s = steps[i];
    if (s.kind !== "tool_use" || !EDIT_TOOLS.test(s.name)) continue;
    const p = String(s.input.file_path ?? s.input.path ?? s.input.notebook_path ?? "");
    if (p && DOC_FILE.test(p)) continue;
    return { path: p || "(unknown file)", ...s.at ? { at: s.at } : {} };
  }
  return null;
}
var excerpt = (text, re) => {
  const clean = text.replace(ANSI, "");
  const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
  const hit = re ? lines.filter((l) => re.test(l)) : [];
  const pick = (hit.length ? hit : lines.slice(-3)).slice(-3).join(" \u23CE ");
  return pick.length > 240 ? `${pick.slice(0, 237)}\u2026` : pick;
};
var evidenceOf = (r, re) => ({
  tool: r.use.name,
  command: String(r.use.input.command).slice(0, 200),
  excerpt: r.result ? excerpt(r.result.text, re) : "(no result recorded)",
  ...r.result?.at ?? r.use.at ? { at: r.result?.at ?? r.use.at } : {},
  tool_use_id: r.use.id
});
function parseTestOutput(raw) {
  const text = raw.replace(ANSI, "");
  const passed = [];
  let failed = 0;
  let recognised = false;
  for (const line2 of text.split("\n")) {
    const l = line2.trim();
    if (/^(?:Tests:?\s|test result:|=+\s|# (?:pass|fail)\b|\d+\s+(?:passed|failed|passing|failing)\b)/i.test(l) || /\b\d+\s+(?:passed|failed)\b.*\bin\s+[\d.]+s\b/.test(l)) {
      const p = l.match(/(\d[\d,]*)\s+(?:passed|passing)\b/i) ?? l.match(/^# pass\s+(\d+)/i);
      const f = l.match(/(\d[\d,]*)\s+(?:failed|failing)\b/i) ?? l.match(/^# fail\s+(\d+)/i);
      if (p || f) recognised = true;
      if (p) passed.push(Number(p[1].replace(/,/g, "")));
      if (f) failed += Number(f[1].replace(/,/g, ""));
    }
    if (/^--- FAIL\b|^FAIL\s+\S/.test(l)) {
      recognised = true;
      failed += 1;
    }
    if (/^ok\s+\S+\s+[\d.]+s/.test(l)) {
      recognised = true;
      passed.push(1);
    }
  }
  return { passed, failed, recognised };
}
function checkOne(c, steps, upTo) {
  const stale = (r) => editAfter(steps, r.result ? steps.indexOf(r.result) : r.index, upTo);
  const unsupported = (reason, evidence) => ({ ...c, status: "UNSUPPORTED", reason, ...evidence ? { evidence } : {} });
  if (c.kind === "completed") {
    const runs = shellRuns(steps, upTo, TEST_CMD);
    const last = runs[runs.length - 1];
    const need = "a completion claim (strict) needs a passing test run after the last code edit";
    if (!last) return unsupported(`${need}; no test ran in this session`);
    if (!last.result) return unsupported(`${need}; the last run has no recorded result`, evidenceOf(last));
    const edited = stale(last);
    if (edited) return unsupported(`${need}; tests last ran before a later code edit (${edited.path}${edited.at ? ` at ${edited.at}` : ""})`, evidenceOf(last));
    const t = parseTestOutput(last.result.text);
    const ev = evidenceOf(last, /passed|failed|passing|failing|test result|# (?:pass|fail)|^ok\s|FAIL/i);
    if (t.failed > 0) return { ...c, status: "CONTRADICTED", reason: `claims completion, but the last test run reports ${t.failed} failing`, evidence: ev };
    if (last.result.isError) return { ...c, status: "CONTRADICTED", reason: "claims completion, but the last test run exited with an error", evidence: ev };
    if (!t.recognised || !t.passed.length) return unsupported(`${need}; the last run ended without a recognisable pass count`, ev);
    return { ...c, status: "SUPPORTED", reason: `tests ran after the last code edit: ${t.passed.join(" + ")} passing, 0 failing`, evidence: ev };
  }
  if (c.kind === "tests_pass" || c.kind === "build_ok") {
    const isTests = c.kind === "tests_pass";
    const runs = shellRuns(steps, upTo, isTests ? TEST_CMD : BUILD_CMD);
    const last = runs[runs.length - 1];
    if (!last) return unsupported(isTests ? "no test run anywhere in this session" : "no build or typecheck ran in this session");
    if (!last.result) return unsupported("the last run has no recorded result", evidenceOf(last));
    const edited = stale(last);
    if (edited) return unsupported(`${isTests ? "tests" : "the build"} last ran before a later code edit (${edited.path}${edited.at ? ` at ${edited.at}` : ""})`, evidenceOf(last));
    if (isTests) {
      const t = parseTestOutput(last.result.text);
      const ev2 = evidenceOf(last, /passed|failed|passing|failing|test result|# (?:pass|fail)|^ok\s|FAIL/i);
      if (t.failed > 0) return { ...c, status: "CONTRADICTED", reason: `the last test run reports ${t.failed} failing`, evidence: ev2 };
      if (last.result.isError) return { ...c, status: "CONTRADICTED", reason: "the last test run exited with an error", evidence: ev2 };
      if (!t.recognised || !t.passed.length) return unsupported("the last test run ended without a recognisable pass count", ev2);
      const sum = t.passed.reduce((a, b) => a + b, 0);
      if (c.count !== void 0 && c.count !== sum && !t.passed.includes(c.count))
        return { ...c, status: "CONTRADICTED", reason: `claims ${c.count}, the last run shows ${t.passed.join(" + ")} passing`, evidence: ev2 };
      return { ...c, status: "SUPPORTED", reason: `the last test run: ${t.passed.join(" + ")} passing, 0 failing`, evidence: ev2 };
    }
    const ev = evidenceOf(last, /error|warning|built|compiled|success/i);
    if (last.result.isError) return { ...c, status: "CONTRADICTED", reason: "the last build exited with an error", evidence: ev };
    if (/\berror(?:\s+TS\d+)?\s*:|\b[1-9]\d*\s+errors?\b|\bbuild failed\b/i.test(last.result.text.replace(ANSI, "")))
      return { ...c, status: "CONTRADICTED", reason: "the last build output reports errors", evidence: ev };
    return { ...c, status: "SUPPORTED", reason: "the last build/typecheck ran without errors", evidence: ev };
  }
  if (c.kind === "committed" || c.kind === "pushed") {
    const runs = shellRuns(steps, upTo, c.kind === "committed" ? COMMIT_CMD : PUSH_CMD);
    const last = runs[runs.length - 1];
    if (!last) return unsupported(`no git ${c.kind === "committed" ? "commit" : "push"} ran in this session`);
    if (!last.result) return unsupported("the last run has no recorded result", evidenceOf(last));
    const text = last.result.text.replace(ANSI, "");
    const ev = evidenceOf(last, /->|rejected|error|fatal|nothing to commit|changed|create mode|\[\S+ [0-9a-f]{7}/i);
    if (last.result.isError) return { ...c, status: "CONTRADICTED", reason: `the last git ${c.kind === "committed" ? "commit" : "push"} exited with an error`, evidence: ev };
    if (c.kind === "committed" && /nothing to commit|no changes added to commit/i.test(text)) return { ...c, status: "CONTRADICTED", reason: "git reported nothing to commit", evidence: ev };
    if (c.kind === "pushed" && /\[rejected\]|\berror:|\bfatal:/i.test(text)) return { ...c, status: "CONTRADICTED", reason: "the push was rejected", evidence: ev };
    return { ...c, status: "SUPPORTED", reason: `the last git ${c.kind === "committed" ? "commit" : "push"} succeeded`, evidence: ev };
  }
  const want = c.path.replace(/\\/g, "/").replace(/^\.\//, "");
  const results = /* @__PURE__ */ new Map();
  for (let i = 0; i < upTo; i++) {
    const s = steps[i];
    if (s.kind === "tool_result") results.set(s.id, s);
  }
  for (let i = upTo - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.kind !== "tool_use") continue;
    const r = results.get(s.id);
    const ok2 = r && !r.isError;
    if (EDIT_TOOLS.test(s.name)) {
      const p = String(s.input.file_path ?? s.input.path ?? "").replace(/\\/g, "/");
      if (p === want || p.endsWith(`/${want}`)) {
        const ev = { tool: s.name, excerpt: p, tool_use_id: s.id, ...s.at ? { at: s.at } : {} };
        return ok2 ? { ...c, status: "SUPPORTED", reason: `${s.name} wrote ${p}`, evidence: ev } : { ...c, status: "CONTRADICTED", reason: `${s.name} on ${p} failed`, evidence: ev };
      }
    } else if (SHELL.test(s.name) && typeof s.input.command === "string" && s.input.command.replace(/\\/g, "/").includes(want) && /(?:>|\btee\b|\bcp\b|\bmv\b|\btouch\b|writeFileSync)/.test(s.input.command) && ok2) {
      return { ...c, status: "SUPPORTED", reason: "a shell command wrote it", evidence: { tool: s.name, command: s.input.command.slice(0, 200), excerpt: want, tool_use_id: s.id, ...s.at ? { at: s.at } : {} } };
    }
  }
  return unsupported(`no tool in this session wrote ${c.path}`);
}
function checkClaims(steps, finalIndex, opts = {}) {
  let end = finalIndex ?? -1;
  if (end < 0) {
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].kind === "assistant_text") {
      end = i;
      break;
    }
  }
  if (end < 0) return { outcome: "ABSTAIN", claims: [], reasons: ["no assistant message to check"] };
  let start = end;
  while (start > 0 && steps[start - 1].kind === "assistant_text") start--;
  const texts = steps.slice(start, end + 1);
  return checkMessageClaims(texts.map((t) => t.text).join("\n"), steps, start, texts[texts.length - 1].at, opts);
}
function checkMessageClaims(text, steps, upTo = steps.length, at, opts = {}) {
  const claims = extractClaims(text, opts).map((c) => checkOne(c, steps, upTo));
  const base = at ? { final_message_at: at } : {};
  if (!claims.length) return { outcome: "ABSTAIN", claims, ...base, reasons: ["no checkable completion claims in the final message"] };
  const contra = claims.filter((c) => c.status === "CONTRADICTED");
  const unsup = claims.filter((c) => c.status === "UNSUPPORTED");
  const reasons = [...contra, ...unsup].map((c) => `${c.status}: "${c.claim}" \u2014 ${c.reason}`);
  if (contra.length) return { outcome: "FAIL", claims, ...base, reasons };
  if (unsup.length) return { outcome: "ABSTAIN", claims, ...base, reasons };
  return { outcome: "PASS", claims, ...base, reasons: [`all ${claims.length} claim(s) are backed by this session's tool results`] };
}
function findFinalMessage(steps, text) {
  let end = -1;
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].kind === "assistant_text") {
    end = i;
    break;
  }
  if (end < 0) return -1;
  let start = end;
  while (start > 0 && steps[start - 1].kind === "assistant_text") start--;
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const joined = steps.slice(start, end + 1).map((t) => t.text).join("\n");
  return norm(joined) === norm(text) ? start : -1;
}
function turnEnds(steps) {
  const out = [];
  let lastText = -1;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.kind === "assistant_text") lastText = i;
    else if (s.kind === "user_prompt" && lastText >= 0) {
      out.push(lastText);
      lastText = -1;
    }
  }
  if (lastText >= 0) out.push(lastText);
  return out;
}
var textOf = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => x && typeof x === "object" ? typeof x.text === "string" ? x.text : "" : "").join("\n") : "";
function sessionFromClaudeCodeTranscript(jsonl) {
  const steps = [];
  for (const line2 of jsonl.split("\n")) {
    if (!line2.trim()) continue;
    let j;
    try {
      j = JSON.parse(line2);
    } catch {
      continue;
    }
    const msg = j.message ?? {};
    const at = typeof j.timestamp === "string" ? j.timestamp : void 0;
    const stamp = at ? { at } : {};
    if (j.type === "assistant" && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b?.type === "text" && typeof b.text === "string") steps.push({ kind: "assistant_text", text: b.text, ...typeof msg.id === "string" ? { message_id: msg.id } : {}, ...stamp });
        else if (b?.type === "tool_use" && typeof b.id === "string") steps.push({ kind: "tool_use", id: b.id, name: String(b.name ?? ""), input: b.input && typeof b.input === "object" ? b.input : {}, ...stamp });
      }
    } else if (j.type === "user") {
      const c = msg.content;
      if (Array.isArray(c) && c.some((b) => b?.type === "tool_result")) {
        for (const b of c) if (b?.type === "tool_result" && typeof b.tool_use_id === "string") steps.push({ kind: "tool_result", id: b.tool_use_id, text: textOf(b.content), isError: b.is_error === true, ...stamp });
      } else if (!j.isMeta) {
        const t = textOf(c).trim();
        if (t && !/^<(?:command-|local-command-)/.test(t)) steps.push({ kind: "user_prompt", ...stamp });
      }
    }
  }
  return steps;
}

// packages/receipts/src/claims-command.ts
var CLAIMS_USAGE = "riposte-claims <transcript.jsonl> [--all-turns] [--strict]  |  riposte-claims --hook [--strict] [--only-contradicted | --record-only] [--ledger <file>]   (hook JSON on stdin)";
var CODES = { PASS: 0, FAIL: 1, ABSTAIN: 2 };
function parseClaimsArgs(argv2) {
  const out = { allTurns: false, hook: false, onlyContradicted: false, recordOnly: false, strict: false };
  for (let i = 0; i < argv2.length; i++) {
    const a = argv2[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--all-turns") out.allTurns = true;
    else if (a === "--hook") out.hook = true;
    else if (a === "--only-contradicted") out.onlyContradicted = true;
    else if (a === "--record-only") out.recordOnly = true;
    else if (a === "--strict") out.strict = true;
    else if (a === "--from-env") out.fromEnv = true;
    else if (a === "--ledger") {
      const v = argv2[++i];
      if (!v || v.startsWith("--")) return { ...out, error: "--ledger needs a file" };
      out.ledger = v;
    } else if (a.startsWith("--")) return { ...out, error: `unknown option ${a}` };
    else if (out.path) return { ...out, error: "one transcript at a time" };
    else out.path = a;
  }
  return out;
}
function auditTurns(jsonl, opts = {}) {
  const steps = sessionFromClaudeCodeTranscript(jsonl);
  const ends = turnEnds(steps);
  const audit = { turns: ends.length, turns_with_claims: 0, outcomes: { PASS: 0, FAIL: 0, ABSTAIN: 0 }, claims: { SUPPORTED: 0, CONTRADICTED: 0, UNSUPPORTED: 0 }, flagged: [] };
  for (const i of ends) {
    const r = checkClaims(steps, i, { strict: opts.strict === true });
    if (!r.claims.length) continue;
    audit.turns_with_claims++;
    audit.outcomes[r.outcome]++;
    for (const c of r.claims) {
      audit.claims[c.status]++;
      if (c.status !== "SUPPORTED") audit.flagged.push({ ...r.final_message_at ? { at: r.final_message_at } : {}, kind: c.kind, status: c.status, claim: c.claim, reason: c.reason });
    }
  }
  return audit;
}
function stopHook(stdin, readFile, opts = {}) {
  const fail = opts.recordOnly ? 0 : 1;
  let hook;
  try {
    hook = JSON.parse(stdin);
  } catch {
    return { code: fail, stderr: "riposte-claims --hook: stdin is not hook JSON\n" };
  }
  if (hook.stop_hook_active === true) return { code: 0, stderr: "", skipped: "this stop was already sent back once" };
  if (typeof hook.transcript_path !== "string") return { code: fail, stderr: "riposte-claims --hook: no transcript_path in the hook input\n" };
  let steps;
  try {
    steps = sessionFromClaudeCodeTranscript(readFile(hook.transcript_path));
  } catch (e) {
    return { code: fail, stderr: `riposte-claims --hook: cannot read the transcript: ${e.message}
` };
  }
  const last = typeof hook.last_assistant_message === "string" && hook.last_assistant_message.trim() ? hook.last_assistant_message : null;
  let result;
  const policy = { strict: opts.strict === true };
  if (last) {
    const at = findFinalMessage(steps, last);
    result = checkMessageClaims(last, steps, at >= 0 ? at : steps.length, void 0, policy);
  } else result = checkClaims(steps, void 0, policy);
  const flagged = result.claims.filter((c) => c.status === "CONTRADICTED" || !opts.onlyContradicted && c.status === "UNSUPPORTED");
  if (!flagged.length) return { code: 0, stderr: "", result, wouldBlock: false };
  if (opts.recordOnly) return { code: 0, stderr: "", result, wouldBlock: true };
  const lines = flagged.map((c) => {
    const ev = c.evidence ? ` [${c.evidence.command ? c.evidence.command.slice(0, 60) : c.evidence.tool}${c.evidence.at ? ` @ ${c.evidence.at}` : ""}]` : "";
    return `\u2022 "${c.claim.length > 120 ? `${c.claim.slice(0, 117)}\u2026` : c.claim}" \u2014 ${c.status}: ${c.reason}${ev}`;
  });
  return {
    code: 2,
    result,
    wouldBlock: true,
    stderr: `Before you finish: your final message makes ${flagged.length === 1 ? "a claim" : "claims"} this session's tool results don't back.
${lines.join("\n")}
Run the check now and report what it actually shows, or correct the claim. (Riposte check_claims; it sends a stop back only once.)
`
  };
}
var MODES = ["record-only", "only-contradicted", "block"];
function hookOptionsFromEnv(env) {
  const problems = [];
  const raw = (env.RIPOSTE_HOOK_MODE ?? "").trim().toLowerCase();
  let mode = "record-only";
  if (raw) {
    if (MODES.includes(raw)) mode = raw;
    else problems.push(`RIPOSTE_HOOK_MODE="${env.RIPOSTE_HOOK_MODE}" is not one of ${MODES.join(" | ")}; using record-only`);
  }
  const strict = /^(?:1|true|yes)$/i.test((env.RIPOSTE_STRICT ?? "").trim());
  const opts = { recordOnly: mode === "record-only", onlyContradicted: mode === "only-contradicted", strict };
  const ledger = env.RIPOSTE_LEDGER?.trim() || void 0;
  return { mode, opts, ...ledger ? { ledger } : {}, problems };
}
function claimsCli(argv2, readFile, stdin) {
  const args2 = parseClaimsArgs(argv2);
  if (args2.help) return { code: 0, out: "", err: `${CLAIMS_USAGE}
` };
  if (args2.error) return { code: 3, out: "", err: `${args2.error}
${CLAIMS_USAGE}
` };
  if (args2.hook) {
    const d = stopHook(stdin ?? "", readFile, { onlyContradicted: args2.onlyContradicted, recordOnly: args2.recordOnly, strict: args2.strict });
    return { code: d.code, out: "", err: d.stderr };
  }
  let path = args2.path;
  if (!path && stdin?.trim()) {
    try {
      const hook = JSON.parse(stdin);
      if (typeof hook.transcript_path === "string") path = hook.transcript_path;
    } catch {
    }
  }
  if (!path) return { code: 3, out: "", err: `no transcript given
${CLAIMS_USAGE}
` };
  let text;
  try {
    text = readFile(path);
  } catch (e) {
    return { code: 3, out: "", err: `cannot read ${path}: ${e.message}
` };
  }
  if (args2.allTurns) {
    const a = auditTurns(text, { strict: args2.strict });
    const code = a.outcomes.FAIL ? 1 : a.outcomes.ABSTAIN ? 2 : a.outcomes.PASS ? 0 : 2;
    return { code, out: `${JSON.stringify(a, null, 2)}
`, err: `${a.turns} turns \xB7 ${a.turns_with_claims} with claims \xB7 ${a.claims.SUPPORTED} supported \xB7 ${a.claims.CONTRADICTED} contradicted \xB7 ${a.claims.UNSUPPORTED} unsupported
` };
  }
  const r = checkClaims(sessionFromClaudeCodeTranscript(text), void 0, { strict: args2.strict });
  return { code: CODES[r.outcome], out: `${JSON.stringify(r, null, 2)}
`, err: `${r.outcome}: ${r.reasons.join(" \xB7 ")}
` };
}

// packages/receipts/src/ledger.ts
import { createHash as createHash2, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from "node:crypto";

// packages/verify/src/binding/forensic-normalizer.ts
function normalizeDate(value, options = {}) {
  const { locale = "US", trackAmbiguity = true } = options;
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  const transformations = [];
  let originalValue = null;
  if (value instanceof Date) {
    originalValue = value;
    if (isNaN(value.getTime())) {
      return {
        original: originalValue,
        normalized: "",
        transformations: ["invalid_date_object"],
        success: false,
        error: "Invalid Date object"
      };
    }
    transformations.push("date_object_converted");
    return {
      original: originalValue,
      normalized: formatDateISO(value),
      transformations,
      success: true
    };
  }
  if (typeof value === "number") {
    originalValue = value;
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return {
        original: originalValue,
        normalized: "",
        transformations: ["invalid_timestamp"],
        success: false,
        error: "Invalid timestamp"
      };
    }
    transformations.push("timestamp_converted");
    return {
      original: originalValue,
      normalized: formatDateISO(date),
      transformations,
      success: true
    };
  }
  if (typeof value !== "string") {
    return null;
  }
  originalValue = value;
  const input = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return finishDate(originalValue, input, ["already_iso"]);
  }
  const isoWithTimeMatch = input.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoWithTimeMatch) {
    transformations.push("time_stripped");
    return finishDate(originalValue, isoWithTimeMatch[1], transformations);
  }
  const usMatch = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (usMatch) {
    const [, first, second, yearPart] = usMatch;
    const year = yearPart.length === 2 ? `20${yearPart}` : yearPart;
    const f = parseInt(first, 10);
    const s2 = parseInt(second, 10);
    if (f > 12 && s2 <= 12) {
      transformations.push("european_format_parsed");
      return finishDate(originalValue, `${year}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`, transformations);
    }
    if (f > 12 || s2 > 31) {
      return { original: originalValue, normalized: "", transformations: ["parse_failed"], success: false, error: `Could not parse date: ${input}` };
    }
    const ambiguous = f <= 12 && s2 <= 12 && f !== s2;
    if (ambiguous && trackAmbiguity) transformations.push("AMBIGUOUS_DATE");
    if (locale === "EU" && s2 <= 12) {
      transformations.push("european_format_applied");
      return finishDate(originalValue, `${year}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`, transformations);
    }
    transformations.push("us_format_parsed");
    return finishDate(originalValue, `${year}-${first.padStart(2, "0")}-${second.padStart(2, "0")}`, transformations);
  }
  const euroMatch = input.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (euroMatch) {
    const [, first, second, year] = euroMatch;
    const firstNum = parseInt(first, 10);
    const secondNum = parseInt(second, 10);
    if (firstNum > 12) {
      transformations.push("european_format_parsed");
      return finishDate(originalValue, `${year}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`, transformations);
    }
    if (secondNum > 12) {
      transformations.push("us_format_parsed");
      return finishDate(originalValue, `${year}-${first.padStart(2, "0")}-${second.padStart(2, "0")}`, transformations);
    }
    const isAmbiguous = firstNum <= 12 && secondNum <= 12 && firstNum !== secondNum;
    if (isAmbiguous && trackAmbiguity) {
      transformations.push("AMBIGUOUS_DATE");
    }
    if (locale === "EU") {
      transformations.push("european_format_applied");
      return finishDate(originalValue, `${year}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`, transformations);
    } else {
      transformations.push("us_format_defaulted");
      return finishDate(originalValue, `${year}-${first.padStart(2, "0")}-${second.padStart(2, "0")}`, transformations);
    }
  }
  const textMonthMatch = input.match(
    /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})$/i
  );
  if (textMonthMatch) {
    const [, monthName, day, year] = textMonthMatch;
    const month = parseMonthName(monthName);
    if (month) {
      transformations.push("text_month_parsed");
      return finishDate(originalValue, `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`, transformations);
    }
  }
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime())) {
    transformations.push("native_date_parsed");
    return {
      original: originalValue,
      normalized: formatDateISO(parsed),
      transformations,
      success: true
    };
  }
  return {
    original: originalValue,
    normalized: "",
    transformations: ["parse_failed"],
    success: false,
    error: `Could not parse date: ${input}`
  };
}
function finishDate(original, iso, transformations) {
  const t = Date.parse(iso);
  if (isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso) {
    return { original, normalized: "", transformations: [...transformations, "invalid_calendar_date"], success: false, error: `Not a calendar date: ${iso}` };
  }
  return { original, normalized: iso, transformations, success: true };
}
function parseMonthName(name) {
  const months = {
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12"
  };
  return months[name.toLowerCase()] || null;
}
function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function normalizeReference(value) {
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const original = String(value);
  const transformations = [];
  let normalized = original.trim();
  if (normalized !== original) {
    transformations.push("whitespace_trimmed");
  }
  const uppercased = normalized.toUpperCase();
  if (uppercased !== normalized) {
    transformations.push("uppercased");
    normalized = uppercased;
  }
  const cleaned = normalized.replace(/[^A-Z0-9]/g, "");
  if (cleaned !== normalized) {
    transformations.push("special_chars_removed");
    normalized = cleaned;
  }
  if (normalized.length === 0) {
    return {
      original,
      normalized: "",
      transformations: ["empty_after_normalization"],
      success: false,
      error: "Reference is empty after normalization"
    };
  }
  return {
    original,
    normalized,
    transformations: transformations.length > 0 ? transformations : ["no_changes"],
    success: true
  };
}
function foldDigits(s) {
  let folded = false;
  const out = Array.from(s, (ch) => {
    const c = ch.codePointAt(0);
    if (c >= 65296 && c <= 65305) {
      folded = true;
      return String(c - 65296);
    }
    if (c >= 1632 && c <= 1641) {
      folded = true;
      return String(c - 1632);
    }
    if (c >= 1776 && c <= 1785) {
      folded = true;
      return String(c - 1776);
    }
    if (c >= 2406 && c <= 2415) {
      folded = true;
      return String(c - 2406);
    }
    if (c >= 2534 && c <= 2543) {
      folded = true;
      return String(c - 2534);
    }
    if (c >= 3664 && c <= 3673) {
      folded = true;
      return String(c - 3664);
    }
    if (c === 65294) {
      folded = true;
      return ".";
    }
    if (c === 65292) {
      folded = true;
      return ",";
    }
    return ch;
  }).join("");
  return { text: out, folded };
}
var CJK_DIGIT = {
  "\u3007": 0,
  "\u96F6": 0,
  "\u4E00": 1,
  "\u58F9": 1,
  "\u4E8C": 2,
  "\u8CB3": 2,
  "\u8D30": 2,
  "\u5169": 2,
  "\u4E24": 2,
  "\u4E09": 3,
  "\u53C3": 3,
  "\u53C1": 3,
  "\u53C4": 3,
  "\u56DB": 4,
  "\u8086": 4,
  "\u4E94": 5,
  "\u4F0D": 5,
  "\u516D": 6,
  "\u9678": 6,
  "\u9646": 6,
  "\u4E03": 7,
  "\u67D2": 7,
  "\u516B": 8,
  "\u634C": 8,
  "\u4E5D": 9,
  "\u7396": 9
};
var CJK_SMALL = { "\u5341": 10, "\u62FE": 10, "\u767E": 100, "\u4F70": 100, "\u5343": 1e3, "\u4EDF": 1e3 };
var CJK_BIG = { "\u4E07": 1e4, "\u842C": 1e4, "\u5104": 1e8, "\u4EBF": 1e8, "\u5146": 1e12 };
var CJK_STRIP = /[円圓圆元圜￥¥整正也\s,]/g;
function parseCjkNumeral(input) {
  const s = input.replace(CJK_STRIP, "");
  if (s === "") return null;
  let hasCjk = false;
  for (const ch of s) if (ch in CJK_DIGIT || ch in CJK_SMALL || ch in CJK_BIG) {
    hasCjk = true;
    break;
  }
  if (!hasCjk) return null;
  let total = 0, section = 0, num2 = 0;
  let lastBig = Infinity, lastSmall = Infinity;
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") {
      num2 = num2 * 10 + (ch.charCodeAt(0) - 48);
      continue;
    }
    if (ch in CJK_DIGIT) {
      num2 = num2 * 10 + CJK_DIGIT[ch];
      continue;
    }
    if (ch in CJK_SMALL) {
      const u = CJK_SMALL[ch];
      if (u >= lastSmall) return null;
      lastSmall = u;
      section += (num2 === 0 ? 1 : num2) * u;
      num2 = 0;
      continue;
    }
    if (ch in CJK_BIG) {
      const b = CJK_BIG[ch];
      if (b >= lastBig) return null;
      lastBig = b;
      section += num2;
      if (section === 0) return null;
      total += section * b;
      section = 0;
      num2 = 0;
      lastSmall = Infinity;
      continue;
    }
    return null;
  }
  section += num2;
  total += section;
  return Number.isFinite(total) ? total : null;
}
function normalizeAmount(value) {
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  const transformations = [];
  let original = null;
  if (typeof value === "number") {
    original = value;
    if (isNaN(value)) {
      return {
        original,
        normalized: 0,
        transformations: ["invalid_nan"],
        success: false,
        error: "Value is NaN"
      };
    }
    const rounded2 = Math.round(value * 100) / 100;
    if (rounded2 !== value) {
      transformations.push("rounded_to_2_decimals");
    }
    return {
      original,
      normalized: rounded2,
      transformations: transformations.length > 0 ? transformations : ["already_number"],
      success: true
    };
  }
  if (typeof value !== "string") {
    return null;
  }
  original = value;
  let cleaned = value.trim();
  {
    const fd = foldDigits(cleaned);
    cleaned = fd.text;
    if (fd.folded) transformations.push("non_ascii_digits_folded");
  }
  {
    const cjk = parseCjkNumeral(cleaned);
    if (cjk !== null) {
      cleaned = String(cjk);
      transformations.push("cjk_numerals_parsed");
    }
  }
  let isNegative = false;
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    isNegative = true;
    cleaned = cleaned.slice(1, -1);
    transformations.push("parentheses_negative");
  }
  if (cleaned.endsWith("-")) {
    isNegative = true;
    cleaned = cleaned.slice(0, -1);
    transformations.push("trailing_minus");
  }
  if (cleaned.startsWith("-")) {
    isNegative = true;
    cleaned = cleaned.slice(1);
    transformations.push("leading_minus");
  }
  const beforeCurrency = cleaned;
  cleaned = cleaned.replace(/^[^0-9.\-,]+|[^0-9.\-,]+$/g, "");
  if (cleaned !== beforeCurrency) {
    transformations.push("currency_symbols_removed");
  }
  const lastComma = cleaned.lastIndexOf(",");
  const lastPeriod = cleaned.lastIndexOf(".");
  let detectedLocale = "unknown";
  if (lastComma > lastPeriod) {
    const afterComma = cleaned.substring(lastComma + 1);
    if (/^\d{1,2}$/.test(afterComma)) {
      detectedLocale = "EU";
    } else if (/^\d{3}$/.test(afterComma)) {
      detectedLocale = "US";
    }
  } else if (lastPeriod > lastComma) {
    const afterPeriod = cleaned.substring(lastPeriod + 1);
    if (/^\d{1,2}$/.test(afterPeriod)) {
      detectedLocale = "US";
    } else if (/^\d{3}$/.test(afterPeriod)) {
      detectedLocale = "EU";
    }
  }
  if (detectedLocale === "unknown") {
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(cleaned)) {
      detectedLocale = "EU";
    } else if (/^\d+,\d{1,2}$/.test(cleaned)) {
      detectedLocale = "EU";
    } else {
      detectedLocale = "US";
    }
  }
  if (detectedLocale === "EU") {
    cleaned = cleaned.replace(/\./g, "");
    cleaned = cleaned.replace(",", ".");
    transformations.push("european_format_converted");
  } else {
    const beforeCommaRemoval = cleaned;
    cleaned = cleaned.replace(/,/g, "");
    if (cleaned !== beforeCommaRemoval) {
      transformations.push("thousands_separators_removed");
    }
  }
  const parts = cleaned.split(".");
  if (parts.length > 2) {
    cleaned = parts.slice(0, -1).join("") + "." + parts[parts.length - 1];
    transformations.push("multiple_decimals_fixed");
  }
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) {
    return {
      original,
      normalized: 0,
      transformations: ["parse_failed"],
      success: false,
      error: `Could not parse amount: ${value}`
    };
  }
  let result = isNegative ? -parsed : parsed;
  const rounded = Math.round(result * 100) / 100;
  if (rounded !== result) {
    transformations.push("rounded_to_2_decimals");
    result = rounded;
  }
  return {
    original,
    normalized: result,
    transformations,
    success: true
  };
}
function normalizeQuantity(value) {
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  const transformations = [];
  let original = null;
  if (typeof value === "number") {
    original = value;
    if (isNaN(value)) {
      return {
        original,
        normalized: 0,
        transformations: ["invalid_nan"],
        success: false,
        error: "Value is NaN"
      };
    }
    return {
      original,
      normalized: value,
      transformations: ["already_number"],
      success: true
    };
  }
  if (typeof value !== "string") {
    return null;
  }
  original = value;
  let cleaned = value.trim().toLowerCase();
  {
    const fd = foldDigits(cleaned);
    cleaned = fd.text;
    if (fd.folded) transformations.push("non_ascii_digits_folded");
  }
  {
    const cjk = parseCjkNumeral(cleaned);
    if (cjk !== null) {
      cleaned = String(cjk);
      transformations.push("cjk_numerals_parsed");
    }
  }
  const fractionMatch = cleaned.match(/^(\d+)\/(\d+)/);
  if (fractionMatch) {
    const numerator = parseInt(fractionMatch[1], 10);
    const denominator = parseInt(fractionMatch[2], 10);
    if (denominator !== 0) {
      transformations.push("fraction_converted");
      return {
        original,
        normalized: numerator / denominator,
        transformations,
        success: true
      };
    }
  }
  const rangeMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*[-–—to]\s*\d+/);
  if (rangeMatch) {
    transformations.push("range_first_value_used");
    return {
      original,
      normalized: parseFloat(rangeMatch[1]),
      transformations,
      success: true
    };
  }
  const unitSuffixes = [
    "hours?",
    "hrs?",
    "hr",
    "days?",
    "d",
    "minutes?",
    "mins?",
    "min",
    "units?",
    "un",
    "each",
    "ea",
    "pieces?",
    "pcs?",
    "pc",
    "pounds?",
    "lbs?",
    "lb",
    "gallons?",
    "gal",
    "miles?",
    "mi",
    "tons?"
  ];
  const unitPattern = new RegExp(`\\s*(${unitSuffixes.join("|")})\\s*$`, "i");
  const withoutUnit = cleaned.replace(unitPattern, "");
  if (withoutUnit !== cleaned) {
    transformations.push("unit_suffix_removed");
    cleaned = withoutUnit;
  }
  const numMatch = cleaned.match(/^-?\d*\.?\d+/);
  if (numMatch) {
    return {
      original,
      normalized: parseFloat(numMatch[0]),
      transformations: transformations.length > 0 ? transformations : ["number_extracted"],
      success: true
    };
  }
  return {
    original,
    normalized: 0,
    transformations: ["parse_failed"],
    success: false,
    error: `Could not parse quantity: ${value}`
  };
}
function normalizeRate(value) {
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  const transformations = [];
  let original = null;
  let parsed;
  if (typeof value === "number") {
    original = value;
    if (isNaN(value)) {
      return { original, normalized: 0, transformations: ["invalid_nan"], success: false, error: "Value is NaN" };
    }
    parsed = value;
    transformations.push("already_number");
  } else if (typeof value === "string") {
    original = value;
    let cleaned = value.trim();
    {
      const fd = foldDigits(cleaned);
      cleaned = fd.text;
      if (fd.folded) transformations.push("non_ascii_digits_folded");
    }
    const hasPercentSign = cleaned.includes("%");
    if (hasPercentSign) {
      cleaned = cleaned.replace(/%/g, "");
      transformations.push("percent_sign_removed");
    }
    const beforeStrip = cleaned;
    cleaned = cleaned.replace(/[^0-9.,\-]/g, "");
    if (cleaned !== beforeStrip) transformations.push("non_numeric_removed");
    if (cleaned.includes(",") && !cleaned.includes(".")) {
      cleaned = cleaned.replace(",", ".");
      transformations.push("decimal_comma_converted");
    } else if (cleaned.includes(",")) {
      cleaned = cleaned.replace(/,/g, "");
      transformations.push("thousands_separators_removed");
    }
    parsed = parseFloat(cleaned);
    if (isNaN(parsed)) {
      return { original, normalized: 0, transformations: ["parse_failed"], success: false, error: `Could not parse rate: ${value}` };
    }
    if (hasPercentSign) {
      parsed = parsed / 100;
      transformations.push("percent_to_fraction");
    }
  } else {
    return null;
  }
  if (parsed > 1) {
    parsed = parsed / 100;
    transformations.push("percent_to_fraction_heuristic");
  }
  if (parsed < 0) {
    return { original, normalized: parsed, transformations: [...transformations, "negative_rate"], success: false, error: `Negative rate: ${value}` };
  }
  const normalized = Math.round(parsed * 1e9) / 1e9;
  return {
    original,
    normalized,
    transformations,
    success: true
  };
}

// node_modules/jsonpath-plus/dist/index-node-esm.js
import vm from "vm";
var Hooks = class {
  /**
   * @callback HookCallback
   * @this {*|Jsep} this
   * @param {Jsep} env
   * @returns: void
   */
  /**
   * Adds the given callback to the list of callbacks for the given hook.
   *
   * The callback will be invoked when the hook it is registered for is run.
   *
   * One callback function can be registered to multiple hooks and the same hook multiple times.
   *
   * @param {string|object} name The name of the hook, or an object of callbacks keyed by name
   * @param {HookCallback|boolean} callback The callback function which is given environment variables.
   * @param {?boolean} [first=false] Will add the hook to the top of the list (defaults to the bottom)
   * @public
   */
  add(name, callback, first) {
    if (typeof arguments[0] != "string") {
      for (let name2 in arguments[0]) {
        this.add(name2, arguments[0][name2], arguments[1]);
      }
    } else {
      (Array.isArray(name) ? name : [name]).forEach(function(name2) {
        this[name2] = this[name2] || [];
        if (callback) {
          this[name2][first ? "unshift" : "push"](callback);
        }
      }, this);
    }
  }
  /**
   * Runs a hook invoking all registered callbacks with the given environment variables.
   *
   * Callbacks will be invoked synchronously and in the order in which they were registered.
   *
   * @param {string} name The name of the hook.
   * @param {Object<string, any>} env The environment variables of the hook passed to all callbacks registered.
   * @public
   */
  run(name, env) {
    this[name] = this[name] || [];
    this[name].forEach(function(callback) {
      callback.call(env && env.context ? env.context : env, env);
    });
  }
};
var Plugins = class {
  constructor(jsep2) {
    this.jsep = jsep2;
    this.registered = {};
  }
  /**
   * @callback PluginSetup
   * @this {Jsep} jsep
   * @returns: void
   */
  /**
   * Adds the given plugin(s) to the registry
   *
   * @param {object} plugins
   * @param {string} plugins.name The name of the plugin
   * @param {PluginSetup} plugins.init The init function
   * @public
   */
  register(...plugins) {
    plugins.forEach((plugin2) => {
      if (typeof plugin2 !== "object" || !plugin2.name || !plugin2.init) {
        throw new Error("Invalid JSEP plugin format");
      }
      if (this.registered[plugin2.name]) {
        return;
      }
      plugin2.init(this.jsep);
      this.registered[plugin2.name] = plugin2;
    });
  }
};
var Jsep = class _Jsep {
  /**
   * @returns {string}
   */
  static get version() {
    return "1.4.0";
  }
  /**
   * @returns {string}
   */
  static toString() {
    return "JavaScript Expression Parser (JSEP) v" + _Jsep.version;
  }
  // ==================== CONFIG ================================
  /**
   * @method addUnaryOp
   * @param {string} op_name The name of the unary op to add
   * @returns {Jsep}
   */
  static addUnaryOp(op_name) {
    _Jsep.max_unop_len = Math.max(op_name.length, _Jsep.max_unop_len);
    _Jsep.unary_ops[op_name] = 1;
    return _Jsep;
  }
  /**
   * @method jsep.addBinaryOp
   * @param {string} op_name The name of the binary op to add
   * @param {number} precedence The precedence of the binary op (can be a float). Higher number = higher precedence
   * @param {boolean} [isRightAssociative=false] whether operator is right-associative
   * @returns {Jsep}
   */
  static addBinaryOp(op_name, precedence, isRightAssociative) {
    _Jsep.max_binop_len = Math.max(op_name.length, _Jsep.max_binop_len);
    _Jsep.binary_ops[op_name] = precedence;
    if (isRightAssociative) {
      _Jsep.right_associative.add(op_name);
    } else {
      _Jsep.right_associative.delete(op_name);
    }
    return _Jsep;
  }
  /**
   * @method addIdentifierChar
   * @param {string} char The additional character to treat as a valid part of an identifier
   * @returns {Jsep}
   */
  static addIdentifierChar(char) {
    _Jsep.additional_identifier_chars.add(char);
    return _Jsep;
  }
  /**
   * @method addLiteral
   * @param {string} literal_name The name of the literal to add
   * @param {*} literal_value The value of the literal
   * @returns {Jsep}
   */
  static addLiteral(literal_name, literal_value) {
    _Jsep.literals[literal_name] = literal_value;
    return _Jsep;
  }
  /**
   * @method removeUnaryOp
   * @param {string} op_name The name of the unary op to remove
   * @returns {Jsep}
   */
  static removeUnaryOp(op_name) {
    delete _Jsep.unary_ops[op_name];
    if (op_name.length === _Jsep.max_unop_len) {
      _Jsep.max_unop_len = _Jsep.getMaxKeyLen(_Jsep.unary_ops);
    }
    return _Jsep;
  }
  /**
   * @method removeAllUnaryOps
   * @returns {Jsep}
   */
  static removeAllUnaryOps() {
    _Jsep.unary_ops = {};
    _Jsep.max_unop_len = 0;
    return _Jsep;
  }
  /**
   * @method removeIdentifierChar
   * @param {string} char The additional character to stop treating as a valid part of an identifier
   * @returns {Jsep}
   */
  static removeIdentifierChar(char) {
    _Jsep.additional_identifier_chars.delete(char);
    return _Jsep;
  }
  /**
   * @method removeBinaryOp
   * @param {string} op_name The name of the binary op to remove
   * @returns {Jsep}
   */
  static removeBinaryOp(op_name) {
    delete _Jsep.binary_ops[op_name];
    if (op_name.length === _Jsep.max_binop_len) {
      _Jsep.max_binop_len = _Jsep.getMaxKeyLen(_Jsep.binary_ops);
    }
    _Jsep.right_associative.delete(op_name);
    return _Jsep;
  }
  /**
   * @method removeAllBinaryOps
   * @returns {Jsep}
   */
  static removeAllBinaryOps() {
    _Jsep.binary_ops = {};
    _Jsep.max_binop_len = 0;
    return _Jsep;
  }
  /**
   * @method removeLiteral
   * @param {string} literal_name The name of the literal to remove
   * @returns {Jsep}
   */
  static removeLiteral(literal_name) {
    delete _Jsep.literals[literal_name];
    return _Jsep;
  }
  /**
   * @method removeAllLiterals
   * @returns {Jsep}
   */
  static removeAllLiterals() {
    _Jsep.literals = {};
    return _Jsep;
  }
  // ==================== END CONFIG ============================
  /**
   * @returns {string}
   */
  get char() {
    return this.expr.charAt(this.index);
  }
  /**
   * @returns {number}
   */
  get code() {
    return this.expr.charCodeAt(this.index);
  }
  /**
   * @param {string} expr a string with the passed in express
   * @returns Jsep
   */
  constructor(expr) {
    this.expr = expr;
    this.index = 0;
  }
  /**
   * static top-level parser
   * @returns {jsep.Expression}
   */
  static parse(expr) {
    return new _Jsep(expr).parse();
  }
  /**
   * Get the longest key length of any object
   * @param {object} obj
   * @returns {number}
   */
  static getMaxKeyLen(obj) {
    return Math.max(0, ...Object.keys(obj).map((k) => k.length));
  }
  /**
   * `ch` is a character code in the next three functions
   * @param {number} ch
   * @returns {boolean}
   */
  static isDecimalDigit(ch) {
    return ch >= 48 && ch <= 57;
  }
  /**
   * Returns the precedence of a binary operator or `0` if it isn't a binary operator. Can be float.
   * @param {string} op_val
   * @returns {number}
   */
  static binaryPrecedence(op_val) {
    return _Jsep.binary_ops[op_val] || 0;
  }
  /**
   * Looks for start of identifier
   * @param {number} ch
   * @returns {boolean}
   */
  static isIdentifierStart(ch) {
    return ch >= 65 && ch <= 90 || // A...Z
    ch >= 97 && ch <= 122 || // a...z
    ch >= 128 && !_Jsep.binary_ops[String.fromCharCode(ch)] || // any non-ASCII that is not an operator
    _Jsep.additional_identifier_chars.has(String.fromCharCode(ch));
  }
  /**
   * @param {number} ch
   * @returns {boolean}
   */
  static isIdentifierPart(ch) {
    return _Jsep.isIdentifierStart(ch) || _Jsep.isDecimalDigit(ch);
  }
  /**
   * throw error at index of the expression
   * @param {string} message
   * @throws
   */
  throwError(message) {
    const error = new Error(message + " at character " + this.index);
    error.index = this.index;
    error.description = message;
    throw error;
  }
  /**
   * Run a given hook
   * @param {string} name
   * @param {jsep.Expression|false} [node]
   * @returns {?jsep.Expression}
   */
  runHook(name, node) {
    if (_Jsep.hooks[name]) {
      const env = {
        context: this,
        node
      };
      _Jsep.hooks.run(name, env);
      return env.node;
    }
    return node;
  }
  /**
   * Runs a given hook until one returns a node
   * @param {string} name
   * @returns {?jsep.Expression}
   */
  searchHook(name) {
    if (_Jsep.hooks[name]) {
      const env = {
        context: this
      };
      _Jsep.hooks[name].find(function(callback) {
        callback.call(env.context, env);
        return env.node;
      });
      return env.node;
    }
  }
  /**
   * Push `index` up to the next non-space character
   */
  gobbleSpaces() {
    let ch = this.code;
    while (ch === _Jsep.SPACE_CODE || ch === _Jsep.TAB_CODE || ch === _Jsep.LF_CODE || ch === _Jsep.CR_CODE) {
      ch = this.expr.charCodeAt(++this.index);
    }
    this.runHook("gobble-spaces");
  }
  /**
   * Top-level method to parse all expressions and returns compound or single node
   * @returns {jsep.Expression}
   */
  parse() {
    this.runHook("before-all");
    const nodes = this.gobbleExpressions();
    const node = nodes.length === 1 ? nodes[0] : {
      type: _Jsep.COMPOUND,
      body: nodes
    };
    return this.runHook("after-all", node);
  }
  /**
   * top-level parser (but can be reused within as well)
   * @param {number} [untilICode]
   * @returns {jsep.Expression[]}
   */
  gobbleExpressions(untilICode) {
    let nodes = [], ch_i, node;
    while (this.index < this.expr.length) {
      ch_i = this.code;
      if (ch_i === _Jsep.SEMCOL_CODE || ch_i === _Jsep.COMMA_CODE) {
        this.index++;
      } else {
        if (node = this.gobbleExpression()) {
          nodes.push(node);
        } else if (this.index < this.expr.length) {
          if (ch_i === untilICode) {
            break;
          }
          this.throwError('Unexpected "' + this.char + '"');
        }
      }
    }
    return nodes;
  }
  /**
   * The main parsing function.
   * @returns {?jsep.Expression}
   */
  gobbleExpression() {
    const node = this.searchHook("gobble-expression") || this.gobbleBinaryExpression();
    this.gobbleSpaces();
    return this.runHook("after-expression", node);
  }
  /**
   * Search for the operation portion of the string (e.g. `+`, `===`)
   * Start by taking the longest possible binary operations (3 characters: `===`, `!==`, `>>>`)
   * and move down from 3 to 2 to 1 character until a matching binary operation is found
   * then, return that binary operation
   * @returns {string|boolean}
   */
  gobbleBinaryOp() {
    this.gobbleSpaces();
    let to_check = this.expr.substr(this.index, _Jsep.max_binop_len);
    let tc_len = to_check.length;
    while (tc_len > 0) {
      if (_Jsep.binary_ops.hasOwnProperty(to_check) && (!_Jsep.isIdentifierStart(this.code) || this.index + to_check.length < this.expr.length && !_Jsep.isIdentifierPart(this.expr.charCodeAt(this.index + to_check.length)))) {
        this.index += tc_len;
        return to_check;
      }
      to_check = to_check.substr(0, --tc_len);
    }
    return false;
  }
  /**
   * This function is responsible for gobbling an individual expression,
   * e.g. `1`, `1+2`, `a+(b*2)-Math.sqrt(2)`
   * @returns {?jsep.BinaryExpression}
   */
  gobbleBinaryExpression() {
    let node, biop, prec, stack, biop_info, left, right, i, cur_biop;
    left = this.gobbleToken();
    if (!left) {
      return left;
    }
    biop = this.gobbleBinaryOp();
    if (!biop) {
      return left;
    }
    biop_info = {
      value: biop,
      prec: _Jsep.binaryPrecedence(biop),
      right_a: _Jsep.right_associative.has(biop)
    };
    right = this.gobbleToken();
    if (!right) {
      this.throwError("Expected expression after " + biop);
    }
    stack = [left, biop_info, right];
    while (biop = this.gobbleBinaryOp()) {
      prec = _Jsep.binaryPrecedence(biop);
      if (prec === 0) {
        this.index -= biop.length;
        break;
      }
      biop_info = {
        value: biop,
        prec,
        right_a: _Jsep.right_associative.has(biop)
      };
      cur_biop = biop;
      const comparePrev = (prev) => biop_info.right_a && prev.right_a ? prec > prev.prec : prec <= prev.prec;
      while (stack.length > 2 && comparePrev(stack[stack.length - 2])) {
        right = stack.pop();
        biop = stack.pop().value;
        left = stack.pop();
        node = {
          type: _Jsep.BINARY_EXP,
          operator: biop,
          left,
          right
        };
        stack.push(node);
      }
      node = this.gobbleToken();
      if (!node) {
        this.throwError("Expected expression after " + cur_biop);
      }
      stack.push(biop_info, node);
    }
    i = stack.length - 1;
    node = stack[i];
    while (i > 1) {
      node = {
        type: _Jsep.BINARY_EXP,
        operator: stack[i - 1].value,
        left: stack[i - 2],
        right: node
      };
      i -= 2;
    }
    return node;
  }
  /**
   * An individual part of a binary expression:
   * e.g. `foo.bar(baz)`, `1`, `"abc"`, `(a % 2)` (because it's in parenthesis)
   * @returns {boolean|jsep.Expression}
   */
  gobbleToken() {
    let ch, to_check, tc_len, node;
    this.gobbleSpaces();
    node = this.searchHook("gobble-token");
    if (node) {
      return this.runHook("after-token", node);
    }
    ch = this.code;
    if (_Jsep.isDecimalDigit(ch) || ch === _Jsep.PERIOD_CODE) {
      return this.gobbleNumericLiteral();
    }
    if (ch === _Jsep.SQUOTE_CODE || ch === _Jsep.DQUOTE_CODE) {
      node = this.gobbleStringLiteral();
    } else if (ch === _Jsep.OBRACK_CODE) {
      node = this.gobbleArray();
    } else {
      to_check = this.expr.substr(this.index, _Jsep.max_unop_len);
      tc_len = to_check.length;
      while (tc_len > 0) {
        if (_Jsep.unary_ops.hasOwnProperty(to_check) && (!_Jsep.isIdentifierStart(this.code) || this.index + to_check.length < this.expr.length && !_Jsep.isIdentifierPart(this.expr.charCodeAt(this.index + to_check.length)))) {
          this.index += tc_len;
          const argument = this.gobbleToken();
          if (!argument) {
            this.throwError("missing unaryOp argument");
          }
          return this.runHook("after-token", {
            type: _Jsep.UNARY_EXP,
            operator: to_check,
            argument,
            prefix: true
          });
        }
        to_check = to_check.substr(0, --tc_len);
      }
      if (_Jsep.isIdentifierStart(ch)) {
        node = this.gobbleIdentifier();
        if (_Jsep.literals.hasOwnProperty(node.name)) {
          node = {
            type: _Jsep.LITERAL,
            value: _Jsep.literals[node.name],
            raw: node.name
          };
        } else if (node.name === _Jsep.this_str) {
          node = {
            type: _Jsep.THIS_EXP
          };
        }
      } else if (ch === _Jsep.OPAREN_CODE) {
        node = this.gobbleGroup();
      }
    }
    if (!node) {
      return this.runHook("after-token", false);
    }
    node = this.gobbleTokenProperty(node);
    return this.runHook("after-token", node);
  }
  /**
   * Gobble properties of of identifiers/strings/arrays/groups.
   * e.g. `foo`, `bar.baz`, `foo['bar'].baz`
   * It also gobbles function calls:
   * e.g. `Math.acos(obj.angle)`
   * @param {jsep.Expression} node
   * @returns {jsep.Expression}
   */
  gobbleTokenProperty(node) {
    this.gobbleSpaces();
    let ch = this.code;
    while (ch === _Jsep.PERIOD_CODE || ch === _Jsep.OBRACK_CODE || ch === _Jsep.OPAREN_CODE || ch === _Jsep.QUMARK_CODE) {
      let optional;
      if (ch === _Jsep.QUMARK_CODE) {
        if (this.expr.charCodeAt(this.index + 1) !== _Jsep.PERIOD_CODE) {
          break;
        }
        optional = true;
        this.index += 2;
        this.gobbleSpaces();
        ch = this.code;
      }
      this.index++;
      if (ch === _Jsep.OBRACK_CODE) {
        node = {
          type: _Jsep.MEMBER_EXP,
          computed: true,
          object: node,
          property: this.gobbleExpression()
        };
        if (!node.property) {
          this.throwError('Unexpected "' + this.char + '"');
        }
        this.gobbleSpaces();
        ch = this.code;
        if (ch !== _Jsep.CBRACK_CODE) {
          this.throwError("Unclosed [");
        }
        this.index++;
      } else if (ch === _Jsep.OPAREN_CODE) {
        node = {
          type: _Jsep.CALL_EXP,
          "arguments": this.gobbleArguments(_Jsep.CPAREN_CODE),
          callee: node
        };
      } else if (ch === _Jsep.PERIOD_CODE || optional) {
        if (optional) {
          this.index--;
        }
        this.gobbleSpaces();
        node = {
          type: _Jsep.MEMBER_EXP,
          computed: false,
          object: node,
          property: this.gobbleIdentifier()
        };
      }
      if (optional) {
        node.optional = true;
      }
      this.gobbleSpaces();
      ch = this.code;
    }
    return node;
  }
  /**
   * Parse simple numeric literals: `12`, `3.4`, `.5`. Do this by using a string to
   * keep track of everything in the numeric literal and then calling `parseFloat` on that string
   * @returns {jsep.Literal}
   */
  gobbleNumericLiteral() {
    let number = "", ch, chCode;
    while (_Jsep.isDecimalDigit(this.code)) {
      number += this.expr.charAt(this.index++);
    }
    if (this.code === _Jsep.PERIOD_CODE) {
      number += this.expr.charAt(this.index++);
      while (_Jsep.isDecimalDigit(this.code)) {
        number += this.expr.charAt(this.index++);
      }
    }
    ch = this.char;
    if (ch === "e" || ch === "E") {
      number += this.expr.charAt(this.index++);
      ch = this.char;
      if (ch === "+" || ch === "-") {
        number += this.expr.charAt(this.index++);
      }
      while (_Jsep.isDecimalDigit(this.code)) {
        number += this.expr.charAt(this.index++);
      }
      if (!_Jsep.isDecimalDigit(this.expr.charCodeAt(this.index - 1))) {
        this.throwError("Expected exponent (" + number + this.char + ")");
      }
    }
    chCode = this.code;
    if (_Jsep.isIdentifierStart(chCode)) {
      this.throwError("Variable names cannot start with a number (" + number + this.char + ")");
    } else if (chCode === _Jsep.PERIOD_CODE || number.length === 1 && number.charCodeAt(0) === _Jsep.PERIOD_CODE) {
      this.throwError("Unexpected period");
    }
    return {
      type: _Jsep.LITERAL,
      value: parseFloat(number),
      raw: number
    };
  }
  /**
   * Parses a string literal, staring with single or double quotes with basic support for escape codes
   * e.g. `"hello world"`, `'this is\nJSEP'`
   * @returns {jsep.Literal}
   */
  gobbleStringLiteral() {
    let str = "";
    const startIndex = this.index;
    const quote = this.expr.charAt(this.index++);
    let closed = false;
    while (this.index < this.expr.length) {
      let ch = this.expr.charAt(this.index++);
      if (ch === quote) {
        closed = true;
        break;
      } else if (ch === "\\") {
        ch = this.expr.charAt(this.index++);
        switch (ch) {
          case "n":
            str += "\n";
            break;
          case "r":
            str += "\r";
            break;
          case "t":
            str += "	";
            break;
          case "b":
            str += "\b";
            break;
          case "f":
            str += "\f";
            break;
          case "v":
            str += "\v";
            break;
          default:
            str += ch;
        }
      } else {
        str += ch;
      }
    }
    if (!closed) {
      this.throwError('Unclosed quote after "' + str + '"');
    }
    return {
      type: _Jsep.LITERAL,
      value: str,
      raw: this.expr.substring(startIndex, this.index)
    };
  }
  /**
   * Gobbles only identifiers
   * e.g.: `foo`, `_value`, `$x1`
   * Also, this function checks if that identifier is a literal:
   * (e.g. `true`, `false`, `null`) or `this`
   * @returns {jsep.Identifier}
   */
  gobbleIdentifier() {
    let ch = this.code, start = this.index;
    if (_Jsep.isIdentifierStart(ch)) {
      this.index++;
    } else {
      this.throwError("Unexpected " + this.char);
    }
    while (this.index < this.expr.length) {
      ch = this.code;
      if (_Jsep.isIdentifierPart(ch)) {
        this.index++;
      } else {
        break;
      }
    }
    return {
      type: _Jsep.IDENTIFIER,
      name: this.expr.slice(start, this.index)
    };
  }
  /**
   * Gobbles a list of arguments within the context of a function call
   * or array literal. This function also assumes that the opening character
   * `(` or `[` has already been gobbled, and gobbles expressions and commas
   * until the terminator character `)` or `]` is encountered.
   * e.g. `foo(bar, baz)`, `my_func()`, or `[bar, baz]`
   * @param {number} termination
   * @returns {jsep.Expression[]}
   */
  gobbleArguments(termination) {
    const args2 = [];
    let closed = false;
    let separator_count = 0;
    while (this.index < this.expr.length) {
      this.gobbleSpaces();
      let ch_i = this.code;
      if (ch_i === termination) {
        closed = true;
        this.index++;
        if (termination === _Jsep.CPAREN_CODE && separator_count && separator_count >= args2.length) {
          this.throwError("Unexpected token " + String.fromCharCode(termination));
        }
        break;
      } else if (ch_i === _Jsep.COMMA_CODE) {
        this.index++;
        separator_count++;
        if (separator_count !== args2.length) {
          if (termination === _Jsep.CPAREN_CODE) {
            this.throwError("Unexpected token ,");
          } else if (termination === _Jsep.CBRACK_CODE) {
            for (let arg = args2.length; arg < separator_count; arg++) {
              args2.push(null);
            }
          }
        }
      } else if (args2.length !== separator_count && separator_count !== 0) {
        this.throwError("Expected comma");
      } else {
        const node = this.gobbleExpression();
        if (!node || node.type === _Jsep.COMPOUND) {
          this.throwError("Expected comma");
        }
        args2.push(node);
      }
    }
    if (!closed) {
      this.throwError("Expected " + String.fromCharCode(termination));
    }
    return args2;
  }
  /**
   * Responsible for parsing a group of things within parentheses `()`
   * that have no identifier in front (so not a function call)
   * This function assumes that it needs to gobble the opening parenthesis
   * and then tries to gobble everything within that parenthesis, assuming
   * that the next thing it should see is the close parenthesis. If not,
   * then the expression probably doesn't have a `)`
   * @returns {boolean|jsep.Expression}
   */
  gobbleGroup() {
    this.index++;
    let nodes = this.gobbleExpressions(_Jsep.CPAREN_CODE);
    if (this.code === _Jsep.CPAREN_CODE) {
      this.index++;
      if (nodes.length === 1) {
        return nodes[0];
      } else if (!nodes.length) {
        return false;
      } else {
        return {
          type: _Jsep.SEQUENCE_EXP,
          expressions: nodes
        };
      }
    } else {
      this.throwError("Unclosed (");
    }
  }
  /**
   * Responsible for parsing Array literals `[1, 2, 3]`
   * This function assumes that it needs to gobble the opening bracket
   * and then tries to gobble the expressions as arguments.
   * @returns {jsep.ArrayExpression}
   */
  gobbleArray() {
    this.index++;
    return {
      type: _Jsep.ARRAY_EXP,
      elements: this.gobbleArguments(_Jsep.CBRACK_CODE)
    };
  }
};
var hooks = new Hooks();
Object.assign(Jsep, {
  hooks,
  plugins: new Plugins(Jsep),
  // Node Types
  // ----------
  // This is the full set of types that any JSEP node can be.
  // Store them here to save space when minified
  COMPOUND: "Compound",
  SEQUENCE_EXP: "SequenceExpression",
  IDENTIFIER: "Identifier",
  MEMBER_EXP: "MemberExpression",
  LITERAL: "Literal",
  THIS_EXP: "ThisExpression",
  CALL_EXP: "CallExpression",
  UNARY_EXP: "UnaryExpression",
  BINARY_EXP: "BinaryExpression",
  ARRAY_EXP: "ArrayExpression",
  TAB_CODE: 9,
  LF_CODE: 10,
  CR_CODE: 13,
  SPACE_CODE: 32,
  PERIOD_CODE: 46,
  // '.'
  COMMA_CODE: 44,
  // ','
  SQUOTE_CODE: 39,
  // single quote
  DQUOTE_CODE: 34,
  // double quotes
  OPAREN_CODE: 40,
  // (
  CPAREN_CODE: 41,
  // )
  OBRACK_CODE: 91,
  // [
  CBRACK_CODE: 93,
  // ]
  QUMARK_CODE: 63,
  // ?
  SEMCOL_CODE: 59,
  // ;
  COLON_CODE: 58,
  // :
  // Operations
  // ----------
  // Use a quickly-accessible map to store all of the unary operators
  // Values are set to `1` (it really doesn't matter)
  unary_ops: {
    "-": 1,
    "!": 1,
    "~": 1,
    "+": 1
  },
  // Also use a map for the binary operations but set their values to their
  // binary precedence for quick reference (higher number = higher precedence)
  // see [Order of operations](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_Precedence)
  binary_ops: {
    "||": 1,
    "??": 1,
    "&&": 2,
    "|": 3,
    "^": 4,
    "&": 5,
    "==": 6,
    "!=": 6,
    "===": 6,
    "!==": 6,
    "<": 7,
    ">": 7,
    "<=": 7,
    ">=": 7,
    "<<": 8,
    ">>": 8,
    ">>>": 8,
    "+": 9,
    "-": 9,
    "*": 10,
    "/": 10,
    "%": 10,
    "**": 11
  },
  // sets specific binary_ops as right-associative
  right_associative: /* @__PURE__ */ new Set(["**"]),
  // Additional valid identifier chars, apart from a-z, A-Z and 0-9 (except on the starting char)
  additional_identifier_chars: /* @__PURE__ */ new Set(["$", "_"]),
  // Literals
  // ----------
  // Store the values to return for the various literals we may encounter
  literals: {
    "true": true,
    "false": false,
    "null": null
  },
  // Except for `this`, which is special. This could be changed to something like `'self'` as well
  this_str: "this"
});
Jsep.max_unop_len = Jsep.getMaxKeyLen(Jsep.unary_ops);
Jsep.max_binop_len = Jsep.getMaxKeyLen(Jsep.binary_ops);
var jsep = (expr) => new Jsep(expr).parse();
var stdClassProps = Object.getOwnPropertyNames(class Test {
});
Object.getOwnPropertyNames(Jsep).filter((prop) => !stdClassProps.includes(prop) && jsep[prop] === void 0).forEach((m) => {
  jsep[m] = Jsep[m];
});
jsep.Jsep = Jsep;
var CONDITIONAL_EXP = "ConditionalExpression";
var ternary = {
  name: "ternary",
  init(jsep2) {
    jsep2.hooks.add("after-expression", function gobbleTernary(env) {
      if (env.node && this.code === jsep2.QUMARK_CODE) {
        this.index++;
        const test = env.node;
        const consequent = this.gobbleExpression();
        if (!consequent) {
          this.throwError("Expected expression");
        }
        this.gobbleSpaces();
        if (this.code === jsep2.COLON_CODE) {
          this.index++;
          const alternate = this.gobbleExpression();
          if (!alternate) {
            this.throwError("Expected expression");
          }
          env.node = {
            type: CONDITIONAL_EXP,
            test,
            consequent,
            alternate
          };
          if (test.operator && jsep2.binary_ops[test.operator] <= 0.9) {
            let newTest = test;
            while (newTest.right.operator && jsep2.binary_ops[newTest.right.operator] <= 0.9) {
              newTest = newTest.right;
            }
            env.node.test = newTest.right;
            newTest.right = env.node;
            env.node = test;
          }
        } else {
          this.throwError("Expected :");
        }
      }
    });
  }
};
jsep.plugins.register(ternary);
var FSLASH_CODE = 47;
var BSLASH_CODE = 92;
var index = {
  name: "regex",
  init(jsep2) {
    jsep2.hooks.add("gobble-token", function gobbleRegexLiteral(env) {
      if (this.code === FSLASH_CODE) {
        const patternIndex = ++this.index;
        let inCharSet = false;
        while (this.index < this.expr.length) {
          if (this.code === FSLASH_CODE && !inCharSet) {
            const pattern = this.expr.slice(patternIndex, this.index);
            let flags = "";
            while (++this.index < this.expr.length) {
              const code = this.code;
              if (code >= 97 && code <= 122 || code >= 65 && code <= 90 || code >= 48 && code <= 57) {
                flags += this.char;
              } else {
                break;
              }
            }
            let value;
            try {
              value = new RegExp(pattern, flags);
            } catch (e) {
              this.throwError(e.message);
            }
            env.node = {
              type: jsep2.LITERAL,
              value,
              raw: this.expr.slice(patternIndex - 1, this.index)
            };
            env.node = this.gobbleTokenProperty(env.node);
            return env.node;
          }
          if (this.code === jsep2.OBRACK_CODE) {
            inCharSet = true;
          } else if (inCharSet && this.code === jsep2.CBRACK_CODE) {
            inCharSet = false;
          }
          this.index += this.code === BSLASH_CODE ? 2 : 1;
        }
        this.throwError("Unclosed Regex");
      }
    });
  }
};
var PLUS_CODE = 43;
var MINUS_CODE = 45;
var plugin = {
  name: "assignment",
  assignmentOperators: /* @__PURE__ */ new Set(["=", "*=", "**=", "/=", "%=", "+=", "-=", "<<=", ">>=", ">>>=", "&=", "^=", "|=", "||=", "&&=", "??="]),
  updateOperators: [PLUS_CODE, MINUS_CODE],
  assignmentPrecedence: 0.9,
  init(jsep2) {
    const updateNodeTypes = [jsep2.IDENTIFIER, jsep2.MEMBER_EXP];
    plugin.assignmentOperators.forEach((op) => jsep2.addBinaryOp(op, plugin.assignmentPrecedence, true));
    jsep2.hooks.add("gobble-token", function gobbleUpdatePrefix(env) {
      const code = this.code;
      if (plugin.updateOperators.some((c) => c === code && c === this.expr.charCodeAt(this.index + 1))) {
        this.index += 2;
        env.node = {
          type: "UpdateExpression",
          operator: code === PLUS_CODE ? "++" : "--",
          argument: this.gobbleTokenProperty(this.gobbleIdentifier()),
          prefix: true
        };
        if (!env.node.argument || !updateNodeTypes.includes(env.node.argument.type)) {
          this.throwError(`Unexpected ${env.node.operator}`);
        }
      }
    });
    jsep2.hooks.add("after-token", function gobbleUpdatePostfix(env) {
      if (env.node) {
        const code = this.code;
        if (plugin.updateOperators.some((c) => c === code && c === this.expr.charCodeAt(this.index + 1))) {
          if (!updateNodeTypes.includes(env.node.type)) {
            this.throwError(`Unexpected ${env.node.operator}`);
          }
          this.index += 2;
          env.node = {
            type: "UpdateExpression",
            operator: code === PLUS_CODE ? "++" : "--",
            argument: env.node,
            prefix: false
          };
        }
      }
    });
    jsep2.hooks.add("after-expression", function gobbleAssignment(env) {
      if (env.node) {
        updateBinariesToAssignments(env.node);
      }
    });
    function updateBinariesToAssignments(node) {
      if (plugin.assignmentOperators.has(node.operator)) {
        node.type = "AssignmentExpression";
        updateBinariesToAssignments(node.left);
        updateBinariesToAssignments(node.right);
      } else if (!node.operator) {
        Object.values(node).forEach((val) => {
          if (val && typeof val === "object") {
            updateBinariesToAssignments(val);
          }
        });
      }
    }
  }
};
jsep.plugins.register(index, plugin);
jsep.addUnaryOp("typeof");
jsep.addUnaryOp("void");
jsep.addLiteral("null", null);
jsep.addLiteral("undefined", void 0);
var BLOCKED_PROTO_PROPERTIES = /* @__PURE__ */ new Set(["constructor", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]);
var SafeEval = {
  /**
   * @param {jsep.Expression} ast
   * @param {Record<string, any>} subs
   */
  evalAst(ast, subs) {
    switch (ast.type) {
      case "BinaryExpression":
      case "LogicalExpression":
        return SafeEval.evalBinaryExpression(ast, subs);
      case "Compound":
        return SafeEval.evalCompound(ast, subs);
      case "ConditionalExpression":
        return SafeEval.evalConditionalExpression(ast, subs);
      case "Identifier":
        return SafeEval.evalIdentifier(ast, subs);
      case "Literal":
        return SafeEval.evalLiteral(ast, subs);
      case "MemberExpression":
        return SafeEval.evalMemberExpression(ast, subs);
      case "UnaryExpression":
        return SafeEval.evalUnaryExpression(ast, subs);
      case "ArrayExpression":
        return SafeEval.evalArrayExpression(ast, subs);
      case "CallExpression":
        return SafeEval.evalCallExpression(ast, subs);
      case "AssignmentExpression":
        return SafeEval.evalAssignmentExpression(ast, subs);
      default:
        throw SyntaxError("Unexpected expression", ast);
    }
  },
  evalBinaryExpression(ast, subs) {
    const result = {
      "||": (a, b) => a || b(),
      "&&": (a, b) => a && b(),
      "|": (a, b) => a | b(),
      "^": (a, b) => a ^ b(),
      "&": (a, b) => a & b(),
      // eslint-disable-next-line eqeqeq -- API
      "==": (a, b) => a == b(),
      // eslint-disable-next-line eqeqeq -- API
      "!=": (a, b) => a != b(),
      "===": (a, b) => a === b(),
      "!==": (a, b) => a !== b(),
      "<": (a, b) => a < b(),
      ">": (a, b) => a > b(),
      "<=": (a, b) => a <= b(),
      ">=": (a, b) => a >= b(),
      "<<": (a, b) => a << b(),
      ">>": (a, b) => a >> b(),
      ">>>": (a, b) => a >>> b(),
      "+": (a, b) => a + b(),
      "-": (a, b) => a - b(),
      "*": (a, b) => a * b(),
      "/": (a, b) => a / b(),
      "%": (a, b) => a % b()
    }[ast.operator](SafeEval.evalAst(ast.left, subs), () => SafeEval.evalAst(ast.right, subs));
    return result;
  },
  evalCompound(ast, subs) {
    let last;
    for (let i = 0; i < ast.body.length; i++) {
      if (ast.body[i].type === "Identifier" && ["var", "let", "const"].includes(ast.body[i].name) && ast.body[i + 1] && ast.body[i + 1].type === "AssignmentExpression") {
        i += 1;
      }
      const expr = ast.body[i];
      last = SafeEval.evalAst(expr, subs);
    }
    return last;
  },
  evalConditionalExpression(ast, subs) {
    if (SafeEval.evalAst(ast.test, subs)) {
      return SafeEval.evalAst(ast.consequent, subs);
    }
    return SafeEval.evalAst(ast.alternate, subs);
  },
  evalIdentifier(ast, subs) {
    if (Object.hasOwn(subs, ast.name)) {
      return subs[ast.name];
    }
    throw ReferenceError(`${ast.name} is not defined`);
  },
  evalLiteral(ast) {
    return ast.value;
  },
  evalMemberExpression(ast, subs) {
    const prop = String(
      // NOTE: `String(value)` throws error when
      // value has overwritten the toString method to return non-string
      // i.e. `value = {toString: () => []}`
      ast.computed ? SafeEval.evalAst(ast.property) : ast.property.name
      // `object.property` property is Identifier
    );
    const obj = SafeEval.evalAst(ast.object, subs);
    if (obj === void 0 || obj === null) {
      throw TypeError(`Cannot read properties of ${obj} (reading '${prop}')`);
    }
    if (!Object.hasOwn(obj, prop) && BLOCKED_PROTO_PROPERTIES.has(prop)) {
      throw TypeError(`Cannot read properties of ${obj} (reading '${prop}')`);
    }
    const result = obj[prop];
    if (typeof result === "function") {
      return result.bind(obj);
    }
    return result;
  },
  evalUnaryExpression(ast, subs) {
    const result = {
      "-": (a) => -SafeEval.evalAst(a, subs),
      "!": (a) => !SafeEval.evalAst(a, subs),
      "~": (a) => ~SafeEval.evalAst(a, subs),
      // eslint-disable-next-line no-implicit-coercion -- API
      "+": (a) => +SafeEval.evalAst(a, subs),
      typeof: (a) => typeof SafeEval.evalAst(a, subs),
      // eslint-disable-next-line no-void, sonarjs/void-use -- feature
      void: (a) => void SafeEval.evalAst(a, subs)
    }[ast.operator](ast.argument);
    return result;
  },
  evalArrayExpression(ast, subs) {
    return ast.elements.map((el) => SafeEval.evalAst(el, subs));
  },
  evalCallExpression(ast, subs) {
    const args2 = ast.arguments.map((arg) => SafeEval.evalAst(arg, subs));
    const func = SafeEval.evalAst(ast.callee, subs);
    if (func === Function) {
      throw new Error("Function constructor is disabled");
    }
    return func(...args2);
  },
  evalAssignmentExpression(ast, subs) {
    if (ast.left.type !== "Identifier") {
      throw SyntaxError("Invalid left-hand side in assignment");
    }
    const id = ast.left.name;
    const value = SafeEval.evalAst(ast.right, subs);
    subs[id] = value;
    return subs[id];
  }
};
var SafeScript = class {
  /**
   * @param {string} expr Expression to evaluate
   */
  constructor(expr) {
    this.code = expr;
    this.ast = jsep(this.code);
  }
  /**
   * @param {object} context Object whose items will be added
   *   to evaluation
   * @returns {EvaluatedResult} Result of evaluated code
   */
  runInNewContext(context) {
    const keyMap = Object.assign(/* @__PURE__ */ Object.create(null), context);
    return SafeEval.evalAst(this.ast, keyMap);
  }
};
function push(arr, item) {
  arr = arr.slice();
  arr.push(item);
  return arr;
}
function unshift(item, arr) {
  arr = arr.slice();
  arr.unshift(item);
  return arr;
}
var NewError = class extends Error {
  /**
   * @param {AnyResult} value The evaluated scalar value
   */
  constructor(value) {
    super('JSONPath should not be called with "new" (it prevents return of (unwrapped) scalar values)');
    this.avoidNew = true;
    this.value = value;
    this.name = "NewError";
  }
};
function JSONPath(opts, expr, obj, callback, otherTypeCallback) {
  if (!(this instanceof JSONPath)) {
    try {
      return new JSONPath(opts, expr, obj, callback, otherTypeCallback);
    } catch (e) {
      if (!e.avoidNew) {
        throw e;
      }
      return e.value;
    }
  }
  if (typeof opts === "string") {
    otherTypeCallback = callback;
    callback = obj;
    obj = expr;
    expr = opts;
    opts = null;
  }
  const optObj = opts && typeof opts === "object";
  opts = opts || {};
  this.json = opts.json || obj;
  this.path = opts.path || expr;
  this.resultType = opts.resultType || "value";
  this.flatten = opts.flatten || false;
  this.wrap = Object.hasOwn(opts, "wrap") ? opts.wrap : true;
  this.sandbox = opts.sandbox || {};
  this.eval = opts.eval === void 0 ? "safe" : opts.eval;
  this.ignoreEvalErrors = typeof opts.ignoreEvalErrors === "undefined" ? false : opts.ignoreEvalErrors;
  this.parent = opts.parent || null;
  this.parentProperty = opts.parentProperty || null;
  this.callback = opts.callback || callback || null;
  this.otherTypeCallback = opts.otherTypeCallback || otherTypeCallback || function() {
    throw new TypeError("You must supply an otherTypeCallback callback option with the @other() operator.");
  };
  if (opts.autostart !== false) {
    const args2 = {
      path: optObj ? opts.path : expr
    };
    if (!optObj) {
      args2.json = obj;
    } else if ("json" in opts) {
      args2.json = opts.json;
    }
    const ret = this.evaluate(args2);
    if (!ret || typeof ret !== "object") {
      throw new NewError(ret);
    }
    return ret;
  }
}
JSONPath.prototype.evaluate = function(expr, json, callback, otherTypeCallback) {
  let currParent = this.parent, currParentProperty = this.parentProperty;
  let {
    flatten,
    wrap
  } = this;
  this.currResultType = this.resultType;
  this.currEval = this.eval;
  this.currSandbox = this.sandbox;
  callback = callback || this.callback;
  this.currOtherTypeCallback = otherTypeCallback || this.otherTypeCallback;
  json = json || this.json;
  expr = expr || this.path;
  if (expr && typeof expr === "object" && !Array.isArray(expr)) {
    if (!expr.path && expr.path !== "") {
      throw new TypeError('You must supply a "path" property when providing an object argument to JSONPath.evaluate().');
    }
    if (!Object.hasOwn(expr, "json")) {
      throw new TypeError('You must supply a "json" property when providing an object argument to JSONPath.evaluate().');
    }
    ({
      json
    } = expr);
    flatten = Object.hasOwn(expr, "flatten") ? expr.flatten : flatten;
    this.currResultType = Object.hasOwn(expr, "resultType") ? expr.resultType : this.currResultType;
    this.currSandbox = Object.hasOwn(expr, "sandbox") ? expr.sandbox : this.currSandbox;
    wrap = Object.hasOwn(expr, "wrap") ? expr.wrap : wrap;
    this.currEval = Object.hasOwn(expr, "eval") ? expr.eval : this.currEval;
    callback = Object.hasOwn(expr, "callback") ? expr.callback : callback;
    this.currOtherTypeCallback = Object.hasOwn(expr, "otherTypeCallback") ? expr.otherTypeCallback : this.currOtherTypeCallback;
    currParent = Object.hasOwn(expr, "parent") ? expr.parent : currParent;
    currParentProperty = Object.hasOwn(expr, "parentProperty") ? expr.parentProperty : currParentProperty;
    expr = expr.path;
  }
  currParent = currParent || null;
  currParentProperty = currParentProperty || null;
  if (Array.isArray(expr)) {
    expr = JSONPath.toPathString(expr);
  }
  if (!expr && expr !== "" || !json) {
    return void 0;
  }
  const exprList = JSONPath.toPathArray(expr);
  if (exprList[0] === "$" && exprList.length > 1) {
    exprList.shift();
  }
  this._hasParentSelector = null;
  const result = this._trace(exprList, json, ["$"], currParent, currParentProperty, callback).filter(function(ea) {
    return ea && !ea.isParentSelector;
  });
  if (!result.length) {
    return wrap ? [] : void 0;
  }
  if (!wrap && result.length === 1 && !result[0].hasArrExpr) {
    return this._getPreferredOutput(result[0]);
  }
  return result.reduce((rslt, ea) => {
    const valOrPath = this._getPreferredOutput(ea);
    if (flatten && Array.isArray(valOrPath)) {
      rslt = rslt.concat(valOrPath);
    } else {
      rslt.push(valOrPath);
    }
    return rslt;
  }, []);
};
JSONPath.prototype._getPreferredOutput = function(ea) {
  const resultType = this.currResultType;
  switch (resultType) {
    case "all": {
      const path = Array.isArray(ea.path) ? ea.path : JSONPath.toPathArray(ea.path);
      ea.pointer = JSONPath.toPointer(path);
      ea.path = typeof ea.path === "string" ? ea.path : JSONPath.toPathString(ea.path);
      return ea;
    }
    case "value":
    case "parent":
    case "parentProperty":
      return ea[resultType];
    case "path":
      return JSONPath.toPathString(ea[resultType]);
    case "pointer":
      return JSONPath.toPointer(ea.path);
    default:
      throw new TypeError("Unknown result type");
  }
};
JSONPath.prototype._handleCallback = function(fullRetObj, callback, type) {
  if (callback) {
    const preferredOutput = this._getPreferredOutput(fullRetObj);
    fullRetObj.path = typeof fullRetObj.path === "string" ? fullRetObj.path : JSONPath.toPathString(fullRetObj.path);
    callback(preferredOutput, type, fullRetObj);
  }
};
JSONPath.prototype._trace = function(expr, val, path, parent, parentPropName, callback, hasArrExpr, literalPriority) {
  let retObj;
  if (!expr.length) {
    retObj = {
      path,
      value: val,
      parent,
      parentProperty: parentPropName,
      hasArrExpr
    };
    this._handleCallback(retObj, callback, "value");
    return retObj;
  }
  const loc = expr[0], x = expr.slice(1);
  const ret = [];
  function addRet(elems) {
    if (Array.isArray(elems)) {
      elems.forEach((t) => {
        ret.push(t);
      });
    } else {
      ret.push(elems);
    }
  }
  if ((typeof loc !== "string" || literalPriority) && val && Object.hasOwn(val, loc)) {
    addRet(this._trace(x, val[loc], push(path, loc), val, loc, callback, hasArrExpr));
  } else if (loc === "*") {
    this._walk(val, (m) => {
      addRet(this._trace(x, val[m], push(path, m), val, m, callback, true, true));
    });
  } else if (loc === "..") {
    addRet(this._trace(x, val, path, parent, parentPropName, callback, hasArrExpr));
    this._walk(val, (m) => {
      if (typeof val[m] === "object") {
        addRet(this._trace(expr.slice(), val[m], push(path, m), val, m, callback, true));
      }
    });
  } else if (loc === "^") {
    this._hasParentSelector = true;
    return {
      path: path.slice(0, -1),
      expr: x,
      isParentSelector: true
    };
  } else if (loc === "~") {
    retObj = {
      path: push(path, loc),
      value: parentPropName,
      parent,
      parentProperty: null
    };
    this._handleCallback(retObj, callback, "property");
    return retObj;
  } else if (loc === "$") {
    addRet(this._trace(x, val, path, null, null, callback, hasArrExpr));
  } else if (/^(-?\d*):(-?\d*):?(\d*)$/u.test(loc)) {
    addRet(this._slice(loc, x, val, path, parent, parentPropName, callback));
  } else if (loc.indexOf("?(") === 0) {
    if (this.currEval === false) {
      throw new Error("Eval [?(expr)] prevented in JSONPath expression.");
    }
    const safeLoc = loc.replace(/^\?\((.*?)\)$/u, "$1");
    const nested = /@.?([^?]*)[['](\??\(.*?\))(?!.\)\])[\]']/gu.exec(safeLoc);
    if (nested) {
      this._walk(val, (m) => {
        const npath = [nested[2]];
        const nvalue = nested[1] ? val[m][nested[1]] : val[m];
        const filterResults = this._trace(npath, nvalue, path, parent, parentPropName, callback, true);
        if (filterResults.length > 0) {
          addRet(this._trace(x, val[m], push(path, m), val, m, callback, true));
        }
      });
    } else {
      this._walk(val, (m) => {
        if (this._eval(safeLoc, val[m], m, path, parent, parentPropName)) {
          addRet(this._trace(x, val[m], push(path, m), val, m, callback, true));
        }
      });
    }
  } else if (loc[0] === "(") {
    if (this.currEval === false) {
      throw new Error("Eval [(expr)] prevented in JSONPath expression.");
    }
    addRet(this._trace(unshift(this._eval(loc, val, path.at(-1), path.slice(0, -1), parent, parentPropName), x), val, path, parent, parentPropName, callback, hasArrExpr));
  } else if (loc[0] === "@") {
    let addType = false;
    const valueType = loc.slice(1, -2);
    switch (valueType) {
      case "scalar":
        if (!val || !["object", "function"].includes(typeof val)) {
          addType = true;
        }
        break;
      case "boolean":
      case "string":
      case "undefined":
      case "function":
        if (typeof val === valueType) {
          addType = true;
        }
        break;
      case "integer":
        if (Number.isFinite(val) && !(val % 1)) {
          addType = true;
        }
        break;
      case "number":
        if (Number.isFinite(val)) {
          addType = true;
        }
        break;
      case "nonFinite":
        if (typeof val === "number" && !Number.isFinite(val)) {
          addType = true;
        }
        break;
      case "object":
        if (val && typeof val === valueType) {
          addType = true;
        }
        break;
      case "array":
        if (Array.isArray(val)) {
          addType = true;
        }
        break;
      case "other":
        addType = this.currOtherTypeCallback(val, path, parent, parentPropName);
        break;
      case "null":
        if (val === null) {
          addType = true;
        }
        break;
      /* c8 ignore next 2 */
      default:
        throw new TypeError("Unknown value type " + valueType);
    }
    if (addType) {
      retObj = {
        path,
        value: val,
        parent,
        parentProperty: parentPropName
      };
      this._handleCallback(retObj, callback, "value");
      return retObj;
    }
  } else if (loc[0] === "`" && val && Object.hasOwn(val, loc.slice(1))) {
    const locProp = loc.slice(1);
    addRet(this._trace(x, val[locProp], push(path, locProp), val, locProp, callback, hasArrExpr, true));
  } else if (loc.includes(",")) {
    const parts = loc.split(",");
    for (const part of parts) {
      addRet(this._trace(unshift(part, x), val, path, parent, parentPropName, callback, true));
    }
  } else if (!literalPriority && val && Object.hasOwn(val, loc)) {
    addRet(this._trace(x, val[loc], push(path, loc), val, loc, callback, hasArrExpr, true));
  }
  if (this._hasParentSelector) {
    for (let t = 0; t < ret.length; t++) {
      const rett = ret[t];
      if (rett && rett.isParentSelector) {
        const tmp = this._trace(rett.expr, val, rett.path, parent, parentPropName, callback, hasArrExpr);
        if (Array.isArray(tmp)) {
          ret[t] = tmp[0];
          const tl = tmp.length;
          for (let tt = 1; tt < tl; tt++) {
            t++;
            ret.splice(t, 0, tmp[tt]);
          }
        } else {
          ret[t] = tmp;
        }
      }
    }
  }
  return ret;
};
JSONPath.prototype._walk = function(val, f) {
  if (Array.isArray(val)) {
    const n = val.length;
    for (let i = 0; i < n; i++) {
      f(i);
    }
  } else if (val && typeof val === "object") {
    Object.keys(val).forEach((m) => {
      f(m);
    });
  }
};
JSONPath.prototype._slice = function(loc, expr, val, path, parent, parentPropName, callback) {
  if (!Array.isArray(val)) {
    return void 0;
  }
  const len = val.length, parts = loc.split(":"), step = parts[2] && Number.parseInt(parts[2]) || 1;
  let start = parts[0] && Number.parseInt(parts[0]) || 0, end = parts[1] && Number.parseInt(parts[1]) || len;
  start = start < 0 ? Math.max(0, start + len) : Math.min(len, start);
  end = end < 0 ? Math.max(0, end + len) : Math.min(len, end);
  const ret = [];
  for (let i = start; i < end; i += step) {
    const tmp = this._trace(unshift(i, expr), val, path, parent, parentPropName, callback, true);
    tmp.forEach((t) => {
      ret.push(t);
    });
  }
  return ret;
};
JSONPath.prototype._eval = function(code, _v, _vname, path, parent, parentPropName) {
  this.currSandbox._$_parentProperty = parentPropName;
  this.currSandbox._$_parent = parent;
  this.currSandbox._$_property = _vname;
  this.currSandbox._$_root = this.json;
  this.currSandbox._$_v = _v;
  const containsPath = code.includes("@path");
  if (containsPath) {
    this.currSandbox._$_path = JSONPath.toPathString(path.concat([_vname]));
  }
  const scriptCacheKey = this.currEval + "Script:" + code;
  if (!JSONPath.cache[scriptCacheKey]) {
    let script = code.replaceAll("@parentProperty", "_$_parentProperty").replaceAll("@parent", "_$_parent").replaceAll("@property", "_$_property").replaceAll("@root", "_$_root").replaceAll(/@([.\s)[])/gu, "_$_v$1");
    if (containsPath) {
      script = script.replaceAll("@path", "_$_path");
    }
    if (this.currEval === "safe" || this.currEval === true || this.currEval === void 0) {
      JSONPath.cache[scriptCacheKey] = new this.safeVm.Script(script);
    } else if (this.currEval === "native") {
      JSONPath.cache[scriptCacheKey] = new this.vm.Script(script);
    } else if (typeof this.currEval === "function" && this.currEval.prototype && Object.hasOwn(this.currEval.prototype, "runInNewContext")) {
      const CurrEval = this.currEval;
      JSONPath.cache[scriptCacheKey] = new CurrEval(script);
    } else if (typeof this.currEval === "function") {
      JSONPath.cache[scriptCacheKey] = {
        runInNewContext: (context) => this.currEval(script, context)
      };
    } else {
      throw new TypeError(`Unknown "eval" property "${this.currEval}"`);
    }
  }
  try {
    return JSONPath.cache[scriptCacheKey].runInNewContext(this.currSandbox);
  } catch (e) {
    if (this.ignoreEvalErrors) {
      return false;
    }
    throw new Error("jsonPath: " + e.message + ": " + code);
  }
};
JSONPath.cache = {};
JSONPath.toPathString = function(pathArr) {
  const x = pathArr, n = x.length;
  let p = "$";
  for (let i = 1; i < n; i++) {
    if (!/^(~|\^|@.*?\(\))$/u.test(x[i])) {
      p += /^[0-9*]+$/u.test(x[i]) ? "[" + x[i] + "]" : "['" + x[i] + "']";
    }
  }
  return p;
};
JSONPath.toPointer = function(pointer) {
  const x = pointer, n = x.length;
  let p = "";
  for (let i = 1; i < n; i++) {
    if (!/^(~|\^|@.*?\(\))$/u.test(x[i])) {
      p += "/" + x[i].toString().replaceAll("~", "~0").replaceAll("/", "~1");
    }
  }
  return p;
};
JSONPath.toPathArray = function(expr) {
  const {
    cache
  } = JSONPath;
  if (cache[expr]) {
    return cache[expr].concat();
  }
  const subx = [];
  const normalized = expr.replaceAll(/@(?:null|boolean|number|string|integer|undefined|nonFinite|scalar|array|object|function|other)\(\)/gu, ";$&;").replaceAll(/[['](\??\(.*?\))[\]'](?!.\])/gu, function($0, $1) {
    return "[#" + (subx.push($1) - 1) + "]";
  }).replaceAll(/\[['"]([^'\]]*)['"]\]/gu, function($0, prop) {
    return "['" + prop.replaceAll(".", "%@%").replaceAll("~", "%%@@%%") + "']";
  }).replaceAll("~", ";~;").replaceAll(/['"]?\.['"]?(?![^[]*\])|\[['"]?/gu, ";").replaceAll("%@%", ".").replaceAll("%%@@%%", "~").replaceAll(/(?:;)?(\^+)(?:;)?/gu, function($0, ups) {
    return ";" + ups.split("").join(";") + ";";
  }).replaceAll(/;;;|;;/gu, ";..;").replaceAll(/;$|'?\]|'$/gu, "");
  const exprList = normalized.split(";").map(function(exp) {
    const match = exp.match(/#(\d+)/u);
    return !match || !match[1] ? exp : subx[match[1]];
  });
  cache[expr] = exprList;
  return cache[expr].concat();
};
JSONPath.prototype.safeVm = {
  Script: SafeScript
};
JSONPath.prototype.vm = vm;

// packages/verify/src/binding/jsonpath-resolver.ts
function resolveJsonPath(document, jsonPath, index2) {
  try {
    if (!document || typeof document !== "object") {
      return {
        success: false,
        value: null,
        path: jsonPath,
        matchCount: 0,
        error: "Invalid document: expected object",
        valueType: "null"
      };
    }
    if (!jsonPath || typeof jsonPath !== "string") {
      return {
        success: false,
        value: null,
        path: jsonPath,
        matchCount: 0,
        error: "Invalid JSONPath: expected non-empty string",
        valueType: "null"
      };
    }
    const normalizedPath = jsonPath.startsWith("$") ? jsonPath : `$.${jsonPath}`;
    const results = JSONPath({
      path: normalizedPath,
      json: document,
      wrap: true
      // Always return array
    });
    if (!results || results.length === 0) {
      return {
        success: false,
        value: null,
        path: jsonPath,
        matchCount: 0,
        error: `No matches found for path: ${jsonPath}`,
        valueType: "null"
      };
    }
    if (index2 !== void 0) {
      if (index2 >= 0 && index2 < results.length) {
        const value2 = results[index2];
        return {
          success: true,
          value: value2,
          path: jsonPath,
          matchCount: 1,
          valueType: getValueType(value2)
        };
      } else {
        return {
          success: false,
          value: null,
          path: jsonPath,
          matchCount: results.length,
          error: `Index ${index2} out of bounds (found ${results.length} matches)`,
          valueType: "null"
        };
      }
    }
    const value = results.length === 1 ? results[0] : results;
    return {
      success: true,
      value,
      path: jsonPath,
      matchCount: results.length,
      valueType: getValueType(value)
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      value: null,
      path: jsonPath,
      matchCount: 0,
      error: `JSONPath error: ${errorMessage}`,
      valueType: "null"
    };
  }
}
function getValueType(value) {
  if (value === null) return "null";
  if (value === void 0) return "undefined";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (typeof value === "object") return "object";
  return "undefined";
}

// packages/verify/src/binding/ontological-bridge.ts
var getFlightRecorder = () => null;
var bridgeLog = () => {
};
function setBridgeLogger(logger) {
  bridgeLog = logger ?? (() => {
  });
}
var FIELD_ALIASES = {
  // Rate variations
  rate: ["unit_price", "price", "hourly_rate", "rate_per_unit", "price_per_unit", "unit_rate", "cost", "charge"],
  unit_price: ["rate", "price", "hourly_rate", "cost", "charge"],
  // Quantity variations
  quantity: ["qty", "units", "hours", "count", "num", "amount"],
  hours: ["quantity", "qty", "units", "total_hours", "worked_hours"],
  // Amount variations
  amount: ["total", "sum", "value", "price", "cost", "charge", "billed_amount", "line_total"],
  total: ["amount", "sum", "grand_total", "subtotal", "total_amount"],
  // Date variations
  date: ["service_date", "event_date", "transaction_date", "work_date", "effective_date"],
  effective_date: ["start_date", "begin_date", "commencement_date"],
  end_date: ["expiration_date", "termination_date", "expiry_date", "contract_end"],
  // Reference variations
  document_number: ["invoice_number", "reference", "ref", "po_number", "order_number", "ticket_number"]
};
function getFieldAliases(fieldName) {
  const normalized = fieldName.toLowerCase().replace(/-/g, "_");
  const aliases = /* @__PURE__ */ new Set([normalized]);
  if (FIELD_ALIASES[normalized]) {
    for (const alias of FIELD_ALIASES[normalized]) {
      aliases.add(alias);
    }
  }
  for (const [canonical, aliasList] of Object.entries(FIELD_ALIASES)) {
    if (aliasList.includes(normalized)) {
      aliases.add(canonical);
      for (const alias of aliasList) {
        aliases.add(alias);
      }
    }
  }
  return Array.from(aliases);
}
var DOMAIN_ONTOLOGIES = {};
var OntologicalBridge = class _OntologicalBridge {
  ontologies = /* @__PURE__ */ new Map();
  // role → kind for the ontology currently being bound (set in createBindings). Lets a ruleset declare how its
  // roles normalize instead of extending the hard-coded lists below.
  roleKinds = {};
  // one representative built-in role per kind; kind-declared roles delegate to it.
  static KIND_REPRESENTATIVE = {
    amount: "CLAIMED_AMOUNT",
    rate: "TAX_RATE",
    quantity: "CLAIMED_QUANTITY",
    date: "EVENT_DATE",
    reference: "DOCUMENT_ID",
    string: "INVOICE_DESCRIPTION",
    array: "PRIOR_CLAIM_IDS"
  };
  extractionCache = /* @__PURE__ */ new WeakMap();
  flightRecorder = null;
  currentDocumentId;
  currentDomain;
  currentDocumentType;
  constructor() {
    for (const [key, ontology] of Object.entries(DOMAIN_ONTOLOGIES)) {
      this.ontologies.set(key, ontology);
    }
    try {
      this.flightRecorder = getFlightRecorder();
    } catch {
    }
  }
  /**
   * Enable flight recording for current extraction context
   */
  setExtractionContext(documentId, domain, documentType) {
    this.currentDocumentId = documentId;
    this.currentDomain = domain;
    this.currentDocumentType = documentType;
  }
  /**
   * Register a custom domain ontology
   */
  registerOntology(ontology) {
    this.ontologies.set(ontology.domainId, ontology);
  }
  /**
   * Get ontology for a domain
   */
  getOntology(domainId) {
    return this.ontologies.get(domainId);
  }
  /**
   * Extract a value from a document using a field path with fuzzy fallbacks.
   * Supports dot notation and array wildcards (e.g., "line_items[*].rate")
   *
   * ENHANCED: Tries JSONPath first (for paths starting with $), then exact paths,
   * and finally fuzzy field name matching.
   */
  extractValue(document, fieldPath, arrayIndex, enableFuzzy = true) {
    if (fieldPath.startsWith("$")) {
      const jsonPathResult = resolveJsonPath(document, fieldPath, arrayIndex);
      if (jsonPathResult.success && jsonPathResult.value !== null && jsonPathResult.value !== void 0) {
        return jsonPathResult.value;
      }
      const legacyPath = fieldPath.replace(/^\$\.?/, "");
      if (legacyPath) {
        const legacyResult = this.extractExact(document, legacyPath, arrayIndex);
        if (legacyResult !== null && legacyResult !== void 0) {
          return legacyResult;
        }
      }
    }
    const exactResult = this.extractExact(document, fieldPath, arrayIndex);
    if (exactResult !== null && exactResult !== void 0) {
      return exactResult;
    }
    if (enableFuzzy) {
      return this.extractFuzzy(document, fieldPath, arrayIndex);
    }
    return null;
  }
  /**
   * Extract using exact path matching
   */
  extractExact(document, fieldPath, arrayIndex) {
    const parts = fieldPath.split(".");
    let current = document;
    for (const part of parts) {
      if (current === null || current === void 0) {
        return null;
      }
      const arrayMatch = part.match(/^(.+)\[\*\]$/);
      if (arrayMatch) {
        const arrayField = arrayMatch[1];
        const arr = current[arrayField];
        if (!Array.isArray(arr)) {
          return null;
        }
        if (arrayIndex !== void 0) {
          current = arr[arrayIndex];
        } else {
          for (const item of arr) {
            if (item !== null && item !== void 0) {
              current = item;
              break;
            }
          }
          if (current === arr) {
            return arr;
          }
        }
      } else if (part.match(/^\d+$/)) {
        const idx = parseInt(part, 10);
        if (Array.isArray(current)) {
          current = current[idx];
        } else {
          return null;
        }
      } else {
        current = current[part];
      }
    }
    return current;
  }
  /**
   * Extract using fuzzy path resolution
   */
  extractFuzzy(document, fieldPath, arrayIndex) {
    const parts = fieldPath.split(".");
    if (parts.length === 0) return null;
    let lastPart = parts[parts.length - 1];
    const arrayWildcard = lastPart.match(/^(.+)\[\*\]$/);
    if (arrayWildcard) {
      lastPart = arrayWildcard[1];
    }
    const aliases = getFieldAliases(lastPart);
    for (const alias of aliases) {
      const result = this.deepSearch(document, alias, arrayIndex);
      if (result !== null && result !== void 0) {
        return result;
      }
    }
    if (parts.length >= 2 && parts[0].includes("[*]")) {
      const arrMatch = parts[0].match(/^(.+)\[\*\]$/);
      if (arrMatch) {
        const result = this.searchInArrays(document, arrMatch[1], lastPart, arrayIndex);
        if (result !== null && result !== void 0) {
          return result;
        }
      }
    }
    return null;
  }
  /**
   * Deep search for a field name in nested object
   */
  deepSearch(obj, fieldName, arrayIndex, maxDepth = 4) {
    if (maxDepth <= 0) return null;
    for (const key of Object.keys(obj)) {
      const normalizedKey = key.toLowerCase().replace(/-/g, "_");
      if (normalizedKey === fieldName.toLowerCase()) {
        const value = obj[key];
        if (Array.isArray(value) && arrayIndex !== void 0) {
          return value[arrayIndex];
        }
        return value;
      }
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") {
        if (Array.isArray(value)) {
          if (arrayIndex !== void 0 && value[arrayIndex]) {
            const item = value[arrayIndex];
            if (typeof item === "object" && item !== null) {
              const result = this.deepSearch(item, fieldName, void 0, maxDepth - 1);
              if (result !== null && result !== void 0) {
                return result;
              }
            }
          } else {
            for (const item of value) {
              if (typeof item === "object" && item !== null) {
                const result = this.deepSearch(item, fieldName, void 0, maxDepth - 1);
                if (result !== null && result !== void 0) {
                  return result;
                }
              }
            }
          }
        } else {
          const result = this.deepSearch(value, fieldName, arrayIndex, maxDepth - 1);
          if (result !== null && result !== void 0) {
            return result;
          }
        }
      }
    }
    return null;
  }
  /**
   * Search in arrays for a specific field
   */
  searchInArrays(obj, arrayName, fieldName, arrayIndex) {
    const aliases = getFieldAliases(arrayName);
    let arr = null;
    for (const alias of aliases) {
      for (const key of Object.keys(obj)) {
        const normalizedKey = key.toLowerCase().replace(/-/g, "_");
        if (normalizedKey === alias.toLowerCase() && Array.isArray(obj[key])) {
          arr = obj[key];
          break;
        }
      }
      if (arr) break;
    }
    if (!arr) return null;
    const targetIndex = arrayIndex ?? 0;
    const item = arr[targetIndex];
    if (item && typeof item === "object") {
      const fieldAliases = getFieldAliases(fieldName);
      for (const alias of fieldAliases) {
        for (const key of Object.keys(item)) {
          const normalizedKey = key.toLowerCase().replace(/-/g, "_");
          if (normalizedKey === alias.toLowerCase()) {
            return item[key];
          }
        }
      }
    }
    return null;
  }
  /**
   * Create bindings from extracted document data.
   * This is the core "data binding" step that feeds the axiom gavel.
   *
   * ENHANCED v4.5: Uses LLM correlation map when available, falls back to code correlation.
   * LLM provides semantic understanding; code provides mathematical verification.
   */
  createBindings(domainId, invoice, contract, evidence, lineItemIndex, llmCorrelationMap) {
    const ontology = this.ontologies.get(domainId);
    this.roleKinds = ontology?.roleKinds ?? {};
    const invoiceId = invoice.document_number || invoice.id || "unknown";
    this.setExtractionContext(invoiceId, domainId, "invoice");
    if (!ontology) {
      bridgeLog(`[OntologicalBridge] No ontology for domain: ${domainId}`);
      return {
        bindings: {},
        invoiceId,
        lineItemIndex
      };
    }
    const bindings = {};
    const sortedMappings = [...ontology.mappings].sort((a, b) => b.priority - a.priority);
    for (const mapping of sortedMappings.filter((m) => m.documentType === "invoice" || m.documentType === "any")) {
      if (bindings[mapping.role]) continue;
      if (mapping.role === "EVENT_DATE") {
        const dateValue = this.extractDateValue(invoice);
        if (dateValue) {
          const normResult = this.normalizeValueForRole(dateValue, mapping.role);
          bindings[mapping.role] = {
            value: normResult.normalized,
            source: "invoice",
            field: "dates[service_date]",
            confidence: 100,
            // Deterministic extraction
            originalValue: dateValue,
            normalizedValue: typeof normResult.normalized === "object" ? String(normResult.normalized) : normResult.normalized,
            normalizations: normResult.meta?.transformations
          };
          bridgeLog(`[OntologicalBridge] EVENT_DATE BIND (smart): ${String(dateValue).slice(0, 50)} (service_date preferred, 100%)`);
          continue;
        }
      }
      const match = this.extractWithFallbacks(invoice, mapping, lineItemIndex);
      if (match !== null) {
        const normResult = this.normalizeValueForRole(match.value, mapping.role);
        bindings[mapping.role] = {
          value: normResult.normalized,
          source: "invoice",
          field: match.matchPath,
          confidence: match.confidence,
          // v4.5: Normalization provenance
          originalValue: normResult.meta?.original ?? match.value,
          normalizedValue: typeof normResult.normalized === "object" ? String(normResult.normalized) : normResult.normalized,
          normalizations: normResult.meta?.transformations
        };
        if (match.matchType === "fuzzy" || match.matchType === "deep_search") {
          bridgeLog(`[OntologicalBridge] FUZZY BIND: ${mapping.role} = ${String(match.value).slice(0, 50)} (${match.matchPath}, ${match.confidence}%)`);
        }
      }
    }
    this.setExtractionContext(invoiceId, domainId, "contract");
    const contractRules = this.extractContractRulesForCorrelation(contract);
    const llmMapping = llmCorrelationMap?.lineItemMappings?.find(
      (m) => m.invoiceLineIndex === lineItemIndex
    );
    const llmContractMatch = llmMapping?.matchedContractRule;
    let contractCorrelation;
    if (llmContractMatch && llmContractMatch.confidence === "HIGH" && llmContractMatch.ruleIndex !== void 0 && llmContractMatch.ruleIndex >= 0) {
      bridgeLog(`[OntologicalBridge] LLM CONTRACT CORRELATION: ${llmContractMatch.ruleName || "unnamed"} (${llmContractMatch.confidence})`);
      bridgeLog(`[OntologicalBridge]   Reasoning: ${llmContractMatch.reasoning}`);
      contractCorrelation = {
        score: 90,
        // LLM HIGH = 90%
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 90 },
        matchedIndex: llmContractMatch.ruleIndex,
        explanation: `LLM match: ${llmContractMatch.reasoning}`,
        isReliable: true
      };
    } else if (llmContractMatch && llmContractMatch.confidence === "MEDIUM" && llmContractMatch.ruleIndex !== void 0 && llmContractMatch.ruleIndex >= 0) {
      bridgeLog(`[OntologicalBridge] LLM CONTRACT CORRELATION (MEDIUM): ${llmContractMatch.ruleName || "unnamed"}`);
      contractCorrelation = {
        score: 65,
        // LLM MEDIUM = 65%
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 65 },
        matchedIndex: llmContractMatch.ruleIndex,
        explanation: `LLM match (medium): ${llmContractMatch.reasoning}`,
        isReliable: true
      };
    } else if (llmCorrelationMap && llmCorrelationMap.lineItemMappings.length > 0 && contractRules.length > 0) {
      bridgeLog(`[OntologicalBridge] WARNING: MAPPING_FAILURE - LLM couldn't map line item ${lineItemIndex} to contract rule`);
      bridgeLog(`[OntologicalBridge]   LLM tried but confidence was LOW or no match found`);
      contractCorrelation = {
        score: 0,
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
        matchedIndex: -1,
        explanation: "MAPPING_FAILURE: LLM could not semantically match this line item to a contract rule",
        isReliable: false
      };
    } else if ((!llmCorrelationMap || llmCorrelationMap.lineItemMappings.length === 0) && contractRules.length > 0) {
      const lineItems = invoice.line_items || [];
      const currentLineItem = lineItemIndex !== void 0 ? lineItems[lineItemIndex] || {} : {};
      const lineItemDescription = String(currentLineItem.description ?? "");
      const keywordMatch = this.findContractRuleByKeywords(lineItemDescription, contractRules);
      if (keywordMatch.matchedIndex >= 0) {
        bridgeLog(`[OntologicalBridge] v5.19 KEYWORD MATCH: Line "${lineItemDescription.slice(0, 40)}" \u2192 Rule "${keywordMatch.ruleName}" (${keywordMatch.score}% confidence)`);
        contractCorrelation = {
          score: keywordMatch.score,
          factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: keywordMatch.score },
          matchedIndex: keywordMatch.matchedIndex,
          explanation: `v5.19 keyword match: ${keywordMatch.explanation}`,
          isReliable: keywordMatch.score >= 70
          // Treat 70%+ keyword matches as reliable
        };
      } else {
        bridgeLog(`[OntologicalBridge] v5.19: No keyword match found for "${lineItemDescription.slice(0, 40)}" in ${contractRules.length} rules`);
        contractCorrelation = {
          score: 0,
          factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
          matchedIndex: -1,
          explanation: "v5.19: No keyword match - line item does not match any contract rule category",
          isReliable: false
        };
      }
    } else {
      contractCorrelation = {
        score: 0,
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
        matchedIndex: -1,
        explanation: "No contract rules to correlate",
        isReliable: false
      };
    }
    const hasMultipleRules = contractRules.length > 1;
    for (const mapping of sortedMappings.filter((m) => m.documentType === "contract" || m.documentType === "any")) {
      if (bindings[mapping.role]) continue;
      const isArrayBasedField = mapping.fieldPath.includes("[*]");
      if (isArrayBasedField && hasMultipleRules && !contractCorrelation.isReliable) {
        bridgeLog(`[OntologicalBridge] SKIPPING ${mapping.role} - multiple contract rules require reliable correlation`);
        continue;
      }
      let ruleIndex;
      if (contractCorrelation.isReliable) {
        ruleIndex = contractCorrelation.matchedIndex;
      } else if (!hasMultipleRules && contractRules.length === 1) {
        ruleIndex = 0;
      }
      const match = this.extractWithFallbacks(contract, mapping, ruleIndex);
      if (match !== null) {
        let adjustedConfidence;
        const isDeterministic = match.matchType === "exact" || match.matchType === "alternative";
        if (isDeterministic) {
          adjustedConfidence = match.confidence;
        } else {
          const correlationFactor = contractCorrelation.score / 100;
          adjustedConfidence = Math.round(match.confidence * correlationFactor);
        }
        const normResult = this.normalizeValueForRole(match.value, mapping.role);
        bindings[mapping.role] = {
          value: normResult.normalized,
          source: "contract",
          field: match.matchPath,
          confidence: adjustedConfidence,
          // v4.5: Normalization provenance
          originalValue: normResult.meta?.original ?? match.value,
          normalizedValue: typeof normResult.normalized === "object" ? String(normResult.normalized) : normResult.normalized,
          normalizations: normResult.meta?.transformations
        };
        if (match.matchType === "fuzzy" || match.matchType === "deep_search") {
          bridgeLog(`[OntologicalBridge] CONTRACT BIND (${match.matchType}): ${mapping.role} = ${String(match.value).slice(0, 50)} (${match.matchPath}, ${adjustedConfidence}% adjusted)`);
        } else {
          bridgeLog(`[OntologicalBridge] CONTRACT BIND (${match.matchType}): ${mapping.role} = ${String(match.value).slice(0, 50)} (${match.matchPath}, ${adjustedConfidence}%)`);
        }
      }
    }
    this.setExtractionContext(invoiceId, domainId, "evidence");
    const evidenceItems = this.extractEvidenceForCorrelation(evidence);
    const llmEvidenceMatches = llmMapping?.matchedEvidence?.filter(
      (m) => m.evidenceDocIndex !== void 0 && m.evidenceDocIndex >= 0 && m.confidence !== "LOW"
    ) || [];
    let evidenceCorrelation;
    if (llmEvidenceMatches.length > 0 && llmEvidenceMatches[0].confidence === "HIGH") {
      const bestMatch = llmEvidenceMatches[0];
      bridgeLog(`[OntologicalBridge] LLM EVIDENCE CORRELATION: doc[${bestMatch.evidenceDocIndex}] ticket:${bestMatch.ticketNumber || "none"} (${bestMatch.confidence})`);
      bridgeLog(`[OntologicalBridge]   Reasoning: ${bestMatch.reasoning}`);
      evidenceCorrelation = {
        score: 90,
        // LLM HIGH = 90%
        factors: { dateMatch: 45, referenceMatch: 45, descriptionMatch: 0 },
        matchedIndex: bestMatch.evidenceDocIndex,
        explanation: `LLM match: ${bestMatch.reasoning}`,
        isReliable: true
      };
    } else if (llmEvidenceMatches.length > 0 && llmEvidenceMatches[0].confidence === "MEDIUM") {
      const bestMatch = llmEvidenceMatches[0];
      bridgeLog(`[OntologicalBridge] LLM EVIDENCE CORRELATION (MEDIUM): doc[${bestMatch.evidenceDocIndex}]`);
      evidenceCorrelation = {
        score: 65,
        // LLM MEDIUM = 65%
        factors: { dateMatch: 32, referenceMatch: 33, descriptionMatch: 0 },
        matchedIndex: bestMatch.evidenceDocIndex,
        explanation: `LLM match (medium): ${bestMatch.reasoning}`,
        isReliable: true
      };
    } else if (llmCorrelationMap && evidenceItems.length > 0) {
      bridgeLog(`[OntologicalBridge] WARNING: MAPPING_FAILURE - LLM couldn't map line item ${lineItemIndex} to evidence`);
      bridgeLog(`[OntologicalBridge]   LLM tried but confidence was LOW or no match found`);
      evidenceCorrelation = {
        score: 0,
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
        matchedIndex: -1,
        explanation: "MAPPING_FAILURE: LLM could not semantically match this line item to evidence",
        isReliable: false
      };
    } else if (!llmCorrelationMap && evidenceItems.length > 0) {
      bridgeLog(`[OntologicalBridge] WARNING: MAPPING_FAILURE - No LLM correlation_map provided`);
      bridgeLog(`[OntologicalBridge]   ${evidenceItems.length} evidence items exist but cannot be semantically matched`);
      bridgeLog(`[OntologicalBridge]   JACCARD FALLBACK DISABLED - insufficient data for reliable matching`);
      evidenceCorrelation = {
        score: 0,
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
        matchedIndex: -1,
        explanation: "MAPPING_FAILURE: No LLM correlation_map - cannot semantically match to evidence",
        isReliable: false
      };
    } else {
      evidenceCorrelation = {
        score: 0,
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
        matchedIndex: -1,
        explanation: "No evidence items to correlate",
        isReliable: false
      };
    }
    for (const mapping of sortedMappings.filter((m) => m.documentType === "evidence")) {
      if (bindings[mapping.role]) continue;
      if (mapping.role === "ACTUAL_QUANTITY") {
        bridgeLog(`[OntologicalBridge] v5.5 CHECK ENTERED - invoice exists: ${!!invoice}`);
        const invoiceLineItems = invoice ? invoice.line_items : void 0;
        bridgeLog(`[OntologicalBridge] v5.5 line_items: ${invoiceLineItems ? `array of ${invoiceLineItems.length}` : "undefined"}`);
        if (invoiceLineItems && Array.isArray(invoiceLineItems) && invoiceLineItems.length > 1) {
          const descriptions = invoiceLineItems.map((item) => item.description || item.service || item.name).filter((d) => typeof d === "string" && d.length > 0).map((d) => d.toLowerCase());
          const hasTransport = descriptions.some((d) => /transport|haul|freight|delivery|drive/.test(d));
          const hasFuel = descriptions.some((d) => /fuel|gas|diesel/.test(d));
          const hasCrane = descriptions.some((d) => /crane|mobilization|rigging|lift/.test(d));
          const hasMileage = descriptions.some((d) => /mileage|mile|excess|distance/.test(d));
          const hasPerDiem = descriptions.some((d) => /per diem|lodging|overnight|hotel/.test(d));
          const hasOther = descriptions.some((d) => /surcharge|fee|charge|standby|wait/.test(d));
          const categoryCount = [hasTransport, hasFuel, hasCrane, hasMileage, hasPerDiem, hasOther].filter(Boolean).length;
          if (categoryCount >= 2) {
            bridgeLog(`[OntologicalBridge] v5.5 HETEROGENEOUS INVOICE DETECTED - ${categoryCount} distinct categories`);
            bridgeLog(`[OntologicalBridge]   Line items: ${descriptions.slice(0, 3).join(", ")}${descriptions.length > 3 ? "..." : ""}`);
            bridgeLog(`[OntologicalBridge]   SKIPPING global ACTUAL_QUANTITY binding - LLM will handle per-line-item`);
            continue;
          }
        }
      }
      if (evidenceCorrelation.isReliable && evidenceCorrelation.matchedIndex >= 0) {
        const correlatedEvidence = evidence[evidenceCorrelation.matchedIndex];
        const match = this.extractWithFallbacks(correlatedEvidence, mapping);
        if (match !== null) {
          let adjustedConfidence;
          const isDeterministic = match.matchType === "exact" || match.matchType === "alternative";
          if (isDeterministic) {
            adjustedConfidence = match.confidence;
          } else {
            const correlationFactor = evidenceCorrelation.score / 100;
            adjustedConfidence = Math.round(match.confidence * correlationFactor);
          }
          const normResult = this.normalizeValueForRole(match.value, mapping.role);
          bindings[mapping.role] = {
            value: normResult.normalized,
            source: "evidence",
            field: `evidence[${evidenceCorrelation.matchedIndex}].${match.matchPath}`,
            confidence: adjustedConfidence,
            // v4.5: Normalization provenance
            originalValue: normResult.meta?.original ?? match.value,
            normalizedValue: typeof normResult.normalized === "object" ? String(normResult.normalized) : normResult.normalized,
            normalizations: normResult.meta?.transformations
          };
          bridgeLog(`[OntologicalBridge] EVIDENCE BIND (${match.matchType}): ${mapping.role} = ${String(match.value).slice(0, 50)} (${adjustedConfidence}%)`);
        }
      } else {
        const isSingleEvidence = evidence.length === 1;
        const needsSemanticCheck = mapping.role === "ACTUAL_QUANTITY";
        const invoiceDesc = bindings.INVOICE_DESCRIPTION?.value;
        for (let evIdx = 0; evIdx < evidence.length; evIdx++) {
          const ev = evidence[evIdx];
          const match = this.extractWithFallbacks(ev, mapping);
          if (match !== null) {
            if (needsSemanticCheck && typeof invoiceDesc === "string") {
              const evLineItems = ev.line_items;
              let evidenceDescForQty;
              if (evLineItems && Array.isArray(evLineItems)) {
                for (const evItem of evLineItems) {
                  const evQty = evItem.quantity || evItem.hours || evItem.qty;
                  if (evQty === match.value) {
                    evidenceDescForQty = evItem.description || evItem.service || evItem.name;
                    break;
                  }
                }
              }
              if (!evidenceDescForQty) {
                evidenceDescForQty = ev.description;
              }
              if (evidenceDescForQty !== void 0 && typeof evidenceDescForQty !== "string") {
                evidenceDescForQty = String(evidenceDescForQty);
              }
              const similarity = this.computeDescriptionSimilarity(invoiceDesc, evidenceDescForQty);
              const SEMANTIC_THRESHOLD = 0.25;
              if (similarity < SEMANTIC_THRESHOLD) {
                bridgeLog(`[OntologicalBridge] SKIPPED ACTUAL_QUANTITY binding - descriptions don't match (${(similarity * 100).toFixed(0)}% < ${SEMANTIC_THRESHOLD * 100}%)`);
                bridgeLog(`[OntologicalBridge]   Invoice: "${typeof invoiceDesc === "string" ? invoiceDesc.slice(0, 50) : "N/A"}"`);
                bridgeLog(`[OntologicalBridge]   Evidence: "${evidenceDescForQty?.slice(0, 50) || "N/A"}"`);
                continue;
              }
            }
            let adjustedConfidence;
            const isDeterministicPath = match.matchType === "exact" || match.matchType === "alternative";
            if (isSingleEvidence && isDeterministicPath) {
              adjustedConfidence = match.confidence;
              bridgeLog(`[OntologicalBridge] EVIDENCE BIND (single-deterministic): ${mapping.role} = ${String(match.value).slice(0, 50)} (${adjustedConfidence}%)`);
            } else if (isSingleEvidence) {
              adjustedConfidence = Math.min(75, match.confidence);
              bridgeLog(`[OntologicalBridge] EVIDENCE BIND (single-fuzzy): ${mapping.role} = ${String(match.value).slice(0, 50)} (${adjustedConfidence}%)`);
            } else {
              adjustedConfidence = Math.min(50, Math.round(match.confidence * 0.5));
              bridgeLog(`[OntologicalBridge] EVIDENCE BIND (uncorrelated): ${mapping.role} = ${String(match.value).slice(0, 50)} (${adjustedConfidence}% - LOW CONFIDENCE)`);
            }
            const normResult = this.normalizeValueForRole(match.value, mapping.role);
            bindings[mapping.role] = {
              value: normResult.normalized,
              source: "evidence",
              field: `evidence[${evIdx}].${match.matchPath}`,
              confidence: adjustedConfidence,
              // v4.5: Normalization provenance
              originalValue: normResult.meta?.original ?? match.value,
              normalizedValue: typeof normResult.normalized === "object" ? String(normResult.normalized) : normResult.normalized,
              normalizations: normResult.meta?.transformations
            };
            break;
          }
        }
      }
    }
    if (bindings.VERIFIED_AMOUNT && bindings.CLAIMED_AMOUNT) {
      const verified = bindings.VERIFIED_AMOUNT.value;
      const claimed = bindings.CLAIMED_AMOUNT.value;
      if (typeof verified === "number" && typeof claimed === "number" && claimed > 0) {
        const ratio = verified / claimed;
        if (ratio < 0.05 && verified < 100) {
          bridgeLog(`[OntologicalBridge] v5.11 FIX: Rejecting VERIFIED_AMOUNT=${verified} - implausibly small vs CLAIMED_AMOUNT=${claimed} (ratio: ${(ratio * 100).toFixed(1)}%)`);
          bridgeLog(`[OntologicalBridge]   This is likely hours (${verified}) misread as dollars from ticket totals.total`);
          delete bindings.VERIFIED_AMOUNT;
        }
      }
    }
    this.computeDerivedBindings(bindings);
    let itemDescription;
    if (lineItemIndex !== void 0) {
      const lineItems = invoice.line_items;
      if (lineItems && lineItems[lineItemIndex]) {
        itemDescription = lineItems[lineItemIndex].description;
      }
    }
    return {
      bindings,
      invoiceId: invoice.document_number || invoice.id || "unknown",
      lineItemIndex,
      itemDescription,
      // Include correlation info for provenance
      correlationInfo: {
        evidence: evidenceCorrelation,
        contract: contractCorrelation
      }
    };
  }
  /**
   * Extract line item data for correlation matching
   */
  extractLineItemForCorrelation(invoice, lineItemIndex) {
    const lineItems = invoice.line_items;
    if (!lineItems || lineItemIndex === void 0 || !lineItems[lineItemIndex]) {
      return {
        description: invoice.description,
        date: this.extractDateValue(invoice),
        referenceIds: this.extractReferenceIds(invoice)
      };
    }
    const item = lineItems[lineItemIndex];
    return {
      description: item.description || item.service || item.name,
      date: this.extractDateValue(item) || this.extractDateValue(invoice),
      referenceIds: this.extractReferenceIds(invoice),
      quantity: item.quantity || item.hours || item.qty,
      rate: item.unit_price || item.rate || item.price,
      amount: item.amount || item.total
    };
  }
  /**
   * Extract contract rules for correlation matching
   */
  extractContractRulesForCorrelation(contract) {
    const rules = contract.financial_rules;
    if (!rules || !Array.isArray(rules)) return [];
    return rules.filter((r) => r !== null && typeof r === "object").map((rule) => ({
      ruleName: rule.rule_name || rule.name || rule.description,
      description: rule.description || rule.rule_name,
      rate: rule.values?.rate || rule.values?.hourly_rate || rule.rate,
      unit: rule.values?.unit || rule.unit
    }));
  }
  /**
   * Extract evidence items for correlation matching
   */
  extractEvidenceForCorrelation(evidence) {
    return evidence.map((ev) => ({
      description: ev.description || ev.service_description || ev.work_description,
      date: this.extractDateValue(ev),
      referenceIds: this.extractReferenceIds(ev),
      ticketNumber: ev.ticket_number || ev.document_number || ev.reference,
      quantity: ev.quantity || ev.totals?.total,
      hours: ev.totals?.hours || ev.totals?.total_hours || ev.hours
    }));
  }
  /**
   * Extract date value from document
   * v5.0: Implements MIN(service_date) logic for TIME_ORD accuracy
   */
  extractDateValue(doc2) {
    const dateFields = ["service_date", "work_date", "event_date", "date", "invoice_date", "ticket_date"];
    for (const field of dateFields) {
      const raw = doc2[field];
      if (typeof raw === "string" || typeof raw === "number") return String(raw);
    }
    const rawDates = doc2.dates;
    const dates = Array.isArray(rawDates) ? rawDates.filter((d) => d !== null && typeof d === "object") : void 0;
    if (dates && dates.length > 0) {
      const serviceDateTypes = ["service_date", "service", "work_date", "work", "event_date", "event"];
      const invoiceDateTypes = ["invoice_date", "invoice", "billing_date"];
      const serviceDates = dates.filter(
        (d) => d.type && serviceDateTypes.some((t) => d.type.toLowerCase().includes(t.toLowerCase()))
      );
      if (serviceDates.length > 0) {
        const dateValue = serviceDates[0].date || serviceDates[0].value;
        if (dateValue) return String(dateValue);
      }
      const nonInvoiceDates = dates.filter(
        (d) => !d.type || !invoiceDateTypes.some((t) => d.type.toLowerCase().includes(t.toLowerCase()))
      );
      if (nonInvoiceDates.length > 0) {
        const dateValue = nonInvoiceDates[0].date || nonInvoiceDates[0].value;
        if (dateValue) return String(dateValue);
      }
      const firstDateValue = dates[0]?.date || dates[0]?.value;
      if (firstDateValue) return String(firstDateValue);
    }
    return void 0;
  }
  /**
   * Extract reference IDs from document
   */
  extractReferenceIds(doc2) {
    const refs = [];
    const refFields = ["reference_ids", "po_number", "order_number", "ticket_number", "document_number"];
    for (const field of refFields) {
      const value = doc2[field];
      if (Array.isArray(value)) {
        refs.push(...value.map(String));
      } else if (value) {
        refs.push(String(value));
      }
    }
    return refs.filter((r) => r.length > 0);
  }
  /**
   * Validate that an extracted value matches the expected type for a role.
   * This prevents fuzzy matching from grabbing wrong fields.
   */
  validateValueType(value, role) {
    const declared = this.roleKinds[role];
    if (declared !== void 0) {
      const rep = _OntologicalBridge.KIND_REPRESENTATIVE[declared];
      if (rep !== role) return this.validateValueType(value, rep);
    }
    const numericRoles = [
      "RATE_APPLIED",
      "RATE_CONTRACTED",
      "CLAIMED_AMOUNT",
      "VERIFIED_AMOUNT",
      "CONTRACTED_LIMIT",
      "CLAIMED_QUANTITY",
      "ACTUAL_QUANTITY",
      "LINE_ITEM_TOTAL",
      "EXPECTED_TOTAL",
      // invoice document-level roles
      "SUBTOTAL",
      "TAX_AMOUNT",
      "TAX_RATE",
      "DISCOUNT_AMOUNT",
      "SERVICE_CHARGE",
      "GRAND_TOTAL",
      "LINE_ITEMS_SUM",
      "EXPECTED_GRAND_TOTAL",
      "EXPECTED_TAX_AMOUNT"
    ];
    const dateRoles = ["EVENT_DATE", "CONTRACT_START", "CONTRACT_END"];
    const arrayRoles = ["PRIOR_CLAIM_IDS"];
    const stringRoles = ["DOCUMENT_ID", "INVOICE_DESCRIPTION", "EVIDENCE_DESCRIPTION", "CURRENCY_CODE"];
    if (numericRoles.includes(role)) {
      if (typeof value === "number") return true;
      if (typeof value === "string") {
        const cleaned = value.replace(/[,$\s]/g, "");
        return !isNaN(parseFloat(cleaned)) && cleaned.match(/^-?\d*\.?\d+$/) !== null;
      }
      return false;
    }
    if (dateRoles.includes(role)) {
      if (value instanceof Date) return true;
      if (typeof value === "string") {
        const parsed = Date.parse(value);
        return !isNaN(parsed);
      }
      return false;
    }
    if (arrayRoles.includes(role)) {
      return Array.isArray(value);
    }
    if (stringRoles.includes(role)) {
      return typeof value === "string";
    }
    return true;
  }
  /**
   * v5.19: Deterministic keyword matching for contract rules
   *
   * When LLM correlation_map is unavailable (e.g., during code-only precompute),
   * this provides a reliable fallback by matching line item descriptions to
   * contract rule names using domain-specific keyword categories.
   *
   * Returns the best matching rule index and confidence score.
   */
  /**
   * v10.9.2: Enhanced keyword matching with expanded categories,
   * generic fallback, and correlation telemetry.
   */
  findContractRuleByKeywords(lineItemDescription, contractRules) {
    const desc = lineItemDescription.toLowerCase();
    const categories = [
      // === SPECIFIC CATEGORIES (check first) ===
      { name: "mileage", lineKeywords: ["mileage", "excess mile", "miles", "per mile"], ruleKeywords: ["mileage", "mile"], excludeRuleKeywords: ["crane"] },
      { name: "fuel", lineKeywords: ["fuel surcharge", "diesel surcharge", "fuel charge", "fsc"], ruleKeywords: ["fuel"], skipValidation: true },
      { name: "per_diem", lineKeywords: ["per diem", "per-diem", "overnight per diem", "overnight lodging", "lodging", "hotel", "motel"], ruleKeywords: ["per diem", "per-diem", "overnight", "lodging"] },
      { name: "standby", lineKeywords: ["standby", "wait time", "detention", "waiting", "delay"], ruleKeywords: ["standby", "detention", "wait"] },
      { name: "permit", lineKeywords: ["permit", "oversize", "overweight", "os/ow"], ruleKeywords: ["permit"] },
      { name: "crane", lineKeywords: ["crane", "rigging crew", "rigging", "lift"], ruleKeywords: ["crane", "rigging"] },
      { name: "pilot", lineKeywords: ["pilot car", "escort vehicle", "lead car", "chase car", "escort"], ruleKeywords: ["pilot", "escort"] },
      // === TRANSPORT/HAULING (common) ===
      { name: "heavy_haul", lineKeywords: ["heavy haul", "heavy-haul", "oversize load", "specialized transport"], ruleKeywords: ["heavy haul", "heavy-haul", "specialized"] },
      { name: "transport", lineKeywords: ["transport", "haul", "hauling", "trucking", "freight", "delivery", "shipping"], ruleKeywords: ["transport", "haul", "trucking", "freight", "delivery"] },
      // === WATER/FLUID SERVICES ===
      { name: "water", lineKeywords: ["water", "h2o", "hydro", "water haul", "water truck", "water service"], ruleKeywords: ["water", "h2o", "hydro"] },
      { name: "vacuum", lineKeywords: ["vacuum", "vac truck", "vac service", "vacuum truck"], ruleKeywords: ["vacuum", "vac"] },
      { name: "pump", lineKeywords: ["pump", "pumping", "pump truck", "pump service"], ruleKeywords: ["pump"] },
      // === LABOR/SERVICE (very common) ===
      { name: "labor", lineKeywords: ["labor", "labour", "manpower", "crew", "worker", "hand"], ruleKeywords: ["labor", "labour", "manpower", "crew", "hourly"] },
      { name: "service", lineKeywords: ["service", "services", "service call", "field service"], ruleKeywords: ["service", "hourly", "rate"] },
      { name: "hourly", lineKeywords: ["hourly", "per hour", "/hr", "/ hr", "hour rate"], ruleKeywords: ["hourly", "hour", "/hr"] },
      { name: "daily", lineKeywords: ["daily", "per day", "/day", "day rate"], ruleKeywords: ["daily", "day", "/day"] },
      // === EQUIPMENT ===
      { name: "equipment_rental", lineKeywords: ["equipment rental", "equipment rate", "equip rental"], ruleKeywords: ["equipment", "rental"] },
      { name: "rental", lineKeywords: ["rental", "rent", "lease"], ruleKeywords: ["rental", "rent", "lease"] },
      { name: "operator", lineKeywords: ["operator", "operated", "with operator"], ruleKeywords: ["operator", "operated"] },
      // === MISC CHARGES ===
      { name: "mobilization", lineKeywords: ["mobilization", "mob", "demob", "demobilization", "move-in", "move-out"], ruleKeywords: ["mobilization", "mob", "demob"] },
      { name: "minimum", lineKeywords: ["minimum", "min charge", "minimum charge", "min."], ruleKeywords: ["minimum", "min"] },
      { name: "overtime", lineKeywords: ["overtime", "ot", "over time", "after hours"], ruleKeywords: ["overtime", "ot", "after hours"] },
      { name: "weekend", lineKeywords: ["weekend", "saturday", "sunday", "sat/sun"], ruleKeywords: ["weekend", "saturday", "sunday"] },
      { name: "holiday", lineKeywords: ["holiday"], ruleKeywords: ["holiday"] },
      // === ADMIN/FEES ===
      { name: "admin", lineKeywords: ["admin", "administrative", "admin fee", "processing"], ruleKeywords: ["admin", "administrative", "processing"] },
      { name: "markup", lineKeywords: ["markup", "mark-up", "margin"], ruleKeywords: ["markup", "mark-up", "margin"] }
    ];
    let matchedCategory = null;
    for (const cat of categories) {
      if (cat.lineKeywords.some((kw) => desc.includes(kw))) {
        matchedCategory = cat;
        break;
      }
    }
    const logCorrelation = (result, details) => {
      bridgeLog(`[OntologicalBridge] CORRELATION ${result}: "${lineItemDescription.slice(0, 40)}" - ${details}`);
    };
    if (matchedCategory) {
      if (matchedCategory.skipValidation) {
        logCorrelation("SKIP", `${matchedCategory.name} requires external validation`);
        return {
          matchedIndex: -1,
          ruleName: "",
          score: 0,
          explanation: `Skipping ${matchedCategory.name} - index-based, requires external validation`
        };
      }
      let bestMatch = null;
      for (let i = 0; i < contractRules.length; i++) {
        const rule = contractRules[i];
        const ruleName = (rule.rule_name || rule.description || "").toLowerCase();
        const ruleDesc = (rule.description || "").toLowerCase();
        const ruleText = ruleName + " " + ruleDesc;
        if (matchedCategory.excludeRuleKeywords?.some((kw) => ruleText.includes(kw))) {
          continue;
        }
        const matchCount = matchedCategory.ruleKeywords.filter((kw) => ruleText.includes(kw)).length;
        if (matchCount > 0) {
          const score2 = Math.min(90, 60 + matchCount * 15);
          if (!bestMatch || score2 > bestMatch.score) {
            bestMatch = { index: i, score: score2, rule };
          }
        }
      }
      if (bestMatch) {
        const ruleName = bestMatch.rule.rule_name || bestMatch.rule.description || "unnamed";
        logCorrelation("CATEGORY", `${matchedCategory.name} \u2192 "${ruleName}" (${bestMatch.score}%)`);
        return {
          matchedIndex: bestMatch.index,
          ruleName,
          score: bestMatch.score,
          explanation: `Category "${matchedCategory.name}" matched rule "${ruleName}" with ${bestMatch.score}% confidence`
        };
      }
      logCorrelation("CATEGORY_NO_RULE", `${matchedCategory.name} category but no matching rule in ${contractRules.length} rules`);
    }
    const lineWords = desc.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2).filter((w) => !["the", "and", "for", "per", "with", "from", "this", "that"].includes(w));
    if (lineWords.length === 0) {
      logCorrelation("FAIL", "No meaningful words in line item description");
      return {
        matchedIndex: -1,
        ruleName: "",
        score: 0,
        explanation: `No meaningful words in "${lineItemDescription.slice(0, 50)}"`
      };
    }
    let bestGenericMatch = null;
    for (let i = 0; i < contractRules.length; i++) {
      const rule = contractRules[i];
      const ruleName = (rule.rule_name || rule.description || "").toLowerCase();
      const ruleDesc = (rule.description || "").toLowerCase();
      const ruleText = ruleName + " " + ruleDesc;
      const matchedWords = lineWords.filter((word) => ruleText.includes(word));
      if (matchedWords.length > 0) {
        const overlapRatio = matchedWords.length / lineWords.length;
        const score2 = Math.min(75, Math.round(40 + overlapRatio * 35));
        if (!bestGenericMatch || matchedWords.length > bestGenericMatch.matchedWords.length || matchedWords.length === bestGenericMatch.matchedWords.length && score2 > bestGenericMatch.score) {
          bestGenericMatch = { index: i, score: score2, rule, matchedWords };
        }
      }
    }
    if (bestGenericMatch && bestGenericMatch.matchedWords.length >= 1) {
      const ruleName = bestGenericMatch.rule.rule_name || bestGenericMatch.rule.description || "unnamed";
      const wordsStr = bestGenericMatch.matchedWords.slice(0, 3).join(", ");
      logCorrelation("GENERIC", `words [${wordsStr}] \u2192 "${ruleName}" (${bestGenericMatch.score}%)`);
      return {
        matchedIndex: bestGenericMatch.index,
        ruleName,
        score: bestGenericMatch.score,
        explanation: `Generic word match [${wordsStr}] to rule "${ruleName}" with ${bestGenericMatch.score}% confidence`
      };
    }
    logCorrelation("FAIL", `No match in ${contractRules.length} rules. Line words: [${lineWords.slice(0, 5).join(", ")}]`);
    if (contractRules.length > 0 && contractRules.length <= 10) {
      const ruleNames = contractRules.map((r) => r.rule_name || r.description || "unnamed");
      bridgeLog(`[OntologicalBridge] CORRELATION DEBUG: Available rules: [${ruleNames.join(", ")}]`);
    }
    return {
      matchedIndex: -1,
      ruleName: "",
      score: 0,
      explanation: `No keyword or word overlap match for "${lineItemDescription.slice(0, 50)}" in ${contractRules.length} rules`
    };
  }
  /**
   * Extract value with all fallback paths, returning confidence and match type.
   * Returns FuzzyMatchResult with confidence scoring.
   *
   * v5.1 FULL-SPECTRUM TRACEABILITY: Logs all resolution attempts to flight recorder
   */
  extractWithFallbacks(document, mapping, arrayIndex) {
    const alternativesTried = [];
    let value = this.extractValue(document, mapping.fieldPath, arrayIndex, false);
    if (value !== null && value !== void 0) {
      this.logResolutionAttempt(mapping.fieldPath, mapping.role, true, value, 100, "exact", 1, alternativesTried, document);
      return {
        value,
        confidence: 100,
        matchType: "exact",
        matchPath: mapping.fieldPath
      };
    }
    alternativesTried.push(mapping.fieldPath);
    if (mapping.alternativePaths) {
      for (const altPath of mapping.alternativePaths) {
        value = this.extractValue(document, altPath, arrayIndex, false);
        if (value !== null && value !== void 0) {
          this.logResolutionAttempt(altPath, mapping.role, true, value, 95, "alternative", 1, alternativesTried, document);
          return {
            value,
            confidence: 95,
            matchType: "alternative",
            matchPath: altPath
          };
        }
        alternativesTried.push(altPath);
      }
    }
    const fuzzyEnabled = mapping.fuzzyMatch !== false;
    if (fuzzyEnabled) {
      value = this.extractValue(document, mapping.fieldPath, arrayIndex, true);
      if (value !== null && value !== void 0) {
        if (this.validateValueType(value, mapping.role)) {
          this.logResolutionAttempt("fuzzy", mapping.role, true, value, 75, "fuzzy", 1, alternativesTried, document);
          return {
            value,
            confidence: 75,
            matchType: "fuzzy",
            matchPath: "fuzzy"
          };
        } else {
          bridgeLog(`[OntologicalBridge] Fuzzy match REJECTED for ${mapping.role}: got ${typeof value} (${String(value).slice(0, 50)})`);
          this.logResolutionAttempt("fuzzy", mapping.role, false, null, 0, "none", 0, alternativesTried, document, `Type validation failed: expected ${mapping.role}-compatible, got ${typeof value}`);
        }
      }
    }
    this.logResolutionAttempt(
      mapping.fieldPath,
      mapping.role,
      false,
      null,
      0,
      "none",
      0,
      alternativesTried,
      document,
      `No path resolved for ${mapping.role}. Tried: ${alternativesTried.join(", ")}`
    );
    return null;
  }
  /**
   * Log a resolution attempt to the flight recorder
   * v5.1: Full-spectrum traceability for forensic replay
   */
  logResolutionAttempt(path, role, success, value, confidence, matchType, matchCount, alternativesTried, document, error) {
    if (!this.flightRecorder) return;
    try {
      const recordedMatchType = matchType === "none" ? void 0 : matchType;
      if (success) {
        this.flightRecorder.logSuccess(path, value, matchCount, {
          role,
          documentId: this.currentDocumentId,
          domain: this.currentDomain,
          documentType: this.currentDocumentType,
          confidence,
          matchType: recordedMatchType,
          alternativesTried: alternativesTried.length > 0 ? alternativesTried : void 0
        });
      } else {
        this.flightRecorder.logFailure(path, error || "No match found", {
          role,
          documentId: this.currentDocumentId,
          domain: this.currentDomain,
          documentType: this.currentDocumentType,
          alternativesTried: alternativesTried.length > 0 ? alternativesTried : void 0,
          // Include document snapshot on failure for forensic replay
          documentSnapshot: document
        });
      }
    } catch {
    }
  }
  /**
   * Normalize a value to a standard type using forensic normalizer
   * Returns both normalized value and normalization metadata for audit trail.
   */
  normalizeValue(value) {
    if (value === null || value === void 0) {
      return null;
    }
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      const amountResult = normalizeAmount(value);
      if (amountResult?.success) {
        return amountResult.normalized;
      }
      const dateResult = normalizeDate(value);
      if (dateResult?.success) {
        return new Date(dateResult.normalized);
      }
      return value;
    }
    if (value instanceof Date) {
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] === "object") {
        return value.map((v) => String(v));
      }
      return value.map((v) => String(v));
    }
    return String(value);
  }
  /**
   * Normalize a value for a specific role with full audit trail
   * Returns normalization metadata for provenance tracking.
   */
  normalizeValueForRole(value, role) {
    if (value === null || value === void 0) {
      return { normalized: null };
    }
    const declared = this.roleKinds[role];
    if (declared !== void 0) {
      const rep = _OntologicalBridge.KIND_REPRESENTATIVE[declared];
      if (rep !== role) return this.normalizeValueForRole(value, rep);
    }
    const numericRoles = [
      "RATE_APPLIED",
      "RATE_CONTRACTED",
      "CLAIMED_AMOUNT",
      "VERIFIED_AMOUNT",
      "CONTRACTED_LIMIT",
      "LINE_ITEM_TOTAL",
      "EXPECTED_TOTAL",
      // invoice document-level amounts
      "SUBTOTAL",
      "TAX_AMOUNT",
      "DISCOUNT_AMOUNT",
      "SERVICE_CHARGE",
      "GRAND_TOTAL",
      "LINE_ITEMS_SUM",
      "EXPECTED_GRAND_TOTAL",
      "EXPECTED_TAX_AMOUNT"
    ];
    const rateRoles = ["TAX_RATE"];
    const quantityRoles = ["CLAIMED_QUANTITY", "ACTUAL_QUANTITY"];
    const dateRoles = ["EVENT_DATE", "CONTRACT_START", "CONTRACT_END"];
    const referenceRoles = ["DOCUMENT_ID"];
    if (rateRoles.includes(role)) {
      const result = normalizeRate(value);
      if (result?.success) {
        return {
          normalized: result.normalized,
          meta: result
        };
      }
    }
    if (numericRoles.includes(role)) {
      const result = normalizeAmount(value);
      if (result?.success) {
        return {
          normalized: result.normalized,
          meta: result
        };
      }
    }
    if (quantityRoles.includes(role)) {
      const result = normalizeQuantity(value);
      if (result?.success) {
        return {
          normalized: result.normalized,
          meta: result
        };
      }
    }
    if (dateRoles.includes(role)) {
      const result = normalizeDate(value);
      if (result?.success) {
        return {
          normalized: new Date(result.normalized),
          meta: result
        };
      }
      return { normalized: String(value), ...result ? { meta: result } : {} };
    }
    if (referenceRoles.includes(role)) {
      const result = normalizeReference(value);
      if (result?.success) {
        return {
          normalized: result.normalized,
          meta: result
        };
      }
    }
    return { normalized: this.normalizeValue(value) };
  }
  /**
   * Simple word overlap similarity for description matching
   * Returns 0-1 score
   */
  computeDescriptionSimilarity(a, b) {
    const strA = typeof a === "string" ? a : null;
    const strB = typeof b === "string" ? b : null;
    if (!strA || !strB) return 0;
    const wordsA = new Set(strA.toLowerCase().split(/\W+/).filter((w) => w.length >= 3));
    const wordsB = new Set(strB.toLowerCase().split(/\W+/).filter((w) => w.length >= 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    Array.from(wordsA).forEach((word) => {
      if (wordsB.has(word)) overlap++;
    });
    return overlap / Math.min(wordsA.size, wordsB.size);
  }
  /**
   * Compute derived bindings (LINE_ITEM_TOTAL, EXPECTED_TOTAL, VERIFIED_AMOUNT)
   * v5.0 MATH_INT FIX: Compute VERIFIED_AMOUNT from invoice data when no evidence
   * v5.2 SCOPING FIX: Only compute EXPECTED_TOTAL when ACTUAL_QUANTITY has high correlation
   * v5.3 SEMANTIC FIX: Check description similarity before applying evidence quantities
   */
  computeDerivedBindings(bindings) {
    const rateApplied = bindings.RATE_APPLIED?.value;
    const claimedQty = bindings.CLAIMED_QUANTITY?.value;
    if (typeof rateApplied === "number" && typeof claimedQty === "number") {
      const computedTotal = rateApplied * claimedQty;
      bindings.LINE_ITEM_TOTAL = {
        value: computedTotal,
        source: "computed",
        field: "RATE_APPLIED * CLAIMED_QUANTITY",
        confidence: Math.min(bindings.RATE_APPLIED?.confidence ?? 0, bindings.CLAIMED_QUANTITY?.confidence ?? 0)
        // inherit the weakest operand
      };
      bridgeLog(`[OntologicalBridge] COMPUTED: LINE_ITEM_TOTAL = ${rateApplied} \xD7 ${claimedQty} = ${computedTotal}`);
    }
    const rateContracted = bindings.RATE_CONTRACTED?.value;
    const actualQtyBinding = bindings.ACTUAL_QUANTITY;
    const actualQty = actualQtyBinding?.value;
    const invoiceDesc = bindings.INVOICE_DESCRIPTION?.value;
    const evidenceDesc = bindings.EVIDENCE_DESCRIPTION?.value;
    const descSimilarity = this.computeDescriptionSimilarity(invoiceDesc, evidenceDesc);
    const SIMILARITY_THRESHOLD = 0.3;
    const actualQtyIsCorrelated = actualQtyBinding && actualQtyBinding.source === "evidence" && actualQtyBinding.confidence >= 70 && (descSimilarity >= SIMILARITY_THRESHOLD || !invoiceDesc && !evidenceDesc);
    if (typeof rateContracted === "number" && typeof actualQty === "number" && actualQtyIsCorrelated) {
      bindings.EXPECTED_TOTAL = {
        value: rateContracted * actualQty,
        source: "computed",
        field: "RATE_CONTRACTED * ACTUAL_QUANTITY",
        confidence: Math.min(actualQtyBinding.confidence, 95)
        // Capped by correlation quality
      };
      bridgeLog(`[OntologicalBridge] COMPUTED: EXPECTED_TOTAL = ${rateContracted} \xD7 ${actualQty} = ${rateContracted * actualQty} (similarity: ${(descSimilarity * 100).toFixed(0)}%)`);
    } else if (typeof rateContracted === "number" && typeof actualQty === "number") {
      const invDescStr = typeof invoiceDesc === "string" ? invoiceDesc.slice(0, 50) : "N/A";
      const evDescStr = typeof evidenceDesc === "string" ? evidenceDesc.slice(0, 50) : "N/A";
      bridgeLog(`[OntologicalBridge] SKIPPED: EXPECTED_TOTAL - descriptions don't match (similarity: ${(descSimilarity * 100).toFixed(0)}%, threshold: ${SIMILARITY_THRESHOLD * 100}%)`);
      bridgeLog(`[OntologicalBridge]   Invoice: "${invDescStr}"`);
      bridgeLog(`[OntologicalBridge]   Evidence: "${evDescStr}"`);
    }
    if (!bindings.VERIFIED_AMOUNT) {
      if (bindings.LINE_ITEM_TOTAL) {
        bindings.VERIFIED_AMOUNT = {
          value: bindings.LINE_ITEM_TOTAL.value,
          source: "computed",
          field: "RATE_APPLIED * CLAIMED_QUANTITY (math check)",
          confidence: bindings.LINE_ITEM_TOTAL.confidence
          // inherit from the computed total
        };
        bridgeLog(`[OntologicalBridge] COMPUTED: VERIFIED_AMOUNT = ${bindings.LINE_ITEM_TOTAL.value} (math check: rate\xD7qty)`);
      }
    }
  }
  /**
   * Create bindings for ALL line items in an invoice.
   * Returns an array of BindingContext, one per line item.
   *
   * v4.5: Accepts optional LLM correlation map for semantic matching.
   */
  createLineItemBindings(domainId, invoice, contract, evidence, llmCorrelationMap) {
    const keys = this.ontologies.get(domainId)?.lineArrayKeys ?? ["line_items"];
    const lineKey = keys.find((k) => Array.isArray(invoice[k]));
    const lineItems = lineKey !== void 0 ? invoice[lineKey] : void 0;
    if (!lineItems || !Array.isArray(lineItems)) {
      return [this.createBindings(domainId, invoice, contract, evidence, void 0, llmCorrelationMap)];
    }
    const contexts = [];
    for (let i = 0; i < lineItems.length; i++) {
      contexts.push(this.createBindings(domainId, invoice, contract, evidence, i, llmCorrelationMap));
    }
    return contexts;
  }
  /**
   * Convert extracted correlation_map from indexer format to internal format
   */
  static convertExtractedCorrelationMap(extractedMap) {
    if (!extractedMap?.line_item_mappings) {
      return void 0;
    }
    return {
      lineItemMappings: extractedMap.line_item_mappings.map((m) => ({
        invoiceLineIndex: m.invoice_line_index,
        invoiceLineDescription: m.invoice_line_description,
        matchedEvidence: (m.matched_evidence || []).map((e) => ({
          evidenceDocIndex: e.evidence_doc_index ?? -1,
          evidenceDescription: e.evidence_description,
          ticketNumber: e.ticket_number,
          confidence: e.confidence,
          reasoning: e.reasoning
        })),
        matchedContractRule: m.matched_contract_rule ? {
          ruleName: m.matched_contract_rule.rule_name,
          ruleIndex: m.matched_contract_rule.rule_index ?? -1,
          confidence: m.matched_contract_rule.confidence,
          reasoning: m.matched_contract_rule.reasoning
        } : void 0
      }))
    };
  }
  /**
   * Get all available domains
   */
  getAvailableDomains() {
    return Array.from(this.ontologies.keys());
  }
  /**
   * Diagnostic: Show what paths would be tried for a role
   */
  debugPathResolution(domainId, role, documentType) {
    const ontology = this.ontologies.get(domainId);
    if (!ontology) return [];
    const paths = [];
    for (const mapping of ontology.mappings) {
      if (mapping.role === role && (mapping.documentType === documentType || mapping.documentType === "any")) {
        paths.push(mapping.fieldPath);
        if (mapping.alternativePaths) {
          paths.push(...mapping.alternativePaths);
        }
        if (mapping.fieldAliases) {
          paths.push(...mapping.fieldAliases.map((a) => `[fuzzy:${a}]`));
        }
      }
    }
    return paths;
  }
};
var bridgeInstance = null;
function getOntologicalBridge() {
  if (!bridgeInstance) {
    bridgeInstance = new OntologicalBridge();
  }
  return bridgeInstance;
}

// packages/verify/src/kernel/axiom-registry.ts
var RATE_SUPREMACY = {
  id: "ax-rate-sup",
  shortCode: "RATE_SUP",
  name: "Law of Rate Supremacy",
  axiomStatement: "A claimed rate cannot exceed the contracted rate",
  formalForm: "\u2200r: r_applied \u2264 r_contracted",
  predicates: [
    {
      leftRole: "RATE_APPLIED",
      operator: "<=",
      rightRole: "RATE_CONTRACTED",
      tolerance: 0.01,
      // 1 cent tolerance
      description: "Invoice rate must not exceed contracted rate"
    }
  ],
  requiredRoles: ["RATE_APPLIED", "RATE_CONTRACTED"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: []
  // Universal
};
var QUANTITY_MATCH = {
  id: "ax-qty-match",
  shortCode: "QTY_MATCH",
  name: "Law of Quantity Match",
  axiomStatement: "Claimed quantity must match verified quantity from evidence",
  formalForm: "\u2200q: q_claimed = q_verified",
  predicates: [
    {
      leftRole: "CLAIMED_QUANTITY",
      operator: "=",
      rightRole: "ACTUAL_QUANTITY",
      tolerance: 1e-3,
      // Small tolerance for rounding
      description: "Invoice quantity must match evidence quantity"
    }
  ],
  requiredRoles: ["CLAIMED_QUANTITY", "ACTUAL_QUANTITY"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: []
};
var TEMPORAL_ORDER = {
  id: "ax-time-ord",
  shortCode: "TIME_ORD",
  name: "Law of Temporal Order",
  axiomStatement: "Service date must fall within contract effective period",
  formalForm: "\u2200t: contract_start \u2264 t_event \u2264 contract_end",
  predicates: [
    {
      leftRole: "EVENT_DATE",
      operator: ">=",
      rightRole: "CONTRACT_START",
      description: "Service date must be on or after contract start"
    },
    {
      leftRole: "EVENT_DATE",
      operator: "<=",
      rightRole: "CONTRACT_END",
      description: "Service date must be on or before contract end"
    }
  ],
  requiredRoles: ["EVENT_DATE", "CONTRACT_START", "CONTRACT_END"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "critical",
  applicableDomains: []
};
var DUPLICATE_PROHIBITION = {
  id: "ax-dup-prohib",
  shortCode: "DUP_PROHIB",
  name: "Law of Duplicate Prohibition",
  axiomStatement: "A claim cannot duplicate a prior approved claim",
  formalForm: "\u2200c: prior_claims(c) = \u2205",
  predicates: [
    {
      leftRole: "PRIOR_CLAIM_IDS",
      operator: "EMPTY",
      rightRole: null,
      description: "No prior claims should exist for this service"
    }
  ],
  requiredRoles: ["PRIOR_CLAIM_IDS"],
  combinationLogic: "AND",
  detectableBy: "BOTH",
  // May need LLM to identify fuzzy duplicates
  severity: "critical",
  applicableDomains: []
};
var MATH_INTEGRITY = {
  id: "ax-math-int",
  shortCode: "MATH_INT",
  name: "Law of Mathematical Integrity",
  axiomStatement: "Claimed amount must equal calculated/verified amount",
  formalForm: "\u2200a: a_claimed = a_calculated",
  predicates: [
    {
      leftRole: "CLAIMED_AMOUNT",
      operator: "=",
      rightRole: "VERIFIED_AMOUNT",
      tolerance: 0.01,
      // 1 cent tolerance
      description: "Invoice amount must match verified amount"
    }
  ],
  requiredRoles: ["CLAIMED_AMOUNT", "VERIFIED_AMOUNT"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: []
};
var AMOUNT_CAP = {
  id: "ax-amt-cap",
  shortCode: "AMT_CAP",
  name: "Law of Amount Cap",
  axiomStatement: "Claimed amount cannot exceed contracted maximum",
  formalForm: "\u2200a: a_claimed \u2264 a_max",
  predicates: [
    {
      leftRole: "CLAIMED_AMOUNT",
      operator: "<=",
      rightRole: "CONTRACTED_LIMIT",
      tolerance: 0.01,
      description: "Invoice amount must not exceed contracted limit"
    }
  ],
  requiredRoles: ["CLAIMED_AMOUNT", "CONTRACTED_LIMIT"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: []
};
var EVIDENCE_REQUIREMENT = {
  id: "ax-evid-req",
  shortCode: "EVID_REQ",
  name: "Law of Evidence Requirement",
  axiomStatement: "Every claim must have supporting documentary evidence",
  formalForm: "\u2200c: evidence(c) \u2260 \u2205",
  predicates: [
    {
      leftRole: "ACTUAL_QUANTITY",
      operator: "EXISTS",
      rightRole: null,
      description: "Evidence quantity must exist for claimed items"
    }
  ],
  requiredRoles: [],
  // No roles required - we're checking if evidence EXISTS
  combinationLogic: "AND",
  detectableBy: "BOTH",
  // Semi-computable: can detect missing, but LLM verifies match
  severity: "medium",
  applicableDomains: []
};
var DESCRIPTION_MATCH = {
  id: "ax-desc-match",
  shortCode: "DESC_MATCH",
  name: "Law of Description Match",
  axiomStatement: "Invoice service description must match evidence documentation",
  formalForm: "\u2200d: semantic_match(d_invoice, d_evidence) = true",
  predicates: [],
  // No computational predicates - LLM handles semantic matching
  requiredRoles: ["INVOICE_DESCRIPTION", "EVIDENCE_DESCRIPTION"],
  // Kept for binding/provenance
  combinationLogic: "AND",
  detectableBy: "LLM",
  // Semantic matching requires LLM
  severity: "medium",
  applicableDomains: []
};
var STRUCTURAL_OMISSION = {
  id: "ax-omission",
  shortCode: "OMISSION",
  name: "Law of Structural Completeness",
  axiomStatement: "Required data fields must be present for validation to proceed",
  formalForm: "\u2200f \u2208 RequiredFields: f \u2260 \u2205",
  predicates: [],
  // Omission detection is handled by omission-detector.ts, not predicates
  requiredRoles: [],
  // Dynamic - depends on domain configuration
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "critical",
  applicableDomains: []
  // Universal - applies to all domains
};
var TERMINATION_GUARANTEE = {
  id: "ax-term-guar",
  shortCode: "TERMINATION_GUARANTEE",
  name: "Law of Termination Guarantee",
  axiomStatement: "All execution paths must have verified termination conditions",
  formalForm: "\u2200loop: verified_exits(loop) \u2265 1",
  predicates: [
    {
      leftRole: "ACTUAL_QUANTITY",
      // Verified exits
      operator: ">=",
      rightRole: "CLAIMED_QUANTITY",
      // Claimed exits
      tolerance: 0,
      description: "Verified exits must match or exceed claimed exits"
    }
  ],
  requiredRoles: ["CLAIMED_QUANTITY", "ACTUAL_QUANTITY"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "critical",
  applicableDomains: ["code"]
};
var STATE_EXCLUSIVITY = {
  id: "ax-state-ex",
  shortCode: "STATE_EXCLUSIVITY",
  name: "Law of State Exclusivity",
  axiomStatement: "All shared state must be protected by synchronization primitives",
  formalForm: "\u2200v \u2208 SharedVars: synchronized(v)",
  predicates: [
    {
      leftRole: "ACTUAL_QUANTITY",
      // Synchronized accesses
      operator: ">=",
      rightRole: "CLAIMED_QUANTITY",
      // Shared variables
      tolerance: 0,
      description: "All shared variables must have synchronization"
    }
  ],
  requiredRoles: ["CLAIMED_QUANTITY", "ACTUAL_QUANTITY"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: ["code"]
};
var MEMORY_CONSERVATION = {
  id: "ax-mem-cons",
  shortCode: "MEMORY_CONSERVATION",
  name: "Law of Memory Conservation",
  axiomStatement: "All memory allocations must have corresponding releases",
  formalForm: "\u2200alloc: \u2203release(alloc)",
  predicates: [
    {
      leftRole: "ACTUAL_QUANTITY",
      // Releases
      operator: ">=",
      rightRole: "CLAIMED_QUANTITY",
      // Allocations
      tolerance: 0,
      description: "Releases must match or exceed allocations"
    }
  ],
  requiredRoles: ["CLAIMED_QUANTITY", "ACTUAL_QUANTITY"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: ["code"]
};
var ORGANIC_DISTRIBUTION = {
  id: "ax-org-dist",
  shortCode: "ORGANIC_DISTRIBUTION",
  name: "Law of Organic Distribution",
  axiomStatement: "Human activity patterns follow natural distributions with high entropy",
  formalForm: "\u2200activity: entropy(timestamps) \u2265 0.7",
  predicates: [
    {
      leftRole: "RATE_APPLIED",
      // Actual entropy
      operator: ">=",
      rightRole: "RATE_CONTRACTED",
      // Required entropy (0.7)
      tolerance: 0.05,
      description: "Activity entropy must indicate organic behavior"
    }
  ],
  requiredRoles: ["RATE_APPLIED", "RATE_CONTRACTED"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "critical",
  applicableDomains: ["media"]
};
var VOTE_CONSERVATION = {
  id: "ax-vote-cons",
  shortCode: "VOTE_CONSERVATION",
  name: "Law of Vote Conservation",
  axiomStatement: "Total votes cast cannot exceed registered voter count",
  formalForm: "\u2200election: votes_cast \u2264 registered_voters",
  predicates: [
    {
      leftRole: "CLAIMED_QUANTITY",
      // Votes cast
      operator: "<=",
      rightRole: "CONTRACTED_LIMIT",
      // Registered voters
      tolerance: 0,
      description: "Votes must not exceed registration"
    }
  ],
  requiredRoles: ["CLAIMED_QUANTITY", "CONTRACTED_LIMIT"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "critical",
  applicableDomains: ["media"]
};
var TRANSITIVE_PROPERTY = {
  id: "ax-trans-prop",
  shortCode: "TRANSITIVE_PROPERTY",
  name: "Law of Transitive Property",
  axiomStatement: "Logical chains must preserve validity across all links",
  formalForm: "(A\u2192B \u2227 B\u2192C) \u2192 (A\u2192C)",
  predicates: [
    {
      leftRole: "ACTUAL_QUANTITY",
      // Verified links
      operator: ">=",
      rightRole: "CLAIMED_QUANTITY",
      // Stated links
      tolerance: 0,
      description: "All logical links must be verified"
    }
  ],
  requiredRoles: ["CLAIMED_QUANTITY", "ACTUAL_QUANTITY"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "critical",
  applicableDomains: ["philosophy"]
};
var CIRCULAR_PROHIBITION = {
  id: "ax-circ-prohib",
  shortCode: "CIRCULAR_PROHIBITION",
  name: "Law of Circular Prohibition",
  axiomStatement: "Arguments must not beg the question (conclusion in premise)",
  formalForm: "\u2200arg: premise \u2229 conclusion = \u2205",
  predicates: [
    {
      leftRole: "ACTUAL_QUANTITY",
      // Circularity score
      operator: "<",
      rightRole: "CONTRACTED_LIMIT",
      // Max allowed (0.1)
      tolerance: 0.01,
      description: "Circularity must be below threshold"
    }
  ],
  requiredRoles: ["ACTUAL_QUANTITY", "CONTRACTED_LIMIT"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: ["philosophy"]
};
var EUPHEMISM_DETECTION = {
  id: "ax-sem-euphemism",
  shortCode: "SEM_EUPHEMISM",
  name: "Law of Plain Language",
  axiomStatement: "Claims should use direct language, not euphemisms",
  formalForm: "\u2200text: euphemism_count(text) = 0",
  predicates: [
    {
      leftRole: "CLAIMED_AMOUNT",
      // Euphemism count
      operator: "<=",
      rightRole: "CONTRACTED_LIMIT",
      // Max allowed (0)
      tolerance: 0,
      description: "No euphemisms should be present"
    }
  ],
  requiredRoles: ["CLAIMED_AMOUNT", "CONTRACTED_LIMIT"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "medium",
  applicableDomains: ["finance", "legal", "medical", "science"]
};
var DISCLOSURE_REQUIREMENTS = {
  id: "ax-sem-disclosure",
  shortCode: "SEM_DISCLOSURE",
  name: "Law of Required Disclosures",
  axiomStatement: "Documents must contain all required disclosures",
  formalForm: "\u2200req \u2208 requirements: present(doc, req)",
  predicates: [
    {
      leftRole: "ACTUAL_QUANTITY",
      // Disclosures found
      operator: ">=",
      rightRole: "CLAIMED_QUANTITY",
      // Disclosures required
      tolerance: 0,
      description: "All required disclosures must be present"
    }
  ],
  requiredRoles: ["ACTUAL_QUANTITY", "CLAIMED_QUANTITY"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: ["finance", "legal", "medical", "science"]
};
var PROPORTIONALITY_CHECK = {
  id: "ax-sem-proportionality",
  shortCode: "SEM_PROPORTIONALITY",
  name: "Law of Proportional Claims",
  axiomStatement: "Claim magnitudes must be proportional to evidence",
  formalForm: "|claim/evidence| \u2264 maxRatio",
  predicates: [
    {
      leftRole: "CLAIMED_AMOUNT",
      // Claim magnitude
      operator: "<=",
      rightRole: "VERIFIED_AMOUNT",
      // Evidence magnitude × maxRatio
      tolerance: 0.1,
      description: "Claim must not exceed evidence by ratio threshold"
    }
  ],
  requiredRoles: ["CLAIMED_AMOUNT", "VERIFIED_AMOUNT"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: ["finance", "legal", "medical", "science"]
};
var CHERRY_PICKING_DETECTION = {
  id: "ax-sem-cherry-picking",
  shortCode: "SEM_CHERRY_PICKING",
  name: "Law of Complete Evidence",
  axiomStatement: "Claims must not selectively present data",
  formalForm: "cited_data \u2286 relevant_data \u2192 \xACcherry_picked",
  predicates: [
    {
      leftRole: "ACTUAL_QUANTITY",
      // Cited evidence ratio
      operator: ">=",
      rightRole: "CONTRACTED_LIMIT",
      // Minimum coverage (0.8)
      tolerance: 0.1,
      description: "Must cite sufficient portion of relevant data"
    }
  ],
  requiredRoles: ["ACTUAL_QUANTITY", "CONTRACTED_LIMIT"],
  combinationLogic: "AND",
  detectableBy: "LLM",
  severity: "high",
  applicableDomains: ["science", "legal", "medical"]
};
var CAUSAL_VALIDITY = {
  id: "ax-sem-causal-validity",
  shortCode: "SEM_CAUSAL_VALIDITY",
  name: "Law of Causal Validity",
  axiomStatement: "Causal claims must be supported by appropriate methodology",
  formalForm: "claim(A\u2192B) \u2192 methodology_supports(A\u2192B)",
  predicates: [
    {
      leftRole: "CLAIMED_AMOUNT",
      // Methodology strength
      operator: ">=",
      rightRole: "CONTRACTED_LIMIT",
      // Required strength for causal claim
      tolerance: 0.05,
      description: "Methodology must support causal inference"
    }
  ],
  requiredRoles: ["CLAIMED_AMOUNT", "CONTRACTED_LIMIT"],
  combinationLogic: "AND",
  detectableBy: "LLM",
  severity: "high",
  applicableDomains: ["science", "medical"]
};
var FRAMING_ANALYSIS = {
  id: "ax-sem-framing",
  shortCode: "SEM_FRAMING",
  name: "Law of Neutral Framing",
  axiomStatement: "Information should be presented without biased framing",
  formalForm: "bias_score(text) \u2264 threshold",
  predicates: [
    {
      leftRole: "CLAIMED_AMOUNT",
      // Bias score
      operator: "<=",
      rightRole: "CONTRACTED_LIMIT",
      // Max allowed bias
      tolerance: 0.1,
      description: "Text must not contain excessive framing bias"
    }
  ],
  requiredRoles: ["CLAIMED_AMOUNT", "CONTRACTED_LIMIT"],
  combinationLogic: "AND",
  detectableBy: "LLM",
  severity: "medium",
  applicableDomains: ["media", "legal", "finance"]
};
var CORE_AXIOMS = [
  RATE_SUPREMACY,
  QUANTITY_MATCH,
  TEMPORAL_ORDER,
  DUPLICATE_PROHIBITION,
  MATH_INTEGRITY,
  AMOUNT_CAP
];
var EXTENDED_AXIOMS = [
  ...CORE_AXIOMS,
  EVIDENCE_REQUIREMENT,
  DESCRIPTION_MATCH,
  STRUCTURAL_OMISSION,
  // The Octagon - Domain-Specific Axioms
  TERMINATION_GUARANTEE,
  // Code: loops must terminate
  STATE_EXCLUSIVITY,
  // Code: synchronized access
  MEMORY_CONSERVATION,
  // Code: no leaks
  ORGANIC_DISTRIBUTION,
  // Media: bell curves not step functions
  VOTE_CONSERVATION,
  // Media: votes <= voters
  TRANSITIVE_PROPERTY,
  // Philosophy: A→B→C implies A→C
  CIRCULAR_PROHIBITION,
  // Philosophy: no begging the question
  // Level 4: Semantic Axioms
  EUPHEMISM_DETECTION,
  // Semantic: detect softening language
  DISCLOSURE_REQUIREMENTS,
  // Semantic: check required disclosures
  PROPORTIONALITY_CHECK,
  // Semantic: claim vs evidence magnitude
  CHERRY_PICKING_DETECTION,
  // Semantic: selective data presentation (LLM)
  CAUSAL_VALIDITY,
  // Semantic: cause-effect validity (LLM)
  FRAMING_ANALYSIS
  // Semantic: biased framing (LLM)
];
var AXIOM_BY_CODE = new Map(
  EXTENDED_AXIOMS.map((a) => [a.shortCode, a])
);
var AXIOM_BY_ID = new Map(
  EXTENDED_AXIOMS.map((a) => [a.id, a])
);
var AxiomRegistry = class {
  axioms = /* @__PURE__ */ new Map();
  axiomsByCode = /* @__PURE__ */ new Map();
  constructor() {
    for (const axiom of EXTENDED_AXIOMS) {
      this.register(axiom);
    }
  }
  /**
   * Register a computational axiom
   */
  register(axiom) {
    this.axioms.set(axiom.id, axiom);
    this.axiomsByCode.set(axiom.shortCode, axiom);
  }
  /**
   * Get axiom by ID
   */
  getById(id) {
    return this.axioms.get(id);
  }
  /**
   * Get axiom by short code
   */
  getByCode(code) {
    return this.axiomsByCode.get(code);
  }
  /**
   * Get all axioms
   */
  getAll() {
    return Array.from(this.axioms.values());
  }
  /**
   * Get axioms applicable to a domain
   */
  getForDomain(domainId) {
    return this.getAll().filter(
      (a) => a.applicableDomains.length === 0 || a.applicableDomains.includes(domainId)
    );
  }
  /**
   * Get precomputable axioms (can be evaluated without LLM)
   */
  getPrecomputable() {
    return this.getAll().filter(
      (a) => a.detectableBy === "PRECOMPUTE" || a.detectableBy === "BOTH"
    );
  }
  /**
   * Get LLM-required axioms
   */
  getLLMRequired() {
    return this.getAll().filter((a) => a.detectableBy === "LLM");
  }
  /**
   * Get axioms that require specific roles
   */
  getRequiringRoles(roles) {
    const roleSet = new Set(roles);
    return this.getAll().filter(
      (a) => a.requiredRoles.every((r) => roleSet.has(r))
    );
  }
  /**
   * Check if axiom is applicable given available bindings
   */
  isApplicable(axiomId, availableRoles) {
    const axiom = this.axioms.get(axiomId);
    if (!axiom) return false;
    const roleSet = new Set(availableRoles);
    return axiom.requiredRoles.every((r) => roleSet.has(r));
  }
};
var registryInstance = null;
function getAxiomRegistry() {
  if (!registryInstance) {
    registryInstance = new AxiomRegistry();
  }
  return registryInstance;
}

// packages/verify/src/kernel/validation-gavel.ts
var log = () => {
};
function setGavelLogger(logger) {
  log = logger ?? (() => {
  });
}
function isValidDate(x) {
  return x instanceof Date && !isNaN(x.getTime());
}
var ValidationGavel = class {
  DEFAULT_TOLERANCE = 0.01;
  // 1 cent for currency
  /**
   * Get human-readable hint for what to supply for a role.
   */
  getRoleHint(role) {
    const hints = {
      RATE_APPLIED: "the rate/unit price from the invoice",
      RATE_CONTRACTED: "the contracted rate from the contract",
      CLAIMED_AMOUNT: "the billed/invoiced amount",
      VERIFIED_AMOUNT: "the verified amount from evidence",
      CONTRACTED_LIMIT: "the maximum allowed amount from contract",
      CLAIMED_QUANTITY: "the quantity claimed on the invoice",
      ACTUAL_QUANTITY: "the actual quantity from evidence (field tickets)",
      EVENT_DATE: "the service date from the invoice",
      CONTRACT_START: "the contract effective/start date",
      CONTRACT_END: "the contract expiration/end date",
      DOCUMENT_ID: "the invoice or document number",
      PRIOR_CLAIM_IDS: "prior_invoice_ids \u2014 an array of previously seen invoice numbers, supplied by the caller, for duplicate detection",
      LINE_ITEM_TOTAL: "the computed line item total",
      EXPECTED_TOTAL: "the expected total based on contract rates",
      INVOICE_DESCRIPTION: "the service description from the invoice",
      EVIDENCE_DESCRIPTION: "the service description from evidence",
      SUBTOTAL: "the stated subtotal from the invoice",
      TAX_AMOUNT: "the stated tax amount from the invoice",
      TAX_RATE: "the stated tax rate from the invoice",
      DISCOUNT_AMOUNT: "the stated discount from the invoice",
      GRAND_TOTAL: "the stated grand total from the invoice",
      LINE_ITEMS_SUM: "the sum of line item amounts (computed)",
      CURRENCY_CODE: "the ISO-4217 currency code"
    };
    return hints[role] ?? role;
  }
  /**
   * Validate a single axiom against bindings.
   */
  validateAxiom(axiom, bindings) {
    const missingRoles = [];
    for (const role of axiom.requiredRoles) {
      if (!bindings.bindings[role] || bindings.bindings[role]?.value === null) {
        missingRoles.push(role);
      }
    }
    if (missingRoles.length > 0) {
      const boundCount = axiom.requiredRoles.length - missingRoles.length;
      const bindingCoverage = axiom.requiredRoles.length > 0 ? boundCount / axiom.requiredRoles.length * 100 : 0;
      const extractionHint = `Please supply: ${missingRoles.map((r) => this.getRoleHint(r)).join(", ")}`;
      return {
        axiomId: axiom.id,
        axiomCode: axiom.shortCode,
        verdict: "INSUFFICIENT_DATA",
        confidence: "LOW",
        isLocked: false,
        predicateResults: [],
        missingRoles,
        bindingCoverage,
        extractionHint,
        validatedAt: /* @__PURE__ */ new Date(),
        explanation: `Cannot evaluate: missing bindings for ${missingRoles.join(", ")}`
      };
    }
    const predicateResults = [];
    for (const predicate of axiom.predicates) {
      const result = this.evaluatePredicate(predicate, bindings);
      predicateResults.push(result);
    }
    let passed;
    if (axiom.combinationLogic === "AND") {
      passed = predicateResults.every((r) => r.passed);
    } else {
      passed = predicateResults.some((r) => r.passed);
    }
    const confidence = this.calculateConfidence(bindings, axiom.requiredRoles);
    const allBindingsHighConfidence = this.allRequiredBindingsExact(bindings, axiom.requiredRoles);
    const needsCorrelation = this.axiomNeedsCorrelation(axiom);
    const correlationIsReliable = this.checkCorrelationReliable(bindings, needsCorrelation);
    if ((needsCorrelation.contract || needsCorrelation.evidence) && !correlationIsReliable) {
      log(`[ValidationGavel] Locking prevented: ${axiom.shortCode} requires reliable correlation but correlation is weak/missing`);
    }
    const isLocked = !passed && allBindingsHighConfidence && // ALL bindings must be exact matches
    (!(needsCorrelation.contract || needsCorrelation.evidence) || correlationIsReliable) && // v4.5: Correlation must be reliable if needed
    (axiom.detectableBy === "PRECOMPUTE" || // Lock BOTH axioms only for definitive negative checks
    // We can prove absence of data; a reasoner can't find what doesn't exist
    axiom.detectableBy === "BOTH" && this.isDefinitiveNegativeResult(axiom, predicateResults));
    const variance = this.calculateVariance(predicateResults, bindings, axiom);
    const explanation = this.generateExplanation(axiom, predicateResults, passed);
    return {
      axiomId: axiom.id,
      axiomCode: axiom.shortCode,
      verdict: passed ? "PASS" : "FAIL",
      confidence,
      isLocked,
      variance,
      predicateResults,
      bindingCoverage: 100,
      // All required roles were bound if we got here
      validatedAt: /* @__PURE__ */ new Date(),
      explanation
    };
  }
  /**
   * Validate all applicable axioms against bindings.
   */
  validateAll(bindings, domainId) {
    const registry = getAxiomRegistry();
    const axioms = domainId ? registry.getForDomain(domainId) : registry.getAll();
    const results = [];
    for (const axiom of axioms) {
      const result = this.validateAxiom(axiom, bindings);
      results.push(result);
    }
    return this.summarize(bindings.invoiceId, results);
  }
  /**
   * Validate precomputable axioms only (fast path, no reasoner needed).
   * Evaluates the static registry, optionally filtered to a domain.
   */
  validatePrecomputable(bindings, domainId) {
    const registry = getAxiomRegistry();
    let axioms = registry.getPrecomputable();
    if (domainId) {
      axioms = axioms.filter(
        (a) => a.applicableDomains.length === 0 || a.applicableDomains.includes(domainId)
      );
    }
    const results = [];
    for (const axiom of axioms) {
      results.push(this.validateAxiom(axiom, bindings));
    }
    return this.summarize(bindings.invoiceId, results);
  }
  /**
   * Build the report summary from results.
   */
  summarize(invoiceId, results) {
    const lockedFailures = results.filter((r) => r.isLocked).length;
    const passCount = results.filter((r) => r.verdict === "PASS").length;
    const failCount = results.filter((r) => r.verdict === "FAIL").length;
    const insufficientCount = results.filter((r) => r.verdict === "INSUFFICIENT_DATA").length;
    return {
      invoiceId,
      results,
      lockedFailures,
      passCount,
      failCount,
      insufficientCount,
      generatedAt: /* @__PURE__ */ new Date()
    };
  }
  /**
   * Evaluate a single predicate against bindings.
   * v4.5: Includes binding provenance with full normalization audit trail.
   */
  evaluatePredicate(predicate, bindings) {
    const leftBound = bindings.bindings[predicate.leftRole];
    const leftValue = leftBound?.value ?? null;
    const leftProvenance = leftBound ? {
      role: predicate.leftRole,
      value: leftBound.value,
      source: leftBound.source,
      fieldPath: leftBound.field,
      confidence: leftBound.confidence,
      // v4.5: Normalization audit trail
      originalValue: leftBound.originalValue,
      normalizedValue: leftBound.normalizedValue,
      normalizations: leftBound.normalizations
    } : void 0;
    let rightValue = null;
    let rightProvenance = void 0;
    if (predicate.rightRole) {
      const rightBound = bindings.bindings[predicate.rightRole];
      rightValue = rightBound?.value ?? null;
      if (rightBound) {
        rightProvenance = {
          role: predicate.rightRole,
          value: rightBound.value,
          source: rightBound.source,
          fieldPath: rightBound.field,
          confidence: rightBound.confidence,
          // v4.5: Normalization audit trail
          originalValue: rightBound.originalValue,
          normalizedValue: rightBound.normalizedValue,
          normalizations: rightBound.normalizations
        };
      }
    } else if (predicate.constant !== void 0) {
      rightValue = predicate.constant;
    }
    if (leftValue === null && predicate.operator !== "EXISTS" && predicate.operator !== "NOT_EXISTS") {
      return {
        predicate,
        passed: false,
        leftValue: null,
        rightValue,
        failureReason: `Left value (${predicate.leftRole}) is missing`,
        leftProvenance,
        rightProvenance
      };
    }
    if (leftValue instanceof Date && !isValidDate(leftValue) || rightValue instanceof Date && !isValidDate(rightValue)) {
      return { predicate, passed: false, leftValue, rightValue, failureReason: "Type mismatch: invalid date value", leftProvenance, rightProvenance };
    }
    const tolerance = predicate.tolerance ?? this.DEFAULT_TOLERANCE;
    let passed = false;
    let variance;
    let failureReason;
    switch (predicate.operator) {
      case "<=":
        if (typeof leftValue === "number" && typeof rightValue === "number") {
          passed = leftValue <= rightValue + tolerance;
          variance = leftValue - rightValue;
          if (!passed) failureReason = `${leftValue} > ${rightValue}`;
        } else if (isValidDate(leftValue) && isValidDate(rightValue)) {
          passed = leftValue <= rightValue;
          if (!passed) failureReason = `${leftValue.toISOString()} > ${rightValue.toISOString()}`;
        } else {
          failureReason = "Type mismatch for <= comparison";
        }
        break;
      case ">=":
        if (typeof leftValue === "number" && typeof rightValue === "number") {
          passed = leftValue >= rightValue - tolerance;
          variance = leftValue - rightValue;
          if (!passed) failureReason = `${leftValue} < ${rightValue}`;
        } else if (isValidDate(leftValue) && isValidDate(rightValue)) {
          passed = leftValue >= rightValue;
          if (!passed) failureReason = `${leftValue.toISOString()} < ${rightValue.toISOString()}`;
        } else {
          failureReason = "Type mismatch for >= comparison";
        }
        break;
      case "=":
        if (typeof leftValue === "number" && typeof rightValue === "number") {
          passed = Math.abs(leftValue - rightValue) <= tolerance;
          variance = leftValue - rightValue;
          if (!passed) failureReason = `${leftValue} \u2260 ${rightValue} (diff: ${variance.toFixed(2)})`;
        } else if (typeof leftValue === "string" && typeof rightValue === "string") {
          passed = leftValue === rightValue;
          if (!passed) failureReason = `"${leftValue}" \u2260 "${rightValue}"`;
        } else if (isValidDate(leftValue) && isValidDate(rightValue)) {
          passed = leftValue.getTime() === rightValue.getTime();
          if (!passed) failureReason = `${leftValue.toISOString()} \u2260 ${rightValue.toISOString()}`;
        } else {
          passed = leftValue === rightValue;
          if (!passed) failureReason = `${String(leftValue)} \u2260 ${String(rightValue)}`;
        }
        break;
      case "!=":
        if (typeof leftValue === "number" && typeof rightValue === "number") {
          passed = Math.abs(leftValue - rightValue) > tolerance;
          if (!passed) failureReason = `${leftValue} = ${rightValue}`;
        } else {
          passed = leftValue !== rightValue;
          if (!passed) failureReason = `${String(leftValue)} = ${String(rightValue)}`;
        }
        break;
      case "<":
        if (typeof leftValue === "number" && typeof rightValue === "number") {
          passed = leftValue < rightValue;
          variance = leftValue - rightValue;
          if (!passed) failureReason = `${leftValue} >= ${rightValue}`;
        } else if (isValidDate(leftValue) && isValidDate(rightValue)) {
          passed = leftValue < rightValue;
          if (!passed) failureReason = `${leftValue.toISOString()} >= ${rightValue.toISOString()}`;
        } else {
          failureReason = "Type mismatch for < comparison";
        }
        break;
      case ">":
        if (typeof leftValue === "number" && typeof rightValue === "number") {
          passed = leftValue > rightValue;
          variance = leftValue - rightValue;
          if (!passed) failureReason = `${leftValue} <= ${rightValue}`;
        } else if (isValidDate(leftValue) && isValidDate(rightValue)) {
          passed = leftValue > rightValue;
          if (!passed) failureReason = `${leftValue.toISOString()} <= ${rightValue.toISOString()}`;
        } else {
          failureReason = "Type mismatch for > comparison";
        }
        break;
      case "IN":
        if (Array.isArray(rightValue)) {
          passed = rightValue.includes(String(leftValue));
          if (!passed) failureReason = `${String(leftValue)} not in [${rightValue.join(", ")}]`;
        } else {
          failureReason = "Right value must be array for IN operator";
        }
        break;
      case "NOT_IN":
        if (Array.isArray(rightValue)) {
          passed = !rightValue.includes(String(leftValue));
          if (!passed) failureReason = `${String(leftValue)} found in [${rightValue.join(", ")}]`;
        } else {
          failureReason = "Right value must be array for NOT_IN operator";
        }
        break;
      case "EMPTY":
        if (Array.isArray(leftValue)) {
          passed = leftValue.length === 0;
          if (!passed) failureReason = `Array has ${leftValue.length} elements`;
        } else {
          failureReason = "Left value must be array for EMPTY operator";
        }
        break;
      case "NOT_EMPTY":
        if (Array.isArray(leftValue)) {
          passed = leftValue.length > 0;
          if (!passed) failureReason = "Array is empty";
        } else {
          failureReason = "Left value must be array for NOT_EMPTY operator";
        }
        break;
      case "EXISTS":
        passed = leftValue !== null && leftValue !== void 0;
        if (!passed) failureReason = `${predicate.leftRole} does not exist (no evidence)`;
        break;
      case "NOT_EXISTS":
        passed = leftValue === null || leftValue === void 0;
        if (!passed) failureReason = `${predicate.leftRole} exists when it should not`;
        break;
      case "SIMILAR_TO": {
        if (typeof leftValue !== "string" || typeof rightValue !== "string") {
          failureReason = "SIMILAR_TO requires string values";
          break;
        }
        const similarity = this.computeStringSimilarity(leftValue, rightValue);
        const threshold = tolerance;
        passed = similarity >= threshold;
        variance = 1 - similarity;
        if (!passed) {
          const leftPreview = leftValue.length > 50 ? leftValue.slice(0, 50) + "..." : leftValue;
          const rightPreview = rightValue.length > 50 ? rightValue.slice(0, 50) + "..." : rightValue;
          failureReason = `Similarity: ${(similarity * 100).toFixed(0)}% (threshold: ${(threshold * 100).toFixed(0)}%) - "${leftPreview}" vs "${rightPreview}"`;
        }
        break;
      }
      default:
        failureReason = `Unknown operator: ${String(predicate.operator)}`;
    }
    return {
      predicate,
      passed,
      leftValue,
      rightValue,
      variance,
      failureReason,
      leftProvenance,
      rightProvenance
    };
  }
  /**
   * Calculate confidence level based on binding quality.
   */
  calculateConfidence(bindings, requiredRoles) {
    const confidences = [];
    for (const role of requiredRoles) {
      const bound = bindings.bindings[role];
      if (bound) {
        confidences.push(bound.confidence);
      }
    }
    if (confidences.length === 0) return "LOW";
    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    if (avgConfidence >= 90) return "HIGH";
    if (avgConfidence >= 70) return "MEDIUM";
    return "LOW";
  }
  /**
   * Calculate total variance from predicate results.
   *
   * v5.21: For rate-based axioms (RATE_SUP), multiply the per-unit variance by quantity
   * to get the total overcharge. This ensures locked variance reflects actual savings.
   */
  calculateVariance(results, bindings, axiom) {
    const variances = results.filter((r) => r.variance !== void 0).map((r) => r.variance);
    if (variances.length === 0) return void 0;
    const baseVariance = variances.reduce((a, b) => a + Math.abs(b), 0);
    const isRateAxiom = axiom.shortCode === "RATE_SUP";
    if (isRateAxiom) {
      const quantity = bindings.bindings["CLAIMED_QUANTITY"]?.value;
      if (typeof quantity === "number" && quantity > 0) {
        const totalVariance = baseVariance * quantity;
        log(`[ValidationGavel] RATE_SUP variance \xD7 quantity = ${baseVariance.toFixed(2)} \xD7 ${quantity} = ${totalVariance.toFixed(2)}`);
        return totalVariance;
      }
    }
    return baseVariance;
  }
  /**
   * Check if ALL required role bindings have high confidence (≥90%).
   * v9.3: Lowered from 95% to 90%. Fuzzy matches (75%) still don't qualify for locking.
   */
  allRequiredBindingsExact(bindings, requiredRoles) {
    const EXACT_MATCH_THRESHOLD = 90;
    for (const role of requiredRoles) {
      const bound = bindings.bindings[role];
      if (!bound) {
        return false;
      }
      if (bound.confidence < EXACT_MATCH_THRESHOLD) {
        log(`[ValidationGavel] Locking prevented: ${role} has ${bound.confidence}% confidence (threshold: ${EXACT_MATCH_THRESHOLD}%)`);
        return false;
      }
    }
    return true;
  }
  /**
   * v4.5: Check if an axiom requires correlation to evidence or contract.
   * Axioms using RATE_CONTRACTED, ACTUAL_QUANTITY, etc. need reliable correlation.
   */
  axiomNeedsCorrelation(axiom) {
    const CONTRACT_ROLES = [
      "RATE_CONTRACTED",
      "CONTRACTED_LIMIT",
      "CONTRACT_START",
      "CONTRACT_END"
    ];
    const EVIDENCE_ROLES = [
      "ACTUAL_QUANTITY",
      "VERIFIED_AMOUNT",
      "EVIDENCE_DESCRIPTION"
    ];
    const needsContract = axiom.requiredRoles.some((role) => CONTRACT_ROLES.includes(role));
    const needsEvidence = axiom.requiredRoles.some((role) => EVIDENCE_ROLES.includes(role));
    return { contract: needsContract, evidence: needsEvidence };
  }
  /**
   * v4.5 + v5.0: Check if correlation info in bindings shows reliable correlation.
   * If axiom needs contract/evidence, those correlations must be reliable.
   *
   * v5.0 DETERMINISTIC MODE: If all required bindings for contract/evidence have
   * high confidence (≥95%), we treat the correlation as implicitly reliable because
   * the binding paths were explicit/deterministic (e.g., JSONPath resolution succeeded).
   */
  checkCorrelationReliable(bindings, needs) {
    const corrInfo = bindings.correlationInfo;
    const DETERMINISTIC_THRESHOLD = 95;
    if (!needs.contract && !needs.evidence) {
      return true;
    }
    const contractRoles = ["RATE_CONTRACTED", "CONTRACTED_LIMIT", "CONTRACT_START", "CONTRACT_END"];
    const evidenceRoles = ["ACTUAL_QUANTITY", "VERIFIED_AMOUNT", "EVIDENCE_DESCRIPTION"];
    if (needs.contract) {
      const contractBindings = contractRoles.map((role) => bindings.bindings[role]).filter((b) => b !== void 0 && b !== null);
      const allContractDeterministic = contractBindings.length > 0 && contractBindings.every((b) => b.confidence >= DETERMINISTIC_THRESHOLD);
      if (allContractDeterministic) {
        log(`[ValidationGavel] Contract correlation: DETERMINISTIC MODE (all bindings \u2265${DETERMINISTIC_THRESHOLD}%)`);
      } else if (!corrInfo?.contract?.isReliable) {
        log(`[ValidationGavel] Correlation check: contract correlation not reliable (score: ${corrInfo?.contract?.score ?? 0})`);
        return false;
      }
    }
    if (needs.evidence) {
      const evidenceBindings = evidenceRoles.map((role) => bindings.bindings[role]).filter((b) => b !== void 0 && b !== null);
      const allEvidenceDeterministic = evidenceBindings.length > 0 && evidenceBindings.every((b) => b.confidence >= DETERMINISTIC_THRESHOLD);
      if (allEvidenceDeterministic) {
        log(`[ValidationGavel] Evidence correlation: DETERMINISTIC MODE (all bindings \u2265${DETERMINISTIC_THRESHOLD}%)`);
      } else if (!corrInfo?.evidence?.isReliable) {
        log(`[ValidationGavel] Correlation check: evidence correlation not reliable (score: ${corrInfo?.evidence?.score ?? 0})`);
        return false;
      }
    }
    return true;
  }
  /**
   * Check if a BOTH axiom has a definitive negative result that should be locked.
   *
   * v4.5 REVISED: EXISTS/NOT_EXISTS are NOT considered definitive for locking.
   * Reason: Missing evidence could be an extraction failure, not proof of absence.
   * Only EMPTY/NOT_EMPTY on arrays that WERE extracted are considered definitive.
   */
  isDefinitiveNegativeResult(axiom, predicateResults) {
    const definitiveOperators = ["EMPTY", "NOT_EMPTY"];
    return predicateResults.some((result) => {
      if (result.passed) return false;
      const predDef = axiom.predicates.find(
        (p) => p.description === result.predicate.description || p.leftRole === result.predicate.leftRole && p.operator === result.predicate.operator
      );
      return predDef !== void 0 && definitiveOperators.includes(predDef.operator);
    });
  }
  /**
   * Compute string similarity using Jaccard index on words.
   * Returns a value between 0 (no similarity) and 1 (identical).
   */
  computeStringSimilarity(a, b) {
    const aWords = new Set(
      a.toLowerCase().split(/\W+/).filter((w) => w.length > 2)
    );
    const bWords = new Set(
      b.toLowerCase().split(/\W+/).filter((w) => w.length > 2)
    );
    const aWordsArray = Array.from(aWords);
    const bWordsArray = Array.from(bWords);
    const intersection = new Set(aWordsArray.filter((w) => bWords.has(w)));
    const union = new Set(aWordsArray.concat(bWordsArray));
    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }
  /**
   * Generate human-readable explanation of the validation result.
   */
  generateExplanation(axiom, results, passed) {
    if (passed) {
      return `${axiom.name}: All predicates satisfied.`;
    }
    const failures = results.filter((r) => !r.passed);
    const reasons = failures.map((f) => f.failureReason || f.predicate.description || "Unknown failure").join("; ");
    return `${axiom.name} VIOLATED: ${reasons}`;
  }
};
var gavelInstance = null;
function getValidationGavel() {
  if (!gavelInstance) {
    gavelInstance = new ValidationGavel();
  }
  return gavelInstance;
}

// packages/verify/src/verdict/from-report.ts
function round4(x) {
  return Math.round(x * 1e4) / 1e4;
}
function toValue(v) {
  if (v === void 0 || v === null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(String);
  return v;
}
function evidenceFrom(p) {
  if (!p) return null;
  const value = toValue(p.value);
  const original = p.originalValue === void 0 ? void 0 : toValue(p.originalValue);
  const role = p.source === "computed" ? "CONTEXT" : p.source === "contract" || p.source === "evidence" || p.source === "history" ? "REFERENCE" : "OPERAND";
  const e = {
    locator: { kind: "field", source: p.source, path: p.fieldPath },
    value,
    confidence: p.confidence,
    role
  };
  if (original !== void 0 && original !== value) e.original = original;
  if (p.normalizations && p.normalizations.length > 0) e.normalizations = p.normalizations;
  return e;
}
function evidenceFromBinding(role, b) {
  const p = {
    role,
    value: b.value,
    source: b.source,
    fieldPath: b.field,
    confidence: b.confidence,
    originalValue: b.originalValue,
    normalizedValue: b.normalizedValue,
    normalizations: b.normalizations
  };
  return evidenceFrom(p);
}
function evidenceKey(e) {
  return e.locator.kind === "field" ? `${e.locator.source}:${e.locator.path}` : `span:${e.locator.source_hash}:${e.locator.start}-${e.locator.end}`;
}
var MIN_VERDICT_CONFIDENCE = 90;
function abstainOnGuessedOperands(claims) {
  for (const c of claims) {
    if (c.outcome === "INSUFFICIENT_DATA") continue;
    const guessed = c.evidence.filter((e) => e.confidence < MIN_VERDICT_CONFIDENCE);
    if (guessed.length === 0) continue;
    const where = guessed.map((g) => `${g.locator.kind === "field" ? `${g.locator.source}:${g.locator.path}` : "span"} (confidence ${g.confidence})`).join("; ");
    c.outcome = "INSUFFICIENT_DATA";
    c.locked = false;
    delete c.computation;
    delete c.variance;
    c.insufficiency = {
      reason: "AMBIGUOUS_FIELD",
      detail: `${where} \u2014 a required field was located only by fuzzy name-matching; verdicts are never issued on guessed fields. Supply it under a recognized field name.`
    };
    c.explanation = `Abstained: ${c.explanation}`;
  }
}
function isUncomparable(pr) {
  const r = pr.failureReason ?? "";
  return /^Type mismatch/.test(r) || /is missing$/.test(r) || /must be array/.test(r) || /requires string values/.test(r) || /^Unknown operator/.test(r);
}
function toClaimVerdicts(results, ctx, opts) {
  return results.map((r) => toClaim(r, ctx, opts));
}
function toClaim(r, ctx, opts) {
  const code = r.axiomCode;
  const axiom = opts.registry.getByCode(code);
  const kind = opts.kindByCode[code] ?? "CONSISTENCY";
  const tier = "DETERMINISTIC";
  const claim_id = `${opts.claimPrefix}.${code}`;
  const rule_id = code;
  const rule_name = axiom?.name ?? code;
  const formula = axiom?.formalForm ?? code;
  const field = opts.fieldByCode[code] ?? code.toLowerCase();
  const evidence = [];
  const seen = /* @__PURE__ */ new Set();
  for (const pr of r.predicateResults) {
    for (const p of [pr.leftProvenance, pr.rightProvenance]) {
      const e = evidenceFrom(p);
      if (!e) continue;
      const key = evidenceKey(e);
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push(e);
    }
  }
  const first = r.predicateResults[0];
  let asserted = null;
  if (first) asserted = toValue(first.leftValue);
  else {
    const role = axiom?.requiredRoles[0];
    if (role) asserted = toValue(ctx.bindings[role]?.value);
  }
  if (r.verdict === "INSUFFICIENT_DATA") {
    return {
      claim_id,
      kind,
      tier,
      outcome: "INSUFFICIENT_DATA",
      field,
      asserted,
      rule_id,
      rule_name,
      evidence,
      insufficiency: insufficiencyFor(r.missingRoles ?? [], opts, r.extractionHint),
      locked: false,
      explanation: r.explanation
    };
  }
  const failed = r.predicateResults.filter((p) => !p.passed);
  if (r.verdict === "FAIL" && failed.length > 0 && failed.every(isUncomparable)) {
    return {
      claim_id,
      kind,
      tier,
      outcome: "INSUFFICIENT_DATA",
      field,
      asserted,
      rule_id,
      rule_name,
      evidence,
      insufficiency: {
        reason: "UNPARSEABLE",
        detail: failed.map((p) => p.failureReason ?? "operands could not be compared").join("; ")
      },
      locked: false,
      explanation: r.explanation
    };
  }
  const operands = {};
  for (const pr of r.predicateResults) {
    operands[pr.predicate.leftRole] = toValue(pr.leftValue);
    if (pr.predicate.rightRole) operands[pr.predicate.rightRole] = toValue(pr.rightValue);
    else if (pr.predicate.constant !== void 0) operands["constant"] = pr.predicate.constant;
  }
  const tolerance = first?.predicate.tolerance;
  const claim = {
    claim_id,
    kind,
    tier,
    outcome: r.verdict,
    field,
    asserted,
    rule_id,
    rule_name,
    computation: {
      formula,
      operands,
      result: first ? toValue(first.rightValue) : null,
      ...tolerance !== void 0 ? { tolerance: { abs: tolerance } } : {}
    },
    evidence,
    locked: r.isLocked,
    explanation: r.explanation
  };
  if (r.variance !== void 0) {
    const only = r.predicateResults.length === 1 ? r.predicateResults[0] : void 0;
    const sign = only && typeof only.variance === "number" && only.variance < 0 ? -1 : 1;
    claim.variance = round4(sign * Math.abs(r.variance));
  }
  return claim;
}
function insufficiencyFor(missing, opts, hint) {
  if (missing.length === 0) {
    return { reason: "OUT_OF_RULESET_SCOPE", detail: hint ?? "rule could not be evaluated" };
  }
  const { contract, evidence, history } = opts.referenceRoles;
  const allContract = missing.every((m) => contract.includes(m));
  const allEvidence = missing.every((m) => evidence.includes(m));
  const allHistory = missing.every((m) => history.includes(m));
  if (allContract && !opts.refs.contract) {
    return { reason: "REFERENCE_NOT_PROVIDED", detail: `No contract/PO reference supplied; this check needs ${missing.join(", ")}`, missing };
  }
  if (allEvidence && !opts.refs.evidence) {
    return { reason: "REFERENCE_NOT_PROVIDED", detail: `No evidence reference supplied; this check needs ${missing.join(", ")}`, missing };
  }
  if (allHistory && !opts.refs.history) {
    return { reason: "REFERENCE_NOT_PROVIDED", detail: `No previous document supplied as history; this check needs ${missing.join(", ")}`, missing };
  }
  for (const m of missing) {
    const a = opts.absence[m];
    if (a !== void 0 && typeof a !== "string") return { reason: a.reason, detail: a.detail, missing };
  }
  const notes = missing.map((m) => [m, opts.absence[m]]).filter((x) => typeof x[1] === "string" && x[1].length > 0).map(([m, why]) => `${m}: ${why}`);
  const parts = [notes.join("; "), hint].filter((s) => Boolean(s));
  const detail = parts.length > 0 ? parts.join(" \u2014 ") : `missing ${missing.join(", ")}`;
  return { reason: "FIELD_MISSING", detail, missing };
}

// packages/verify/src/dedup.ts
var REVISION_TOKEN = /^(?:REV(?:ISED)?\d*|CORRECTED|AMENDED|COPY|DUPLICATE|DUP|REISSUED?|FINAL|[A-Z])$/;
function segments(raw) {
  return raw.toUpperCase().split(/[^A-Z0-9]+/).filter((s) => s.length > 0).map((s) => /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, "") : s);
}
function tightId(raw) {
  return segments(raw).join("|");
}
function baseId(raw) {
  const segs = segments(raw);
  if (segs.length >= 2 && REVISION_TOKEN.test(segs[segs.length - 1])) return segs.slice(0, -1).join("|");
  return segs.join("|");
}
function classifyDuplicates(currentRaw, priors) {
  const exact = [];
  const near = [];
  const curTight = tightId(currentRaw);
  const curBase = baseId(currentRaw);
  for (const p of priors) {
    if (typeof p !== "string" || p.length === 0) continue;
    if (p === currentRaw) {
      exact.push(p);
      continue;
    }
    if (tightId(p) === curTight) {
      near.push({ id: p, kind: "formatting" });
      continue;
    }
    if (baseId(p) === curBase) near.push({ id: p, kind: "revision" });
  }
  near.sort((a, b) => a.kind === b.kind ? 0 : a.kind === "formatting" ? -1 : 1);
  return { exact, near };
}
function priorsOf(b) {
  if (!b) return [];
  const v = b.value;
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}
function duplicateClaims(docId, priorBinding) {
  const base = {
    kind: "CONSISTENCY",
    tier: "DETERMINISTIC",
    field: "invoice_number"
  };
  const idEvidence = docId ? [evidenceFromBinding("DOCUMENT_ID", docId)] : [];
  const priorEvidence = priorBinding ? [evidenceFromBinding("PRIOR_CLAIM_IDS", priorBinding)] : [];
  if (!docId || typeof docId.value !== "string") {
    return [{
      ...base,
      claim_id: "document.DUP_PROHIB",
      outcome: "INSUFFICIENT_DATA",
      asserted: null,
      rule_id: "DUP_PROHIB",
      rule_name: "Law of Duplicate Prohibition",
      evidence: [],
      insufficiency: { reason: "FIELD_MISSING", detail: "no invoice number on the extraction; cannot check for duplicates", missing: ["DOCUMENT_ID"] },
      locked: false,
      explanation: "No invoice number to compare against prior invoices."
    }];
  }
  const currentRaw = String(docId.originalValue ?? docId.value);
  if (!priorBinding || !Array.isArray(priorBinding.value)) {
    return [{
      ...base,
      claim_id: "document.DUP_PROHIB",
      outcome: "INSUFFICIENT_DATA",
      asserted: docId.value,
      rule_id: "DUP_PROHIB",
      rule_name: "Law of Duplicate Prohibition",
      evidence: [],
      insufficiency: { reason: "FIELD_MISSING", detail: "no prior_invoice_ids supplied; supply the prior invoice-number history to check for duplicates", missing: ["PRIOR_CLAIM_IDS"] },
      locked: false,
      explanation: "No prior invoice history supplied."
    }];
  }
  const priors = priorsOf(priorBinding);
  const { exact, near } = classifyDuplicates(currentRaw, priors);
  const claims = [];
  claims.push(exact.length > 0 ? {
    ...base,
    claim_id: "document.DUP_PROHIB",
    outcome: "FAIL",
    asserted: docId.value,
    rule_id: "DUP_PROHIB",
    rule_name: "Law of Duplicate Prohibition",
    computation: { formula: "invoice_number \u2209 prior_invoice_ids", operands: { DOCUMENT_ID: docId.value, matched: exact }, result: false },
    evidence: [...idEvidence, ...priorEvidence],
    locked: true,
    explanation: `This invoice number was already processed (exact match: ${exact.join(", ")}). Paying it again is a duplicate.`
  } : {
    ...base,
    claim_id: "document.DUP_PROHIB",
    outcome: "PASS",
    asserted: docId.value,
    rule_id: "DUP_PROHIB",
    rule_name: "Law of Duplicate Prohibition",
    computation: { formula: "invoice_number \u2209 prior_invoice_ids", operands: { DOCUMENT_ID: docId.value }, result: true },
    evidence: [...idEvidence, ...priorEvidence],
    locked: false,
    explanation: "No prior invoice carries this exact number."
  });
  claims.push(near.length > 0 ? {
    ...base,
    claim_id: "document.DUP_NEAR",
    outcome: "FAIL",
    asserted: docId.value,
    rule_id: "DUP_NEAR",
    rule_name: "Law of Near-Duplicate Prohibition",
    computation: { formula: "normalize(invoice_number) \u2209 normalize(prior_invoice_ids)", operands: { DOCUMENT_ID: docId.value, matched: near.map((n) => `${n.id} (${n.kind})`) }, result: false },
    evidence: [...idEvidence, ...priorEvidence],
    locked: false,
    explanation: near[0].kind === "formatting" ? `A prior invoice number normalizes to the same value (${near.map((n) => n.id).join(", ")}) \u2014 same number, different formatting. Almost certainly a duplicate; do not pay until cleared.` : `A prior invoice number shares this base with a revision suffix (${near.map((n) => n.id).join(", ")}). This may be a legitimate re-issue with a corrected amount \u2014 a human should confirm before payment.`
  } : {
    ...base,
    claim_id: "document.DUP_NEAR",
    outcome: "PASS",
    asserted: docId.value,
    rule_id: "DUP_NEAR",
    rule_name: "Law of Near-Duplicate Prohibition",
    computation: { formula: "normalize(invoice_number) \u2209 normalize(prior_invoice_ids)", operands: { DOCUMENT_ID: docId.value }, result: true },
    evidence: [...idEvidence, ...priorEvidence],
    locked: false,
    explanation: "No prior invoice number normalizes to this one (no formatting or revision-suffix collision)."
  });
  return claims;
}

// packages/verify/src/version.ts
var ENGINE_VERSION = "0.0.1";
var RULESET = {
  id: "invoice",
  version: "0.0.1",
  domain: "invoice"
};
var PAY_APP_RULESET_REF = {
  id: "pay-app",
  version: "0.0.1",
  domain: "pay-app"
};
var SCHEMA_VERSION = "v0";

// packages/verify/src/rulesets/invoice/axioms.ts
var CURRENCY_TOLERANCE = 0.01;
var SUM_INTEGRITY = {
  id: "ax-inv-sum-int",
  shortCode: "SUM_INT",
  name: "Law of Footing",
  axiomStatement: "The line item amounts must sum to the stated subtotal",
  formalForm: "\u03A3 line_items[i].amount = subtotal",
  predicates: [
    {
      leftRole: "LINE_ITEMS_SUM",
      operator: "=",
      rightRole: "SUBTOTAL",
      tolerance: CURRENCY_TOLERANCE,
      description: "Sum of line item amounts must equal the stated subtotal"
    }
  ],
  requiredRoles: ["LINE_ITEMS_SUM", "SUBTOTAL"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: ["invoice"]
};
var TOTAL_INTEGRITY = {
  id: "ax-inv-total-int",
  shortCode: "TOTAL_INT",
  name: "Law of the Bottom Line",
  axiomStatement: "The stated grand total must equal subtotal plus tax minus discount",
  formalForm: "grand_total = subtotal + tax \u2212 discount",
  predicates: [
    {
      leftRole: "GRAND_TOTAL",
      operator: "=",
      rightRole: "EXPECTED_GRAND_TOTAL",
      tolerance: CURRENCY_TOLERANCE,
      description: "Stated grand total must equal the computed subtotal + tax \u2212 discount"
    }
  ],
  requiredRoles: ["GRAND_TOTAL", "EXPECTED_GRAND_TOTAL"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "critical",
  applicableDomains: ["invoice"]
};
var TAX_INTEGRITY = {
  id: "ax-inv-tax-int",
  shortCode: "TAX_INT",
  name: "Law of the Levy",
  axiomStatement: "The stated tax amount must equal the subtotal multiplied by the stated tax rate",
  formalForm: "tax = subtotal \xD7 tax_rate",
  predicates: [
    {
      leftRole: "TAX_AMOUNT",
      operator: "=",
      rightRole: "EXPECTED_TAX_AMOUNT",
      tolerance: CURRENCY_TOLERANCE,
      description: "Stated tax must equal subtotal \xD7 rate within one cent"
    }
  ],
  requiredRoles: ["TAX_AMOUNT", "EXPECTED_TAX_AMOUNT"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: ["invoice"]
};
var INVOICE_AXIOMS = [
  SUM_INTEGRITY,
  TOTAL_INTEGRITY,
  TAX_INTEGRITY
];

// packages/verify/src/rulesets/invoice/ontology.ts
var D = "invoice";
var LINE_ITEM_MAPPINGS = [
  {
    domain: D,
    role: "RATE_APPLIED",
    documentType: "invoice",
    priority: 100,
    fieldPath: "line_items[*].unit_price",
    alternativePaths: [
      "line_items[*].rate",
      "line_items[*].price",
      "line_items[*].unit_rate",
      "line_items[*].unit_cost",
      "line_items[*].hourly_rate",
      "line_items[*].price_per_unit",
      "items[*].unit_price",
      "items[*].rate",
      "items[*].price",
      "lines[*].unit_price",
      "lines[*].rate"
    ],
    fieldAliases: ["unit_price", "rate", "price", "unit_rate", "unit_cost"]
  },
  {
    domain: D,
    role: "CLAIMED_QUANTITY",
    documentType: "invoice",
    priority: 100,
    fieldPath: "line_items[*].quantity",
    alternativePaths: [
      "line_items[*].qty",
      "line_items[*].units",
      "line_items[*].hours",
      "line_items[*].count",
      "items[*].quantity",
      "items[*].qty",
      "lines[*].quantity",
      "lines[*].qty"
    ],
    fieldAliases: ["quantity", "qty", "units", "hours"]
  },
  {
    domain: D,
    role: "CLAIMED_AMOUNT",
    documentType: "invoice",
    priority: 100,
    fieldPath: "line_items[*].amount",
    alternativePaths: [
      "line_items[*].total",
      "line_items[*].line_total",
      "line_items[*].extended_amount",
      "line_items[*].extended_price",
      "line_items[*].subtotal",
      "line_items[*].net_amount",
      "items[*].amount",
      "items[*].total",
      "items[*].line_total",
      "lines[*].amount",
      "lines[*].total"
    ],
    fieldAliases: ["amount", "total", "line_total", "extended_amount"]
  },
  {
    domain: D,
    role: "INVOICE_DESCRIPTION",
    documentType: "invoice",
    priority: 100,
    fieldPath: "line_items[*].description",
    alternativePaths: [
      "line_items[*].item",
      "line_items[*].service",
      "line_items[*].name",
      "line_items[*].product",
      "items[*].description",
      "items[*].name",
      "lines[*].description"
    ],
    fieldAliases: ["description", "item", "service", "name", "product"]
  }
];
var DOCUMENT_MAPPINGS = [
  {
    domain: D,
    role: "SUBTOTAL",
    documentType: "invoice",
    priority: 100,
    fuzzyMatch: false,
    fieldPath: "totals.subtotal",
    alternativePaths: [
      "subtotal",
      "sub_total",
      "totals.sub_total",
      "totals.net",
      "totals.net_amount",
      "amounts.subtotal",
      "summary.subtotal",
      "net_amount",
      "subtotal_amount"
    ],
    fieldAliases: ["subtotal", "sub_total", "net_amount"]
  },
  {
    domain: D,
    role: "TAX_AMOUNT",
    documentType: "invoice",
    priority: 100,
    fuzzyMatch: false,
    fieldPath: "totals.tax",
    alternativePaths: [
      "tax",
      "tax_amount",
      "totals.tax_amount",
      "totals.tax_total",
      "tax_total",
      "sales_tax",
      "totals.sales_tax",
      "vat",
      "vat_amount",
      "totals.vat",
      "totals.vat_amount",
      "taxes.total",
      "amounts.tax",
      "summary.tax"
    ],
    fieldAliases: ["tax", "tax_amount", "sales_tax", "vat", "vat_amount"]
  },
  {
    domain: D,
    role: "TAX_RATE",
    documentType: "invoice",
    priority: 100,
    fuzzyMatch: false,
    fieldPath: "totals.tax_rate",
    alternativePaths: [
      "tax_rate",
      "vat_rate",
      "sales_tax_rate",
      "tax_percent",
      "tax_percentage",
      "tax.rate",
      "taxes.rate",
      "amounts.tax_rate",
      "summary.tax_rate"
    ],
    fieldAliases: ["tax_rate", "vat_rate", "tax_percent"]
  },
  {
    domain: D,
    role: "DISCOUNT_AMOUNT",
    documentType: "invoice",
    priority: 100,
    fuzzyMatch: false,
    fieldPath: "totals.discount",
    alternativePaths: [
      "discount",
      "discount_amount",
      "totals.discount_amount",
      "discounts.total",
      "amounts.discount",
      "summary.discount",
      "total_discount",
      "sub_total.discount_price"
    ],
    fieldAliases: ["discount", "discount_amount"]
  },
  {
    // Real receipts add a service charge / gratuity between subtotal and total (CORD `service_price`).
    domain: D,
    role: "SERVICE_CHARGE",
    documentType: "invoice",
    priority: 100,
    fuzzyMatch: false,
    fieldPath: "totals.service_charge",
    alternativePaths: [
      "service_charge",
      "service",
      "svc",
      "gratuity",
      "totals.service",
      "totals.service_price",
      "amounts.service_charge",
      "summary.service_charge",
      "sub_total.service_price",
      "service_price"
    ],
    fieldAliases: ["service_charge", "service", "gratuity"]
  },
  {
    domain: D,
    role: "GRAND_TOTAL",
    documentType: "invoice",
    priority: 100,
    fuzzyMatch: false,
    fieldPath: "totals.total",
    alternativePaths: [
      "total",
      "grand_total",
      "totals.grand_total",
      "total_amount",
      "totals.total_amount",
      "amount_due",
      "totals.amount_due",
      "balance_due",
      "totals.balance_due",
      "invoice_total",
      "total_due",
      "amounts.total",
      "summary.total"
    ],
    fieldAliases: ["total", "grand_total", "total_amount", "amount_due", "balance_due", "invoice_total"]
  },
  {
    domain: D,
    role: "DOCUMENT_ID",
    documentType: "invoice",
    priority: 100,
    fieldPath: "invoice_number",
    alternativePaths: [
      "document_number",
      "invoice_id",
      "invoice_no",
      "number",
      "id",
      "reference",
      "reference_number",
      "header.invoice_number",
      "metadata.invoice_number"
    ],
    fieldAliases: ["invoice_number", "document_number", "invoice_no", "reference"]
  },
  {
    // The bridge special-cases EVENT_DATE via extractDateValue() (prefers service_date over invoice_date).
    domain: D,
    role: "EVENT_DATE",
    documentType: "invoice",
    priority: 90,
    fieldPath: "dates[*].value",
    alternativePaths: ["dates[*].date", "service_date", "invoice_date", "issue_date", "date", "header.invoice_date"]
  },
  {
    // Strings only; fuzzy search disabled so an unrelated string can never be mistaken for a currency.
    domain: D,
    role: "CURRENCY_CODE",
    documentType: "invoice",
    priority: 100,
    fuzzyMatch: false,
    fieldPath: "currency",
    alternativePaths: ["currency_code", "totals.currency", "amounts.currency", "header.currency", "metadata.currency"]
  },
  {
    // Supplied by the caller (their AP system knows prior invoices); an array. Required by DUP_PROHIB.
    domain: D,
    role: "PRIOR_CLAIM_IDS",
    documentType: "invoice",
    priority: 100,
    fuzzyMatch: false,
    fieldPath: "prior_invoice_ids",
    alternativePaths: ["prior_claim_ids", "duplicate_candidates", "related_invoice_ids", "prior_invoices"]
  }
];
var CONTRACT_MAPPINGS = [
  {
    domain: D,
    role: "RATE_CONTRACTED",
    documentType: "contract",
    priority: 100,
    fieldPath: "rates[*].rate",
    alternativePaths: [
      "financial_rules[*].values.rate",
      "financial_rules[*].rate",
      "price_list[*].unit_price",
      "line_items[*].unit_price",
      "line_items[*].rate",
      "contracted_rate",
      "unit_price",
      "rate",
      "hourly_rate"
    ],
    fieldAliases: ["rate", "unit_price", "contracted_rate", "hourly_rate"]
  },
  {
    domain: D,
    role: "CONTRACTED_LIMIT",
    documentType: "contract",
    priority: 100,
    fieldPath: "max_amount",
    alternativePaths: [
      "financial_rules[*].values.max_amount",
      "financial_rules[*].values.cap",
      "limits.max",
      "not_to_exceed",
      "nte",
      "cap",
      "po_total",
      "purchase_order.total",
      "totals.total",
      "total",
      "amount"
    ],
    fieldAliases: ["max_amount", "cap", "limit", "not_to_exceed", "po_total"]
  },
  {
    domain: D,
    role: "CONTRACT_START",
    documentType: "contract",
    priority: 100,
    fieldPath: "effective_date",
    alternativePaths: ["start_date", "contract_start", "key_terms.effective_date", "period.start", "valid_from", "po_date"]
  },
  {
    domain: D,
    role: "CONTRACT_END",
    documentType: "contract",
    priority: 100,
    fieldPath: "expiration_date",
    alternativePaths: ["end_date", "contract_end", "key_terms.expiration_date", "termination_date", "period.end", "valid_to"]
  }
];
var EVIDENCE_MAPPINGS = [
  {
    domain: D,
    role: "ACTUAL_QUANTITY",
    documentType: "evidence",
    priority: 100,
    fieldPath: "line_items[*].quantity",
    alternativePaths: [
      "line_items[*].qty",
      "line_items[*].units",
      "line_items[*].hours",
      "quantity",
      "qty",
      "received_quantity",
      "delivered_quantity",
      "totals.quantity",
      "totals.total_quantity",
      "totals.hours"
    ],
    fieldAliases: ["quantity", "qty", "units", "hours", "received_quantity", "delivered_quantity"]
  },
  {
    domain: D,
    role: "VERIFIED_AMOUNT",
    documentType: "evidence",
    priority: 100,
    fieldPath: "totals.total",
    alternativePaths: ["amount", "total", "verified_amount", "receipt_total", "totals.amount"]
  },
  {
    domain: D,
    role: "EVENT_DATE",
    documentType: "evidence",
    priority: 100,
    fieldPath: "dates[*].date",
    alternativePaths: ["dates[*].value", "date", "service_date", "delivery_date", "received_date", "ticket_date"]
  },
  {
    domain: D,
    role: "EVIDENCE_DESCRIPTION",
    documentType: "evidence",
    priority: 100,
    fieldPath: "line_items[*].description",
    alternativePaths: ["description", "item", "service", "line_items[*].item", "line_items[*].service"],
    fieldAliases: ["description", "item", "service"]
  }
];
var I18N = {
  // European (Romance / Germanic / Dutch)
  SUBTOTAL: [
    "subtotal",
    "base_imponible",
    "sous_total",
    "soustotal",
    "zwischensumme",
    "subtotale",
    "subtotaal",
    // CJK / Cyrillic / Arabic
    "\u5C0F\u8BA1",
    "\u5C0F\u8A08",
    "\uC18C\uACC4",
    "\u043F\u043E\u0434\u044B\u0442\u043E\u0433",
    "\u0441\u0443\u043C\u043C\u0430_\u0431\u0435\u0437_\u043D\u0430\u043B\u043E\u0433\u0430"
  ],
  TAX_AMOUNT: [
    "impuesto",
    "iva",
    "tva",
    "mwst",
    "steuer",
    "umsatzsteuer",
    "imposta",
    "imposto",
    "btw",
    "\u7A0E",
    "\u7A0E\u989D",
    "\u7A0E\u984D",
    "\u6D88\u8CBB\u7A0E",
    "\uC138\uAE08",
    "\u043D\u0430\u043B\u043E\u0433",
    "\u043D\u0434\u0441",
    "\u0627\u0644\u0636\u0631\u064A\u0628\u0629"
  ],
  TAX_RATE: [
    "tipo_iva",
    "tasa_iva",
    "taux_tva",
    "steuersatz",
    "aliquota_iva",
    "taxa_iva",
    "\u7A0E\u7387",
    "\uC138\uC728",
    "\u0441\u0442\u0430\u0432\u043A\u0430_\u043D\u0430\u043B\u043E\u0433\u0430"
  ],
  DISCOUNT_AMOUNT: [
    "descuento",
    "remise",
    "rabais",
    "rabatt",
    "nachlass",
    "sconto",
    "desconto",
    "korting",
    "\u6298\u6263",
    "\u5272\u5F15",
    "\uD560\uC778",
    "\u0441\u043A\u0438\u0434\u043A\u0430",
    "\u0627\u0644\u062E\u0635\u0645"
  ],
  SERVICE_CHARGE: ["servicio", "cargo_por_servicio", "servizio", "bedienung", "taxe_de_service", "\u670D\u52A1\u8D39", "\u30B5\u30FC\u30D3\u30B9\u6599"],
  GRAND_TOTAL: [
    "total",
    "total_factura",
    "importe_total",
    "montant_total",
    "gesamtbetrag",
    "gesamt",
    "endbetrag",
    "totale",
    "totaal",
    "valor_total",
    "\u5408\u8BA1",
    "\u603B\u8BA1",
    "\u5408\u8A08",
    "\uD569\uACC4",
    "\uCD1D\uACC4",
    "\u0438\u0442\u043E\u0433\u043E",
    "\u0432\u0441\u0435\u0433\u043E",
    "\u0627\u0644\u0645\u062C\u0645\u0648\u0639",
    "\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A"
  ],
  CURRENCY_CODE: ["moneda", "devise", "waehrung", "valuta", "moeda", "\u8D27\u5E01", "\u901A\u8CA8", "\u0432\u0430\u043B\u044E\u0442\u0430", "\u0627\u0644\u0639\u0645\u0644\u0629"],
  RATE_APPLIED: [
    "precio_unitario",
    "precio",
    "prix_unitaire",
    "prix",
    "einzelpreis",
    "preis",
    "prezzo_unitario",
    "prezzo",
    "preco",
    "\u5355\u4EF7",
    "\u5358\u4FA1",
    "\uB2E8\uAC00",
    "\u0446\u0435\u043D\u0430",
    "\u0633\u0639\u0631_\u0627\u0644\u0648\u062D\u062F\u0629"
  ],
  CLAIMED_QUANTITY: [
    "cantidad",
    "quantite",
    "menge",
    "anzahl",
    "quantita",
    "quantidade",
    "\u6570\u91CF",
    "\uC218\uB7C9",
    "\u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E",
    "\u0627\u0644\u0643\u0645\u064A\u0629"
  ],
  CLAIMED_AMOUNT: [
    "importe",
    "montant",
    "betrag",
    "importo",
    "valor",
    "gesamtpreis",
    "\u91D1\u989D",
    "\u91D1\u984D",
    "\uAE08\uC561",
    "\u0441\u0443\u043C\u043C\u0430",
    "\u0627\u0644\u0645\u0628\u0644\u063A"
  ],
  INVOICE_DESCRIPTION: [
    "descripcion",
    "concepto",
    "designation",
    "beschreibung",
    "bezeichnung",
    "descrizione",
    "descricao",
    "articulo",
    "artikel",
    "\u63CF\u8FF0",
    "\u6458\u8981",
    "\u54C1\u540D",
    "\uB0B4\uC5ED",
    "\u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435",
    "\u0627\u0644\u0648\u0635\u0641"
  ]
};
var TRADE_I18N = {
  SUBTOTAL: ["ara_toplam", "delsumma", "jumlah", "subtotal_harga"],
  TAX_AMOUNT: ["kdv", "vergi", "moms", "skatt", "pajak", "ppn"],
  TAX_RATE: ["kdv_orani", "momssats", "tarif_pajak"],
  DISCOUNT_AMOUNT: ["indirim", "rabatt", "diskon", "potongan"],
  GRAND_TOTAL: ["genel_toplam", "toplam", "totalt", "summa", "total_harga", "jumlah_total"],
  CURRENCY_CODE: ["para_birimi", "valuta_kod", "mata_uang"],
  RATE_APPLIED: ["birim_fiyat", "styckpris", "harga_satuan", "harga"],
  CLAIMED_QUANTITY: ["miktar", "adet", "antal", "kuantitas", "jumlah_barang"],
  CLAIMED_AMOUNT: ["tutar", "belopp", "nilai", "jumlah_harga"],
  INVOICE_DESCRIPTION: ["aciklama", "beskrivning", "keterangan", "deskripsi"]
};
{
  const lineRoles = new Set(LINE_ITEM_MAPPINGS);
  for (const m of [...LINE_ITEM_MAPPINGS, ...DOCUMENT_MAPPINGS]) {
    const extra = [...I18N[m.role] ?? [], ...TRADE_I18N[m.role] ?? []];
    if (extra.length === 0) continue;
    const alt = m.alternativePaths ??= [];
    for (const a of extra) {
      const forms = lineRoles.has(m) ? [`line_items[*].${a}`, `items[*].${a}`, `lines[*].${a}`] : [a, `totals.${a}`];
      for (const f of forms) if (!alt.includes(f)) alt.push(f);
    }
  }
}
var INVOICE_ONTOLOGY = {
  domainId: D,
  domainName: "Commercial Invoice (generic)",
  mappings: [
    ...LINE_ITEM_MAPPINGS,
    ...DOCUMENT_MAPPINGS,
    ...CONTRACT_MAPPINGS,
    ...EVIDENCE_MAPPINGS
  ]
};

// packages/verify/src/rulesets/types.ts
function computed(value, formula, operands) {
  return { value, source: "computed", field: formula, confidence: minConfidence(operands) };
}
function minConfidence(bindings) {
  return bindings.length === 0 ? 0 : Math.min(...bindings.map((b) => b.confidence));
}
function num(b) {
  return b && typeof b.value === "number" && Number.isFinite(b.value) ? b.value : null;
}
function round42(x) {
  return Math.round(x * 1e4) / 1e4;
}

// packages/verify/src/rulesets/invoice/index.ts
function operandEvidence(bindings, roles) {
  const out = [];
  for (const r of roles) {
    const b = bindings[r];
    if (b) out.push(evidenceFromBinding(r, b));
  }
  return out;
}
function compute({ docCtx, lineCtxs, extraction }) {
  const docAbsence = {};
  const lineAbsence = lineCtxs.map(() => ({}));
  const attach = {};
  const lineAmounts = [];
  const lineProblems = [];
  lineCtxs.forEach((ctx, i) => {
    attach[`line[${i}].MATH_INT`] = operandEvidence(ctx.bindings, ["RATE_APPLIED", "CLAIMED_QUANTITY"]);
    const amt = ctx.bindings.CLAIMED_AMOUNT;
    if (amt && num(amt) !== null) lineAmounts.push({ ...amt, field: amt.field.replace("[*]", `[${i}]`) });
    else lineProblems.push(`line_items[${i}]: amount missing or unparseable`);
  });
  const lineCount = Array.isArray(extraction.line_items) ? extraction.line_items.length : 0;
  if (lineCount === 0) docAbsence.LINE_ITEMS_SUM = "no line_items array on the extraction";
  else if (lineProblems.length > 0) docAbsence.LINE_ITEMS_SUM = lineProblems.join("; ");
  else {
    const sum = round42(lineAmounts.reduce((acc, b) => acc + b.value, 0));
    docCtx.bindings.LINE_ITEMS_SUM = computed(sum, `\u03A3(${lineAmounts.map((b) => b.field).join(" + ")})`, lineAmounts);
    attach["document.SUM_INT"] = lineAmounts.map((b) => evidenceFromBinding("CLAIMED_AMOUNT", b));
  }
  const B = docCtx.bindings;
  const subtotal = num(B.SUBTOTAL);
  const tax = num(B.TAX_AMOUNT);
  const discount = num(B.DISCOUNT_AMOUNT);
  const service = num(B.SERVICE_CHARGE);
  if (subtotal === null || !B.SUBTOTAL) {
    docAbsence.EXPECTED_GRAND_TOTAL = "SUBTOTAL not present on the extraction";
  } else {
    const notes = [];
    if (tax === null) notes.push("TAX_AMOUNT absent \u2192 0");
    if (service === null) notes.push("SERVICE_CHARGE absent \u2192 0");
    if (discount === null) notes.push("DISCOUNT_AMOUNT absent \u2192 0");
    const ops = [
      B.SUBTOTAL,
      ...tax !== null && B.TAX_AMOUNT ? [B.TAX_AMOUNT] : [],
      ...service !== null && B.SERVICE_CHARGE ? [B.SERVICE_CHARGE] : [],
      ...discount !== null && B.DISCOUNT_AMOUNT ? [B.DISCOUNT_AMOUNT] : []
    ];
    B.EXPECTED_GRAND_TOTAL = computed(
      round42(subtotal + (tax ?? 0) + (service ?? 0) - Math.abs(discount ?? 0)),
      `SUBTOTAL + TAX_AMOUNT + SERVICE_CHARGE \u2212 |DISCOUNT_AMOUNT|${notes.length ? ` (${notes.join("; ")})` : ""}`,
      ops
    );
  }
  attach["document.TOTAL_INT"] = operandEvidence(B, ["SUBTOTAL", "TAX_AMOUNT", "SERVICE_CHARGE", "DISCOUNT_AMOUNT"]);
  const rate = num(B.TAX_RATE);
  if (subtotal === null || !B.SUBTOTAL) docAbsence.EXPECTED_TAX_AMOUNT = "SUBTOTAL not present on the extraction";
  else if (rate === null || !B.TAX_RATE) docAbsence.EXPECTED_TAX_AMOUNT = "TAX_RATE not present on the extraction";
  else B.EXPECTED_TAX_AMOUNT = computed(round42(subtotal * rate), "SUBTOTAL \xD7 TAX_RATE", [B.SUBTOTAL, B.TAX_RATE]);
  attach["document.TAX_INT"] = operandEvidence(B, ["SUBTOTAL", "TAX_RATE"]);
  const claims = duplicateClaims(B.DOCUMENT_ID, B.PRIOR_CLAIM_IDS);
  return { docAbsence, lineAbsence, attach, claims };
}
var INVOICE_RULESET = {
  ...RULESET,
  name: "Commercial invoice",
  ontology: INVOICE_ONTOLOGY,
  axioms: INVOICE_AXIOMS,
  lineCodes: ["MATH_INT", "RATE_SUP", "AMT_CAP", "QTY_MATCH"],
  // DUP_PROHIB + DUP_NEAR are produced by compute() (self-contained), not the gavel — so they are NOT listed here.
  documentCodes: ["SUM_INT", "TOTAL_INT", "TAX_INT", "TIME_ORD"],
  kindByCode: {
    SUM_INT: "RECOMPUTE",
    TOTAL_INT: "RECOMPUTE",
    TAX_INT: "RECOMPUTE",
    MATH_INT: "RECOMPUTE",
    RATE_SUP: "CROSS_REFERENCE",
    AMT_CAP: "CROSS_REFERENCE",
    TIME_ORD: "CROSS_REFERENCE",
    QTY_MATCH: "CROSS_REFERENCE",
    DUP_PROHIB: "CONSISTENCY"
  },
  fieldByCode: {
    SUM_INT: "subtotal",
    TOTAL_INT: "total",
    TAX_INT: "tax",
    MATH_INT: "amount",
    RATE_SUP: "unit_price",
    AMT_CAP: "amount",
    TIME_ORD: "service_date",
    QTY_MATCH: "quantity",
    DUP_PROHIB: "invoice_number"
  },
  referenceRoles: {
    contract: ["RATE_CONTRACTED", "CONTRACTED_LIMIT", "CONTRACT_START", "CONTRACT_END"],
    evidence: ["ACTUAL_QUANTITY", "VERIFIED_AMOUNT", "EVIDENCE_DESCRIPTION"],
    history: []
  },
  computedRoles: ["LINE_ITEMS_SUM", "EXPECTED_GRAND_TOTAL", "EXPECTED_TAX_AMOUNT", "LINE_ITEM_TOTAL", "EXPECTED_TOTAL"],
  // Practitioner rounding policy: tolerate up to 0.05% of the compared magnitude (over the $0.01 floor) — a penny never false-alarms.
  defaultTolerance: { rel: 3e-4, absCap: 0 },
  // 0.03% band, no cap (see src/tolerance.ts): forgives real rounding across currencies, catches material errors
  ambiguityGuards: [["RATE_SUP", "RATE_CONTRACTED"], ["AMT_CAP", "CONTRACTED_LIMIT"]],
  compute
};

// packages/verify/src/rulesets/pay-app/axioms.ts
var CURRENCY_TOLERANCE2 = 0.01;
var PERCENT_TOLERANCE = 5e-3;
var D2 = ["pay-app"];
function law(code, id, name, statement, formal, left, operator, right, tolerance, severity) {
  return {
    id,
    shortCode: code,
    name,
    axiomStatement: statement,
    formalForm: formal,
    predicates: [{ leftRole: left, operator, rightRole: right, tolerance, description: statement }],
    requiredRoles: right ? [left, right] : [left],
    combinationLogic: "AND",
    detectableBy: "PRECOMPUTE",
    severity,
    applicableDomains: D2
  };
}
var G703_TOTAL = law(
  "G703_TOTAL",
  "ax-payapp-g703-total",
  "Law of the Continuation Sheet",
  "Total completed and stored to date must equal previous work plus this period plus stored materials",
  "G = D + E + F",
  "COMPLETED_TO_DATE",
  "=",
  "EXPECTED_COMPLETED_TO_DATE",
  CURRENCY_TOLERANCE2,
  "high"
);
var G703_BAL = law(
  "G703_BAL",
  "ax-payapp-g703-balance",
  "Law of the Balance to Finish",
  "Balance to finish must equal scheduled value minus total completed and stored",
  "H = C \u2212 G",
  "BALANCE_TO_FINISH",
  "=",
  "EXPECTED_BALANCE_TO_FINISH",
  CURRENCY_TOLERANCE2,
  "medium"
);
var G703_PCT = law(
  "G703_PCT",
  "ax-payapp-g703-percent",
  "Law of the Percentage",
  "Percent complete must equal total completed and stored divided by scheduled value",
  "% = G \xF7 C",
  "PERCENT_COMPLETE",
  "=",
  "EXPECTED_PERCENT_COMPLETE",
  PERCENT_TOLERANCE,
  "low"
);
var G703_CAP = law(
  "G703_CAP",
  "ax-payapp-g703-cap",
  "Law of No Overbilling",
  "Total completed and stored to date may not exceed the scheduled value",
  "G \u2264 C",
  "COMPLETED_TO_DATE",
  "<=",
  "SCHEDULED_VALUE",
  CURRENCY_TOLERANCE2,
  "critical"
);
var G703_PREV = law(
  "G703_PREV",
  "ax-payapp-g703-previous",
  "Law of Continuity",
  "Work completed from previous applications must equal the previous application's total completed and stored for the same item",
  "D = G(previous application)",
  "WORK_PREVIOUS",
  "=",
  "PREVIOUS_COMPLETED_TO_DATE",
  CURRENCY_TOLERANCE2,
  "high"
);
var G702_CSUM = law(
  "G702_CSUM",
  "ax-payapp-g702-contract-sum",
  "Law of the Contract Sum",
  "Contract sum to date must equal the original contract sum plus net change by change orders",
  "line 3 = line 1 + line 2",
  "CONTRACT_SUM_TO_DATE",
  "=",
  "EXPECTED_CONTRACT_SUM_TO_DATE",
  CURRENCY_TOLERANCE2,
  "high"
);
var G702_SOV = law(
  "G702_SOV",
  "ax-payapp-g702-sov",
  "Law of the Schedule of Values",
  "The scheduled values on the continuation sheet must sum to the contract sum to date",
  "line 3 = \u03A3 C",
  "CONTRACT_SUM_TO_DATE",
  "=",
  "SOV_SCHEDULED_SUM",
  CURRENCY_TOLERANCE2,
  "high"
);
var G702_DONE = law(
  "G702_DONE",
  "ax-payapp-g702-completed",
  "Law of the Carried Total",
  "Total completed and stored to date must equal the sum of the continuation sheet's column G",
  "line 4 = \u03A3 G",
  "TOTAL_COMPLETED_STORED",
  "=",
  "SOV_COMPLETED_SUM",
  CURRENCY_TOLERANCE2,
  "critical"
);
var G702_RSUM = law(
  "G702_RSUM",
  "ax-payapp-g702-retainage-sum",
  "Law of Retainage (carried)",
  "Total retainage must equal the sum of line-level retainage",
  "line 5 = \u03A3 I",
  "RETAINAGE_TOTAL",
  "=",
  "SOV_RETAINAGE_SUM",
  CURRENCY_TOLERANCE2,
  "high"
);
var G702_RATE = law(
  "G702_RATE",
  "ax-payapp-g702-retainage-rate",
  "Law of Retainage (rate)",
  "Total retainage must equal the stated retainage percentage of total completed and stored",
  "line 5 = line 4 \xD7 rate",
  "RETAINAGE_TOTAL",
  "=",
  "EXPECTED_RETAINAGE_TOTAL",
  CURRENCY_TOLERANCE2,
  "high"
);
var G702_EARN = law(
  "G702_EARN",
  "ax-payapp-g702-earned",
  "Law of Earnings",
  "Total earned less retainage must equal total completed and stored minus total retainage",
  "line 6 = line 4 \u2212 line 5",
  "TOTAL_EARNED_LESS_RETAINAGE",
  "=",
  "EXPECTED_EARNED_LESS_RETAINAGE",
  CURRENCY_TOLERANCE2,
  "critical"
);
var G702_DUE = law(
  "G702_DUE",
  "ax-payapp-g702-due",
  "Law of the Payment Due",
  "Current payment due must equal total earned less retainage minus previous certificates for payment",
  "line 8 = line 6 \u2212 line 7",
  "CURRENT_PAYMENT_DUE",
  "=",
  "EXPECTED_CURRENT_PAYMENT_DUE",
  CURRENCY_TOLERANCE2,
  "critical"
);
var G702_BAL = law(
  "G702_BAL",
  "ax-payapp-g702-balance",
  "Law of the Balance (including retainage)",
  "Balance to finish including retainage must equal contract sum to date minus total earned less retainage",
  "line 9 = line 3 \u2212 line 6",
  "BALANCE_INCL_RETAINAGE",
  "=",
  "EXPECTED_BALANCE_INCL_RETAINAGE",
  CURRENCY_TOLERANCE2,
  "medium"
);
var G702_PREV = law(
  "G702_PREV",
  "ax-payapp-g702-previous",
  "Law of the Previous Certificate",
  "Previous certificates for payment must equal the previous application's total earned less retainage",
  "line 7 = line 6(previous application)",
  "PREVIOUS_CERTIFICATES",
  "=",
  "PREVIOUS_EARNED_LESS_RETAINAGE",
  CURRENCY_TOLERANCE2,
  "high"
);
var PAY_APP_LINE_AXIOMS = [G703_TOTAL, G703_BAL, G703_PCT, G703_CAP, G703_PREV];
var PAY_APP_DOCUMENT_AXIOMS = [
  G702_CSUM,
  G702_SOV,
  G702_DONE,
  G702_RSUM,
  G702_RATE,
  G702_EARN,
  G702_DUE,
  G702_BAL,
  G702_PREV
];
var PAY_APP_AXIOMS = [...PAY_APP_LINE_AXIOMS, ...PAY_APP_DOCUMENT_AXIOMS];

// packages/verify/src/rulesets/pay-app/ontology.ts
var D3 = "pay-app";
var PAY_APP_LINE_ARRAY_KEYS = ["schedule_of_values", "continuation_sheet", "line_items", "items", "sov"];
function line(role, fields, opts = {}) {
  const paths = [];
  for (const root of PAY_APP_LINE_ARRAY_KEYS) for (const f of fields) paths.push(`${root}[*].${f}`);
  const [fieldPath, ...alternativePaths] = paths;
  return {
    domain: D3,
    role,
    documentType: "invoice",
    priority: 100,
    fieldPath,
    alternativePaths,
    fuzzyMatch: opts.fuzzy ?? false,
    ...opts.aliases ? { fieldAliases: opts.aliases } : {}
  };
}
function doc(role, fields, opts = {}) {
  const roots = ["", "summary.", "g702.", "application.", "totals."];
  const paths = [];
  for (const r of roots) for (const f of fields) paths.push(`${r}${f}`);
  const [fieldPath, ...alternativePaths] = paths;
  return { domain: D3, role, documentType: "invoice", priority: 100, fieldPath, alternativePaths, fuzzyMatch: opts.fuzzy ?? false };
}
var LINE_MAPPINGS = [
  line("SOV_ITEM_ID", ["item_no", "item_number", "item", "line_no", "line_number", "no", "id", "number", "cost_code"]),
  line("SOV_DESCRIPTION", ["description", "description_of_work", "work_description", "name", "scope"], { fuzzy: true, aliases: ["description"] }),
  line("SCHEDULED_VALUE", ["scheduled_value", "scheduled_amount", "contract_value", "sov_value", "value", "budget", "contract_amount", "amount"]),
  line("WORK_PREVIOUS", ["previous", "from_previous_application", "from_previous_applications", "previous_applications", "work_completed_previous", "previously_completed", "completed_previous", "prior", "previous_work"]),
  line("WORK_THIS_PERIOD", ["this_period", "work_completed_this_period", "this_application", "current_period", "current", "this_month", "completed_this_period"]),
  line("MATERIALS_STORED", ["materials_stored", "materials_presently_stored", "stored_materials", "presently_stored", "stored"]),
  line("COMPLETED_TO_DATE", ["completed_to_date", "total_completed_and_stored", "total_completed_and_stored_to_date", "total_completed_stored_to_date", "total_to_date", "completed_and_stored", "total_completed", "total_completed_stored"]),
  line("PERCENT_COMPLETE", ["percent_complete", "percent", "pct_complete", "percentage_complete", "percentage", "complete_pct", "g_over_c", "pct"]),
  line("BALANCE_TO_FINISH", ["balance_to_finish", "balance", "balance_remaining", "remaining", "remaining_balance"]),
  line("LINE_RETAINAGE", ["retainage", "retention", "retainage_amount", "retained", "retainage_held"])
];
var DOCUMENT_MAPPINGS2 = [
  doc("DOCUMENT_ID", ["application_number", "application_no", "pay_app_number", "pay_application_number", "app_no", "invoice_number", "number"]),
  doc("ORIGINAL_CONTRACT_SUM", ["original_contract_sum", "original_contract_amount", "original_contract_value", "base_contract", "base_contract_sum"]),
  doc("NET_CHANGE_ORDERS", ["net_change_orders", "net_change_by_change_orders", "change_orders_net", "net_change", "approved_change_orders", "approved_change_orders_total"]),
  doc("CONTRACT_SUM_TO_DATE", ["contract_sum_to_date", "revised_contract_sum", "current_contract_sum", "adjusted_contract_sum", "contract_sum"]),
  doc("TOTAL_COMPLETED_STORED", ["total_completed_and_stored", "total_completed_and_stored_to_date", "total_completed_stored_to_date", "total_completed_to_date", "work_completed_to_date", "total_completed"]),
  doc("RETAINAGE_RATE", ["retainage_rate", "retainage_percent", "retainage_percentage", "retention_rate", "retainage_pct", "retention_percent"]),
  doc("RETAINAGE_TOTAL", ["total_retainage", "retainage_total", "retainage", "retention_total", "total_retention", "retainage_held"]),
  doc("TOTAL_EARNED_LESS_RETAINAGE", ["total_earned_less_retainage", "earned_less_retainage", "net_earned", "total_earned_less_retention"]),
  doc("PREVIOUS_CERTIFICATES", ["less_previous_certificates", "previous_certificates", "previous_certificates_for_payment", "less_previous_certificates_for_payment", "previous_payments", "previously_paid", "prior_payments", "previously_certified"]),
  doc("CURRENT_PAYMENT_DUE", ["current_payment_due", "payment_due", "amount_due", "this_payment", "current_due", "total_due"]),
  doc("BALANCE_INCL_RETAINAGE", ["balance_to_finish_including_retainage", "balance_to_finish_incl_retainage", "balance_including_retainage", "balance_to_finish", "remaining_balance"]),
  doc("CURRENCY_CODE", ["currency", "currency_code"])
];
var PAY_APP_ROLE_KINDS = {
  SOV_ITEM_ID: "reference",
  SOV_DESCRIPTION: "string",
  SCHEDULED_VALUE: "amount",
  WORK_PREVIOUS: "amount",
  WORK_THIS_PERIOD: "amount",
  MATERIALS_STORED: "amount",
  COMPLETED_TO_DATE: "amount",
  EXPECTED_COMPLETED_TO_DATE: "amount",
  PERCENT_COMPLETE: "rate",
  EXPECTED_PERCENT_COMPLETE: "rate",
  BALANCE_TO_FINISH: "amount",
  EXPECTED_BALANCE_TO_FINISH: "amount",
  LINE_RETAINAGE: "amount",
  PREVIOUS_COMPLETED_TO_DATE: "amount",
  ORIGINAL_CONTRACT_SUM: "amount",
  NET_CHANGE_ORDERS: "amount",
  CONTRACT_SUM_TO_DATE: "amount",
  EXPECTED_CONTRACT_SUM_TO_DATE: "amount",
  TOTAL_COMPLETED_STORED: "amount",
  SOV_SCHEDULED_SUM: "amount",
  SOV_COMPLETED_SUM: "amount",
  RETAINAGE_RATE: "rate",
  RETAINAGE_TOTAL: "amount",
  EXPECTED_RETAINAGE_TOTAL: "amount",
  SOV_RETAINAGE_SUM: "amount",
  TOTAL_EARNED_LESS_RETAINAGE: "amount",
  EXPECTED_EARNED_LESS_RETAINAGE: "amount",
  PREVIOUS_CERTIFICATES: "amount",
  PREVIOUS_EARNED_LESS_RETAINAGE: "amount",
  CURRENT_PAYMENT_DUE: "amount",
  EXPECTED_CURRENT_PAYMENT_DUE: "amount",
  BALANCE_INCL_RETAINAGE: "amount",
  EXPECTED_BALANCE_INCL_RETAINAGE: "amount"
};
var PAY_APP_ONTOLOGY = {
  domainId: D3,
  domainName: "Construction pay application (AIA G702 / G703)",
  mappings: [...LINE_MAPPINGS, ...DOCUMENT_MAPPINGS2],
  roleKinds: PAY_APP_ROLE_KINDS,
  lineArrayKeys: PAY_APP_LINE_ARRAY_KEYS
};

// packages/verify/src/rulesets/pay-app/index.ts
function operandEvidence2(b, roles) {
  const out = [];
  for (const r of roles) if (b[r]) out.push(evidenceFromBinding(r, b[r]));
  return out;
}
function column(lineCtxs, role, lineKey) {
  const values = [];
  const problems = [];
  lineCtxs.forEach((ctx, i) => {
    const b = ctx.bindings[role];
    if (b && num(b) !== null) values.push({ ...b, field: b.field.replace("[*]", `[${i}]`) });
    else problems.push(`${lineKey}[${i}]: ${role} missing or unparseable`);
  });
  return { values, problems };
}
var ITEM_KEYS = ["item_no", "item_number", "item", "line_no", "line_number", "no", "id", "number", "cost_code"];
var COMPLETED_KEYS = ["completed_to_date", "total_completed_and_stored", "total_completed_and_stored_to_date", "total_completed_stored_to_date", "total_to_date", "completed_and_stored", "total_completed", "total_completed_stored"];
var EARNED_KEYS = ["total_earned_less_retainage", "earned_less_retainage", "net_earned", "total_earned_less_retention"];
var APP_NO_KEYS = ["application_number", "application_no", "pay_app_number", "pay_application_number", "app_no", "invoice_number", "number"];
var DOC_ROOTS = ["", "summary.", "g702.", "application.", "totals."];
function get(obj, path) {
  let cur = obj;
  for (const part of path.split(".")) {
    if (part === "") continue;
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return void 0;
    cur = cur[part];
  }
  return cur;
}
function firstKey(obj, keys, roots = [""]) {
  for (const r of roots) for (const k of keys) {
    const v = get(obj, `${r}${k}`);
    if (v !== void 0 && v !== null && v !== "") return { path: `${r}${k}`, value: v };
  }
  return null;
}
function itemIdOf(line2) {
  const hit = firstKey(line2, ITEM_KEYS);
  if (!hit) return null;
  const n = normalizeReference(hit.value);
  return n?.success ? n.normalized : String(hit.value).trim();
}
function lineArrayOf(doc2) {
  for (const k of PAY_APP_LINE_ARRAY_KEYS) {
    const v = doc2[k];
    if (Array.isArray(v)) return { key: k, lines: v.filter((x) => x !== null && typeof x === "object" && !Array.isArray(x)) };
  }
  return null;
}
function appNumber(doc2) {
  const hit = firstKey(doc2, APP_NO_KEYS, DOC_ROOTS);
  if (!hit) return null;
  const m = String(hit.value).match(/(\d+)(?!.*\d)/);
  return m ? Number(m[1]) : null;
}
function previousApplication(history) {
  if (history.length === 0) return "no previous application supplied";
  if (history.length === 1) return { index: 0, doc: history[0] };
  const numbered = history.map((d, i) => ({ i, n: appNumber(d) }));
  if (numbered.some((x) => x.n === null)) {
    return { reason: "AMBIGUOUS_REFERENCE", detail: `${history.length} history documents supplied and not all carry an application number; cannot tell which is the previous application` };
  }
  numbered.sort((a, b) => b.n - a.n);
  const top = numbered[0];
  if (numbered[1] && numbered[1].n === top.n) {
    return { reason: "AMBIGUOUS_REFERENCE", detail: `two history documents share application number ${top.n}` };
  }
  return { index: top.i, doc: history[top.i] };
}
function historyAmount(path, raw) {
  const n = normalizeAmount(raw);
  if (!n?.success) return null;
  return {
    value: n.normalized,
    source: "history",
    field: path,
    confidence: 100,
    originalValue: n.original ?? raw,
    normalizedValue: n.normalized,
    normalizations: n.transformations
  };
}
function compute2({ extraction, references, docCtx, lineCtxs }) {
  const docAbsence = {};
  const lineAbsence = lineCtxs.map(() => ({}));
  const attach = {};
  const arr = lineArrayOf(extraction);
  const lineKey = arr?.key ?? "schedule_of_values";
  const lines = arr?.lines ?? [];
  const prev = previousApplication(references.history);
  const prevDoc = typeof prev === "object" && "doc" in prev ? prev : null;
  const prevAbsence = prevDoc ? "" : prev;
  const prevLines = prevDoc ? lineArrayOf(prevDoc.doc) : null;
  const prevById = /* @__PURE__ */ new Map();
  if (prevDoc && prevLines) {
    prevLines.lines.forEach((l, j) => {
      const id = itemIdOf(l);
      if (id === null) return;
      prevById.set(id, prevById.has(id) ? "duplicate" : { path: `history[${prevDoc.index}].${prevLines.key}[${j}]`, line: l });
    });
  }
  lineCtxs.forEach((ctx, i) => {
    const B2 = ctx.bindings;
    const A = lineAbsence[i];
    const C = num(B2.SCHEDULED_VALUE), Dv = num(B2.WORK_PREVIOUS), E = num(B2.WORK_THIS_PERIOD), F = num(B2.MATERIALS_STORED), G = num(B2.COMPLETED_TO_DATE);
    if (Dv === null && E === null && F === null) {
      A.EXPECTED_COMPLETED_TO_DATE = "none of previous / this period / materials stored is present on the line";
    } else {
      const notes = [];
      if (Dv === null) notes.push("D absent \u2192 0");
      if (E === null) notes.push("E absent \u2192 0");
      if (F === null) notes.push("F absent \u2192 0");
      const ops = [B2.WORK_PREVIOUS, B2.WORK_THIS_PERIOD, B2.MATERIALS_STORED].filter((b) => !!b && num(b) !== null);
      B2.EXPECTED_COMPLETED_TO_DATE = computed(round42((Dv ?? 0) + (E ?? 0) + (F ?? 0)), `D + E + F${notes.length ? ` (${notes.join("; ")})` : ""}`, ops);
    }
    attach[`line[${i}].G703_TOTAL`] = operandEvidence2(B2, ["WORK_PREVIOUS", "WORK_THIS_PERIOD", "MATERIALS_STORED"]);
    if (C === null || !B2.SCHEDULED_VALUE) A.EXPECTED_BALANCE_TO_FINISH = "SCHEDULED_VALUE not present on the line";
    else if (G === null || !B2.COMPLETED_TO_DATE) A.EXPECTED_BALANCE_TO_FINISH = "COMPLETED_TO_DATE not present on the line";
    else B2.EXPECTED_BALANCE_TO_FINISH = computed(round42(C - G), "C \u2212 G", [B2.SCHEDULED_VALUE, B2.COMPLETED_TO_DATE]);
    attach[`line[${i}].G703_BAL`] = operandEvidence2(B2, ["SCHEDULED_VALUE", "COMPLETED_TO_DATE"]);
    if (C === null || !B2.SCHEDULED_VALUE) A.EXPECTED_PERCENT_COMPLETE = "SCHEDULED_VALUE not present on the line";
    else if (C === 0) A.EXPECTED_PERCENT_COMPLETE = "SCHEDULED_VALUE is zero; percent complete is undefined";
    else if (G === null || !B2.COMPLETED_TO_DATE) A.EXPECTED_PERCENT_COMPLETE = "COMPLETED_TO_DATE not present on the line";
    else B2.EXPECTED_PERCENT_COMPLETE = computed(Math.round(G / C * 1e6) / 1e6, "G \xF7 C", [B2.SCHEDULED_VALUE, B2.COMPLETED_TO_DATE]);
    attach[`line[${i}].G703_PCT`] = operandEvidence2(B2, ["SCHEDULED_VALUE", "COMPLETED_TO_DATE"]);
    const pct = B2.PERCENT_COMPLETE;
    if (pct) {
      const raw = pct.originalValue;
      const bare = typeof raw === "number" || typeof raw === "string" && !raw.includes("%");
      const rawNum = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/[^0-9.\-]/g, "")) : NaN;
      if (bare && Number.isFinite(rawNum) && rawNum > 0 && rawNum <= 1) {
        delete B2.PERCENT_COMPLETE;
        A.PERCENT_COMPLETE = { reason: "AMBIGUOUS_UNIT", detail: `${pct.field} = ${String(raw)} \u2014 a bare value in (0, 1] may be a percent or a fraction; send "45%" or 45` };
      }
    }
    if (!prevDoc) {
      A.PREVIOUS_COMPLETED_TO_DATE = prevAbsence;
    } else if (!prevLines) {
      A.PREVIOUS_COMPLETED_TO_DATE = "the previous application has no schedule-of-values array";
    } else {
      const id = lines[i] ? itemIdOf(lines[i]) : null;
      if (id === null) A.PREVIOUS_COMPLETED_TO_DATE = `${lineKey}[${i}] has no item number; lines are matched to the previous application by item number only`;
      else {
        const hit = prevById.get(id);
        if (hit === void 0) A.PREVIOUS_COMPLETED_TO_DATE = `no line in the previous application carries item number ${id}`;
        else if (hit === "duplicate") A.PREVIOUS_COMPLETED_TO_DATE = { reason: "AMBIGUOUS_REFERENCE", detail: `the previous application lists item number ${id} more than once` };
        else {
          const g = firstKey(hit.line, COMPLETED_KEYS);
          const bound = g ? historyAmount(`${hit.path}.${g.path}`, g.value) : null;
          if (!bound) A.PREVIOUS_COMPLETED_TO_DATE = `previous application item ${id} has no completed-to-date amount`;
          else B2.PREVIOUS_COMPLETED_TO_DATE = bound;
        }
      }
    }
  });
  const B = docCtx.bindings;
  const L1 = num(B.ORIGINAL_CONTRACT_SUM), L2 = num(B.NET_CHANGE_ORDERS), L3 = num(B.CONTRACT_SUM_TO_DATE);
  const L4 = num(B.TOTAL_COMPLETED_STORED), L5 = num(B.RETAINAGE_TOTAL), rate = num(B.RETAINAGE_RATE);
  const L6 = num(B.TOTAL_EARNED_LESS_RETAINAGE), L7 = num(B.PREVIOUS_CERTIFICATES);
  if (L1 === null || !B.ORIGINAL_CONTRACT_SUM) docAbsence.EXPECTED_CONTRACT_SUM_TO_DATE = "ORIGINAL_CONTRACT_SUM not present";
  else {
    const ops = [B.ORIGINAL_CONTRACT_SUM, ...L2 !== null && B.NET_CHANGE_ORDERS ? [B.NET_CHANGE_ORDERS] : []];
    B.EXPECTED_CONTRACT_SUM_TO_DATE = computed(round42(L1 + (L2 ?? 0)), `line 1 + line 2${L2 === null ? " (line 2 absent \u2192 0)" : ""}`, ops);
  }
  attach["document.G702_CSUM"] = operandEvidence2(B, ["ORIGINAL_CONTRACT_SUM", "NET_CHANGE_ORDERS"]);
  if (lines.length === 0) {
    docAbsence.SOV_SCHEDULED_SUM = docAbsence.SOV_COMPLETED_SUM = docAbsence.SOV_RETAINAGE_SUM = "no schedule-of-values array on the extraction";
  } else {
    const sc = column(lineCtxs, "SCHEDULED_VALUE", lineKey);
    if (sc.problems.length) docAbsence.SOV_SCHEDULED_SUM = sc.problems.join("; ");
    else {
      B.SOV_SCHEDULED_SUM = computed(round42(sc.values.reduce((a, b) => a + b.value, 0)), `\u03A3(${sc.values.map((b) => b.field).join(" + ")})`, sc.values);
      attach["document.G702_SOV"] = sc.values.map((b) => evidenceFromBinding("SCHEDULED_VALUE", b));
    }
    const gc = column(lineCtxs, "COMPLETED_TO_DATE", lineKey);
    if (gc.problems.length) docAbsence.SOV_COMPLETED_SUM = gc.problems.join("; ");
    else {
      B.SOV_COMPLETED_SUM = computed(round42(gc.values.reduce((a, b) => a + b.value, 0)), `\u03A3(${gc.values.map((b) => b.field).join(" + ")})`, gc.values);
      attach["document.G702_DONE"] = gc.values.map((b) => evidenceFromBinding("COMPLETED_TO_DATE", b));
    }
    const rc = column(lineCtxs, "LINE_RETAINAGE", lineKey);
    if (rc.values.length === 0) docAbsence.SOV_RETAINAGE_SUM = "no line-level retainage on the continuation sheet (column I absent)";
    else if (rc.problems.length) docAbsence.SOV_RETAINAGE_SUM = rc.problems.join("; ");
    else {
      B.SOV_RETAINAGE_SUM = computed(round42(rc.values.reduce((a, b) => a + b.value, 0)), `\u03A3(${rc.values.map((b) => b.field).join(" + ")})`, rc.values);
      attach["document.G702_RSUM"] = rc.values.map((b) => evidenceFromBinding("LINE_RETAINAGE", b));
    }
  }
  if (L4 === null || !B.TOTAL_COMPLETED_STORED) docAbsence.EXPECTED_RETAINAGE_TOTAL = "TOTAL_COMPLETED_STORED not present";
  else if (rate === null || !B.RETAINAGE_RATE) docAbsence.EXPECTED_RETAINAGE_TOTAL = "RETAINAGE_RATE not present";
  else B.EXPECTED_RETAINAGE_TOTAL = computed(round42(L4 * rate), "line 4 \xD7 rate", [B.TOTAL_COMPLETED_STORED, B.RETAINAGE_RATE]);
  attach["document.G702_RATE"] = operandEvidence2(B, ["TOTAL_COMPLETED_STORED", "RETAINAGE_RATE"]);
  if (L4 === null || !B.TOTAL_COMPLETED_STORED) docAbsence.EXPECTED_EARNED_LESS_RETAINAGE = "TOTAL_COMPLETED_STORED not present";
  else if (L5 === null || !B.RETAINAGE_TOTAL) docAbsence.EXPECTED_EARNED_LESS_RETAINAGE = "RETAINAGE_TOTAL not present";
  else B.EXPECTED_EARNED_LESS_RETAINAGE = computed(round42(L4 - L5), "line 4 \u2212 line 5", [B.TOTAL_COMPLETED_STORED, B.RETAINAGE_TOTAL]);
  attach["document.G702_EARN"] = operandEvidence2(B, ["TOTAL_COMPLETED_STORED", "RETAINAGE_TOTAL"]);
  if (L6 === null || !B.TOTAL_EARNED_LESS_RETAINAGE) docAbsence.EXPECTED_CURRENT_PAYMENT_DUE = "TOTAL_EARNED_LESS_RETAINAGE not present";
  else {
    const ops = [B.TOTAL_EARNED_LESS_RETAINAGE, ...L7 !== null && B.PREVIOUS_CERTIFICATES ? [B.PREVIOUS_CERTIFICATES] : []];
    B.EXPECTED_CURRENT_PAYMENT_DUE = computed(round42(L6 - (L7 ?? 0)), `line 6 \u2212 line 7${L7 === null ? " (line 7 absent \u2192 0)" : ""}`, ops);
  }
  attach["document.G702_DUE"] = operandEvidence2(B, ["TOTAL_EARNED_LESS_RETAINAGE", "PREVIOUS_CERTIFICATES"]);
  if (L3 === null || !B.CONTRACT_SUM_TO_DATE) docAbsence.EXPECTED_BALANCE_INCL_RETAINAGE = "CONTRACT_SUM_TO_DATE not present";
  else if (L6 === null || !B.TOTAL_EARNED_LESS_RETAINAGE) docAbsence.EXPECTED_BALANCE_INCL_RETAINAGE = "TOTAL_EARNED_LESS_RETAINAGE not present";
  else B.EXPECTED_BALANCE_INCL_RETAINAGE = computed(round42(L3 - L6), "line 3 \u2212 line 6", [B.CONTRACT_SUM_TO_DATE, B.TOTAL_EARNED_LESS_RETAINAGE]);
  attach["document.G702_BAL"] = operandEvidence2(B, ["CONTRACT_SUM_TO_DATE", "TOTAL_EARNED_LESS_RETAINAGE"]);
  if (!prevDoc) docAbsence.PREVIOUS_EARNED_LESS_RETAINAGE = prevAbsence;
  else {
    const e = firstKey(prevDoc.doc, EARNED_KEYS, DOC_ROOTS);
    const bound = e ? historyAmount(`history[${prevDoc.index}].${e.path}`, e.value) : null;
    if (!bound) docAbsence.PREVIOUS_EARNED_LESS_RETAINAGE = "the previous application has no total-earned-less-retainage amount";
    else B.PREVIOUS_EARNED_LESS_RETAINAGE = bound;
  }
  return { docAbsence, lineAbsence, attach };
}
var PAY_APP_RULESET = {
  ...PAY_APP_RULESET_REF,
  name: "Construction pay application (AIA G702 / G703)",
  ontology: PAY_APP_ONTOLOGY,
  axioms: PAY_APP_AXIOMS,
  lineCodes: PAY_APP_LINE_AXIOMS.map((a) => a.shortCode),
  documentCodes: PAY_APP_DOCUMENT_AXIOMS.map((a) => a.shortCode),
  kindByCode: {
    G703_TOTAL: "RECOMPUTE",
    G703_BAL: "RECOMPUTE",
    G703_PCT: "RECOMPUTE",
    G703_CAP: "CONSISTENCY",
    G703_PREV: "CROSS_REFERENCE",
    G702_CSUM: "RECOMPUTE",
    G702_SOV: "RECOMPUTE",
    G702_DONE: "RECOMPUTE",
    G702_RSUM: "RECOMPUTE",
    G702_RATE: "RECOMPUTE",
    G702_EARN: "RECOMPUTE",
    G702_DUE: "RECOMPUTE",
    G702_BAL: "RECOMPUTE",
    G702_PREV: "CROSS_REFERENCE"
  },
  fieldByCode: {
    G703_TOTAL: "completed_to_date",
    G703_BAL: "balance_to_finish",
    G703_PCT: "percent_complete",
    G703_CAP: "completed_to_date",
    G703_PREV: "previous",
    G702_CSUM: "contract_sum_to_date",
    G702_SOV: "contract_sum_to_date",
    G702_DONE: "total_completed_and_stored",
    G702_RSUM: "total_retainage",
    G702_RATE: "total_retainage",
    G702_EARN: "total_earned_less_retainage",
    G702_DUE: "current_payment_due",
    G702_BAL: "balance_to_finish_including_retainage",
    G702_PREV: "less_previous_certificates"
  },
  referenceRoles: {
    contract: [],
    evidence: [],
    history: ["PREVIOUS_COMPLETED_TO_DATE", "PREVIOUS_EARNED_LESS_RETAINAGE"]
  },
  computedRoles: [
    "EXPECTED_COMPLETED_TO_DATE",
    "EXPECTED_BALANCE_TO_FINISH",
    "EXPECTED_PERCENT_COMPLETE",
    "EXPECTED_CONTRACT_SUM_TO_DATE",
    "SOV_SCHEDULED_SUM",
    "SOV_COMPLETED_SUM",
    "SOV_RETAINAGE_SUM",
    "EXPECTED_RETAINAGE_TOTAL",
    "EXPECTED_EARNED_LESS_RETAINAGE",
    "EXPECTED_CURRENT_PAYMENT_DUE",
    "EXPECTED_BALANCE_INCL_RETAINAGE"
  ],
  ambiguityGuards: [],
  compute: compute2
};

// packages/verify/src/rulesets/index.ts
var RULESETS = [INVOICE_RULESET, PAY_APP_RULESET];
var BY_ID = new Map(RULESETS.map((r) => [r.id, r]));
function resolveRuleset(r) {
  if (r === void 0) return INVOICE_RULESET;
  if (typeof r !== "string") return r;
  const hit = BY_ID.get(r);
  if (!hit) throw new Error(`unknown ruleset "${r}"; known: ${[...BY_ID.keys()].join(", ")}`);
  return hit;
}

// packages/verify/src/tolerance.ts
function applyTolerancePolicy(claims, policy) {
  if (policy.rel <= 0) return;
  for (const c of claims) {
    const comp = c.computation;
    if (!comp || typeof comp.result !== "number") continue;
    const absFloor = comp.tolerance?.abs ?? 0.01;
    comp.tolerance = { abs: absFloor, rel: policy.rel };
    if (c.outcome !== "FAIL" || typeof c.variance !== "number") continue;
    const cap = policy.absCap > 0 ? policy.absCap : Infinity;
    const eff = Math.max(absFloor, Math.min(policy.rel * Math.abs(comp.result), cap));
    if (Math.abs(c.variance) <= eff + 1e-9) {
      c.outcome = "PASS";
      c.locked = false;
      c.explanation = `Within tolerance (|variance| ${round4(Math.abs(c.variance))} \u2264 ${round4(eff)} = min(${round4(policy.rel * 100)}% of ${comp.result}, cap $${policy.absCap}), floor $${absFloor}): treated as rounding, not error. ${c.explanation}`;
    }
  }
}

// packages/verify/src/verdict/canonical.ts
import { createHash } from "node:crypto";
function canonicalize(value) {
  return JSON.stringify(normalize(value));
}
function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function hashOf(value) {
  return sha256(canonicalize(value));
}
function normalize(v) {
  if (v === void 0 || v === null) return v === void 0 ? void 0 : null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v)) {
    return v.map((x) => {
      const n = normalize(x);
      return n === void 0 ? null : n;
    });
  }
  if (typeof v === "object") {
    const src = v;
    const out = {};
    for (const k of Object.keys(src).sort()) {
      const n = normalize(src[k]);
      if (n !== void 0) out[k] = n;
    }
    return out;
  }
  return null;
}

// packages/verify/src/verdict/accuracy.ts
function attachDeclaredAccuracy(verdict, accuracy) {
  if (accuracy.ruleset_version !== verdict.ruleset.version) {
    throw new Error(
      `declared_accuracy was measured on ruleset version ${accuracy.ruleset_version} but this verdict is from version ${verdict.ruleset.version}; re-measure before attaching`
    );
  }
  return { ...verdict, declared_accuracy: accuracy };
}

// packages/verify/src/declarative/expr.ts
function tokenize(s) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      toks.push({ t: "num", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      toks.push({ t: "id", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "(") {
      toks.push({ t: "lp", v: c });
      i++;
      continue;
    }
    if (c === ")") {
      toks.push({ t: "rp", v: c });
      i++;
      continue;
    }
    if ("+-*/".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`invalid character in expression: '${c}'`);
  }
  return toks;
}
function evalExpr(expr, env) {
  const toks = tokenize(expr);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  function parseExpr() {
    let left = parseTerm();
    while (peek()?.t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = next().v;
      const right = parseTerm();
      if (left === void 0 || right === void 0) left = void 0;
      else left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function parseTerm() {
    let left = parseFactor();
    while (peek()?.t === "op" && (peek().v === "*" || peek().v === "/")) {
      const op = next().v;
      const right = parseFactor();
      if (left === void 0 || right === void 0) left = void 0;
      else left = op === "*" ? left * right : right === 0 ? void 0 : left / right;
    }
    return left;
  }
  function parseFactor() {
    const tk = peek();
    if (!tk) throw new Error("unexpected end of expression");
    if (tk.t === "op" && tk.v === "-") {
      next();
      const v = parseFactor();
      return v === void 0 ? void 0 : -v;
    }
    if (tk.t === "op" && tk.v === "+") {
      next();
      return parseFactor();
    }
    if (tk.t === "num") {
      next();
      return Number(tk.v);
    }
    if (tk.t === "lp") {
      next();
      const v = parseExpr();
      expect("rp");
      return v;
    }
    if (tk.t === "id") {
      next();
      if (peek()?.t === "lp") {
        next();
        if (tk.v === "sum") {
          const arg = peek();
          if (!arg || arg.t !== "id") throw new Error("sum() expects a role name");
          next();
          expect("rp");
          return env.sum(arg.v);
        }
        if (tk.v === "abs") {
          const v = parseExpr();
          expect("rp");
          return v === void 0 ? void 0 : Math.abs(v);
        }
        throw new Error(`unknown function '${tk.v}'`);
      }
      return env.vars[tk.v];
    }
    throw new Error(`unexpected token '${tk.v}'`);
  }
  function expect(t) {
    if (peek()?.t !== t) throw new Error(`expected ${t}`);
    next();
  }
  const result = parseExpr();
  if (p !== toks.length) throw new Error("trailing tokens in expression");
  return result;
}
function referencedRoles(expr) {
  const out = /* @__PURE__ */ new Set();
  for (const t of tokenize(expr)) if (t.t === "id" && t.v !== "sum" && t.v !== "abs") out.add(t.v);
  return [...out];
}

// packages/verify/src/declarative/evaluate.ts
function getPath(obj, path) {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return void 0;
    cur = cur[p];
  }
  return cur;
}
function normBool(raw) {
  if (raw === true || raw === false) return { value: raw ? 1 : 0, norms: ["bool_to_number"] };
  if (raw === 1 || raw === 0) return { value: raw, norms: ["already_number"] };
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "1") return { value: 1, norms: ["bool_text_parsed"] };
    if (s === "false" || s === "no" || s === "0") return { value: 0, norms: ["bool_text_parsed"] };
  }
  return null;
}
function normIdentifiers(raw) {
  const one = (x) => {
    if (typeof x === "number" && Number.isFinite(x)) return String(x);
    if (typeof x !== "string") return void 0;
    const n = x.replace(/\s+/g, "").toUpperCase();
    return n.length ? n : null;
  };
  if (!Array.isArray(raw)) {
    const n = one(raw);
    return typeof n === "string" ? [n] : null;
  }
  const out = [];
  for (const x of raw) {
    const n = one(x);
    if (n === void 0) return null;
    if (n !== null && !out.includes(n)) out.push(n);
  }
  return out;
}
function normByKind(kind, raw) {
  if (kind === "bool") return normBool(raw);
  const n = kind === "rate" ? normalizeRate(raw) : kind === "quantity" ? normalizeQuantity(raw) : normalizeAmount(raw);
  if (!n?.success || typeof n.normalized !== "number" || !Number.isFinite(n.normalized)) return null;
  return { value: n.normalized, norms: n.transformations };
}
function bindField(source, field) {
  let resolvedButBad = false;
  for (let i = 0; i < field.paths.length; i++) {
    const raw = getPath(source, field.paths[i]);
    if (raw === void 0 || raw === null || raw === "") continue;
    const confidence = i === 0 ? 100 : 95;
    if (field.kind === "string") return { status: "ok", strValue: String(raw), path: field.paths[i], confidence, original: raw };
    if (field.kind === "identifier") {
      const ids = normIdentifiers(raw);
      if (ids) return { status: "ok", ids, path: field.paths[i], confidence, original: raw, norms: ["identifier_normalized"] };
      resolvedButBad = true;
      continue;
    }
    const norm = normByKind(field.kind, raw);
    if (norm) return { status: "ok", value: norm.value, path: field.paths[i], confidence, original: raw, norms: norm.norms };
    resolvedButBad = true;
  }
  if (!resolvedButBad && field.default !== void 0) return { status: "ok", value: field.default, path: `default(${field.default})`, confidence: 100 };
  return { status: resolvedButBad ? "unparseable" : "missing", confidence: 0 };
}
function fieldEvidence(role, b) {
  if (b.status !== "ok" || !b.path) return null;
  const value = b.ids !== void 0 ? Array.isArray(b.original) ? b.ids : b.ids[0] ?? null : b.value !== void 0 ? b.value : b.strValue ?? null;
  const source = b.path.startsWith("default(") ? "computed" : "invoice";
  const e = { locator: { kind: "field", source, path: b.path }, value, confidence: b.confidence, role: "OPERAND" };
  if (b.original !== void 0 && String(b.original) !== String(value)) e.original = b.original;
  if (b.norms && b.norms.length) e.normalizations = b.norms;
  return e;
}
var evidenceKey2 = (e) => e.locator.kind === "field" ? `${e.locator.source}:${e.locator.path}` : `span:${e.locator.source_hash}`;
function verifyDeclarative(extraction, ruleset, options = {}) {
  const lineKeys = ruleset.lineArrayKeys ?? ["line_items"];
  const lineKey = lineKeys.find((k) => Array.isArray(extraction[k]));
  const lines = lineKey ? extraction[lineKey].filter((x) => x !== null && typeof x === "object" && !Array.isArray(x)) : [];
  const docRoles = Object.entries(ruleset.fields).filter(([, f]) => !f.line);
  const lineRoles = Object.entries(ruleset.fields).filter(([, f]) => f.line);
  const lineRoleNames = new Set(lineRoles.map(([r]) => r));
  const boundDoc = /* @__PURE__ */ new Map();
  for (const [role, f] of docRoles) boundDoc.set(role, bindField(extraction, f));
  const boundLines = lines.map((line2) => {
    const m = /* @__PURE__ */ new Map();
    for (const [role, f] of lineRoles) m.set(role, bindField(line2, f));
    return m;
  });
  const sumRole = (role) => {
    if (boundLines.length === 0) return void 0;
    let acc = 0;
    for (const m of boundLines) {
      const b = m.get(role);
      if (!b || b.status !== "ok" || b.value === void 0) return void 0;
      acc += b.value;
    }
    return round4(acc);
  };
  const docVars = {};
  for (const [role, b] of boundDoc) docVars[role] = b.status === "ok" ? b.value : void 0;
  const computedFormula = /* @__PURE__ */ new Map();
  for (const [role, formula] of Object.entries(ruleset.computed ?? {})) {
    computedFormula.set(role, formula);
    docVars[role] = evalExpr(formula, { vars: docVars, sum: sumRole });
  }
  const docEnv = { vars: docVars, sum: sumRole };
  const policy = options.tolerance ?? ruleset.tolerance ?? { rel: 3e-4, absCap: 0 };
  const claims = [];
  const runCheck = (chk, env, prefix, gatherEvidence, missingOf) => {
    const claim_id = `${prefix}.${chk.code}`;
    const roles = [.../* @__PURE__ */ new Set([...referencedRoles(chk.left), ...referencedRoles(chk.right)])];
    const base = { claim_id, kind: "RECOMPUTE", tier: "DETERMINISTIC", field: chk.field ?? chk.code.toLowerCase(), rule_id: chk.code, rule_name: chk.name ?? chk.code };
    const insuff = missingOf(roles);
    if (insuff) {
      claims.push({ ...base, outcome: "INSUFFICIENT_DATA", asserted: null, evidence: [], insufficiency: insuff, locked: false, explanation: `${chk.code}: ${insuff.detail}` });
      return;
    }
    let left, right;
    try {
      left = evalExpr(chk.left, env);
      right = evalExpr(chk.right, env);
    } catch (e) {
      claims.push({ ...base, outcome: "INSUFFICIENT_DATA", asserted: null, evidence: [], insufficiency: { reason: "OUT_OF_RULESET_SCOPE", detail: `expression error: ${e.message}` }, locked: false, explanation: `${chk.code}: bad expression` });
      return;
    }
    if (left === void 0 || right === void 0) {
      claims.push({ ...base, outcome: "INSUFFICIENT_DATA", asserted: null, evidence: [], insufficiency: { reason: "FIELD_MISSING", detail: `a value needed by ${chk.code} was absent`, missing: roles }, locked: false, explanation: `${chk.code}: operand absent` });
      return;
    }
    const tol = chk.tol ?? 0.01;
    let passed;
    if (chk.op === "=") passed = Math.abs(left - right) <= tol;
    else if (chk.op === "<=") passed = left <= right + tol;
    else if (chk.op === ">=") passed = left >= right - tol;
    else passed = Math.abs(left - right) > tol;
    const evidence = gatherEvidence(roles);
    claims.push({
      ...base,
      outcome: passed ? "PASS" : "FAIL",
      asserted: round4(left),
      computation: { formula: `${chk.left} ${chk.op} ${chk.right}`, operands: { left: round4(left), right: round4(right) }, result: round4(right), tolerance: { abs: tol } },
      evidence,
      locked: !passed,
      explanation: `${chk.field ?? chk.code}: ${round4(left)} ${chk.op} ${round4(right)} \u2014 ${passed ? "holds" : "does not hold"}.`,
      ...passed ? {} : { variance: round4(left - right) }
    });
  };
  const runIdentifierCheck = (chk, prefix, scope, lookup) => {
    const base = { claim_id: `${prefix}.${chk.code}`, kind: "CROSS_REFERENCE", tier: "DETERMINISTIC", field: chk.field ?? chk.code.toLowerCase(), rule_id: chk.code, rule_name: chk.name ?? chk.code };
    const abstain = (insufficiency) => {
      claims.push({ ...base, outcome: "INSUFFICIENT_DATA", asserted: null, evidence: [], insufficiency, locked: false, explanation: `${chk.code}: ${insufficiency.detail}` });
    };
    const L = String(chk.left ?? "").trim(), R = String(chk.right ?? "").trim();
    if (chk.op !== "=" && chk.op !== "!=") return abstain({ reason: "OUT_OF_RULESET_SCOPE", detail: `identifier checks support only = and != (got ${chk.op})` });
    for (const r of [L, R]) {
      const f = Object.prototype.hasOwnProperty.call(ruleset.fields, r) ? ruleset.fields[r] : void 0;
      if (!f || f.kind !== "identifier" || !!f.line !== (scope === "line")) return abstain({ reason: "OUT_OF_RULESET_SCOPE", detail: `"${r}" is not a ${scope}-level 'identifier' field (an identifier check names two identifier fields)` });
    }
    const bl = lookup(L), br = lookup(R);
    for (const [r, b] of [[L, bl], [R, br]]) if (b?.status === "unparseable") return abstain({ reason: "UNPARSEABLE", detail: `${r} is present but is not an identifier or a list of identifiers`, missing: [r] });
    for (const [r, b] of [[L, bl], [R, br]]) if (!b || b.status !== "ok" || !b.ids) return abstain({ reason: "FIELD_MISSING", detail: `${r} not present`, missing: [r] });
    const li = bl.ids, ri = br.ids;
    const same = li.length === ri.length && li.every((x) => ri.includes(x));
    const passed = chk.op === "=" ? same : !same;
    const show = (ids) => ids.length === 1 ? ids[0] : `{${ids.join(", ")}}`;
    const asValue = (ids) => ids.length === 1 ? ids[0] : ids;
    claims.push({
      ...base,
      outcome: passed ? "PASS" : "FAIL",
      asserted: asValue(li),
      computation: { formula: `${L} ${chk.op} ${R} (identifier sets; whitespace removed, upper-cased)`, operands: { [L]: li, [R]: ri }, result: asValue(ri) },
      evidence: [fieldEvidence(L, bl), fieldEvidence(R, br)].filter((e) => e !== null),
      locked: !passed,
      explanation: `${chk.field ?? chk.code}: ${show(li)} ${chk.op} ${show(ri)} \u2014 ${passed ? "holds" : "does not hold"}.`
    });
  };
  const docMissing = (roles) => {
    for (const r of roles) {
      const b = boundDoc.get(r);
      if (b && b.status === "unparseable") return { reason: "UNPARSEABLE", detail: `${r} is present but could not be parsed as a number`, missing: [r] };
    }
    for (const r of roles) {
      if (!lineRoleNames.has(r)) continue;
      for (let i = 0; i < boundLines.length; i++) {
        const b = boundLines[i].get(r);
        if (b?.status === "unparseable") return { reason: "UNPARSEABLE", detail: `${r} present but unparseable on line ${i}`, missing: [r] };
      }
    }
    for (const r of roles) {
      if (computedFormula.has(r)) {
        if (docVars[r] === void 0) return { reason: "FIELD_MISSING", detail: `computed ${r} could not be produced (an operand was absent)`, missing: [r] };
        continue;
      }
      if (lineRoleNames.has(r)) {
        if (sumRole(r) === void 0) return { reason: "FIELD_MISSING", detail: `${r} absent on one or more lines`, missing: [r] };
        continue;
      }
      const b = boundDoc.get(r);
      if (!b || b.status === "missing") return { reason: "FIELD_MISSING", detail: `${r} not present on the document`, missing: [r] };
    }
    return null;
  };
  const docEvidence = (roles) => {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const add = (e) => {
      if (e) {
        const k = evidenceKey2(e);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(e);
        }
      }
    };
    for (const r of roles) {
      if (boundDoc.has(r)) add(fieldEvidence(r, boundDoc.get(r)));
      else if (computedFormula.has(r) && docVars[r] !== void 0) add({ locator: { kind: "field", source: "computed", path: computedFormula.get(r) }, value: round4(docVars[r]), confidence: 100, role: "CONTEXT" });
      for (const m of boundLines) if (m.has(r)) add(fieldEvidence(r, m.get(r)));
    }
    return out;
  };
  for (const chk of ruleset.checks.filter((c) => (c.scope ?? "document") === "document")) {
    if (chk.compare === "identifier") runIdentifierCheck(chk, "document", "document", (r) => boundDoc.get(r));
    else runCheck(chk, docEnv, "document", docEvidence, docMissing);
  }
  ruleset.checks.filter((c) => c.scope === "line").forEach((chk) => {
    boundLines.forEach((m, i) => {
      if (chk.compare === "identifier") {
        runIdentifierCheck(chk, `line[${i}]`, "line", (r) => m.get(r));
        return;
      }
      const lineVars = {};
      for (const [role, b] of m) lineVars[role] = b.status === "ok" ? b.value : void 0;
      const env = { vars: lineVars, sum: () => void 0 };
      const missing = (roles) => {
        for (const r of roles) {
          const b = m.get(r);
          if (b?.status === "unparseable") return { reason: "UNPARSEABLE", detail: `${r} present but unparseable on line ${i}`, missing: [r] };
        }
        for (const r of roles) {
          const b = m.get(r);
          if (!b || b.status === "missing") return { reason: "FIELD_MISSING", detail: `${r} not present on line ${i}`, missing: [r] };
        }
        return null;
      };
      const ev = (roles) => {
        const out = [];
        for (const r of roles) {
          const e = fieldEvidence(r, m.get(r) ?? { status: "missing", confidence: 0 });
          if (e) out.push(e);
        }
        return out;
      };
      runCheck(chk, env, `line[${i}]`, ev, missing);
    });
  });
  applyTolerancePolicy(claims, policy);
  let pass = 0, fail = 0, ins = 0;
  for (const c of claims) c.outcome === "PASS" ? pass++ : c.outcome === "FAIL" ? fail++ : ins++;
  const coverage = { claims_total: claims.length, claims_checked: pass + fail, claims_pass: pass, claims_fail: fail, claims_insufficient: ins };
  const outcome = fail > 0 ? "FAIL" : pass + fail === 0 ? "INSUFFICIENT_DATA" : "PASS";
  const input_hash = hashOf({ extraction, ruleset });
  const verdict_id = sha256(`${input_hash}:${ruleset.id}@${ruleset.version}:${ENGINE_VERSION}`).slice(0, 32);
  const issued_at = (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  const verdict = {
    schema_version: SCHEMA_VERSION,
    verdict_id,
    issued_at,
    engine_version: ENGINE_VERSION,
    ruleset: { id: ruleset.id, version: ruleset.version, domain: ruleset.domain ?? ruleset.id },
    input_hash,
    replayable: true,
    document: { extraction_hash: hashOf(extraction), ...options.producer !== void 0 ? { producer: options.producer } : {}, line_items: lines.length },
    references: { contract: false, evidence: 0, history: 0, source: false },
    outcome,
    aggregation: "ANY_FAIL_FAILS",
    claims,
    coverage
  };
  return options.declared_accuracy ? attachDeclaredAccuracy(verdict, options.declared_accuracy) : verdict;
}

// packages/verify/src/declarative/types.ts
function isDeclarativeRuleset(x) {
  return !!x && typeof x === "object" && !("compute" in x) && typeof x.fields === "object" && Array.isArray(x.checks);
}

// packages/verify/src/textmatch/normalize.ts
var QUOTE_MAP = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": "'",
  "\u201B": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u201E": '"',
  "\u201F": '"',
  "\xAB": '"',
  "\xBB": '"',
  "\u2039": "'",
  "\u203A": "'",
  "`": "'",
  "\xB4": "'"
};
var DASHES = /* @__PURE__ */ new Set(["\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015", "\u2212"]);
function isSpace(c) {
  return c === " " || c === "	" || c === "\n" || c === "\r" || c === "\f" || c === "\v" || c === "\xA0";
}
function isHyphenOrDash(c) {
  return c === "-" || DASHES.has(c);
}
function normalizeMapped(src, profile) {
  const out = [];
  const map = [];
  const n = src.length;
  const push2 = (ch, srcOffset) => {
    for (let k = 0; k < ch.length; k++) {
      out.push(ch[k]);
      map.push(srcOffset);
    }
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (isHyphenOrDash(c)) {
      let k = i + 1;
      while (k < n && (src[k] === " " || src[k] === "	")) k++;
      if (k < n && (src[k] === "\n" || src[k] === "\r")) {
        i = k;
        while (i < n && isSpace(src[i])) i++;
        continue;
      }
      push2("-", i);
      i++;
      continue;
    }
    if (isSpace(c)) {
      const start = i;
      while (i < n && isSpace(src[i])) i++;
      push2(" ", start);
      continue;
    }
    if (c === "\u2026") {
      push2("...", i);
      i++;
      continue;
    }
    const q = QUOTE_MAP[c];
    if (q !== void 0) {
      push2(q, i);
      i++;
      continue;
    }
    push2(profile === "legal" ? c.toLowerCase() : c, i);
    i++;
  }
  return { text: out.join(""), map, original: src };
}
function toOriginalSpan(m, normStart, normEnd) {
  if (m.text.length === 0) return { start: 0, end: 0 };
  const s = Math.max(0, Math.min(normStart, m.text.length - 1));
  const e = Math.max(s, Math.min(normEnd - 1, m.text.length - 1));
  const start = m.map[s];
  const lastOrig = m.map[e];
  return { start, end: lastOrig + 1 };
}
function numberSurfaceForms(value) {
  if (!Number.isFinite(value)) return [];
  const abs = Math.abs(value);
  const forms = /* @__PURE__ */ new Set();
  const two = abs.toFixed(2);
  const [ip, fp] = two.split(".");
  const grouped = Number(ip).toLocaleString("en-US");
  forms.add(two);
  forms.add(`${grouped}.${fp}`);
  const plain = String(abs);
  forms.add(plain);
  if (Number.isInteger(abs)) {
    forms.add(grouped);
    forms.add(ip);
  } else {
    const [pp, pf] = plain.split(".");
    forms.add(`${Number(pp).toLocaleString("en-US")}.${pf}`);
  }
  return [...forms].filter((s) => s.length > 0);
}

// packages/verify/src/textmatch/matcher.ts
var WORD_RE = /[^\s]+/g;
var MIN_ANCHOR_WORDS = 3;
function edgeIsNumberPart(text, idx, dir) {
  const c = text[idx];
  if (c === void 0) return false;
  if (c >= "0" && c <= "9") return true;
  if (c === "." || c === ",") {
    const beyond = text[idx + dir];
    return beyond !== void 0 && beyond >= "0" && beyond <= "9";
  }
  return false;
}
function prepareSource(source) {
  return { legal: normalizeMapped(source, "legal"), value: normalizeMapped(source, "value"), raw: source };
}
function words(s) {
  return s.match(WORD_RE) ?? [];
}
function matchQuote(prepared, quote) {
  const src = prepared.legal;
  const qn = normalizeMapped(quote, "legal").text.trim();
  if (qn.length === 0) return { found: false, reason: "not_located" };
  const idx = src.text.indexOf(qn);
  if (idx >= 0) {
    const span = toOriginalSpan(src, idx, idx + qn.length);
    return { found: true, span, matchedText: prepared.raw.slice(span.start, span.end), reason: "verbatim" };
  }
  const qWords = words(qn);
  let bestLen = 0;
  let bestPos = -1;
  let bestChars = 0;
  for (let i = 0; i < qWords.length; i++) {
    let phrase = qWords[i];
    let pos = src.text.indexOf(phrase);
    if (pos < 0) continue;
    let j = i;
    while (j + 1 < qWords.length) {
      const trial = `${phrase} ${qWords[j + 1]}`;
      const tpos = src.text.indexOf(trial);
      if (tpos < 0) break;
      phrase = trial;
      pos = tpos;
      j++;
    }
    const len = j - i + 1;
    if (len > bestLen) {
      bestLen = len;
      bestPos = pos;
      bestChars = phrase.length;
    }
  }
  if (bestLen >= MIN_ANCHOR_WORDS && bestPos >= 0) {
    const margin = Math.max(qn.length, 40);
    let ws = Math.max(0, bestPos - margin);
    let we = Math.min(src.text.length, bestPos + bestChars + margin);
    while (ws > 0 && src.text[ws - 1] !== " ") ws--;
    while (we < src.text.length && src.text[we] !== " ") we++;
    const span = toOriginalSpan(src, ws, we);
    return {
      found: false,
      nearest: { span, text: prepared.raw.slice(span.start, span.end) },
      reason: "misquote_nearest"
    };
  }
  return { found: false, reason: "not_located" };
}
function matchValue(prepared, value) {
  const src = prepared.value;
  for (const form of numberSurfaceForms(value)) {
    let from = 0;
    for (; ; ) {
      const p = src.text.indexOf(form, from);
      if (p < 0) break;
      if (!edgeIsNumberPart(src.text, p - 1, -1) && !edgeIsNumberPart(src.text, p + form.length, 1)) {
        const span = toOriginalSpan(src, p, p + form.length);
        return { found: true, span, matchedText: prepared.raw.slice(span.start, span.end), form };
      }
      from = p + 1;
    }
  }
  return { found: false };
}

// packages/verify/src/textmatch/index.ts
function spanEvidence(sourceHash, span, text, page) {
  const e = {
    locator: { kind: "span", source_hash: sourceHash, start: span.start, end: span.end, ...page !== void 0 ? { page } : {} },
    value: text,
    confidence: 100,
    role: "QUOTE"
  };
  return e;
}
function verifyQuote(a, prepared, sourceHash) {
  const r = matchQuote(prepared, a.quote);
  const base = {
    claim_id: a.id,
    kind: "QUOTE_MATCH",
    tier: "DETERMINISTIC",
    field: a.label ?? "quote",
    asserted: a.quote,
    rule_id: "QUOTE_MATCH",
    rule_name: "Verbatim quotation"
  };
  if (r.found && r.span) {
    return {
      ...base,
      outcome: "PASS",
      locked: true,
      evidence: [spanEvidence(sourceHash, r.span, r.matchedText ?? "")],
      explanation: `The quoted passage appears verbatim in the source at [${r.span.start}, ${r.span.end}).`
    };
  }
  if (r.reason === "misquote_nearest" && r.nearest) {
    return {
      ...base,
      outcome: "FAIL",
      locked: true,
      computation: { formula: "quoted = source[cited span]", operands: { quoted: a.quote, source_says: r.nearest.text }, result: r.nearest.text },
      evidence: [spanEvidence(sourceHash, r.nearest.span, r.nearest.text)],
      explanation: `The citation points at real text, but the quotation is not verbatim. The source reads: "${r.nearest.text}".`
    };
  }
  return {
    ...base,
    outcome: "INSUFFICIENT_DATA",
    locked: false,
    evidence: [],
    insufficiency: { reason: "SPAN_NOT_FOUND", detail: "The quoted passage was not located in the supplied source text; it may be quoted from a different source, or the source text may be incomplete (e.g. scanned/OCR gaps)." },
    explanation: "Could not locate the quoted passage in the source; abstaining rather than asserting a negative."
  };
}
function verifyValueInText(a, prepared, sourceHash) {
  const r = matchValue(prepared, a.value);
  const base = {
    claim_id: a.id,
    kind: "QUOTE_MATCH",
    tier: "DETERMINISTIC",
    field: a.field,
    asserted: a.value,
    rule_id: "VALUE_IN_SOURCE",
    rule_name: "Extracted value present in source"
  };
  if (r.found && r.span) {
    return {
      ...base,
      outcome: "PASS",
      locked: false,
      evidence: [spanEvidence(sourceHash, r.span, r.matchedText ?? "")],
      explanation: `The extracted ${a.field} (${a.value}) appears in the source as "${r.matchedText}" (presence only \u2014 not proof it is the correct field).`
    };
  }
  return {
    ...base,
    outcome: "INSUFFICIENT_DATA",
    locked: false,
    evidence: [],
    insufficiency: { reason: "SPAN_NOT_FOUND", detail: `The extracted ${a.field} (${a.value}) was not found in the supplied source text; the value may be computed, formatted differently, or extracted from a region not included.` },
    explanation: `Could not locate ${a.field} in the source; abstaining.`
  };
}
function verifyAgainstSource(sourceText, quotes = [], values = []) {
  const source_hash = sha256(sourceText);
  const prepared = prepareSource(sourceText);
  const claims = [
    ...quotes.map((q) => verifyQuote(q, prepared, source_hash)),
    ...values.map((v) => verifyValueInText(v, prepared, source_hash))
  ];
  return { source_hash, claims };
}

// packages/verify/src/action/index.ts
var ACTION_RULESET = { id: "action", version: "0.0.1", domain: "action" };
var isScalar = (x) => typeof x === "string" || typeof x === "number" || typeof x === "boolean";
var looksNumeric = (v) => typeof v === "number" || typeof v === "string" && /^-?[\d.,\s$]+$/.test(v) && /\d/.test(v);
function allowlistEvidence(path, value) {
  return { locator: { kind: "field", source: "contract", path: `allowed.${path}` }, value, confidence: 100, role: "REFERENCE" };
}
function spanEvidence2(sourceHash, span, text) {
  return { locator: { kind: "span", source_hash: sourceHash, start: span.start, end: span.end }, value: text, confidence: 100, role: "QUOTE" };
}
function groundArgument(path, value, sources, prepared, sourceHash) {
  const base = { claim_id: `arg.${path}`, tier: "DETERMINISTIC", field: path, asserted: value };
  const allowed = sources.allowed?.[path];
  if (allowed !== void 0) {
    const ok2 = allowed.some((a) => String(a) === String(value));
    return ok2 ? {
      ...base,
      kind: "CROSS_REFERENCE",
      outcome: "PASS",
      rule_id: "GROUNDED",
      rule_name: "Value grounded in an approved set",
      computation: { formula: "value \u2208 allowed", operands: { value }, result: true },
      evidence: [allowlistEvidence(path, value)],
      locked: true,
      explanation: `"${value}" is one of the ${allowed.length} approved values for ${path}.`
    } : {
      ...base,
      kind: "CROSS_REFERENCE",
      outcome: "FAIL",
      rule_id: "GROUNDED",
      rule_name: "Value grounded in an approved set",
      computation: { formula: "value \u2208 allowed", operands: { value, approved: allowed.length }, result: false },
      evidence: [allowlistEvidence(path, value)],
      locked: true,
      explanation: `"${value}" is NOT in the approved set for ${path}. The agent proposed a value with no approved source \u2014 do not execute.`
    };
  }
  if (prepared && sourceHash) {
    if (looksNumeric(value)) {
      return {
        ...base,
        kind: "CROSS_REFERENCE",
        outcome: "INSUFFICIENT_DATA",
        rule_id: "GROUNDED",
        rule_name: "Value grounded in an approved source",
        evidence: [],
        insufficiency: { reason: "REFERENCE_NOT_PROVIDED", detail: `${path} = ${JSON.stringify(value)}: a bare number found in free source text does not establish it as this argument's value (it can match a year, quantity, part or account number, or an opposite sign). Supply an allow-list of approved values, or a labelled source field, to ground a numeric action value.` },
        locked: false,
        explanation: `Numeric value ${path} cannot be grounded by free-text presence alone; provenance unconfirmed.`
      };
    }
    const sval = String(value);
    if (sval.trim().length >= 3) {
      const r = matchQuote(prepared, sval);
      if (r.found && r.span) return {
        ...base,
        kind: "QUOTE_MATCH",
        outcome: "PASS",
        rule_id: "GROUNDED",
        rule_name: "Value grounded in the source document",
        computation: { formula: "value \u2208 source", operands: { value }, result: true },
        evidence: [spanEvidence2(sourceHash, r.span, r.matchedText ?? "")],
        locked: true,
        explanation: `${path} = "${value}" appears verbatim in the source the agent read.`
      };
    }
    return {
      ...base,
      kind: "QUOTE_MATCH",
      outcome: "INSUFFICIENT_DATA",
      rule_id: "GROUNDED",
      rule_name: "Value grounded in the source document",
      evidence: [],
      insufficiency: { reason: "SPAN_NOT_FOUND", detail: `${path} = ${JSON.stringify(value)} was not found verbatim in the supplied source. Not confirmed grounded \u2014 do not execute on this alone.` },
      locked: false,
      explanation: `Could not ground ${path} in the source; provenance unconfirmed.`
    };
  }
  return {
    ...base,
    kind: "CROSS_REFERENCE",
    outcome: "INSUFFICIENT_DATA",
    rule_id: "GROUNDED",
    rule_name: "Value grounded in an approved source",
    evidence: [],
    insufficiency: { reason: "REFERENCE_NOT_PROVIDED", detail: `no allow-list and no source were declared for ${path}, so its provenance cannot be checked. Supply allowed values or the source document the value must come from.` },
    locked: false,
    explanation: `No source declared for ${path}; provenance unverifiable.`
  };
}
function coverageOf(claims) {
  let pass = 0, fail = 0, ins = 0;
  for (const c of claims) c.outcome === "PASS" ? pass++ : c.outcome === "FAIL" ? fail++ : ins++;
  return { claims_total: claims.length, claims_checked: pass + fail, claims_pass: pass, claims_fail: fail, claims_insufficient: ins };
}
function verifyAction(action, sources = {}, options = {}) {
  const args2 = action.arguments ?? {};
  const required = sources.require ?? Object.keys(args2).filter((k) => isScalar(args2[k]));
  const prepared = typeof sources.text === "string" && sources.text.length > 0 ? prepareSource(sources.text) : void 0;
  const sourceHash = prepared ? sha256(sources.text) : void 0;
  const claims = required.map((path) => {
    const v = args2[path];
    if (!isScalar(v)) {
      return {
        claim_id: `arg.${path}`,
        kind: "CROSS_REFERENCE",
        tier: "DETERMINISTIC",
        outcome: "INSUFFICIENT_DATA",
        field: path,
        asserted: null,
        rule_id: "GROUNDED",
        rule_name: "Value grounded in an approved source",
        evidence: [],
        insufficiency: { reason: "UNPARSEABLE", detail: `${path} is not a scalar value; only scalar arguments (amounts, codes, ids, strings) are checked for grounding.` },
        locked: false,
        explanation: `${path} is not a scalar; not checked.`
      };
    }
    return groundArgument(path, v, sources, prepared, sourceHash);
  });
  const coverage = coverageOf(claims);
  const outcome = coverage.claims_fail > 0 ? "FAIL" : coverage.claims_insufficient > 0 || coverage.claims_checked === 0 ? "INSUFFICIENT_DATA" : "PASS";
  const input_hash = hashOf({ action, sources });
  const verdict_id = sha256(`${input_hash}:${ACTION_RULESET.id}@${ACTION_RULESET.version}:${ENGINE_VERSION}`).slice(0, 32);
  const issued_at = (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  return {
    schema_version: SCHEMA_VERSION,
    verdict_id,
    issued_at,
    engine_version: ENGINE_VERSION,
    ruleset: { ...ACTION_RULESET },
    input_hash,
    replayable: true,
    document: { extraction_hash: hashOf(action), ...options.producer !== void 0 ? { producer: options.producer } : {}, line_items: 0 },
    references: { contract: sources.allowed !== void 0, evidence: 0, history: 0, source: prepared !== void 0 },
    outcome,
    aggregation: "ANY_FAIL_FAILS",
    claims,
    coverage
  };
}

// packages/verify/src/legal/index.ts
var LEGAL_RULESET = { id: "legal", version: "0.0.1", domain: "legal" };
function spanEvidence3(sourceHash, span, text) {
  return { locator: { kind: "span", source_hash: sourceHash, start: span.start, end: span.end }, value: text, confidence: 100, role: "QUOTE" };
}
var NEGATION = /\b(?:not|no|never|cannot|can't|don't|doesn't|didn't|nor|without|fail(?:s|ed|ing)?\s+to|declin\w+\s+to|refus\w+\s+to|reject\w*|decline[ds]?)\b/i;
function precededByNegation(text, start) {
  const before = text.slice(Math.max(0, start - 80), start);
  const clause = before.split(/[.;:!?]/).pop() ?? before;
  return NEGATION.test(clause);
}
function resolveSource(c, sources) {
  for (const k of [c.source_key, c.cite, c.case_name, c.id]) {
    if (k !== void 0 && typeof sources[k] === "string" && sources[k].length > 0) return { key: k, text: sources[k] };
  }
  return null;
}
function verifyCitation(c, sources) {
  const label = c.case_name ?? c.cite ?? c.id;
  const base = {
    claim_id: `cite.${c.id}`,
    kind: "QUOTE_MATCH",
    tier: "DETERMINISTIC",
    field: c.cite ?? c.case_name ?? c.id,
    asserted: c.quote ?? c.proposition ?? label,
    rule_id: "CITE_VERBATIM",
    rule_name: "Citation quoted accurately"
  };
  const src = resolveSource(c, sources);
  if (!src) {
    return {
      ...base,
      outcome: "INSUFFICIENT_DATA",
      evidence: [],
      insufficiency: { reason: "REFERENCE_NOT_PROVIDED", detail: `no opinion text supplied for ${label}; existence and quotation cannot be verified without the source opinion. (Existence-only checking is a separate commodity; we verify the words.)` },
      locked: false,
      explanation: `No opinion text for ${label}; cannot verify.`
    };
  }
  if (c.quote === void 0 || c.quote.trim().length === 0) {
    return {
      ...base,
      outcome: "INSUFFICIENT_DATA",
      evidence: [{ locator: { kind: "field", source: "contract", path: `opinion:${src.key}` }, value: label, confidence: 100, role: "REFERENCE" }],
      insufficiency: { reason: "OUT_OF_RULESET_SCOPE", detail: `whether ${label} stands for the asserted proposition is a semantic judgement the deterministic tier does not make. Supply the quoted language to verify it verbatim, or await the REASONED tier.` },
      locked: false,
      explanation: `${label}: proposition not deterministically decidable; abstaining by design.`
    };
  }
  const prepared = prepareSource(src.text);
  const sourceHash = sha256(src.text);
  const r = matchQuote(prepared, c.quote);
  if (r.found && r.span) {
    if (precededByNegation(src.text, r.span.start)) {
      return {
        ...base,
        outcome: "INSUFFICIENT_DATA",
        evidence: [spanEvidence3(sourceHash, r.span, r.matchedText ?? "")],
        insufficiency: { reason: "SELECTIVE_QUOTE", detail: `the quoted words appear in ${label}, but immediately follow a negation in the opinion (e.g. "we do not hold that\u2026") that the quotation omits. This may be a selective quotation that inverts the holding \u2014 cannot certify as accurately cited; verify in context.` },
        locked: false,
        explanation: `${label}: quoted words present but preceded by a negation the quote omits; not certified \u2014 possible selective quotation.`
      };
    }
    return {
      ...base,
      outcome: "PASS",
      locked: true,
      evidence: [spanEvidence3(sourceHash, r.span, r.matchedText ?? "")],
      explanation: `The quotation attributed to ${label} appears verbatim in the opinion.`
    };
  }
  if (r.reason === "misquote_nearest" && r.nearest) {
    return {
      ...base,
      outcome: "FAIL",
      locked: true,
      computation: { formula: "brief_quote = opinion[cited passage]", operands: { brief_quote: c.quote, opinion_says: r.nearest.text }, result: r.nearest.text },
      evidence: [spanEvidence3(sourceHash, r.nearest.span, r.nearest.text)],
      explanation: `${label} is a real authority, but the quotation is not accurate. The opinion reads: "${r.nearest.text}".`
    };
  }
  return {
    ...base,
    outcome: "INSUFFICIENT_DATA",
    evidence: [],
    insufficiency: { reason: "SPAN_NOT_FOUND", detail: `the quoted passage was not found in the supplied text of ${label}; it may be fabricated, or the supplied opinion text may be incomplete. Not confirmed \u2014 do not rely on this citation as quoted.` },
    locked: false,
    explanation: `${label}: quotation not located in the opinion; abstaining rather than asserting a fabrication.`
  };
}
function coverageOf2(claims) {
  let pass = 0, fail = 0, ins = 0;
  for (const c of claims) c.outcome === "PASS" ? pass++ : c.outcome === "FAIL" ? fail++ : ins++;
  return { claims_total: claims.length, claims_checked: pass + fail, claims_pass: pass, claims_fail: fail, claims_insufficient: ins };
}
function verifyCitations(citations, sources = {}, options = {}) {
  const claims = citations.map((c) => verifyCitation(c, sources));
  const coverage = coverageOf2(claims);
  const outcome = coverage.claims_fail > 0 ? "FAIL" : coverage.claims_checked === 0 ? "INSUFFICIENT_DATA" : "PASS";
  const input_hash = hashOf({ citations, sources });
  const verdict_id = sha256(`${input_hash}:${LEGAL_RULESET.id}@${LEGAL_RULESET.version}:${ENGINE_VERSION}`).slice(0, 32);
  const issued_at = (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  return {
    schema_version: SCHEMA_VERSION,
    verdict_id,
    issued_at,
    engine_version: ENGINE_VERSION,
    ruleset: { ...LEGAL_RULESET },
    input_hash,
    replayable: true,
    document: { extraction_hash: hashOf(citations), ...options.producer !== void 0 ? { producer: options.producer } : {}, line_items: citations.length },
    references: { contract: false, evidence: 0, history: 0, source: Object.keys(sources).length > 0 },
    outcome,
    aggregation: "ANY_FAIL_FAILS",
    claims,
    coverage
  };
}

// packages/verify/src/declarative/lint.ts
var VALID_KINDS = /* @__PURE__ */ new Set(["amount", "rate", "quantity", "string", "bool", "identifier"]);
var VALID_OPS = /* @__PURE__ */ new Set(["=", "<=", ">=", "!="]);
var VALID_COMPARE = /* @__PURE__ */ new Set(["number", "identifier"]);
function lintRuleset(rs) {
  const errors = [];
  const warnings = [];
  if (rs === null || typeof rs !== "object") return { ok: false, errors: ["ruleset must be an object"], warnings };
  const R = rs;
  if (typeof R.id !== "string" || R.id.length === 0) errors.push('missing or empty "id"');
  if (typeof R.version !== "string" || R.version.length === 0) errors.push('missing or empty "version"');
  const fieldsOk = R.fields !== null && typeof R.fields === "object" && !Array.isArray(R.fields) && Object.keys(R.fields).length > 0;
  if (!fieldsOk) errors.push('"fields" must be a non-empty object');
  if (!Array.isArray(R.checks) || R.checks.length === 0) errors.push('"checks" must be a non-empty array');
  if (errors.length > 0) return { ok: false, errors, warnings };
  const fields = R.fields;
  const computed2 = R.computed ?? {};
  const docRoles = new Set(Object.keys(fields).filter((k) => !fields[k].line));
  const lineRoles = new Set(Object.keys(fields).filter((k) => fields[k].line));
  const computedRoles = new Set(Object.keys(computed2));
  const allRoles = /* @__PURE__ */ new Set([...docRoles, ...lineRoles, ...computedRoles]);
  const identifierRoles = new Set(Object.keys(fields).filter((k) => fields[k].kind === "identifier"));
  const noIdentifierArithmetic = (expr, where) => {
    if (typeof expr !== "string") return;
    try {
      for (const ref of referencedRoles(expr)) if (identifierRoles.has(ref)) errors.push(`${where}: identifier field "${ref}" cannot be used in arithmetic (use a check with compare: "identifier")`);
    } catch {
    }
  };
  for (const [role, f] of Object.entries(fields)) {
    if (!Array.isArray(f.paths) || f.paths.length === 0) errors.push(`field "${role}": "paths" must be a non-empty array`);
    if (f.kind !== void 0 && !VALID_KINDS.has(f.kind)) errors.push(`field "${role}": invalid kind "${f.kind}"`);
  }
  for (const r of computedRoles) if (fields[r]) errors.push(`"${r}" is both a field and a computed role \u2014 names must be unique`);
  const dummy = { vars: Object.fromEntries([...allRoles].map((r) => [r, 1])), sum: (r) => lineRoles.has(r) ? 1 : void 0 };
  const parse = (expr, where) => {
    if (typeof expr !== "string" || expr.trim() === "") {
      errors.push(`${where}: expression must be a non-empty string`);
      return;
    }
    try {
      evalExpr(expr, dummy);
    } catch (e) {
      errors.push(`${where}: ${e.message}`);
      return;
    }
    for (const ref of referencedRoles(expr)) if (!allRoles.has(ref)) errors.push(`${where}: references unknown role "${ref}"`);
  };
  for (const [role, formula] of Object.entries(computed2)) {
    parse(formula, `computed "${role}"`);
    noIdentifierArithmetic(formula, `computed "${role}"`);
  }
  const usedRoles = /* @__PURE__ */ new Set();
  R.checks.forEach((c, i) => {
    const where = `check[${i}]${c.code ? ` (${c.code})` : ""}`;
    if (typeof c.code !== "string" || c.code.length === 0) errors.push(`${where}: missing "code"`);
    if (!VALID_OPS.has(c.op)) errors.push(`${where}: invalid op "${c.op}"`);
    const scope = c.scope ?? "document";
    if (c.compare !== void 0 && !VALID_COMPARE.has(c.compare)) {
      errors.push(`${where}: invalid compare "${String(c.compare)}" (number | identifier)`);
      return;
    }
    if (c.compare === "identifier") {
      if (c.op !== "=" && c.op !== "!=") errors.push(`${where}: an identifier check supports only = and !=`);
      for (const side of ["left", "right"]) {
        const name = typeof c[side] === "string" ? c[side].trim() : "";
        usedRoles.add(name);
        const f = Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : void 0;
        if (!f || f.kind !== "identifier") errors.push(`${where}."${side}": an identifier check must name an 'identifier' field (got "${name}")`);
        else if (!!f.line !== (scope === "line")) errors.push(`${where}."${side}": "${name}" is a ${f.line ? "line" : "document"} field but the check is ${scope}-scope`);
      }
      return;
    }
    for (const side of ["left", "right"]) {
      const expr = c[side];
      parse(expr, `${where}."${side}"`);
      noIdentifierArithmetic(expr, `${where}."${side}"`);
      if (typeof expr !== "string") continue;
      for (const ref of referencedRoles(expr)) {
        usedRoles.add(ref);
        if (!allRoles.has(ref)) continue;
        if (scope === "line") {
          if (docRoles.has(ref)) errors.push(`${where}: line-scope check references document field "${ref}" (only line fields are visible per line)`);
          if (computedRoles.has(ref)) errors.push(`${where}: line-scope check references computed role "${ref}" (computed roles are document-scope)`);
          if (/\bsum\s*\(/.test(expr)) errors.push(`${where}: sum() is not available in a line-scope check`);
        } else {
          if (lineRoles.has(ref) && !new RegExp(`\\bsum\\s*\\(\\s*${ref}\\s*\\)`).test(expr)) {
            errors.push(`${where}: document-scope check uses per-line field "${ref}" directly \u2014 wrap it as sum(${ref})`);
          }
        }
      }
    }
  });
  const referencedByComputed = /* @__PURE__ */ new Set();
  for (const formula of Object.values(computed2)) for (const r of referencedRoles(formula)) referencedByComputed.add(r);
  for (const r of allRoles) if (!usedRoles.has(r) && !referencedByComputed.has(r)) warnings.push(`role "${r}" is defined but never used in a check`);
  return { ok: errors.length === 0, errors, warnings };
}

// packages/verify/src/bench/score.ts
var div = (a, b) => b === 0 ? 0 : a / b;
function bucket(label, j) {
  if (j === "INSUFFICIENT_DATA") return "abstain";
  if (label === "ERROR") return j === "FAIL" ? "tp" : "fn";
  return j === "FAIL" ? "fp" : "tn";
}
function score(rows) {
  const c = { tp: 0, tn: 0, fp: 0, fn: 0, abstain: 0, total: rows.length };
  for (const r of rows) c[bucket(r.label, r.judgment)]++;
  const covered = c.tp + c.tn + c.fp + c.fn;
  return {
    ...c,
    fp_rate: div(c.fp, c.fp + c.tn),
    fn_rate: div(c.fn, c.fn + c.tp),
    abstain_rate: div(c.abstain, c.total),
    precision: div(c.tp, c.tp + c.fp),
    recall: div(c.tp, c.tp + c.fn),
    coverage: div(covered, c.total)
  };
}

// packages/verify/src/declarative/measure.ts
function measureRuleset(ruleset, cases) {
  const rows = cases.map((c) => ({ label: c.label, judgment: verifyDeclarative(c.extraction, ruleset).outcome }));
  const metrics = score(rows);
  const measured_on = sha256(canonicalize({ ruleset: { id: ruleset.id, version: ruleset.version }, cases }));
  const accuracy = {
    domain: ruleset.domain ?? ruleset.id,
    ruleset_version: ruleset.version,
    fp_rate: metrics.fp_rate,
    fn_rate: metrics.fn_rate,
    abstain_rate: metrics.abstain_rate,
    measured_on
  };
  return { accuracy, metrics, rows };
}

// packages/verify/src/ledger/chain.ts
var GENESIS = sha256("verify-ledger:genesis:v1");

// packages/verify/src/http/openapi.ts
var verdictRef = { type: "object", description: "The Verdict proof object \u2014 see docs/VERDICT-SCHEMA-v0.md." };
var jsonBody = (required, props) => ({
  required: true,
  content: { "application/json": { schema: { type: "object", required, properties: props } } }
});
var verdictResponse = { "200": { description: "A Verdict.", content: { "application/json": { schema: verdictRef } } }, "400": { description: "Bad request." } };
var OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Verify \u2014 deterministic document & action verification",
    version: ENGINE_VERSION,
    description: "Verify already-extracted document data and proposed agent actions. PASS / FAIL / INSUFFICIENT_DATA with a replayable proof. Never guesses."
  },
  paths: {
    "/v1/health": { get: { summary: "Health + engine version.", responses: { "200": { description: "ok" } } } },
    "/v1/verify": {
      post: {
        summary: "Verify a document under a built-in ruleset (invoice / pay-app).",
        requestBody: jsonBody(["extraction"], { extraction: { type: "object" }, ruleset: { type: "string", enum: ["invoice", "pay-app"] }, references: { type: "object" }, source: { type: "object" }, tolerance: { type: "object" }, producer: { type: "string" } }),
        responses: verdictResponse
      }
    },
    "/v1/verify/declared": {
      post: {
        summary: "Verify a document under a DECLARATIVE (JSON) ruleset \u2014 any document type, any language, no code.",
        requestBody: jsonBody(["extraction", "ruleset"], { extraction: { type: "object" }, ruleset: { type: "object" } }),
        responses: verdictResponse
      }
    },
    "/v1/verify/action": {
      post: {
        summary: "Ground a proposed agent action against an allow-list or source before it executes.",
        requestBody: jsonBody(["action"], { action: { type: "object" }, sources: { type: "object" } }),
        responses: verdictResponse
      }
    },
    "/v1/verify/citations": {
      post: {
        summary: "Cite-check: does each quotation appear verbatim in the supplied opinion text.",
        requestBody: jsonBody(["citations"], { citations: { type: "array", items: { type: "object" } }, sources: { type: "object" } }),
        responses: verdictResponse
      }
    },
    "/v1/verify/quotes": {
      post: {
        summary: "Does a quoted passage / numeric value appear in a source text.",
        requestBody: jsonBody(["source_text"], { source_text: { type: "string" }, quotes: { type: "array" }, values: { type: "array" } }),
        responses: { "200": { description: "source hash + per-assertion claims." } }
      }
    },
    "/v1/verify/batch": {
      post: {
        summary: "Verify many documents in one call; returns an outcome summary + each verdict.",
        requestBody: jsonBody(["items"], { items: { type: "array", items: { type: "object" } } }),
        responses: { "200": { description: "Batch result: count, per-outcome summary, and the verdicts." }, "400": { description: "Bad request." } }
      }
    },
    "/v1/ruleset/lint": {
      post: {
        summary: "Validate a declarative ruleset before it runs (structure, formulas, role references).",
        requestBody: jsonBody(["ruleset"], { ruleset: { type: "object" } }),
        responses: { "200": { description: "Lint result: ok, errors[], warnings[]." }, "400": { description: "Bad request." } }
      }
    },
    "/v1/ruleset/measure": {
      post: {
        summary: "Mint a measured DeclaredAccuracy: run a declarative ruleset over a labeled set (never estimated).",
        requestBody: jsonBody(["ruleset", "cases"], { ruleset: { type: "object" }, cases: { type: "array", items: { type: "object", required: ["extraction", "label"], properties: { extraction: { type: "object" }, label: { type: "string", enum: ["CLEAN", "ERROR"] } } } } }),
        responses: { "200": { description: "accuracy (fp/fn/abstain + measured_on hash), metrics, and per-case rows." }, "400": { description: "Bad request." } }
      }
    },
    "/v1/ledger/stats": { get: { summary: "(managed tier) Verdict counts + real-world overturn rate for the caller\u2019s tenant.", responses: { "200": { description: "LedgerStats." }, "401": { description: "Unauthorized." } } } },
    "/v1/ledger/report": { get: { summary: "(managed tier) The tenant book-of-record report (Markdown): volume, overturn, calibration, tamper-evidence.", responses: { "200": { description: "tenant_id + markdown." }, "401": { description: "Unauthorized." } } } },
    "/v1/ledger/calibration": { get: { summary: "(managed tier) Per-rule human-overturn calibration + the flagged review queue.", responses: { "200": { description: "CalibrationReport." }, "401": { description: "Unauthorized." } } } }
  }
};

// packages/verify/src/http/router.ts
var ok = (json) => ({ status: 200, json });
var bad = (message) => ({ status: 400, json: { error: message } });
var notFound = () => ({ status: 404, json: { error: "not found" } });
var isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
function route(req) {
  const path = req.path.replace(/\/+$/, "") || "/";
  if (req.method === "GET" && (path === "/v1/health" || path === "/health")) return ok({ status: "ok", engine_version: ENGINE_VERSION });
  if (req.method === "GET" && (path === "/v1/openapi.json" || path === "/openapi.json")) return ok(OPENAPI);
  if (req.method !== "POST") return notFound();
  const b = req.body;
  if (!isObj(b)) return bad("request body must be a JSON object");
  try {
    switch (path) {
      case "/v1/verify": {
        if (!isObj(b.extraction)) return bad('"extraction" object is required');
        const { extraction, ...opts } = b;
        return ok(verify(extraction, opts));
      }
      case "/v1/verify/declared": {
        if (!isObj(b.extraction)) return bad('"extraction" object is required');
        if (!isDeclarativeRuleset(b.ruleset)) return bad('a valid declarative "ruleset" (fields + checks) is required');
        return ok(verifyDeclarative(b.extraction, b.ruleset));
      }
      case "/v1/ruleset/lint":
        return ok(lintRuleset(b.ruleset ?? b));
      case "/v1/ruleset/measure": {
        if (!isDeclarativeRuleset(b.ruleset)) return bad('a valid declarative "ruleset" (fields + checks) is required');
        if (!Array.isArray(b.cases)) return bad('a "cases" array of { extraction, label } is required');
        return ok(measureRuleset(b.ruleset, b.cases));
      }
      case "/v1/verify/batch": {
        if (!Array.isArray(b.items)) return bad('"items" array is required');
        return ok(verifyBatch(b.items));
      }
      case "/v1/verify/action": {
        if (!isObj(b.action)) return bad('"action" object is required');
        return ok(verifyAction(b.action, isObj(b.sources) ? b.sources : {}));
      }
      case "/v1/verify/citations": {
        if (!Array.isArray(b.citations)) return bad('"citations" array is required');
        return ok(verifyCitations(b.citations, isObj(b.sources) ? b.sources : {}));
      }
      case "/v1/verify/quotes": {
        if (typeof b.source_text !== "string") return bad('"source_text" string is required');
        const quotes = Array.isArray(b.quotes) ? b.quotes : [];
        const values = Array.isArray(b.values) ? b.values : [];
        return ok(verifyAgainstSource(b.source_text, quotes, values));
      }
      default:
        return notFound();
    }
  } catch (e) {
    return bad(`verification error: ${e.message}`);
  }
}

// packages/verify/src/http/serve.ts
import { createServer } from "node:http";
var headersOf = (req) => {
  const h = {};
  for (const [k, v] of Object.entries(req.headers)) h[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  return h;
};
function nodeHandler(dispatch) {
  return (req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "invalid JSON body" }));
          return;
        }
      }
      const path = (req.url ?? "/").split("?")[0];
      const r = dispatch({ method: req.method ?? "GET", path, body, headers: headersOf(req) });
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(JSON.stringify(r.json));
    });
  };
}
function handle(req, res) {
  nodeHandler(route)(req, res);
}
function serve(port = Number(process.env.PORT ?? 8080)) {
  const server = createServer(handle);
  server.listen(port, () => process.stdout.write(`verify HTTP server listening on :${port}
`));
  return server;
}
if (process.argv[1] && (process.argv[1].endsWith("serve.js") || process.argv[1].endsWith("serve.ts"))) serve();

// packages/verify/src/index.ts
var initialized = /* @__PURE__ */ new Set();
function init(rs) {
  if (initialized.has(rs.id)) return;
  getOntologicalBridge().registerOntology(rs.ontology);
  const registry = getAxiomRegistry();
  for (const a of rs.axioms) registry.register(a);
  setGavelLogger(void 0);
  setBridgeLogger(void 0);
  initialized.add(rs.id);
}
var isObj2 = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
function verify(extraction, options = {}) {
  if (isDeclarativeRuleset(options.ruleset)) {
    return verifyDeclarative(extraction, options.ruleset, {
      ...options.now ? { now: options.now } : {},
      ...options.producer !== void 0 ? { producer: options.producer } : {},
      ...options.tolerance ? { tolerance: options.tolerance } : {}
    });
  }
  const rs = resolveRuleset(options.ruleset);
  init(rs);
  const bridge = getOntologicalBridge();
  const registry = getAxiomRegistry();
  const gavel = getValidationGavel();
  const contractGiven = isObj2(options.references?.contract);
  const contract = contractGiven ? options.references?.contract : {};
  const rawEvidence = options.references?.evidence;
  const evidence = (Array.isArray(rawEvidence) ? rawEvidence : []).filter(isObj2);
  const rawHistory = options.references?.history;
  const history = (Array.isArray(rawHistory) ? rawHistory : []).filter(isObj2);
  const refs = { contract: contractGiven, evidence: evidence.length > 0, history: history.length > 0 };
  const sourceGiven = typeof options.source?.text === "string" && options.source.text.length > 0;
  const input_hash = hashOf({
    extraction,
    references: { contract: options.references?.contract ?? null, evidence: rawEvidence ?? [], history: rawHistory ?? [] },
    source: options.source ?? null
  });
  const extraction_hash = hashOf(extraction);
  const axiomsFor = (codes) => codes.map((c) => registry.getByCode(c)).filter((a) => a !== void 0);
  const lineAxioms = axiomsFor(rs.lineCodes);
  const docAxioms = axiomsFor(rs.documentCodes);
  const lineKeys = rs.ontology.lineArrayKeys ?? ["line_items"];
  const lineKey = lineKeys.find((k) => Array.isArray(extraction[k]));
  const lineCount = lineKey !== void 0 ? extraction[lineKey].length : 0;
  const lineCtxs = lineCount > 0 ? bridge.createLineItemBindings(rs.domain, extraction, contract, evidence) : [];
  const docCtx = bridge.createBindings(rs.domain, extraction, contract, evidence, void 0);
  const { docAbsence, lineAbsence, attach, claims: rulesetClaims } = rs.compute({
    extraction,
    references: { contract: contractGiven ? contract : null, evidence, history },
    docCtx,
    lineCtxs
  });
  const common = { registry, refs, kindByCode: rs.kindByCode, fieldByCode: rs.fieldByCode, referenceRoles: rs.referenceRoles };
  const claims = [];
  const docResults = docAxioms.map((a) => gavel.validateAxiom(a, docCtx));
  claims.push(...toClaimVerdicts(docResults, docCtx, { ...common, claimPrefix: "document", absence: docAbsence }));
  lineCtxs.forEach((ctx, i) => {
    const results = lineAxioms.map((a) => gavel.validateAxiom(a, ctx));
    claims.push(...toClaimVerdicts(results, ctx, { ...common, claimPrefix: `line[${i}]`, absence: lineAbsence[i] ?? {} }));
  });
  if (rulesetClaims) claims.push(...rulesetClaims);
  for (const [claimId, extra] of Object.entries(attach)) attachEvidence(claims, claimId, extra);
  const policy = options.tolerance ?? rs.defaultTolerance ?? { rel: 0, absCap: 0 };
  applyTolerancePolicy(claims, policy);
  abstainOnGuessedOperands(claims);
  abstainOnAmbiguousReference(rs, claims, lineCtxs, contract, contractGiven);
  if (sourceGiven) {
    const text = options.source.text;
    const prepared = prepareSource(text);
    const sourceHash = sha256(text);
    const idOf = (raw) => raw.startsWith("source.") ? raw : `source.${raw}`;
    for (const q of options.source.quotes ?? []) claims.push(verifyQuote({ ...q, id: idOf(q.id) }, prepared, sourceHash));
    for (const v of options.source.values ?? []) claims.push(verifyValueInText({ ...v, id: idOf(v.id) }, prepared, sourceHash));
  }
  const coverage = coverageOf3(claims);
  const outcome = coverage.claims_fail > 0 ? "FAIL" : coverage.claims_checked === 0 ? "INSUFFICIENT_DATA" : "PASS";
  const verdict_id = sha256(`${input_hash}:${rs.id}@${rs.version}:${ENGINE_VERSION}`).slice(0, 32);
  const issued_at = (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  return {
    schema_version: SCHEMA_VERSION,
    verdict_id,
    issued_at,
    engine_version: ENGINE_VERSION,
    ruleset: { id: rs.id, version: rs.version, domain: rs.domain },
    input_hash,
    replayable: true,
    document: {
      extraction_hash,
      ...options.producer !== void 0 ? { producer: options.producer } : {},
      line_items: lineCount
    },
    references: { contract: refs.contract, evidence: evidence.length, history: history.length, source: sourceGiven },
    outcome,
    aggregation: "ANY_FAIL_FAILS",
    claims,
    coverage
  };
}
function verifyBatch(items, shared = {}) {
  const summary = { PASS: 0, FAIL: 0, INSUFFICIENT_DATA: 0 };
  const results = [];
  for (const it of items) {
    const v = verify(it.extraction, { ...it.options ?? {}, ...shared.now ? { now: shared.now } : {} });
    summary[v.outcome]++;
    results.push(v);
  }
  return { count: items.length, summary, results };
}
function referenceMultiplicity(contract, role, ruleset = INVOICE_RULESET) {
  const roots = /* @__PURE__ */ new Set();
  for (const m of ruleset.ontology.mappings) {
    if (m.role !== role || m.documentType !== "contract") continue;
    for (const p of [m.fieldPath, ...m.alternativePaths ?? []]) {
      const i = p.indexOf("[*]");
      if (i > 0) roots.add(p.slice(0, i));
    }
  }
  let max = 0;
  for (const root of roots) {
    if (root.includes(".")) continue;
    const v = contract[root];
    if (Array.isArray(v)) max = Math.max(max, v.filter((x) => x !== null && x !== void 0).length);
  }
  return max;
}
function abstainOnAmbiguousReference(rs, claims, lineCtxs, contract, contractGiven) {
  if (!contractGiven) return;
  for (const [code, role] of rs.ambiguityGuards) {
    const n = referenceMultiplicity(contract, role, rs);
    if (n <= 1) continue;
    lineCtxs.forEach((ctx, i) => {
      if (ctx.correlationInfo?.contract?.isReliable === true) return;
      const c = claims.find((x) => x.claim_id === `line[${i}].${code}`);
      if (!c || c.outcome === "INSUFFICIENT_DATA") return;
      c.outcome = "INSUFFICIENT_DATA";
      c.locked = false;
      delete c.computation;
      delete c.variance;
      c.insufficiency = {
        reason: "AMBIGUOUS_REFERENCE",
        detail: `the contract lists ${n} candidate values for ${role} and no rule could be matched to this line; supply financial_rules[] with a rule_name/description matching the line description, or a single-valued reference`,
        missing: [role]
      };
      c.explanation = `Abstained: ${c.explanation}`;
    });
  }
}
function attachEvidence(claims, claimId, extra) {
  const claim = claims.find((c) => c.claim_id === claimId);
  if (!claim) return;
  const seen = new Set(claim.evidence.map(evidenceKey));
  for (const e of extra) {
    const k = evidenceKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    claim.evidence.push(e);
  }
}
function coverageOf3(claims) {
  let pass = 0, fail = 0, insufficient = 0;
  for (const c of claims) {
    if (c.outcome === "PASS") pass++;
    else if (c.outcome === "FAIL") fail++;
    else insufficient++;
  }
  return {
    claims_total: claims.length,
    claims_checked: pass + fail,
    claims_pass: pass,
    claims_fail: fail,
    claims_insufficient: insufficient
  };
}

// packages/receipts/src/ledger.ts
function memoryStore(seed = []) {
  const entries = [...seed];
  return { load: () => [...entries], append: (e) => {
    entries.push(e);
  } };
}
var GENESIS2 = "0".repeat(64);
var entryHash2 = (e) => sha256(canonicalize({ seq: e.seq, kind: e.kind, at: e.at, body: e.body, prev_hash: e.prev_hash }));
function keyFingerprint(publicKeyPem) {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash2("sha256").update(der).digest("hex").slice(0, 16);
}
function openLedger(store = memoryStore(), opts = {}) {
  const now = opts.now ?? (() => /* @__PURE__ */ new Date());
  return {
    append(kind, body) {
      const all = store.load();
      const prev = all[all.length - 1];
      const partial = { seq: all.length, kind, at: now().toISOString(), body, prev_hash: prev ? prev.hash : GENESIS2 };
      const hash = entryHash2(partial);
      const entry = { ...partial, hash };
      if (opts.signingKey) {
        const key = createPrivateKey(opts.signingKey);
        entry.signature = { alg: "ed25519", public_key: createPublicKey(key).export({ type: "spki", format: "pem" }).toString(), sig: edSign(null, Buffer.from(hash, "utf8"), key).toString("base64") };
      }
      store.append(entry);
      return entry;
    },
    entries: () => store.load(),
    verify: (policy) => verifyChain2(store.load(), policy)
  };
}
function verifyChain2(entries, policy = {}) {
  let prev = GENESIS2;
  let signed = 0;
  let unsigned = 0;
  const signers = /* @__PURE__ */ new Set();
  let expected = null;
  if (policy.publicKey) {
    try {
      expected = keyFingerprint(policy.publicKey);
    } catch {
      return { ok: false, length: entries.length, head: prev, reason: "the expected public key could not be read", signed, unsigned, signers: [] };
    }
  }
  const fail = (i, reason) => ({ ok: false, length: entries.length, head: prev, broken_at: i, reason, signed, unsigned, signers: [...signers] });
  let anchored = !policy.head;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i) return fail(i, `entry ${i} has seq ${e.seq} (reordered or removed entries)`);
    if (e.prev_hash !== prev) return fail(i, `entry ${i} does not follow entry ${i - 1} (chain broken)`);
    if (entryHash2(e) !== e.hash) return fail(i, `entry ${i} was altered after it was written`);
    if (e.signature) {
      let ok2 = false;
      let fp = "";
      try {
        ok2 = edVerify(null, Buffer.from(e.hash, "utf8"), createPublicKey(e.signature.public_key), Buffer.from(e.signature.sig, "base64"));
        fp = keyFingerprint(e.signature.public_key);
      } catch {
        ok2 = false;
      }
      if (!ok2) return fail(i, `entry ${i} signature does not verify`);
      signers.add(fp);
      signed++;
      if (expected && fp !== expected) return fail(i, `entry ${i} is signed by key ${fp}, not the expected ${expected} (re-signed by someone else?)`);
    } else {
      unsigned++;
      if (policy.requireSigned) return fail(i, `entry ${i} is not signed (signatures required)`);
    }
    if (policy.head && e.hash === policy.head) anchored = true;
    prev = e.hash;
  }
  const base = { length: entries.length, head: prev, signed, unsigned, signers: [...signers] };
  if (!anchored) return { ok: false, ...base, reason: `the anchored hash ${policy.head.slice(0, 16)}\u2026 is not in this chain (rewritten or truncated since it was recorded)` };
  return { ok: true, ...base };
}

// packages/receipts/src/file-store.ts
import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
function fileStore(path) {
  return {
    load: () => existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [],
    append: (e) => {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, JSON.stringify(e) + "\n");
    }
  };
}

// packages/receipts/src/claims-cli.ts
var argv = process.argv.slice(2);
var args = parseClaimsArgs(argv);
var read = (p) => readFileSync2(p, "utf8");
if (args.hook && !args.error && !args.help) {
  let opts = { onlyContradicted: args.onlyContradicted, recordOnly: args.recordOnly, strict: args.strict };
  let ledgerPath = args.ledger;
  let mode = args.recordOnly ? "record-only" : args.onlyContradicted ? "only-contradicted" : "block";
  if (args.fromEnv) {
    const env = hookOptionsFromEnv(process.env);
    opts = env.opts;
    mode = env.mode;
    ledgerPath = env.ledger ?? args.ledger;
    for (const p of env.problems) process.stderr.write(`riposte-claims: ${p}
`);
  }
  try {
    const d = stopHook(readFileSync2(0, "utf8"), read, opts);
    if (ledgerPath && d.result?.claims.length) {
      try {
        const signingKey = process.env.RECEIPTS_KEY ? readFileSync2(process.env.RECEIPTS_KEY, "utf8") : void 0;
        openLedger(fileStore(ledgerPath), signingKey ? { signingKey } : {}).append("claims_check", { source: "stop_hook", mode, strict: opts.strict === true, blocked: d.code === 2, would_block: d.wouldBlock === true, ...d.result });
      } catch (e) {
        process.stderr.write(`riposte-claims: ledger not written: ${e.message}
`);
      }
    }
    process.stderr.write(d.stderr);
    process.exitCode = d.code;
  } catch (e) {
    process.stderr.write(`riposte-claims --hook: ${e.message}
`);
    process.exitCode = opts.recordOnly ? 0 : 1;
  }
} else {
  const needStdin = !args.path && !process.stdin.isTTY;
  const r = claimsCli(argv, read, needStdin ? readFileSync2(0, "utf8") : void 0);
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  process.exitCode = r.code;
}
