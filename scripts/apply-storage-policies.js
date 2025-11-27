import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function applyStoragePolicies() {
  try {
    console.log('Applying storage policies for bom-files bucket...');
    
    // RLS 정책 SQL 실행
    const policies = [
      {
        name: 'Allow authenticated uploads to bom-files',
        sql: `
          CREATE POLICY IF NOT EXISTS "Allow authenticated uploads to bom-files"
          ON storage.objects
          FOR INSERT
          TO authenticated
          WITH CHECK (bucket_id = 'bom-files');
        `
      },
      {
        name: 'Allow authenticated downloads from bom-files',
        sql: `
          CREATE POLICY IF NOT EXISTS "Allow authenticated downloads from bom-files"
          ON storage.objects
          FOR SELECT
          TO authenticated
          USING (bucket_id = 'bom-files');
        `
      },
      {
        name: 'Allow users to delete their own files',
        sql: `
          CREATE POLICY IF NOT EXISTS "Allow users to delete their own files"
          ON storage.objects
          FOR DELETE
          TO authenticated
          USING (bucket_id = 'bom-files' AND auth.uid()::text = owner::text);
        `
      }
    ];
    
    for (const policy of policies) {
      console.log(`Applying policy: ${policy.name}`);
      const { error } = await supabase.rpc('exec_sql', {
        query: policy.sql
      }).single();
      
      if (error) {
        // Policy might already exist, which is fine
        if (!error.message?.includes('already exists')) {
          console.error(`Error applying policy ${policy.name}:`, error);
        } else {
          console.log(`Policy ${policy.name} already exists, skipping...`);
        }
      } else {
        console.log(`✅ Policy ${policy.name} applied successfully`);
      }
    }
    
    console.log('\n✅ Storage policies setup complete!');
    console.log('You should now be able to upload files to the bom-files bucket.');
    
  } catch (error) {
    console.error('Failed to apply policies:', error);
    console.log('\nAlternative: Apply these policies manually in Supabase Dashboard:');
    console.log('1. Go to Storage > Policies');
    console.log('2. Select the "bom-files" bucket');
    console.log('3. Add policies for INSERT, SELECT, and DELETE for authenticated users');
  }
}

// 실행
applyStoragePolicies();