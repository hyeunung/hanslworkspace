import { readFileSync } from 'fs';

const items = JSON.parse(readFileSync('statement_items.json', 'utf-8'));

console.log('--- Searching for M-7 ---');
const m7Items = items.filter(item => 
  (item.extracted_item_name && item.extracted_item_name.includes('M-7')) ||
  (item.extracted_specification && item.extracted_specification.includes('M-7'))
);

m7Items.forEach(item => {
  console.log('Item:', {
    id: item.id,
    line_number: item.line_number,
    extracted_item_name: item.extracted_item_name,
    extracted_specification: item.extracted_specification,
    extracted_quantity: item.extracted_quantity,
    extracted_unit_price: item.extracted_unit_price,
    extracted_amount: item.extracted_amount,
    extracted_po_number: item.extracted_po_number,
    matched_purchase_id: item.matched_purchase_id,
    matched_item_id: item.matched_item_id,
    match_confidence: item.match_confidence,
    match_method: item.match_method,
    match_candidates_data: item.match_candidates_data ? item.match_candidates_data.length : 0
  });
});

console.log('--- Lines around 20 to 26 ---');
const lines20to26 = items.filter(item => item.line_number >= 20 && item.line_number <= 26);
lines20to26.forEach(item => {
  console.log(`Line ${item.line_number}:`, {
    name: item.extracted_item_name,
    spec: item.extracted_specification,
    qty: item.extracted_quantity,
    po: item.extracted_po_number,
    matched_item_id: item.matched_item_id
  });
});
