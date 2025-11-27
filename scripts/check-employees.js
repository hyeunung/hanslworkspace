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

async function checkEmployees() {
  try {
    console.log('Checking employees table...\n');
    
    // 1. 전체 직원 수 확인
    const { count: totalCount, error: countError } = await supabase
      .from('employees')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.error('Error counting employees:', countError);
      return;
    }
    
    console.log(`Total employees: ${totalCount}`);
    
    // 2. 모든 직원 조회 (status 컬럼이 없음)
    const { data: activeEmployees, error: activeError } = await supabase
      .from('employees')
      .select('id, name, email')
      .order('name');
    
    if (activeError) {
      console.error('Error loading active employees:', activeError);
      return;
    }
    
    console.log(`All employees: ${activeEmployees?.length || 0}\n`);
    
    if (activeEmployees && activeEmployees.length > 0) {
      console.log('Employee list (first 10):');
      activeEmployees.slice(0, 10).forEach((emp, index) => {
        console.log(`${index + 1}. ${emp.name} (${emp.email})`);
      });
    } else {
      console.log('No active employees found!');
      
      // 3. 모든 직원 조회 (상태 무관)
      const { data: allEmployees, error: allError } = await supabase
        .from('employees')
        .select('id, name, email, status')
        .order('name')
        .limit(5);
      
      if (allEmployees && allEmployees.length > 0) {
        console.log('\nSample of all employees (showing first 5):');
        allEmployees.forEach((emp, index) => {
          console.log(`${index + 1}. ${emp.name} (${emp.email}) - Status: ${emp.status || 'NULL'}`);
        });
        
        console.log('\n⚠️ Note: No employees have status = "active"');
        console.log('You may need to update employee statuses in the database.');
      }
    }
    
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// 실행
checkEmployees();