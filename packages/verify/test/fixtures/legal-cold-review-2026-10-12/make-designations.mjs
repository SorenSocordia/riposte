// Judge's probe: one mock opinion per separate-opinion designation style.
// Each file: caption, majority, then one separate opinion whose words are quoted in the brief WITHOUT a parenthetical.
// Correct behaviour: can't tell (words in a separate opinion). Failure: PASS "Found in the majority opinion".
import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve('mytests/opinions3');
fs.mkdirSync(dir, { recursive: true });
const designations = {
  A: 'Justice STEVENS, with whom Justice GINSBURG joins except as to Part IV, dissenting.',
  B: 'Justice THOMAS, with whom Justice SCALIA joins as to Parts I and II, concurring in part and dissenting in part.',
  C: 'Justice ALITO, with whom THE CHIEF JUSTICE joins as to all but Part II-B, dissenting.',
  D: 'Justice KENNEDY, concurring in part and concurring in the judgment.',
  E: 'SMITH, Circuit Judge, concurring in part and dissenting in part:',
  F: 'Justice BREYER, with whom Justice GINSBURG, Justice SOTOMAYOR, and Justice KAGAN join, dissenting.',
  G: 'Justice GINSBURG, with whom Justice BREYER joins, and with whom Justice SOTOMAYOR and Justice KAGAN join in part, dissenting.',
  H: 'Justice SCALIA, with whom Justice THOMAS joins, concurring in part and concurring in the judgment.',
};
const sources = {};
const citations = [];
let vol = 601;
for (const [k, d] of Object.entries(designations)) {
  const cite = `${vol} U.S. 1`;
  const file = `desig-${k}.txt`;
  const text = [
    `ACME ARBITRATION CO. v. ROE CONTRACTORS, INC.`,
    `${cite} (2020)`,
    ``,
    `JUSTICE LEE delivered the opinion of the Court.`,
    `The limitations period for a claim to vacate an award runs from the date the award is delivered.`,
    `II`,
    `A party who fails to move within that period forfeits the objection.`,
    `It is so ordered.`,
    ``,
    d,
    `In my view the period should run from the date the party learns of the arbitrator's undisclosed conflict, style ${k}.`,
    ``,
  ].join('\n');
  fs.writeFileSync(path.join(dir, file), text);
  sources[cite] = { file, source: `judge probe: designation style ${k}` };
  citations.push({ id: `desig-${k}`, cite: `${cite}, 9 (2020)`, case_name: 'Acme Arbitration Co. v. Roe Contractors, Inc.',
    quote: `the period should run from the date the party learns of the arbitrator's undisclosed conflict, style ${k}` });
  vol++;
}
fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify(sources, null, 2) + '\n');
fs.writeFileSync(path.resolve('mytests/brief3.json'), JSON.stringify({ citations }, null, 2) + '\n');
console.log(JSON.stringify(designations, null, 1));
