import { readFileSync } from 'fs';

const details = JSON.parse(readFileSync('statement_details.json', 'utf-8'));
const str = JSON.stringify(details, null, 2);

console.log('Length of details JSON:', str.length);

const occurrences = [];
let idx = str.indexOf('후보');
while (idx !== -1) {
  occurrences.push(str.substring(Math.max(0, idx - 50), Math.min(str.length, idx + 50)));
  idx = str.indexOf('후보', idx + 1);
}

console.log(`Found ${occurrences.length} occurrences of "후보" in details:`);
occurrences.forEach((occ, i) => {
  console.log(`[${i}]: ... ${occ.replace(/\n/g, ' ')} ...`);
});
