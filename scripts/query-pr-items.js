import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

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
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const poNumber = 'F20260422_007';
  console.log(`Querying purchase request: ${poNumber}`);

  const { data: prs, error: prError } = await supabase
    .from('purchase_requests')
    .select('*')
    .eq('purchase_order_number', poNumber);

  if (prError) {
    console.error('Error fetching PR:', prError);
    return;
  }

  if (!prs || prs.length === 0) {
    console.log('No PR found with PO number:', poNumber);
    return;
  }

  const pr = prs[0];
  console.log('PR ID:', pr.id);
  console.log('PR Vendor:', pr.vendor_name);

  const { data: items, error: itemsError } = await supabase
    .from('purchase_request_items')
    .select('*')
    .eq('purchase_request_id', pr.id)
    .order('line_number', { ascending: true });

  if (itemsError) {
    console.error('Error fetching PR items:', itemsError);
    return;
  }

  console.log('\n--- PR ITEMS ---');
  items.forEach(item => {
    console.log(`Line ${item.line_number} (ID ${item.id}): Name="${item.item_name}", Spec="${item.specification}", Qty=${item.quantity}, Price=${item.unit_price}`);
  });
}

run().catch(console.error);
