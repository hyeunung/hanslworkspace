import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://byqltbcqnrhrtewwprlm.supabase.co'
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5cWx0YmNxbnJocnRld3dwcmxtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTQzNjkyNzEsImV4cCI6MjAyOTk0NTI3MX0.sW0v8N0wLSNPkqT7bQX25ZPnQkqr1M2c-NAFJRSmWp0'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkSchema() {
  console.log('=== Purchase Requests 테이블 구조 확인 ===\n')
  
  // 1. 테이블의 실제 칼럼 확인
  const { data: sample, error: sampleError } = await supabase
    .from('purchase_requests')
    .select('*')
    .limit(1)
  
  if (sample && sample.length > 0) {
    console.log('실제 DB 칼럼들:')
    console.log(Object.keys(sample[0]).sort())
    console.log('\n샘플 데이터 일부:')
    const { id, purchase_order_number, requester_email, requester_name, 
            middle_manager_status, final_manager_status, purchase_status, 
            delivery_status, vendor_id, created_at } = sample[0]
    console.log({
      id,
      purchase_order_number,
      requester_email,
      requester_name,
      middle_manager_status,
      final_manager_status,
      purchase_status,
      delivery_status,
      vendor_id,
      created_at
    })
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
    'updated_at',
    'delivery_completed_at',
    'vendor_payment_schedule',
    'total_amount'
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
      purchase_request_items (item_name, quantity, unit_price, is_received, received_quantity)
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
      console.log('- vendor_name:', testQuery[0].vendors?.vendor_name)
      console.log('- items 개수:', testQuery[0].purchase_request_items?.length)
    }
  }

  // 5. 대시보드 서비스 쿼리들 테스트
  console.log('\n=== 대시보드 서비스 쿼리 테스트 ===')
  
  // 구매 대기중 쿼리
  const { data: waitingPurchase, error: wpError } = await supabase
    .from('purchase_requests')
    .select(`
      *,
      vendors (vendor_name),
      purchase_request_items (item_name, quantity, unit_price)
    `)
    .eq('final_manager_status', 'approved')
    .neq('purchase_status', 'completed')
    .limit(2)

  console.log('구매 대기중 쿼리:', wpError ? `❌ ${wpError.message}` : `✅ ${waitingPurchase?.length || 0}건`)

  // 입고 대기중 쿼리
  const { data: waitingDelivery, error: wdError } = await supabase
    .from('purchase_requests')
    .select(`
      *,
      vendors (vendor_name),
      purchase_request_items (item_name, quantity, is_received, received_quantity)
    `)
    .eq('purchase_status', 'completed')
    .neq('delivery_status', 'completed')
    .limit(2)

  console.log('입고 대기중 쿼리:', wdError ? `❌ ${wdError.message}` : `✅ ${waitingDelivery?.length || 0}건`)
}

checkSchema().catch(console.error)