import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePurchaseMemory } from "@/hooks/usePurchaseMemory";
import { countPendingApprovalsForSidebarBadge } from "@/utils/purchaseFilters";
import { logger } from "@/lib/logger";

export type TemplateTabKey = "발주/구매" | "카드사용" | "출장" | "차량" | "연차";
export type BadgeCounts = Record<TemplateTabKey, number>;

// ── 공유 배지 스토어 ──────────────────────────────────────────────
// 이 훅은 Navigation / FixedNavigation / RequestListMain 등 여러 곳에서
// 동시에 마운트된다. 인스턴스마다 상태·Realtime 채널을 따로 가지면
//  1) onBadgeRefresh()가 갱신한 상태가 배지를 그리는 다른 인스턴스에 전달되지 않고
//  2) 동일한 채널 토픽을 중복 구독해 기존 구독이 끊긴다(중복 join 시 서버가 이전 채널을 닫음).
// 그래서 카운트 상태와 폴링/Realtime 구독을 모듈 레벨 싱글톤으로 공유한다.
let sharedBadgeCounts: BadgeCounts = {
  "발주/구매": 0,
  "카드사용": 0,
  출장: 0,
  차량: 0,
  연차: 0,
};
const badgeListeners = new Set<() => void>();
const subscribeBadgeStore = (cb: () => void): (() => void) => {
  badgeListeners.add(cb);
  return () => badgeListeners.delete(cb);
};
const getBadgeSnapshot = (): BadgeCounts => sharedBadgeCounts;
function publishBadgeCounts(next: BadgeCounts) {
  const changed = (Object.keys(next) as TemplateTabKey[]).some(
    (k) => next[k] !== sharedBadgeCounts[k]
  );
  if (!changed) return;
  sharedBadgeCounts = next;
  badgeListeners.forEach((l) => l());
}

// 싱글톤 폴링/Realtime 관리 (마운트된 인스턴스가 하나라도 있으면 동작)
let activeLoader: (() => void) | null = null;
let hookInstanceCount = 0;
let pollTimer: number | null = null;
let realtimeChannel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
// 동시 다발 호출(여러 인스턴스 + Realtime 이벤트 버스트) 합치기
let inflightBadgeLoad: Promise<void> | null = null;

const TRIP_APPROVER_ROLES = ["middle_manager", "final_approver", "ceo", "superadmin"];
const HIGH_AMOUNT_APPROVER_ROLES = ["final_approver", "ceo", "superadmin"];

// 부서 매니저 → 승인 가능 부서 매핑 (모바일 Flutter와 동일)
const MANAGER_DEPARTMENT_MAP: Record<string, string[]> = {
  "개발팀_manager": ["개발1팀", "개발2팀"],
  "개발3팀_manager": ["개발3팀"],
  "CAD_manager": ["CAD"],
  "연구소_manager": ["연구소"],
  "경영팀_manager": ["경영팀"],
};
const MANAGER_EXCLUDED_ROLES = ["superadmin", "admin", ...Object.keys(MANAGER_DEPARTMENT_MAP)];

