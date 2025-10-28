// 테이블 구조 확인용 스크립트 - Supabase SQL 직접 실행
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://qvhbigvdryweogkuvef.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2aGJpZ3ZkcnlXZW9na3V2ZWYiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTczNTM5NjUxMCwiZXhwIjoyMDUwOTcyNTEwfQ.aWYWoAhQAcOCRhq3SXxkYgYL1pOhGpGLPJo6JVOqpgw'

const supabase = createClient(supabaseUrl, supabaseKey)

// purchase_receipts 테이블의 정확한 칼럼 구조 확인
console.log('🔍 purchase_receipts 테이블 구조 확인 중...')

try {
  // SQL로 테이블 구조 직접 조회
  const { data, error } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'purchase_receipts' 
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `
  })

  if (error) {
    console.error('❌ RPC 오류:', error)
    
    // 다른 방법으로 시도 - 빈 insert로 칼럼 확인
    console.log('💡 다른 방법으로 칼럼 확인 시도...')
    
    const { error: insertError } = await supabase
      .from('purchase_receipts')
      .insert({}) // 빈 객체로 insert 시도해서 required 칼럼 확인
    
    if (insertError) {
      console.log('📝 Insert 에러에서 칼럼 정보 추출:', insertError.message)
    }
    
  } else {
    console.log('📋 purchase_receipts 테이블 칼럼들:')
    data.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'YES' ? '(nullable)' : '(not null)'}`)
    })
  }

} catch (err) {
  console.error('❌ 전체 오류:', err)
}