import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

// Parse .env.local
const envContent = readFileSync(join(process.cwd(), '.env.local'), 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] ? match[2].trim() : '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    }
    env[match[1]] = value;
  }
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const targetCode = 'TS-20260513-0002';
  console.log(`Querying statement: ${targetCode}`);

  const { data: statements, error: stmtError } = await supabase
    .from('transaction_statements')
    .select('*')
    .eq('statement_code', targetCode);

  if (stmtError) {
    console.error('Error fetching statement:', stmtError);
    return;
  }

  if (!statements || statements.length === 0) {
    console.log('No statement found with code:', targetCode);
    return;
  }

  const statement = statements[0];
  console.log('Statement ID:', statement.id);
  console.log('Vendor Name:', statement.vendor_name);
  console.log('Status:', statement.status);
  console.log('File Name:', statement.file_name);

  // Write statement to a file
  writeFileSync('statement_details.json', JSON.stringify(statement, null, 2), 'utf-8');

  const { data: items, error: itemsError } = await supabase
    .from('transaction_statement_items')
    .select('*')
    .eq('statement_id', statement.id)
    .order('line_number', { ascending: true });

  if (itemsError) {
    console.error('Error fetching statement items:', itemsError);
    return;
  }

  console.log(`Total statement items found: ${items.length}`);
  
  // Write items to a file
  writeFileSync('statement_items.json', JSON.stringify(items, null, 2), 'utf-8');

  // Let's analyze items and see if any have "후보없음" or have null match
  const itemsWithNoCandidates = [];
  const itemsWithCandidates = [];
  
  for (const item of items) {
    const candidateData = item.match_candidates_data;
    const hasCandidates = Array.isArray(candidateData) && candidateData.length > 0;
    
    // Check if the item itself or its candidates contains the Korean text '후보없음' or if there is a column/value representing it.
    const itemStr = JSON.stringify(item);
    if (itemStr.includes('후보없음') || itemStr.includes('후보 없음')) {
      console.log(`Found "후보없음" in item line_number ${item.line_number}: ${item.extracted_item_name}`);
    }

    if (!hasCandidates) {
      itemsWithNoCandidates.push(item);
    } else {
      itemsWithCandidates.push(item);
    }
  }

  console.log(`Items with no candidates: ${itemsWithNoCandidates.length}`);
  console.log(`Items with candidates: ${itemsWithCandidates.length}`);

  if (itemsWithNoCandidates.length > 0) {
    console.log('\n--- Sample of items with NO candidates ---');
    itemsWithNoCandidates.slice(0, 5).forEach(item => {
      console.log(`Line ${item.line_number}: Name="${item.extracted_item_name}", Spec="${item.extracted_specification}", Qty=${item.extracted_quantity}, UnitPrice=${item.extracted_unit_price}, Extracted PO=${item.extracted_po_number}`);
    });
  }
}

run().catch(console.error);
