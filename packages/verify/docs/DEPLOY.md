# Deployment — on-prem, air-gapped

**No outbound network at runtime.** The engine is deterministic: it makes no model calls, uses no cloud service and sends no
telemetry. It computes a verdict locally and returns it, so it can run inside an air-gapped network and produce exactly the
same verdicts. The data never leaves your perimeter.

## Run it

```bash
# container (build context: packages/verify)
docker build -t riposte-verify packages/verify
docker run -p 8080:8080 riposte-verify
curl -s localhost:8080/v1/health
curl -s localhost:8080/v1/verify -H 'content-type: application/json' \
  -d '{"extraction":{"line_items":[{"quantity":2,"unit_price":50,"amount":100}],"totals":{"subtotal":100,"tax_rate":0,"tax":0,"total":100}}}'

# or without docker (node ≥ 20), from the repository root
npm install && npm run build
npm run serve -w riposte-verify     # HTTP on :8080
npm run mcp -w riposte-verify       # MCP over stdio (for agents)
```

## Air-gapped build

The only runtime dependency is `jsonpath-plus`. Build the image (or `npm install`) once on a networked machine. Then move the
image (`docker save` / `docker load`), or the built `dist/` plus its `node_modules`, into the isolated environment. Nothing
phones home, and there is nothing to allow-list.

## Surfaces

- **HTTP:** `/v1/verify`, `/v1/verify/declared`, `/v1/verify/action`, `/v1/verify/citations`, `/v1/verify/quotes`. See
  `GET /v1/openapi.json`.
- **MCP:** `riposte-verify-mcp` exposes the same capabilities as tools an agent can call.
- **CLI:** `riposte-verify file.json`, for batch jobs and scripting.
- **Library:** `import { verify, verifyDeclarative, createLedger } from 'riposte-verify'`.
