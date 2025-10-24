import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'

export default function DeleteEmployee() {
  const [isDeleting, setIsDeleting] = useState(false)
  const [result, setResult] = useState<string>('')

  // 페이지 로드 시 자동으로 삭제 실행
  useEffect(() => {
    deleteKimChangHyeon()
  }, [])

  const deleteKimChangHyeon = async () => {
    const employeeId = '3dca77ed-fe44-46f0-9789-86580e9f8c1d' // 김창현 ID
    
    setIsDeleting(true)
    setResult('김창현 직원 삭제 시작...')

    try {
      // 1. attendance_records에서 삭제
      console.log('1. attendance_records 삭제 중...')
      setResult(prev => prev + '\n1. attendance_records 삭제 중...')
      
      const { error: attendanceError } = await supabase
        .from('attendance_records')
        .delete()
        .eq('employee_id', employeeId)
      
      if (attendanceError) {
        console.error('attendance_records 삭제 오류:', attendanceError)
        setResult(prev => prev + '\n❌ attendance_records 삭제 오류: ' + attendanceError.message)
      } else {
        console.log('attendance_records 삭제 완료')
        setResult(prev => prev + '\n✅ attendance_records 삭제 완료')
      }

      // 2. leave 테이블에서 삭제
      console.log('2. leave 기록 삭제 중...')
      setResult(prev => prev + '\n2. leave 기록 삭제 중...')
      
      const { error: leaveError } = await supabase
        .from('leave')
        .delete()
        .eq('employee_id', employeeId)
      
      if (leaveError) {
        console.error('leave 삭제 오류:', leaveError)
        setResult(prev => prev + '\n❌ leave 삭제 오류: ' + leaveError.message)
      } else {
        console.log('leave 기록 삭제 완료')
        setResult(prev => prev + '\n✅ leave 기록 삭제 완료')
      }

      // 3. purchase_requests 관련 삭제
      console.log('3. purchase_requests 확인 중...')
      setResult(prev => prev + '\n3. purchase_requests 확인 중...')
      
      const { data: purchaseRequests } = await supabase
        .from('purchase_requests')
        .select('id')
        .eq('requester_id', employeeId)

      if (purchaseRequests && purchaseRequests.length > 0) {
        console.log(`${purchaseRequests.length}개의 purchase_requests 발견`)
        setResult(prev => prev + `\n${purchaseRequests.length}개의 purchase_requests 발견`)
        
        const requestIds = purchaseRequests.map(pr => pr.id)
        
        // purchase_request_items 삭제
        console.log('purchase_request_items 삭제 중...')
        setResult(prev => prev + '\npurchase_request_items 삭제 중...')
        
        const { error: itemsError } = await supabase
          .from('purchase_request_items')
          .delete()
          .in('purchase_request_id', requestIds)
        
        if (itemsError) {
          console.error('purchase_request_items 삭제 오류:', itemsError)
          setResult(prev => prev + '\n❌ purchase_request_items 삭제 오류: ' + itemsError.message)
        } else {
          console.log('purchase_request_items 삭제 완료')
          setResult(prev => prev + '\n✅ purchase_request_items 삭제 완료')
        }

        // purchase_requests 삭제
        console.log('purchase_requests 삭제 중...')
        setResult(prev => prev + '\npurchase_requests 삭제 중...')
        
        const { error: requestsError } = await supabase
          .from('purchase_requests')
          .delete()
          .eq('requester_id', employeeId)
        
        if (requestsError) {
          console.error('purchase_requests 삭제 오류:', requestsError)
          setResult(prev => prev + '\n❌ purchase_requests 삭제 오류: ' + requestsError.message)
        } else {
          console.log('purchase_requests 삭제 완료')
          setResult(prev => prev + '\n✅ purchase_requests 삭제 완료')
        }
      } else {
        console.log('purchase_requests 없음')
        setResult(prev => prev + '\n✅ purchase_requests 없음')
      }

      // 4. 마지막으로 employees 테이블에서 삭제
      console.log('4. employees 테이블에서 삭제 중...')
      setResult(prev => prev + '\n4. employees 테이블에서 삭제 중...')
      
      const { error: employeeError } = await supabase
        .from('employees')
        .delete()
        .eq('id', employeeId)

      if (employeeError) {
        console.error('employees 삭제 오류:', employeeError)
        setResult(prev => prev + '\n❌ employees 삭제 오류: ' + employeeError.message)
        throw employeeError
      }

      console.log('✅ 김창현 직원 및 관련 데이터 삭제 완료!')
      setResult(prev => prev + '\n✅ 김창현 직원 및 관련 데이터 삭제 완료!')

    } catch (error) {
      console.error('❌ 삭제 중 오류 발생:', error)
      setResult(prev => prev + '\n❌ 삭제 중 오류 발생: ' + (error as Error).message)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">김창현 직원 삭제</h1>
      
      <Button 
        onClick={deleteKimChangHyeon} 
        disabled={isDeleting}
        variant="destructive"
        className="mb-4"
      >
        {isDeleting ? '삭제 중...' : '김창현 삭제 실행'}
      </Button>
      
      {result && (
        <div className="bg-gray-100 p-4 rounded whitespace-pre-wrap">
          {result}
        </div>
      )}
    </div>
  )
}