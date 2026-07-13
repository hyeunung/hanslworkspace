
import { useMemo, useState, useEffect, useCallback } from 'react'
import { Vendor } from '@/types/purchase'
import { vendorService } from '@/services/vendorService'
import VendorFilters from '@/components/vendor/VendorFilters'
import VendorCompactTable from '@/components/vendor/VendorCompactTable'
import VendorFilterToolbar from '@/components/vendor/VendorFilterToolbar'
import VendorSortControl from '@/components/vendor/VendorSortControl'
import VendorColumnMenu, { VendorColumnVisibility } from '@/components/vendor/VendorColumnMenu'
import VendorModal from '@/components/vendor/VendorModal'
import VendorContactsModal from '@/components/vendor/VendorContactsModal'
import { toast } from 'sonner'
import { Search, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { canEditVendors } from '@/utils/roleHelper'
import {
  VendorRow, vendorToRow, applyVendorSearch, applyVendorFilters,
  compareByVendorSortRules, vendorYearsFor,
  VendorColumnId, VENDOR_COLUMNS_STORAGE_KEY,
} from '@/utils/vendorTable'
import { useVendorSortRules } from '@/hooks/useVendorSortRules'
import { useVendorTableFilters } from '@/hooks/useVendorTableFilters'
// XLSX는 사용할 때만 동적으로 import (성능 최적화)

type ModalMode = 'create' | 'edit' | 'view'

export default function VendorMain() {
  const { currentUserRoles } = useAuth()
  // 업체관리 수정 권한 (등록/수정/삭제/담당자 관리) — superadmin, hr, lead buyer만 허용
  const canEdit = canEditVendors(currentUserRoles)

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isContactsModalOpen, setIsContactsModalOpen] = useState(false)
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null)
  const [modalMode, setModalMode] = useState<ModalMode>('create')

  // 업체 목록 로드 (전체 데이터 1회 로드)
  const loadVendors = async () => {
    setLoading(true)
    try {
      const result = await vendorService.getVendors()

      if (result.success && result.data) {
        setVendors(result.data)
      } else {
        toast.error(result.error || '업체 목록을 불러오는데 실패했습니다.')
      }
    } catch (error) {
      toast.error('업체 목록을 불러오는 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  // 초기 로드
  useEffect(() => {
    loadVendors()
  }, [])

  // ── 컴팩트 테이블 상태 (통합검색 / 조건필터 / 다중정렬 / 칼럼표시) ──
  const [searchTerm, setSearchTerm] = useState('')
  const sortCtl = useVendorSortRules()
  const [columnVisibility, setColumnVisibility] = useState<VendorColumnVisibility>(() => {
    try { return JSON.parse(localStorage.getItem(VENDOR_COLUMNS_STORAGE_KEY) || '{}') } catch { return {} }
  })
  const persistColumns = useCallback((next: VendorColumnVisibility) => {
    setColumnVisibility(next)
    try { localStorage.setItem(VENDOR_COLUMNS_STORAGE_KEY, JSON.stringify(next)) } catch { /* 무시 */ }
  }, [])
  const toggleColumn = useCallback((id: VendorColumnId) => {
    persistColumns({ ...columnVisibility, [id]: columnVisibility[id] === false })
  }, [columnVisibility, persistColumns])
  const resetColumns = useCallback(() => persistColumns({}), [persistColumns])

  const rows: VendorRow[] = useMemo(() => vendors.map(vendorToRow), [vendors])

  const dynamicOptions = useMemo(() => ({
    paymentSchedules: [...new Set(rows.map(r => r.vendor_payment_schedule).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ko')),
  }), [rows])

  const tableFilters = useVendorTableFilters(dynamicOptions)
  const years = useMemo(() => vendorYearsFor(rows), [rows])

  // 파이프라인: 통합검색 → 조건 규칙 → 다중 정렬 (모두 클라이언트)
  const displayRows = useMemo(() => {
    const searched = applyVendorSearch(rows, searchTerm)
    const filtered = applyVendorFilters(searched, tableFilters.activeRules)
    return [...filtered].sort((a, b) => compareByVendorSortRules(a, b, sortCtl.sortRules))
  }, [rows, searchTerm, tableFilters.activeRules, sortCtl.sortRules])

  // 모달 핸들러
  const handleCreateNew = () => {
    if (!canEdit) return
    setSelectedVendor(null)
    setModalMode('create')
    setIsModalOpen(true)
  }

  const handleEdit = (vendor: Vendor) => {
    if (!canEdit) return
    setSelectedVendor(vendor)
    setModalMode('edit')
    setIsModalOpen(true)
  }

  const handleView = (vendor: Vendor) => {
    setSelectedVendor(vendor)
    setModalMode('view')
    setIsModalOpen(true)
  }

  const handleModalClose = () => {
    setIsModalOpen(false)
    setSelectedVendor(null)
  }

  const handleEditContacts = (vendor: Vendor) => {
    if (!canEdit) return
    setSelectedVendor(vendor)
    setIsContactsModalOpen(true)
  }

  const handleContactsModalClose = () => {
    setIsContactsModalOpen(false)
    setSelectedVendor(null)
  }

  const handleSave = () => {
    loadVendors()
  }

  const handleDelete = async (row: VendorRow) => {
    if (!canEdit) return
    if (!confirm(`정말로 '${row.vendor_name}' 업체를 삭제하시겠습니까?`)) return

    setDeletingId(row.id)
    try {
      const result = await vendorService.deleteVendor(row.id)
      if (result.success) {
        toast.success('업체가 삭제되었습니다.')
        loadVendors()
      } else {
        toast.error(result.error || '삭제에 실패했습니다.')
      }
    } catch (error) {
      toast.error('삭제 중 오류가 발생했습니다.')
    } finally {
      setDeletingId(null)
    }
  }

  // Excel 내보내기 (동적 import로 성능 최적화)
  const handleExport = async () => {
    try {
      const result = await vendorService.getVendorsForExport()

      if (result.success && result.data) {
        // XLSX를 사용할 때만 동적으로 import
        const XLSX = await import('xlsx')

        const ws = XLSX.utils.json_to_sheet(result.data)
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, '업체 목록')

        // 파일명에 현재 날짜 추가
        const today = new Date().toISOString().slice(0, 10)
        const filename = `업체_목록_${today}.xlsx`

        XLSX.writeFile(wb, filename)
        toast.success('Excel 파일이 다운로드되었습니다.')
      } else {
        toast.error(result.error || 'Excel 내보내기에 실패했습니다.')
      }
    } catch (error) {
      toast.error('Excel 내보내기 중 오류가 발생했습니다.')
    }
  }

  if (loading && vendors.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 card-subtitle">업체 목록을 불러오는 중...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-4">
      {/* 상단 헤더 (제목 + Excel 내보내기 + 업체 등록) */}
      <VendorFilters
        onExport={handleExport}
        onCreateNew={handleCreateNew}
        canEdit={canEdit}
      />

      {/* 필터 영역 (제작현황 표준): 통합 검색 + 칼럼 표시 + 조건 규칙/저장된 필터 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="relative w-[240px] flex-shrink-0 h-5 flex items-center">
            <Search className="w-3 h-3 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="업체명, 담당자, 전화번호, 비고 검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ paddingLeft: '26px', height: '20px' }}
              className="hansl-search-input"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                title="검색어 지우기"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <VendorColumnMenu
            columnVisibility={columnVisibility}
            toggleColumn={toggleColumn}
            resetToDefault={resetColumns}
          />
        </div>
        <VendorFilterToolbar
          rules={tableFilters.rules}
          dynamicOptions={dynamicOptions}
          years={years}
          addRule={tableFilters.addRule}
          updateRule={tableFilters.updateRule}
          changeRuleField={tableFilters.changeRuleField}
          removeRule={tableFilters.removeRule}
          resetRules={tableFilters.resetRules}
          filterViewsConfig={tableFilters.filterViewsConfig}
          viewsMenuOpen={tableFilters.viewsMenuOpen}
          setViewsMenuOpen={tableFilters.setViewsMenuOpen}
          viewsAnchor={tableFilters.viewsAnchor}
          setViewsAnchor={tableFilters.setViewsAnchor}
          namingView={tableFilters.namingView}
          setNamingView={tableFilters.setNamingView}
          newViewName={tableFilters.newViewName}
          setNewViewName={tableFilters.setNewViewName}
          closeViewsMenu={tableFilters.closeViewsMenu}
          commitSaveView={tableFilters.commitSaveView}
          handleApplyView={tableFilters.handleApplyView}
          handleRenameView={tableFilters.handleRenameView}
          handleDeleteView={tableFilters.handleDeleteView}
          handleSetDefault={tableFilters.handleSetDefault}
          handleClearDefault={tableFilters.handleClearDefault}
        />
      </div>

      {/* 표 카드 — 제목행(정렬·건수) + 컴팩트 테이블 (행 가상화) */}
      <div className="border rounded-lg overflow-hidden bg-white shadow-sm w-fit max-w-full">
        <div className="px-4 py-2 border-b border-gray-200 flex items-center gap-2 bg-gray-50/50">
          <span className="modal-section-title">업체 목록</span>
          <VendorSortControl
            sortRules={sortCtl.sortRules}
            addSortRule={sortCtl.addSortRule}
            updateSortRule={sortCtl.updateSortRule}
            removeSortRule={sortCtl.removeSortRule}
            clearSort={sortCtl.clearSort}
          />
          <span className="badge-stats bg-gray-100 text-gray-600">
            {displayRows.length === vendors.length
              ? `${vendors.length}건`
              : `${displayRows.length} / ${vendors.length}건`}
          </span>
        </div>
        {displayRows.length === 0 ? (
          <div className="text-center py-12 px-16">
            <Search className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">
              {vendors.length === 0 ? '등록된 업체가 없습니다.' : '조건에 맞는 업체가 없습니다.'}
            </p>
          </div>
        ) : (
          <VendorCompactTable
            rows={displayRows}
            columnVisibility={columnVisibility}
            ctx={{
              canEdit,
              onRowClick: (row) => handleView(row.vendor),
              onEdit: (row) => handleEdit(row.vendor),
              onDelete: handleDelete,
              onEditContacts: (row) => handleEditContacts(row.vendor),
              deletingId,
            }}
          />
        )}
      </div>

      {/* 모달 */}
      <VendorModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        vendor={selectedVendor}
        onSave={handleSave}
        mode={modalMode}
      />

      {/* 담당자 수정 전용 모달 */}
      <VendorContactsModal
        isOpen={isContactsModalOpen}
        onClose={handleContactsModalClose}
        vendor={selectedVendor}
        onSave={handleSave}
      />
      </div>
    </>
  )
}
