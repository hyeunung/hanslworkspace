import { useCallback, useEffect, useMemo, useState } from "react";
import PurchaseListMain from "@/components/purchase/PurchaseListMain";
import CardUsageTab from "@/components/purchase/CardUsageTab";
import BusinessTripTab from "@/components/purchase/BusinessTripTab";
import VehicleTab from "@/components/purchase/VehicleTab";
import AnnualLeaveTab from "@/components/leave/AnnualLeaveTab";
import { useSearchParams } from "react-router-dom";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logger } from "@/lib/logger";
import { usePurchaseMemory } from "@/hooks/usePurchaseMemory";
import { countPendingApprovalsForSidebarBadge } from "@/utils/purchaseFilters";

interface RequestListMainProps {
  showEmailButton?: boolean;
}

type TemplateTabKey = "발주/구매" | "카드사용" | "출장" | "차량" | "연차";
type BadgeCounts = Record<TemplateTabKey, number>;

const TRIP_APPROVER_ROLES = ["middle_manager", "final_approver", "ceo", "superadmin"];
const HIGH_AMOUNT_APPROVER_ROLES = ["final_approver", "ceo", "superadmin"];

const TEMPLATE_TABS: { key: TemplateTabKey; label: string }[] = [
  { key: "발주/구매", label: "발주/구매" },
  { key: "카드사용", label: "카드사용" },
  { key: "출장", label: "출장" },
  { key: "차량", label: "차량" },
  { key: "연차", label: "연차" },
];


