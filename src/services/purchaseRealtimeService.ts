/**
 * Supabase Realtime 기반 구매 데이터 실시간 동기화 서비스
 * 
 * 기존 폴링(10ms, 50ms) 방식 대신 WebSocket 이벤트 기반으로 동작
 * - purchase_requests 테이블 변경 감지
 * - purchase_request_items 테이블 변경 감지
 * - 메모리 캐시 자동 업데이트
 */

import { createClient } from '@/lib/supabase/client'
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { 
  purchaseMemoryCache,
  updatePurchaseInMemory,
  removePurchaseFromMemory,
  removeItemFromMemory,
  notifyCacheListeners,
  invalidatePurchaseMemoryCache
} from '@/stores/purchaseMemoryStore'
import type { Purchase } from '@/types/purchase'
import { logger } from '@/lib/logger'

// 구독자 콜백 타입
type RealtimeCallback = () => void

class PurchaseRealtimeService {
  private supabase = createClient()
  private channel: RealtimeChannel | null = null
  private isSubscribed = false
  private subscribers: Set<RealtimeCallback> = new Set()

  /**
   * 외부에서 호출해 구독 상태를 보장하는 헬퍼
   */
  ensureSubscribed(): void {
    if (!this.isSubscribed) {
      this.subscribe()
    }
  }

