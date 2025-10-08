import { createClient } from '@/lib/supabase/client'

interface SlackNotificationData {
  targetRole: string
  message: string
  purchaseOrderNumber?: string
  withAttachment?: boolean
  directUserId?: string
}

interface SlackDMRequest {
  user_id: string
  message?: string
  blocks?: any[]
  purchase_order_number?: string
  with_attachment?: boolean
}

class SlackService {
  private supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://qvhbigvdfyvhoegkhvef.supabase.co'
  private supabase = createClient()

  /**
   * 역할 기반 슬랙 알림 전송
   */
  async sendRoleBasedNotification(data: SlackNotificationData): Promise<{ success: boolean; error?: string }> {
    try {
      const { targetRole, message, purchaseOrderNumber, withAttachment, directUserId } = data

      let targetUsers: string[] = []

      if (directUserId) {
        // 직접 사용자 ID 지정된 경우
        targetUsers = [directUserId]
      } else {
        // 역할 기반 사용자 조회
        targetUsers = await this.getUsersByRole(targetRole)
      }

      if (targetUsers.length === 0) {
        return { success: false, error: '대상 사용자가 없습니다' }
      }

      // 각 사용자에게 메시지 전송
      const results = await Promise.allSettled(
        targetUsers.map(userId => 
          this.sendDirectMessage({
            user_id: userId,
            message,
            purchase_order_number: purchaseOrderNumber,
            with_attachment: withAttachment
          })
        )
      )

      const successCount = results.filter(result => result.status === 'fulfilled').length
      const failureCount = results.filter(result => result.status === 'rejected').length


      return { 
        success: successCount > 0,
        error: failureCount > 0 ? `${failureCount}건 전송 실패` : undefined
      }

    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류' 
      }
    }
  }

  /**
   * 역할별 사용자 SlackID 조회
   */
  private async getUsersByRole(role: string): Promise<string[]> {
    try {
      const { data: employees, error } = await this.supabase
        .from('employees')
        .select('slack_id')
        .contains('purchase_role', [role])
        .not('slack_id', 'is', null)

      if (error) {
        return []
      }

      return employees?.map(emp => emp.slack_id).filter(Boolean) || []
    } catch (error) {
      return []
    }
  }

  /**
   * 직접 DM 전송
   */
  private async sendDirectMessage(data: SlackDMRequest): Promise<any> {
    try {
      const response = await fetch(`${this.supabaseUrl}/functions/v1/slack-dm-sender`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(data)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'slack-dm-sender 호출 실패')
      }

      const result = await response.json()
      return result

    } catch (error) {
      throw error
    }
  }

  /**
   * 승인 단계별 슬랙 알림 메시지 생성
   */
  generateApprovalMessage(
    type: 'request' | 'approved' | 'rejected' | 'completed',
    purchaseData: any,
    level?: 'middle' | 'final' | 'buyer',
    comment?: string,
    approverName?: string
  ): string {
    const baseInfo = `💼 발주요청번호: ${purchaseData.purchase_order_number || `#${purchaseData.id?.toString().slice(-8)}`}
👤 요청자: ${purchaseData.requester_name}
💰 총액: ₩${purchaseData.total_amount?.toLocaleString()}`

    switch (type) {
      case 'request':
        return `📋 *${this.getLevelText(level)} 요청*

${baseInfo}
📅 요청일: ${new Date(purchaseData.request_date).toLocaleDateString('ko-KR')}

${this.getLevelDescription(level)}`

      case 'approved':
        return `✅ *${this.getLevelText(level)} 완료*

${baseInfo}
✓ 승인자: ${approverName}
📅 승인일: ${new Date().toLocaleDateString('ko-KR')}
${comment ? `💬 코멘트: ${comment}` : ''}`

      case 'rejected':
        return `❌ *${this.getLevelText(level)} 반려*

${baseInfo}
❌ 반려자: ${approverName}
📅 반려일: ${new Date().toLocaleDateString('ko-KR')}
${comment ? `💬 반려사유: ${comment}` : ''}`

      case 'completed':
        return `🎉 *구매 처리 완료*

${baseInfo}
✅ 처리자: ${approverName}
📅 완료일: ${new Date().toLocaleDateString('ko-KR')}
${comment ? `💬 처리내용: ${comment}` : ''}

발주요청이 완료되었습니다.`

      default:
        return baseInfo
    }
  }

  private getLevelText(level?: string): string {
    switch (level) {
      case 'middle': return '1차 승인'
      case 'final': return '최종 승인'
      case 'buyer': return '구매 처리'
      default: return '승인'
    }
  }

  private getLevelDescription(level?: string): string {
    switch (level) {
      case 'middle': return '1차 승인을 요청합니다.'
      case 'final': return '1차 승인이 완료되어 최종 승인을 요청합니다.'
      case 'buyer': return '최종 승인이 완료되어 구매 처리를 요청합니다.'
      default: return '검토를 요청합니다.'
    }
  }

  /**
   * 발주요청 시 중간관리자에게 알림
   */
  async notifyNewPurchaseRequest(purchaseData: any): Promise<{ success: boolean; error?: string }> {
    const message = this.generateApprovalMessage('request', purchaseData, 'middle')
    
    return this.sendRoleBasedNotification({
      targetRole: 'middle_manager',
      message,
      purchaseOrderNumber: purchaseData.purchase_order_number
    })
  }

  /**
   * 1차 승인 시 최종승인자에게 알림
   */
  async notifyMiddleApproval(purchaseData: any, approverName: string, comment?: string): Promise<{ success: boolean; error?: string }> {
    const message = this.generateApprovalMessage('request', purchaseData, 'final')
    
    return this.sendRoleBasedNotification({
      targetRole: 'final_approver',
      message,
      purchaseOrderNumber: purchaseData.purchase_order_number
    })
  }

  /**
   * 최종 승인 시 구매담당자에게 알림 (엑셀 첨부)
   */
  async notifyFinalApproval(purchaseData: any, approverName: string, comment?: string): Promise<{ success: boolean; error?: string }> {
    const message = this.generateApprovalMessage('request', purchaseData, 'buyer')
    
    return this.sendRoleBasedNotification({
      targetRole: 'lead buyer',
      message,
      purchaseOrderNumber: purchaseData.purchase_order_number,
      withAttachment: true // 엑셀 파일 첨부
    })
  }

  /**
   * 반려 시 요청자에게 알림
   */
  async notifyRejection(
    purchaseData: any, 
    level: 'middle' | 'final' | 'buyer',
    rejectorName: string, 
    comment: string
  ): Promise<{ success: boolean; error?: string }> {
    const message = this.generateApprovalMessage('rejected', purchaseData, level, comment, rejectorName)
    
    // 요청자의 slack_id를 조회해서 직접 전송
    try {
      const { data: requester, error } = await this.supabase
        .from('employees')
        .select('slack_id')
        .eq('name', purchaseData.requester_name)
        .single()

      if (error || !requester?.slack_id) {
        return { success: false, error: '요청자 정보를 찾을 수 없습니다' }
      }

      return this.sendRoleBasedNotification({
        targetRole: '',
        message,
        purchaseOrderNumber: purchaseData.purchase_order_number,
        directUserId: requester.slack_id
      })
    } catch (error) {
      return { success: false, error: '반려 알림 전송 실패' }
    }
  }

  /**
   * 구매 완료 시 요청자에게 알림
   */
  async notifyPurchaseCompleted(
    purchaseData: any, 
    buyerName: string, 
    comment?: string
  ): Promise<{ success: boolean; error?: string }> {
    const message = this.generateApprovalMessage('completed', purchaseData, 'buyer', comment, buyerName)
    
    // 요청자의 slack_id를 조회해서 직접 전송
    try {
      const { data: requester, error } = await this.supabase
        .from('employees')
        .select('slack_id')
        .eq('name', purchaseData.requester_name)
        .single()

      if (error || !requester?.slack_id) {
        return { success: false, error: '요청자 정보를 찾을 수 없습니다' }
      }

      return this.sendRoleBasedNotification({
        targetRole: '',
        message,
        purchaseOrderNumber: purchaseData.purchase_order_number,
        directUserId: requester.slack_id
      })
    } catch (error) {
      return { success: false, error: '완료 알림 전송 실패' }
    }
  }
}

export const slackService = new SlackService()