
import { useMemo, useState, useEffect } from 'react'
import { Vendor, VendorFilters as VendorFiltersType } from '@/types/purchase'
import { vendorService } from '@/services/vendorService'
import VendorFilters from '@/components/vendor/VendorFilters'
import VendorTable from '@/components/vendor/VendorTable'
import VendorModal from '@/components/vendor/VendorModal'
import { toast } from 'sonner'
import { Search } from 'lucide-react'
// XLSX는 사용할 때만 동적으로 import (성능 최적화)

type ModalMode = 'create' | 'edit' | 'view'

export default function VendorMain() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<VendorFiltersType>({})

  // 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false)
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

  // 클라이언트 사이드 필터링 (실시간 검색)
  const filteredVendors = useMemo(() => {
    const normalizedSearch = (filters.search || '').trim().toLowerCase()
    if (!normalizedSearch) return vendors

    const includesSearch = (value?: string) =>
      (value || '').toLowerCase().includes(normalizedSearch)

    return vendors.filter((vendor) => {
      const vendorFieldsMatch = [
        vendor.vendor_name,
        vendor.vendor_alias,
        vendor.vendor_phone,
        vendor.vendor_fax,
        vendor.vendor_address,
        vendor.vendor_payment_schedule,
        vendor.note,
      ].some(includesSearch)

      if (vendorFieldsMatch) return true

      return (vendor.vendor_contacts || []).some((contact) =>
        [
          contact.contact_name,
          contact.contact_phone,
          contact.contact_email,
          contact.position,
        ].some(includesSearch)
      )
    })
  }, [vendors, filters.search])

  // 모달 핸들러
  const handleCreateNew = () => {
    setSelectedVendor(null)
    setModalMode('create')
    setIsModalOpen(true)
  }

  const handleEdit = (vendor: Vendor) => {
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

  const handleSave = () => {
    loadVendors()
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
      <div className="space-y-6">
      {/* 필터 섹션 */}
      <VendorFilters
        onExport={handleExport}
        onCreateNew={handleCreateNew}
      />

      {/* 테이블 섹션 */}
      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <h3 className="text-[14px] font-semibold text-gray-900">업체 목록</h3>
              <div className="relative flex items-center">
                <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-gray-400" />
                <input
                  type="text"
                  value={filters.search || ''}
                  onChange={(e) => {
                    setFilters({
                      ...filters,
                      search: e.target.value.trim() || undefined
                    })
                  }}
                  placeholder="검색어를 입력하세요."
                  className="pl-5 pr-1 h-6 bg-transparent text-[11px] text-gray-700 placeholder:text-gray-400 placeholder:text-[10px] border-0 border-b border-gray-300 focus:border-hansl-500 focus:outline-none focus:ring-0 rounded-none shadow-none appearance-none"
                />
              </div>
            </div>
            <span className="text-[11px] text-gray-500">
              {loading ? '로딩 중...' : `총 ${filteredVendors.length}개의 업체`}
            </span>
          </div>
        </div>

        <VendorTable
          vendors={filteredVendors}
          onEdit={handleEdit}
          onView={handleView}
          onRefresh={loadVendors}
        />
      </div>

      {/* 모달 */}
      <VendorModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        vendor={selectedVendor}
        onSave={handleSave}
        mode={modalMode}
      />
      </div>
    </>
  )
}
