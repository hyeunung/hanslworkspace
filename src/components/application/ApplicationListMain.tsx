import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FileEdit, ChevronRight, FileText, Check, X, Trash2 } from "lucide-react";
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

const APPLICATION_APPROVER_ROLES = ["hr", "superadmin"];

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
  application_code?: string | null;
  service_name: string;
  plan_name: string | null;
  monthly_cost: string | null;
  application_date: string;
  current_usage_status: string;
  current_model?: string | null;
  current_cost?: string | null;
  usage_purpose?: string | null;
  usage_example?: string | null;
  created_at: string;
  approval_status?: string;
  rejection_reason?: string | null;
  requester_name?: string;
  requester_department?: string | null;
  middle_approved_by?: string | null;
  middle_approved_at?: string | null;
  final_approved_by?: string | null;
  final_approved_at?: string | null;
}

// ── 신청서 상세 모달 ─────────────────────────────────────────
function ApplicationDetailModal({
  app,
  open,
  onClose,
  canApprove,
  onMiddleApprove,
  onFinalApprove,
  onReject,
}: {
  app: AiServiceApplication | null;
  open: boolean;
  onClose: () => void;
  canApprove: boolean;
  onMiddleApprove?: (id: number) => void;
  onFinalApprove?: (id: number) => void;
  onReject?: (id: number) => void;
}) {
  if (!app) return null;

  const getStatusBadgeInModal = (status?: string) => {
    if (!status) return null;
    const map: Record<string, { text: string; cls: string }> = {
      pending: { text: "승인대기", cls: "badge-utk-pending" },
      reviewed: { text: "검토완료", cls: "bg-blue-100 text-blue-700 border border-blue-200" },
      approved: { text: "승인완료", cls: "badge-utk-complete" },
      rejected: { text: "반려", cls: "bg-red-100 text-red-700" },
    };
    const conf = map[status] || { text: status, cls: "bg-gray-100 text-gray-600" };
    return <span className={`badge-stats ${conf.cls}`}>{conf.text}</span>;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between w-full">
            <div>
              <DialogTitle className="modal-title">업무용 AI 서비스 사용 지원 신청서</DialogTitle>
              <p className="text-[10px] text-gray-400 mt-0.5">AI Service Usage Support Application</p>
            </div>
            {app.application_code && (
              <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2.5 py-0.5 rounded border border-gray-200">
                {app.application_code}
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="px-6 py-4 space-y-0">
          {/* 신청자 정보 */}
          <div className="grid grid-cols-3 gap-4 border-b border-gray-100 pb-3 mb-3">
            <div>
              <p className="doc-form-cell-label doc-form-cell-label-title">이름</p>
              <p className="card-title text-gray-900 mt-0.5">{app.requester_name || "-"}</p>
            </div>
            <div>
              <p className="doc-form-cell-label doc-form-cell-label-title">부서</p>
              <p className="card-title text-gray-900 mt-0.5">{app.requester_department || "-"}</p>
            </div>
            <div>
              <p className="doc-form-cell-label doc-form-cell-label-title">신청일</p>
              <p className="card-title text-gray-900 mt-0.5">{format(new Date(app.application_date), "yyyy-MM-dd")}</p>
            </div>
          </div>

          {/* 서비스 정보 */}
          <div className="border-b border-gray-100 pb-3 mb-3">
            <p className="doc-form-cell-label mb-1">서비스명</p>
            <p className="card-title text-gray-900">{app.service_name}</p>
          </div>
          <div className="grid grid-cols-2 gap-4 border-b border-gray-100 pb-3 mb-3">
            <div>
              <p className="doc-form-cell-label mb-1">요금제 (Plan)</p>
              <p className="card-title text-gray-900">{app.plan_name || "-"}</p>
            </div>
            <div>
              <p className="doc-form-cell-label mb-1">월 예상 비용</p>
              <p className="card-title text-gray-900">{app.monthly_cost || "-"}</p>
            </div>
          </div>

          {/* 사용 목적 */}
          <div className="border-b border-gray-100 pb-3 mb-3">
            <p className="doc-form-cell-label mb-1">사용 목적 (업무 활용 용도)</p>
            <p className="text-[11px] text-gray-800 whitespace-pre-wrap leading-relaxed">{app.usage_purpose || "-"}</p>
          </div>

          {/* 활용 사례 */}
          <div className="border-b border-gray-100 pb-3 mb-3">
            <p className="doc-form-cell-label mb-1">활용 예정/실제 사례</p>
            <p className="text-[11px] text-gray-800 whitespace-pre-wrap leading-relaxed">{app.usage_example || "-"}</p>
          </div>

          {/* 현재 사용 여부 */}
          <div className={app.current_usage_status === "paid_personal" ? "border-b border-gray-100 pb-3 mb-3" : "pb-1"}>
            <p className="doc-form-cell-label mb-1">현재 사용 여부</p>
            <p className="card-title text-gray-900">{CURRENT_USAGE_LABELS[app.current_usage_status] || app.current_usage_status}</p>
          </div>

          {/* 유료(개인) 추가 정보 */}
          {app.current_usage_status === "paid_personal" && (
            <div className="grid grid-cols-2 gap-4 pb-1">
              <div>
                <p className="doc-form-cell-label mb-1">사용 중인 모델</p>
                <p className="card-title text-gray-900">{app.current_model || "-"}</p>
              </div>
              <div>
                <p className="doc-form-cell-label mb-1">현재 월 비용</p>
                <p className="card-title text-gray-900">{app.current_cost || "-"}</p>
              </div>
            </div>
          )}

          {/* 반려 사유 */}
          {app.approval_status === "rejected" && app.rejection_reason && (
            <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-100">
              <p className="doc-form-cell-label text-red-600 mb-1">반려 사유</p>
              <p className="text-[11px] text-red-700 whitespace-pre-wrap">{app.rejection_reason}</p>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-3 border-t border-gray-100 bg-gray-50">
          <div className="flex items-center justify-between w-full">
            <div>
              {getStatusBadgeInModal(app.approval_status)}
            </div>
            <div className="flex gap-2">
              {canApprove && onReject && (
                <>
                  {app.approval_status === "pending" && onMiddleApprove && (
                    <Button
                      type="button"
                      onClick={() => { onMiddleApprove(app.id); onClose(); }}
                      className="button-base bg-blue-500 hover:bg-blue-600 text-white"
                    >
                      <Check className="w-3 h-3 mr-0.5" />
                      1차 승인
                    </Button>
                  )}
                  {app.approval_status === "reviewed" && onFinalApprove && (
                    <Button
                      type="button"
                      onClick={() => { onFinalApprove(app.id); onClose(); }}
                      className="button-base bg-green-500 hover:bg-green-600 text-white"
                    >
                      <Check className="w-3 h-3 mr-0.5" />
                      최종 승인
                    </Button>
                  )}
                  {(app.approval_status === "pending" || app.approval_status === "reviewed") && (
                    <Button
                      type="button"
                      onClick={() => { onReject(app.id); onClose(); }}
                      className="button-base border border-red-200 bg-white text-red-600 hover:bg-red-50"
                    >
                      <X className="w-3 h-3 mr-0.5" />
                      반려
                    </Button>
                  )}
                </>
              )}
              <Button
                type="button"
                onClick={onClose}
                className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                닫기
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ApplicationListMain() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentUserRoles, employee, loading: authLoading } = useAuth();
  const canApprove = APPLICATION_APPROVER_ROLES.some((r) => currentUserRoles.includes(r));
  const tabParam = searchParams.get("tab");
  const tabFromUrl = tabParam === "history" ? "history" : (tabParam === "approval" && canApprove) ? "approval" : "write";
  const [activeTab, setActiveTab] = useState(tabFromUrl);

  useEffect(() => {
    if (!authLoading) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl, authLoading]);
  const [applications, setApplications] = useState<AiServiceApplication[]>([]);
  const [allApplications, setAllApplications] = useState<AiServiceApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingPending, setLoadingPending] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [detailModalApp, setDetailModalApp] = useState<AiServiceApplication | null>(null);
  const [statusPopoverId, setStatusPopoverId] = useState<number | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const pendingApplications = allApplications.filter((a) => a.approval_status === "pending" || a.approval_status === "reviewed");

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
        .select("id, application_code, service_name, plan_name, monthly_cost, application_date, current_usage_status, current_model, current_cost, usage_purpose, usage_example, created_at, approval_status, rejection_reason, requester_name, requester_department, middle_approved_by, middle_approved_at, final_approved_by, final_approved_at")
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
        .select("id, application_code, service_name, plan_name, monthly_cost, application_date, current_usage_status, current_model, current_cost, usage_purpose, usage_example, created_at, approval_status, rejection_reason, requester_name, requester_department, middle_approved_by, middle_approved_at, final_approved_by, final_approved_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setAllApplications((data || []) as AiServiceApplication[]);
    } catch (err) {
      logger.error("승인 관리 목록 조회 실패", err);
      setAllApplications([]);
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

  const handleMiddleApprove = useCallback(
    async (appId: number) => {
      if (!employee?.id) return;
      try {
        const supabase = createClient();
        const { error } = await supabase
          .from("ai_service_applications")
          .update({
            approval_status: "reviewed",
            middle_approved_by: employee.id,
            middle_approved_at: new Date().toISOString(),
            rejection_reason: null,
          })
          .eq("id", appId);
        if (error) throw error;
        toast.success("1차 승인(검토완료) 되었습니다.");

        // FCM 알림 전송 (관리자들에게 검토완료 푸시 알림)
        const app = allApplications.find((a) => a.id === appId) || applications.find((a) => a.id === appId);
        supabase.functions.invoke("send_fcm_notification", {
          body: {
            type: "ai_service_reviewed",
            title: "📋 신청서 검토 완료",
            body: `${app?.requester_name || "임직원"}님의 AI 서비스 신청서가 1차 승인(검토완료)되었습니다. 최종 승인을 확인해주세요.`,
            data: {
              application_id: String(appId),
              type: "ai_service",
              status: "reviewed"
            }
          },
        }).catch((e: any) => console.error("FCM 알림 발송 실패:", e));

        setAllApplications((prev) =>
          prev.map((a) => a.id === appId ? { 
            ...a, 
            approval_status: "reviewed", 
            middle_approved_by: employee.id,
            middle_approved_at: new Date().toISOString(),
            rejection_reason: null 
          } : a)
        );
        setStatusPopoverId(null);
      } catch (err) {
        logger.error("1차 승인 처리 실패", err);
        toast.error("1차 승인 처리에 실패했습니다.");
      }
    },
    [employee?.id, allApplications, applications]
  );

  const handleFinalApprove = useCallback(
    async (appId: number) => {
      if (!employee?.id) return;
      try {
        const supabase = createClient();
        const { error } = await supabase
          .from("ai_service_applications")
          .update({
            approval_status: "approved",
            final_approved_by: employee.id,
            final_approved_at: new Date().toISOString(),
            approved_by: employee.id,
            approved_at: new Date().toISOString(),
            rejection_reason: null,
          })
          .eq("id", appId);
        if (error) throw error;
        toast.success("최종 승인되었습니다.");
        setAllApplications((prev) =>
          prev.map((a) => a.id === appId ? { 
            ...a, 
            approval_status: "approved", 
            final_approved_by: employee.id,
            final_approved_at: new Date().toISOString(),
            approved_by: employee.id,
            approved_at: new Date().toISOString(),
            rejection_reason: null 
          } : a)
        );
        setStatusPopoverId(null);
      } catch (err) {
        logger.error("최종 승인 처리 실패", err);
        toast.error("최종 승인 처리에 실패했습니다.");
      }
    },
    [employee?.id]
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
      setAllApplications((prev) =>
        prev.map((a) => a.id === rejectTargetId ? { ...a, approval_status: "rejected", rejection_reason: rejectReason.trim() } : a)
      );
      setRejectModalOpen(false);
      setRejectTargetId(null);
      setRejectReason("");
      setStatusPopoverId(null);
    } catch (err) {
      logger.error("반려 처리 실패", err);
      toast.error("반려 처리에 실패했습니다.");
    }
  }, [rejectTargetId, rejectReason, employee?.id]);

  const openRejectModal = (appId: number) => {
    setRejectTargetId(appId);
    setRejectReason("");
    setRejectModalOpen(true);
  };

  const handleDelete = useCallback(async (appId: number) => {
    if (!confirm("이 신청서를 삭제하시겠습니까?")) return;
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("ai_service_applications")
        .delete()
        .eq("id", appId);
      if (error) throw error;
      toast.success("신청서가 삭제되었습니다.");
      setApplications((prev) => prev.filter((a) => a.id !== appId));
      setAllApplications((prev) => prev.filter((a) => a.id !== appId));
    } catch (err) {
      logger.error("신청서 삭제 실패", err);
      toast.error("삭제에 실패했습니다.");
    }
  }, []);

  const getStatusBadge = (status: string) => {
    const map: Record<string, { text: string; cls: string }> = {
      pending: { text: "승인대기", cls: "badge-utk-pending" },
      reviewed: { text: "검토완료", cls: "badge-stats bg-blue-100 text-blue-700 border border-blue-200" },
      approved: { text: "승인완료", cls: "badge-utk-complete" },
      rejected: { text: "반려", cls: "badge-stats bg-red-100 text-red-700" },
    };
    const conf = map[status] || { text: status, cls: "badge-stats bg-gray-100 text-gray-600" };
    return <span className={`badge-stats ${conf.cls}`}>{conf.text}</span>;
  };

  // 승인 관리용 클릭 가능한 상태 배지 (pending 또는 reviewed일 때만 팝오버)
  const getApprovalStatusCell = (app: AiServiceApplication) => {
    const isActionable = app.approval_status === "pending" || app.approval_status === "reviewed";

    if (!isActionable) {
      return getStatusBadge(app.approval_status || "pending");
    }

    const isOpen = statusPopoverId === app.id;
    const badgeText = app.approval_status === "pending" ? "승인대기 ▾" : "검토완료 ▾";
    const badgeCls = app.approval_status === "pending" ? "badge-utk-pending" : "badge-stats bg-blue-100 text-blue-700 border border-blue-200";

    return (
      <div className="relative inline-block" ref={isOpen ? popoverRef : null}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setStatusPopoverId(isOpen ? null : app.id);
          }}
          className={`badge-stats ${badgeCls} cursor-pointer hover:opacity-80 transition-opacity`}
        >
          {badgeText}
        </button>
        {isOpen && (
          <div
            className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
            style={{ minWidth: "110px" }}
            onClick={(e) => e.stopPropagation()}
          >
            {app.approval_status === "pending" ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleMiddleApprove(app.id); }}
                className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-50 transition-colors"
              >
                <Check className="w-3 h-3" />
                1차 승인
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleFinalApprove(app.id); }}
                className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[11px] font-medium text-green-700 hover:bg-green-50 transition-colors"
              >
                <Check className="w-3 h-3" />
                최종 승인
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setStatusPopoverId(null); openRejectModal(app.id); }}
              className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[11px] font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              <X className="w-3 h-3" />
              반려
            </button>
          </div>
        )}
      </div>
    );
  };

  // 팝오버 외부 클릭 시 닫기
  useEffect(() => {
    if (statusPopoverId === null) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setStatusPopoverId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [statusPopoverId]);

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
                <table className="w-full min-w-[830px] border-collapse">
                  <thead className="sticky top-0 z-30 bg-gray-50" style={{ boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)" }}>
                    <tr>
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center w-[76px]">상태</th>
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[95px]">신청 코드</th>
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[80px]">신청일</th>
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[110px]">서비스명</th>
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[80px]">요금제</th>
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[80px]">월 예상 비용</th>
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[90px]">사용 현황</th>
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left">반려 사유</th>
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center w-[40px]">삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map((app) => (
                      <tr
                        key={app.id}
                        onClick={() => setDetailModalApp(app)}
                        className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
                      >
                        <td className="px-2 py-1.5 text-center whitespace-nowrap">{getStatusBadge(app.approval_status || "pending")}</td>
                        <td className="px-2 py-1.5 card-title whitespace-nowrap font-medium text-gray-900">{app.application_code || "-"}</td>
                        <td className="px-2 py-1.5 card-date whitespace-nowrap">{format(new Date(app.application_date), "yyyy-MM-dd", { locale: ko })}</td>
                        <td className="px-2 py-1.5 card-title truncate max-w-[100px]">{app.service_name}</td>
                        <td className="px-2 py-1.5 card-subtitle truncate max-w-[70px]">{app.plan_name || "-"}</td>
                        <td className="px-2 py-1.5 card-subtitle truncate max-w-[70px]">{app.monthly_cost || "-"}</td>
                        <td className="px-2 py-1.5 card-subtitle whitespace-nowrap">{CURRENT_USAGE_LABELS[app.current_usage_status] || app.current_usage_status}</td>
                        <td className="px-2 py-1.5 card-description text-red-600 truncate max-w-[180px]">{app.approval_status === "rejected" && app.rejection_reason ? app.rejection_reason : "-"}</td>
                        <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => handleDelete(app.id)}
                            className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                            title="삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
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
          ) : allApplications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 bg-white border border-gray-200 rounded-lg business-radius-card">
              <FileText className="w-12 h-12 text-gray-300 mb-4" />
              <p className="card-description text-gray-500">신청 내역이 없습니다.</p>
            </div>
          ) : (
            <div className="overflow-x-auto overflow-y-auto max-h-[70vh] border border-gray-200 rounded-lg bg-white">
              <table className="w-full min-w-[1200px] border-collapse">
                <thead className="sticky top-0 z-30 bg-gray-50" style={{ boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)" }}>
                  <tr>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center w-[95px]">상태</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[95px]">신청 코드</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[80px]">신청일</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[110px]">서비스명</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[60px]">요청자</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[70px]">부서</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[80px]">요금제</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[80px]">월 예상 비용</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[90px]">사용 현황</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[100px]">사용 중인 모델</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[80px]">현재 월 비용</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left">사용 목적</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left">활용 예정/사례</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center w-[40px]">삭제</th>
                  </tr>
                </thead>
                  <tbody>
                  {allApplications.map((app) => (
                    <tr
                      key={app.id}
                      onClick={() => setDetailModalApp(app)}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      <td className="px-2 py-1.5 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {getApprovalStatusCell(app)}
                      </td>
                      <td className="px-2 py-1.5 card-title whitespace-nowrap font-medium text-gray-900">{app.application_code || "-"}</td>
                      <td className="px-2 py-1.5 card-date whitespace-nowrap">{format(new Date(app.application_date), "yyyy-MM-dd", { locale: ko })}</td>
                      <td className="px-2 py-1.5 card-title truncate max-w-[100px]">{app.service_name}</td>
                      <td className="px-2 py-1.5 card-subtitle truncate max-w-[55px]">{app.requester_name || "-"}</td>
                      <td className="px-2 py-1.5 card-subtitle truncate max-w-[65px]">{app.requester_department || "-"}</td>
                      <td className="px-2 py-1.5 card-subtitle truncate max-w-[70px]">{app.plan_name || "-"}</td>
                      <td className="px-2 py-1.5 card-subtitle truncate max-w-[70px]">{app.monthly_cost || "-"}</td>
                      <td className="px-2 py-1.5 card-subtitle whitespace-nowrap">{CURRENT_USAGE_LABELS[app.current_usage_status] || app.current_usage_status}</td>
                      <td className="px-2 py-1.5 card-subtitle truncate max-w-[90px]">
                        {app.current_usage_status === "paid_personal" ? (app.current_model || "-") : <span className="text-gray-300">-</span>}
                      </td>
                      <td className="px-2 py-1.5 card-subtitle truncate max-w-[70px]">
                        {app.current_usage_status === "paid_personal" ? (app.current_cost || "-") : <span className="text-gray-300">-</span>}
                      </td>
                      <td className="px-2 py-1.5 card-subtitle truncate max-w-[150px]">{app.usage_purpose || "-"}</td>
                      <td className="px-2 py-1.5 card-subtitle truncate max-w-[150px]">{app.usage_example || "-"}</td>
                      <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleDelete(app.id)}
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                          title="삭제"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        <ApplicationDetailModal
          app={detailModalApp}
          open={!!detailModalApp}
          onClose={() => setDetailModalApp(null)}
          canApprove={canApprove}
          onMiddleApprove={(id) => { handleMiddleApprove(id); }}
          onFinalApprove={(id) => { handleFinalApprove(id); }}
          onReject={(id) => { openRejectModal(id); }}
        />

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
