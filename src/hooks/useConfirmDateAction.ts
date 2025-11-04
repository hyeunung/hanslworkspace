import { useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'

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
  onUpdate?: () => void
}

export function useConfirmDateAction({
  config,
  currentUserName,
  canPerformAction,
  onUpdate
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
    }
  ) => {
    logger.debug(`🔍 ${config.field} 확인 시작`, { 
      itemId, 
      selectedDate, 
      canPerformAction, 
      currentUserName 
    })
    
    if (!canPerformAction) {
      logger.warn(`❌ 권한 없음`, { canPerformAction })
      toast.error(`${config.field === 'statement_received' ? '거래명세서' : '입고'} 확인 권한이 없습니다.`)
      return
    }

    const itemIdStr = String(itemId)
    const numericId = typeof itemId === 'number' ? itemId : Number(itemId)
    
    logger.debug('🔢 ID 변환 확인', { 
      originalItemId: itemId, 
      itemIdStr, 
      numericId,
      itemIdType: typeof itemId 
    })

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

    logger.debug('📝 데이터베이스 업데이트 시작', { 
      numericId, 
      selectedDate: selectedDate.toISOString() 
    })

    try {
      let updateData: any

      if (config.field === 'statement_received') {
        updateData = {
          is_statement_received: true,
          statement_received_date: selectedDate.toISOString(),
          statement_received_by_name: currentUserName
        }
      } else if (config.field === 'actual_received') {
        updateData = {
          actual_received_date: selectedDate.toISOString(),
          actual_received_by_name: currentUserName
        }
      }

      const { error } = await supabase
        .from('purchase_request_items')
        .update(updateData)
        .eq('id', numericId)

      if (error) {
        logger.error('❌ DB 업데이트 실패', error)
        throw error
      }

      logger.info('✅ DB 업데이트 성공')

      // 강제 새로고침을 위해 onUpdate 호출
      if (onUpdate) {
        logger.debug('🔄 부모 컴포넌트 새로고침 호출')
        onUpdate()
      }
      
      toast.success(config.successMessage.confirm)
    } catch (error) {
      logger.error('❌ 전체 처리 실패', error)
      toast.error(`${config.field === 'statement_received' ? '거래명세서' : '입고'} 확인 처리 중 오류가 발생했습니다.`)
    }
  }, [config, currentUserName, canPerformAction, onUpdate, supabase])

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

    try {
      logger.debug(`🔄 ${config.field} 확인 취소 시작`, { 
        itemId, 
        itemName: itemInfo?.item_name 
      })

      let updateData: any

      if (config.field === 'statement_received') {
        updateData = {
          is_statement_received: false,
          statement_received_date: null,
          statement_received_by_name: null
        }
      } else if (config.field === 'actual_received') {
        updateData = {
          actual_received_date: null,
          actual_received_by_name: null
        }
      }

      const { error } = await supabase
        .from('purchase_request_items')
        .update(updateData)
        .eq('id', numericId)

      if (error) {
        logger.error('❌ DB 업데이트 실패', error)
        throw error
      }

      logger.info(`✅ ${config.field} 확인 취소 성공`)

      // 강제 새로고침을 위해 onUpdate 호출
      if (onUpdate) {
        logger.debug(`🔄 부모 컴포넌트 새로고침 호출 (취소)`)
        onUpdate()
      }
      
      toast.success(config.successMessage.cancel)
    } catch (error) {
      logger.error(`❌ ${config.field} 확인 취소 실패`, error)
      toast.error(`${config.field === 'statement_received' ? '거래명세서' : '입고'} 확인 취소 중 오류가 발생했습니다.`)
    }
  }, [config, canPerformAction, onUpdate, supabase])

  const isCompleted = useCallback((item: any) => {
    if (config.field === 'statement_received') {
      return item.is_statement_received
    } else if (config.field === 'actual_received') {
      return !!item.actual_received_date
    }
    return false
  }, [config.field])

  const getCompletedDate = useCallback((item: any) => {
    if (config.field === 'statement_received') {
      return item.statement_received_date
    } else if (config.field === 'actual_received') {
      return item.actual_received_date
    }
    return null
  }, [config.field])

  const getCompletedByName = useCallback((item: any) => {
    if (config.field === 'statement_received') {
      return item.statement_received_by_name
    } else if (config.field === 'actual_received') {
      return item.actual_received_by_name
    }
    return null
  }, [config.field])

  return {
    config,
    handleConfirm,
    handleCancel,
    isCompleted,
    getCompletedDate,
    getCompletedByName
  }
}