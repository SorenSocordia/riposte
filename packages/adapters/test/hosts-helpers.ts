// Shared by the host-port tests (hosts-*.test.ts). Not a test file itself.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileStore, hookOptionsFromEnv, ledgerCli, openLedger, stamped, stopHook, stopReceipt } from 'riposte-ai'

export const fixture = (rel: string): string => readFileSync(new URL(`./fixtures/hosts/${rel}`, import.meta.url), 'utf8')
export const fixtureJson = <T = unknown>(rel: string): T => JSON.parse(fixture(rel)) as T

export function scratch(): { dir: string; path: (n: string) => string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'riposte-hosts-'))
  return { dir, path: (n) => join(dir, n), done: () => rmSync(dir, { recursive: true, force: true }) }
}

/** A clock that ticks one second per call from `iso`. */
export function tickingClock(iso: string): () => Date {
  let t = Date.parse(iso) - 1000
  return () => new Date((t += 1000))
}
export const fixedClock = (iso: string) => () => new Date(iso)

export const ledgerAt = (path: string, now?: () => Date) => openLedger(fileStore(path), now ? { now } : {})
export const readEntries = (path: string): Record<string, any>[] =>
  readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
/** `riposte-ledger verify <file>` (the command, as a function). */
export const verifyLedger = (path: string) => ledgerCli(['verify', path], (p) => readFileSync(p, 'utf8'))

/** The Claude Code hook's receipt for a stop: exactly the path `riposte-claims --hook --from-env` takes (claims-cli.ts). */
export function claudeCodeReceipt(transcriptJsonl: string, hook: Record<string, unknown>, env: Record<string, string | undefined>) {
  const e = hookOptionsFromEnv(env)
  const decision = stopHook(JSON.stringify({ hook_event_name: 'Stop', transcript_path: 'session.jsonl', stop_hook_active: false, ...hook }), () => transcriptJsonl, e.opts)
  return { decision, mode: e.mode, receipt: stamped('claims_check', stopReceipt(decision, e.mode, e.opts.strict === true)) }
}

/** A Claude Code transcript written line by line, by hand: independent of the ports' own serialiser. */
export const cc = {
  user: (at: string, text: string) => JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: text } }),
  tool: (at: string, id: string, name: string, input: Record<string, unknown>) =>
    JSON.stringify({ type: 'assistant', timestamp: at, message: { id: `msg-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } }),
  result: (at: string, id: string, text: string, isError: boolean) =>
    JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }] } }),
  say: (at: string, text: string) => JSON.stringify({ type: 'assistant', timestamp: at, message: { id: `msg-${at}`, role: 'assistant', content: [{ type: 'text', text }] } }),
}
export const jsonl = (lines: string[]) => `${lines.join('\n')}\n`

/** Append one body to a fresh ledger with a fixed clock; the file's bytes. */
export function ledgerBytes(dir: string, name: string, body: unknown, at = '2026-10-03T03:30:00.000Z'): string {
  const p = join(dir, name)
  ledgerAt(p, fixedClock(at)).append('claims_check', body)
  return readFileSync(p, 'utf8')
}

export const PASSING = '\n RUN  v4.1.11 /work/app\n\n Test Files  5 passed (5)\n      Tests  62 passed (62)\n'
export const FAILING = '\n RUN  v4.1.11 /work/app\n\n FAIL  test/date.test.ts > parses ISO dates with a trailing space\n Test Files  1 failed | 4 passed (5)\n      Tests  1 failed | 61 passed (62)\n'

/** A host receipt without its `host` key: the Claude Code hook's receipt for the same claim, byte for byte. */
export function withoutHost<T extends Record<string, unknown>>(body: T): Omit<T, 'host'> {
  const { host: _host, ...rest } = body
  return rest
}
