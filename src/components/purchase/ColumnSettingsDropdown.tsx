import React, { memo, useState, useEffect } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Settings, RotateCcw, Eye, EyeOff, Check, X } from 'lucide-react';
import { COLUMN_GROUPS, REQUIRED_COLUMNS, RESTRICTED_COLUMNS, AUTHORIZED_ROLES } from '@/constants/columnSettings';
import { DoneTabColumnId, ColumnVisibility } from '@/types/columnSettings';
import { Skeleton } from '@/components/ui/skeleton';

interface ColumnSettingsDropdownProps {
  /**
   * 전체항목 탭에서만 표시되는지 여부
   */
  isVisible?: boolean;
  /**
   * 추가 CSS 클래스
   */
  className?: string;
  /**
   * 칼럼 가시성 상태
   */
  columnVisibility: ColumnVisibility;
  /**
   * 칼럼 설정 적용 함수
   */
  applyColumnSettings: (newSettings: ColumnVisibility) => void;
  /**
   * 기본값 재설정 함수
   */
  resetToDefault: () => void;
  /**
   * 로딩 상태
   */
  isLoading?: boolean;
  /**
   * 현재 사용자 역할
   */
  currentUserRoles?: string[];
}

/**
 * 전체항목 탭 칼럼 설정 드롭다운 컴포넌트
 * - 칼럼 토글 기능
 * - 그룹별 칼럼 관리
 * - 기본값 재설정
 * - 필수 칼럼 보호
 */
