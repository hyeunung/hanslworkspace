import { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { parseRoles } from "@/utils/roleHelper";
import {
  RefreshCw,
  Trash2,
  CalendarDays,
  FileText,
  Check,
  X,
  User,
} from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";

// ─── 타입 ────────────────────────────────────────────────
interface LeaveRecord {
  id: number;
  user_email: string;
  name: string | null;
  type: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  created_at: string | null;
  department?: string | null;
}

interface AnnualLeaveTabProps {
  onBadgeRefresh?: () => void;
}

// 승인 권한 역할
const LEAVE_APPROVER_ROLES = ["superadmin", "admin"];
// 부서 매니저 맵핑 (모바일과 동일)
const MANAGER_DEPARTMENT_MAP: Record<string, string[]> = {
  "개발팀_manager": ["개발1팀", "개발2팀"],
  "개발3팀_manager": ["개발3팀"],
  "CAD_manager": ["CAD"],
  "연구소_manager": ["연구소"],
  "경영지원팀_manager": ["경영지원팀"],
  "기획팀_manager": ["기획팀"],
};

// ─── 상수 ────────────────────────────────────────────────
const LEAVE_STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "승인대기", color: "text-yellow-700", bg: "bg-yellow-50 border-yellow-200" },
  approved: { label: "승인", color: "text-green-700", bg: "bg-green-50 border-green-200" },
  rejected: { label: "반려", color: "text-red-700", bg: "bg-red-50 border-red-200" },
};

const LEAVE_TYPE_LABEL: Record<string, string> = {
  annual: "연차",
  half_am: "오전반차",
  half_pm: "오후반차",
  official: "공가",
  adjust: "수동조정",
  biztrip: "출장",
};

function formatDateKST(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return format(d, "yyyy.MM.dd", { locale: ko });
}

function getStatusBadge(status: string) {
  const info = LEAVE_STATUS_MAP[status] || LEAVE_STATUS_MAP.pending;
  const bgMap: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-700",
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
  };
  return (
    <span className={`badge-stats ${bgMap[status] || bgMap.pending}`}>
      {info.label}
    </span>
  );
}

