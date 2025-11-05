
import { useState, lazy, Suspense, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { usePurchaseData, clearPurchaseCache } from "@/hooks/usePurchaseData";
import { useFastPurchaseFilters } from "@/hooks/useFastPurchaseFilters";
import LazyPurchaseTable from "@/components/purchase/LazyPurchaseTable";

import { Plus, Package } from "lucide-react";
import { generatePurchaseOrderExcelJS, PurchaseOrderData } from "@/utils/exceljs/generatePurchaseOrderExcel";

// Lazy load modal for better performance
const PurchaseItemsModal = lazy(() => import("@/components/purchase/PurchaseItemsModal"));
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// Tabs 컴포넌트를 제거하고 직접 구현 (hanslwebapp 방식)
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Purchase } from "@/hooks/usePurchaseData";
import { measureTabSwitch, measureModalLoad, useRenderPerformance } from "@/utils/performance";

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
  const location = useLocation();
  const supabase = createClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingData, setEditingData] = useState<any>({});
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // 성능 모니터링
  const { measureRender } = useRenderPerformance('PurchaseListMain');
  
  // 발주 데이터 및 사용자 정보
  const {
    purchases,
    vendors,
    employees,
    loading,
    currentUserRoles,
    currentUserName,
    currentUserEmail,
    currentUserId,
    refreshPurchases: loadPurchases,
    updatePurchaseOptimistic
  } = usePurchaseData();
  
  const isAdmin = currentUserRoles?.includes('app_admin');
  

  // 필터링 및 탭 관리
  const {
    activeTab,
    selectedEmployee,
    setActiveTab,
    setSelectedEmployee,
    filteredPurchases,
    tabCounts
  } = useFastPurchaseFilters(purchases, currentUserRoles, currentUserName, currentUserId, currentUserEmail);
  
  // URL 쿼리 파라미터에서 탭 설정
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const tab = searchParams.get('tab');
    if (tab === 'purchase') {
      setActiveTab('purchase');
    }
  }, [location.search, setActiveTab]);
  

  // 상태에 따른 배지 생성 - 메모이제이션 적용
  const getStatusBadge = useCallback((purchase: Purchase) => {
    if (purchase.is_received) {
      return <Badge variant={null} className="badge-success">입고완료</Badge>;
    } else if (purchase.middle_manager_status === 'approved' && purchase.final_manager_status === 'approved') {
      return <Badge variant={null} className="badge-primary">구매진행</Badge>;
    } else if (purchase.middle_manager_status === 'rejected' || purchase.final_manager_status === 'rejected') {
      return <Badge variant={null} className="badge-danger">반려</Badge>;
    } else {
      return <Badge variant={null} className="badge-warning">승인대기</Badge>;
    }
  }, []);

  // 입고 현황 계산
  const getReceiptProgress = (purchase: Purchase) => {
    if (!purchase.items || purchase.items.length === 0) return { received: 0, total: 0, percentage: 0 };
    
    const total = purchase.items.length;
    const received = purchase.items.filter(item => 
      item.actual_received_date !== null && item.actual_received_date !== undefined
    ).length;
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
      const vendorInfo = {
        vendor_name: purchase.vendor_name,
        vendor_phone: '',
        vendor_fax: '',
        vendor_contact_name: ''
      };

      try {
        const vendorId = purchaseRequest.vendor_id || purchase.vendor_id;
        const contactId = purchaseRequest.contact_id || purchase.contact_id;
        
        // vendor 정보 조회
        if (vendorId) {
          const { data: vendorData, error: vendorError } = await supabase
            .from('vendors')
            .select('vendor_phone, vendor_fax')
            .eq('id', vendorId)
            .single();

          if (vendorData && !vendorError) {
            vendorInfo.vendor_phone = vendorData.vendor_phone || '';
            vendorInfo.vendor_fax = vendorData.vendor_fax || '';
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
        vendor_name: vendorInfo.vendor_name || '',
        vendor_contact_name: vendorInfo.vendor_contact_name,
        vendor_phone: vendorInfo.vendor_phone,
        vendor_fax: vendorInfo.vendor_fax,
        project_vendor: purchaseRequest.project_vendor,
        sales_order_number: purchaseRequest.sales_order_number,
        project_item: purchaseRequest.project_item,
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
      
      // DB에 다운로드 완료 플래그(is_po_download) 업데이트 - lead buyer만 해당
      try {
        const isLeadBuyer = currentUserRoles && currentUserRoles.includes('lead buyer');

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

  // 최적화된 핸들러들 - 메모이제이션 및 배치 처리
  const handleReceiptComplete = useCallback(async (purchaseId: number) => {
    try {
      const currentTime = new Date().toISOString();
      
      // 병렬 처리로 성능 개선
      const [requestResult, itemsResult] = await Promise.all([
        supabase
          .from('purchase_requests')
          .update({ 
            is_received: true,
            received_at: currentTime
          })
          .eq('id', purchaseId),
        supabase
          .from('purchase_request_items')
          .update({ 
            is_received: true,
            delivery_status: 'received'
          })
          .eq('purchase_request_id', purchaseId)
      ]);

      if (requestResult.error) throw requestResult.error;
      if (itemsResult.error) throw itemsResult.error;
      
      toast.success('입고완료 처리되었습니다.');
      await loadPurchases();
    } catch (error) {
      toast.error('처리 중 오류가 발생했습니다.');
    }
  }, [supabase, loadPurchases]);

  const handlePaymentComplete = useCallback(async (purchaseId: number) => {
    try {
      const currentTime = new Date().toISOString();
      
      // 병렬 처리로 성능 개선
      const [requestResult, itemsResult] = await Promise.all([
        supabase
          .from('purchase_requests')
          .update({ 
            is_payment_completed: true,
            payment_completed_at: currentTime
          })
          .eq('id', purchaseId),
        supabase
          .from('purchase_request_items')
          .update({ 
            is_payment_completed: true
          })
          .eq('purchase_request_id', purchaseId)
      ]);

      if (requestResult.error) throw requestResult.error;
      if (itemsResult.error) throw itemsResult.error;
      
      toast.success('구매완료 처리되었습니다.');
      await loadPurchases();
    } catch (error) {
      toast.error('처리 중 오류가 발생했습니다.');
    }
  }, [supabase, loadPurchases]);

  const handleItemsClick = useCallback((purchase: Purchase) => {
    measureModalLoad('PurchaseItems', () => {
      setSelectedPurchase(purchase);
      setIsModalOpen(true);
    });
  }, []);
  
  // 모달 데이터 메모이제이션 - 불필요한 재계산 방지
  const modalPurchaseData = useMemo(() => {
    if (!selectedPurchase) return null;
    return {
      ...selectedPurchase,
      vendor_name: selectedPurchase.vendor_name || '',
      project_vendor: selectedPurchase.project_vendor || '',
      sales_order_number: selectedPurchase.sales_order_number || '',
      project_item: selectedPurchase.project_item || ''
    };
  }, [selectedPurchase]);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <h1 className="page-title">발주요청 관리</h1>
          <p className="page-subtitle" style={{marginTop:'-2px',marginBottom:'-4px'}}>Purchase Management</p>
        </div>
        <Button 
          onClick={() => navigate('/purchase/new')}
          className="mt-4 sm:mt-0 bg-hansl-500 hover:bg-hansl-600"
        >
          <Plus className="w-4 h-4 mr-2" />
          새 발주요청 작성
        </Button>
      </div>


      {/* 직접 구현한 탭 (hanslwebapp 방식) - 빠른 성능 */}
      <div className="space-y-3">
        {/* 탭 버튼들 - 모바일 반응형 개선 */}
        <div className="flex flex-col sm:flex-row sm:space-x-1 space-y-1 sm:space-y-0 bg-gray-50 p-1 business-radius-card border border-gray-200">
          {NAV_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => measureTabSwitch(tab.key, () => {
                setActiveTab(tab.key);
                // 탭 변경 시 조용히 최신 데이터 로드 (silent: true로 로딩 스피너 방지)
                loadPurchases(false, { silent: true });
              })}
              className={`flex-1 flex items-center justify-center space-x-2 py-1.5 px-3 sm:px-4 business-radius-button button-text font-medium transition-colors ${
                activeTab === tab.key
                  ? 'text-hansl-600 bg-white shadow-sm border border-gray-200'
                  : 'text-gray-600 bg-transparent hover:text-gray-900 hover:bg-white/50'
              }`}
            >
              <span className="whitespace-nowrap">{tab.label}</span>
              <Badge 
                variant="secondary" 
                className={
                  activeTab === tab.key 
                    ? 'badge-stats-active' 
                    : 'badge-stats-secondary'
                }
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
                <span className="ml-3 card-subtitle">로딩 중...</span>
              </div>
            ) : filteredPurchases.length === 0 ? (
              <div className="text-center py-12">
                <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">발주요청서가 없습니다</h3>
                <p className="card-subtitle">새로운 발주요청서를 작성해보세요.</p>
              </div>
            ) : (
              <LazyPurchaseTable 
                purchases={filteredPurchases} 
                activeTab={activeTab}
                currentUserRoles={currentUserRoles}
                onRefresh={loadPurchases}
                onOptimisticUpdate={updatePurchaseOptimistic}
                onPaymentComplete={handlePaymentComplete}
                onReceiptComplete={handleReceiptComplete}
              />
            )}
          </CardContent>
        </Card>
      </div>
      
      {/* 세부항목 모달 - 성능 최적화된 데이터 사용 */}
      {modalPurchaseData && (
        <Suspense fallback={<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div></div>}>
          <PurchaseItemsModal
            isOpen={isModalOpen}
            onClose={() => {
              setIsModalOpen(false);
              setSelectedPurchase(null);
            }}
            purchase={modalPurchaseData}
            isAdmin={isAdmin || false}
            onUpdate={loadPurchases}
            activeTab={activeTab}
          />
        </Suspense>
      )}
    </div>
  );
}