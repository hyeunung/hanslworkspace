
import { useState } from 'react'
import { Vendor } from '@/types/purchase'
import { formatDate } from '@/utils/helpers'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  ToggleLeft, 
  ToggleRight 
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

  const handleToggleStatus = async (vendor: Vendor) => {
    setLoadingId(vendor.id)
    try {
      const result = await vendorService.toggleVendorStatus(vendor.id)
      
      if (result.success) {
        toast.success(`업체가 ${vendor.is_active ? '비활성화' : '활성화'}되었습니다.`)
        onRefresh()
      } else {
        toast.error(result.error || '상태 변경에 실패했습니다.')
      }
    } catch (error) {
      toast.error('상태 변경 중 오류가 발생했습니다.')
    } finally {
      setLoadingId(null)
    }
  }

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

  // formatDate는 utils/helpers.ts에서 import

  return (
    <>
      {/* Desktop Table View */}
      <div className="hidden lg:block border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24 min-w-[80px] lg:w-32">
              <SortableHeader
                sortKey="vendor_name"
                currentSortKey={sortConfig.key as string | null}
                sortDirection={sortConfig.direction}
                onSort={() => handleSort('vendor_name' as keyof Vendor)}
              >
                업체명
              </SortableHeader>
            </TableHead>
            <TableHead className="w-16 min-w-[50px] text-center">담당자</TableHead>
            <TableHead className="min-w-[200px]">담당자 정보</TableHead>
            <TableHead className="w-28 min-w-[110px]">전화번호</TableHead>
            <TableHead className="w-28 min-w-[110px]">팩스번호</TableHead>
            <TableHead className="w-24 min-w-[100px]">지출예정일</TableHead>
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
            <TableHead className="w-14 min-w-[45px] text-center">작업</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {vendors.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                등록된 업체가 없습니다.
              </TableCell>
            </TableRow>
          ) : (
            sortedData.map((vendor) => (
              <TableRow key={vendor.id}>
                <TableCell className="modal-value px-2 py-1.5">
                  {vendor.vendor_name}
                </TableCell>
                <TableCell className="text-center text-[11px] px-1 py-1.5">
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    {vendor.vendor_contacts?.length || 0}명
                  </Badge>
                </TableCell>
                <TableCell className="px-2 py-1.5">
                  <div className="space-y-0.5">
                    {vendor.vendor_contacts && vendor.vendor_contacts.length > 0 ? (
                      vendor.vendor_contacts.slice(0, 2).map((contact: any, idx: number) => (
                        <div key={idx} className="text-[10px]">
                          <span className="modal-value">{contact.contact_name}</span>
                          <span className="text-gray-500 ml-1">{contact.contact_phone}</span>
                          {contact.contact_email && (
                            <span className="text-gray-500 ml-1 truncate inline-block max-w-[180px]">{contact.contact_email}</span>
                          )}
                        </div>
                      ))
                    ) : (
                      <span className="text-gray-400 text-[10px]">담당자 없음</span>
                    )}
                    {vendor.vendor_contacts && vendor.vendor_contacts.length > 2 && (
                      <span className="text-[10px] text-gray-500">외 {vendor.vendor_contacts.length - 2}명</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-[11px] px-2 py-1.5">
                  <span className="block truncate" title={vendor.vendor_phone || ''}>
                    {vendor.vendor_phone || '-'}
                  </span>
                </TableCell>
                <TableCell className="text-[11px] px-2 py-1.5">
                  <span className="block truncate" title={vendor.vendor_fax || ''}>
                    {vendor.vendor_fax || '-'}
                  </span>
                </TableCell>
                <TableCell className="text-[11px] px-2 py-1.5">
                  <span className="block truncate" title={vendor.vendor_payment_schedule || ''}>
                    {vendor.vendor_payment_schedule || '-'}
                  </span>
                </TableCell>
                <TableCell className="text-[11px] px-2 py-1.5">{formatDate(vendor.created_at)}</TableCell>
                <TableCell className="px-1 py-1.5 text-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        disabled={loadingId === vendor.id}
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onView(vendor)}>
                        <Eye className="mr-2 h-4 w-4" />
                        상세 보기
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEdit(vendor)}>
                        <Edit className="mr-2 h-4 w-4" />
                        수정
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleToggleStatus(vendor)}>
                        {vendor.is_active ? (
                          <>
                            <ToggleLeft className="mr-2 h-4 w-4" />
                            비활성화
                          </>
                        ) : (
                          <>
                            <ToggleRight className="mr-2 h-4 w-4" />
                            활성화
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => handleDelete(vendor)}
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

      {/* Tablet View */}
      <div className="hidden md:block lg:hidden">
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full min-w-[900px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 header-title text-gray-900">업체명</th>
                <th className="text-center p-3 header-title text-gray-900 w-20">담당자</th>
                <th className="text-left p-3 header-title text-gray-900">연락처</th>
                <th className="text-left p-3 header-title text-gray-900 w-28">전화번호</th>
                <th className="text-left p-3 header-title text-gray-900 w-28">팩스번호</th>
                <th className="text-left p-3 header-title text-gray-900 w-24">지출예정일</th>
                <th className="text-left p-3 header-title text-gray-900 w-24">등록일</th>
                <th className="text-center p-3 header-title text-gray-900 w-16">작업</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedData.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-500">
                    등록된 업체가 없습니다.
                  </td>
                </tr>
              ) : (
                sortedData.map((vendor) => (
                  <tr key={vendor.id} className="hover:bg-gray-50">
                    <td className="p-3 modal-value">{vendor.vendor_name}</td>
                    <td className="p-3 text-center">
                      <Badge variant="outline" className="badge-text">
                        {vendor.vendor_contacts?.length || 0}명
                      </Badge>
                    </td>
                    <td className="p-3 modal-subtitle">
                      {vendor.vendor_contacts && vendor.vendor_contacts.length > 0 ? (
                        <div>
                          <div className="modal-value">{vendor.vendor_contacts[0].contact_name}</div>
                          <div className="text-gray-500 badge-text">{vendor.vendor_contacts[0].contact_phone}</div>
                        </div>
                      ) : (
                        <span className="text-gray-400">담당자 없음</span>
                      )}
                    </td>
                    <td className="p-3 modal-subtitle">
                      <span className="block truncate" title={vendor.vendor_phone || ''}>
                        {vendor.vendor_phone || '-'}
                      </span>
                    </td>
                    <td className="p-3 modal-subtitle">
                      <span className="block truncate" title={vendor.vendor_fax || ''}>
                        {vendor.vendor_fax || '-'}
                      </span>
                    </td>
                    <td className="p-3 modal-subtitle">
                      <span className="block truncate" title={vendor.vendor_payment_schedule || ''}>
                        {vendor.vendor_payment_schedule || '-'}
                      </span>
                    </td>
                    <td className="p-3 modal-subtitle">{formatDate(vendor.created_at)}</td>
                    <td className="p-3 text-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onView(vendor)}>
                            <Eye className="mr-2 h-4 w-4" />
                            상세 보기
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onEdit(vendor)}>
                            <Edit className="mr-2 h-4 w-4" />
                            수정
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleToggleStatus(vendor)}>
                            {vendor.is_active ? (
                              <>
                                <ToggleLeft className="mr-2 h-4 w-4" />
                                비활성화
                              </>
                            ) : (
                              <>
                                <ToggleRight className="mr-2 h-4 w-4" />
                                활성화
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleDelete(vendor)}
                            className="text-red-600"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            삭제
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
                  <span>{vendor.vendor_name}</span>
                  <Badge variant="outline">
                    {vendor.vendor_contacts?.length || 0}명
                  </Badge>
                </div>
              </MobileCardHeader>
              
              <MobileCardItem 
                label="담당자" 
                value={
                  <div className="space-y-1">
                    {vendor.vendor_contacts && vendor.vendor_contacts.length > 0 ? (
                      vendor.vendor_contacts.slice(0, 2).map((contact: any, idx: number) => (
                        <div key={idx} className="modal-subtitle">
                          <div className="modal-value">{contact.contact_name}</div>
                          <div className="text-gray-500 badge-text">{contact.contact_phone}</div>
                          {contact.contact_email && (
                            <div className="text-gray-500 badge-text">{contact.contact_email}</div>
                          )}
                        </div>
                      ))
                    ) : (
                      <span className="text-gray-400">담당자 없음</span>
                    )}
                    {vendor.vendor_contacts && vendor.vendor_contacts.length > 2 && (
                      <span className="modal-subtitle text-gray-500">외 {vendor.vendor_contacts.length - 2}명</span>
                    )}
                  </div>
                } 
              />
              <MobileCardItem label="전화번호" value={vendor.vendor_phone || '-'} />
              <MobileCardItem label="팩스번호" value={vendor.vendor_fax || '-'} />
              <MobileCardItem label="지출예정일" value={vendor.vendor_payment_schedule || '-'} />
              <MobileCardItem label="등록일" value={formatDate(vendor.created_at)} />
              
              <MobileCardActions>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onView(vendor)}
                >
                  <Eye className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onEdit(vendor)}
                >
                  <Edit className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleToggleStatus(vendor)}
                  disabled={loadingId === vendor.id}
                >
                  {vendor.is_active ? (
                    <ToggleLeft className="w-4 h-4" />
                  ) : (
                    <ToggleRight className="w-4 h-4" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600"
                  onClick={() => handleDelete(vendor)}
                  disabled={loadingId === vendor.id}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </MobileCardActions>
            </MobileCard>
          ))
        )}
      </div>
    </>
  )
}