// ─── 메인 컴포넌트 ──────────────────────────────────────
export default function AnnualLeaveTab({ onBadgeRefresh }: AnnualLeaveTabProps) {
  const supabase = useMemo(() => createClient(), []);
  const { employee, currentUserEmail, currentUserRoles } = useAuth();

  // ── 뷰 모드: 내 연차 / 승인 관리 ──
  const [viewMode, setViewMode] = useState<"my" | "approval">("my");

  // ── 상태 ──
  const [myLeaves, setMyLeaves] = useState<LeaveRecord[]>([]);
  const [allLeaves, setAllLeaves] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<LeaveRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<LeaveRecord | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // ── 연차 정보 ──
  const remainingLeave = employee?.remaining_annual_leave ?? 0;
  const grantedLeave = employee?.annual_leave_granted_current_year ?? 0;
  const usedLeave = employee?.used_annual_leave ?? 0;

  // ── 권한 체크 (모바일과 동일) ──
  const roles = useMemo(() => parseRoles(employee?.roles), [employee?.roles]);
  const isSuperAdmin = roles.includes("superadmin");
  const isAdmin = roles.includes("admin");
  const isManager = roles.some((r: string) => r.endsWith("_manager"));
  const hasApprovalRole = isSuperAdmin || isAdmin || isManager;

  // 매니저의 승인 가능 부서 목록
  const approvalDepartments = useMemo(() => {
    const depts: string[] = [];
    for (const role of roles) {
      if (MANAGER_DEPARTMENT_MAP[role]) {
        depts.push(...MANAGER_DEPARTMENT_MAP[role]);
      }
    }
    return depts;
  }, [roles]);

  // ── 내 연차 목록 조회 ──
  const loadMyLeaves = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("leave")
        .select("*")
        .eq("user_email", currentUserEmail)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setMyLeaves(data || []);
    } catch (err) {
      logger.error("연차 목록 조회 실패", err);
    }
  }, [currentUserEmail, supabase]);

  // ── 전체 연차 목록 조회 (승인자용 - employees join) ──
  const loadAllLeaves = useCallback(async () => {
    if (!hasApprovalRole) return;
    try {
      // leave + employees join으로 부서 정보 가져오기
      const { data, error } = await supabase
        .from("leave")
        .select("*, employees!leave_user_email_fkey(department, roles)")
        .order("created_at", { ascending: false });

      if (error) {
        // FK join 실패시 leave만 조회
        const { data: fallbackData, error: fallbackError } = await supabase
          .from("leave")
          .select("*")
          .order("created_at", { ascending: false });
        if (fallbackError) throw fallbackError;
        setAllLeaves(fallbackData || []);
        return;
      }

      // employees 조인 데이터 매핑
      const mapped = (data || []).map((l: Record<string, unknown>) => {
        const emp = l.employees as { department?: string; roles?: string[] } | null;
        return {
          ...l,
          department: emp?.department || null,
          _requesterRoles: emp?.roles || [],
        } as LeaveRecord & { _requesterRoles: string[] };
      });

      setAllLeaves(mapped);
    } catch (err) {
      logger.error("전체 연차 목록 조회 실패", err);
    }
  }, [hasApprovalRole, supabase]);

  // ── 데이터 로드 ──
  const loadData = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadMyLeaves(), loadAllLeaves()]);
    setLoading(false);
  }, [loadMyLeaves, loadAllLeaves]);

  useEffect(() => {
    if (currentUserEmail) loadData();
  }, [currentUserEmail, loadData]);

  // ── Realtime 구독 ──
  useEffect(() => {
    const channel = supabase
      .channel(`leave-tab-${employee?.id || "guest"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "leave" }, () => {
        void loadData();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [employee?.id, loadData, supabase]);

  // ── 승인 처리 (Edge Function 호출 - 모바일과 동일) ──
  const handleApprove = useCallback(
    async (leave: LeaveRecord) => {
      try {
        const { error } = await supabase.functions.invoke("update_leave_status", {
          body: { id: leave.id, status: "approved" },
        });
        if (error) throw error;
        toast.success(`${leave.name || ""}님의 ${LEAVE_TYPE_LABEL[leave.type] || leave.type} 신청을 승인했습니다.`);
        await loadData();
        onBadgeRefresh?.();
      } catch (err) {
        logger.error("연차 승인 실패", err);
        toast.error("승인 처리에 실패했습니다.");
      }
    },
    [supabase, loadData, onBadgeRefresh]
  );

  // ── 반려 처리 ──
  const handleReject = useCallback(async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      toast.error("반려 사유를 입력해주세요.");
      return;
    }
    try {
      const { error } = await supabase.functions.invoke("update_leave_status", {
        body: {
          id: rejectTarget.id,
          status: "rejected",
          rejection_reason: rejectReason.trim(),
        },
      });
      if (error) throw error;
      toast.success(`${rejectTarget.name || ""}님의 신청을 반려했습니다.`);
      setRejectTarget(null);
      setRejectReason("");
      await loadData();
      onBadgeRefresh?.();
    } catch (err) {
      logger.error("연차 반려 실패", err);
      toast.error("반려 처리에 실패했습니다.");
    }
  }, [supabase, rejectTarget, rejectReason, loadData, onBadgeRefresh]);

  // ── 삭제 처리 ──
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.functions.invoke("delete_leave", {
        body: { leaveId: deleteTarget.id, userEmail: currentUserEmail },
      });
      if (error) throw error;
      toast.success("연차 신청이 취소되었습니다.");
      await loadData();
      onBadgeRefresh?.();
    } catch (err) {
      logger.error("연차 삭제 실패", err);
      toast.error("연차 취소에 실패했습니다.");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  // ── 승인 가능 여부 체크 (모바일과 동일 로직) ──
  const canApproveLeave = useCallback(
    (leave: LeaveRecord & { _requesterRoles?: string[] }) => {
      if (leave.user_email === currentUserEmail) return false; // 본인 신청 승인 불가
      const requesterRoles = leave._requesterRoles || [];
      const isRequesterSuperAdmin = requesterRoles.includes("superadmin");

      if (isRequesterSuperAdmin) return isSuperAdmin; // superadmin 건은 superadmin만
      if (isSuperAdmin) return true;
      if (isAdmin) return true;
      if (isManager) {
        // 부서 매니저: 자기 부서만 승인 가능 (admin/superadmin/다른 매니저 제외)
        if (requesterRoles.includes("admin") || requesterRoles.includes("superadmin")) return false;
        if (requesterRoles.some((r: string) => r.endsWith("_manager"))) return false;
        return approvalDepartments.includes(leave.department || "");
      }
      return false;
    },
    [currentUserEmail, isSuperAdmin, isAdmin, isManager, approvalDepartments]
  );

  // ── 필터링 ──
  const currentYear = new Date().getFullYear();

  const filteredMyLeaves = useMemo(() => {
    return myLeaves.filter((l) => new Date(l.start_date).getFullYear() === currentYear);
  }, [myLeaves, currentYear]);

  // 승인 관리용: 본인 제외, 권한 범위 내, 올해 기준
  const filteredApprovalLeaves = useMemo(() => {
    if (!hasApprovalRole) return [];
    return allLeaves.filter((l) => {
      if (new Date(l.start_date).getFullYear() !== currentYear) return false;
      if (l.user_email === currentUserEmail) return false;

      const requesterRoles = (l as LeaveRecord & { _requesterRoles?: string[] })._requesterRoles || [];
      const isRequesterSuperAdmin = requesterRoles.includes("superadmin");

      if (isSuperAdmin) return true;
      if (isAdmin) return !isRequesterSuperAdmin;
      if (isManager) {
        if (requesterRoles.includes("admin") || isRequesterSuperAdmin) return false;
        if (requesterRoles.some((r: string) => r.endsWith("_manager"))) return false;
        return approvalDepartments.includes(l.department || "");
      }
      return false;
    });
  }, [allLeaves, currentYear, currentUserEmail, hasApprovalRole, isSuperAdmin, isAdmin, isManager, approvalDepartments]);

  const pendingMyCount = filteredMyLeaves.filter((l) => l.status === "pending").length;
  const pendingApprovalCount = filteredApprovalLeaves.filter((l) => l.status === "pending").length;

  const displayLeaves = viewMode === "my" ? filteredMyLeaves : filteredApprovalLeaves;

  return (
    <div className="space-y-4">
      {/* 상단: 연차 정보 + 탭 전환 + 새로고침 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4 flex-1">
          {/* 내 연차 정보 */}
          <div className="flex items-center gap-4 text-xs">
            <span className="text-gray-500">부여 <strong className="text-gray-900">{grantedLeave}일</strong></span>
            <span className="text-gray-500">사용 <strong className="text-hansl-600">{usedLeave}일</strong></span>
            <span className="text-gray-500">잔여{" "}
              <strong className={remainingLeave <= 0 ? "text-red-600" : "text-green-600"}>
                {remainingLeave}일
              </strong>
            </span>
          </div>

          {/* 내 연차 / 승인 관리 토글 */}
          <div className="flex items-center border border-gray-200 rounded-md overflow-hidden ml-2">
            <button
              onClick={() => setViewMode("my")}
              className={`px-3 py-1 text-[11px] font-medium transition-colors ${
                viewMode === "my"
                  ? "bg-hansl-600 text-white"
                  : "bg-white text-gray-500 hover:bg-gray-50"
              }`}
            >
              내 연차
              {pendingMyCount > 0 && (
                <span className="ml-1 min-w-[16px] h-[16px] px-1 inline-flex items-center justify-center text-[9px] font-bold text-white bg-yellow-500 rounded-full leading-none">
                  {pendingMyCount}
                </span>
              )}
            </button>
            {hasApprovalRole && (
              <button
                onClick={() => setViewMode("approval")}
                className={`px-3 py-1 text-[11px] font-medium transition-colors border-l border-gray-200 ${
                  viewMode === "approval"
                    ? "bg-hansl-600 text-white"
                    : "bg-white text-gray-500 hover:bg-gray-50"
                }`}
              >
                승인 관리
                {pendingApprovalCount > 0 && (
                  <span className="ml-1 min-w-[16px] h-[16px] px-1 inline-flex items-center justify-center text-[9px] font-bold text-white bg-red-500 rounded-full leading-none">
                    {pendingApprovalCount}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={() => loadData()} className="h-8 w-8 p-0">
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-hansl-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : displayLeaves.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-xs">
          <CalendarDays className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>{viewMode === "my" ? "올해 신청된 연차가 없습니다." : "승인 대기중인 연차가 없습니다."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayLeaves.map((leave) => {
            const statusInfo = LEAVE_STATUS_MAP[leave.status] || LEAVE_STATUS_MAP.pending;
            const typeLabel = LEAVE_TYPE_LABEL[leave.type] || leave.type;
            const isSingleDay = leave.start_date === leave.end_date;
            const isMyView = viewMode === "my";
            const isOwnLeave = leave.user_email === currentUserEmail;
            const approvalLeave = leave as LeaveRecord & { _requesterRoles?: string[] };

            return (
              <div
                key={leave.id}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg border ${statusInfo.bg}`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {/* 승인 관리 모드: 신청자 이름 */}
                  {!isMyView && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-800 whitespace-nowrap">
                      <User className="w-3 h-3 text-gray-400" />
                      {leave.name || leave.user_email}
                    </span>
                  )}

                  {/* 유형 뱃지 */}
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-700 whitespace-nowrap">
                    {typeLabel}
                  </span>

                  {/* 날짜 */}
                  <div className="flex items-center gap-1 text-xs text-gray-700">
                    <CalendarDays className="w-3 h-3 text-gray-400 flex-shrink-0" />
                    <span>
                      {formatDateKST(leave.start_date)}
                      {!isSingleDay && ` ~ ${formatDateKST(leave.end_date)}`}
                    </span>
                  </div>

                  {/* 사유 */}
                  {leave.reason && (
                    <div className="flex items-center gap-1 text-xs text-gray-500 truncate max-w-[200px]">
                      <FileText className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{leave.reason}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* 승인 관리 모드: Popover 승인/반려 버튼 (다른 탭과 동일 패턴) */}
                  {!isMyView && leave.status === "pending" && canApproveLeave(approvalLeave) ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="badge-stats bg-orange-500 text-white cursor-pointer hover:bg-orange-600 transition-colors"
                        >
                          승인대기
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-auto p-2 border-gray-200 shadow-lg"
                        align="start"
                        side="bottom"
                        sideOffset={4}
                      >
                        <div className="flex gap-1.5">
                          <Button
                            onClick={() => handleApprove(leave)}
                            className="button-base bg-green-500 hover:bg-green-600 text-white"
                          >
                            <Check className="w-3 h-3 mr-0.5" />
                            승인
                          </Button>
                          <Button
                            onClick={() => {
                              setRejectTarget(leave);
                              setRejectReason("");
                            }}
                            className="button-base border border-red-200 bg-white text-red-600 hover:bg-red-50"
                          >
                            <X className="w-3 h-3 mr-0.5" />
                            반려
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : !isMyView && leave.status === "pending" ? (
                    // 승인 권한 없는 경우
                    <span className="badge-stats bg-yellow-100 text-yellow-700">승인대기</span>
                  ) : isMyView && leave.status === "pending" ? (
                    // 내 연차: 대기중 상태 + 취소 버튼
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] font-semibold ${statusInfo.color}`}>{statusInfo.label}</span>
                      <button
                        onClick={() => setDeleteTarget(leave)}
                        className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    // 승인/반려 완료 상태
                    getStatusBadge(leave.status)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 삭제 확인 다이얼로그 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>연차 신청 취소</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  {LEAVE_TYPE_LABEL[deleteTarget.type] || deleteTarget.type}{" "}
                  ({formatDateKST(deleteTarget.start_date)}
                  {deleteTarget.start_date !== deleteTarget.end_date &&
                    ` ~ ${formatDateKST(deleteTarget.end_date)}`}
                  ) 신청을 취소하시겠습니까?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700">
              {deleting ? "처리중..." : "신청 취소"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 반려 사유 입력 다이얼로그 */}
      <AlertDialog open={!!rejectTarget} onOpenChange={() => setRejectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>연차 신청 반려</AlertDialogTitle>
            <AlertDialogDescription>
              {rejectTarget && (
                <>
                  {rejectTarget.name}님의{" "}
                  {LEAVE_TYPE_LABEL[rejectTarget.type] || rejectTarget.type}{" "}
                  ({formatDateKST(rejectTarget.start_date)}
                  {rejectTarget.start_date !== rejectTarget.end_date &&
                    ` ~ ${formatDateKST(rejectTarget.end_date)}`}
                  ) 신청을 반려합니다.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 pb-2">
            <Textarea
              placeholder="반려 사유를 입력해주세요"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={!rejectReason.trim()}
              className="bg-red-600 hover:bg-red-700"
            >
              반려
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
