import { readFileSync } from 'fs';

const details = JSON.parse(readFileSync('statement_details.json', 'utf-8'));
const items = JSON.parse(readFileSync('statement_items.json', 'utf-8'));

console.log('Comparing items in extracted_data versus saved in DB:');
const rawItems = details.extracted_data.items;

for (let i = 0; i < rawItems.length; i++) {
  const raw = rawItems[i];
  const db = items.find(item => item.line_number === raw.line_number);
  
  if (!db) {
    console.log(`No DB item for line_number ${raw.line_number}`);
    continue;
  }
  
  if (raw.line_number === 23 || raw.line_number === 24) {
    console.log(`Line ${raw.line_number}:`);
    console.log('  Raw item_name:', raw.item_name);
    console.log('  Raw specification:', raw.specification);
    console.log('  Raw po_number:', raw.po_number);
    console.log('  DB extracted_po_number:', db.extracted_po_number);
    console.log('  DB extracted_po_line_number:', db.extracted_po_line_number);
  }
}