export function useRequestBadgeCounts() {
  const supabase = useMemo(() => createClient(), []);
  const { employee, currentUserRoles } = useAuth();
  const { allPurchases } = usePurchaseMemory();

  const purchasePendingCount = useMemo(
    () => countPendingApprovalsForSidebarBadge(allPurchases, employee?.roles),
    [allPurchases, employee?.roles]
  );

  const badgeCounts = useSyncExternalStore(subscribeBadgeStore, getBadgeSnapshot, getBadgeSnapshot);

  const doLoadBadgeCounts = useCallback(async () => {
    try {
      const isCardVehicleApprover =
        currentUserRoles.includes("superadmin") || currentUserRoles.includes("hr");
      const isTripApprover = currentUserRoles.some((r) => TRIP_APPROVER_ROLES.includes(r));
      const isHighAmountApprover = currentUserRoles.some((r) => HIGH_AMOUNT_APPROVER_ROLES.includes(r));
      // 연차 승인 권한 (모바일과 동일: superadmin, admin, 부서매니저)
      const isSuperAdmin = currentUserRoles.includes("superadmin");
      const isAdminRole = currentUserRoles.includes("admin");
      const managerDepts: string[] = [];
      for (const role of currentUserRoles) {
        if (MANAGER_DEPARTMENT_MAP[role]) {
          managerDepts.push(...MANAGER_DEPARTMENT_MAP[role]);
        }
      }
      const isManager = managerDepts.length > 0;
      const isLeaveApprover = isSuperAdmin || isAdminRole || isManager;

      const [
        cardPendingRes,
        vehiclePendingRes,
        tripPendingRes,
        myTripUnsettledRes,
        leavePendingRes,
      ] = await Promise.all([
        isCardVehicleApprover
          ? supabase.from("card_usages").select("id", { count: "exact", head: true }).eq("approval_status", "pending")
          : Promise.resolve({ count: 0, error: null } as { count: number | null; error: null }),
        isCardVehicleApprover
          ? supabase.from("vehicle_requests").select("id", { count: "exact", head: true }).eq("approval_status", "pending")
          : Promise.resolve({ count: 0, error: null } as { count: number | null; error: null }),
        isTripApprover
          ? supabase.from("business_trips").select("id, expected_total_amount, modification_status", { count: "exact" }).or("approval_status.eq.pending,modification_status.eq.extension_pending")
          : Promise.resolve({ data: [], count: 0, error: null } as { data: Array<{ id: number; expected_total_amount: number }> | null; count: number | null; error: null }),
        supabase
          .from("business_trips")
          .select("id", { count: "exact", head: true })
          .eq("requester_id", employee?.id || "__no_user__")
          .eq("approval_status", "approved")
          .in("settlement_status", ["draft", "submitted", "rejected"]),
        // superadmin/admin: 전체 pending (본인 제외)
        (isSuperAdmin || isAdminRole)
          ? supabase.from("leave").select("id", { count: "exact", head: true }).eq("status", "pending").neq("user_email", employee?.email || "__no_user__")
          // 매니저가 아닌 경우: 본인 pending만
          : !isManager
            ? supabase.from("leave").select("id", { count: "exact", head: true }).eq("user_email", employee?.email || "__no_user__").eq("status", "pending")
            // 매니저: 일단 빈 결과 (아래에서 별도 계산)
            : Promise.resolve({ count: 0, error: null } as { count: number | null; error: null }),
      ]);

      if (
        cardPendingRes.error || vehiclePendingRes.error ||
        tripPendingRes.error || myTripUnsettledRes.error || leavePendingRes.error
      ) {
        throw (
          cardPendingRes.error || vehiclePendingRes.error ||
          tripPendingRes.error || myTripUnsettledRes.error || leavePendingRes.error
        );
      }

      let approvableTripCount = 0;
      if (isTripApprover) {
        const trips = (tripPendingRes.data || []) as Array<{ id: number; expected_total_amount: number; modification_status?: string | null }>;
        if (isHighAmountApprover) {
          approvableTripCount = trips.length;
        } else {
          approvableTripCount = trips.filter((t) => {
            if (t.modification_status === "extension_pending") return true;
            return Number(t.expected_total_amount || 0) < 1_000_000;
          }).length;
        }
      }

      // 매니저인 경우 부서 직원의 pending leave만 카운트 (모바일과 동일)
      let leaveCount = leavePendingRes.count || 0;
      if (isManager && !isSuperAdmin && !isAdminRole) {
        try {
          // 1) 승인 가능 부서의 직원 이메일 조회
          const { data: deptEmps } = await supabase
            .from("employees")
            .select("email, roles")
            .in("department", managerDepts);

          if (deptEmps && deptEmps.length > 0) {
            // 매니저/admin/superadmin 제외한 일반 직원만
            const targetEmails = deptEmps
              .filter((e: { email: string; roles: unknown }) => {
                const empRoles: string[] = Array.isArray(e.roles) ? e.roles : typeof e.roles === "string" ? [e.roles] : [];
                return !MANAGER_EXCLUDED_ROLES.some((r) => empRoles.includes(r));
              })
              .map((e: { email: string }) => e.email)
              .filter((email: string | null): email is string => !!email && email !== employee?.email);

            if (targetEmails.length > 0) {
              const { count } = await supabase
                .from("leave")
                .select("id", { count: "exact", head: true })
                .eq("status", "pending")
                .in("user_email", targetEmails);
              leaveCount = count || 0;
            }
          }
        } catch {
          leaveCount = 0;
        }
      }

      // admin은 스마트팜 부서(superadmin 전용 승인) pending 제외
      if (isAdminRole && !isSuperAdmin && leaveCount > 0) {
        try {
          const { data: sfEmps } = await supabase
            .from("employees")
            .select("email")
            .eq("department", "스마트팜");
          const sfEmails = (sfEmps || [])
            .map((e: { email: string | null }) => e.email)
            .filter((email: string | null): email is string => !!email);
          if (sfEmails.length > 0) {
            const { count: sfCount } = await supabase
              .from("leave")
              .select("id", { count: "exact", head: true })
              .eq("status", "pending")
              .in("user_email", sfEmails);
            leaveCount = Math.max(0, leaveCount - (sfCount || 0));
          }
        } catch {
          // 실패 시 기존 카운트 유지
        }
      }

      publishBadgeCounts({
        "발주/구매": purchasePendingCount,
        "카드사용": isCardVehicleApprover ? cardPendingRes.count || 0 : 0,
        출장: approvableTripCount + (myTripUnsettledRes.count || 0),
        차량: isCardVehicleApprover ? vehiclePendingRes.count || 0 : 0,
        연차: leaveCount,
      });
    } catch (error) {
      logger.error("탭 배지 카운트 조회 실패", error);
    }
  }, [currentUserRoles, employee, purchasePendingCount, supabase]);

  const loadBadgeCounts = useCallback(async () => {
    // 여러 인스턴스/Realtime 이벤트가 동시에 호출해도 조회는 1회로 합침
    if (!inflightBadgeLoad) {
      inflightBadgeLoad = doLoadBadgeCounts().finally(() => {
        inflightBadgeLoad = null;
      });
    }
    return inflightBadgeLoad;
  }, [doLoadBadgeCounts]);

  // 최신 클로저(권한/사용자 반영)를 싱글톤 로더로 등록하고, 입력이 바뀌면 즉시 재계산
  useEffect(() => {
    activeLoader = loadBadgeCounts;
    void loadBadgeCounts();
  }, [loadBadgeCounts]);

  // 폴링 + Realtime 구독은 전체 앱에서 1개만 유지 (첫 마운트에 시작, 마지막 언마운트에 정리)
  useEffect(() => {
    hookInstanceCount += 1;
    if (hookInstanceCount === 1) {
      pollTimer = window.setInterval(() => activeLoader?.(), 30000);
      realtimeChannel = supabase
        .channel("request-badge-realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: "business_trips" }, () => activeLoader?.())
        .on("postgres_changes", { event: "*", schema: "public", table: "card_usages" }, () => activeLoader?.())
        .on("postgres_changes", { event: "*", schema: "public", table: "vehicle_requests" }, () => activeLoader?.())
        .on("postgres_changes", { event: "*", schema: "public", table: "leave" }, () => activeLoader?.())
        .subscribe((status: string) => {
          if (status === "SUBSCRIBED") {
            logger.debug("배지 Realtime 구독 성공");
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            logger.warn("배지 Realtime 구독 이슈", { status });
          }
        });
    }
    return () => {
      hookInstanceCount -= 1;
      if (hookInstanceCount === 0) {
        if (pollTimer !== null) {
          window.clearInterval(pollTimer);
          pollTimer = null;
        }
        if (realtimeChannel) {
          void supabase.removeChannel(realtimeChannel);
          realtimeChannel = null;
        }
        activeLoader = null;
      }
    };
  }, [supabase]);

  return { badgeCounts, loadBadgeCounts };
}
