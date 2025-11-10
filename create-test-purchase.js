#!/usr/bin/env node

/**
 * 브라우저에서 수동 삭제 테스트를 위한 발주서 생성
 * 삭제하지 않고 생성만 함
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function createTestPurchaseOnly() {
  console.log('🚀 브라우저 테스트용 발주서 생성 중...')
  
  try {
    // 기존 발주서 복제
    const { data: existingPurchases, error: fetchError } = await supabase
      .from('purchase_requests')
      .select('*')
      .limit(1)
      .single()
    
    if (fetchError || !existingPurchases) {
      throw new Error('기존 발주서를 찾을 수 없습니다.')
    }
    
    const timestamp = Date.now().toString().slice(-6)
    const purchaseOrderNumber = `MANUAL-TEST-${timestamp}`
    
    const testPurchaseData = {
      ...existingPurchases,
      id: undefined,
      purchase_order_number: purchaseOrderNumber,
      requester_name: '수동삭제테스트',
      total_amount: 50000,
      created_at: undefined,
      updated_at: undefined,
      request_date: new Date().toISOString(),
      delivery_request_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      middle_manager_status: 'pending',
      final_manager_status: 'pending',
      is_payment_completed: false,
      is_received: false
    }
    
    const { data: purchaseData, error: purchaseError } = await supabase
      .from('purchase_requests')
      .insert(testPurchaseData)
      .select()
      .single()
    
    if (purchaseError) throw purchaseError
    
    console.log('✅ 수동 테스트용 발주요청 생성 완료:', purchaseData.id, purchaseData.purchase_order_number)
    
    // 품목 생성
    const { data: itemData, error: itemError } = await supabase
      .from('purchase_request_items')
      .insert({
        purchase_request_id: purchaseData.id,
        line_number: 1,
        item_name: '수동삭제 테스트 품목',
        specification: '브라우저에서 직접 삭제해보세요',
        quantity: 1,
        unit_price_value: 50000,
        unit_price_currency: 'KRW',
        amount_value: 50000,
        amount_currency: 'KRW',
        remark: '실시간 삭제 테스트용 - 삭제 버튼 클릭 후 바로 사라지는지 확인'
      })
      .select()
    
    if (itemError) throw itemError
    
    console.log('✅ 품목 생성 완료:', itemData[0].id, itemData[0].item_name)
    
    console.log('')
    console.log('🌐 브라우저 테스트 준비 완료!')
    console.log(`📋 발주번호: ${purchaseData.purchase_order_number}`)
    console.log('💡 이제 브라우저에서 다음을 테스트해보세요:')
    console.log('   1. http://localhost:3000/purchase/list에 접속')
    console.log('   2. 방금 생성된 발주서를 찾기')
    console.log('   3. 상세 모달을 열고 우측 상단 삭제 버튼 클릭')
    console.log('   4. 삭제 후 목록에서 즉시 사라지는지 확인!')
    
  } catch (error) {
    console.error('❌ 테스트용 발주서 생성 실패:', error)
  }
}

createTestPurchaseOnly()