import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setupBomStorage() {
  try {
    console.log('Checking for existing bom-files bucket...');
    
    // 버킷 목록 확인
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    
    if (listError) {
      console.error('Error listing buckets:', listError);
      return;
    }
    
    console.log('Existing buckets:', buckets?.map(b => b.name));
    
    const existingBucket = buckets?.find(b => b.name === 'bom-files');
    
    if (existingBucket) {
      console.log('✅ bom-files bucket already exists');
    } else {
      console.log('Creating bom-files bucket...');
      
      // 버킷 생성
      const { data, error: createError } = await supabase.storage.createBucket('bom-files', {
        public: false, // 인증된 사용자만 접근 가능
        fileSizeLimit: 10485760, // 10MB 제한
        allowedMimeTypes: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/plain',
          'text/csv'
        ]
      });
      
      if (createError) {
        console.error('Error creating bucket:', createError);
      } else {
        console.log('✅ bom-files bucket created successfully:', data);
      }
    }
    
    // 버킷 정책 확인 (RLS)
    console.log('\nNote: Remember to set up RLS policies for the bucket in Supabase Dashboard:');
    console.log('1. Go to Storage > Policies');
    console.log('2. Add policies for authenticated users to upload/download files');
    console.log('3. Or run the migration SQL script: scripts/migrations/20241127_create_bom_storage_bucket.sql');
    
  } catch (error) {
    console.error('Setup failed:', error);
  }
}

// 실행
setupBomStorage();