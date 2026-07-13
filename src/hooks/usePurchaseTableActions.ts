import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { generatePurchaseOrderExcelJS, PurchaseOrderData } from '@/utils/exceljs/generatePurchaseOrderExcel'
import { removePurchaseFromMemory, updatePurchaseInMemory } from '@/stores/purchaseMemoryStore'
import { parseRoles } from '@/utils/roleHelper'
import { logger } from '@/lib/logger'
import { Purchase, PurchaseRequestItem } from '@/types/purchase'

// 발주/구매 테이블 행 액션 훅 — 엑셀 발주서 다운로드 / UTK 확인 토글 / 소프트 삭제.
// FastPurchaseTable에 있던 검증된 핸들러들을 이관 (동작 동일), 테이블 컴포넌트를 표현에 집중시키기 위한 분리.

interface UsePurchaseTableActionsArgs {
  currentUserRoles: string[]
  onRefresh?: (forceRefresh?: boolean, options?: { silent?: boolean }) => void | Promise<void>
}

export function usePurchaseTableActions({ currentUserRoles, onRefresh }: UsePurchaseTableActionsArgs) {
  const supabase = createClient()
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<number | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [purchaseToDelete, setPurchaseToDelete] = useState<Purchase | null>(null)

  const handleRowClick = useCallback((purchase: Purchase) => {
    setSelectedPurchaseId(purchase.id)
    setIsModalOpen(true)
  }, [])

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false)
    setSelectedPurchaseId(null)
  }, [])

  // 1차/최종 승인 — 상세 모달 handleApprove와 동일 규칙 (인풋 모드 승인상태 배지 클릭 진입점)
  const handleApprove = useCallback(async (purchase: Purchase, type: 'middle' | 'final') => {
    if (!purchase?.id) return
    const approvalType = type === 'middle' ? '1차 승인' : '최종 승인'
    if (!window.confirm(`발주번호: ${purchase.purchase_order_number}\n\n${approvalType}을 진행하시겠습니까?`)) return

    try {
      const updateData = type === 'middle'
        ? { middle_manager_status: 'approved' }
        : { final_manager_status: 'approved' }
      const { error } = await supabase
        .from('purchase_requests')
        .update(updateData)
        .eq('id', purchase.id)
      if (error) throw error

      // 메모리 캐시 즉시 반영 (리스트/배지 실시간 갱신)
      updatePurchaseInMemory(purchase.id, (prev) => ({ ...prev, ...updateData } as Purchase))
      toast.success(`${type === 'middle' ? '중간' : '최종'} 승인이 완료되었습니다.`)

      const refreshResult = onRefresh?.(true, { silent: true })
      if (refreshResult instanceof Promise) await refreshResult
    } catch (err) {
      logger.error('승인 처리 실패', { err, purchaseId: purchase.id, type })
      toast.error('승인 처리 중 오류가 발생했습니다.')
    }
  }, [supabase, onRefresh])

  // UTK 확인 토글 (전체항목 탭)
  const handleToggleUtkCheck = useCallback(async (purchase: Purchase) => {
    if (!purchase?.id) return
    const newStatus = !(purchase.is_utk_checked || false)
    const confirmMessage = newStatus
      ? `발주번호: ${purchase.purchase_order_number}\n\nUTK 확인 처리하시겠습니까?`
      : `발주번호: ${purchase.purchase_order_number}\n\nUTK 확인을 취소하시겠습니까?`
    if (!window.confirm(confirmMessage)) return

    try {
      const { error } = await supabase
        .from('purchase_requests')
        .update({ is_utk_checked: newStatus })
        .eq('id', purchase.id)
      if (error) {
        logger.error('UTK 확인 DB 업데이트 실패', { error, purchaseId: purchase.id })
        toast.error('UTK 확인 처리 중 오류가 발생했습니다.')
        return
      }
      // 메모리 캐시 업데이트 (리스트 즉시 반영)
      updatePurchaseInMemory(purchase.id, (prev) => ({ ...prev, is_utk_checked: newStatus }))
      toast.success(newStatus ? 'UTK 확인이 완료되었습니다.' : 'UTK 확인이 취소되었습니다.')
      const refreshResult = onRefresh?.(true, { silent: true })
      if (refreshResult instanceof Promise) await refreshResult
    } catch (err) {
      logger.error('UTK 확인 처리 중 오류', err)
      toast.error('UTK 확인 처리 중 오류가 발생했습니다.')
    }
  }, [supabase, onRefresh])

  // 엑셀 발주서 다운로드 — DB에서 전체 품목/업체 정보를 조회해 ExcelJS로 생성
  const handleExcelDownload = useCallback(async (purchase: Purchase) => {
    try {
      const { data: purchaseRequest, error: requestError } = await supabase
        .from('purchase_requests')
        .select('*')
        .eq('purchase_order_number', purchase.purchase_order_number)
        .single()
      if (requestError || !purchaseRequest) {
        toast.error('해당 발주요청번호의 데이터를 찾을 수 없습니다.')
        return
      }

      const { data: orderItems, error: itemsError } = await supabase
        .from('purchase_request_items')
        .select('*')
        .eq('purchase_order_number', purchase.purchase_order_number)
        .order('line_number')
      if (itemsError || !orderItems || orderItems.length === 0) {
        toast.error('해당 발주요청번호의 품목 데이터를 찾을 수 없습니다.')
        return
      }

      const vendorInfo = {
        vendor_name: purchase.vendor_name,
        vendor_phone: '',
        vendor_fax: '',
        vendor_contact_name: '',
        vendor_payment_schedule: '',
      }
      try {
        const vendorId = purchaseRequest.vendor_id || purchase.vendor_id
        const contactId = purchaseRequest.contact_id || purchase.contact_id
        if (vendorId) {
          const { data: vendorData } = await supabase
            .from('vendors')
            .select('vendor_phone, vendor_fax, vendor_payment_schedule')
            .eq('id', vendorId)
            .single()
          if (vendorData) {
            vendorInfo.vendor_phone = vendorData.vendor_phone || ''
            vendorInfo.vendor_fax = vendorData.vendor_fax || ''
            vendorInfo.vendor_payment_schedule = vendorData.vendor_payment_schedule || ''
          }
        }
        if (contactId) {
          const { data: contactData } = await supabase
            .from('vendor_contacts')
            .select('contact_name, contact_phone, contact_email')
            .eq('id', contactId)
            .single()
          if (contactData) {
            vendorInfo.vendor_contact_name = contactData.contact_name || ''
          }
        }
      } catch {
        // 업체 정보 조회 실패는 무시
      }

      const excelData: PurchaseOrderData = {
        purchase_order_number: purchaseRequest.purchase_order_number || '',
        request_date: purchaseRequest.request_date,
        delivery_request_date: purchaseRequest.delivery_request_date,
        requester_name: purchaseRequest.requester_name,
        vendor_name: vendorInfo.vendor_name || '',
        vendor_contact_name: vendorInfo.vendor_contact_name,
        vendor_phone: vendorInfo.vendor_phone,
        vendor_fax: vendorInfo.vendor_fax,
        project_vendor: purchaseRequest.project_vendor,
        sales_order_number: purchaseRequest.sales_order_number,
        project_item: purchaseRequest.project_item,
        vendor_payment_schedule: vendorInfo.vendor_payment_schedule,
        items: orderItems.map((item: PurchaseRequestItem) => ({
          line_number: item.line_number,
          item_name: item.item_name,
          specification: item.specification,
          quantity: item.quantity,
          unit_price_value: item.unit_price_value,
          amount_value: item.amount_value,
          remark: item.remark,
          currency: purchaseRequest.currency || 'KRW',
        })),
      }

      const blob = await generatePurchaseOrderExcelJS(excelData)
      const downloadFilename = `발주서_${excelData.vendor_name}_${excelData.purchase_order_number}.xlsx`
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = downloadFilename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
      logger.info('발주서 엑셀 파일 다운로드 완료', {
        source: 'frontend',
        category: 'purchase',
        action: 'export_excel',
        target_table: 'purchase_requests',
        target_id: purchase.id?.toString(),
        purchase_order_number: purchase.purchase_order_number,
        file_name: downloadFilename,
      })
      toast.success('엑셀 파일이 다운로드되었습니다.')

      // 다운로드 완료 플래그(is_po_download) 업데이트 — lead buyer만 해당
      try {
        if (currentUserRoles.includes('lead buyer')) {
          const { error: downloadFlagErr } = await supabase
            .from('purchase_requests')
            .update({ is_po_download: true })
            .eq('purchase_order_number', purchase.purchase_order_number)
          if (!downloadFlagErr) onRefresh?.()
        }
      } catch {
        // 플래그 업데이트 실패는 무시
      }
    } catch {
      toast.error('엑셀 다운로드에 실패했습니다.')
    }
  }, [supabase, currentUserRoles, onRefresh])

  // 상세 모달의 삭제 버튼 → 확인 다이얼로그 열기
  const requestDelete = useCallback((purchase: Purchase) => {
    setPurchaseToDelete(purchase)
    setDeleteConfirmOpen(true)
  }, [])

  // 발주요청 보관(soft delete) — RPC가 deleted_at 마킹 + cascade 트리거 처리 (RLS 우회)
  const handleConfirmDelete = useCallback(async () => {
    if (!purchaseToDelete) {
      toast.error('삭제할 발주요청을 찾을 수 없습니다.')
      return
    }
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        toast.error('로그인이 필요합니다.')
        return
      }
      const { data: employee, error: empError } = await supabase
        .from('employees')
        .select('name, email, roles')
        .eq('email', user.email)
        .single()
      if (empError || !employee) {
        toast.error('사용자 권한을 확인할 수 없습니다.')
        return
      }

      const roles = parseRoles(employee.roles)
      const canEdit = roles.includes('final_approver') || roles.includes('superadmin') || roles.includes('ceo')
      const isApproved = purchaseToDelete.final_manager_status === 'approved'
      const isRequester = purchaseToDelete.requester_name === employee.name
      const canDeleteThis = isApproved ? canEdit : (canEdit || isRequester)
      if (!canDeleteThis) {
        toast.error('삭제 권한이 없습니다.')
        return
      }

      const purchaseIdForDelete = typeof purchaseToDelete.id === 'string'
        ? parseInt(purchaseToDelete.id, 10)
        : purchaseToDelete.id
      if (isNaN(purchaseIdForDelete)) {
        throw new Error('발주요청 ID가 유효하지 않습니다.')
      }

      const { error: requestError } = await supabase
        .rpc('soft_delete_purchase_order', { p_id: purchaseIdForDelete })
      if (requestError) {
        logger.error('[usePurchaseTableActions] 발주요청 삭제 중 오류', requestError, {
          code: requestError.code, message: requestError.message, purchaseId: purchaseIdForDelete,
        })
        if (requestError.code === '409' || requestError.code === '23503' ||
            requestError.message?.includes('409') || requestError.message?.includes('foreign key')) {
          const errorMsg = requestError.details || requestError.message || '다른 데이터에서 참조하고 있습니다.'
          toast.error(`삭제할 수 없습니다: ${errorMsg} 관리자에게 문의하세요.`)
        } else {
          throw requestError
        }
        return
      }

      // 메모리 캐시에서 즉시 삭제 (UI 즉시 반영)
      const memoryUpdated = removePurchaseFromMemory(purchaseIdForDelete)
      if (!memoryUpdated) {
        logger.warn('[usePurchaseTableActions] 메모리 캐시에서 발주서 삭제 실패', { purchaseId: purchaseIdForDelete })
      }

      toast.success('발주요청 내역이 삭제되었습니다.')
      setIsModalOpen(false)
      setSelectedPurchaseId(null)
      setDeleteConfirmOpen(false)
      setPurchaseToDelete(null)
      if (onRefresh) {
        try {
          await onRefresh(true, { silent: false })
        } catch (refreshError) {
          logger.error('[usePurchaseTableActions] 데이터 새로고침 실패', refreshError)
        }
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error))
      logger.error('[usePurchaseTableActions] 발주요청 삭제 중 예외', errorObj, {
        purchaseId: purchaseToDelete?.id,
        purchaseOrderNumber: purchaseToDelete?.purchase_order_number,
      })
      toast.error(`삭제 중 오류가 발생했습니다: ${errorObj.message || '알 수 없는 오류'}`)
    } finally {
      setDeleteConfirmOpen(false)
      setPurchaseToDelete(null)
    }
  }, [supabase, purchaseToDelete, onRefresh])

  return {
    selectedPurchaseId,
    isModalOpen,
    handleRowClick,
    handleCloseModal,
    handleToggleUtkCheck,
    handleApprove,
    handleExcelDownload,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    purchaseToDelete,
    setPurchaseToDelete,
    requestDelete,
    handleConfirmDelete,
  }
}
