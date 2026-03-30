import { useEffect, useState } from "react";
import PurchaseListMain from "@/components/purchase/PurchaseListMain";
import CardUsageTab from "@/components/purchase/CardUsageTab";
import BusinessTripTab from "@/components/purchase/BusinessTripTab";
import VehicleTab from "@/components/purchase/VehicleTab";
import AnnualLeaveTab from "@/components/leave/AnnualLeaveTab";
import { useSearchParams } from "react-router-dom";
import { useRequestBadgeCounts, type TemplateTabKey } from "@/hooks/useRequestBadgeCounts";

interface RequestListMainProps {
  showEmailButton?: boolean;
}

const parseTab = (tab: string | null): TemplateTabKey => {
  if (tab === "카드사용" || tab === "출장" || tab === "차량" || tab === "발주/구매" || tab === "연차") {
    return tab;
  }
  return "발주/구매";
};

export default function RequestListMain({ showEmailButton = true }: RequestListMainProps) {
  const [searchParams] = useSearchParams();
  const { loadBadgeCounts } = useRequestBadgeCounts();

  const [activeTemplateTab, setActiveTemplateTab] = useState<TemplateTabKey>(() =>
    parseTab(searchParams.get("tab"))
  );

  useEffect(() => {
    const tabFromQuery = parseTab(searchParams.get("tab"));
    if (tabFromQuery !== activeTemplateTab) {
      setActiveTemplateTab(tabFromQuery);
    }
  }, [activeTemplateTab, searchParams]);

  return (
    <div className="w-full">
      {activeTemplateTab === "발주/구매" && <PurchaseListMain showEmailButton={showEmailButton} />}
      {activeTemplateTab === "카드사용" && <CardUsageTab onBadgeRefresh={loadBadgeCounts} />}
      {activeTemplateTab === "출장" && <BusinessTripTab onBadgeRefresh={loadBadgeCounts} />}
      {activeTemplateTab === "차량" && <VehicleTab onBadgeRefresh={loadBadgeCounts} />}
      {activeTemplateTab === "연차" && <AnnualLeaveTab onBadgeRefresh={loadBadgeCounts} />}
    </div>
  );
}
