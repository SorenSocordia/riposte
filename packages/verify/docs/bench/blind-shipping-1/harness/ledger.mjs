// blind-shipping-1: the run's ledger (results/ledger.jsonl), one hash-chained JSON line per event.
//
//   node harness/ledger.mjs hash --arm <ap|einvoice|legal> --kind <labels|planted|transcription|...> --file <file or folder>
//        records the sha256 of a file, or a folder's digest (section 2's form), as a hashed record of the arm. Section 3:
//        an arm's labels and planted set are recorded here before the first engine call on that arm.
//   node harness/ledger.mjs note --arm <arm> --text <words>      a dated note (a restart, a correction, a label left undecided)
//   node harness/ledger.mjs check                                   every line chains to the one before it
import { resolve } from 'node:path'
import { args, digestOf, ledgerAppend, ledgerLines } from './lib.mjs'

const [cmd, ...rest] = process.argv.slice(2)
const a = args(rest)
if (cmd === 'hash') {
  if (!['ap', 'einvoice', 'legal'].includes(a.arm) || !a.kind || !a.file) { console.error('hash --arm <ap|einvoice|legal> --kind <kind> --file <path>'); process.exit(3) }
  const line = ledgerAppend({ arm: a.arm, event: 'hashed', kind: a.kind, sha256: digestOf(resolve(a.file)) })
  console.log(line)
} else if (cmd === 'note') {
  if (!a.arm || !a.text) { console.error('note --arm <arm> --text <words>'); process.exit(3) }
  console.log(ledgerAppend({ arm: a.arm, event: 'note', text: a.text }))
} else if (cmd === 'check') {
  const lines = ledgerLines()
  console.log(`ledger: ${lines.length} line(s), every line chains to the one before it`)
} else { console.error('usage: ledger.mjs hash | note | check'); process.exit(3) }
