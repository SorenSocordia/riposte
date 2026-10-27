# Deployment — on-prem, air-gapped

**No outbound network at runtime.** The engine is deterministic: it makes no model calls, uses no cloud service and sends no
telemetry. It computes a verdict locally and returns it, so it can run inside an air-gapped network and produce exactly the
same verdicts. Its checks make no network calls. Three things can reach the network, each only when you use it:
`bench stamp <file> --tsa <url>` runs curl to send that file's sha256 to the timestamp authority you name; the library's
webhook dispatcher POSTs a verdict to a URL, and only when an integrator wires it into the HTTP service in code (nothing
shipped here does); and the library's typed SDK client calls the HTTP server at the address its caller gives. The HTTP
server listens only when you start it, on 127.0.0.1 unless you name another address (below). Nothing the engine does sends
your documents anywhere; where its verdicts go next is up to you.

## Run it

```bash
# without docker (node ≥ 20), from the repository root; plain npm install works under npm 11.6.2 and fails under npm 10.9.x
npm install --legacy-peer-deps && npm run build
node packages/verify/dist/cli.js serve            # HTTP on 127.0.0.1:8080 (installed: riposte-verify serve)
node packages/verify/dist/cli.js serve --port 9000 --host 0.0.0.0   # every interface: prints a warning (no authentication)
curl -s 127.0.0.1:8080/v1/health
curl -s 127.0.0.1:8080/v1/verify -H 'content-type: application/json' \
  -d '{"extraction":{"line_items":[{"quantity":2,"unit_price":50,"amount":100}],"totals":{"subtotal":100,"tax_rate":0,"tax":0,"total":100}}}'
npm run mcp -w riposte-verify                     # MCP over stdio (for agents)

# container, built from the repository root: it installs only from the root's package-lock.json (npm ci), and with no
# lockfile the build stops at its first step and says so
docker build -f packages/verify/Dockerfile -t riposte-verify .
docker run -p 127.0.0.1:8080:8080 riposte-verify  # published on this machine's loopback only
```

**Where it listens.** `serve` binds 127.0.0.1 by default, so only programs on the same machine can reach it. The HTTP
server in the engine has no authentication: any program that can reach the port can call every route. `--host <address>`
binds another interface (`0.0.0.0` is every interface), and the server then prints a warning line on start. Put an
authenticating reverse proxy in front of it before you do. The container listens on 0.0.0.0 inside the container, because
a published port cannot reach 127.0.0.1 there, and prints the same warning; `-p 127.0.0.1:8080:8080` keeps the published
port on the host's loopback. `--port` defaults to `$PORT`, else 8080. A port that is in use exits 3 and says so.

**What it answers.** A request is answered only when its `Host` header names `localhost`, `127.0.0.1`, `::1`, the address
the server is bound to, or, for a `0.0.0.0` or `::` bind, an address of this machine (inside a container, the container's
own). Any other name gets `421` and says why, before the body is read. That stops a web page on another site from pointing
its own name at your machine and calling the server through your browser (DNS rebinding). Behind a proxy that forwards the
public name, add it with `--allow-host <name>` (repeatable). A request with no `Host` header is refused with `400` and
says so (`request.host_missing`), on HTTP/1.0 as on HTTP/1.1, before the body is read; an HTTP/1.0 client must add one
(`Host: 127.0.0.1`). A request body is read only when it is sent with `Content-Type: application/json` (a `charset` parameter is fine); any other
type, or none, gets `415` and says so. A page on another site can post `text/plain` or a form to your machine without
asking first, but it cannot send `application/json` to another site unless the server agrees, and this server sends no CORS
headers, so it never does. Inside the body, text that is not UTF-8, a key written twice in one object, a number past the
double range (`1e999`), a number that cannot be represented exactly (`9007199254740993`) and JSON nested more than 256
levels deep are each a `400` naming the place, never a verdict; write amounts as strings with two decimals. A body over 4 MiB
is a `413` (32 MiB on the routes that carry a whole filing or book). `GET /v1/openapi.json` lists the routes this server
serves; the routes that need a book of record (`/v1/ledger/*`, `/v1/voice/{workflow}`, `/v1/queue/{workflow}`,
`/v1/grant/cosign`) are served, and listed, only by the managed tier when it holds a ledger.

**What one check may cost.** `serve` checks every POST in a worker thread, apart from the thread that answers requests, so
`/v1/health` keeps answering while a check runs. Each check gets 60 seconds and 512 MiB of heap; two run at once and up to
16 more wait, each for at most one check's time, after which the answer is `503` with `Retry-After: 1`. A check past its
time or its heap is stopped and answered `413`, "input too large to check within the service's budget; run it with the
command line", with `x-verify-gate: INSUFFICIENT_DATA` and `x-verify-exit: 2`, so a caller that acts on the exit header
fails closed. That answer is not a verdict, and the server and every other request stay up. The command line runs the same check with no budget.
`--check-timeout-ms`, `--check-heap-mb` and `--check-workers` raise the budget (or `VERIFY_CHECK_TIMEOUT_MS`,
`VERIFY_CHECK_HEAP_MB`, `VERIFY_CHECK_WORKERS`; a flag wins). Plan memory as workers times heap, plus the server itself. For
scale: the 40 citations of the shipped legal blind set, against 2 MB of opinions in one request, take about 11 s.

## Air-gapped build

The only runtime dependency is `jsonpath-plus`. Build the image (from the repository root, as above), or run the install,
once on a networked machine. Then move the
image (`docker save` / `docker load`), or the built `dist/` plus its `node_modules`, into the isolated environment. Nothing
phones home, and there is nothing to allow-list.

## Surfaces

- **HTTP:** `/v1/verify`, `/v1/verify/declared`, `/v1/verify/action`, `/v1/verify/citations`, `/v1/verify/quotes`. See
  `GET /v1/openapi.json`.
- **MCP:** `node packages/verify/dist/mcp/stdio.js` (installed: `riposte-verify-mcp`) exposes the same capabilities as
  tools an agent can call.
- **CLI:** `node packages/verify/dist/cli.js file.json`, for batch jobs and scripting. Installed as a package, the same
  program is `riposte-verify`, and pages that say `verify` mean it too.
- **Library:** `import { verify, verifyDeclarative, createLedger } from 'riposte-verify'`.

Every surface reads a verdict the same way, failing closed: only a clean PASS is a pass. A PASS on which a check could not
run (`PASS-WITH-OPEN`) exits 2 on the CLI. Over HTTP the answer stays 200 and carries `x-verify-gate` and `x-verify-exit`
headers; the exit header is 2 for that case. Each MCP verdict tool's reply leads with a gate line carrying the same exit. The opt-out is
stated, never silent: `--allow-open` on the CLI, or `"allow_open": true` in an HTTP body or MCP call.
