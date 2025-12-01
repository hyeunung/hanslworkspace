
import { useState, useEffect } from 'react'
import { Vendor, VendorFormData } from '@/types/purchase'
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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useForm } from 'react-hook-form'
import { vendorService } from '@/services/vendorService'
import { toast } from 'sonner'

interface VendorModalProps {
  isOpen: boolean
  onClose: () => void
  vendor?: Vendor | null
  onSave: () => void
  mode: 'create' | 'edit' | 'view'
}

export default function VendorModal({ isOpen, onClose, vendor, onSave, mode }: VendorModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<VendorFormData>({
    defaultValues: {
      vendor_name: '',
      vendor_phone: '',
      vendor_fax: '',
      vendor_payment_schedule: '',
      vendor_address: '',
      note: ''
    }
  })

  useEffect(() => {
    if (vendor && isOpen) {
      form.reset({
        vendor_name: vendor.vendor_name || '',
        vendor_phone: vendor.vendor_phone || '',
        vendor_fax: vendor.vendor_fax || '',
        vendor_payment_schedule: vendor.vendor_payment_schedule || '',
        vendor_address: vendor.vendor_address || '',
        note: vendor.note || ''
      })
    } else if (!vendor && isOpen) {
      form.reset({
        vendor_name: '',
        vendor_phone: '',
        vendor_fax: '',
        vendor_payment_schedule: '',
        vendor_address: '',
        note: ''
      })
    }
  }, [vendor, isOpen, form])

  const onSubmit = async (data: VendorFormData) => {
    setIsSubmitting(true)
    
    try {
      let result
      
      if (mode === 'create') {
        result = await vendorService.createVendor(data)
      } else if (mode === 'edit' && vendor) {
        result = await vendorService.updateVendor(vendor.id, data)
      }

      if (result?.success) {
        toast.success(mode === 'create' ? '업체가 등록되었습니다.' : '업체 정보가 수정되었습니다.')
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
      case 'create': return '업체 등록'
      case 'edit': return '업체 수정'
      case 'view': return '업체 상세'
      default: return '업체'
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
                name="vendor_name"
                rules={{
                  required: '업체명을 입력해주세요.'
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>업체명 *</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="업체명을 입력하세요"
                        disabled={isReadOnly}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="vendor_phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>전화번호</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="02-1234-5678"
                        disabled={isReadOnly}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="vendor_fax"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>팩스번호</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="02-1234-5679"
                        disabled={isReadOnly}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="vendor_payment_schedule"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>결제조건</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="월말결제, 현금결제 등"
                        disabled={isReadOnly}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="vendor_address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>주소</FormLabel>
                  <FormControl>
                    <Textarea 
                      {...field} 
                      placeholder="주소를 입력하세요"
                      className="min-h-[80px]"
                      disabled={isReadOnly}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>비고</FormLabel>
                  <FormControl>
                    <Textarea 
                      {...field} 
                      placeholder="메모 사항을 입력하세요"
                      className="min-h-[60px]"
                      disabled={isReadOnly}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {mode === 'view' && vendor && (
              <div className="pt-4 border-t">
                <div className="grid grid-cols-2 gap-4 modal-subtitle">
                  <div>
                    <span className="text-gray-500">상태:</span>
                    <span className={`ml-2 px-2 py-1 business-radius-badge badge-text bg-green-100 text-green-800`}>
                      활성
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">등록일:</span>
                    <span className="ml-2">
                      {vendor.created_at ? new Date(vendor.created_at).toLocaleDateString('ko-KR') : '-'}
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