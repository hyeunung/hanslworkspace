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
  console.log(`=== Querying ocr_corrections for statement: ${stmtId} ===`);

  const { data: corrections, error } = await supabase
    .from('ocr_corrections')
    .select(`
      *,
      employee:employees!ocr_corrections_corrected_by_fkey (name)
    `)
    .eq('statement_id', stmtId);

  if (error) {
    console.error('Error fetching corrections:', error);
    // Fallback: raw select
    const { data: rawData, error: rawError } = await supabase.from('ocr_corrections').select('*').eq('statement_id', stmtId);
    if (rawError) console.error(rawError);
    else console.log('Raw Corrections:', rawData);
  } else {
    console.log('Corrections:', JSON.stringify(corrections, null, 2));
  }
}

run().catch(console.error);
