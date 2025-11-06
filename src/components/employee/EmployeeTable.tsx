
import { useState, useEffect } from 'react'
import { Employee, PurchaseRole } from '@/types/purchase'
import { formatDate } from '@/utils/helpers'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  Eye, 
  ToggleLeft, 
  ToggleRight,
  Shield
} from 'lucide-react'
import { employeeService } from '@/services/employeeService'
import { toast } from 'sonner'
import { useTableSort } from '@/hooks/useTableSort'
import { SortableHeader } from '@/components/ui/sortable-header'
import { MobileCard, MobileCardItem, MobileCardHeader, MobileCardActions } from '@/components/ui/mobile-card'

interface EmployeeTableProps {
  employees: Employee[]
  onEdit: (employee: Employee) => void
  onView: (employee: Employee) => void
  onRefresh: () => void
}

export default function EmployeeTable({ employees, onEdit, onView, onRefresh }: EmployeeTableProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const supabase = createClient()
  const { sortedData, sortConfig, handleSort } = useTableSort(employees, 'name', 'asc')

  // 현재 사용자 권한 확인
  useEffect(() => {
    const checkUserRole = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: employee } = await supabase
          .from('employees')
          .select('role, purchase_role')  // role 필드도 가져오기
          .eq('id', user.id)
          .single()
        
        if (employee) {
          setCurrentUserRole(employee.role || '')  // role 필드 사용 (hr, admin)
        }
      }
    }
    checkUserRole()
  }, [])

  // 민감한 정보 볼 수 있는 권한 체크 (hr, admin만) - hanslwebapp과 동일
  const isHRorAdmin = currentUserRole === 'hr' || currentUserRole === 'admin'
  const canViewSensitive = isHRorAdmin
  const canEdit = isHRorAdmin

  const handleToggleStatus = async (employee: Employee) => {
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

  const getRoleDisplayName = (role?: string) => {
    const roleNames: Record<string, string> = {
      'app_admin': '앱 관리자',
      'ceo': 'CEO',
      'final_approver': '최종 승인자',
      'middle_manager': '중간 관리자',
      'lead buyer': '수석 구매자',
      'buyer': '구매자'
    }
    
    return roleNames[role || ''] || '권한 없음'
  }

  const getRoleBadgeColor = (role?: string) => {
    const colorMap: Record<string, string> = {
      'app_admin': 'bg-purple-100 text-purple-800',
      'ceo': 'bg-red-100 text-red-800',
      'final_approver': 'bg-hansl-100 text-hansl-800',
      'middle_manager': 'bg-green-100 text-green-800',
      'lead buyer': 'bg-yellow-100 text-yellow-800',
      'buyer': 'bg-gray-100 text-gray-800'
    }
    
    return colorMap[role || ''] || 'bg-gray-100 text-gray-600'
  }

  // formatDate는 utils/helpers.ts에서 import

  return (
    <>
      {/* Desktop Table View */}
      <div className="hidden lg:block border rounded-lg overflow-hidden">
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
            {/* 연차 정보는 모든 사용자에게 표시 */}
            <TableHead className="w-11 min-w-[40px] text-center">생성</TableHead>
            <TableHead className="w-11 min-w-[40px] text-center">사용</TableHead>
            <TableHead className="w-11 min-w-[40px] text-center">남은</TableHead>
            {/* lg 이상에서만 표시되는 칼럼들 */}
            <TableHead className="hidden lg:table-cell w-18 min-w-[60px]">
              <SortableHeader
                sortKey="join_date"
                currentSortKey={sortConfig.key as string | null}
                sortDirection={sortConfig.direction}
                onSort={() => handleSort('join_date' as keyof Employee)}
              >
                입사일
              </SortableHeader>
            </TableHead>
            <TableHead className="hidden lg:table-cell w-20 min-w-[70px]">
              <SortableHeader
                sortKey="birthday"
                currentSortKey={sortConfig.key as string | null}
                sortDirection={sortConfig.direction}
                onSort={() => handleSort('birthday' as keyof Employee)}
              >
                생년월일
              </SortableHeader>
            </TableHead>
            {/* HR/Admin만 볼 수 있는 민감한 정보 */}
            {isHRorAdmin && (
              <>
                <TableHead className="hidden xl:table-cell w-14 min-w-[45px]">은행</TableHead>
                <TableHead className="hidden xl:table-cell w-24 min-w-[80px]">계좌번호</TableHead>
                <TableHead className="hidden 2xl:table-cell min-w-[120px]">주소</TableHead>
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
              </>
            )}
                <TableHead className="w-16 min-w-[50px]">작업</TableHead>
              </TableRow>
            </TableHeader>
        <TableBody>
          {employees.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canViewSensitive ? 14 : 7} className="text-center py-8 text-gray-500">
                등록된 직원이 없습니다.
              </TableCell>
            </TableRow>
          ) : (
            sortedData.map((employee) => (
              <TableRow key={employee.id}>
                <TableCell className="text-[11px] px-2 py-1.5">
                  {employee.employeeID || employee.employee_number || employee.id.slice(0, 8)}
                </TableCell>
                <TableCell className="text-[11px] px-2 py-1.5">
                  {employee.name}
                </TableCell>
                <TableCell className="text-[11px] px-2 py-1.5">{employee.position || '-'}</TableCell>
                <TableCell className="text-[11px] px-2 py-1.5">{employee.department || '-'}</TableCell>
                <TableCell className="text-[11px] px-2 py-1.5">{employee.phone || '-'}</TableCell>
                <TableCell className="text-[11px] px-2 py-1.5">{employee.email || '-'}</TableCell>
                {/* 연차 정보는 모든 사용자에게 표시 */}
                <TableCell className="text-center text-[11px] px-1 py-1.5">
                  {employee.annual_leave_granted_current_year || 0}
                </TableCell>
                <TableCell className="text-center text-[11px] px-1 py-1.5">
                  {employee.used_annual_leave || 0}
                </TableCell>
                <TableCell className="text-center text-[11px] px-1 py-1.5">
                  {employee.remaining_annual_leave !== undefined 
                    ? employee.remaining_annual_leave
                    : '-'}
                </TableCell>
                {/* lg 이상에서만 표시되는 칼럼들 */}
                <TableCell className="hidden lg:table-cell text-[11px] px-2 py-1.5">
                  {formatDate(employee.join_date)}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-[11px] px-2 py-1.5">
                  {formatDate(employee.birthday)}
                </TableCell>
                {/* HR/Admin만 볼 수 있는 민감한 정보 */}
                {isHRorAdmin && (
                  <>
                    <TableCell className="hidden xl:table-cell text-[11px] px-2 py-1.5">{employee.bank || '-'}</TableCell>
                    <TableCell className="hidden xl:table-cell text-[11px] px-2 py-1.5">{employee.bank_account || '-'}</TableCell>
                    <TableCell className="hidden 2xl:table-cell text-[11px] px-2 py-1.5">{employee.adress || '-'}</TableCell>
                    <TableCell className="px-2 py-1.5">
                      <Badge
                        className={`text-[10px] px-1.5 py-0.5 ${getRoleBadgeColor(employee.purchase_role)}`}
                      >
                        {getRoleDisplayName(employee.purchase_role)}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-2 py-1.5">
                      <Badge
                        variant={employee.is_active ? 'default' : 'secondary'}
                        className={`text-[10px] px-1.5 py-0.5 ${employee.is_active ? 'bg-green-100 text-green-800' : ''}`}
                      >
                        {employee.is_active ? '활성' : '비활성'}
                      </Badge>
                    </TableCell>
                  </>
                )}
                <TableCell className="px-1 py-1.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        disabled={loadingId === employee.id}
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onView(employee)}>
                        <Eye className="mr-2 h-4 w-4" />
                        상세 보기
                      </DropdownMenuItem>
                      {canEdit && (
                        <>
                          <DropdownMenuItem onClick={() => onEdit(employee)}>
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
                          <DropdownMenuItem 
                            onClick={() => handleDelete(employee)}
                            className="text-red-600"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            삭제
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
          </Table>
        </div>
      </div>

      {/* Tablet View */}
      <div className="hidden md:block lg:hidden">
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full min-w-[700px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 header-title text-gray-900 w-16">사번</th>
                <th className="text-left p-3 header-title text-gray-900 w-20">이름</th>
                <th className="text-left p-3 header-title text-gray-900 w-20">직급</th>
                <th className="text-left p-3 header-title text-gray-900 w-24">부서</th>
                <th className="text-left p-3 header-title text-gray-900">연락처</th>
                <th className="text-left p-3 header-title text-gray-900">이메일</th>
                {isHRorAdmin && (
                  <>
                    <th className="text-left p-3 header-title text-gray-900 w-24">권한</th>
                    <th className="text-center p-3 header-title text-gray-900 w-16">상태</th>
                  </>
                )}
                <th className="text-center p-3 header-title text-gray-900 w-16">작업</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedData.length === 0 ? (
                <tr>
                  <td colSpan={isHRorAdmin ? 9 : 7} className="text-center py-8 text-gray-500">
                    등록된 직원이 없습니다.
                  </td>
                </tr>
              ) : (
                sortedData.map((employee) => (
                  <tr key={employee.id} className="hover:bg-gray-50">
                    <td className="p-3 modal-subtitle">
                      {employee.employeeID || employee.employee_number || employee.id.slice(0, 8)}
                    </td>
                    <td className="p-3 modal-value">{employee.name}</td>
                    <td className="p-3 modal-subtitle">{employee.position || '-'}</td>
                    <td className="p-3 modal-subtitle">{employee.department || '-'}</td>
                    <td className="p-3 modal-subtitle">{employee.phone || '-'}</td>
                    <td className="p-3 modal-subtitle">{employee.email || '-'}</td>
                    {isHRorAdmin && (
                      <>
                        <td className="p-3">
                          <Badge className={`text-xs ${getRoleBadgeColor(employee.purchase_role)}`}>
                            {getRoleDisplayName(employee.purchase_role)}
                          </Badge>
                        </td>
                        <td className="p-3 text-center">
                          <Badge
                            variant={employee.is_active ? 'default' : 'secondary'}
                            className={`text-xs ${employee.is_active ? 'bg-green-100 text-green-800' : ''}`}
                          >
                            {employee.is_active ? '활성' : '비활성'}
                          </Badge>
                        </td>
                      </>
                    )}
                    <td className="p-3 text-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onView(employee)}>
                            <Eye className="mr-2 h-4 w-4" />
                            상세 보기
                          </DropdownMenuItem>
                          {canEdit && (
                            <>
                              <DropdownMenuItem onClick={() => onEdit(employee)}>
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
                              <DropdownMenuItem 
                                onClick={() => handleDelete(employee)}
                                className="text-red-600"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                삭제
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="block md:hidden space-y-3">
        {sortedData.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            등록된 직원이 없습니다.
          </div>
        ) : (
          sortedData.map((employee) => (
            <MobileCard key={employee.id}>
              <MobileCardHeader>
                <div className="flex justify-between items-center">
                  <span>{employee.name}</span>
                  <Badge
                    variant={employee.is_active ? 'default' : 'secondary'}
                    className={employee.is_active ? 'bg-green-100 text-green-800' : ''}
                  >
                    {employee.is_active ? '활성' : '비활성'}
                  </Badge>
                </div>
              </MobileCardHeader>
              
              <MobileCardItem label="사번" value={employee.employeeID || employee.employee_number || employee.id.slice(0, 8)} />
              <MobileCardItem label="직급" value={employee.position || '-'} />
              <MobileCardItem label="부서" value={employee.department || '-'} />
              <MobileCardItem label="연락처" value={employee.phone || '-'} />
              <MobileCardItem label="이메일" value={employee.email || '-'} />
              
              {canViewSensitive && (
                <>
                  <MobileCardItem 
                    label="권한" 
                    value={
                      <Badge className={getRoleBadgeColor(employee.purchase_role)}>
                        {getRoleDisplayName(employee.purchase_role)}
                      </Badge>
                    } 
                  />
                  <MobileCardItem label="주소" value={employee.adress || '-'} />
                  <MobileCardItem label="은행" value={employee.bank || '-'} />
                  <MobileCardItem label="계좌번호" value={employee.bank_account || '-'} />
                  <MobileCardItem 
                    label="연차" 
                    value={employee.remaining_annual_leave !== undefined ? `${employee.remaining_annual_leave}일` : '-'} 
                  />
                </>
              )}
              
              <MobileCardActions>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onView(employee)}
                >
                  <Eye className="w-4 h-4" />
                </Button>
                {canEdit && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onEdit(employee)}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleToggleStatus(employee)}
                      disabled={loadingId === employee.id}
                    >
                      {employee.is_active ? (
                        <ToggleLeft className="w-4 h-4" />
                      ) : (
                        <ToggleRight className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600"
                      onClick={() => handleDelete(employee)}
                      disabled={loadingId === employee.id}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </>
                )}
              </MobileCardActions>
            </MobileCard>
          ))
        )}
      </div>
    </>
  )
}