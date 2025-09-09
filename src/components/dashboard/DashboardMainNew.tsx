import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { dashboardService } from '@/services/dashboardService'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle, Clock, CheckCircle, TrendingUp, Zap, Calendar, ArrowRight, Eye, ThumbsUp, X } from 'lucide-react'
import { toast } from 'sonner'
import type { DashboardData, UrgentRequest, MyRequestStatus } from '@/types/purchase'
import { useRouter } from 'next/router'

export default function DashboardMainNew() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    loadDashboardData()
  }, [])

  const loadDashboardData = async () => {
    try {
      setLoading(true)
      const supabase = createClient()
      
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: employee } = await supabase
        .from('employees')
        .select('*')
        .eq('email', user.email)
        .single()

      if (!employee) return

      const dashboardData = await dashboardService.getDashboardData(employee)
      setData(dashboardData)
    } catch (error) {
      console.error('Dashboard load error:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleQuickApprove = async (requestId: string) => {
    if (!data?.employee) return

    setActionLoading(requestId)
    try {
      const result = await dashboardService.quickApprove(requestId, data.employee)
      
      if (result.success) {
        toast.success('승인이 완료되었습니다.')
        loadDashboardData() // 데이터 새로고침
      } else {
        toast.error(result.error || '승인 처리 중 오류가 발생했습니다.')
      }
    } catch (error) {
      toast.error('승인 처리 중 오류가 발생했습니다.')
    } finally {
      setActionLoading(null)
    }
  }

  const getPriorityColor = (priority: 'high' | 'medium' | 'low') => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800 border-red-200'
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'low': return 'bg-green-100 text-green-800 border-green-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const getStepColor = (step: string) => {
    switch (step) {
      case 'approval': return 'bg-yellow-100 text-yellow-800'
      case 'purchase': return 'bg-blue-100 text-blue-800'
      case 'delivery': return 'bg-purple-100 text-purple-800'
      case 'completed': return 'bg-green-100 text-green-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  if (loading) {
    return (
      <div className=\"flex items-center justify-center h-screen bg-gray-50\">
        <div className=\"text-center\">
          <div className=\"w-12 h-12 border-3 border-hansl-500 border-t-transparent rounded-full animate-spin mx-auto\" />
          <p className=\"mt-4 text-sm text-gray-600\">대시보드를 불러오고 있습니다...</p>
        </div>
      </div>
    )
  }

  if (!data?.employee) {
    return (
      <div className=\"flex items-center justify-center h-screen bg-gray-50\">
        <div className=\"text-center bg-white p-8 rounded-lg border border-gray-200\">
          <h3 className=\"text-lg font-semibold text-gray-900 mb-2\">사용자 정보를 찾을 수 없습니다</h3>
          <p className=\"text-sm text-gray-600\">로그인을 다시 시도해주세요.</p>
        </div>
      </div>
    )
  }

  return (
    <div className=\"min-h-screen bg-gray-50\">
      <div className=\"max-w-7xl mx-auto p-6\">
        {/* 헤더 */}
        <div className=\"mb-6\">
          <div className=\"flex items-center justify-between\">
            <div>
              <h1 className=\"text-2xl font-bold text-gray-900\">대시보드</h1>
              <p className=\"text-sm text-gray-600 mt-1\">
                {data.employee.name}님, 환영합니다. 📊
              </p>
            </div>
            <div className=\"flex items-center gap-3\">
              <Badge variant=\"outline\" className=\"text-xs\">
                {new Date().toLocaleDateString('ko-KR', { 
                  month: 'long', 
                  day: 'numeric',
                  weekday: 'short'
                })}
              </Badge>
            </div>
          </div>
        </div>

        {/* 긴급 알림 섹션 */}
        {data.urgentRequests.length > 0 && (
          <Card className=\"mb-6 border-red-200 bg-red-50\">
            <CardHeader className=\"pb-3\">
              <CardTitle className=\"flex items-center gap-2 text-red-800\">
                <AlertTriangle className=\"w-5 h-5\" />
                긴급 처리 필요 ({data.urgentRequests.length}건)
              </CardTitle>
            </CardHeader>
            <CardContent className=\"space-y-3\">
              {data.urgentRequests.slice(0, 3).map((request) => (
                <div key={request.id} className=\"bg-white rounded-lg p-4 border border-red-200\">
                  <div className=\"flex items-center justify-between\">
                    <div className=\"flex-1\">
                      <div className=\"flex items-center gap-2 mb-2\">
                        <Badge className={getPriorityColor(request.priority)}>
                          {request.priority === 'high' ? '높음' : request.priority === 'medium' ? '보통' : '낮음'}
                        </Badge>
                        <span className=\"text-sm font-medium text-gray-900\">
                          {request.vendor_name || '업체명 없음'}
                        </span>
                        <span className=\"text-xs text-gray-500\">
                          {request.daysOverdue}일 지연
                        </span>
                      </div>
                      <div className=\"text-sm text-gray-600\">
                        발주요청번호: {request.purchase_order_number || request.id.slice(0, 8)}
                        <span className=\"ml-2\">항목: {request.total_items}개</span>
                      </div>
                    </div>
                    <div className=\"flex gap-2\">
                      <Button
                        size=\"sm\"
                        variant=\"outline\"
                        onClick={() => router.push(`/purchase?highlight=${request.id}`)}
                      >
                        <Eye className=\"w-4 h-4 mr-1\" />
                        보기
                      </Button>
                      <Button
                        size=\"sm\"
                        onClick={() => handleQuickApprove(request.id)}
                        disabled={actionLoading === request.id}
                        className=\"bg-red-600 hover:bg-red-700\"
                      >
                        <ThumbsUp className=\"w-4 h-4 mr-1\" />
                        {actionLoading === request.id ? '처리중...' : '승인'}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* 통계 카드 (간소화) */}
        <div className=\"grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6\">
          <Card className=\"bg-white\">
            <CardContent className=\"p-4\">
              <div className=\"flex items-center justify-between\">
                <div>
                  <p className=\"text-sm text-gray-600\">승인 대기</p>
                  <p className=\"text-2xl font-bold text-red-600\">{data.stats.pending}</p>
                </div>
                <AlertTriangle className=\"w-8 h-8 text-red-500\" />
              </div>
            </CardContent>
          </Card>
          
          <Card className=\"bg-white\">
            <CardContent className=\"p-4\">
              <div className=\"flex items-center justify-between\">
                <div>
                  <p className=\"text-sm text-gray-600\">내 요청</p>
                  <p className=\"text-2xl font-bold text-hansl-600\">{data.stats.myRequests}</p>
                </div>
                <TrendingUp className=\"w-8 h-8 text-hansl-500\" />
              </div>
            </CardContent>
          </Card>

          <Card className=\"bg-white\">
            <CardContent className=\"p-4\">
              <div className=\"flex items-center justify-between\">
                <div>
                  <p className=\"text-sm text-gray-600\">오늘 처리</p>
                  <p className=\"text-2xl font-bold text-blue-600\">{data.stats.todayActions}</p>
                </div>
                <Zap className=\"w-8 h-8 text-blue-500\" />
              </div>
            </CardContent>
          </Card>

          <Card className=\"bg-white\">
            <CardContent className=\"p-4\">
              <div className=\"flex items-center justify-between\">
                <div>
                  <p className=\"text-sm text-gray-600\">이번 달</p>
                  <p className=\"text-2xl font-bold text-green-600\">{data.stats.completed}</p>
                </div>
                <CheckCircle className=\"w-8 h-8 text-green-500\" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 메인 콘텐츠 그리드 */}
        <div className=\"grid grid-cols-1 xl:grid-cols-2 gap-6\">
          {/* 내 요청 현황 */}
          <Card>
            <CardHeader className=\"pb-4\">
              <div className=\"flex items-center justify-between\">
                <CardTitle className=\"text-lg font-semibold\">내 요청 현황</CardTitle>
                <Button 
                  variant=\"ghost\" 
                  size=\"sm\"
                  onClick={() => router.push('/purchase')}
                >
                  전체보기 <ArrowRight className=\"w-4 h-4 ml-1\" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className=\"space-y-4\">
              {data.myRecentRequests.length === 0 ? (
                <div className=\"text-center py-8 text-gray-500\">
                  <Calendar className=\"w-12 h-12 mx-auto mb-4 text-gray-400\" />
                  <p className=\"text-sm\">최근 요청한 발주가 없습니다.</p>
                  <Button 
                    size=\"sm\" 
                    className=\"mt-3\"
                    onClick={() => router.push('/purchase/new')}
                  >
                    새 발주요청
                  </Button>
                </div>
              ) : (
                data.myRecentRequests.map((request) => (
                  <div key={request.id} className=\"border rounded-lg p-4 hover:shadow-sm transition-shadow\">
                    <div className=\"flex items-center justify-between mb-3\">
                      <div className=\"flex items-center gap-2\">
                        <span className=\"font-medium text-sm\">{request.vendor_name}</span>
                        <Badge className={getStepColor(request.current_step)} variant=\"outline\">
                          {request.current_step === 'approval' && '승인 대기'}
                          {request.current_step === 'purchase' && '구매 처리'}
                          {request.current_step === 'delivery' && '입고 대기'}
                          {request.current_step === 'completed' && '완료'}
                        </Badge>
                      </div>
                      <span className=\"text-xs text-gray-500\">
                        {new Date(request.created_at).toLocaleDateString('ko-KR')}
                      </span>
                    </div>
                    
                    <div className=\"mb-3\">
                      <div className=\"flex justify-between text-sm mb-1\">
                        <span className=\"text-gray-600\">진행률</span>
                        <span className=\"font-medium\">{request.progress_percentage}%</span>
                      </div>
                      <div className=\"w-full bg-gray-200 rounded-full h-2\">
                        <div 
                          className=\"bg-hansl-500 h-2 rounded-full transition-all duration-300\"
                          style={{ width: `${request.progress_percentage}%` }}
                        />
                      </div>
                    </div>
                    
                    <div className=\"flex justify-between items-center text-sm\">
                      <span className=\"text-gray-600\">{request.next_action}</span>
                      <span className=\"text-gray-500\">예상 완료: {request.estimated_completion}</span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* 승인 대기 (기존 로직 유지하되 UI 개선) */}
          <Card>
            <CardHeader className=\"pb-4\">
              <div className=\"flex items-center justify-between\">
                <CardTitle className=\"text-lg font-semibold flex items-center gap-2\">
                  승인 대기 항목
                  {data.pendingApprovals.length > 0 && (
                    <Badge variant=\"destructive\" className=\"text-xs\">
                      {data.pendingApprovals.length}
                    </Badge>
                  )}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className=\"space-y-4\">
              {data.pendingApprovals.length === 0 ? (
                <div className=\"text-center py-8 text-gray-500\">
                  <CheckCircle className=\"w-12 h-12 mx-auto mb-4 text-gray-400\" />
                  <p className=\"text-sm\">승인 대기 중인 항목이 없습니다.</p>
                </div>
              ) : (
                data.pendingApprovals.map((approval) => (
                  <div key={approval.id} className=\"border rounded-lg p-4 hover:shadow-sm transition-shadow\">
                    <div className=\"flex items-center justify-between mb-2\">
                      <span className=\"font-medium text-sm\">{approval.requester_name}</span>
                      <span className=\"text-xs text-gray-500\">
                        {new Date(approval.created_at).toLocaleDateString('ko-KR')}
                      </span>
                    </div>
                    <div className=\"text-sm text-gray-600 mb-3\">
                      {approval.vendor_name && <span>업체: {approval.vendor_name}</span>}
                      <span className=\"ml-2\">금액: {approval.total_amount?.toLocaleString()}원</span>
                    </div>
                    <div className=\"flex justify-end gap-2\">
                      <Button
                        size=\"sm\"
                        variant=\"outline\"
                        onClick={() => router.push(`/purchase?highlight=${approval.id}`)}
                      >
                        <Eye className=\"w-4 h-4 mr-1\" />
                        상세보기
                      </Button>
                      <Button
                        size=\"sm\"
                        onClick={() => handleQuickApprove(approval.id)}
                        disabled={actionLoading === approval.id}
                        className=\"bg-green-600 hover:bg-green-700\"
                      >
                        <ThumbsUp className=\"w-4 h-4 mr-1\" />
                        {actionLoading === approval.id ? '처리중...' : '승인'}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* 오늘의 요약 */}
        {(data.todaySummary.approved > 0 || data.todaySummary.requested > 0 || data.todaySummary.received > 0) && (
          <Card className=\"mt-6\">
            <CardHeader>
              <CardTitle className=\"text-lg font-semibold flex items-center gap-2\">
                <Calendar className=\"w-5 h-5\" />
                오늘의 요약
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className=\"grid grid-cols-3 gap-4\">
                <div className=\"text-center\">
                  <div className=\"text-2xl font-bold text-green-600\">{data.todaySummary.approved}</div>
                  <div className=\"text-sm text-gray-600\">승인 완료</div>
                </div>
                <div className=\"text-center\">
                  <div className=\"text-2xl font-bold text-blue-600\">{data.todaySummary.requested}</div>
                  <div className=\"text-sm text-gray-600\">새 요청</div>
                </div>
                <div className=\"text-center\">
                  <div className=\"text-2xl font-bold text-purple-600\">{data.todaySummary.received}</div>
                  <div className=\"text-sm text-gray-600\">입고 완료</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}