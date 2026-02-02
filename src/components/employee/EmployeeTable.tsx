
import { useEffect, useMemo, useState } from 'react'
import { Employee, PurchaseRole } from '@/types/purchase'
import { formatDate } from '@/utils/helpers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { 
  MoreHorizontal, 
  Edit, 
  Trash2, 
  Save,
  X,
  ToggleLeft, 
  ToggleRight,
} from 'lucide-react'
import { employeeService } from '@/services/employeeService'
import { toast } from 'sonner'
import { useTableSort } from '@/hooks/useTableSort'
import { SortableHeader } from '@/components/ui/sortable-header'
import { MobileCard, MobileCardItem, MobileCardHeader, MobileCardActions } from '@/components/ui/mobile-card'

interface EmployeeTableProps {
  employees: Employee[]
  onRefresh: () => void
  currentUserRoles?: string[]
  createRequestToken?: number
}

type EmployeeDraft = {
  employeeID: string
  name: string
  position: string
  department: string
  phone: string
  email: string
  annual_leave_granted_current_year: string
  used_annual_leave: string
  remaining_annual_leave: string
  join_date: string
  birthday: string
  bank: string
  bank_account: string
  adress: string
  purchase_role: string
  is_active: 'true' | 'false'
}

const NEW_ROW_ID = '__new_employee__'

const PURCHASE_ROLES: { value: PurchaseRole; label: string }[] = [
  { value: 'app_admin', label: '앱 관리자' },
  { value: 'hr', label: 'HR' },
  { value: 'accounting', label: '회계' },
  { value: 'ceo', label: 'CEO' },
  { value: 'final_approver', label: '최종 승인자' },
  { value: 'middle_manager', label: '중간 관리자' },
  { value: 'lead buyer', label: '수석 구매자' },
  { value: 'buyer', label: '구매자' },
]

const toInputDate = (value?: string | null) => {
  if (!value) return ''
  // ISO 문자열이면 YYYY-MM-DD만 사용
  return value.includes('T') ? value.slice(0, 10) : value
}

const defaultDraft = (): EmployeeDraft => ({
  employeeID: '',
  name: '',
  position: '',
  department: '',
  phone: '',
  email: '',
  annual_leave_granted_current_year: '',
  used_annual_leave: '',
  remaining_annual_leave: '',
  join_date: '',
  birthday: '',
  bank: '',
  bank_account: '',
  adress: '',
  purchase_role: '',
  is_active: 'true',
})

