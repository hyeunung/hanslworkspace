import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

const workspaceDir = '/Users/scott/workspace/hanslworkspace';
const envContent = readFileSync(join(workspaceDir, '.env.local'), 'utf-8');
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

const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const stmtId = '6f7feaf1-9d26-4153-bf34-fa6e60058aa7';
  console.log(`=== Querying statement items for statement: ${stmtId} ===`);

  const { data: items, error } = await supabase
    .from('transaction_statement_items')
    .select('*')
    .eq('statement_id', stmtId);

  if (error) {
    console.error(error);
    return;
  }

  items.forEach(i => {
    console.log(`- Item ID: ${i.id}`);
    console.log(`  Extracted Name: ${i.extracted_item_name}`);
    console.log(`  Extracted Qty: ${i.extracted_quantity}`);
    console.log(`  Extracted Price: ${i.extracted_unit_price}`);
    console.log(`  Matched PO ID: ${i.matched_purchase_id}`);
    console.log(`  Matched Item ID: ${i.matched_item_id}`);
    console.log(`  Match Method: ${i.match_method}`);
    console.log(`  Is Confirmed: ${i.is_confirmed}`);
    console.log(`  Created At: ${i.created_at}`);
    console.log(`  Updated At: ${i.updated_at}`);
  });
}

run().catch(console.error);
