import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

// Load environment variables
config({ path: '.env.local', override: true })

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

console.log('🚀 품목별 입고 컬럼 추가 중...\n')

// Supabase JavaScript SDK는 DDL 명령을 직접 실행할 수 없으므로,
// 우선 테이블에서 데이터를 가져와 컬럼 존재 여부를 확인합니다
async function checkColumns() {
  const { data, error } = await supabase
    .from('purchase_request_items')
    .select('*')
    .limit(1)
  
  if (error) {
    console.error('Error:', error)
    return null
  }
  
  if (data && data.length > 0) {
    const columns = Object.keys(data[0])
    return {
      hasIsReceived: columns.includes('is_received'),
      hasReceivedAt: columns.includes('received_at')
    }
  }
  return null
}

const columnStatus = await checkColumns()

if (columnStatus) {
  console.log('현재 컬럼 상태:')
  console.log('- is_received:', columnStatus.hasIsReceived ? '✅ 있음' : '❌ 없음')
  console.log('- received_at:', columnStatus.hasReceivedAt ? '✅ 있음' : '❌ 없음')
  
  if (!columnStatus.hasIsReceived || !columnStatus.hasReceivedAt) {
    console.log('\n⚠️  컬럼이 없습니다!')
    console.log('\n📋 다음 SQL을 Supabase Dashboard > SQL Editor에서 실행해주세요:\n')
    console.log('-- 1. is_received 컬럼 추가')
    console.log('ALTER TABLE purchase_request_items ADD COLUMN IF NOT EXISTS is_received BOOLEAN DEFAULT FALSE;')
    console.log('\n-- 2. received_at 컬럼 추가')
    console.log('ALTER TABLE purchase_request_items ADD COLUMN IF NOT EXISTS received_at TIMESTAMP WITH TIME ZONE;')
    console.log('\n-- 3. 인덱스 추가')
    console.log('CREATE INDEX IF NOT EXISTS idx_purchase_request_items_is_received ON purchase_request_items(is_received);')
    console.log('\n또는 다음 파일의 내용을 실행하세요:')
    console.log('📁 scripts/migrations/20250122_add_item_receipt_columns.sql')
  } else {
    console.log('\n✅ 모든 컬럼이 이미 존재합니다!')
  }
}

process.exit(0)