export default function EmployeeTable({
  employees,
  onRefresh,
  currentUserRoles = [],
  createRequestToken = 0,
}: EmployeeTableProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const { sortedData, sortConfig, handleSort } = useTableSort(employees, 'name', 'asc')
  const canManageEmployees = currentUserRoles.includes('app_admin') || currentUserRoles.includes('hr')
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [draft, setDraft] = useState<EmployeeDraft | null>(null)

  const handleToggleStatus = async (employee: Employee) => {
    if (!canManageEmployees) {
      toast.error('상태 변경 권한이 없습니다.')
      return
    }
    setLoadingId(employee.id)
    try {
      const result = await employeeService.toggleEmployeeStatus(employee.id)
      
      if (result.success) {
        toast.success(`직원이 ${employee.is_active ? '비활성화' : '활성화'}되었습니다.`)
        onRefresh()
      } else {
        toast.error(result.error || '상태 변경에 실패했습니다.')
      }
    } catch (error) {
      toast.error('상태 변경 중 오류가 발생했습니다.')
    } finally {
      setLoadingId(null)
    }
  }

  const handleDelete = async (employee: Employee) => {
    if (!canManageEmployees) {
      toast.error('삭제 권한이 없습니다.')
      return
    }
    if (!confirm(`정말로 '${employee.name}' 직원을 삭제하시겠습니까?`)) {
      return
    }

    setLoadingId(employee.id)
    try {
      const result = await employeeService.deleteEmployee(employee.id)
      
      if (result.success) {
        toast.success('직원이 삭제되었습니다.')
        onRefresh()
      } else {
        toast.error(result.error || '삭제에 실패했습니다.')
      }
    } catch (error) {
      toast.error('삭제 중 오류가 발생했습니다.')
    } finally {
      setLoadingId(null)
    }
  }

  const normalizeRoles = (role?: string | string[] | null) => {
    if (!role) return []
    if (Array.isArray(role)) {
      return role.filter((value) => value && value.trim())
    }
    if (typeof role === 'string') {
      return role.split(',').map((value) => value.trim()).filter(Boolean)
    }
    return []
  }

  const getPrimaryRole = (role?: string | string[] | null) => {
    const roles = normalizeRoles(role)
    return roles[0]
  }

  const getRoleDisplayName = (role?: string | string[] | null) => {
    const roleNames: Record<string, string> = {
      'app_admin': '앱 관리자',
      'hr': 'HR',
      'accounting': '회계',
      'ceo': 'CEO',
      'final_approver': '최종 승인자',
      'middle_manager': '중간 관리자',
      'lead buyer': '수석 구매자',
      'buyer': '구매자'
    }
    
    const primaryRole = getPrimaryRole(role)
    if (!primaryRole) {
      return '권한 없음'
    }
    return roleNames[primaryRole] || primaryRole
  }

  const getRoleBadgeColor = (role?: string | string[] | null) => {
    const colorMap: Record<string, string> = {
      'app_admin': 'bg-purple-100 text-purple-800',
      'hr': 'bg-blue-100 text-blue-800',
      'accounting': 'bg-sky-100 text-sky-800',
      'ceo': 'bg-red-100 text-red-800',
      'final_approver': 'bg-hansl-100 text-hansl-800',
      'middle_manager': 'bg-green-100 text-green-800',
      'lead buyer': 'bg-yellow-100 text-yellow-800',
      'buyer': 'bg-gray-100 text-gray-800'
    }
    
    const primaryRole = getPrimaryRole(role)
    return colorMap[primaryRole || ''] || 'bg-gray-100 text-gray-600'
  }

  const startCreate = () => {
    if (!canManageEmployees) {
      toast.error('직원 등록 권한이 없습니다.')
      return
    }
    setIsCreating(true)
    setEditingRowId(NEW_ROW_ID)
    setDraft(defaultDraft())
  }

  useEffect(() => {
    if (!createRequestToken) return
    startCreate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequestToken])

  const startEdit = (employee: Employee) => {
    if (!canManageEmployees) {
      toast.error('직원 수정 권한이 없습니다.')
      return
    }

    const primaryRole = getPrimaryRole(employee.purchase_role) || ''
    setIsCreating(false)
    setEditingRowId(employee.id)
    setDraft({
      employeeID: employee.employeeID || employee.employee_number || '',
      name: employee.name || '',
      position: employee.position || '',
      department: employee.department || '',
      phone: employee.phone || '',
      email: employee.email || '',
      annual_leave_granted_current_year:
        employee.annual_leave_granted_current_year === undefined || employee.annual_leave_granted_current_year === null
          ? ''
          : String(employee.annual_leave_granted_current_year),
      used_annual_leave:
        employee.used_annual_leave === undefined || employee.used_annual_leave === null ? '' : String(employee.used_annual_leave),
      remaining_annual_leave:
        employee.remaining_annual_leave === undefined || employee.remaining_annual_leave === null
          ? ''
          : String(employee.remaining_annual_leave),
      join_date: toInputDate(employee.join_date),
      birthday: toInputDate(employee.birthday),
      bank: employee.bank || '',
      bank_account: employee.bank_account || '',
      adress: employee.adress || '',
      purchase_role: primaryRole,
      is_active: employee.is_active ? 'true' : 'false',
    })
  }

  const cancelEdit = () => {
    setEditingRowId(null)
    setIsCreating(false)
    setDraft(null)
  }

  const toNullableTrimmed = (value: string) => {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }

  const toNullableNumber = (value: string) => {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const numberValue = Number(trimmed)
    return Number.isFinite(numberValue) ? numberValue : null
  }

  const handleSave = async () => {
    if (!canManageEmployees) {
      toast.error('직원 수정 권한이 없습니다.')
      return
    }
    if (!draft || !editingRowId) return

    const name = draft.name.trim()
    const email = draft.email.trim()
    if (!name) {
      toast.error('이름은 필수입니다.')
      return
    }
    if (!email) {
      toast.error('이메일은 필수입니다.')
      return
    }

    const payload: any = {
      // 사번은 1칸 입력으로 받고, 하위호환 필드까지 동일 값으로 저장
      employeeID: toNullableTrimmed(draft.employeeID),
      employee_number: toNullableTrimmed(draft.employeeID),
      name,
      position: toNullableTrimmed(draft.position),
      department: toNullableTrimmed(draft.department),
      phone: toNullableTrimmed(draft.phone),
      email,
      annual_leave_granted_current_year: toNullableNumber(draft.annual_leave_granted_current_year),
      used_annual_leave: toNullableNumber(draft.used_annual_leave),
      remaining_annual_leave: toNullableNumber(draft.remaining_annual_leave),
      join_date: toNullableTrimmed(draft.join_date),
      birthday: toNullableTrimmed(draft.birthday),
      bank: toNullableTrimmed(draft.bank),
      bank_account: toNullableTrimmed(draft.bank_account),
      adress: toNullableTrimmed(draft.adress),
      purchase_role: draft.purchase_role ? [draft.purchase_role] : [],
      is_active: draft.is_active === 'true',
    }

    setLoadingId(editingRowId)
    try {
      const result =
        editingRowId === NEW_ROW_ID
          ? await employeeService.createEmployee(payload)
          : await employeeService.updateEmployee(editingRowId, payload)

      if (result.success) {
        toast.success(editingRowId === NEW_ROW_ID ? '직원이 등록되었습니다.' : '직원 정보가 수정되었습니다.')
        cancelEdit()
        onRefresh()
      } else {
        toast.error(result.error || '저장에 실패했습니다.')
      }
    } catch (error) {
      toast.error('저장 중 오류가 발생했습니다.')
    } finally {
      setLoadingId(null)
    }
  }

  const updateDraft = <K extends keyof EmployeeDraft>(key: K, value: EmployeeDraft[K]) => {
    setDraft((prev) => {
      if (!prev) return prev
      return { ...prev, [key]: value }
    })
  }

  const displayRows: Employee[] = useMemo(() => {
    if (!isCreating || editingRowId !== NEW_ROW_ID) return sortedData

    const pseudo: Employee = {
      id: NEW_ROW_ID,
      employeeID: draft?.employeeID || '',
      employee_number: draft?.employeeID || '',
      name: draft?.name || '',
      email: draft?.email || '',
      department: draft?.department || '',
      position: draft?.position || '',
      phone: draft?.phone || '',
      purchase_role: draft?.purchase_role ? [draft.purchase_role] : null,
      is_active: draft?.is_active === 'true',
      terminated_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      bank: draft?.bank || '',
      bank_account: draft?.bank_account || '',
      adress: draft?.adress || '',
      join_date: draft?.join_date || '',
      birthday: draft?.birthday || '',
      annual_leave_granted_current_year: draft?.annual_leave_granted_current_year ? Number(draft.annual_leave_granted_current_year) : 0,
      used_annual_leave: draft?.used_annual_leave ? Number(draft.used_annual_leave) : 0,
      remaining_annual_leave: draft?.remaining_annual_leave ? Number(draft.remaining_annual_leave) : 0,
    }

    return [pseudo, ...sortedData]
  }, [draft, editingRowId, isCreating, sortedData])

  const isEditingRow = (employeeId: string) => canManageEmployees && editingRowId === employeeId && !!draft

  return (
    <>
      {/* Table View (md+) */}
      <div className="hidden md:block border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 min-w-[50px]">
              <SortableHeader
                sortKey="employeeID"
                currentSortKey={sortConfig.key as string | null}
                sortDirection={sortConfig.direction}
                onSort={() => handleSort('employeeID' as keyof Employee)}
              >
                사번
              </SortableHeader>
            </TableHead>
            <TableHead className="w-14 min-w-[45px]">
              <SortableHeader
                sortKey="name"
                currentSortKey={sortConfig.key as string | null}
                sortDirection={sortConfig.direction}
                onSort={() => handleSort('name' as keyof Employee)}
              >
                이름
              </SortableHeader>
            </TableHead>
            <TableHead className="w-12 min-w-[40px]">
              <SortableHeader
                sortKey="position"
                currentSortKey={sortConfig.key as string | null}
                sortDirection={sortConfig.direction}
                onSort={() => handleSort('position' as keyof Employee)}
              >
                직급
              </SortableHeader>
            </TableHead>
            <TableHead className="w-16 min-w-[50px]">
              <SortableHeader
                sortKey="department"
                currentSortKey={sortConfig.key as string | null}
                sortDirection={sortConfig.direction}
                onSort={() => handleSort('department' as keyof Employee)}
              >
                부서
              </SortableHeader>
            </TableHead>
            <TableHead className="w-20 min-w-[70px]">
              <SortableHeader
                sortKey="phone"
                currentSortKey={sortConfig.key as string | null}
                sortDirection={sortConfig.direction}
                onSort={() => handleSort('phone' as keyof Employee)}
              >
                연락처
              </SortableHeader>
            </TableHead>
            <TableHead className="w-32 min-w-[100px]">
              <SortableHeader
                sortKey="email"
                currentSortKey={sortConfig.key as string | null}
                sortDirection={sortConfig.direction}
                onSort={() => handleSort('email' as keyof Employee)}
              >
                이메일
              </SortableHeader>
            </TableHead>
            {canManageEmployees && (
              <>
                {/* 연차 정보 */}
                <TableHead className="w-11 min-w-[40px] text-center">생성</TableHead>
                <TableHead className="w-11 min-w-[40px] text-center">사용</TableHead>
                <TableHead className="w-11 min-w-[40px] text-center">남은</TableHead>
                <TableHead className="w-18 min-w-[60px]">
                  <SortableHeader
                    sortKey="join_date"
                    currentSortKey={sortConfig.key as string | null}
                    sortDirection={sortConfig.direction}
                    onSort={() => handleSort('join_date' as keyof Employee)}
                  >
                    입사일
                  </SortableHeader>
                </TableHead>
                <TableHead className="w-20 min-w-[70px]">
                  <SortableHeader
                    sortKey="birthday"
                    currentSortKey={sortConfig.key as string | null}
                    sortDirection={sortConfig.direction}
                    onSort={() => handleSort('birthday' as keyof Employee)}
                  >
                    생년월일
                  </SortableHeader>
                </TableHead>
                {/* 민감한 정보 */}
                <TableHead className="w-14 min-w-[45px]">은행</TableHead>
                <TableHead className="w-24 min-w-[80px]">계좌번호</TableHead>
                <TableHead className="min-w-[120px]">주소</TableHead>
                <TableHead>
                  <SortableHeader
                    sortKey="purchase_role"
                    currentSortKey={sortConfig.key as string | null}
                    sortDirection={sortConfig.direction}
                    onSort={() => handleSort('purchase_role' as keyof Employee)}
                  >
                    권한
                  </SortableHeader>
                </TableHead>
                <TableHead>
                  <SortableHeader
                    sortKey="is_active"
                    currentSortKey={sortConfig.key as string | null}
                    sortDirection={sortConfig.direction}
                    onSort={() => handleSort('is_active' as keyof Employee)}
                  >
                    상태
                  </SortableHeader>
                </TableHead>
                <TableHead className="w-16 min-w-[50px]">작업</TableHead>
              </>
            )}
              </TableRow>
            </TableHeader>
        <TableBody>
          {displayRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canManageEmployees ? 17 : 6} className="text-center py-8 text-gray-500">
                등록된 직원이 없습니다.
              </TableCell>
            </TableRow>
          ) : (
            displayRows.map((employee) => (
              <TableRow key={employee.id}>
                <TableCell className="text-[11px] px-2 py-1.5">
                  {isEditingRow(employee.id) ? (
                    <Input
                      value={draft?.employeeID || ''}
                      onChange={(e) => updateDraft('employeeID', e.target.value)}
                      placeholder="사번"
                      className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                    />
                  ) : (
                    employee.employeeID || employee.employee_number || employee.id.slice(0, 8)
                  )}
                </TableCell>
                <TableCell className="text-[11px] px-2 py-1.5">
                  {isEditingRow(employee.id) ? (
                    <Input
                      value={draft?.name || ''}
                      onChange={(e) => updateDraft('name', e.target.value)}
                      className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                    />
                  ) : (
                    employee.name
                  )}
                </TableCell>
                <TableCell className="text-[11px] px-2 py-1.5">
                  {isEditingRow(employee.id) ? (
                    <Input
                      value={draft?.position || ''}
                      onChange={(e) => updateDraft('position', e.target.value)}
                      className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                    />
                  ) : (
                    employee.position || '-'
                  )}
                </TableCell>
                <TableCell className="text-[11px] px-2 py-1.5">
                  {isEditingRow(employee.id) ? (
                    <Input
                      value={draft?.department || ''}
                      onChange={(e) => updateDraft('department', e.target.value)}
                      className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                    />
                  ) : (
                    employee.department || '-'
                  )}
                </TableCell>
                <TableCell className="text-[11px] px-2 py-1.5">
                  {isEditingRow(employee.id) ? (
                    <Input
                      value={draft?.phone || ''}
                      onChange={(e) => updateDraft('phone', e.target.value)}
                      className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                    />
                  ) : (
                    employee.phone || '-'
                  )}
                </TableCell>
                <TableCell className="text-[11px] px-2 py-1.5">
                  {isEditingRow(employee.id) ? (
                    <Input
                      value={draft?.email || ''}
                      onChange={(e) => updateDraft('email', e.target.value)}
                      className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                    />
                  ) : (
                    employee.email || '-'
                  )}
                </TableCell>
                {canManageEmployees && (
                  <>
                    {/* 연차 정보 */}
                    <TableCell className="text-center text-[11px] px-1 py-1.5">
                      {isEditingRow(employee.id) ? (
                        <Input
                          type="number"
                          value={draft?.annual_leave_granted_current_year || ''}
                          onChange={(e) => updateDraft('annual_leave_granted_current_year', e.target.value)}
                          className="!h-auto !py-px !px-1 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700 text-center"
                        />
                      ) : (
                        employee.annual_leave_granted_current_year || 0
                      )}
                    </TableCell>
                    <TableCell className="text-center text-[11px] px-1 py-1.5">
                      {isEditingRow(employee.id) ? (
                        <Input
                          type="number"
                          value={draft?.used_annual_leave || ''}
                          onChange={(e) => updateDraft('used_annual_leave', e.target.value)}
                          className="!h-auto !py-px !px-1 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700 text-center"
                        />
                      ) : (
                        employee.used_annual_leave || 0
                      )}
                    </TableCell>
                    <TableCell className="text-center text-[11px] px-1 py-1.5">
                      {isEditingRow(employee.id) ? (
                        <Input
                          type="number"
                          value={draft?.remaining_annual_leave || ''}
                          onChange={(e) => updateDraft('remaining_annual_leave', e.target.value)}
                          className="!h-auto !py-px !px-1 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700 text-center"
                        />
                      ) : employee.remaining_annual_leave !== undefined ? (
                        employee.remaining_annual_leave
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell className="text-[11px] px-2 py-1.5">
                      {isEditingRow(employee.id) ? (
                        <Input
                          type="date"
                          value={draft?.join_date || ''}
                          onChange={(e) => updateDraft('join_date', e.target.value)}
                          className="!h-auto !py-px !px-1 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                        />
                      ) : (
                        formatDate(employee.join_date)
                      )}
                    </TableCell>
                    <TableCell className="text-[11px] px-2 py-1.5">
                      {isEditingRow(employee.id) ? (
                        <Input
                          type="date"
                          value={draft?.birthday || ''}
                          onChange={(e) => updateDraft('birthday', e.target.value)}
                          className="!h-auto !py-px !px-1 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                        />
                      ) : (
                        formatDate(employee.birthday)
                      )}
                    </TableCell>
                    {/* 민감한 정보 */}
                    <TableCell className="px-2 py-1.5">
                      {isEditingRow(employee.id) ? (
                        <Input
                          value={draft?.bank || ''}
                          onChange={(e) => updateDraft('bank', e.target.value)}
                          className="!h-auto !py-px !px-1 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                        />
                      ) : (
                        employee.bank || '-'
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-1.5">
                      {isEditingRow(employee.id) ? (
                        <Input
                          value={draft?.bank_account || ''}
                          onChange={(e) => updateDraft('bank_account', e.target.value)}
                          className="!h-auto !py-px !px-1 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                        />
                      ) : (
                        employee.bank_account || '-'
                      )}
                    </TableCell>
                    <TableCell className="px-1 py-1.5">
                      {isEditingRow(employee.id) ? (
                        <Input
                          value={draft?.adress || ''}
                          onChange={(e) => updateDraft('adress', e.target.value)}
                          className="!h-auto !py-px !px-1 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                        />
                      ) : (
                        employee.adress || '-'
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-1.5">
                      {isEditingRow(employee.id) ? (
                        <Select
                          value={draft?.purchase_role || 'none'}
                          onValueChange={(value) => updateDraft('purchase_role', value === 'none' ? '' : value)}
                        >
                          <SelectTrigger className="!h-auto !min-h-[20px] !py-px !px-2 !text-[11px] business-radius-input border border-gray-300 bg-white text-gray-700">
                            <SelectValue placeholder="권한" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">권한 없음</SelectItem>
                            {PURCHASE_ROLES.map((role) => (
                              <SelectItem key={role.value} value={role.value}>
                                {role.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className={`badge-stats text-[10px] px-1.5 py-0.5 ${getRoleBadgeColor(employee.purchase_role)}`}>
                          {getRoleDisplayName(employee.purchase_role)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-1.5">
                      {isEditingRow(employee.id) ? (
                        <Select
                          value={draft?.is_active || 'true'}
                          onValueChange={(value) => updateDraft('is_active', value as 'true' | 'false')}
                        >
                          <SelectTrigger className="!h-auto !min-h-[20px] !py-px !px-2 !text-[11px] business-radius-input border border-gray-300 bg-white text-gray-700">
                            <SelectValue placeholder="상태" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">활성</SelectItem>
                            <SelectItem value="false">비활성</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span
                          className={`badge-stats text-[10px] px-1.5 py-0.5 ${
                            employee.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {employee.is_active ? '활성' : '비활성'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-1 py-1.5">
                      {isEditingRow(employee.id) ? (
                        <div className="flex gap-1">
                          <Button
                            className="button-base bg-blue-500 hover:bg-blue-600 text-white flex items-center gap-1"
                            onClick={handleSave}
                            disabled={loadingId === employee.id}
                          >
                            <Save className="w-4 h-4" />
                            저장
                          </Button>
                          <Button
                            className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1"
                            onClick={cancelEdit}
                            disabled={loadingId === employee.id}
                          >
                            <X className="w-4 h-4" />
                            취소
                          </Button>
                        </div>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                              disabled={loadingId === employee.id}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => startEdit(employee)}>
                              <Edit className="mr-2 h-4 w-4" />
                              수정
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleToggleStatus(employee)}>
                              {employee.is_active ? (
                                <>
                                  <ToggleLeft className="mr-2 h-4 w-4" />
                                  비활성화
                                </>
                              ) : (
                                <>
                                  <ToggleRight className="mr-2 h-4 w-4" />
                                  활성화
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDelete(employee)} className="text-red-600">
                              <Trash2 className="mr-2 h-4 w-4" />
                              삭제
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
          </Table>
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="block md:hidden space-y-3">
        {displayRows.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            등록된 직원이 없습니다.
          </div>
        ) : (
          displayRows.map((employee) => (
            <MobileCard key={employee.id}>
              <MobileCardHeader>
                <div className="flex justify-between items-center">
                  <span>{employee.name}</span>
                  {canManageEmployees && (
                    <span
                      className={`badge-stats ${employee.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}
                    >
                      {employee.is_active ? '활성' : '비활성'}
                    </span>
                  )}
                </div>
              </MobileCardHeader>
              
              <MobileCardItem
                label="사번"
                value={
                  isEditingRow(employee.id) ? (
                    <Input
                      value={draft?.employeeID || ''}
                      onChange={(e) => updateDraft('employeeID', e.target.value)}
                      placeholder="사번"
                      className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                    />
                  ) : (
                    employee.employeeID || employee.employee_number || employee.id.slice(0, 8)
                  )
                }
              />
              <MobileCardItem
                label="이름"
                value={
                  isEditingRow(employee.id) ? (
                    <Input
                      value={draft?.name || ''}
                      onChange={(e) => updateDraft('name', e.target.value)}
                      className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                    />
                  ) : (
                    employee.name
                  )
                }
              />
              <MobileCardItem
                label="직급"
                value={
                  isEditingRow(employee.id) ? (
                    <Input
                      value={draft?.position || ''}
                      onChange={(e) => updateDraft('position', e.target.value)}
                      className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                    />
                  ) : (
                    employee.position || '-'
                  )
                }
              />
              <MobileCardItem
                label="부서"
                value={
                  isEditingRow(employee.id) ? (
                    <Input
                      value={draft?.department || ''}
                      onChange={(e) => updateDraft('department', e.target.value)}
                      className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                    />
                  ) : (
                    employee.department || '-'
                  )
                }
              />
              <MobileCardItem
                label="연락처"
                value={
                  isEditingRow(employee.id) ? (
                    <Input
                      value={draft?.phone || ''}
                      onChange={(e) => updateDraft('phone', e.target.value)}
                      className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                    />
                  ) : (
                    employee.phone || '-'
                  )
                }
              />
              <MobileCardItem
                label="이메일"
                value={
                  isEditingRow(employee.id) ? (
                    <Input
                      value={draft?.email || ''}
                      onChange={(e) => updateDraft('email', e.target.value)}
                      className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                    />
                  ) : (
                    employee.email || '-'
                  )
                }
              />
              {canManageEmployees && (
                <>
                  <MobileCardItem 
                    label="권한" 
                    value={
                      isEditingRow(employee.id) ? (
                        <Select
                          value={draft?.purchase_role || 'none'}
                          onValueChange={(value) => updateDraft('purchase_role', value === 'none' ? '' : value)}
                        >
                          <SelectTrigger className="!h-auto !min-h-[20px] !py-px !px-2 !text-[11px] business-radius-input border border-gray-300 bg-white text-gray-700">
                            <SelectValue placeholder="권한" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">권한 없음</SelectItem>
                            {PURCHASE_ROLES.map((role) => (
                              <SelectItem key={role.value} value={role.value}>
                                {role.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className={`badge-stats ${getRoleBadgeColor(employee.purchase_role)}`}>
                          {getRoleDisplayName(employee.purchase_role)}
                        </span>
                      )
                    } 
                  />
                  <MobileCardItem
                    label="상태"
                    value={
                      isEditingRow(employee.id) ? (
                        <Select value={draft?.is_active || 'true'} onValueChange={(value) => updateDraft('is_active', value as 'true' | 'false')}>
                          <SelectTrigger className="!h-auto !min-h-[20px] !py-px !px-2 !text-[11px] business-radius-input border border-gray-300 bg-white text-gray-700">
                            <SelectValue placeholder="상태" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">활성</SelectItem>
                            <SelectItem value="false">비활성</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        employee.is_active ? '활성' : '비활성'
                      )
                    }
                  />
                  <MobileCardItem
                    label="입사일"
                    value={
                      isEditingRow(employee.id) ? (
                        <Input
                          type="date"
                          value={draft?.join_date || ''}
                          onChange={(e) => updateDraft('join_date', e.target.value)}
                          className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                        />
                      ) : (
                        formatDate(employee.join_date)
                      )
                    }
                  />
                  <MobileCardItem
                    label="생년월일"
                    value={
                      isEditingRow(employee.id) ? (
                        <Input
                          type="date"
                          value={draft?.birthday || ''}
                          onChange={(e) => updateDraft('birthday', e.target.value)}
                          className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                        />
                      ) : (
                        formatDate(employee.birthday)
                      )
                    }
                  />
                  <MobileCardItem
                    label="은행"
                    value={
                      isEditingRow(employee.id) ? (
                        <Input
                          value={draft?.bank || ''}
                          onChange={(e) => updateDraft('bank', e.target.value)}
                          className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                        />
                      ) : (
                        employee.bank || '-'
                      )
                    }
                  />
                  <MobileCardItem
                    label="계좌번호"
                    value={
                      isEditingRow(employee.id) ? (
                        <Input
                          value={draft?.bank_account || ''}
                          onChange={(e) => updateDraft('bank_account', e.target.value)}
                          className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                        />
                      ) : (
                        employee.bank_account || '-'
                      )
                    }
                  />
                  <MobileCardItem
                    label="주소"
                    value={
                      isEditingRow(employee.id) ? (
                        <Input
                          value={draft?.adress || ''}
                          onChange={(e) => updateDraft('adress', e.target.value)}
                          className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                        />
                      ) : (
                        employee.adress || '-'
                      )
                    }
                  />
                  <MobileCardItem 
                    label="연차(생성/사용/남은)" 
                    value={
                      isEditingRow(employee.id) ? (
                        <div className="grid grid-cols-3 gap-1">
                          <Input
                            type="number"
                            value={draft?.annual_leave_granted_current_year || ''}
                            onChange={(e) => updateDraft('annual_leave_granted_current_year', e.target.value)}
                            placeholder="생성"
                            className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                          />
                          <Input
                            type="number"
                            value={draft?.used_annual_leave || ''}
                            onChange={(e) => updateDraft('used_annual_leave', e.target.value)}
                            placeholder="사용"
                            className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                          />
                          <Input
                            type="number"
                            value={draft?.remaining_annual_leave || ''}
                            onChange={(e) => updateDraft('remaining_annual_leave', e.target.value)}
                            placeholder="남은"
                            className="!h-auto !py-px !px-1.5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
                          />
                        </div>
                      ) : (
                        `${employee.annual_leave_granted_current_year || 0}/${employee.used_annual_leave || 0}/${
                          employee.remaining_annual_leave !== undefined ? employee.remaining_annual_leave : '-'
                        }`
                      )
                    }
                  />
                  
                  <MobileCardActions>
                    {isEditingRow(employee.id) ? (
                      <>
                        <Button
                          className="button-base bg-blue-500 hover:bg-blue-600 text-white flex items-center gap-1"
                          onClick={handleSave}
                          disabled={loadingId === employee.id}
                        >
                          <Save className="w-4 h-4" />
                          저장
                        </Button>
                        <Button
                          className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1"
                          onClick={cancelEdit}
                          disabled={loadingId === employee.id}
                        >
                          <X className="w-4 h-4" />
                          취소
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1"
                          onClick={() => startEdit(employee)}
                        >
                          <Edit className="w-4 h-4" />
                          수정
                        </Button>
                        <Button
                          className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1"
                          onClick={() => handleToggleStatus(employee)}
                          disabled={loadingId === employee.id}
                        >
                          {employee.is_active ? <ToggleLeft className="w-4 h-4" /> : <ToggleRight className="w-4 h-4" />}
                          상태
                        </Button>
                        <Button
                          className="button-base border border-red-200 bg-white text-red-600 hover:bg-red-50 flex items-center gap-1"
                          onClick={() => handleDelete(employee)}
                          disabled={loadingId === employee.id}
                        >
                          <Trash2 className="w-4 h-4" />
                          삭제
                        </Button>
                      </>
                    )}
                  </MobileCardActions>
                </>
              )}
            </MobileCard>
          ))
        )}
      </div>
    </>
  )
}