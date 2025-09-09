import { Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Filter } from "lucide-react";
import { Vendor, Employee } from "@/hooks/usePurchaseData";

interface PurchaseFilterSectionProps {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  vendorFilter: string;
  setVendorFilter: (value: string) => void;
  dateFromFilter: string;
  setDateFromFilter: (value: string) => void;
  dateToFilter: string;
  setDateToFilter: (value: string) => void;
  selectedEmployee: string;
  setSelectedEmployee: (value: string) => void;
  vendors: Vendor[];
  employees: Employee[];
  loading: boolean;
  onRefresh: () => void;
}

export default function PurchaseFilterSection({
  searchTerm,
  setSearchTerm,
  vendorFilter,
  setVendorFilter,
  dateFromFilter,
  setDateFromFilter,
  dateToFilter,
  setDateToFilter,
  selectedEmployee,
  setSelectedEmployee,
  vendors,
  employees,
  loading,
  onRefresh
}: PurchaseFilterSectionProps) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center text-hansl-600">
          <Filter className="w-5 h-5 mr-2" />
          필터
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">검색</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="발주요청번호, 요청자, 프로젝트명..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">업체</label>
            <Select value={vendorFilter || "all"} onValueChange={(value) => setVendorFilter(value === "all" ? "" : value)}>
              <SelectTrigger>
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {vendors.map((vendor) => (
                  <SelectItem key={vendor.id} value={vendor.vendor_name}>
                    {vendor.vendor_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">직원</label>
            <Select value={selectedEmployee || "all"} onValueChange={(value) => setSelectedEmployee(value === "all" ? "" : value)}>
              <SelectTrigger>
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {employees.map((employee) => (
                  <SelectItem key={employee.id} value={employee.name}>
                    {employee.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">청구일 (부터)</label>
            <Input
              type="date"
              value={dateFromFilter}
              onChange={(e) => setDateFromFilter(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">청구일 (까지)</label>
            <Input
              type="date"
              value={dateToFilter}
              onChange={(e) => setDateToFilter(e.target.value)}
            />
          </div>
        </div>
        
        {/* Pull-to-refresh 안내 */}
        <div className="mt-2 text-xs text-gray-500 text-center md:text-right">
          화면을 아래로 당겨서 새로고침
        </div>
      </CardContent>
    </Card>
  );
}