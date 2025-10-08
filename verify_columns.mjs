import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local', override: true })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('🔍 Checking current table structure for purchase_request_items...\n')

// Try to query the table to see what columns exist
try {
  const { data, error } = await supabase
    .from('purchase_request_items')
    .select('*')
    .limit(1)

  if (error) {
    console.log('❌ Error querying table:', error.message)
  } else {
    console.log('✅ Table exists. Sample columns from first row:')
    if (data && data.length > 0) {
      const columns = Object.keys(data[0])
      columns.forEach(col => {
        console.log(`  - ${col}`)
      })
      
      // Check specifically for our target columns
      const hasIsReceived = columns.includes('is_received')
      const hasReceivedAt = columns.includes('received_at')
      
      console.log('\n📊 Target columns status:')
      console.log(`  is_received: ${hasIsReceived ? '✅ EXISTS' : '❌ MISSING'}`)
      console.log(`  received_at: ${hasReceivedAt ? '✅ EXISTS' : '❌ MISSING'}`)
      
      if (hasIsReceived && hasReceivedAt) {
        console.log('\n🎉 All required columns already exist!')
      } else {
        console.log('\n📋 Action needed: Execute the SQL in manual_receipt_migration.sql')
      }
    } else {
      console.log('  (No data in table to show column structure)')
    }
  }
} catch (e) {
  console.log('❌ Connection error:', e.message)
}

process.exit(0)