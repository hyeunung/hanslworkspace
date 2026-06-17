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

const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('=== Querying detailed items of TS-20260609-0005 and TS-20260610-0002 ===');
  const { data: items } = await supabase
    .from('transaction_statement_items')
    .select('*')
    .in('statement_id', [
      '6f7feaf1-9d26-4153-bf34-fa6e60058aa7', // TS-20260609-0005
      '886b9a32-8a19-4766-9eb9-f13ab4844cb6'  // TS-20260610-0002
    ])
    .eq('extracted_item_name', 'XC6210B452MR');

  if (items) {
    console.log(JSON.stringify(items, null, 2));
  }
}

run().catch(console.error);
