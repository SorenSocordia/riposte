/**
 * Newline-delimited JSON-RPC stdio transport for the MCP server. Each line on stdin is one request; each response is
 * written as one line on stdout. Malformed lines get a JSON-RPC parse error; notifications get no reply.
 *
 * 2026-10-05: each line is read under the hash contract (protocol/hash-input.ts), as the CLI reads a file.
 * Lines are split on the newline BYTE and decoded as UTF-8 with a fatal decoder (a byte that is not UTF-8 used to become U+FFFD),
 * and parsed by parseJsonStrict: a key repeated in one object and a number past the double range (1e999, read as Infinity and
 * hashed as null) are refused with a parse error naming where, never answered with a verdict. A trailing CR is dropped (CRLF).
 *
 * Run: `node dist/mcp/stdio.js` (or via the bin shim). No network. It takes two arguments (2026-10-19), as the gate server does:
 *   --policy <policy.json>  the operator's policy ({ "price_tolerance": <0 to 1>, "total_tolerance"?: <0 to 1> }), read once,
 *                           under the hash contract, and pinned for the life of the process; or RIPOSTE_VERIFY_MCP_POLICY=<policy.json>
 *                           (the flag wins). verify_invoice_match takes a lower price_tolerance, never a higher one. Its digest
 *                           is printed on stderr at start and in the instructions a host reads on initialize.
 *   --strict                refuse to start without a pinned policy.
 * Without a policy it runs on the engine's documented defaults (price_tolerance 0.02, total_tolerance 0.005) and says so, on
 * stderr at start. Before 2026-10-19 it took no argument and `price_tolerance` was the calling agent's, with no bound.
 *   exit 0  stdin closed, or --help (usage on stdout)
 *   exit 3  any other argument, --strict without a policy, or a policy file that cannot be read or is not a policy (why, on stderr)
 */

import { readFileSync } from 'node:fs'
import { handleRequest, readPolicy, configFor, DEFAULT_CONFIG, type JsonRpcRequest, type JsonRpcResponse, type OperatorConfig } from './server.js'
import { decodeUtf8Strict, parseJsonStrict, HashInputRefused } from '../protocol/hash-input.js'

export const USAGE = 'usage: node dist/mcp/stdio.js [--policy <policy.json>] [--strict]\n' +
  '  The engine as an MCP server on stdin/stdout (one JSON-RPC message per line). It opens no network connection.\n' +
  '  --policy <policy.json>  the operator\'s policy ({ "price_tolerance": 0.02, "total_tolerance"?: 0.005 }), pinned for the life of the\n' +
  '                          process; or RIPOSTE_VERIFY_MCP_POLICY=<policy.json>. A caller may lower price_tolerance, never raise it.\n' +
  '  --strict                refuse to start without a pinned policy.\n' +
  '  Without a policy it runs on the documented defaults (price_tolerance 0.02) and says so on stderr at start.\n'

/**
 * The config the process runs under, from its arguments and environment, or why it does not start (2026-10-19). `readBytes`
 * reads a policy file; its bytes are decoded under the hash contract (decodeUtf8Strict) and read by readPolicy.
 */
export function configure(argv: readonly string[], env: Record<string, string | undefined>, readBytes: (path: string) => Uint8Array): { config: OperatorConfig; strict: boolean } | { help: true } | { error: string } {
  let policyPath: string | undefined
  let strict = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--help' || a === '-h') return { help: true }
    if (a === '--strict') strict = true
    else if (a === '--policy') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) return { error: '--policy needs a value: the policy file' }
      policyPath = v
    } else return { error: `unknown argument ${JSON.stringify(a)} (it takes --policy <policy.json> and --strict only)` }
  }
  const fromEnv = env.RIPOSTE_VERIFY_MCP_POLICY
  const source = policyPath !== undefined ? policyPath : fromEnv ? 'RIPOSTE_VERIFY_MCP_POLICY' : undefined
  const path = policyPath ?? (fromEnv || undefined)
  if (path === undefined) {
    if (strict) return { error: '--strict needs a pinned policy: give --policy <policy.json> (or RIPOSTE_VERIFY_MCP_POLICY=<policy.json>) naming price_tolerance; without one the server would run on its defaults, and strict mode refuses to start that way' }
    return { config: DEFAULT_CONFIG, strict }
  }
  let bytes: Uint8Array
  try { bytes = readBytes(path) } catch (e) { return { error: `cannot read the policy file ${path}: ${(e as Error).message}` } }
  try { return { config: configFor(readPolicy(decodeUtf8Strict(bytes, `the policy file ${path}`), `the policy file ${path}`), source), strict } } catch (e) { return { error: (e as Error).message } }
}

/** The line on stderr at start: the policy in force, where the operator reads (stderr is the host's log, never the protocol stream). */
export function startLine(config: OperatorConfig, strict = false): string {
  const p = config.policy
  return config.pinned
    ? `verify-mcp: policy ${config.policy_digest} price_tolerance ${p.price_tolerance} total_tolerance ${p.total_tolerance} pinned from ${config.source}${strict ? ' (strict)' : ''}\n`
    : `verify-mcp: no policy pinned: running on the defaults (policy ${config.policy_digest} price_tolerance ${p.price_tolerance} total_tolerance ${p.total_tolerance}). Pin one with --policy <policy.json>\n`
}

export function serve(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout, config: OperatorConfig = DEFAULT_CONFIG): void {
  const write = (r: JsonRpcResponse): void => { output.write(`${JSON.stringify(r)}\n`) }
  const parseError = (e: unknown): void => {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: e instanceof HashInputRefused ? `parse error: ${e.message}` : 'parse error' } })
  }

  const onLine = (bytes: Buffer): void => {
    const b = bytes.length > 0 && bytes[bytes.length - 1] === 0x0d ? bytes.subarray(0, bytes.length - 1) : bytes
    let text: string
    try { text = decodeUtf8Strict(b, 'the request line') } catch (e) { parseError(e); return }
    const trimmed = text.trim()
    if (trimmed.length === 0) return
    let req: JsonRpcRequest
    try { req = parseJsonStrict(trimmed, 'the request line') as JsonRpcRequest } catch (e) { parseError(e); return }
    const res = handleRequest(req, config)
    if (res !== null) write(res)
  }

  let pending: Buffer[] = []
  input.on('data', (chunk: Buffer | string) => {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    let start = 0
    for (let nl = buf.indexOf(0x0a); nl >= 0; nl = buf.indexOf(0x0a, start)) {
      pending.push(buf.subarray(start, nl))
      const line = Buffer.concat(pending)
      pending = []
      start = nl + 1
      onLine(line)
    }
    if (start < buf.length) pending.push(buf.subarray(start))
  })
  input.on('end', () => {
    if (!pending.length) return
    const line = Buffer.concat(pending)
    pending = []
    onLine(line)
  })
}

// Run when invoked directly.
if (process.argv[1] && (process.argv[1].endsWith('stdio.js') || process.argv[1].endsWith('stdio.ts'))) {
  const c = configure(process.argv.slice(2), process.env, (p) => readFileSync(p))
  if ('help' in c) process.stdout.write(USAGE)
  else if ('error' in c) {
    process.stderr.write(`verify-mcp: ${c.error}\n${USAGE}`)
    process.exitCode = 3
  } else {
    process.stderr.write(startLine(c.config, c.strict))
    serve(process.stdin, process.stdout, c.config)
  }
}
