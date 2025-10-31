
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ArrowRight } from 'lucide-react'

interface RequestProps {
  requests: any[]
}

export default function RecentRequests({ requests }: RequestProps) {
  const getStatusBadge = (request: any) => {
    if (request.delivery_status === 'completed') {
      return <span className="inline-flex items-center px-2 py-0.5 badge-text bg-green-50 text-green-700 business-radius-badge">완료</span>
    }
    if (request.final_manager_status === 'approved') {
      return <span className="inline-flex items-center px-2 py-0.5 badge-text bg-blue-50 text-blue-700 business-radius-badge">구맨중</span>
    }
    if (request.middle_manager_status === 'approved') {
      return <span className="inline-flex items-center px-2 py-0.5 badge-text bg-yellow-50 text-yellow-700 business-radius-badge">최종승인 대기</span>
    }
    if (request.middle_manager_status === 'pending') {
      return <span className="inline-flex items-center px-2 py-0.5 badge-text bg-gray-50 text-gray-600 business-radius-badge">1차승인 대기</span>
    }
    return <span className="inline-flex items-center px-2 py-0.5 badge-text bg-red-50 text-red-700 business-radius-badge">반려</span>
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="section-title">최근 발주요청 내역</h2>
          <Link
            to="/purchase/list"
            className="link-text text-hansl-500 hover:text-hansl-600 transition-colors"
          >
            전체보기 →
          </Link>
        </div>
      </div>

      <div className="divide-y divide-gray-200">
        {requests.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            최근 발주요청 내역이 없습니다.
          </div>
        ) : (
          requests.map((request) => (
            <div key={request.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <div className="flex-1">
                  <p className="card-title">
                    {request.purchase_order_number || `발주요청 #${request.id.slice(0, 8)}`}
                  </p>
                  <p className="card-description mt-0.5">
                    {request.purchase_request_items?.[0]?.item_name}
                    {request.purchase_request_items?.length > 1 && 
                      ` 외 ${request.purchase_request_items.length - 1}건`}
                  </p>
                </div>
                {getStatusBadge(request)}
              </div>
              <div className="flex items-center justify-between">
                <span className="card-date">
                  {format(new Date(request.created_at), 'yyyy.MM.dd', { locale: ko })}
                </span>
                <span className="card-amount">
                  ₩{((request.total_amount || 0)/1000000).toFixed(1)}M
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}