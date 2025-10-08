import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

// Load environment variables
config({ path: '.env.local', override: true })

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables:')
  console.error('- VITE_SUPABASE_URL')
  console.error('- SUPABASE_SERVICE_ROLE_KEY')
  console.error('\nPlease create a .env.local file with these variables.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

console.log('🚀 Executing SQL to add receipt columns to purchase_request_items...\n')

// Define the SQL commands
const sqlCommands = [
  {
    name: 'Add is_received column',
    sql: 'ALTER TABLE purchase_request_items ADD COLUMN IF NOT EXISTS is_received BOOLEAN DEFAULT FALSE;'
  },
  {
    name: 'Add received_at column', 
    sql: 'ALTER TABLE purchase_request_items ADD COLUMN IF NOT EXISTS received_at TIMESTAMP WITH TIME ZONE;'
  },
  {
    name: 'Create index on is_received',
    sql: 'CREATE INDEX IF NOT EXISTS idx_purchase_request_items_is_received ON purchase_request_items(is_received);'
  }
]

let successCount = 0
let errorCount = 0

// Execute each command
for (const command of sqlCommands) {
  console.log(`Executing: ${command.name}...`)
  
  try {
    const { error } = await supabase.rpc('execute_sql', { query: command.sql })
    
    if (error) {
      console.log(`❌ Failed: ${error.message}`)
      errorCount++
    } else {
      console.log(`✅ Success: ${command.name}`)
      successCount++
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`)
    errorCount++
  }
}

console.log('\n📊 Migration Summary:')
console.log(`✅ Successful: ${successCount}`)
console.log(`❌ Failed: ${errorCount}`)

// Verify the columns were added
console.log('\n🔍 Verifying columns exist...')
try {
  const { data, error } = await supabase
    .from('purchase_request_items')
    .select('id, is_received, received_at')
    .limit(1)

  if (error) {
    console.log('❌ Verification failed:', error.message)
    console.log('\n📋 You may need to run the SQL manually in Supabase Dashboard:')
    sqlCommands.forEach(cmd => console.log(`- ${cmd.sql}`))
  } else {
    console.log('✅ All columns verified successfully!')
    console.log('- is_received: Added')
    console.log('- received_at: Added')
    console.log('- Index: Created')
  }
} catch (e) {
  console.log('❌ Verification error:', e.message)
}

process.exit(0)