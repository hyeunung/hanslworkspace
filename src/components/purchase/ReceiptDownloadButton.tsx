import React from 'react';
import { Download, Eye, FileX } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface ReceiptDownloadButtonProps {
  itemId: number;
  receiptUrl?: string | null;
  itemName: string;
  paymentCategory?: string | null; // 현장결제 여부 확인용
  onUpdate?: () => void;
}

/**
 * 웹앱용 영수증 다운로드 버튼
 * 구매 담당자가 모바일 앱에서 업로드한 영수증을 확인/다운로드할 수 있습니다
 */
export const ReceiptDownloadButton: React.FC<ReceiptDownloadButtonProps> = ({
  itemId,
  receiptUrl,
  itemName,
  paymentCategory,
  onUpdate,
}) => {
  const [isLoading, setIsLoading] = React.useState(false);

  // 현장결제가 아니면 표시 안함
  if (paymentCategory !== '현장 결제' && paymentCategory !== '현장결제') {
    return null;
  }

  /**
   * 영수증 다운로드 핸들러
   */
  const handleDownload = async () => {
    if (!receiptUrl) return;

    setIsLoading(true);

    try {
      // URL에서 파일 경로 추출
      const url = new URL(receiptUrl);
      const pathSegments = url.pathname.split('/');
      const bucketIndex = pathSegments.indexOf('receipt-images');
      
      if (bucketIndex === -1) {
        throw new Error('잘못된 영수증 URL입니다');
      }
      
      const filePath = pathSegments.slice(bucketIndex + 1).join('/');

      console.log('📥 영수증 다운로드 시작:', filePath);

      // Supabase Storage에서 다운로드
      const supabase = createClient();
      const { data, error } = await supabase.storage
        .from('receipt-images')
        .download(filePath);

      if (error) throw error;

      // Blob을 다운로드 가능한 URL로 변환
      const blob = new Blob([data], { type: 'image/jpeg' });
      const downloadUrl = window.URL.createObjectURL(blob);

      // 다운로드 트리거
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `영수증_${itemName}_${itemId}_${Date.now()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // 메모리 해제
      window.URL.revokeObjectURL(downloadUrl);

      console.log('✅ 영수증 다운로드 완료');
      
      // 성공 메시지 (선택적)
      if (typeof window !== 'undefined' && window.alert) {
        alert('✅ 영수증이 다운로드되었습니다.');
      }
    } catch (error) {
      console.error('❌ 영수증 다운로드 오류:', error);
      alert(`❌ 다운로드 실패: ${error instanceof Error ? error.message : error}`);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 영수증 새 탭에서 보기
   */
  const handleViewInNewTab = () => {
    if (!receiptUrl) return;
    window.open(receiptUrl, '_blank', 'noopener,noreferrer');
  };

  /**
   * 영수증 미리보기 모달
   */
  const handlePreview = () => {
    if (!receiptUrl) return;

    // 간단한 모달로 이미지 표시
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.9);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      cursor: pointer;
    `;

    const img = document.createElement('img');
    img.src = receiptUrl;
    img.style.cssText = `
      max-width: 90%;
      max-height: 90%;
      object-fit: contain;
      border-radius: 8px;
    `;

    modal.appendChild(img);
    modal.onclick = () => document.body.removeChild(modal);
    document.body.appendChild(modal);
  };

  // 영수증이 없는 경우
  if (!receiptUrl) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <FileX className="w-4 h-4" />
        <span className="text-sm">영수증 없음</span>
      </div>
    );
  }

  // 영수증이 있는 경우
  return (
    <div className="flex items-center gap-2">
      {/* 미리보기 버튼 */}
      <button
        onClick={handlePreview}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-md transition-colors"
        title="영수증 미리보기"
      >
        <Eye className="w-4 h-4" />
        <span>보기</span>
      </button>

      {/* 다운로드 버튼 */}
      <button
        onClick={handleDownload}
        disabled={isLoading}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-green-500 hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-md transition-colors"
        title="영수증 다운로드"
      >
        <Download className="w-4 h-4" />
        <span>{isLoading ? '다운로드 중...' : '다운로드'}</span>
      </button>
    </div>
  );
};

/**
 * 사용 예시 (발주 상세 모달 - 현장결제만):
 * 
 * import { ReceiptDownloadButton } from '@/components/purchase/ReceiptDownloadButton';
 * 
 * // 현장결제인 경우에만 테이블 컬럼 추가:
 * {purchase.payment_category === '현장 결제' && <TableHead>영수증</TableHead>}
 * 
 * {purchase.payment_category === '현장 결제' && (
 *   <TableCell>
 *     <ReceiptDownloadButton
 *       itemId={item.id}
 *       receiptUrl={item.receipt_image_url}
 *       itemName={item.item_name}
 *       paymentCategory={purchase.payment_category}
 *       onUpdate={() => refetch()}
 *     />
 *   </TableCell>
 * )}
 */

