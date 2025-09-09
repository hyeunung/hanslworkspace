const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://byqltbcqnrhrtewwprlm.supabase.co'
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5cWx0YmNxbnJocnRld3dwcmxtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTQzNjkyNzEsImV4cCI6MjAyOTk0NTI3MX0.sW0v8N0wLSNPkqT7bQX25ZPnQkqr1M2c-NAFJRSmWp0'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkSchema() {
  console.log('=== Purchase Requests 테이블 구조 확인 ===\n')
  
  // 1. 테이블의 실제 칼럼 확인
  const { data: columns, error: colError } = await supabase
    .rpc('get_table_columns', { 
      table_name: 'purchase_requests',
      schema_name: 'public'
    })
    .limit(1)
  
  // 대신 샘플 데이터로 확인
  const { data: sample, error: sampleError } = await supabase
    .from('purchase_requests')
    .select('*')
    .limit(1)
  
  if (sample && sample.length > 0) {
    console.log('실제 DB 칼럼들:')
    console.log(Object.keys(sample[0]).sort())
    console.log('\n샘플 데이터:')
    console.log(JSON.stringify(sample[0], null, 2))
  }
  
  // 2. 관련 테이블들 확인
  console.log('\n=== Vendors 테이블 확인 ===')
  const { data: vendor } = await supabase
    .from('vendors')
    .select('*')
    .limit(1)
  
  if (vendor && vendor.length > 0) {
    console.log('Vendor 칼럼들:')
    console.log(Object.keys(vendor[0]).sort())
  }

  // 3. 필수 칼럼 존재 여부 확인
  console.log('\n=== 필수 칼럼 체크 ===')
  const requiredColumns = [
    'id',
    'purchase_order_number',
    'requester_email',
    'requester_name',
    'vendor_id',
    'middle_manager_status',
    'final_manager_status',
    'purchase_status',
    'delivery_status',
    'created_at',
    'updated_at'
  ]

  if (sample && sample.length > 0) {
    const existingColumns = Object.keys(sample[0])
    requiredColumns.forEach(col => {
      const exists = existingColumns.includes(col)
      console.log(`${col}: ${exists ? '✅' : '❌ 누락'}`)
    })
  }

  // 4. 실제 사용 중인 쿼리 테스트
  console.log('\n=== 대시보드 쿼리 테스트 ===')
  
  const { data: testQuery, error: testError } = await supabase
    .from('purchase_requests')
    .select(`
      *,
      vendors (vendor_name),
      purchase_request_items (item_name, quantity, unit_price)
    `)
    .eq('middle_manager_status', 'pending')
    .limit(1)

  if (testError) {
    console.log('쿼리 에러:', testError.message)
  } else {
    console.log('쿼리 성공! 데이터 구조:')
    if (testQuery && testQuery.length > 0) {
      console.log('- vendors 조인:', !!testQuery[0].vendors)
      console.log('- items 조인:', !!testQuery[0].purchase_request_items)
    }
  }
}

checkSchema().catch(console.error)