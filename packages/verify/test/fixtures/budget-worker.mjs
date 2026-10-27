// A stand-in check worker for test/http-check-budget.test.ts: it speaks the check worker's messages (src/http/check-worker.ts)
// and does what the request body asks, so the pool's time and memory limits can be tested whatever the engine's own costs.
//   { "spin_ms": N }    keep the thread busy for N ms, then answer 200
//   { "allocate": true } allocate until the heap limit stops the worker
//   anything else       answer 200 at once
import { parentPort } from 'node:worker_threads'

parentPort.on('message', (job) => {
  const text = job.kind === 'bytes' && job.bytes ? new TextDecoder().decode(job.bytes) : ''
  const body = text ? JSON.parse(text) : {}
  if (typeof body.spin_ms === 'number') { const until = Date.now() + body.spin_ms; while (Date.now() < until) { /* busy */ } }
  if (body.allocate === true) { const keep = []; for (;;) keep.push(new Array(1_000_000).fill(keep.length)) }
  parentPort.postMessage({ id: job.id, status: 200, text: JSON.stringify({ ok: true, path: job.meta?.path }) })
})
parentPort.postMessage({ ready: true })
