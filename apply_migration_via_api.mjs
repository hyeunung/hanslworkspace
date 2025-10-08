import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local', override: true })

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables')
  process.exit(1)
}

console.log('🔧 품목별 입고 컬럼 추가를 위한 안내\n')
console.log('='.repeat(50))

const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)[1]

console.log(`
📌 Supabase Dashboard에서 SQL 실행하기:

1. 아래 링크를 Cmd+클릭 (또는 Ctrl+클릭)하여 열기:
   https://app.supabase.com/project/${projectRef}/sql/new

2. 다음 SQL을 복사하여 붙여넣기:
`)

console.log(`-- 품목별 입고 관리를 위한 컬럼 추가
ALTER TABLE purchase_request_items 
ADD COLUMN IF NOT EXISTS is_received BOOLEAN DEFAULT FALSE;

ALTER TABLE purchase_request_items 
ADD COLUMN IF NOT EXISTS received_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_purchase_request_items_is_received 
ON purchase_request_items(is_received);`)

console.log(`
3. "Run" 버튼 클릭

4. 성공 메시지가 나타나면 완료!
`)

console.log('='.repeat(50))

// 현재 컬럼 상태 확인
const supabase = createClient(supabaseUrl, supabaseServiceKey)
const { data, error } = await supabase
  .from('purchase_request_items')
  .select('*')
  .limit(1)

if (!error && data && data.length > 0) {
  const columns = Object.keys(data[0])
  const hasIsReceived = columns.includes('is_received')
  const hasReceivedAt = columns.includes('received_at')
  
  console.log('\n📊 현재 컬럼 상태:')
  console.log('- is_received:', hasIsReceived ? '✅ 이미 존재' : '❌ 추가 필요')
  console.log('- received_at:', hasReceivedAt ? '✅ 이미 존재' : '❌ 추가 필요')
  
  if (hasIsReceived && hasReceivedAt) {
    console.log('\n✨ 모든 컬럼이 이미 존재합니다! 추가 작업이 필요 없습니다.')
  } else {
    console.log('\n⚠️  위의 SQL을 실행하여 컬럼을 추가해주세요.')
  }
}

process.exit(0)