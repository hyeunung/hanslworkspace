import { Eye, EyeOff, Lock, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { ColumnVisibility, DoneTabColumnId } from '@/types/columnSettings'
import {
  COLUMN_GROUPS, COLUMN_INFO_MAP, REQUIRED_COLUMNS, RESTRICTED_COLUMNS,
  AUTHORIZED_ROLES, UTK_AUTHORIZED_ROLES,
} from '@/constants/columnSettings'

interface PurchaseColumnPanelProps {
  columnVisibility: ColumnVisibility
  toggleColumn: (columnId: DoneTabColumnId) => void
  resetToDefault: () => void
  currentUserRoles: string[]
}

// 칼럼 표시 설정 인라인 패널 — 필터 카드 우측 절반에 상주 (클릭 즉시 반영 + 자동 저장).
// 저장은 기존 useColumnSettings(DB user_ui_settings)를 그대로 사용해 기기 간 동기화 유지.
// 필수 칼럼(발주번호·업체·품명·규격)은 잠금, 권한 제한 칼럼은 권한 없으면 목록에서 제외.
export default function PurchaseColumnPanel({
  columnVisibility, toggleColumn, resetToDefault, currentUserRoles,
}: PurchaseColumnPanelProps) {
  const hasRestrictedPermission = (id: DoneTabColumnId) =>
    id === 'utk_status'
      ? currentUserRoles.some(role => UTK_AUTHORIZED_ROLES.includes(role))
      : currentUserRoles.some(role => AUTHORIZED_ROLES.includes(role))

  // 권한 없는 제한 칼럼은 목록에서 제외 (표에서도 강제 숨김이므로 토글 의미 없음)
  const visibleGroups = COLUMN_GROUPS.map(g => ({
    title: g.title,
    columns: g.columns.filter(id => !RESTRICTED_COLUMNS.includes(id) || hasRestrictedPermission(id)),
  })).filter(g => g.columns.length > 0)

  const allIds = visibleGroups.flatMap(g => g.columns)
  const total = allIds.length
  const shownCount = allIds.filter(id => columnVisibility[id] !== false).length

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="hansl-filter-row-label">
          <SlidersHorizontal className="w-3.5 h-3.5" /> 칼럼 표시
          <span className="text-gray-400 font-normal">({shownCount}/{total})</span>
        </span>
        <button
          type="button"
          onClick={resetToDefault}
          className="hansl-mini-btn hover:text-gray-800"
          title="숨긴 칼럼을 모두 다시 표시"
        >
          <RotateCcw className="w-2.5 h-2.5" />
          전체 표시
        </button>
      </div>
      <div className="space-y-1.5">
        {visibleGroups.map(g => (
          <div key={g.title}>
            <div className="text-[9px] font-bold text-gray-400 mb-0.5">{g.title}</div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-2">
              {g.columns.map(id => {
                const required = REQUIRED_COLUMNS.includes(id)
                const hidden = columnVisibility[id] === false
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={required}
                    onClick={() => toggleColumn(id)}
                    title={required ? '필수 칼럼은 숨길 수 없습니다' : undefined}
                    className={`flex items-center gap-1.5 py-0.5 px-1 rounded text-left transition-colors ${
                      required ? 'cursor-default' : 'hover:bg-gray-50'
                    } ${hidden ? 'text-gray-400' : 'text-gray-700'}`}
                  >
                    {required
                      ? <Lock className="w-3 h-3 text-gray-300 shrink-0" />
                      : hidden
                        ? <EyeOff className="w-3 h-3 text-gray-300 shrink-0" />
                        : <Eye className="w-3 h-3 text-hansl-500 shrink-0" />}
                    <span className="text-[11px] truncate">{COLUMN_INFO_MAP[id].label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
