import { useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { markItemAsReceived, markItemAsReceiptCanceled, markItemAsStatementReceived, markItemAsStatementCanceled } from '@/stores/purchaseMemoryStore'
import { dateToISOString } from '@/utils/helpers'
import type { ReceiptHistoryItem } from '@/types/purchase'

export interface ConfirmDateActionConfig {
  field: 'statement_received' | 'actual_received'
  confirmMessage: {
    confirm: string
    cancel: string
  }
  successMessage: {
    confirm: string
    cancel: string
  }
  completedText: string
  waitingText: string
}

export interface UseConfirmDateActionProps {
  config: ConfirmDateActionConfig
  currentUserName: string | null
  canPerformAction: boolean
  purchaseId?: number | string  // 메모리 캐시 업데이트를 위한 purchase ID
  onUpdate?: () => void
  onBeforeUpdate?: () => void  // 🚀 업데이트 시작 전 호출 (Realtime 이벤트 무시 플래그 설정용)
  onOptimisticUpdate?: (params: {
    itemId: number
    selectedDate?: Date
    action: 'confirm' | 'cancel'
    receivedQuantity?: number
    itemInfo?: {
      item_name?: string
      specification?: string
      quantity?: number
      unit_price_value?: number
      amount_value?: number
      remark?: string
      received_quantity?: number
    }
  }) => void
}

export function useConfirmDateAction({
  config,
  currentUserName,
  canPerformAction,
  purchaseId,
  onUpdate,
  onBeforeUpdate,
  onOptimisticUpdate
}: UseConfirmDateActionProps) {
  const supabase = createClient()

  const handleConfirm = useCallback(async (
    itemId: number | string,
    selectedDate: Date,
    itemInfo?: {
      item_name?: string
      specification?: string
      quantity?: number
      unit_price_value?: number
      amount_value?: number
      remark?: string
      received_quantity?: number
    },
    receivedQuantity?: number
  ) => {
    
    if (!canPerformAction) {
      logger.warn(`❌ 권한 없음`, { canPerformAction, currentUserName })
      toast.error(`${config.field === 'statement_received' ? '거래명세서' : '입고'} 확인 권한이 없습니다.`)
      return
    }

    const itemIdStr = String(itemId)
    const numericId = typeof itemId === 'number' ? itemId : Number(itemId)

    if (Number.isNaN(numericId)) {
      logger.error('❌ 잘못된 ID', { itemId, numericId })
      toast.error('유효하지 않은 항목 ID 입니다.')
      return
    }

    // 확인 다이얼로그 표시
    if (itemInfo) {
      const confirmMessage = `품목명: ${itemInfo.item_name || '-'}
규격: ${itemInfo.specification || '-'}
수량: ${itemInfo.quantity?.toLocaleString() || 0}
단가: ₩${itemInfo.unit_price_value?.toLocaleString() || 0}
합계: ₩${itemInfo.amount_value?.toLocaleString() || 0}
비고: ${itemInfo.remark || '-'}

${config.confirmMessage.confirm}`
      
      if (!window.confirm(confirmMessage)) {
        return
      }
    }

    // 🚀 업데이트 시작 전 콜백 호출 (Realtime 이벤트 무시 플래그 설정)
    onBeforeUpdate?.()

    try {
      let updateData: Record<string, string | boolean | number | null | ReceiptHistoryItem[]> = {}

      if (config.field === 'statement_received') {
        updateData = {
          is_statement_received: true,
          statement_received_date: dateToISOString(selectedDate),
          statement_received_by_name: currentUserName,
          accounting_received_date: dateToISOString(selectedDate)
        }
      } else if (config.field === 'actual_received') {
        // 분할 입고 처리: receipt_history에 이력 추가
        const requestedQuantity = itemInfo?.quantity || 0
        const currentReceivedQuantity = itemInfo?.received_quantity || 0
        const newReceivedQuantity = receivedQuantity !== undefined ? receivedQuantity : requestedQuantity
        const totalReceivedQuantity = currentReceivedQuantity + newReceivedQuantity

        // 기존 이력 가져오기 위해 먼저 조회
        const { data: existingItem } = await supabase
          .from('purchase_request_items')
          .select('receipt_history')
          .eq('id', numericId)
          .single()

        const existingHistory = (existingItem?.receipt_history as ReceiptHistoryItem[] | null) || []
        const nextSeq = existingHistory.length + 1

        // 새 입고 이력 항목
        const newHistoryItem = {
          seq: nextSeq,
          qty: newReceivedQuantity,
          date: dateToISOString(selectedDate),
          by: currentUserName || '알수없음'
        }

        const updatedHistory = [...existingHistory, newHistoryItem]

        // 입고 완료 여부 판단: 누적 입고량 >= 요청 수량
        const isFullyReceived = totalReceivedQuantity >= requestedQuantity

        updateData = {
          actual_received_date: dateToISOString(selectedDate),
          is_received: isFullyReceived,
          received_quantity: totalReceivedQuantity,
          delivery_status: totalReceivedQuantity === 0 ? 'pending' : (isFullyReceived ? 'received' : 'partial'),
          receipt_history: updatedHistory
        }

        logger.debug('📦 분할 입고 처리:', {
          requestedQuantity,
          currentReceivedQuantity,
          newReceivedQuantity,
          totalReceivedQuantity,
          isFullyReceived,
          historyCount: updatedHistory.length
        })
      }

      logger.debug('📝 업데이트할 데이터:', updateData)

      const { data, error } = await supabase
        .from('purchase_request_items')
        .update(updateData)
        .eq('id', numericId)
        .select()

      logger.debug('📝 DB 업데이트 결과:', { data, error })

      if (error) {
        logger.error('❌ DB 업데이트 실패', error)
        throw error
      }

      logger.info('✅ DB 업데이트 성공', data)

      // 🚀 메모리 캐시 실시간 업데이트
      if (purchaseId) {
        if (config.field === 'actual_received') {
          const memoryUpdated = markItemAsReceived(purchaseId, numericId, dateToISOString(selectedDate), receivedQuantity)
          if (!memoryUpdated) {
            logger.warn('[useConfirmDateAction] 메모리 캐시 입고완료 업데이트 실패', { 
              purchaseId, 
              itemId: numericId 
            })
          }
        } else if (config.field === 'statement_received') {
          const memoryUpdated = markItemAsStatementReceived(purchaseId, numericId, dateToISOString(selectedDate), currentUserName || undefined)
          if (!memoryUpdated) {
            logger.warn('[useConfirmDateAction] 메모리 캐시 거래명세서 확인 업데이트 실패', { 
              purchaseId, 
              itemId: numericId 
            })
          }
        }
      }

      if (onOptimisticUpdate) {
        onOptimisticUpdate({
          itemId: numericId,
          selectedDate,
          action: 'confirm',
          receivedQuantity: receivedQuantity !== undefined ? receivedQuantity : itemInfo?.received_quantity,
          itemInfo
        })
      }

      // 강제 새로고침을 위해 onUpdate 호출
      if (onUpdate) {
        onUpdate()
      }
      
      toast.success(config.successMessage.confirm)
    } catch (error) {
      logger.error('❌ 전체 처리 실패', error)
      toast.error(`${config.field === 'statement_received' ? '거래명세서' : '입고'} 확인 처리 중 오류가 발생했습니다.`)
    }
  }, [config, currentUserName, canPerformAction, purchaseId, onUpdate, onBeforeUpdate, onOptimisticUpdate, supabase])

  const handleCancel = useCallback(async (
    itemId: number | string,
    itemInfo?: {
      item_name?: string
      specification?: string
      quantity?: number
      unit_price_value?: number
      amount_value?: number
      remark?: string
    }
  ) => {
    if (!canPerformAction) {
      logger.warn(`❌ 취소 권한 없음`, { canPerformAction, currentUserName })
      toast.error(`${config.field === 'statement_received' ? '거래명세서' : '입고'} 확인 권한이 없습니다.`)
      return
    }

    const itemIdStr = String(itemId)
    const numericId = typeof itemId === 'number' ? itemId : Number(itemId)

    if (Number.isNaN(numericId)) {
      toast.error('유효하지 않은 항목 ID 입니다.')
      return
    }

    // 확인 다이얼로그 표시
    if (itemInfo) {
      const confirmMessage = `품목명: ${itemInfo.item_name || '-'}
규격: ${itemInfo.specification || '-'}
수량: ${itemInfo.quantity?.toLocaleString() || 0}
단가: ₩${itemInfo.unit_price_value?.toLocaleString() || 0}
합계: ₩${itemInfo.amount_value?.toLocaleString() || 0}
비고: ${itemInfo.remark || '-'}

${config.confirmMessage.cancel}`
      
      if (!window.confirm(confirmMessage)) {
        return
      }
    }

    // 🚀 업데이트 시작 전 콜백 호출 (Realtime 이벤트 무시 플래그 설정)
    onBeforeUpdate?.()

    try {
      logger.debug(`🔄 ${config.field} 확인 취소 시작`, { 
        itemId, 
        itemName: itemInfo?.item_name 
      })

      let updateData: Record<string, string | boolean | number | null | ReceiptHistoryItem[]> = {}

      if (config.field === 'statement_received') {
        updateData = {
          is_statement_received: false,
          statement_received_date: null,
          statement_received_by_name: null,
          accounting_received_date: null
        }
      } else if (config.field === 'actual_received') {
        // 분할 입고 취소: receipt_history 전체 초기화
        updateData = {
          actual_received_date: null,
          is_received: false,
          received_quantity: 0,
          delivery_status: 'pending',
          receipt_history: []
        }
      }

      logger.debug('🔄 취소 업데이트할 데이터:', updateData)

      const { data, error } = await supabase
        .from('purchase_request_items')
        .update(updateData)
        .eq('id', numericId)
        .select()

      logger.debug('🔄 취소 DB 업데이트 결과:', { data, error })

      if (error) {
        logger.error('❌ DB 업데이트 실패', error)
        throw error
      }

      logger.info(`✅ ${config.field} 확인 취소 성공`, data)

      // 🚀 메모리 캐시 실시간 업데이트
      if (purchaseId) {
        if (config.field === 'actual_received') {
          const memoryUpdated = markItemAsReceiptCanceled(purchaseId, numericId)
          if (!memoryUpdated) {
            logger.warn('[useConfirmDateAction] 메모리 캐시 입고취소 업데이트 실패', { 
              purchaseId, 
              itemId: numericId 
            })
          }
        } else if (config.field === 'statement_received') {
          const memoryUpdated = markItemAsStatementCanceled(purchaseId, numericId)
          if (!memoryUpdated) {
            logger.warn('[useConfirmDateAction] 메모리 캐시 거래명세서 취소 업데이트 실패', { 
              purchaseId, 
              itemId: numericId 
            })
          }
        }
      }

      if (onOptimisticUpdate) {
        onOptimisticUpdate({
          itemId: numericId,
          action: 'cancel',
          itemInfo
        })
      }

      // 강제 새로고침을 위해 onUpdate 호출
      if (onUpdate) {
        onUpdate()
      }
      
      toast.success(config.successMessage.cancel)
    } catch (error) {
      logger.error(`❌ ${config.field} 확인 취소 실패`, error)
      toast.error(`${config.field === 'statement_received' ? '거래명세서' : '입고'} 확인 취소 중 오류가 발생했습니다.`)
    }
  }, [config, canPerformAction, purchaseId, onUpdate, onBeforeUpdate, onOptimisticUpdate, supabase])

  const isCompleted = useCallback((item: { is_statement_received?: boolean; is_received?: boolean }) => {
    if (config.field === 'statement_received') {
      return item.is_statement_received
    } else if (config.field === 'actual_received') {
      return item.is_received // actual_received_date 대신 is_received 필드 사용
    }
    return false
  }, [config.field])

  // 부분 입고 상태 확인 (분할 입고용)
  const isPartiallyReceived = useCallback((item: { received_quantity?: number; quantity?: number }) => {
    if (config.field === 'actual_received') {
      const receivedQty = item.received_quantity || 0
      const requestedQty = item.quantity || 0
      return receivedQty > 0 && receivedQty < requestedQty
    }
    return false
  }, [config.field])

  // 미입고 수량 계산
  const getRemainingQuantity = useCallback((item: { received_quantity?: number; quantity?: number }) => {
    const receivedQty = item.received_quantity || 0
    const requestedQty = item.quantity || 0
    return Math.max(0, requestedQty - receivedQty)
  }, [])

  const getCompletedDate = useCallback((item: { statement_received_date?: string | null; actual_received_date?: string }) => {
    if (config.field === 'statement_received') {
      return item.statement_received_date
    } else if (config.field === 'actual_received') {
      return item.actual_received_date
    }
    return null
  }, [config.field])

  const getCompletedByName = useCallback((item: { statement_received_by_name?: string | null }) => {
    if (config.field === 'statement_received') {
      return item.statement_received_by_name
    } else if (config.field === 'actual_received') {
      // 입고완료는 처리자 정보를 기록하지 않음
      return null
    }
    return null
  }, [config.field])

  return {
    config,
    handleConfirm,
    handleCancel,
    isCompleted,
    isPartiallyReceived,
    getRemainingQuantity,
    getCompletedDate,
    getCompletedByName
  }
}