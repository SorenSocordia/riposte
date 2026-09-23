/**
 * Newline-delimited JSON-RPC stdio transport for the MCP server. Each line on stdin is one request; each response is
 * written as one line on stdout. Malformed lines get a JSON-RPC parse error; notifications get no reply.
 *
 * Run: `node dist/mcp/stdio.js` (or via the bin shim). No arguments, no config, no network.
 */

import { createInterface } from 'node:readline'
import { handleRequest, type JsonRpcRequest, type JsonRpcResponse } from './server.js'

export function serve(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): void {
  const rl = createInterface({ input, crlfDelay: Infinity })
  const write = (r: JsonRpcResponse): void => { output.write(`${JSON.stringify(r)}\n`) }

  rl.on('line', line => {
    const trimmed = line.trim()
    if (trimmed.length === 0) return
    let req: JsonRpcRequest
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
      return
    }
    const res = handleRequest(req)
    if (res !== null) write(res)
  })
}

// Run when invoked directly.
if (process.argv[1] && (process.argv[1].endsWith('stdio.js') || process.argv[1].endsWith('stdio.ts'))) {
  serve()
}
