import crypto from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process'
const D = import.meta.dirname; const CLI = path.resolve(D, '../../repo/packages/receipts/dist/ledger-cli.js')
const { entryHash, openLedger, memoryStore } = await import('../../repo/packages/receipts/dist/index.js')
const src = fs.readFileSync(path.join(D, 'receipts.jsonl'), 'utf8'); const head = fs.readFileSync(path.join(D, 'receipts.jsonl.head.json'), 'utf8')
const E = src.trim().split('\n').map(JSON.parse); const H0 = JSON.parse(head).head
function v(label, entries, { sidecar = 'orig', args = [] } = {}) {
  const dir = path.join(D, 'case-' + label.replace(/[^A-Za-z0-9]/g, '_')); fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, 'receipts.jsonl')
  fs.writeFileSync(f, entries.map(e => typeof e === 'string' ? e : JSON.stringify(e)).join('\n') + '\n')
  const sc = f + '.head.json'; fs.rmSync(sc, { force: true })
  if (sidecar === 'orig') fs.writeFileSync(sc, head)
  if (sidecar === 'recomputed') { const b = fs.readFileSync(f); const last = entries[entries.length - 1]; fs.writeFileSync(sc, JSON.stringify({ version: 1, ledger: 'receipts.jsonl', count: entries.length, head: last.hash, bytes: b.length, updated_at: new Date().toISOString() })) }
  const r = spawnSync('node', [CLI, 'verify', f, ...args], { encoding: 'utf8' }); let j = {}; try { j = JSON.parse(r.stdout) } catch {}
  console.log(`${label.padEnd(44)} exit=${r.status} ok=${j.ok} chain=${j.chain_ok} sigs=${j.signatures_ok} | ${(j.reason || r.stderr.split('\n')[0] || '').slice(0, 150)}`)
}
const C = (x) => JSON.parse(JSON.stringify(x))
// recompute a chain from index i on; optionally re-sign with a key
async function rechain(entries, signer) { const out = []; let prev = entries[0].prev_hash
  for (const e0 of entries) { const e = C(e0); e.prev_hash = prev; delete e.hash; delete e.signature; e.hash = entryHash(e)
    if (signer) e.signature = { alg: 'ed25519', public_key: signer.pub, sig: crypto.sign(null, Buffer.from(e.hash, 'utf8'), signer.priv).toString('base64') }
    prev = e.hash; out.push(e) } return out }
const pubPem = fs.readFileSync(path.join(D, 'pub.pem'), 'utf8'); const K = ['--key', path.join(D, 'pub.pem')]
v('pristine', E); v('pristine --key', E, { args: K })
v('edit body of entry 3 (HOLD->EXECUTE)', E.map((e, i) => i === 2 ? { ...e, body: { ...e.body, decision: 'EXECUTE' } } : e), { args: K })
v('reorder 2<->3', [E[0], E[2], E[1], E[3], E[4]], { args: K })
v('delete entry 3', [E[0], E[1], E[3], E[4]], { args: K })
v('cut last 2, original head record', E.slice(0, 3), { args: K })
v('cut last 2, head record deleted', E.slice(0, 3), { sidecar: 'none', args: K })
v('cut last 2, head deleted, --no-sidecar', E.slice(0, 3), { sidecar: 'none', args: [...K, '--no-sidecar'] })
v('cut last 2, head recomputed', E.slice(0, 3), { sidecar: 'recomputed', args: K })
v('cut last 2, head recomputed, --head H0', E.slice(0, 3), { sidecar: 'recomputed', args: [...K, '--head', H0] })
const ed = E.map((e, i) => i === 2 ? { ...e, body: { ...e.body, decision: 'EXECUTE' } } : e)
const unsigned = await rechain(ed, null)
v('edit+rechain unsigned, head recomputed', unsigned, { sidecar: 'recomputed' })
v('edit+rechain unsigned, --key', unsigned, { sidecar: 'recomputed', args: K })
const atk = crypto.generateKeyPairSync('ed25519'); const signer = { priv: atk.privateKey, pub: atk.publicKey.export({ type: 'spki', format: 'pem' }) }
let resigned; try { resigned = await rechain(ed, signer) } catch (e) { console.log('rechain-sign failed', e.message) }
if (resigned) { v('edit+rechain re-signed attacker key, no --key', resigned, { sidecar: 'recomputed' }); v('edit+rechain re-signed attacker key, --key', resigned, { sidecar: 'recomputed', args: K }); v('edit+rechain re-signed, --head H0', resigned, { sidecar: 'recomputed', args: ['--head', H0] }) }
v('torn tail', [...E.slice(0, 4), JSON.stringify(E[4]).slice(0, 80)], { args: K })
v('dup key in entry line', E.map((e, i) => i === 1 ? JSON.stringify(e).replace('"seq":1', '"seq":1,"seq":1') : e), { args: K })
