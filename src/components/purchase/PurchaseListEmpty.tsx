import { Package } from "lucide-react";

export default function PurchaseListEmpty() {
  return (
    <div className="text-center py-12">
      <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
      <h3 className="text-lg font-semibold text-gray-900 mb-2">발주요청서가 없습니다</h3>
      <p className="text-gray-600">새로운 발주요청서를 작성해보세요.</p>
    </div>
  );
}