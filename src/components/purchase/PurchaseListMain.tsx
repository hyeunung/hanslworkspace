
import { useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { usePurchaseData } from "@/hooks/usePurchaseData";
import { useFastPurchaseFilters } from "@/hooks/useFastPurchaseFilters";
import FastPurchaseTable from "@/components/purchase/FastPurchaseTable";

import { Search, Filter, Plus, Package } from "lucide-react";
import { generatePurchaseOrderExcelJS, PurchaseOrderData } from "@/utils/exceljs/generatePurchaseOrderExcel";
import { Input } from "@/components/ui/input";
import PurchaseItemsModal from "@/components/purchase/PurchaseItemsModal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// Tabs 컴포넌트를 제거하고 직접 구현 (hanslwebapp 방식)
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { format } from "date-fns";
import { toast } from "sonner";

// 발주(구매) 데이터의 타입 정의
interface Purchase {
  id: number;
  purchase_order_number?: string;
  request_date: string;
  delivery_request_date?: string;
  progress_type: string;
  is_payment_completed: boolean;
  payment_category: string;
  currency: string;
  request_type: string;
  vendor_name: string;
  vendor_id?: number;
  contact_id?: number;
  requester_name: string;
  project_vendor: string;
  sales_order_number: string;
  project_item: string;
  middle_manager_status?: string;
  final_manager_status?: string;
  total_amount: number;
  is_received: boolean;

  is_po_download?: boolean;
  items?: any[];
}

interface PurchaseListMainProps {
  onEmailToggle?: () => void;
  showEmailButton?: boolean;
}

// 화면 상단의 탭(진행상태별) 목록
const NAV_TABS: { key: string; label: string }[] = [
  { key: 'pending', label: '승인대기' },
  { key: 'purchase', label: '구매 현황' },
  { key: 'receipt', label: '입고 현황' },
  { key: 'done', label: '전체 항목' },
];

// 발주 목록 메인 컴포넌트
export default function PurchaseListMain({ onEmailToggle, showEmailButton = true }: PurchaseListMainProps) {
  const navigate = useNavigate();
  const supabase = createClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingData, setEditingData] = useState<any>({});
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // 발주 데이터 및 사용자 정보
  const {
    purchases,
    vendors,
    employees,
    loading,
    currentUserRoles,
    currentUserName,
    refreshPurchases: loadPurchases
  } = usePurchaseData();
  
  const isAdmin = currentUserRoles?.includes('app_admin');

  // 필터링 및 탭 관리
  const {
    activeTab,
    searchTerm,
    vendorFilter,
    dateFromFilter,
    dateToFilter,
    selectedEmployee,
    purchaseNumberFilter,
    itemNameFilter,
    specificationFilter,
    approvalStatusFilter,
    remarkFilter,
    setActiveTab,
    setSearchTerm,
    setVendorFilter,
    setDateFromFilter,
    setDateToFilter,
    setSelectedEmployee,
    setPurchaseNumberFilter,
    setItemNameFilter,
    setSpecificationFilter,
    setApprovalStatusFilter,
    setRemarkFilter,
    filteredPurchases,
    tabCounts
  } = useFastPurchaseFilters(purchases, currentUserRoles, currentUserName);
  

  // 상태에 따른 배지 생성
  const getStatusBadge = (purchase: Purchase) => {
    if (purchase.is_received) {
      return <Badge className="bg-green-50 text-green-700">입고완료</Badge>;
    } else if (purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'approved') {
      return <Badge className="bg-hansl-50 text-hansl-700">구매진행</Badge>;
    } else if (purchase.middle_manager_status === 'rejected' || purchase.final_manager_status === 'rejected') {
      return <Badge className="bg-red-50 text-red-700">반려</Badge>;
    } else {
      return <Badge className="bg-yellow-50 text-yellow-700">승인대기</Badge>;
    }
  };

  // 입고 현황 계산
  const getReceiptProgress = (purchase: Purchase) => {
    if (!purchase.items || purchase.items.length === 0) return { received: 0, total: 0, percentage: 0 };
    
    const total = purchase.items.length;
    const received = purchase.items.filter(item => item.is_received || item.delivery_status === 'received').length;
    const percentage = total > 0 ? Math.round((received / total) * 100) : 0;
    
    return { received, total, percentage };
  };

  // 선진행 체크 함수
  const isAdvancePayment = (progress_type?: string) => {
    return progress_type === '선진행' || progress_type?.trim() === '선진행' || progress_type?.includes('선진행');
  };

  // 편집 시작
  const handleEditStart = (purchase: Purchase) => {
    if (!currentUserRoles || !currentUserRoles.includes('app_admin')) return;
    setEditingId(purchase.id);
    setEditingData({
      vendor_name: purchase.vendor_name,
      project_vendor: purchase.project_vendor,
      sales_order_number: purchase.sales_order_number,
      project_item: purchase.project_item,
      delivery_request_date: purchase.delivery_request_date ? 
        purchase.delivery_request_date.split('T')[0] : '',
      total_amount: purchase.total_amount,
    });
  };

  // 편집 저장
  const handleEditSave = async () => {
    if (!currentUserRoles || !currentUserRoles.includes('app_admin') || !editingId) return;
    
    try {
      const { error } = await supabase
        .from('purchase_requests')
        .update(editingData)
        .eq('id', editingId);

      if (error) throw error;

      toast.success('수정이 완료되었습니다.');
      setEditingId(null);
      setEditingData({});
      await loadPurchases();
    } catch (error) {
      toast.error('수정 중 오류가 발생했습니다.');
    }
  };

  // 편집 취소
  const handleEditCancel = () => {
    setEditingId(null);
    setEditingData({});
  };

  // 엑셀 다운로드
  const handleExcelDownload = async (purchase: Purchase) => {
    try {
      // DB에서 직접 모든 품목 조회
      const { data: purchaseRequest, error: requestError } = await supabase
        .from('purchase_requests')
        .select('*')
        .eq('purchase_order_number', purchase.purchase_order_number)
        .single();

      if (requestError || !purchaseRequest) {
        toast.error('해당 발주요청번호의 데이터를 찾을 수 없습니다.');
        return;
      }

      // 품목 데이터 조회
      const { data: orderItems, error: itemsError } = await supabase
        .from('purchase_request_items')
        .select('*')
        .eq('purchase_order_number', purchase.purchase_order_number)
        .order('line_number');

      if (itemsError || !orderItems || orderItems.length === 0) {
        toast.error('해당 발주요청번호의 품목 데이터를 찾을 수 없습니다.');
        return;
      }

      // 업체 상세 정보 및 담당자 정보 조회
      let vendorInfo = {
        vendor_name: purchase.vendor_name,
        vendor_phone: '',
        vendor_fax: '',
        vendor_contact_name: '',
        vendor_payment_schedule: ''
      };

      try {
        const vendorId = purchaseRequest.vendor_id || purchase.vendor_id;
        const contactId = purchaseRequest.contact_id || purchase.contact_id;
        
        // vendor 정보 조회
        if (vendorId) {
          const { data: vendorData, error: vendorError } = await supabase
            .from('vendors')
            .select('vendor_phone, vendor_fax, vendor_payment_schedule')
            .eq('id', vendorId)
            .single();

          if (vendorData && !vendorError) {
            vendorInfo.vendor_phone = vendorData.vendor_phone || '';
            vendorInfo.vendor_fax = vendorData.vendor_fax || '';
            vendorInfo.vendor_payment_schedule = vendorData.vendor_payment_schedule || '';
          }
        }

        // vendor_contacts에서 contact_id로 담당자 정보 조회
        if (contactId) {
          const { data: contactData, error: contactError } = await supabase
            .from('vendor_contacts')
            .select('contact_name, contact_phone, contact_email')
            .eq('id', contactId)
            .single();
          if (contactData && !contactError) {
            vendorInfo.vendor_contact_name = contactData.contact_name || '';
          }
        }
      } catch (error) {
      }

      const excelData: PurchaseOrderData = {
        purchase_order_number: purchaseRequest.purchase_order_number || '',
        request_date: purchaseRequest.request_date,
        delivery_request_date: purchaseRequest.delivery_request_date,
        requester_name: purchaseRequest.requester_name,
        vendor_name: vendorInfo.vendor_name,
        vendor_contact_name: vendorInfo.vendor_contact_name,
        vendor_phone: vendorInfo.vendor_phone,
        vendor_fax: vendorInfo.vendor_fax,
        project_vendor: purchaseRequest.project_vendor,
        sales_order_number: purchaseRequest.sales_order_number,
        project_item: purchaseRequest.project_item,
        vendor_payment_schedule: vendorInfo.vendor_payment_schedule,
        items: orderItems.map((item: any) => ({
          line_number: item.line_number,
          item_name: item.item_name,
          specification: item.specification,
          quantity: item.quantity,
          unit_price_value: item.unit_price_value,
          amount_value: item.amount_value,
          remark: item.remark,
          currency: purchaseRequest.currency || 'KRW'
        }))
      };

      // 코드 기반 ExcelJS 생성 (템플릿 없이 서식 직접 정의)
      const blob = await generatePurchaseOrderExcelJS(excelData);
      
      // 다운로드용 파일명: 발주서_{업체명}_발주요청번호
      const downloadFilename = `발주서_${excelData.vendor_name}_${excelData.purchase_order_number}.xlsx`;

      // 사용자에게 즉시 다운로드 제공
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      toast.success('엑셀 파일이 다운로드되었습니다.');
      
      // DB에 다운로드 완료 플래그(is_po_download) 업데이트 - raw_material_manager/consumable_manager만 해당
      try {
        const isLeadBuyer = currentUserRoles && (
          currentUserRoles.includes('raw_material_manager') || 
          currentUserRoles.includes('consumable_manager') ||
          currentUserRoles.includes('purchase_manager')
        );

        if (isLeadBuyer) {
          const { error: downloadFlagErr } = await supabase
            .from('purchase_requests')
            .update({ is_po_download: true })
            .eq('purchase_order_number', purchase.purchase_order_number);
          if (downloadFlagErr) {
          } else {
            // 화면 업데이트
            await loadPurchases();
          }
        }
      } catch (flagErr) {
      }
    } catch (error) {
      toast.error('엑셀 다운로드에 실패했습니다.');
    }
  };

  // 최적화된 핸들러들
  const handleReceiptComplete = async (purchaseId: number) => {
    try {
      const { error } = await supabase
        .from('purchase_requests')
        .update({ 
          is_received: true,
          received_at: new Date().toISOString()
        })
        .eq('id', purchaseId);

      if (error) throw error;
      
      // 개별 품목도 모두 입고완료 처리
      await supabase
        .from('purchase_request_items')
        .update({ 
          is_received: true,
          delivery_status: 'received'
        })
        .eq('purchase_request_id', purchaseId);
      
      toast.success('입고완료 처리되었습니다.');
      await loadPurchases();
    } catch (error) {
      toast.error('처리 중 오류가 발생했습니다.');
    }
  };

  const handlePaymentComplete = async (purchaseId: number) => {
    try {
      const { error } = await supabase
        .from('purchase_requests')
        .update({ 
          is_payment_completed: true,
          payment_completed_at: new Date().toISOString()
        })
        .eq('id', purchaseId);

      if (error) throw error;
      
      toast.success('구매완료 처리되었습니다.');
      await loadPurchases();
    } catch (error) {
      toast.error('처리 중 오류가 발생했습니다.');
    }
  };

  const handleItemsClick = (purchase: Purchase) => {
    setSelectedPurchase(purchase);
    setIsModalOpen(true);
  };

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">발주요청 관리</h1>
          <p className="text-sm text-gray-600 mt-1">발주요청서를 관리하고 승인 처리를 할 수 있습니다</p>
        </div>
        <Button 
          onClick={() => navigate('/purchase/new')}
          className="mt-4 sm:mt-0 bg-hansl-500 hover:bg-hansl-600"
        >
          <Plus className="w-4 h-4 mr-2" />
          새 발주요청 작성
        </Button>
      </div>

      {/* 필터 섹션 */}
      <Card className="mb-4 border border-gray-200">
        <CardHeader className="bg-white border-b border-gray-200 py-3">
          <CardTitle className="flex items-center text-gray-900 text-sm font-medium">
            <Filter className="w-4 h-4 mr-2" />
            검색 필터
          </CardTitle>
        </CardHeader>
        <CardContent className="py-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">시작일</label>
              <Input
                type="date"
                value={dateFromFilter}
                onChange={(e) => setDateFromFilter(e.target.value)}
                className="text-sm h-9"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">종료일</label>
              <Input
                type="date"
                value={dateToFilter}
                onChange={(e) => setDateToFilter(e.target.value)}
                className="text-sm h-9"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">요청자</label>
              <Select 
                value={selectedEmployee || currentUserName || "all"} 
                onValueChange={(value) => setSelectedEmployee(value === "all" ? "" : value)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder={currentUserName || "선택"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  {employees
                    .filter(emp => emp.full_name && emp.full_name.trim() !== '')
                    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
                    .map((employee) => (
                      <SelectItem key={employee.id} value={employee.full_name || ''}>
                        {employee.full_name}
                        {employee.full_name === currentUserName && " (나)"}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">업체</label>
              <Select value={vendorFilter || "all"} onValueChange={(value) => setVendorFilter(value === "all" ? "" : value)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="전체" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  {vendors.map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.vendor_name}>
                      {vendor.vendor_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">발주번호</label>
              <Input
                placeholder="번호"
                value={purchaseNumberFilter}
                onChange={(e) => setPurchaseNumberFilter(e.target.value)}
                className="text-sm h-9"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">품명</label>
              <Input
                placeholder="품명"
                value={itemNameFilter}
                onChange={(e) => setItemNameFilter(e.target.value)}
                className="text-sm h-9"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">승인상태</label>
              <Select 
                value={approvalStatusFilter || "all"} 
                onValueChange={(value) => setApprovalStatusFilter(value === "all" ? "" : value)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="전체" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  <SelectItem value="pending">대기</SelectItem>
                  <SelectItem value="approved">승인</SelectItem>
                  <SelectItem value="rejected">반려</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">통합검색</label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400" />
                <Input
                  placeholder="검색..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-7 text-sm h-9"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 직접 구현한 탭 (hanslwebapp 방식) - 빠른 성능 */}
      <div className="space-y-3">
        {/* 탭 버튼들 */}
        <div className="flex space-x-1 bg-gray-50 p-1 rounded-lg border border-gray-200">
          {NAV_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center space-x-2 py-2.5 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'text-hansl-600 bg-white shadow-sm border border-gray-200'
                  : 'text-gray-600 bg-transparent hover:text-gray-900 hover:bg-white/50'
              }`}
            >
              <span>{tab.label}</span>
              <Badge 
                variant="secondary" 
                className={`text-xs ${
                  activeTab === tab.key 
                    ? 'bg-hansl-50 text-hansl-700' 
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {tabCounts[tab.key as keyof typeof tabCounts]}
              </Badge>
            </button>
          ))}
        </div>

        {/* 탭 콘텐츠 */}
        <Card className="overflow-hidden border border-gray-200">
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-hansl-500 border-t-transparent rounded-full animate-spin" />
                <span className="ml-3 text-gray-600">로딩 중...</span>
              </div>
            ) : filteredPurchases.length === 0 ? (
              <div className="text-center py-12">
                <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">발주요청서가 없습니다</h3>
                <p className="text-gray-600">새로운 발주요청서를 작성해보세요.</p>
              </div>
            ) : (
              <FastPurchaseTable 
                purchases={filteredPurchases} 
                activeTab={activeTab}
                currentUserRoles={currentUserRoles}
                onRefresh={loadPurchases}
              />
            )}
          </CardContent>
        </Card>
      </div>
      
      {/* 세부항목 모달 */}
      {selectedPurchase && (
        <PurchaseItemsModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedPurchase(null);
          }}
          purchase={selectedPurchase}
          isAdmin={isAdmin || false}
          onUpdate={loadPurchases}
        />
      )}
    </div>
  );
}