
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
// import { ArrowRight, AlertCircle } from 'lucide-react'

interface ApprovalProps {
  approvals: any[]
  role?: string | string[]
}

export default function PendingApprovals({ approvals, role }: ApprovalProps) {
  const getActionText = () => {
    // role이 배열인 경우 처리
    const roles = Array.isArray(role) ? role : (role ? [role] : []);
    
    if (roles.includes('middle_manager')) return '1차 승인 필요'
    if (roles.includes('final_approver') || roles.includes('ceo')) return '최종 승인 필요'
    if (roles.includes('lead buyer')) return '구매 처리 필요'
    return '처리 필요'
  }

  return (
    <div className="bg-white business-radius-card border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="section-title">승인 대기 항목</h2>
          <Link
            to="/approval"
            className="link-text text-hansl-500 hover:text-hansl-600 transition-colors"
          >
            전체보기 →
          </Link>
        </div>
      </div>

      <div className="divide-y divide-gray-200">
        {approvals.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            승인 대기 중인 항목이 없습니다.
          </div>
        ) : (
          approvals.map((approval) => (
          <div key={approval.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <div className="flex-1">
                <p className="card-title">
                  {approval.purchase_order_number || `발주요청 #${approval.id.slice(0, 8)}`}
                </p>
                <p className="card-subtitle mt-0.5">
                  요청자: {approval.requester_name}
                </p>
                <p className="card-description">
                  {approval.purchase_request_items?.[0]?.item_name}
                  {approval.purchase_request_items?.length > 1 && 
                    ` 외 ${approval.purchase_request_items.length - 1}건`}
                </p>
              </div>
              <span className="inline-flex items-center px-2 py-0.5 badge-text bg-yellow-50 text-yellow-700 business-radius-badge">
                {getActionText()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="card-date">
                {format(new Date(approval.created_at), 'yyyy.MM.dd', { locale: ko })}
              </span>
              <span className="card-amount">
                ₩{((approval.total_amount || 0)/1000000).toFixed(1)}M
              </span>
            </div>
          </div>
        ))
        )}
      </div>
    </div>
  )
}