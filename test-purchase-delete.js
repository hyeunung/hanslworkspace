#!/usr/bin/env node

/**
 * 발주서 삭제 실시간 반영 테스트용 스크립트
 * 테스트용 발주서를 생성하고 삭제 테스트를 진행
 */

import { createClient } from '@supabase/supabase-js'

// 환경변수 로드
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

// Supabase 클라이언트 설정
const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('placeholder')) {
  console.error('❌ Supabase 환경 변수가 설정되지 않았습니다.')
  console.error('VITE_SUPABASE_URL과 VITE_SUPABASE_ANON_KEY를 설정해주세요.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function createTestPurchase() {
  console.log('🚀 테스트용 발주서 생성 중...')
  
  try {
    // 기존 발주서 하나를 복제해서 테스트용으로 사용
    const { data: existingPurchases, error: fetchError } = await supabase
      .from('purchase_requests')
      .select('*')
      .limit(1)
      .single()
    
    if (fetchError || !existingPurchases) {
      throw new Error('기존 발주서를 찾을 수 없습니다. 수동으로 발주서를 하나 생성해주세요.')
    }
    
    // 현재 시간 기반 고유 번호 생성
    const timestamp = Date.now().toString().slice(-6)
    const purchaseOrderNumber = `TEST-${timestamp}`
    
    // 1. 기존 발주서를 복제하여 테스트용 발주서 생성
    const testPurchaseData = {
      ...existingPurchases,
      id: undefined, // 새로 생성할 것이므로 제거
      purchase_order_number: purchaseOrderNumber,
      requester_name: '테스트사용자',
      total_amount: 100000,
      created_at: undefined, // 새로 생성할 것이므로 제거
      updated_at: undefined, // 새로 생성할 것이므로 제거
      request_date: new Date().toISOString(),
      delivery_request_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7일 후
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
    
    console.log('✅ 발주요청 생성 완료:', purchaseData.id, purchaseData.purchase_order_number)
    
    // 2. 품목 생성
    const { data: itemData, error: itemError } = await supabase
      .from('purchase_request_items')
      .insert({
        purchase_request_id: purchaseData.id,
        line_number: 1,
        item_name: '테스트용 품목',
        specification: '삭제 테스트용 품목입니다',
        quantity: 1,
        unit_price_value: 100000,
        unit_price_currency: 'KRW',
        amount_value: 100000,
        amount_currency: 'KRW',
        remark: '실시간 삭제 테스트용'
      })
      .select()
    
    if (itemError) throw itemError
    
    console.log('✅ 품목 생성 완료:', itemData[0].id, itemData[0].item_name)
    
    return {
      purchase: purchaseData,
      items: itemData
    }
    
  } catch (error) {
    console.error('❌ 테스트용 발주서 생성 실패:', error)
    throw error
  }
}

async function testPurchaseList() {
  console.log('📋 현재 발주서 목록 확인 중...')
  
  try {
    const { data, error } = await supabase
      .from('purchase_requests')
      .select(`
        id,
        purchase_order_number,
        requester_name,
        vendor_name,
        total_amount,
        created_at
      `)
      .order('created_at', { ascending: false })
      .limit(5)
    
    if (error) throw error
    
    console.log('📊 최근 발주서 5개:')
    data.forEach((purchase, index) => {
      console.log(`  ${index + 1}. ${purchase.purchase_order_number} - ${purchase.requester_name} - ₩${purchase.total_amount?.toLocaleString()}`)
    })
    
    return data
    
  } catch (error) {
    console.error('❌ 발주서 목록 조회 실패:', error)
    throw error
  }
}

async function deletePurchase(purchaseId) {
  console.log(`🗑️  발주서 삭제 중... (ID: ${purchaseId})`)
  
  try {
    // 1. 품목 삭제
    const { error: itemsError } = await supabase
      .from('purchase_request_items')
      .delete()
      .eq('purchase_request_id', purchaseId)
    
    if (itemsError) throw itemsError
    console.log('✅ 품목 삭제 완료')
    
    // 2. 발주요청 삭제
    const { error: requestError } = await supabase
      .from('purchase_requests')
      .delete()
      .eq('id', purchaseId)
    
    if (requestError) throw requestError
    console.log('✅ 발주요청 삭제 완료')
    
    return true
    
  } catch (error) {
    console.error('❌ 발주서 삭제 실패:', error)
    throw error
  }
}

// 메인 테스트 실행
async function runTest() {
  console.log('🧪 발주서 삭제 실시간 반영 테스트 시작')
  console.log('=' .repeat(50))
  
  try {
    // 1. 현재 발주서 목록 확인
    await testPurchaseList()
    console.log()
    
    // 2. 테스트용 발주서 생성
    const testData = await createTestPurchase()
    console.log()
    
    // 3. 생성된 발주서 확인
    console.log('📋 테스트 발주서 생성 후 목록:')
    await testPurchaseList()
    console.log()
    
    // 4. 잠시 대기 (실제 UI에서 확인할 시간)
    console.log('⏳ 5초 대기 중... (브라우저에서 새로 생성된 발주서를 확인해보세요)')
    await new Promise(resolve => setTimeout(resolve, 5000))
    
    // 5. 테스트용 발주서 삭제
    await deletePurchase(testData.purchase.id)
    console.log()
    
    // 6. 삭제 후 발주서 목록 확인
    console.log('📋 테스트 발주서 삭제 후 목록:')
    await testPurchaseList()
    
    console.log()
    console.log('🎉 테스트 완료!')
    console.log('💡 이제 브라우저에서 발주서가 실시간으로 사라지는지 확인해보세요.')
    
  } catch (error) {
    console.error('🚨 테스트 실행 중 오류 발생:', error)
    process.exit(1)
  }
}

runTest()