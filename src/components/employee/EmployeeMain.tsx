
import { useState, useEffect } from 'react'
import { Employee, EmployeeFilters as EmployeeFiltersType } from '@/types/purchase'
import { employeeService } from '@/services/employeeService'
import EmployeeFilters from '@/components/employee/EmployeeFilters'
import EmployeeTable from '@/components/employee/EmployeeTable'
import EmployeeModal from '@/components/employee/EmployeeModal'
import AttendanceDownload from '@/components/employee/AttendanceDownload'
import { toast } from 'sonner'
// XLSX는 사용할 때만 동적으로 import (성능 최적화)

type ModalMode = 'create' | 'edit' | 'view'

export default function EmployeeMain() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<EmployeeFiltersType>({})
  
  // 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [modalMode, setModalMode] = useState<ModalMode>('create')
  
  // 출근현황표 모달 상태
  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false)

  // 직원 목록 로드
  const loadEmployees = async () => {
    setLoading(true)
    try {
      const result = await employeeService.getEmployees(filters)
      
      if (result.success && result.data) {
        setEmployees(result.data)
        setFilteredEmployees(result.data)
      } else {
        toast.error(result.error || '직원 목록을 불러오는데 실패했습니다.')
      }
    } catch (error) {
      toast.error('직원 목록을 불러오는 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  // 초기 로드
  useEffect(() => {
    loadEmployees()
  }, [])

  // 필터 변경 시 직원 목록 다시 로드
  useEffect(() => {
    loadEmployees()
  }, [filters])

  // 모달 핸들러
  const handleCreateNew = () => {
    setSelectedEmployee(null)
    setModalMode('create')
    setIsModalOpen(true)
  }

  const handleEdit = (employee: Employee) => {
    setSelectedEmployee(employee)
    setModalMode('edit')
    setIsModalOpen(true)
  }

  const handleView = (employee: Employee) => {
    setSelectedEmployee(employee)
    setModalMode('view')
    setIsModalOpen(true)
  }

  const handleModalClose = () => {
    setIsModalOpen(false)
    setSelectedEmployee(null)
  }

  const handleSave = () => {
    loadEmployees()
  }

  // Excel 내보내기 (동적 import로 성능 최적화)
  const handleExport = async () => {
    try {
      const result = await employeeService.getEmployeesForExport()
      
      if (result.success && result.data) {
        // XLSX를 사용할 때만 동적으로 import
        const XLSX = await import('xlsx')
        
        const ws = XLSX.utils.json_to_sheet(result.data)
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, '직원 목록')
        
        // 파일명에 현재 날짜 추가
        const today = new Date().toISOString().slice(0, 10)
        const filename = `직원_목록_${today}.xlsx`
        
        XLSX.writeFile(wb, filename)
        toast.success('Excel 파일이 다운로드되었습니다.')
      } else {
        toast.error(result.error || 'Excel 내보내기에 실패했습니다.')
      }
    } catch (error) {
      toast.error('Excel 내보내기 중 오류가 발생했습니다.')
    }
  }

  if (loading && employees.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 card-subtitle">직원 목록을 불러오는 중...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6">
      {/* 필터 섹션 */}
      <EmployeeFilters
        filters={filters}
        onFiltersChange={setFilters}
        onExport={handleExport}
        onCreateNew={handleCreateNew}
        onAttendanceDownload={() => setIsAttendanceModalOpen(true)}
      />

      {/* 테이블 섹션 */}
      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b">
          <div className="flex justify-between items-center">
            <h3 className="modal-title">직원 목록</h3>
            <div className="card-description">
              {loading ? '로딩 중...' : `총 ${filteredEmployees.length}명의 직원`}
            </div>
          </div>
        </div>
        
        <EmployeeTable
          employees={filteredEmployees}
          onEdit={handleEdit}
          onView={handleView}
          onRefresh={loadEmployees}
        />
      </div>

      {/* 직원 모달 */}
      <EmployeeModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        employee={selectedEmployee}
        onSave={handleSave}
        mode={modalMode}
      />

      {/* 출근현황표 다운로드 모달 */}
      <AttendanceDownload
        employees={employees}
        isOpen={isAttendanceModalOpen}
        onClose={() => setIsAttendanceModalOpen(false)}
      />
      </div>
    </>
  )
}