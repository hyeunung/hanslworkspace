import { useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { generatePurchaseOrderExcelJS, PurchaseOrderData } from '@/utils/exceljs/generatePurchaseOrderExcel';
import { Purchase } from './usePurchaseData';

export const useExcelDownload = (currentUserRoles: string[], onRefresh: () => void) => {
  const supabase = createClient();

  const handleExcelDownload = useCallback(async (purchase: Purchase) => {
    try {
      // 발주 데이터 조회
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
        .eq('purchase_request_id', purchaseRequest.id)
        .order('id');

      if (itemsError || !orderItems || orderItems.length === 0) {
        toast.error('해당 발주요청번호의 품목 데이터를 찾을 수 없습니다.');
        return;
      }

      // 업체 정보 조회
      const vendorInfo = {
        vendor_name: purchase.vendor_name,
        vendor_phone: '',
        vendor_fax: '',
        vendor_contact_name: '',
        vendor_payment_schedule: ''
      };

      // 업체 상세 정보 조회
      if (purchase.vendor_id) {
        const { data: vendorData } = await supabase
          .from('vendors')
          .select('vendor_phone, vendor_fax, vendor_payment_schedule')
          .eq('id', purchase.vendor_id)
          .single();

        if (vendorData) {
          vendorInfo.vendor_phone = vendorData.vendor_phone || '';
          vendorInfo.vendor_fax = vendorData.vendor_fax || '';
          vendorInfo.vendor_payment_schedule = vendorData.vendor_payment_schedule || '';
        }
      }

      // 담당자 정보 조회
      if (purchase.contact_id) {
        const { data: contactData } = await supabase
          .from('vendor_contacts')
          .select('contact_name')
          .eq('id', purchase.contact_id)
          .single();
          
        if (contactData) {
          vendorInfo.vendor_contact_name = contactData.contact_name || '';
        }
      }

      // Excel 데이터 구성
      const excelData: PurchaseOrderData = {
        purchase_order_number: purchaseRequest.purchase_order_number || '',
        request_date: purchaseRequest.request_date,
        delivery_request_date: purchaseRequest.desired_delivery_date || purchase.delivery_request_date,
        requester_name: purchaseRequest.requester_name || purchase.requester_name,
        vendor_name: vendorInfo.vendor_name,
        vendor_contact_name: vendorInfo.vendor_contact_name,
        vendor_phone: vendorInfo.vendor_phone,
        vendor_fax: vendorInfo.vendor_fax,
        project_vendor: purchase.project_vendor,
        sales_order_number: purchase.sales_order_number,
        project_item: purchase.project_item,
        vendor_payment_schedule: vendorInfo.vendor_payment_schedule,
        items: orderItems.map((item: any, index: number) => ({
          line_number: index + 1,
          item_name: item.item_name,
          specification: item.specification,
          quantity: item.quantity,
          unit_price_value: item.unit_price,
          amount_value: item.amount,
          remark: item.link || '',
          currency: purchaseRequest.currency || 'KRW'
        }))
      };

      // Excel 생성 및 다운로드
      const blob = await generatePurchaseOrderExcelJS(excelData);
      const downloadFilename = `발주서_${excelData.vendor_name}_${excelData.purchase_order_number}.xlsx`;

      // 다운로드 실행
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      toast.success('엑셀 파일이 다운로드되었습니다.');
      
      // DB 플래그 업데이트 (권한이 있는 경우만)
      const isLeadBuyer = currentUserRoles && (
        currentUserRoles.includes('raw_material_manager') || 
        currentUserRoles.includes('consumable_manager') ||
        currentUserRoles.includes('purchase_manager')
      );

      if (isLeadBuyer) {
        const { error: updateError } = await supabase
          .from('purchase_requests')
          .update({ is_po_download: true })
          .eq('purchase_order_number', purchase.purchase_order_number);
          
        if (!updateError) {
          onRefresh();
        }
      }
    } catch (error) {
      toast.error('엑셀 다운로드에 실패했습니다.');
    }
  }, [currentUserRoles, onRefresh]);

  return { handleExcelDownload };
};