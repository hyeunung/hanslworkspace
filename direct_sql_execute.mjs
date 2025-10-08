import pg from 'pg'
import { config } from 'dotenv'

config({ path: '.env.local', override: true })

const { Client } = pg

// Supabase 연결 정보 - 직접 연결 포트 사용 (6543이 아닌 5432)
const connectionString = `postgresql://postgres.qvhbigvdfyvhoegkhvef:${process.env.SUPABASE_SERVICE_ROLE_KEY}@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false }
})

async function executeMigration() {
  try {
    console.log('🔌 Supabase 데이터베이스에 연결 중...')
    await client.connect()
    console.log('✅ 연결 성공!\n')

    // SQL 명령들
    const commands = [
      {
        name: 'is_received 컬럼 추가',
        sql: 'ALTER TABLE purchase_request_items ADD COLUMN IF NOT EXISTS is_received BOOLEAN DEFAULT FALSE'
      },
      {
        name: 'received_at 컬럼 추가',
        sql: 'ALTER TABLE purchase_request_items ADD COLUMN IF NOT EXISTS received_at TIMESTAMP WITH TIME ZONE'
      },
      {
        name: '인덱스 생성',
        sql: 'CREATE INDEX IF NOT EXISTS idx_purchase_request_items_is_received ON purchase_request_items(is_received)'
      }
    ]

    // 각 명령 실행
    for (const cmd of commands) {
      try {
        console.log(`⚙️  ${cmd.name} 실행 중...`)
        await client.query(cmd.sql)
        console.log(`✅ ${cmd.name} 완료`)
      } catch (err) {
        console.log(`⚠️  ${cmd.name} - ${err.message.includes('already exists') ? '이미 존재함' : err.message}`)
      }
    }

    // 컬럼 확인
    console.log('\n📊 컬럼 상태 확인...')
    const result = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'purchase_request_items' 
      AND column_name IN ('is_received', 'received_at')
    `)

    if (result.rows.length === 2) {
      console.log('✅ 모든 컬럼이 성공적으로 추가되었습니다!')
      result.rows.forEach(row => {
        console.log(`   - ${row.column_name}: ✅`)
      })
    } else {
      console.log('일부 컬럼이 누락되었습니다:', result.rows)
    }

  } catch (error) {
    console.error('❌ 오류 발생:', error.message)
  } finally {
    await client.end()
    console.log('\n🔌 연결 종료')
  }
}

executeMigration()