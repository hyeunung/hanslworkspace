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
import type { Purchase, PurchaseRequestItem } from '@/types/purchase'
import { logger } from '@/lib/logger'

// 구독자 콜백 타입
type RealtimeCallback = () => void

class PurchaseRealtimeService {
  private supabase = createClient()
  private channel: RealtimeChannel | null = null
  private isSubscribed = false
  private isSubscribing = false  // 구독 진행 중 플래그 (경쟁 조건 방지)
  private subscribers: Set<RealtimeCallback> = new Set()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private shouldReconnect = true  // 자동 재연결 활성화 플래그

  /**
   * 외부에서 호출해 구독 상태를 보장하는 헬퍼
   */
  ensureSubscribed(): void {
    if (!this.isSubscribed && !this.isSubscribing) {
      this.subscribe()
    }
  }

  /**
   * 재연결 스케줄링 (지수 백오프)
   */
  private scheduleReconnect(): void {
    // 이미 재연결 예약되어 있거나 재연결 비활성화된 경우 무시
    if (this.reconnectTimeout || !this.shouldReconnect) {
      return
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.warn('⚠️ [Realtime] 최대 재연결 시도 횟수 초과. 수동 새로고침이 필요합니다.')
      return
    }

    // 지수 백오프: 1초, 2초, 4초, 8초, 16초
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectAttempts++

    logger.info(`🔄 [Realtime] ${delay/1000}초 후 재연결 시도... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null
      if (this.shouldReconnect && !this.isSubscribed && !this.isSubscribing) {
        this.subscribe()
      }
    }, delay)
  }

  /**
   * 재연결 상태 초기화
   */
  private resetReconnectState(): void {
    this.reconnectAttempts = 0
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
  }

  /**
   * Realtime 구독 시작
   */
  subscribe(): void {
    // 이미 구독 중이거나 구독 진행 중이면 무시
    if (this.isSubscribed || this.isSubscribing) {
      if (this.isSubscribed) {
        // 이미 구독 중일 때는 로그 레벨을 debug로 낮춤 (로그 스팸 방지)
        logger.debug('🔄 [Realtime] 이미 구독 중입니다.')
      }
      return
    }

    // 재연결 활성화
    this.shouldReconnect = true

    // 채널이 이미 존재하면 먼저 정리
    if (this.channel) {
      this.supabase.removeChannel(this.channel)
      this.channel = null
    }

    // 구독 시작 표시 (경쟁 조건 방지)
    this.isSubscribing = true
    // 재연결 시에는 로그 레벨을 낮춤
    if (this.reconnectAttempts > 0) {
      logger.debug('🚀 [Realtime] 재연결 중...')
    } else {
      logger.info('🚀 [Realtime] 구독 시작...')
    }

    this.channel = this.supabase
      .channel('purchase_realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'purchase_requests'
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
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
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          this.handlePurchaseItemChange(payload)
        }
      )
      .subscribe((status: string, err?: Error) => {
        if (status === 'SUBSCRIBED') {
          this.isSubscribed = true
          this.isSubscribing = false
          this.resetReconnectState()  // 성공 시 재연결 상태 초기화
          logger.info('✅ [Realtime] 구독 성공!')
        } else if (status === 'CHANNEL_ERROR') {
          this.isSubscribed = false
          this.isSubscribing = false
          // 채널 에러는 warn 레벨로 표시 (자동 재연결되므로 error 아님)
          logger.warn('⚠️ [Realtime] 채널 에러, 재연결 예정...', { attempt: this.reconnectAttempts + 1 })
          // 자동 재연결 시도
          this.scheduleReconnect()
        } else if (status === 'TIMED_OUT') {
          this.isSubscribed = false
          this.isSubscribing = false
          logger.warn('⚠️ [Realtime] 연결 타임아웃')
          // 자동 재연결 시도
          this.scheduleReconnect()
        } else if (status === 'CLOSED') {
          this.isSubscribed = false
          this.isSubscribing = false
          // 의도적 종료가 아닌 경우에만 재연결 (로그는 debug로)
          if (this.shouldReconnect) {
            logger.debug('🔴 [Realtime] 채널 닫힘, 재연결 예정')
            this.scheduleReconnect()
          } else {
            logger.info('🔴 [Realtime] 채널 닫힘 (의도적 종료)')
          }
        }
      })
  }

  /**
   * Realtime 구독 해제
   */
  unsubscribe(): void {
    // 자동 재연결 비활성화
    this.shouldReconnect = false
    this.resetReconnectState()

    if (this.channel) {
      logger.info('🔴 [Realtime] 구독 해제 중...')
      this.supabase.removeChannel(this.channel)
      this.channel = null
      this.isSubscribed = false
      this.isSubscribing = false
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
  private handlePurchaseRequestChange(payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void {
    const { eventType } = payload
    const newRecord = ('new' in payload && payload.new && Object.keys(payload.new).length > 0) ? payload.new as Record<string, unknown> : null
    const oldRecord = ('old' in payload && payload.old && Object.keys(payload.old).length > 0) ? payload.old as Record<string, unknown> : null

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
   * 🚀 개선: 업데이트 성공 시에만 리스너 알림 (경쟁 상태 방지)
   */
  private handlePurchaseItemChange(payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void {
    const { eventType } = payload
    const newRecord = ('new' in payload && payload.new && Object.keys(payload.new).length > 0) ? payload.new as Record<string, unknown> : null
    const oldRecord = ('old' in payload && payload.old && Object.keys(payload.old).length > 0) ? payload.old as Record<string, unknown> : null

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

    let updateSuccess = false

    switch (eventType) {
      case 'INSERT':
        updateSuccess = this.handleItemInsert(newRecord)
        break
      case 'UPDATE':
        updateSuccess = this.handleItemUpdate(newRecord)
        break
      case 'DELETE':
        updateSuccess = this.handleItemDelete(oldRecord)
        break
    }

    // 🚀 업데이트 성공한 경우에만 리스너 알림 (불완전한 데이터로 UI 갱신 방지)
    if (updateSuccess) {
      this.notifySubscribers()
    } else {
      logger.debug('⚠️ [Realtime] 품목 업데이트 실패 - 리스너 알림 생략')
    }
  }

  /**
   * 새 발주서 추가 처리
   */
  private async handlePurchaseInsert(record: Record<string, unknown> | null): Promise<void> {
    if (!purchaseMemoryCache.allPurchases || !record) return

    // 이미 존재하는지 확인
    const exists = purchaseMemoryCache.allPurchases.some(p => p.id === record.id)
    if (exists) {
      logger.info('⚠️ [Realtime] 이미 존재하는 발주서, 업데이트로 처리:', { id: record.id })
      this.handlePurchaseUpdate(record)
      return
    }

    // 새 발주서를 캐시에 추가 (품목 정보는 별도 로드 필요)
    const newPurchase = {
      ...(record as unknown as Purchase),
      items: [] as Purchase['items'],
      purchase_request_items: [] as Purchase['purchase_request_items']
    } satisfies Purchase

    // 품목 정보 로드
    try {
      const { data: items } = await this.supabase
        .from('purchase_request_items')
        .select('*')
        .eq('purchase_request_id', record.id as number)

      if (items) {
        newPurchase.items = items
        newPurchase.purchase_request_items = items
      }
    } catch (error) {
      logger.error('❌ [Realtime] 품목 로드 실패:', error)
    }

    // await 동안 캐시가 교체/갱신되었을 수 있으므로 재확인 (중복 추가 방지)
    if (!purchaseMemoryCache.allPurchases) {
      logger.warn('⚠️ [Realtime] 품목 로드 후 캐시 없음, 추가 생략:', { id: record.id })
      return
    }
    if (purchaseMemoryCache.allPurchases.some(p => p.id === record.id)) {
      logger.info('⚠️ [Realtime] 품목 로드 중 캐시에 이미 추가됨, 업데이트로 처리:', { id: record.id })
      this.handlePurchaseUpdate(record)
      return
    }

    // 배열 맨 앞에 추가 (최신 항목)
    purchaseMemoryCache.allPurchases = [newPurchase, ...purchaseMemoryCache.allPurchases]

    logger.info('✅ [Realtime] 새 발주서 추가됨:', { id: record.id })
  }

  /**
   * 발주서 업데이트 처리
   */
  private handlePurchaseUpdate(record: Record<string, unknown> | null): void {
    if (!record) return

    const updated = updatePurchaseInMemory(record.id as number, (purchase) => ({
      ...purchase,
      ...(record as unknown as Partial<Purchase>),
      // items는 유지 (별도로 관리됨)
      items: purchase.items,
      purchase_request_items: purchase.purchase_request_items
    }))

    if (updated) {
      logger.info('✅ [Realtime] 발주서 업데이트됨:', { id: record.id })
    } else {
      logger.warn('⚠️ [Realtime] 업데이트할 발주서를 찾을 수 없음:', { id: record.id })
    }
  }

  /**
   * 발주서 삭제 처리
   */
  private handlePurchaseDelete(record: Record<string, unknown> | null): void {
    if (!record) return

    const deleted = removePurchaseFromMemory(record.id as number)

    if (deleted) {
      logger.info('✅ [Realtime] 발주서 삭제됨:', { id: record.id })
    } else {
      logger.warn('⚠️ [Realtime] 삭제할 발주서를 찾을 수 없음:', { id: record.id })
    }
  }

  /**
   * 새 품목 추가 처리
   * @returns 업데이트 성공 여부
   */
  private handleItemInsert(record: Record<string, unknown> | null): boolean {
    if (!record || !record.purchase_request_id) {
      logger.warn('⚠️ [Realtime] 품목 추가 실패 - 필수 정보 없음')
      return false
    }

    const itemRecord = record as unknown as PurchaseRequestItem
    const success = updatePurchaseInMemory(record.purchase_request_id as number, (purchase) => {
      const currentItems = purchase.items || purchase.purchase_request_items || []

      // 이미 존재하는지 확인
      const exists = currentItems.some(item => item.id === itemRecord.id)
      if (exists) {
        return purchase
      }

      const updatedItems = [...currentItems, itemRecord]
      const newTotalAmount = updatedItems.reduce((sum: number, item: PurchaseRequestItem) => sum + (item.amount_value || 0), 0)

      // 🔧 헤더-품목 동기화: 모든 품목 상태를 확인하여 헤더 상태 재계산
      const allItemsReceived = updatedItems.length > 0 && updatedItems.every(item => item.is_received === true)
      const allItemsPaymentCompleted = updatedItems.length > 0 && updatedItems.every(item => item.is_payment_completed === true)

      return {
        ...purchase,
        items: updatedItems,
        purchase_request_items: updatedItems,
        total_amount: newTotalAmount,
        is_received: allItemsReceived,
        is_payment_completed: allItemsPaymentCompleted
      }
    })

    if (success) {
      logger.info('✅ [Realtime] 품목 추가됨:', { id: record.id })
    }
    return success
  }

  /**
   * 품목 업데이트 처리
   * @returns 업데이트 성공 여부
   */
  private handleItemUpdate(record: Record<string, unknown> | null): boolean {
    if (!record) {
      logger.warn('⚠️ [Realtime] 품목 업데이트 실패 - record 없음')
      return false
    }

    // purchase_request_id가 있으면 직접 업데이트
    const itemRecord = record as unknown as Partial<PurchaseRequestItem>
    let targetPurchaseId: number | string | undefined = itemRecord.purchase_request_id as string | undefined

    // 🚀 purchase_request_id가 없으면 item ID로 해당 purchase를 찾음 (RLS 필터링 대응)
    if (!targetPurchaseId && itemRecord.id && purchaseMemoryCache.allPurchases) {
      for (const purchase of purchaseMemoryCache.allPurchases) {
        const items = purchase.items || purchase.purchase_request_items || []
        const foundItem = items.find(item => item.id === itemRecord.id)
        if (foundItem) {
          targetPurchaseId = purchase.id
          logger.info('🔍 [Realtime] item ID로 purchase 찾음:', { itemId: String(itemRecord.id), purchaseId: String(targetPurchaseId) })
          break
        }
      }
    }

    if (!targetPurchaseId) {
      logger.warn('⚠️ [Realtime] 품목 업데이트 실패 - purchase를 찾을 수 없음:', { id: itemRecord.id })
      return false
    }

    const success = updatePurchaseInMemory(targetPurchaseId, (purchase) => {
      const currentItems = purchase.items || purchase.purchase_request_items || []

      // 🚀 items가 비어있으면 업데이트 하지 않음 (데이터 보호)
      if (currentItems.length === 0) {
        logger.warn('⚠️ [Realtime] 품목 업데이트 스킵 - 기존 items가 비어있음')
        return purchase
      }

      const updatedItems = currentItems.map(item => {
        if (item.id !== itemRecord.id) return item
        const merged: PurchaseRequestItem = { ...item, ...itemRecord as PurchaseRequestItem }
        // ✅ Realtime payload가 null/undefined로 들어오는 경우 기존 값 보존 (0으로 롤백 방지)
        if (itemRecord.amount_value === null || itemRecord.amount_value === undefined) {
          merged.amount_value = item.amount_value
        }
        if (itemRecord.unit_price_value === null || itemRecord.unit_price_value === undefined) {
          merged.unit_price_value = item.unit_price_value
        }
        return merged
      })

      const newTotalAmount = updatedItems.reduce((sum: number, item: PurchaseRequestItem) => sum + (item.amount_value || 0), 0)

      // 🔧 헤더-품목 동기화: 모든 품목 상태를 확인하여 헤더 상태 재계산
      const allItemsReceived = updatedItems.length > 0 && updatedItems.every(item => item.is_received === true)
      const allItemsPaymentCompleted = updatedItems.length > 0 && updatedItems.every(item => item.is_payment_completed === true)

      return {
        ...purchase,
        items: updatedItems,
        purchase_request_items: updatedItems,
        total_amount: newTotalAmount,
        // 헤더 상태도 품목 기반으로 업데이트
        is_received: allItemsReceived,
        is_payment_completed: allItemsPaymentCompleted
      }
    })

    if (success) {
      logger.info('✅ [Realtime] 품목 업데이트됨:', { id: record.id })
    }
    return success
  }

  /**
   * 품목 삭제 처리
   * @returns 삭제 성공 여부
   */
  private handleItemDelete(record: Record<string, unknown> | null): boolean {
    if (!record) {
      logger.warn('⚠️ [Realtime] 품목 삭제 실패 - record 없음')
      return false
    }

    // purchase_request_id가 있으면 직접 사용
    let targetPurchaseId: number | string | undefined = record.purchase_request_id as number | undefined

    // 🚀 purchase_request_id가 없으면 item ID로 해당 purchase를 찾음 (RLS 필터링 대응)
    if (!targetPurchaseId && record.id && purchaseMemoryCache.allPurchases) {
      for (const purchase of purchaseMemoryCache.allPurchases) {
        const items = purchase.items || purchase.purchase_request_items || []
        const foundItem = items.find(item => item.id === record.id)
        if (foundItem) {
          targetPurchaseId = purchase.id
          logger.info('🔍 [Realtime] item ID로 purchase 찾음 (삭제):', { itemId: String(record.id), purchaseId: String(targetPurchaseId) })
          break
        }
      }
    }

    if (!targetPurchaseId) {
      logger.warn('⚠️ [Realtime] 품목 삭제 실패 - purchase를 찾을 수 없음:', { id: record.id })
      return false
    }

    const deleted = removeItemFromMemory(targetPurchaseId, record.id as number | string)
    
    if (deleted) {
      logger.info('✅ [Realtime] 품목 삭제됨:', { id: record.id })
    }
    return deleted
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

