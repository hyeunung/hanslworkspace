
import { useState, useEffect } from 'react'
import { Employee, EmployeeFormData, PurchaseRole } from '@/types/purchase'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useForm } from 'react-hook-form'
import { employeeService } from '@/services/employeeService'
import { toast } from 'sonner'

interface EmployeeModalProps {
  isOpen: boolean
  onClose: () => void
  employee?: Employee | null
  onSave: () => void
  mode: 'create' | 'edit' | 'view'
}

const PURCHASE_ROLES: { value: PurchaseRole; label: string }[] = [
  { value: 'app_admin', label: '앱 관리자' },
  { value: 'ceo', label: 'CEO' },
  { value: 'final_approver', label: '최종 승인자' },
  { value: 'middle_manager', label: '중간 관리자' },
  { value: 'lead buyer', label: '수석 구매자' },
  { value: 'buyer', label: '구매자' },
]

export default function EmployeeModal({ isOpen, onClose, employee, onSave, mode }: EmployeeModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [departments, setDepartments] = useState<string[]>([])
  const [positions, setPositions] = useState<string[]>([])

  const form = useForm<EmployeeFormData>({
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      position: '',
      department: '',
      purchase_role: [],
      slack_id: '',
    }
  })

  useEffect(() => {
    // 부서와 직급 목록 로드
    const loadOptions = async () => {
      const [deptResult, posResult] = await Promise.all([
        employeeService.getDepartments(),
        employeeService.getPositions()
      ])
      
      if (deptResult.success) {
        setDepartments(deptResult.data || [])
      }
      
      if (posResult.success) {
        setPositions(posResult.data || [])
      }
    }
    
    loadOptions()
  }, [])

  useEffect(() => {
    if (employee && isOpen) {
      form.reset({
        name: employee.name || '',
        email: employee.email || '',
        phone: employee.phone || '',
        position: employee.position || '',
        department: employee.department || '',
        purchase_role: employee.purchase_role ? employee.purchase_role.split(',') : [],
        slack_id: employee.slack_id || '',
      })
    } else if (!employee && isOpen) {
      form.reset({
        name: '',
        email: '',
        phone: '',
        position: '',
        department: '',
        purchase_role: [],
        slack_id: '',
      })
    }
  }, [employee, isOpen, form])

  const onSubmit = async (data: EmployeeFormData) => {
    setIsSubmitting(true)
    
    try {
      let result
      
      if (mode === 'create') {
        result = await employeeService.createEmployee(data)
      } else if (mode === 'edit' && employee) {
        result = await employeeService.updateEmployee(employee.id, data)
      }

      if (result?.success) {
        toast.success(mode === 'create' ? '직원이 등록되었습니다.' : '직원 정보가 수정되었습니다.')
        onSave()
        onClose()
      } else {
        toast.error(result?.error || '처리 중 오류가 발생했습니다.')
      }
    } catch (error) {
      toast.error('처리 중 오류가 발생했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const getTitle = () => {
    switch (mode) {
      case 'create': return '직원 등록'
      case 'edit': return '직원 수정'
      case 'view': return '직원 상세'
      default: return '직원'
    }
  }

  const isReadOnly = mode === 'view'

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                rules={{
                  required: '이름을 입력해주세요.'
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>이름 *</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="이름을 입력하세요"
                        disabled={isReadOnly}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                rules={{
                  pattern: {
                    value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                    message: "올바른 이메일 형식을 입력해주세요."
                  }
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>이메일</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        type="email"
                        placeholder="user@example.com"
                        disabled={isReadOnly}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>전화번호</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="010-0000-0000"
                        disabled={isReadOnly}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="slack_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Slack ID</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="U01234567890"
                        disabled={isReadOnly}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>부서</FormLabel>
                    <FormControl>
                      {isReadOnly ? (
                        <Input {...field} disabled />
                      ) : (
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <SelectTrigger>
                            <SelectValue placeholder="부서를 선택하세요" />
                          </SelectTrigger>
                          <SelectContent>
                            {departments.map((dept) => (
                              <SelectItem key={dept} value={dept}>
                                {dept}
                              </SelectItem>
                            ))}
                            <SelectItem value="custom">직접 입력</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="position"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>직급</FormLabel>
                    <FormControl>
                      {isReadOnly ? (
                        <Input {...field} disabled />
                      ) : (
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <SelectTrigger>
                            <SelectValue placeholder="직급을 선택하세요" />
                          </SelectTrigger>
                          <SelectContent>
                            {positions.map((pos) => (
                              <SelectItem key={pos} value={pos}>
                                {pos}
                              </SelectItem>
                            ))}
                            <SelectItem value="custom">직접 입력</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="purchase_role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>권한</FormLabel>
                    <FormControl>
                      <Select 
                        onValueChange={(value) => field.onChange(value === 'none' ? [] : [value])} 
                        defaultValue={field.value?.[0] || 'none'}
                        disabled={isReadOnly}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="권한을 선택하세요" />
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
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {mode === 'view' && employee && (
              <div className="pt-4 border-t">
                <div className="grid grid-cols-2 gap-4 modal-subtitle">
                  <div>
                    <span className="text-gray-500">상태:</span>
                    <span className={`ml-2 px-2 py-1 rounded badge-text ${
                      employee.is_active 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {employee.is_active ? '활성' : '비활성'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">등록일:</span>
                    <span className="ml-2">
                      {employee.created_at ? new Date(employee.created_at).toLocaleDateString('ko-KR') : '-'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {mode === 'view' ? '닫기' : '취소'}
              </Button>
              {!isReadOnly && (
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting 
                    ? (mode === 'create' ? '등록 중...' : '수정 중...')
                    : (mode === 'create' ? '등록' : '수정')
                  }
                </Button>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}