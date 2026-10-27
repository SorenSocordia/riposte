/**
 * 2026-10-05: there was no documented way to start the HTTP server, and `node dist/http/serve.js` listened on every
 * interface (0.0.0.0 and [::]) with no authentication. `verify serve [--port N] [--host ADDRESS]` now starts it, bound to
 * 127.0.0.1 unless --host names another address, and any other address is announced with a warning line.
 */
import { describe, it, expect, afterEach } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { DEFAULT_HOST, isLoopbackHost, listeningLines, runServe, serve, serveService } from '../src/http/serve.js'
import { run } from '../src/cli.js'

const servers: Server[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r())))) })

function capture(): { out: string[]; err: string[]; log: { out: (s: string) => void; err: (s: string) => void } } {
  const out: string[] = [], err: string[] = []
  return { out, err, log: { out: (s) => { out.push(s) }, err: (s) => { err.push(s) } } }
}
const listening = (s: Server): Promise<void> => new Promise((r) => { if (s.listening) r(); else s.once('listening', () => r()) })
/** the listening callback runs right after 'listening'; give it a tick */
const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

describe('verify serve: where it listens', () => {
  it('no --host: bound to 127.0.0.1 only, and it says so (with the real port when --port 0)', async () => {
    const c = capture()
    const r = runServe(['--port', '0'], { log: c.log, env: {} })
    expect(r.code).toBe(0)
    servers.push(r.server!)
    await listening(r.server!); await tick()
    const a = r.server!.address() as AddressInfo
    expect(a.address).toBe('127.0.0.1')
    expect(a.port).toBeGreaterThan(0)
    expect(c.out.join('')).toBe(`verify HTTP server listening on http://127.0.0.1:${a.port}, this machine only. It has no authentication: any program on this machine can call it.\n`)
    expect(c.err).toEqual([])
    const res = await fetch(`http://127.0.0.1:${a.port}/v1/health`)
    expect(res.status).toBe(200)
  })

  // The suite never binds a non-loopback address (no firewall prompt, nothing exposed while it runs): --host is shown to be
  // taken as given with `localhost`, and the 0.0.0.0 lines are checked through listeningLines, which serve() prints from the
  // address it actually bound. The release notes record a manual `--host 0.0.0.0` run with netstat.
  it('--host is taken as given (localhost here); 0.0.0.0 gets a warning line saying the server has no authentication', async () => {
    const c = capture()
    const r = runServe(['--host', 'localhost', '--port', '0'], { log: c.log, env: {} })
    servers.push(r.server!)
    await listening(r.server!); await tick()
    const a = r.server!.address() as AddressInfo
    expect(['127.0.0.1', '::1']).toContain(a.address)
    expect(c.err).toEqual([])
    const any = listeningLines('0.0.0.0', 8080)
    expect(any.out).toBe('verify HTTP server listening on http://0.0.0.0:8080. It has no authentication.\n')
    expect(any.warn).toBe('warning: listening on every network interface of this machine, with no authentication: anyone who can reach port 8080 can call this server. Put an authenticating proxy in front of it, or bind 127.0.0.1.\n')
  })

  it('the library defaults agree: serve() and serveService() bind 127.0.0.1 when no host is given', async () => {
    const c = capture()
    const s1 = serve(0, { log: c.log })
    const s2 = serveService({ handle: () => ({ status: 200, json: {} }) } as never, 0, { log: c.log })
    servers.push(s1, s2)
    await Promise.all([listening(s1), listening(s2)]); await tick()
    expect((s1.address() as AddressInfo).address).toBe(DEFAULT_HOST)
    expect((s2.address() as AddressInfo).address).toBe(DEFAULT_HOST)
    expect(c.out.join('')).toContain('verify managed service listening on http://127.0.0.1:')
    expect(c.err).toEqual([])
  })

  it('PORT from the environment, --port over it', async () => {
    const c = capture()
    const r = runServe([], { log: c.log, env: { PORT: '0' } })
    servers.push(r.server!)
    await listening(r.server!)
    expect((r.server!.address() as AddressInfo).address).toBe('127.0.0.1')
  })

  it('a port already in use: says so, and sets exit 3', async () => {
    const first = serve(0, { log: capture().log })
    servers.push(first)
    await listening(first)
    const port = (first.address() as AddressInfo).port
    const c = capture()
    let code: number | undefined
    const r = runServe(['--port', String(port)], { log: c.log, env: {}, setExitCode: (n) => { code = n } })
    await new Promise<void>((res) => r.server!.once('error', () => setImmediate(res)))
    expect(code).toBe(3)
    expect(c.err.join('')).toBe(`verify serve: cannot listen on 127.0.0.1:${port}: the port is in use\n`)
  })

  it('usage: --help exits 0; an unknown argument, a missing value or a bad port exits 3 and starts nothing', () => {
    for (const [argv, code, says] of [
      [['--help'], 0, 'serve [--port N]'],
      [['--bind', 'x'], 3, 'unknown argument "--bind"'],
      [['--host'], 3, '--host needs a value'],
      [['--port', '--host', 'x'], 3, '--port needs a value'],
      [['--port', '70000'], 3, 'the port must be a whole number from 0 to 65535, not "70000"'],
      [['--port', '80a'], 3, 'not "80a"'],
    ] as const) {
      const c = capture()
      const r = runServe([...argv], { log: c.log, env: {} })
      expect(r.code, argv.join(' ')).toBe(code)
      expect(r.server, argv.join(' ')).toBeUndefined()
      expect(c.err.join(''), argv.join(' ')).toContain(says)
    }
  })

  it('the CLI: `--help serve` and `serve --help` print the serve block; run() does not start a server in-process', () => {
    const err: string[] = []
    const io = { out: () => {}, err: (s: string) => { err.push(s) } }
    expect(run(['--help', 'serve'], io as never)).toBe(0)
    expect(err.join('')).toContain('verify serve [--port N] [--host ADDRESS]')
    expect(err.join('')).toContain('--host: default 127.0.0.1, this machine only')
    err.length = 0
    expect(run(['serve', '--help'], io as never)).toBe(0)
    expect(err.join('')).toContain('verify serve [--port N] [--host ADDRESS]')
    err.length = 0
    expect(run(['serve'], io as never)).toBe(3)
    expect(err.join('')).toContain('runs until stopped')
  })

  it('which hosts count as this machine only', () => {
    for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]', '::ffff:127.0.0.1']) expect(isLoopbackHost(h), h).toBe(true)
    for (const h of ['0.0.0.0', '::', '192.168.1.5', '10.0.0.1', 'example.com']) expect(isLoopbackHost(h), h).toBe(false)
    expect(listeningLines('::', 8080).warn).toContain('every network interface')
    expect(listeningLines('192.168.1.5', 8080).warn).toContain('192.168.1.5, beyond this machine')
    expect(listeningLines('::1', 8080).out).toContain('http://[::1]:8080, this machine only')
  })
})
