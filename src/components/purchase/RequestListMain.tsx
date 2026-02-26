import { useState } from "react";
import PurchaseListMain from "@/components/purchase/PurchaseListMain";
import CardUsageTab from "@/components/purchase/CardUsageTab";
import BusinessTripTab from "@/components/purchase/BusinessTripTab";
import VehicleTab from "@/components/purchase/VehicleTab";

interface RequestListMainProps {
  showEmailButton?: boolean;
}

type TemplateTabKey = "발주/구매" | "카드사용" | "출장" | "차량";

const TEMPLATE_TABS: { key: TemplateTabKey; label: string }[] = [
  { key: "발주/구매", label: "발주/구매" },
  { key: "카드사용", label: "카드사용" },
  { key: "출장", label: "출장" },
  { key: "차량", label: "차량" },
];

export default function RequestListMain({ showEmailButton = true }: RequestListMainProps) {
  const [activeTemplateTab, setActiveTemplateTab] = useState<TemplateTabKey>("발주/구매");

  return (
    <div className="w-full">
      <div className="flex space-x-6 border-b border-gray-200 mb-4">
        {TEMPLATE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTemplateTab(tab.key)}
            className={`pb-2 text-xs font-medium transition-colors relative ${
              activeTemplateTab === tab.key ? "text-hansl-600" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {tab.label}
            {activeTemplateTab === tab.key && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-hansl-600 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {activeTemplateTab === "발주/구매" && <PurchaseListMain showEmailButton={showEmailButton} />}
      {activeTemplateTab === "카드사용" && <CardUsageTab />}
      {activeTemplateTab === "출장" && <BusinessTripTab />}
      {activeTemplateTab === "차량" && <VehicleTab />}
    </div>
  );
}
