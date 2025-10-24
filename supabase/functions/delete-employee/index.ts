import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    const { employeeId } = await req.json()
    
    if (!employeeId) {
      return new Response(
        JSON.stringify({ error: 'Employee ID is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`Deleting employee with ID: ${employeeId}`)

    // 1. attendance_records에서 삭제
    const { error: attendanceError } = await supabase
      .from('attendance_records')
      .delete()
      .eq('employee_id', employeeId)
    
    if (attendanceError) {
      console.error('Error deleting attendance records:', attendanceError)
    } else {
      console.log('Successfully deleted attendance records')
    }

    // 2. leave 테이블에서 삭제
    const { error: leaveError } = await supabase
      .from('leave')
      .delete()
      .eq('employee_id', employeeId)
    
    if (leaveError) {
      console.error('Error deleting leave records:', leaveError)
    } else {
      console.log('Successfully deleted leave records')
    }

    // 3. purchase_requests에서 해당 직원이 요청자인 것들의 items 먼저 삭제
    const { data: purchaseRequests } = await supabase
      .from('purchase_requests')
      .select('id')
      .eq('requester_id', employeeId)

    if (purchaseRequests && purchaseRequests.length > 0) {
      const requestIds = purchaseRequests.map(pr => pr.id)
      
      // purchase_request_items 삭제
      const { error: itemsError } = await supabase
        .from('purchase_request_items')
        .delete()
        .in('purchase_request_id', requestIds)
      
      if (itemsError) {
        console.error('Error deleting purchase request items:', itemsError)
      } else {
        console.log('Successfully deleted purchase request items')
      }

      // purchase_requests 삭제
      const { error: requestsError } = await supabase
        .from('purchase_requests')
        .delete()
        .eq('requester_id', employeeId)
      
      if (requestsError) {
        console.error('Error deleting purchase requests:', requestsError)
      } else {
        console.log('Successfully deleted purchase requests')
      }
    }

    // 4. 마지막으로 employees 테이블에서 삭제
    const { error: employeeError } = await supabase
      .from('employees')
      .delete()
      .eq('id', employeeId)

    if (employeeError) {
      console.error('Error deleting employee:', employeeError)
      return new Response(
        JSON.stringify({ error: 'Failed to delete employee', details: employeeError }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log('Successfully deleted employee')

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Employee and all related data deleted successfully' 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})