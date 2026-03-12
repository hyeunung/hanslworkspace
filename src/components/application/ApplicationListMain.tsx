import { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FileEdit, ChevronRight, FileText, Check, X } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { logger } from "@/lib/logger";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
const APPLICATION_APPROVER_ROLES = ["hr", "app_admin"];

const APPLICATION_TYPES = [
  {
    id: "ai-service",
    title: "업무용 AI 서비스 사용 지원 신청서",
    subtitle: "AI Service Usage Support Application",
    href: "/application/ai-service",
  },
  // 추가 신청서 유형은 여기에 등록
];

const CURRENT_USAGE_LABELS: Record<string, string> = {
  free_version: "무료 버전 사용 중",
  paid_personal: "유료(개인) 사용 중",
  not_used: "미사용",
};

interface AiServiceApplication {
  id: number;
  service_name: string;
  plan_name: string | null;
  monthly_cost: string | null;
  application_date: string;
  current_usage_status: string;
  created_at: string;
  approval_status?: string;
  rejection_reason?: string | null;
  requester_name?: string;
  requester_department?: string | null;
}

export default function ApplicationListMain() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentUserRoles, employee } = useAuth();
  const canApprove = APPLICATION_APPROVER_ROLES.some((r) => currentUserRoles.includes(r));
  const tabParam = searchParams.get("tab");
  const tabFromUrl = tabParam === "history" ? "history" : (tabParam === "approval" && canApprove) ? "approval" : "write";
  const [activeTab, setActiveTab] = useState(tabFromUrl);

  useEffect(() => {
    setActiveTab(tabFromUrl);
  }, [tabFromUrl]);
  const [applications, setApplications] = useState<AiServiceApplication[]>([]);
  const [pendingApplications, setPendingApplications] = useState<AiServiceApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingPending, setLoadingPending] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const loadMyApplications = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        setCurrentUserId(null);
        setApplications([]);
        return;
      }

      const { data: emp } = await supabase
        .from("employees")
        .select("id")
        .eq("email", user.email)
        .single();

      if (!emp?.id) {
        setCurrentUserId(null);
        setApplications([]);
        return;
      }

      setCurrentUserId(emp.id);
      setLoading(true);

      const { data, error } = await supabase
        .from("ai_service_applications")
        .select("id, service_name, plan_name, monthly_cost, application_date, current_usage_status, created_at, approval_status, rejection_reason")
        .eq("requester_id", emp.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setApplications((data || []) as AiServiceApplication[]);
    } catch (err) {
      logger.error("내 신청 내역 조회 실패", err);
      setApplications([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPendingApplications = useCallback(async () => {
    if (!canApprove) return;
    try {
      setLoadingPending(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from("ai_service_applications")
        .select("id, service_name, plan_name, monthly_cost, application_date, current_usage_status, created_at, approval_status, rejection_reason, requester_name, requester_department")
        .eq("approval_status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setPendingApplications((data || []) as AiServiceApplication[]);
    } catch (err) {
      logger.error("승인 대기 목록 조회 실패", err);
      setPendingApplications([]);
    } finally {
      setLoadingPending(false);
    }
  }, [canApprove]);

  useEffect(() => {
    if (activeTab === "history") {
      loadMyApplications();
    }
  }, [activeTab, loadMyApplications]);

  useEffect(() => {
    if (activeTab === "approval" && canApprove) {
      loadPendingApplications();
    }
  }, [activeTab, canApprove, loadPendingApplications]);

  const handleApprove = useCallback(
    async (appId: number) => {
      if (!employee?.id) return;
      try {
        const supabase = createClient();
        const { error } = await supabase
          .from("ai_service_applications")
          .update({
            approval_status: "approved",
            approved_by: employee.id,
            approved_at: new Date().toISOString(),
            rejection_reason: null,
          })
          .eq("id", appId);
        if (error) throw error;
        toast.success("승인되었습니다.");
        loadPendingApplications();
      } catch (err) {
        logger.error("승인 처리 실패", err);
        toast.error("승인 처리에 실패했습니다.");
      }
    },
    [employee?.id, loadPendingApplications]
  );

  const handleReject = useCallback(async () => {
    if (!rejectTargetId || !employee?.id) return;
    if (!rejectReason.trim()) {
      toast.error("반려 사유를 입력해 주세요.");
      return;
    }
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("ai_service_applications")
        .update({
          approval_status: "rejected",
          approved_by: employee.id,
          approved_at: new Date().toISOString(),
          rejection_reason: rejectReason.trim(),
        })
        .eq("id", rejectTargetId);
      if (error) throw error;
      toast.success("반려되었습니다.");
      setRejectModalOpen(false);
      setRejectTargetId(null);
      setRejectReason("");
      loadPendingApplications();
    } catch (err) {
      logger.error("반려 처리 실패", err);
      toast.error("반려 처리에 실패했습니다.");
    }
  }, [rejectTargetId, rejectReason, employee?.id, loadPendingApplications]);

  const openRejectModal = (appId: number) => {
    setRejectTargetId(appId);
    setRejectReason("");
    setRejectModalOpen(true);
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { text: string; cls: string }> = {
      pending: { text: "승인대기", cls: "badge-utk-pending" },
      approved: { text: "승인완료", cls: "badge-utk-complete" },
      rejected: { text: "반려", cls: "badge-stats bg-red-100 text-red-700" },
    };
    const conf = map[status] || { text: status, cls: "badge-stats bg-gray-100 text-gray-600" };
    return <span className={`badge-stats ${conf.cls}`}>{conf.text}</span>;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full max-w-none mx-0 px-3 sm:px-4 lg:px-5 pb-6">
        <div className="mb-4">
          <h1 className="page-title text-gray-900">신청서 관리</h1>
          <p className="page-subtitle text-gray-600 mt-1" style={{ marginTop: "-2px", marginBottom: "-4px" }}>
            Application Management
          </p>
        </div>

        <div className="flex space-x-6 border-b border-gray-200 mb-4">
          <button
            type="button"
            onClick={() => { setActiveTab("write"); setSearchParams({}); }}
            className={`pb-2 text-xs font-medium transition-colors relative ${
              activeTab === "write" ? "text-hansl-600" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            신청서 작성
            {activeTab === "write" && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-hansl-600 rounded-full" />
            )}
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab("history"); setSearchParams({ tab: "history" }); }}
            className={`pb-2 text-xs font-medium transition-colors relative ${
              activeTab === "history" ? "text-hansl-600" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            내 신청 내역
            {activeTab === "history" && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-hansl-600 rounded-full" />
            )}
          </button>
          {canApprove && (
            <button
              type="button"
              onClick={() => { setActiveTab("approval"); setSearchParams({ tab: "approval" }); }}
              className={`pb-2 text-xs font-medium transition-colors relative ${
                activeTab === "approval" ? "text-hansl-600" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <span>승인 관리</span>
                {pendingApplications.length > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full leading-none">
                    {pendingApplications.length > 99 ? '99+' : pendingApplications.length}
                  </span>
                )}
              </span>
              {activeTab === "approval" && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-hansl-600 rounded-full" />
              )}
            </button>
          )}
        </div>

        {activeTab === "write" && (
            <>
              {APPLICATION_TYPES.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 bg-white border border-gray-200 rounded-lg business-radius-card">
                  <FileEdit className="w-12 h-12 text-gray-300 mb-4" />
                  <p className="card-description text-gray-500">등록된 신청서가 없습니다.</p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {APPLICATION_TYPES.map((item) => (
                    <Link
                      key={item.id}
                      to={item.href}
                      className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg hover:border-hansl-200 hover:bg-hansl-50/30 transition-colors group business-radius-card"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg bg-hansl-100 text-hansl-600">
                          <FileEdit className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="card-title text-gray-900 truncate">{item.title}</p>
                          <p className="card-subtitle text-gray-500 truncate">{item.subtitle}</p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 flex-shrink-0 text-gray-400 group-hover:text-hansl-600 transition-colors" />
                    </Link>
                  ))}
                </div>
              )}
            </>
        )}

        {activeTab === "history" && (
            loading ? (
              <div className="flex items-center justify-center py-16 bg-white border border-gray-200 rounded-lg business-radius-card">
                <div className="w-8 h-8 border-2 border-hansl-600 border-t-transparent rounded-full animate-spin" />
                <span className="ml-3 text-gray-600">로딩 중...</span>
              </div>
            ) : applications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 bg-white border border-gray-200 rounded-lg business-radius-card">
                <FileText className="w-12 h-12 text-gray-300 mb-4" />
                <p className="card-description text-gray-500">신청 내역이 없습니다.</p>
              </div>
            ) : (
              <div className="overflow-x-auto overflow-y-auto max-h-[70vh] border border-gray-200 rounded-lg bg-white">
                <table className="w-full min-w-[800px] border-collapse">
                  <thead className="sticky top-0 z-30 bg-gray-50" style={{ boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)" }}>
                    <tr>
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center w-[80px]">상태</th>
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[90px]">신청일</th>
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[140px]">서비스명</th>
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[100px]">요금제</th>
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[90px]">월 예상 비용</th>
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[100px]">사용 현황</th>
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left">반려 사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map((app) => (
                      <tr key={app.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-2 py-1.5 text-center whitespace-nowrap">{getStatusBadge(app.approval_status || "pending")}</td>
                        <td className="px-2 py-1.5 card-date whitespace-nowrap">{format(new Date(app.application_date), "yyyy-MM-dd", { locale: ko })}</td>
                        <td className="px-2 py-1.5 card-title truncate max-w-[130px]">{app.service_name}</td>
                        <td className="px-2 py-1.5 card-subtitle truncate max-w-[90px]">{app.plan_name || "-"}</td>
                        <td className="px-2 py-1.5 card-subtitle truncate max-w-[80px]">{app.monthly_cost || "-"}</td>
                        <td className="px-2 py-1.5 card-subtitle whitespace-nowrap">{CURRENT_USAGE_LABELS[app.current_usage_status] || app.current_usage_status}</td>
                        <td className="px-2 py-1.5 card-description text-red-600 truncate max-w-[200px]">{app.approval_status === "rejected" && app.rejection_reason ? app.rejection_reason : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        )}

        {activeTab === "approval" && canApprove && (
          loadingPending ? (
            <div className="flex flex-col items-center justify-center py-16 bg-white border border-gray-200 rounded-lg business-radius-card">
              <div className="w-8 h-8 border-2 border-hansl-600 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-gray-600">로딩 중...</span>
            </div>
          ) : pendingApplications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 bg-white border border-gray-200 rounded-lg business-radius-card">
              <FileText className="w-12 h-12 text-gray-300 mb-4" />
              <p className="card-description text-gray-500">승인 대기 신청이 없습니다.</p>
            </div>
          ) : (
            <div className="overflow-x-auto overflow-y-auto max-h-[70vh] border border-gray-200 rounded-lg bg-white">
              <table className="w-full min-w-[900px] border-collapse">
                <thead className="sticky top-0 z-30 bg-gray-50" style={{ boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)" }}>
                  <tr>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center w-[80px]">상태</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[90px]">신청일</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[140px]">서비스명</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[76px]">요청자</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[90px]">부서</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[100px]">요금제</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[90px]">월 예상 비용</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[100px]">사용 현황</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center w-[120px]">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingApplications.map((app) => (
                    <tr key={app.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-2 py-1.5 text-center whitespace-nowrap">{getStatusBadge("pending")}</td>
                      <td className="px-2 py-1.5 card-date whitespace-nowrap">{format(new Date(app.application_date), "yyyy-MM-dd", { locale: ko })}</td>
                      <td className="px-2 py-1.5 card-title truncate max-w-[130px]">{app.service_name}</td>
                      <td className="px-2 py-1.5 card-subtitle truncate max-w-[70px]">{app.requester_name || "-"}</td>
                      <td className="px-2 py-1.5 card-subtitle truncate max-w-[80px]">{app.requester_department || "-"}</td>
                      <td className="px-2 py-1.5 card-subtitle truncate max-w-[90px]">{app.plan_name || "-"}</td>
                      <td className="px-2 py-1.5 card-subtitle truncate max-w-[80px]">{app.monthly_cost || "-"}</td>
                      <td className="px-2 py-1.5 card-subtitle whitespace-nowrap">{CURRENT_USAGE_LABELS[app.current_usage_status] || app.current_usage_status}</td>
                      <td className="px-2 py-1.5 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <Button
                            type="button"
                            onClick={() => handleApprove(app.id)}
                            className="button-base bg-green-500 hover:bg-green-600 text-white"
                          >
                            <Check className="w-3 h-3 mr-0.5" />
                            승인
                          </Button>
                          <Button
                            type="button"
                            onClick={() => openRejectModal(app.id)}
                            className="button-base border border-red-200 bg-white text-red-600 hover:bg-red-50"
                          >
                            <X className="w-3 h-3 mr-0.5" />
                            반려
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        <Dialog
          open={rejectModalOpen}
          onOpenChange={(open) => {
            setRejectModalOpen(open);
            if (!open) {
              setRejectTargetId(null);
              setRejectReason("");
            }
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>반려 사유 입력</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="reject-reason" className="modal-label">
                반려 사유를 입력해 주세요. (필수)
              </Label>
              <Textarea
                id="reject-reason"
                placeholder="예: 예산 부족, 사용 목적 불명확 등"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={4}
                className="business-radius-input"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => { setRejectModalOpen(false); setRejectTargetId(null); setRejectReason(""); }}
                className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                취소
              </Button>
              <Button
                type="button"
                onClick={handleReject}
                disabled={!rejectReason.trim()}
                className="button-base bg-red-500 hover:bg-red-600 text-white disabled:opacity-50"
              >
                반려
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
