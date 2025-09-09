import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function PurchaseHeader() {
  const navigate = useNavigate();
  
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">발주요청 관리</h1>
        <p className="text-gray-600 mt-1">발주요청서를 관리하고 승인 처리를 할 수 있습니다</p>
      </div>
      <Button 
        onClick={() => navigate('/purchase/new')}
        className="mt-4 sm:mt-0 bg-hansl-600 hover:bg-hansl-700"
      >
        <Plus className="w-4 h-4 mr-2" />
        새 발주요청 작성
      </Button>
    </div>
  );
}