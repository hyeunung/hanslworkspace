import { createClient } from '@supabase/supabase-js';

// Supabase 설정
const supabaseUrl = 'https://tbqkkulyjozubyuvtzsw.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRicWtra3VseWpvenVieXV2dHpzdyIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzI5Njc1MjAwLCJleHAiOjIwNDUyNTEyMDB9.XnCvTRLKOV-v9NJl5kQ0zu5DNPF7yEBVA4PKZcnxkPQ';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPartialReceipts() {
  try {
    // 발주요청과 품목 정보를 함께 가져오기
    const { data: purchases, error } = await supabase
      .from('purchase_requests')
      .select(`
        id,
        purchase_order_number,
        is_received,
        requester_name,
        vendor_name,
        created_at,
        purchase_request_items (
          id,
          item_name,
          is_received,
          quantity,
          actual_received_date
        )
      `)
      .order('created_at', { ascending: false })
      .limit(100);
    
    if (error) {
      console.error('Query error:', error);
      return;
    }
    
    // 부분 입고된 발주 찾기 (100% 아닌 것들)
    const partialReceipts = purchases.filter(p => {
      if (!p.purchase_request_items || p.purchase_request_items.length === 0) return false;
      
      const total = p.purchase_request_items.length;
      const received = p.purchase_request_items.filter(item => item.is_received === true).length;
      
      // 일부만 입고된 경우 (0% < x < 100%)
      return received > 0 && received < total;
    });
    
    console.log('\n==== 부분 입고된 발주 목록 (100% 미만) ====\n');
    
    if (partialReceipts.length === 0) {
      console.log('부분 입고된 발주가 없습니다.');
    } else {
      partialReceipts.forEach(p => {
        const total = p.purchase_request_items.length;
        const received = p.purchase_request_items.filter(item => item.is_received === true).length;
        const percentage = Math.round((received / total) * 100);
        
        console.log(`발주번호: ${p.purchase_order_number}`);
        console.log(`  요청자: ${p.requester_name}`);
        console.log(`  업체: ${p.vendor_name}`);
        console.log(`  입고율: ${received}/${total} (${percentage}%)`);
        console.log(`  purchase_requests.is_received: ${p.is_received}`);
        console.log(`  생성일: ${new Date(p.created_at).toLocaleDateString('ko-KR')}`);
        
        // 미입고 품목 표시
        const notReceived = p.purchase_request_items.filter(item => !item.is_received);
        if (notReceived.length > 0) {
          console.log('  미입고 품목:');
          notReceived.forEach(item => {
            console.log(`    - ${item.item_name} (수량: ${item.quantity})`);
          });
        }
        console.log('');
      });
      
      console.log(`총 ${partialReceipts.length}개의 부분 입고 발주가 있습니다.\n`);
    }
    
    // 통계 정보
    console.log('\n==== 전체 입고 현황 통계 ====\n');
    
    const stats = {
      total: purchases.length,
      fullyReceived: purchases.filter(p => {
        if (!p.purchase_request_items || p.purchase_request_items.length === 0) return false;
        return p.purchase_request_items.every(item => item.is_received === true);
      }).length,
      partiallyReceived: partialReceipts.length,
      notReceived: purchases.filter(p => {
        if (!p.purchase_request_items || p.purchase_request_items.length === 0) return false;
        return p.purchase_request_items.every(item => !item.is_received);
      }).length
    };
    
    console.log(`검색된 발주 총 개수: ${stats.total}`);
    console.log(`완전 입고 (100%): ${stats.fullyReceived}개`);
    console.log(`부분 입고 (0% < x < 100%): ${stats.partiallyReceived}개`);
    console.log(`미입고 (0%): ${stats.notReceived}개`);
    
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

checkPartialReceipts();
