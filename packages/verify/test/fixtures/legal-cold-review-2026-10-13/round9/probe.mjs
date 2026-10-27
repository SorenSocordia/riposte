// Batch probe: separate-opinion designation styles and lead-in frames.
// Each variant gets its own opinion text and the same quotation; we record the answer.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const cli = here + '../repo/packages/verify/dist/cli.js';
const head = (n) => `ORRIN SUPPLY CO. v. TAMBERLY FREIGHT, INC.\n${n} F.4th 101\nUnited States Court of Appeals, Fourth Circuit.\nOpinion\nGARVEY, Circuit Judge:\nThe question is whether the arbitration clause survived termination of the agreement. We hold that it did. The judgment is affirmed.\n`;
const dissentQuote = 'The arbitration clause expired with the agreement and cannot be revived by implication.';
const designations = [
  'MOLINA, Circuit Judge, dissenting:',
  'DISSENTING OPINION',
  'Dissenting Opinion by Judge Molina',
  'Judge MOLINA, dissenting.',
  'MOLINA, J., dissenting in part:',
  'MOLINA, J. (dissenting):',
  'MOLINA, J., dissents and votes to reverse in the following opinion:',
  'CONCURRING OPINION',
  'MOLINA, Circuit Judge, concurring in the judgment:',
  'Molina, J., dissenting',
  'MOLINA, Circuit Judge, dissenting from the denial of rehearing en banc:',
  'I respectfully dissent.',
];
const leadIns = [
  'Appellee counters that', 'On Tamberly’s reading,', 'Tamberly maintains that', 'Tamberly posits that',
  'Tamberly would have us adopt a rule that', 'The magistrate judge concluded that', 'The trial court found that',
  'Under Tamberly’s interpretation,', 'Tamberly’s theory is that', 'In Bexley, the Fifth Circuit held that',
  'Tamberly’s brief states that', 'Tamberly takes the position that',
];
const leadQuote = 'a termination notice extinguishes every dispute-resolution provision in the agreement';
const out = [];
mkdirSync(here + 'probe', { recursive: true });
function run(n, text, quote, label) {
  const dir = here + `probe/${n}`; mkdirSync(dir, { recursive: true });
  writeFileSync(dir + '/op.txt', text);
  writeFileSync(dir + '/sources.json', JSON.stringify({ [`${n} F.4th 101`]: { file: 'op.txt', source: 'probe' } }));
  writeFileSync(dir + '/brief.json', JSON.stringify({ citations: [{ id: 'q', cite: `${n} F.4th 101`, case_name: 'Orrin Supply Co. v. Tamberly Freight, Inc.', quote }] }));
  const r = spawnSync(process.execPath, [cli, 'citations', dir + '/brief.json', '--sources', dir], { encoding: 'utf8' });
  const line = (r.stderr.split('\n').find((l) => /^(PASS|FAIL|INSUFFICIENT_DATA)/.test(l)) || '?').split(/\s+/)[0];
  const why = (r.stderr.split('\n').find((l, i, a) => i > 0 && /^(PASS|FAIL|INSUFFICIENT_DATA)/.test(a[i - 1])) || '').trim().slice(0, 150);
  out.push(`${line.padEnd(17)} ${label}  ||  ${why}`);
}
let n = 900;
for (const d of designations) { const k = n++; run(k, head(k) + `${d}\n${dissentQuote}\n`, dissentQuote, `[designation] ${d}`); }
for (const l of leadIns) { const k = n++; run(k, head(k) + `${l} ${leadQuote}. We disagree.\n`, leadQuote, `[lead-in] ${l}`); }
writeFileSync(here + 'probe-results.txt', out.join('\n') + '\n');
console.log(out.join('\n'));
