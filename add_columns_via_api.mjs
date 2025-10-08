import { config } from 'dotenv'

config({ path: '.env.local', override: true })

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Supabase Management API를 통해 SQL 실행 시도
async function executeSQLViaAPI() {
  const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)[1]
  
  console.log('🔍 Project Reference:', projectRef)
  console.log('🚀 SQL 실행 시도 중...\n')
  
  // SQL 명령들
  const sqlCommands = [
    'ALTER TABLE purchase_request_items ADD COLUMN IF NOT EXISTS is_received BOOLEAN DEFAULT FALSE',
    'ALTER TABLE purchase_request_items ADD COLUMN IF NOT EXISTS received_at TIMESTAMP WITH TIME ZONE',
    'CREATE INDEX IF NOT EXISTS idx_purchase_request_items_is_received ON purchase_request_items(is_received)'
  ]
  
  // Supabase REST API를 통해서는 DDL을 직접 실행할 수 없으므로,
  // 수동으로 실행해야 합니다.
  console.log('⚠️  Supabase JavaScript SDK와 REST API는 DDL 명령을 지원하지 않습니다.')
  console.log('📋 다음 방법 중 하나를 선택하세요:\n')
  
  console.log('방법 1: Supabase Dashboard에서 직접 실행')
  console.log('========================================')
  console.log('1. https://app.supabase.com/project/' + projectRef + '/sql/new')
  console.log('2. 아래 SQL을 복사하여 붙여넣기')
  console.log('3. "Run" 버튼 클릭\n')
  
  sqlCommands.forEach(sql => {
    console.log(sql + ';')
  })
  
  console.log('\n방법 2: Supabase CLI 사용 (로컬에 설치 필요)')
  console.log('============================================')
  console.log('1. npm install -g supabase')
  console.log('2. supabase login')
  console.log('3. supabase link --project-ref ' + projectRef)
  console.log('4. supabase db push < scripts/migrations/20250122_add_item_receipt_columns.sql')
  
  console.log('\n방법 3: psql 직접 연결')
  console.log('=====================')
  console.log('1. Supabase Dashboard > Settings > Database')
  console.log('2. Connection string 복사')
  console.log('3. psql "[connection_string]" < scripts/migrations/20250122_add_item_receipt_columns.sql')
}

executeSQLViaAPI()