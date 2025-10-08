import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', override: true })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('=== purchase_request_items 테이블 구조 확인 ===\n')

// 테이블 컬럼 정보 조회
const { data: columns, error } = await supabase
  .rpc('get_table_columns', { table_name: 'purchase_request_items' })
  .catch(() => ({ data: null, error: 'RPC not available' }))

if (columns) {
  console.log('테이블 컬럼 목록:')
  columns.forEach(col => {
    console.log(`- ${col.column_name}: ${col.data_type}`)
  })
} else {
  // RPC가 없으면 실제 데이터로 확인
  const { data: sample } = await supabase
    .from('purchase_request_items')
    .select('*')
    .limit(1)
  
  if (sample && sample.length > 0) {
    console.log('테이블 컬럼 목록 (샘플 데이터 기준):')
    Object.keys(sample[0]).forEach(key => {
      const value = sample[0][key]
      const type = value === null ? 'null' : typeof value
      console.log(`- ${key}: ${type}`)
    })
  }
}

// 입고 관련 컬럼 확인
console.log('\n입고 관련 컬럼 존재 여부 확인...')
const { data: testData } = await supabase
  .from('purchase_request_items')
  .select('id, item_name, quantity, is_received, delivery_status, received_quantity, received_at')
  .limit(1)

if (testData) {
  console.log('\n✅ 조회 성공\! 입고 관련 컬럼들:')
  console.log('- is_received: 입고 완료 여부')
  console.log('- delivery_status: 배송 상태 (pending/received)')
  console.log('- received_quantity: 입고 수량')
  console.log('- received_at: 입고 일시')
} else {
  console.log('\n❌ 일부 컬럼이 없을 수 있습니다.')
}

process.exit(0)
