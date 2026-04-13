
import { useState } from 'react'
import { Vendor, VendorContact } from '@/types/purchase'
import { formatDate } from '@/utils/helpers'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  MoreHorizontal,
  Edit,
  Trash2,
  Eye,
} from 'lucide-react'
import { vendorService } from '@/services/vendorService'
import { toast } from 'sonner'
import { useTableSort } from '@/hooks/useTableSort'
import { SortableHeader } from '@/components/ui/sortable-header'
import { MobileCard, MobileCardItem, MobileCardHeader, MobileCardActions } from '@/components/ui/mobile-card'

interface VendorTableProps {
  vendors: Vendor[]
  onEdit: (vendor: Vendor) => void
  onView: (vendor: Vendor) => void
  onRefresh: () => void
}

export default function VendorTable({ vendors, onEdit, onView, onRefresh }: VendorTableProps) {
  const [loadingId, setLoadingId] = useState<number | null>(null)
  const { sortedData, sortConfig, handleSort } = useTableSort(vendors, 'vendor_name', 'asc')

  const handleDelete = async (vendor: Vendor) => {
    if (!confirm(`정말로 '${vendor.vendor_name}' 업체를 삭제하시겠습니까?`)) {
      return
    }

    setLoadingId(vendor.id)
    try {
      const result = await vendorService.deleteVendor(vendor.id)
      if (result.success) {
        toast.success('업체가 삭제되었습니다.')
        onRefresh()
      } else {
        toast.error(result.error || '삭제에 실패했습니다.')
      }
    } catch (error) {
      toast.error('삭제 중 오류가 발생했습니다.')
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <>
      {/* Table View (md+) */}
      <div className="hidden md:block border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28 min-w-[100px]">
                  <SortableHeader
                    sortKey="vendor_name"
                    currentSortKey={sortConfig.key as string | null}
                    sortDirection={sortConfig.direction}
                    onSort={() => handleSort('vendor_name' as keyof Vendor)}
                  >
                    업체명
                  </SortableHeader>
                </TableHead>
                <TableHead className="w-14 min-w-[45px] text-center">담당자</TableHead>
                <TableHead className="min-w-[180px]">담당자 정보</TableHead>
                <TableHead className="w-24 min-w-[90px]">전화번호</TableHead>
                <TableHead className="w-24 min-w-[90px]">팩스번호</TableHead>
                <TableHead className="w-20 min-w-[70px]">지출예정일</TableHead>
                <TableHead className="w-20 min-w-[60px]">
                  <SortableHeader
                    sortKey="created_at"
                    currentSortKey={sortConfig.key as string | null}
                    sortDirection={sortConfig.direction}
                    onSort={() => handleSort('created_at' as keyof Vendor)}
                  >
                    등록일
                  </SortableHeader>
                </TableHead>
                <TableHead className="w-16 min-w-[50px]">작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                    등록된 업체가 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                sortedData.map((vendor) => (
                  <TableRow key={vendor.id}>
                    {/* 업체명 */}
                    <TableCell className="text-[11px] font-medium text-gray-900 px-2 py-1.5">
                      {vendor.vendor_name}
                      {vendor.vendor_alias && (
                        <span className="text-[10px] text-gray-400 ml-1">({vendor.vendor_alias})</span>
                      )}
                    </TableCell>
                    {/* 담당자 수 */}
                    <TableCell className="text-center px-1 py-1.5">
                      <span className="badge-stats text-[10px] px-1.5 py-0.5 border border-gray-300 bg-white text-gray-600">
                        {vendor.vendor_contacts?.length || 0}명
                      </span>
                    </TableCell>
                    {/* 담당자 정보 */}
                    <TableCell className="px-2 py-1.5">
                      {vendor.vendor_contacts && vendor.vendor_contacts.length > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          {vendor.vendor_contacts.slice(0, 2).map((contact: VendorContact, idx: number) => (
                            <div key={idx} className="flex items-center gap-2 text-[11px]">
                              <span className="font-medium text-gray-900 whitespace-nowrap">{contact.contact_name}</span>
                              {contact.contact_phone && (
                                <span className="text-gray-500 whitespace-nowrap">{contact.contact_phone}</span>
                              )}
                              {contact.contact_email && (
                                <span className="text-gray-400 truncate max-w-[150px]">{contact.contact_email}</span>
                              )}
                            </div>
                          ))}
                          {vendor.vendor_contacts.length > 2 && (
                            <span className="text-[10px] text-gray-400">외 {vendor.vendor_contacts.length - 2}명</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-gray-400">-</span>
                      )}
                    </TableCell>
                    {/* 전화번호 */}
                    <TableCell className="text-[11px] text-gray-700 px-2 py-1.5">
                      {vendor.vendor_phone || '-'}
                    </TableCell>
                    {/* 팩스번호 */}
                    <TableCell className="text-[11px] text-gray-700 px-2 py-1.5">
                      {vendor.vendor_fax || '-'}
                    </TableCell>
                    {/* 지출예정일 */}
                    <TableCell className="text-[11px] text-gray-700 px-2 py-1.5">
                      {vendor.vendor_payment_schedule || '-'}
                    </TableCell>
                    {/* 등록일 */}
                    <TableCell className="text-[11px] text-gray-700 px-2 py-1.5">
                      {formatDate(vendor.created_at)}
                    </TableCell>
                    {/* 작업 */}
                    <TableCell className="px-1 py-1.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                            disabled={loadingId === vendor.id}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => onView(vendor)}>
                            <Eye className="mr-2 h-4 w-4" />
                            상세 보기
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => onEdit(vendor)}>
                            <Edit className="mr-2 h-4 w-4" />
                            수정
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={(e) => {
                              e.preventDefault()
                              handleDelete(vendor)
                            }}
                            className="text-red-600"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            삭제
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="block md:hidden space-y-3">
        {sortedData.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            등록된 업체가 없습니다.
          </div>
        ) : (
          sortedData.map((vendor) => (
            <MobileCard key={vendor.id}>
              <MobileCardHeader>
                <div className="flex justify-between items-center">
                  <span className="text-[13px] font-medium text-gray-900">
                    {vendor.vendor_name}
                    {vendor.vendor_alias && (
                      <span className="text-[11px] text-gray-400 ml-1">({vendor.vendor_alias})</span>
                    )}
                  </span>
                  <span className="badge-stats text-[10px] px-1.5 py-0.5 border border-gray-300 bg-white text-gray-600">
                    담당자 {vendor.vendor_contacts?.length || 0}명
                  </span>
                </div>
              </MobileCardHeader>

              <MobileCardItem
                label="담당자"
                value={
                  vendor.vendor_contacts && vendor.vendor_contacts.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {vendor.vendor_contacts.slice(0, 2).map((contact: VendorContact, idx: number) => (
                        <div key={idx} className="text-[11px]">
                          <span className="font-medium text-gray-900">{contact.contact_name}</span>
                          {contact.contact_phone && (
                            <span className="text-gray-500 ml-1.5">{contact.contact_phone}</span>
                          )}
                          {contact.contact_email && (
                            <div className="text-[10px] text-gray-400">{contact.contact_email}</div>
                          )}
                        </div>
                      ))}
                      {vendor.vendor_contacts.length > 2 && (
                        <span className="text-[10px] text-gray-400">외 {vendor.vendor_contacts.length - 2}명</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-[11px] text-gray-400">-</span>
                  )
                }
              />
              <MobileCardItem label="전화번호" value={<span className="text-[11px] text-gray-700">{vendor.vendor_phone || '-'}</span>} />
              <MobileCardItem label="팩스번호" value={<span className="text-[11px] text-gray-700">{vendor.vendor_fax || '-'}</span>} />
              <MobileCardItem label="지출예정일" value={<span className="text-[11px] text-gray-700">{vendor.vendor_payment_schedule || '-'}</span>} />
              <MobileCardItem label="등록일" value={<span className="text-[11px] text-gray-700">{formatDate(vendor.created_at)}</span>} />

              <MobileCardActions>
                <Button
                  className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1"
                  onClick={() => onView(vendor)}
                >
                  <Eye className="w-4 h-4" />
                  보기
                </Button>
                <Button
                  className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1"
                  onClick={() => onEdit(vendor)}
                >
                  <Edit className="w-4 h-4" />
                  수정
                </Button>
                <Button
                  className="button-base border border-red-200 bg-white text-red-600 hover:bg-red-50 flex items-center gap-1"
                  onClick={() => handleDelete(vendor)}
                  disabled={loadingId === vendor.id}
                >
                  <Trash2 className="w-4 h-4" />
                  삭제
                </Button>
              </MobileCardActions>
            </MobileCard>
          ))
        )}
      </div>
    </>
  )
}
