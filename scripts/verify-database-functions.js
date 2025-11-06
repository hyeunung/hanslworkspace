#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function checkDatabaseFunctions() {
  console.log('Checking database functions...\n');

  const functionsToCheck = [
    'notify_middle_manager_explicit',
    'notify_middle_manager_on_insert',
    'http_post_wrapper'
  ];

  for (const functionName of functionsToCheck) {
    try {
      // Try to get function information from pg_proc
      const { data, error } = await supabase.rpc('pg_get_functiondef', {
        funcoid: `'public.${functionName}'::regprocedure`
      }).single();

      if (error && error.code === 'PGRST202') {
        // Function doesn't exist in RPC whitelist, try a different approach
        const { data: funcData, error: funcError } = await supabase
          .from('pg_proc')
          .select('proname')
          .eq('proname', functionName)
          .single();

        if (funcError) {
          console.log(`❌ ${functionName}: NOT FOUND`);
        } else {
          console.log(`✅ ${functionName}: EXISTS`);
        }
      } else if (error) {
        console.log(`❌ ${functionName}: ERROR - ${error.message}`);
      } else {
        console.log(`✅ ${functionName}: EXISTS`);
      }
    } catch (err) {
      // Alternative check using a simple query
      try {
        const testQuery = `SELECT proname FROM pg_proc WHERE proname = '${functionName}' LIMIT 1`;
        const { data: testData, error: testError } = await supabase.rpc('exec_sql', { sql: testQuery });
        
        if (testError) {
          console.log(`❓ ${functionName}: Cannot verify (no direct SQL access)`);
        } else if (testData && testData.length > 0) {
          console.log(`✅ ${functionName}: EXISTS`);
        } else {
          console.log(`❌ ${functionName}: NOT FOUND`);
        }
      } catch {
        console.log(`❓ ${functionName}: Cannot verify`);
      }
    }
  }

  // Try to call the notify_middle_manager_explicit function with a test ID
  console.log('\nTesting notify_middle_manager_explicit function call...');
  try {
    const { data, error } = await supabase.rpc('notify_middle_manager_explicit', {
      purchase_request_id_param: -1 // Use invalid ID to test if function exists
    });

    if (error) {
      if (error.message.includes('function') && error.message.includes('does not exist')) {
        console.log('❌ Function does not exist in database');
        console.log('\n⚠️  You need to run the migration script to create this function.');
        console.log('   Copy the function definition from hanslwebapp migrations.');
      } else if (error.message.includes('Purchase request not found')) {
        console.log('✅ Function exists and is working correctly');
      } else {
        console.log(`⚠️  Function exists but returned error: ${error.message}`);
      }
    } else {
      console.log('✅ Function exists');
      if (data) {
        console.log('   Response:', JSON.stringify(data, null, 2));
      }
    }
  } catch (err) {
    console.log(`❌ Error testing function: ${err.message}`);
  }

  console.log('\nChecking Edge Functions...');
  const edgeFunctions = [
    'middle-manager-notification'
  ];

  for (const funcName of edgeFunctions) {
    const url = `${supabaseUrl}/functions/v1/${funcName}`;
    console.log(`  ${funcName}: ${url}`);
  }
  console.log('\n✅ These edge functions should be deployed on your Supabase project');
}

checkDatabaseFunctions().then(() => {
  console.log('\nVerification complete.');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});