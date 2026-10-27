// From a cold review, 2026-10-13: the reviewer's probe.mjs (beside this file, byte for byte) built one mock opinion per separate-opinion
// designation style and per lead-in, and ran the built engine on each. This script writes the same texts into probe/ as fixtures, so the
// test runs them in-process: the strings below are the reviewer's own, copied from probe.mjs unchanged.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
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
const dir = join(here, 'probe');
mkdirSync(dir, { recursive: true });
const sources = {};
const citations = [];
let n = 900;
for (const d of designations) { const k = n++; writeFileSync(join(dir, `${k}.txt`), head(k) + `${d}\n${dissentQuote}\n`); sources[`${k} F.4th 101`] = { file: `${k}.txt`, source: `probe: designation "${d}"` }; citations.push({ id: `d${k}`, cite: `${k} F.4th 101`, case_name: 'Orrin Supply Co. v. Tamberly Freight, Inc.', quote: dissentQuote, label: d }); }
for (const l of leadIns) { const k = n++; writeFileSync(join(dir, `${k}.txt`), head(k) + `${l} ${leadQuote}. We disagree.\n`); sources[`${k} F.4th 101`] = { file: `${k}.txt`, source: `probe: lead-in "${l}"` }; citations.push({ id: `l${k}`, cite: `${k} F.4th 101`, case_name: 'Orrin Supply Co. v. Tamberly Freight, Inc.', quote: leadQuote, label: l }); }
writeFileSync(join(dir, 'sources.json'), `${JSON.stringify(sources, null, 2)}\n`);
writeFileSync(join(dir, 'brief.json'), `${JSON.stringify({ citations: citations.map(({ label: _l, ...c }) => c) }, null, 2)}\n`);
writeFileSync(join(dir, 'labels.json'), `${JSON.stringify(Object.fromEntries(citations.map(c => [c.id, c.label])), null, 2)}\n`);
console.log(`wrote ${citations.length} texts to ${dir}`);
