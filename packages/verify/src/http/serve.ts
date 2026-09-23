/**
 * Thin node:http transport around the pure router. `verify-serve` (or `node dist/http/serve.js`) runs the verifier as a
 * JSON HTTP service — no framework, no dependencies. Body is read, parsed, routed; the response is JSON.
 *
 *   PORT=8080 node dist/http/serve.js
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { route, type HttpRequest, type HttpResponse } from './router.js'
import type { Service } from './service.js'

const headersOf = (req: IncomingMessage): Record<string, string | undefined> => {
  const h: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(req.headers)) h[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v
  return h
}

/** Build a node:http handler from any `(HttpRequest) => HttpResponse` — the pure router by default, or a Service. */
export function nodeHandler(dispatch: (req: HttpRequest) => HttpResponse) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c as Buffer))
    req.on('end', () => {
      let body: unknown
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.length > 0) {
        try { body = JSON.parse(raw) } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid JSON body' })); return }
      }
      const path = (req.url ?? '/').split('?')[0] as string
      const r = dispatch({ method: req.method ?? 'GET', path, body, headers: headersOf(req) } satisfies HttpRequest)
      res.writeHead(r.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(r.json))
    })
  }
}

export function handle(req: IncomingMessage, res: ServerResponse): void {
  nodeHandler(route)(req, res)
}

export function serve(port = Number(process.env.PORT ?? 8080)): ReturnType<typeof createServer> {
  const server = createServer(handle)
  server.listen(port, () => process.stdout.write(`verify HTTP server listening on :${port}\n`))
  return server
}

/** Serve the stateful managed tier (auth + rate-limit + auto-record) around the pure core. */
export function serveService(service: Service, port = Number(process.env.PORT ?? 8080)): ReturnType<typeof createServer> {
  const server = createServer(nodeHandler(req => service.handle(req)))
  server.listen(port, () => process.stdout.write(`verify managed service listening on :${port}\n`))
  return server
}

if (process.argv[1] && (process.argv[1].endsWith('serve.js') || process.argv[1].endsWith('serve.ts'))) serve()
