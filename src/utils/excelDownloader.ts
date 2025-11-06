import ExcelJS from 'exceljs'
import { toast } from 'sonner'

// 🚀 Excel 다운로드 유틸리티 - DashboardMain에서 분리하여 성능 개선
export const downloadPurchaseOrderExcel = async (purchase: any): Promise<boolean> => {
  try {
    // Excel 파일 생성
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('발주서')
    
    // 헤더 설정
    worksheet.columns = [
      { header: '발주번호', key: 'purchase_order_number', width: 20 },
      { header: '업체명', key: 'vendor_name', width: 30 },
      { header: '품목명', key: 'item_name', width: 40 },
      { header: '규격', key: 'specification', width: 30 },
      { header: '수량', key: 'quantity', width: 15 },
      { header: '단가', key: 'unit_price', width: 20 },
      { header: '금액', key: 'amount', width: 20 },
      { header: '요청일', key: 'request_date', width: 15 },
      { header: '진행상태', key: 'progress_type', width: 15 }
    ]
    
    // 데이터 추가
    const items = purchase.purchase_request_items || []
    items.forEach((item: any) => {
      worksheet.addRow({
        purchase_order_number: purchase.purchase_order_number,
        vendor_name: purchase.vendor_name || purchase.vendors?.vendor_name || '',
        item_name: item.item_name || '',
        specification: item.specification || '',
        quantity: item.quantity || 0,
        unit_price_value: item.unit_price_value || 0,
        amount_value: item.amount_value || 0,
        request_date: purchase.request_date || '',
        progress_type: purchase.progress_type || ''
      })
    })
    
    // 스타일 적용
    worksheet.getRow(1).font = { bold: true }
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    }
    
    // 파일 다운로드
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `발주서_${purchase.purchase_order_number}_${new Date().toISOString().slice(0, 10)}.xlsx`
    link.click()
    window.URL.revokeObjectURL(url)
    
    toast.success('발주서가 다운로드되었습니다.')
    return true
  } catch (error) {
    toast.error('다운로드 중 오류가 발생했습니다.')
    return false
  }
}