export default function RequestListMain({ showEmailButton = true }: RequestListMainProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const { employee, currentUserRoles } = useAuth();
  const { allPurchases } = usePurchaseMemory();

  const purchasePendingCount = useMemo(
    () => countPendingApprovalsForSidebarBadge(allPurchases, employee?.roles),
    [allPurchases, employee?.roles]
  );
  const [badgeCounts, setBadgeCounts] = useState<BadgeCounts>({
    "발주/구매": 0,
    "카드사용": 0,
    출장: 0,
    차량: 0,
    "연차": 0,
  });

  const parseTab = (tab: string | null): TemplateTabKey => {
    if (tab === "카드사용" || tab === "출장" || tab === "차량" || tab === "발주/구매" || tab === "연차") {
      return tab;
    }
    return "발주/구매";
  };

  const [activeTemplateTab, setActiveTemplateTab] = useState<TemplateTabKey>(() =>
    parseTab(searchParams.get("tab"))
  );

  useEffect(() => {
    const tabFromQuery = parseTab(searchParams.get("tab"));
    if (tabFromQuery !== activeTemplateTab) {
      setActiveTemplateTab(tabFromQuery);
    }
  }, [activeTemplateTab, searchParams]);

  const loadBadgeCounts = useCallback(async () => {
    try {
      const isCardVehicleApprover =
        currentUserRoles.includes("superadmin") || currentUserRoles.includes("hr");

      const isTripApprover = currentUserRoles.some((r) => TRIP_APPROVER_ROLES.includes(r));
      const isHighAmountApprover = currentUserRoles.some((r) => HIGH_AMOUNT_APPROVER_ROLES.includes(r));

      const [
        cardPendingRes,
        vehiclePendingRes,
        tripPendingRes,
        myTripUnsettledRes,
        leavePendingRes,
      ] = await Promise.all([
        isCardVehicleApprover
          ? supabase
              .from("card_usages")
              .select("id", { count: "exact", head: true })
              .eq("approval_status", "pending")
          : Promise.resolve({ count: 0, error: null } as { count: number | null; error: null }),
        isCardVehicleApprover
          ? supabase
              .from("vehicle_requests")
              .select("id", { count: "exact", head: true })
              .eq("approval_status", "pending")
          : Promise.resolve({ count: 0, error: null } as { count: number | null; error: null }),
        isTripApprover
          ? supabase
              .from("business_trips")
              .select("id, expected_total_amount", { count: "exact" })
              .eq("approval_status", "pending")
          : Promise.resolve({ data: [], count: 0, error: null } as { data: Array<{ id: number; expected_total_amount: number }> | null; count: number | null; error: null }),
        supabase
          .from("business_trips")
          .select("id", { count: "exact", head: true })
          .eq("requester_id", employee?.id || "__no_user__")
          .eq("approval_status", "approved")
          .in("settlement_status", ["draft", "submitted", "rejected"]),
        supabase
          .from("leave")
          .select("id", { count: "exact", head: true })
          .eq("user_email", employee?.email || "__no_user__")
          .eq("status", "pending"),
      ]);

      if (
        cardPendingRes.error ||
        vehiclePendingRes.error ||
        tripPendingRes.error ||
        myTripUnsettledRes.error ||
        leavePendingRes.error
      ) {
        throw (
          cardPendingRes.error ||
          vehiclePendingRes.error ||
          tripPendingRes.error ||
          myTripUnsettledRes.error ||
          leavePendingRes.error
        );
      }

      let approvableTripCount = 0;
      if (isTripApprover) {
        if (isHighAmountApprover) {
          approvableTripCount = tripPendingRes.count || 0;
        } else {
          approvableTripCount = ((tripPendingRes.data || []) as Array<{ id: number; expected_total_amount: number }>)
            .filter((t) => Number(t.expected_total_amount || 0) < 1_000_000).length;
        }
      }

      const nextCounts: BadgeCounts = {
        "발주/구매": purchasePendingCount,
        "카드사용": isCardVehicleApprover ? cardPendingRes.count || 0 : 0,
        출장: approvableTripCount + (myTripUnsettledRes.count || 0),
        차량: isCardVehicleApprover ? vehiclePendingRes.count || 0 : 0,
        "연차": leavePendingRes.count || 0,
      };

      setBadgeCounts(nextCounts);
    } catch (error) {
      logger.error("RequestListMain 탭 배지 카운트 조회 실패", error);
    }
  }, [currentUserRoles, employee, purchasePendingCount, supabase]);

  useEffect(() => {
    let mounted = true;
    loadBadgeCounts();
    const timer = window.setInterval(() => {
      if (mounted) loadBadgeCounts();
    }, 30000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [loadBadgeCounts]);

  useEffect(() => {
    const channel = supabase
      .channel(`request-list-badge-realtime-${employee?.id || "guest"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "business_trips" },
        () => {
          void loadBadgeCounts();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "card_usages" },
        () => {
          void loadBadgeCounts();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vehicle_requests" },
        () => {
          void loadBadgeCounts();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leave" },
        () => {
          void loadBadgeCounts();
        }
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          logger.debug("RequestListMain 배지 Realtime 구독 성공");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          logger.warn("RequestListMain 배지 Realtime 구독 이슈", { status });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [employee?.id, loadBadgeCounts, supabase]);

  const handleTabChange = (tab: TemplateTabKey) => {
    setActiveTemplateTab(tab);
    setSearchParams({ tab });
  };

  return (
    <div className="w-full">
      <div className="flex space-x-6 border-b border-gray-200 mb-4">
        {TEMPLATE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`pb-2 text-xs font-medium transition-colors relative ${
              activeTemplateTab === tab.key ? "text-hansl-600" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <span>{tab.label}</span>
              {badgeCounts[tab.key] > 0 && (
                <span
                  className="min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full leading-none"
                >
                  {badgeCounts[tab.key]}
                </span>
              )}
            </span>
            {activeTemplateTab === tab.key && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-hansl-600 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {activeTemplateTab === "발주/구매" && <PurchaseListMain showEmailButton={showEmailButton} />}
      {activeTemplateTab === "카드사용" && <CardUsageTab onBadgeRefresh={loadBadgeCounts} />}
      {activeTemplateTab === "출장" && <BusinessTripTab onBadgeRefresh={loadBadgeCounts} />}
      {activeTemplateTab === "차량" && <VehicleTab onBadgeRefresh={loadBadgeCounts} />}
      {activeTemplateTab === "연차" && <AnnualLeaveTab onBadgeRefresh={loadBadgeCounts} />}
    </div>
  );
}
