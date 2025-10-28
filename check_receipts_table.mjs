import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://qvhbigvdryweogkuvef.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2aGJpZ3ZkcnlXZW9na3V2ZWYiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTczNTM5NjUxMCwiZXhwIjoyMDUwOTcyNTEwfQ.aWYWoAhQAcOCRhq3SXxkYgYL1pOhGpGLPJo6JVOqpgw'

const supabase = createClient(supabaseUrl, supabaseKey)

console.log('🔍 purchase_receipts 테이블 구조 확인 중...')

// 테이블 구조 확인
const { data, error } = await supabase
  .rpc('describe_table', { table_name: 'purchase_receipts' })

if (error) {
  // RPC가 없으면 직접 정보 스키마 쿼리
  console.log('RPC 함수가 없어서 직접 쿼리합니다...')
  
  const { data: columns, error: colError } = await supabase
    .from('information_schema.columns')
    .select('column_name, data_type, is_nullable, column_default')
    .eq('table_name', 'purchase_receipts')
    .order('ordinal_position')

  if (colError) {
    console.error('❌ 오류:', colError)
  } else {
    console.log('📋 purchase_receipts 테이블 컬럼들:')
    columns.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'YES' ? '(nullable)' : '(not null)'}`)
    })
  }
} else {
  console.log('📋 테이블 구조:', data)
}

// 실제 데이터 샘플 확인 (컬럼명 파악용)
console.log('\n🔍 실제 데이터 샘플 확인...')
const { data: sampleData, error: sampleError } = await supabase
  .from('purchase_receipts')
  .select('*')
  .limit(1)

if (sampleError) {
  console.error('❌ 샘플 데이터 조회 오류:', sampleError)
} else {
  if (sampleData.length > 0) {
    console.log('📄 샘플 데이터 컬럼들:', Object.keys(sampleData[0]))
  } else {
    console.log('📄 테이블에 데이터가 없습니다.')
  }
}