  /**
   * Realtime 구독 시작
   */
  subscribe(): void {
    if (this.isSubscribed) {
      logger.info('🔄 [Realtime] 이미 구독 중입니다.')
      return
    }

    logger.info('🚀 [Realtime] 구독 시작...')

    this.channel = this.supabase
      .channel('purchase_realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'purchase_requests'
        },
        (payload: RealtimePostgresChangesPayload<any>) => {
          this.handlePurchaseRequestChange(payload)
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'purchase_request_items'
        },
        (payload: RealtimePostgresChangesPayload<any>) => {
          this.handlePurchaseItemChange(payload)
        }
      )
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          this.isSubscribed = true
          logger.info('✅ [Realtime] 구독 성공!')
        } else if (status === 'CHANNEL_ERROR') {
          logger.error('❌ [Realtime] 채널 에러 발생')
          this.isSubscribed = false
        } else if (status === 'TIMED_OUT') {
          logger.warn('⚠️ [Realtime] 연결 타임아웃')
          this.isSubscribed = false
        }
      })
  }

  /**
   * Realtime 구독 해제
   */
  unsubscribe(): void {
    if (this.channel) {
      logger.info('🔴 [Realtime] 구독 해제 중...')
      this.supabase.removeChannel(this.channel)
      this.channel = null
      this.isSubscribed = false
    }
  }

  /**
   * 상태 변경 리스너 등록
   */
  addListener(callback: RealtimeCallback): () => void {
    this.subscribers.add(callback)
    return () => {
      this.subscribers.delete(callback)
    }
  }

  /**
   * 모든 리스너에게 변경 알림
   * DB 변화가 있을 때만 호출됨 (폴링 없음)
   */
  private notifySubscribers(): void {
    // lastFetch 업데이트로 변경 시점 기록
    purchaseMemoryCache.lastFetch = Date.now()
    
    // 🚀 purchaseMemoryStore의 리스너들에게 알림 (React 컴포넌트 업데이트)
    notifyCacheListeners()
    
    // 서비스 자체 구독자들에게도 알림
    this.subscribers.forEach(callback => {
      try {
        callback()
      } catch (error) {
        logger.error('❌ [Realtime] 리스너 콜백 에러:', error)
      }
    })
  }

  /**
   * purchase_requests 테이블 변경 처리
   */
  private handlePurchaseRequestChange(payload: RealtimePostgresChangesPayload<any>): void {
    const { eventType } = payload
    const newRecord = payload.new as Record<string, any> | null
    const oldRecord = payload.old as Record<string, any> | null

    logger.info(`📡 [Realtime] purchase_requests ${eventType}:`, {
      id: newRecord?.id || oldRecord?.id
    })

    if (!purchaseMemoryCache.allPurchases) {
      logger.warn('⚠️ [Realtime] 캐시가 초기화되지 않음, 캐시 무효화 후 종료')
      invalidatePurchaseMemoryCache()
      // 캐시가 비어 있어도 구독자들에게 변화 알림을 보내 대시보드 등이 강제 새로고침하도록 유도
      this.notifySubscribers()
      return
    }

    switch (eventType) {
      case 'INSERT':
        this.handlePurchaseInsert(newRecord)
        break
      case 'UPDATE':
        this.handlePurchaseUpdate(newRecord)
        break
      case 'DELETE':
        this.handlePurchaseDelete(oldRecord)
        break
    }

    this.notifySubscribers()
  }

  /**
   * purchase_request_items 테이블 변경 처리
   */
  private handlePurchaseItemChange(payload: RealtimePostgresChangesPayload<any>): void {
    const { eventType } = payload
    const newRecord = payload.new as Record<string, any> | null
    const oldRecord = payload.old as Record<string, any> | null

    logger.info(`📡 [Realtime] purchase_request_items ${eventType}:`, {
      id: newRecord?.id || oldRecord?.id,
      purchaseRequestId: newRecord?.purchase_request_id || oldRecord?.purchase_request_id
    })

    if (!purchaseMemoryCache.allPurchases) {
      logger.warn('⚠️ [Realtime] 캐시가 초기화되지 않음, 캐시 무효화 후 종료')
      invalidatePurchaseMemoryCache()
      // 캐시가 비어 있어도 구독자들에게 변화 알림을 보내 대시보드 등이 강제 새로고침하도록 유도
      this.notifySubscribers()
      return
    }

    switch (eventType) {
      case 'INSERT':
        this.handleItemInsert(newRecord)
        break
      case 'UPDATE':
        this.handleItemUpdate(newRecord)
        break
      case 'DELETE':
        this.handleItemDelete(oldRecord)
        break
    }

    this.notifySubscribers()
  }

  /**
   * 새 발주서 추가 처리
   */
  private async handlePurchaseInsert(record: any): Promise<void> {
    if (!purchaseMemoryCache.allPurchases || !record) return

    // 이미 존재하는지 확인
    const exists = purchaseMemoryCache.allPurchases.some(p => p.id === record.id)
    if (exists) {
      logger.info('⚠️ [Realtime] 이미 존재하는 발주서, 업데이트로 처리:', record.id)
      this.handlePurchaseUpdate(record)
      return
    }

    // 새 발주서를 캐시에 추가 (품목 정보는 별도 로드 필요)
    const newPurchase: Purchase = {
      ...record,
      items: [],
      purchase_request_items: []
    }

    // 품목 정보 로드
    try {
      const { data: items } = await this.supabase
        .from('purchase_request_items')
        .select('*')
        .eq('purchase_request_id', record.id)

      if (items) {
        newPurchase.items = items
        newPurchase.purchase_request_items = items
      }
    } catch (error) {
      logger.error('❌ [Realtime] 품목 로드 실패:', error)
    }

    // 배열 맨 앞에 추가 (최신 항목)
    purchaseMemoryCache.allPurchases = [newPurchase, ...purchaseMemoryCache.allPurchases]
    
    logger.info('✅ [Realtime] 새 발주서 추가됨:', record.id)
  }

  /**
   * 발주서 업데이트 처리
   */
  private handlePurchaseUpdate(record: any): void {
    if (!record) return

    const updated = updatePurchaseInMemory(record.id, (purchase) => ({
      ...purchase,
      ...record,
      // items는 유지 (별도로 관리됨)
      items: purchase.items,
      purchase_request_items: purchase.purchase_request_items
    }))

    if (updated) {
      logger.info('✅ [Realtime] 발주서 업데이트됨:', record.id)
    } else {
      logger.warn('⚠️ [Realtime] 업데이트할 발주서를 찾을 수 없음:', record.id)
    }
  }

  /**
   * 발주서 삭제 처리
   */
  private handlePurchaseDelete(record: any): void {
    if (!record) return

    const deleted = removePurchaseFromMemory(record.id)
    
    if (deleted) {
      logger.info('✅ [Realtime] 발주서 삭제됨:', record.id)
    } else {
      logger.warn('⚠️ [Realtime] 삭제할 발주서를 찾을 수 없음:', record.id)
    }
  }

  /**
   * 새 품목 추가 처리
   */
  private handleItemInsert(record: any): void {
    if (!record || !record.purchase_request_id) return

    updatePurchaseInMemory(record.purchase_request_id, (purchase) => {
      const currentItems = purchase.items || purchase.purchase_request_items || []
      
      // 이미 존재하는지 확인
      const exists = currentItems.some(item => item.id === record.id)
      if (exists) {
        return purchase
      }

      const updatedItems = [...currentItems, record]
      const newTotalAmount = updatedItems.reduce((sum, item) => sum + (item.amount_value || 0), 0)

      return {
        ...purchase,
        items: updatedItems,
        purchase_request_items: updatedItems,
        total_amount: newTotalAmount
      }
    })

    logger.info('✅ [Realtime] 품목 추가됨:', record.id)
  }

  /**
   * 품목 업데이트 처리
   */
  private handleItemUpdate(record: any): void {
    if (!record || !record.purchase_request_id) return

    updatePurchaseInMemory(record.purchase_request_id, (purchase) => {
      const currentItems = purchase.items || purchase.purchase_request_items || []
      
      const updatedItems = currentItems.map(item =>
        item.id === record.id ? { ...item, ...record } : item
      )

      const newTotalAmount = updatedItems.reduce((sum, item) => sum + (item.amount_value || 0), 0)

      return {
        ...purchase,
        items: updatedItems,
        purchase_request_items: updatedItems,
        total_amount: newTotalAmount
      }
    })

    logger.info('✅ [Realtime] 품목 업데이트됨:', record.id)
  }

  /**
   * 품목 삭제 처리
   */
  private handleItemDelete(record: any): void {
    if (!record || !record.purchase_request_id) return

    const deleted = removeItemFromMemory(record.purchase_request_id, record.id)
    
    if (deleted) {
      logger.info('✅ [Realtime] 품목 삭제됨:', record.id)
    }
  }

  /**
   * 구독 상태 확인
   */
  isActive(): boolean {
    return this.isSubscribed
  }
}

// 싱글톤 인스턴스
export const purchaseRealtimeService = new PurchaseRealtimeService()

