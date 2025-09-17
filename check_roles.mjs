import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wffquhxancribqhajmoa.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmZnF1aHhhbmNyaWJxaGFqbW9hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzE4MjY5MDAsImV4cCI6MjA0NzQwMjkwMH0.UXg5fwUgrLJqEzJvRVxJjB3OKypc4TIJaqOIBilcSj0';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRoles() {
  // 모든 직원의 purchase_role 확인
  const { data: employees, error } = await supabase
    .from('employees')
    .select('name, email, purchase_role')
    .not('purchase_role', 'is', null);
    
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('Employees with purchase_role:');
  employees.forEach(emp => {
    console.log(`${emp.name} (${emp.email}): ${emp.purchase_role}`);
  });
  
  process.exit(0);
}

checkRoles();
