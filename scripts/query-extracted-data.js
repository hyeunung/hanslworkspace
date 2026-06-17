import { readFileSync } from 'fs';

const details = JSON.parse(readFileSync('statement_details.json', 'utf-8'));
console.log('--- Extracted Data Keys ---', Object.keys(details.extracted_data || {}));

if (details.extracted_data && details.extracted_data.items) {
  console.log(`Found ${details.extracted_data.items.length} items in extracted_data.`);
  const items = details.extracted_data.items;
  // Print items around index 20-25 (which corresponds to line numbers 21-26 approx)
  for (let i = 20; i < Math.min(items.length, 26); i++) {
    console.log(`Index ${i}:`, items[i]);
  }
} else {
  console.log('No items list in extracted_data.');
}