const ColumnSettingsDropdown: React.FC<ColumnSettingsDropdownProps> = memo(({
  isVisible = true,
  className = '',
  columnVisibility,
  applyColumnSettings,
  resetToDefault,
  isLoading = false,
  currentUserRoles = []
}) => {
  
  // 임시 선택 상태 (드롭다운 내에서만 사용)
  const [tempVisibility, setTempVisibility] = useState<ColumnVisibility>(columnVisibility);
  const [isOpen, setIsOpen] = useState(false);
  
  // 권한 체크 헬퍼
  const hasPermissionForColumn = (columnId: DoneTabColumnId): boolean => {
    if (!RESTRICTED_COLUMNS.includes(columnId)) return true;
    return currentUserRoles.some(role => AUTHORIZED_ROLES.includes(role));
  };

  // 드롭다운이 열릴 때마다 현재 상태로 초기화
  useEffect(() => {
    if (isOpen) {
      setTempVisibility(columnVisibility);
    }
  }, [isOpen, columnVisibility]);

  // 전체항목 탭이 아닌 경우 숨김
  if (!isVisible) {
    return null;
  }

  // 표시된 칼럼 수 계산
  const visibleColumnCount = Object.values(columnVisibility).filter(Boolean).length;
  const totalColumnCount = Object.keys(columnVisibility).length;
  const tempVisibleCount = Object.values(tempVisibility).filter(Boolean).length;

  // 칼럼 토글 핸들러 (임시 상태 변경)
  const handleColumnToggle = (columnId: DoneTabColumnId) => {
    // 필수 칼럼은 비활성화할 수 없음
    if (REQUIRED_COLUMNS.includes(columnId) && tempVisibility[columnId]) {
      return;
    }
    
    // 권한 없는 칼럼은 토글 불가
    if (!hasPermissionForColumn(columnId)) {
      return;
    }
    
    setTempVisibility(prev => ({
      ...prev,
      [columnId]: !prev[columnId]
    }));
  };

  // 변경사항 적용
  const handleApply = () => {
    applyColumnSettings(tempVisibility);
    setIsOpen(false);
  };

  // 취소
  const handleCancel = () => {
    setTempVisibility(columnVisibility);
    setIsOpen(false);
  };

  // 기본값으로 재설정
  const handleReset = () => {
    resetToDefault();
    setIsOpen(false);
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={`button-base ${className}`} disabled={isLoading}>
          <Settings className="w-4 h-4 mr-2" />
          <span className="button-text">
            {isLoading ? '로딩 중...' : `칼럼 설정 (${visibleColumnCount}/${totalColumnCount})`}
          </span>
        </Button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent className="w-[320px] overflow-x-hidden" align="end" onInteractOutside={() => {
        setTempVisibility(columnVisibility);
        setIsOpen(false);
      }}>
        <div className="max-h-[min(600px,80vh)] overflow-y-auto overflow-x-hidden">
        {/* 헤더 */}
        <DropdownMenuLabel className="flex items-center justify-between py-1.5">
          <div className="flex items-center gap-2">
            <span className="modal-section-title">칼럼 표시 설정</span>
            <span className="card-description">
              ({tempVisibleCount}/{totalColumnCount})
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="h-5 px-1.5"
            title="기본값으로 재설정"
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </DropdownMenuLabel>
        
        <DropdownMenuSeparator />

        {/* 그룹별 칼럼 목록 */}
        {COLUMN_GROUPS.map((group, groupIndex) => (
          <React.Fragment key={group.title}>
            {/* 그룹 제목 */}
            <div className="px-3 py-1">
              <div className="modal-label">
                {group.title}
              </div>
            </div>

            {/* 그룹 내 칼럼들 - 2열 그리드 */}
            <div className="grid grid-cols-2 gap-x-1 px-2">
              {group.columns.map((columnId) => {
                const isVisible = tempVisibility[columnId];
                const isRequired = REQUIRED_COLUMNS.includes(columnId);
                const hasPermission = hasPermissionForColumn(columnId);
                
                // 칼럼 라벨 매핑
                const columnLabels: Record<DoneTabColumnId, string> = {
                  statement_progress: '거래명세서',
                  purchase_order_number: '발주번호',
                  payment_category: '결제종류',
                  requester_name: '요청자',
                  request_date: '청구일',
                  utk_status: 'UTK',
                  vendor_name: '업체',
                  contact_name: '담당자',
                  delivery_request_date: '입고요청일',
                  revised_delivery_date: '변경입고일',
                  item_name: '품명',
                  specification: '규격',
                  quantity: '수량',
                  unit_price: '단가',
                  amount: '합계',
                  remark: '비고',
                  link: '링크',
                  project_vendor: 'PJ업체',
                  project_item: 'PJ ITEM',
                  sales_order_number: '수주번호',
                  purchase_progress: '구매진행',
                  receipt_progress: '입고진행',
                  received_quantity: '실제 입고수량',
                };

                return (
                  <div
                    key={columnId}
                    className={`flex items-center gap-1 py-1 rounded overflow-hidden ${
                      !hasPermission ? 'opacity-50 cursor-not-allowed' :
                      isRequired && isVisible ? 'opacity-75' : 'cursor-pointer hover:bg-gray-50'
                    }`}
                    onClick={() => {
                      if (!hasPermission) return;
                      if (!(isRequired && isVisible)) {
                        handleColumnToggle(columnId);
                      }
                    }}
                    title={!hasPermission ? '이 칼럼을 보려면 권한이 필요합니다' : ''}
                  >
                    <div className={`p-0.5 ${
                      !hasPermission ? '' :
                      isRequired && isVisible ? '' : 'hover:bg-gray-100 rounded transition-colors'
                    }`}>
                      {isVisible ? (
                        <Eye className={`w-3.5 h-3.5 ${!hasPermission ? 'text-gray-400' : 'text-green-600'}`} />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5 text-gray-400" />
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className={`modal-value truncate ${
                        !hasPermission ? 'text-gray-400' :
                        !isVisible ? 'text-gray-500' : ''
                      }`}>
                        {columnLabels[columnId]}
                        {isRequired && (
                          <span className="ml-1 text-red-500" title="필수 칼럼">*</span>
                        )}
                        {!hasPermission && (
                          <span className="ml-1 text-gray-400" title="권한 필요">🔒</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 그룹 구분선 (마지막 그룹 제외) */}
            {groupIndex < COLUMN_GROUPS.length - 1 && <DropdownMenuSeparator />}
          </React.Fragment>
        ))}

        <DropdownMenuSeparator />

        {/* 하단 도움말 */}
        <div className="px-3 py-2">
          <div className="card-description space-y-1">
            <div>• 필수 칼럼(*)은 숨길 수 없습니다</div>
            <div>• 변경사항은 적용 버튼을 눌러야 반영됩니다</div>
            <div>• 새로고침 시에도 설정이 유지됩니다</div>
          </div>
        </div>

        </div>
        
        <DropdownMenuSeparator />

        {/* 적용/취소 버튼 */}
        <div className="px-3 py-3 flex gap-2 border-t bg-white">
          <Button
            onClick={handleApply}
            className="button-base bg-blue-500 text-white hover:bg-blue-600 flex-1"
          >
            <Check className="w-4 h-4 mr-1" />
            적용
          </Button>
          <Button
            onClick={handleCancel}
            variant="outline"
            className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex-1"
          >
            <X className="w-4 h-4 mr-1" />
            취소
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

ColumnSettingsDropdown.displayName = 'ColumnSettingsDropdown';

export default ColumnSettingsDropdown;