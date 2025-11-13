// 공통 Excel 다운로드 유틸리티 - 관리탭과 대시보드에서 공유
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()
import { generatePurchaseOrderExcelJS } from '@/utils/exceljs/generatePurchaseOrderExcel'
import type { PurchaseOrderData } from '@/utils/exceljs/generatePurchaseOrderExcel'
import { toast } from 'sonner'

export interface Purchase {
  id?: number
  purchase_order_number: string
  vendor_name: string
  vendor_id?: string
  contact_id?: string
}

/**
 * 공통 Excel 다운로드 함수 - 관리탭과 대시보드 모두에서 사용
 * 관리탭의 handleExcelDownload 로직을 그대로 유틸리티로 분리
 */
export const downloadPurchaseOrderExcel = async (
  purchase: Purchase, 
  currentUserRoles?: string[],
  onSuccessCallback?: () => void
) => {
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
      // 업체 정보 조회 실패 시에도 계속 진행
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
        
        if (!downloadFlagErr) {
          // 성공 콜백 실행 (UI 업데이트용)
          onSuccessCallback?.();
        }
      }
    } catch (flagErr) {
      // 플래그 업데이트 실패는 무시하고 계속 진행
    }
  } catch (error) {
    console.error('❌ Excel 다운로드 실패:', error);
    toast.error('엑셀 다운로드에 실패했습니다.');
    throw error;
  }
};