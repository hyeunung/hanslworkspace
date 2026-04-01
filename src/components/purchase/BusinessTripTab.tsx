import { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ReactSelect from "react-select";
import CreatableSelect from "react-select/creatable";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { Plane, RefreshCw, Check, X, Calendar as CalendarIcon, Trash2, Upload, Download, Printer, ChevronLeft, ChevronRight } from "lucide-react";
import { parseRoles } from '@/utils/roleHelper';
import { invalidatePurchaseMemoryCache } from '@/stores/purchaseMemoryStore';

const TRIP_APPROVER_ROLES = ["middle_manager", "final_approver", "ceo", "superadmin"];
const HIGH_AMOUNT_APPROVER_ROLES = ["final_approver", "ceo", "superadmin"];
const SETTLEMENT_APPROVER_ROLES = ["hr", "lead buyer", "superadmin"];

const COMPANY_CARDS = [
  { label: "출장용", number: "5914", value: "출장용 5914" },
  { label: "청송", number: "0948", value: "청송 0948" },
  { label: "공용1", number: "8967", value: "공용1 8967" },
  { label: "공용2", number: "9976", value: "공용2 9976" },
  { label: "원자재", number: "4963", value: "원자재 4963" },
  { label: "기타1", number: "8936", value: "기타1 8936" },
];

type CompanyCardOption = (typeof COMPANY_CARDS)[number];

const formatCompanyCardOptionLabel = (option: CompanyCardOption) => `${option.label} (${option.number})`;

const COMPANY_VEHICLES = [
  { label: "PALISADE", plate: "259누 8222", value: "PALISADE 259누 8222" },
  { label: "STARIA", plate: "715루 7024", value: "STARIA 715루 7024" },
  { label: "GV80", plate: "330조 1022", value: "GV80 330조 1022" },
  { label: "G90", plate: "322모 3801", value: "G90 322모 3801" },
  { label: "F150 Raptor", plate: "8381", value: "F150 Raptor 8381" },
  { label: "PORTER", plate: "93부 0351", value: "PORTER 93부 0351" },
];

const VEHICLE_FIXED_STATUS: Record<string, { status: "away" }> = {
  PORTER: { status: "away" },
};

const TRIP_TRANSPORT_OPTIONS = [
  { value: "company_vehicle", label: "회사차량" },
  { value: "public_transport", label: "대중교통" },
  { value: "private_car", label: "자차" },
  { value: "other", label: "기타" },
];

const PUBLIC_TRANSPORT_OPTIONS = [
  { value: "bus", label: "버스" },
  { value: "train_ktx_srt", label: "기차(KTX/SRT)" },
  { value: "airplane", label: "비행기" },
  { value: "taxi", label: "택시" },
];

const PUBLIC_TRANSPORT_LABEL_MAP: Record<string, string> = {
  bus: "버스",
  train_ktx_srt: "기차(KTX/SRT)",
  airplane: "비행기",
  taxi: "택시",
};

const TRIP_TRANSPORT_LABEL_MAP: Record<string, string> = {
  company_vehicle: "회사차량",
  public_transport: "대중교통",
  private_car: "자차",
  other: "기타",
  airplane: "비행기",
  ktx_srt: "KTX/SRT",
};

const EXPENSE_TYPE_OPTIONS = [
  { value: "corporate_card", label: "법인카드" },
  { value: "personal_card", label: "개인카드" },
  { value: "cash", label: "현금" },
];

const REGION_OPTIONS = [
  { value: "Domestic", label: "Domestic" },
  { value: "Overseas", label: "Overseas" },
];

const reactSelectStyles = {
  control: (base: Record<string, unknown>) => ({
    ...base,
    minHeight: "28px",
    height: "28px",
    fontSize: "0.75rem",
    borderColor: "#d2d2d7",
    borderRadius: "6px",
    backgroundColor: "#fff",
    boxShadow: "none",
    "&:hover": { borderColor: "#b8b8bd" },
  }),
  valueContainer: (base: Record<string, unknown>) => ({
    ...base,
    padding: "0 6px",
  }),
  input: (base: Record<string, unknown>) => ({
    ...base,
    margin: 0,
    padding: 0,
  }),
  placeholder: (base: Record<string, unknown>) => ({
    ...base,
    color: "#9ca3af",
  }),
  indicatorsContainer: (base: Record<string, unknown>) => ({
    ...base,
    height: "28px",
  }),
  clearIndicator: () => ({ display: "none" }),
  indicatorSeparator: () => ({ display: "none" }),
  option: (base: Record<string, unknown>, state: { isSelected: boolean; isFocused: boolean }) => ({
    ...base,
    fontSize: "0.75rem",
    padding: "6px 10px",
    backgroundColor: state.isSelected ? "#d1d5db" : state.isFocused ? "#f3f4f6" : "#fff",
    color: "#111827",
    cursor: "pointer",
    "&:active": { backgroundColor: "#d1d5db" },
  }),
  menu: (base: Record<string, unknown>) => ({
    ...base,
    zIndex: 99999,
  }),
  menuList: (base: Record<string, unknown>) => ({
    ...base,
    maxHeight: "220px",
    overflowY: "auto" as const,
  }),
  menuPortal: (base: Record<string, unknown>) => ({
    ...base,
    zIndex: 99999,
    pointerEvents: "auto" as const,
  }),
};

interface Employee {
  id: string;
  name: string | null;
  department: string | null;
  position: string | null;
  email: string | null;
  roles?: string[] | null;
}

interface CardUsageLink {
  id: number;
  business_trip_id: number | null;
  card_number: string;
  approval_status: string;
  card_returned: boolean;
}

interface VehicleUsageLink {
  id: number;
  business_trip_id: number | null;
  vehicle_info: string;
  approval_status: string;
}

interface VehicleScheduleRow {
  id: number;
  vehicle_info: string;
  approval_status: string;
  start_at: string;
  end_at: string;
}

interface BusinessTrip {
  id: number;
  trip_code: string;
  requester_id: string | null;
  request_department: string;
  project_name: string | null;
  trip_purpose: string;
  trip_destination: string;
  trip_start_date: string;
  trip_end_date: string;
  companions: { id: string; name: string }[] | null;
  transport_type: "company_vehicle" | "public_transport" | "private_car" | "other";
  requested_vehicle_info: string | null;
  request_corporate_card: boolean;
  requested_card_number: string | null;
  expected_total_amount: number;
  precheck_note: string | null;
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  settlement_status: string;
  settlement_submitted_by: string | null;
  settlement_submitted_at: string | null;
  settlement_approved_by: string | null;
  settlement_approved_at: string | null;
  settlement_rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  requester?: { name: string; department: string | null } | null;
  linkedCard?: CardUsageLink | null;
  linkedVehicle?: VehicleUsageLink | null;
}

interface BusinessTripExpense {
  id: number;
  business_trip_id: number;
  line_order: number;
  expense_type: "corporate_card" | "personal_card" | "cash";
  expense_date: string;
  vendor_name: string;
  category_detail: string | null;
  specification: string | null;
  quantity: number;
  unit_price: number | null;
  amount: number;
  currency: string;
  companion_note: string | null;
  expense_purpose: string | null;
  linked_card_usage_id: number | null;
  remark: string | null;
}

interface BusinessTripExpenseReceipt {
  id: number;
  business_trip_expense_id: number;
  receipt_url: string;
}

interface BusinessTripMileage {
  id: number;
  business_trip_id: number;
  line_order: number;
  travel_date: string;
  origin: string;
  destination: string;
  distance_km: number;
  description: string | null;
  mileage_unit_amount: number;
}

interface BusinessTripAllowance {
  id: number;
  business_trip_id: number;
  line_order: number;
  person_name: string | null;
  region: "Domestic" | "Overseas";
  day_count: number;
  unit_amount: number;
}

interface CompanionOption {
  value: string;
  label: string;
}

interface ExpenseFormRow {
  key: string;
  expense_type: "corporate_card" | "personal_card" | "cash";
  expense_date: string;
  vendor_name: string;
  category_detail: string;
  specification: string;
  quantity: string;
  unit_price: string;
  amount: string;
  currency: string;
  companion_note: string;
  expense_purpose: string;
  remark: string;
  existingReceipts: BusinessTripExpenseReceipt[];
  newReceiptFiles: File[];
  starts_new_receipt_group: boolean;
}

interface MileageFormRow {
  key: string;
  travel_date: string;
  origin: string;
  destination: string;
  distance_km: string;
  description: string;
  mileage_unit_amount: string;
}

interface AllowanceFormRow {
  key: string;
  person_name: string;
  region: "Domestic" | "Overseas";
  day_count: string;
  unit_amount: string;
}

interface BusinessTripTabProps {
  mode?: "list" | "create";
  onBadgeRefresh?: () => void;
}

const newKey = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const MAX_KRW_AMOUNT = 1_000_000_000;
const MAX_DISTANCE_KM = 1_000;

const toNumber = (v: string) => {
  const n = Number((v || "").toString().replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

const formatKrwInput = (value: string, max = MAX_KRW_AMOUNT) => {
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return "";
  const clamped = Math.min(Number(digits), max);
  return clamped.toLocaleString("ko-KR");
};

const formatDistanceInput = (value: string, max = MAX_DISTANCE_KM) => {
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return "";
  const clamped = Math.min(Number(digits), max);
  return clamped.toLocaleString("ko-KR");
};

const normalizeMonthDay = (value: string) => {
  const digits = value.replace(/[^0-9]/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
};

const toMonthDay = (value?: string | null) => {
  if (!value) return "";
  if (/^\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return format(d, "MM-dd");
};

const toIsoDateByTripYear = (monthDay: string, tripStartDate?: string) => {
  const normalized = normalizeMonthDay(monthDay);
  if (!/^\d{2}-\d{2}$/.test(normalized)) {
    return tripStartDate || format(new Date(), "yyyy-MM-dd");
  }
  const [mm, dd] = normalized.split("-").map(Number);
  const year = tripStartDate ? new Date(tripStartDate).getFullYear() : new Date().getFullYear();
  const date = new Date(year, mm - 1, dd);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== mm - 1 ||
    date.getDate() !== dd
  ) {
    return tripStartDate || format(new Date(), "yyyy-MM-dd");
  }
  return format(date, "yyyy-MM-dd");
};

const toSafeFileName = (fileName: string) => {
  const hasDot = fileName.lastIndexOf(".") > 0;
  const ext = hasDot ? fileName.slice(fileName.lastIndexOf(".")).replace(/[^a-zA-Z0-9.]/g, "") : "";
  const base = hasDot ? fileName.slice(0, fileName.lastIndexOf(".")) : fileName;
  const safeBase = base.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").slice(0, 40) || "receipt";
  return `${safeBase}${ext}`;
};


const formatDateRangeLabel = (from?: Date, to?: Date) => {
  if (!from) return "선택";
  if (to && to.getTime() !== from.getTime()) {
    return `${format(from, "yyyy-MM-dd")} ~ ${format(to, "yyyy-MM-dd")}`;
  }
  return format(from, "yyyy-MM-dd");
};

export default function BusinessTripTab({ mode = "list", onBadgeRefresh }: BusinessTripTabProps) {
  const supabase = createClient();
  const isCreateMode = mode === "create";

  const [trips, setTrips] = useState<BusinessTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);

  // 신규 출장 신청 모달
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [formDepartment, setFormDepartment] = useState("");
  const [formProjectName, setFormProjectName] = useState("");
  const [formPurpose, setFormPurpose] = useState("");
  const [formDestination, setFormDestination] = useState("");
  const [formDateRange, setFormDateRange] = useState<DateRange | undefined>(undefined);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [formCompanions, setFormCompanions] = useState<CompanionOption[]>([]);
  const [formTransportType, setFormTransportType] = useState<BusinessTrip["transport_type"]>("public_transport");
  const [formTransportDetail, setFormTransportDetail] = useState<string>("");
  const [formCardNumber, setFormCardNumber] = useState<string | null>(null);
  const [formExpectedAmount, setFormExpectedAmount] = useState("");
  const [formPrecheckNote, setFormPrecheckNote] = useState("");
  const [vehicleSchedules, setVehicleSchedules] = useState<VehicleScheduleRow[]>([]);

  // 반려 다이얼로그 (사전승인/정산 공용)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTargetTripId, setRejectTargetTripId] = useState<number | null>(null);
  const [rejectMode, setRejectMode] = useState<"approval" | "settlement">("approval");
  const [rejectReason, setRejectReason] = useState("");

  // 정산 모달
  const [settlementTrip, setSettlementTrip] = useState<BusinessTrip | null>(null);
  const [settlementViewOnly, setSettlementViewOnly] = useState(false);
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [settlementSaving, setSettlementSaving] = useState(false);
  const [expenseRows, setExpenseRows] = useState<ExpenseFormRow[]>([]);
  const [vendors, setVendors] = useState<{ id: number; vendor_name: string }[]>([]);
  const [mileageRows, setMileageRows] = useState<MileageFormRow[]>([]);
  const [allowanceRows, setAllowanceRows] = useState<AllowanceFormRow[]>([]);
  const [receiptViewerRowKey, setReceiptViewerRowKey] = useState<string | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const [receiptPreviewPath, setReceiptPreviewPath] = useState<string>("");
  const [receiptPreviewLoading, setReceiptPreviewLoading] = useState(false);
  const [directReceiptList, setDirectReceiptList] = useState<{ id: number; receipt_url: string }[]>([]);
  const [directReceiptIdx, setDirectReceiptIdx] = useState(0);

  // react-select 휠 스크롤 보정
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      const target = e.target as HTMLElement;
      const closestMenuList = target.closest("[class*='menuList']") || target.closest("[class*='menu-list']");
      if (closestMenuList) {
        (closestMenuList as HTMLElement).scrollTop += e.deltaY;
      }
    };
    document.addEventListener("wheel", handler, { passive: true });
    return () => document.removeEventListener("wheel", handler);
  }, []);

  const roles = useMemo(() => parseRoles(currentUser?.roles), [currentUser?.roles]);
  const isAppAdmin = useMemo(() => roles.includes("superadmin"), [roles]);

  const canApproveTrip = useCallback((trip: BusinessTrip) => {
    const isHighAmount = Number(trip.expected_total_amount || 0) >= 1_000_000;
    if (isHighAmount) {
      return roles.some((r) => HIGH_AMOUNT_APPROVER_ROLES.includes(r));
    }
    return roles.some((r) => TRIP_APPROVER_ROLES.includes(r));
  }, [roles]);

  const canApproveSettlement = useMemo(
    () => roles.some((r) => SETTLEMENT_APPROVER_ROLES.includes(r)),
    [roles]
  );

  const companionOptions = useMemo(
    () =>
      employees
        .filter((e) => e.id !== currentUser?.id && e.name)
        .map((e) => ({
          value: e.id,
          label: `${e.name}${e.department ? ` (${e.department})` : ""}`,
        })),
    [employees, currentUser?.id]
  );

  const departmentOptions = useMemo(() => {
    const depts = new Set<string>();
    for (const e of employees) {
      if (e.department) depts.add(e.department);
    }
    return Array.from(depts).sort().map((d) => ({ value: d, label: d }));
  }, [employees]);

  const selectedTripRange = useMemo(() => {
    if (!formDateRange?.from) return null;
    const from = new Date(formDateRange.from);
    const to = formDateRange.to ? new Date(formDateRange.to) : new Date(formDateRange.from);
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }, [formDateRange?.from, formDateRange?.to]);

  const availableCompanyVehicles = useMemo(() => {
    const fallback = new Date();
    const windowStart = selectedTripRange?.from || fallback;
    const windowEnd = selectedTripRange?.to || fallback;

    return COMPANY_VEHICLES.filter((vehicle) => {
      if (VEHICLE_FIXED_STATUS[vehicle.label]?.status === "away") return false;

      const hasOverlappingApprovedRequest = vehicleSchedules.some((req) => {
        if (req.approval_status !== "approved") return false;
        if (!req.vehicle_info?.startsWith(vehicle.label)) return false;
        const reqStart = new Date(req.start_at);
        const reqEnd = new Date(req.end_at);
        if (Number.isNaN(reqStart.getTime()) || Number.isNaN(reqEnd.getTime())) return false;
        return reqStart <= windowEnd && reqEnd >= windowStart;
      });

      return !hasOverlappingApprovedRequest;
    });
  }, [selectedTripRange, vehicleSchedules]);

  useEffect(() => {
    if (formTransportType === "company_vehicle") {
      if (
        formTransportDetail &&
        !availableCompanyVehicles.some((v) => v.value === formTransportDetail)
      ) {
        setFormTransportDetail("");
      }
      return;
    }

    if (formTransportType === "private_car") {
      if (formTransportDetail) setFormTransportDetail("");
      return;
    }

    if (formTransportType === "public_transport") {
      if (formTransportDetail && !PUBLIC_TRANSPORT_OPTIONS.some((o) => o.value === formTransportDetail)) {
        setFormTransportDetail("");
      }
    }
  }, [availableCompanyVehicles, formTransportDetail, formTransportType]);

  const loadTrips = useCallback(async () => {
    try {
      setLoading(true);
      const [{ data: tripData, error: tripError }, { data: scheduleData, error: scheduleError }] = await Promise.all([
        supabase
          .from("business_trips")
          .select("*, requester:employees!business_trips_requester_id_fkey(name, department)")
          .order("created_at", { ascending: false }),
        supabase
          .from("vehicle_requests")
          .select("id, vehicle_info, approval_status, start_at, end_at")
          .in("approval_status", ["approved", "pending"]),
      ]);
      if (tripError) throw tripError;
      if (scheduleError) throw scheduleError;

      setVehicleSchedules((scheduleData || []) as VehicleScheduleRow[]);

      const baseTrips = ((tripData || []) as BusinessTrip[]);
      if (baseTrips.length === 0) {
        setTrips([]);
        return;
      }

      const tripIds = baseTrips.map((t) => t.id);
      const [{ data: cardLinks, error: cardError }, { data: vehicleLinks, error: vehicleError }] = await Promise.all([
        supabase
          .from("card_usages")
          .select("id, business_trip_id, card_number, approval_status, card_returned")
          .in("business_trip_id", tripIds),
        supabase
          .from("vehicle_requests")
          .select("id, business_trip_id, vehicle_info, approval_status")
          .in("business_trip_id", tripIds)
          .order("created_at", { ascending: false }),
      ]);
      if (cardError) throw cardError;
      if (vehicleError) throw vehicleError;

      const cardMap = new Map<number, CardUsageLink>();
      ((cardLinks || []) as CardUsageLink[]).forEach((c) => {
        if (c.business_trip_id && !cardMap.has(c.business_trip_id)) {
          cardMap.set(c.business_trip_id, c as CardUsageLink);
        }
      });

      const vehicleMap = new Map<number, VehicleUsageLink>();
      ((vehicleLinks || []) as VehicleUsageLink[]).forEach((v) => {
        if (v.business_trip_id && !vehicleMap.has(v.business_trip_id)) {
          vehicleMap.set(v.business_trip_id, v as VehicleUsageLink);
        }
      });

      setTrips(
        baseTrips.map((t) => ({
          ...t,
          linkedCard: cardMap.get(t.id) || null,
          linkedVehicle: vehicleMap.get(t.id) || null,
        }))
      );
    } catch (err) {
      logger.error("출장 목록 조회 실패", err);
      toast.error("출장 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const loadEmployees = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("employees")
        .select("id, name, department, position, email, roles")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      setEmployees((data || []) as Employee[]);
    } catch (err) {
      logger.error("직원 목록 조회 실패", err);
    }
  }, [supabase]);

  const loadVendors = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("vendors")
        .select("id, vendor_name")
        .order("vendor_name");
      if (error) throw error;
      setVendors((data || []) as { id: number; vendor_name: string }[]);
    } catch (err) {
      logger.error("업체 목록 조회 실패", err);
    }
  }, [supabase]);

  const loadCurrentUser = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.email) return;

      const { data, error } = await supabase
        .from("employees")
        .select("id, name, department, position, email, roles")
        .eq("email", user.email)
        .single();
      if (error) throw error;
      if (data) setCurrentUser(data as Employee);
    } catch (err) {
      logger.error("현재 사용자 조회 실패", err);
    }
  }, [supabase]);

  useEffect(() => {
    loadTrips();
    loadEmployees();
    loadCurrentUser();
    loadVendors();
  }, [loadTrips, loadEmployees, loadCurrentUser, loadVendors]);

  const sortedTrips = useMemo(() => {
    return [...trips].sort((a, b) => {
      if (a.approval_status === "pending" && b.approval_status !== "pending") return -1;
      if (a.approval_status !== "pending" && b.approval_status === "pending") return 1;
      return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
    });
  }, [trips]);

  const pendingApprovalCount = useMemo(() => trips.filter((t) => t.approval_status === "pending").length, [trips]);
  const settlementSubmittedCount = useMemo(
    () => trips.filter((t) => t.approval_status === "approved" && t.settlement_status === "submitted").length,
    [trips]
  );
  const cardRequestedCount = useMemo(
    () => trips.filter((t) => Boolean(t.requested_card_number?.trim()) || Boolean(t.linkedCard)).length,
    [trips]
  );
  const vehicleRequestedCount = useMemo(
    () => trips.filter((t) => t.transport_type === "company_vehicle" || Boolean(t.linkedVehicle)).length,
    [trips]
  );
  const tripInProgressCount = useMemo(
    () => trips.filter((t) => t.approval_status === "approved" && ["draft", "submitted", "rejected"].includes(t.settlement_status)).length,
    [trips]
  );

  const resetRequestForm = useCallback(() => {
    setFormDepartment(currentUser?.department || "");
    setFormProjectName("");
    setFormPurpose("");
    setFormDestination("");
    setFormDateRange(undefined);
    setFormCompanions([]);
    setFormTransportType("public_transport");
    setFormTransportDetail("");
    setFormCardNumber(null);
    setFormExpectedAmount("");
    setFormPrecheckNote("");
  }, [currentUser?.department]);

  useEffect(() => {
    if (isCreateMode) {
      resetRequestForm();
    }
  }, [isCreateMode, resetRequestForm]);

  // currentUser 로드 후 사용부서가 비어있으면 자동 설정
  useEffect(() => {
    if (isCreateMode && currentUser?.department && !formDepartment) {
      setFormDepartment(currentUser.department);
    }
  }, [isCreateMode, currentUser?.department, formDepartment]);

  const tripButtonDisabled = requestSubmitting || !formDepartment || !formProjectName.trim() || !formPurpose.trim() || !formDestination.trim() || !formDateRange?.from || (formTransportType === "company_vehicle" && !formTransportDetail) || (formTransportType === "public_transport" && !formTransportDetail) || (formTransportType === "other" && !formTransportDetail.trim());

  const handleCreateTrip = useCallback(async () => {
    const startDate = formDateRange?.from;
    const endDate = formDateRange?.to ?? formDateRange?.from;
    if (!formDepartment || !formProjectName.trim() || !formPurpose.trim() || !formDestination.trim() || !startDate || !endDate) {
      toast.error("필수 항목을 입력해주세요.");
      return;
    }
    if (formTransportType === "company_vehicle" && !formTransportDetail) {
      toast.error("회사차량 이용 시 차량을 선택해주세요.");
      return;
    }
    if (formTransportType === "public_transport" && !formTransportDetail) {
      toast.error("대중교통 이용 시 상세 수단을 선택해주세요.");
      return;
    }
    if (formTransportType === "other" && !formTransportDetail.trim()) {
      toast.error("기타 이동수단 내용을 입력해주세요.");
      return;
    }

    const selectedCompanions = formCompanions
      .map((c) => {
        const emp = employees.find((e) => e.id === c.value);
        return emp ? { id: emp.id, name: emp.name || "" } : null;
      })
      .filter(Boolean) as { id: string; name: string }[];

    try {
      setRequestSubmitting(true);
      const { data: insertedTrip, error } = await supabase.from("business_trips").insert({
        requester_id: currentUser?.id || null,
        requester_name: currentUser?.name || null,
        requester_position: currentUser?.position || null,
        request_department: formDepartment,
        project_name: formProjectName.trim() || null,
        trip_purpose: formPurpose.trim(),
        trip_destination: formDestination.trim(),
        trip_start_date: format(startDate, "yyyy-MM-dd"),
        trip_end_date: format(endDate, "yyyy-MM-dd"),
        companions: selectedCompanions,
        travelers: [currentUser?.name, ...selectedCompanions.map((c: { name: string }) => c.name)].filter(Boolean),
        transport_type: formTransportType,
        requested_vehicle_info:
          formTransportType === "private_car"
            ? null
            : (formTransportType === "other" ? formTransportDetail.trim() : formTransportDetail) || null,
        vehicle_name:
          formTransportType === "company_vehicle"
            ? COMPANY_VEHICLES.find((v) => v.value === formTransportDetail)?.label || formTransportDetail.split(" ")[0] || null
            : formTransportType === "public_transport"
              ? formTransportDetail || null
              : formTransportType === "private_car"
                ? "자차"
                : formTransportDetail.trim().split(" ")[0] || null,
        request_corporate_card: Boolean(formCardNumber),
        requested_card_number: formCardNumber,
        expected_total_amount: toNumber(formExpectedAmount),
        precheck_note: formPrecheckNote.trim() || null,
      }).select("id").single();
      if (error) throw error;

      // 회사차량 선택 시 vehicle_requests에 승인대기 상태로 자동 생성
      if (insertedTrip && formTransportType === "company_vehicle" && formTransportDetail) {
        const tripStartAt = new Date(startDate);
        tripStartAt.setHours(9, 0, 0, 0);
        const tripEndAt = new Date(endDate);
        tripEndAt.setHours(18, 0, 0, 0);

        await supabase.from("vehicle_requests").insert({
          business_trip_id: insertedTrip.id,
          auto_created_by_trip: true,
          requester_id: currentUser?.id || null,
          use_department: formDepartment,
          purpose: formPurpose.trim(),
          vehicle_info: formTransportDetail,
          route: formDestination.trim(),
          driver_id: currentUser?.id || null,
          companions: selectedCompanions,
          passenger_count: 1 + selectedCompanions.length,
          start_at: tripStartAt.toISOString(),
          end_at: tripEndAt.toISOString(),
          notes: `출장 자동생성 (${formProjectName.trim() || ""})`,
        });
      }

      if (isCreateMode) {
        resetRequestForm();
      } else {
        setIsRequestModalOpen(false);
      }
      loadTrips();
      onBadgeRefresh?.();
      setSuccessDialogOpen(true);
    } catch (err) {
      logger.error("출장 요청 등록 실패", err);
      toast.error("출장 요청 등록에 실패했습니다.");
    } finally {
      setRequestSubmitting(false);
    }
  }, [
    currentUser?.id,
    employees,
    formCardNumber,
    formTransportDetail,
    formCompanions,
    formDateRange,
    formDepartment,
    formDestination,
    formExpectedAmount,
    formPrecheckNote,
    formProjectName,
    formPurpose,
    formTransportType,
    loadTrips,
    isCreateMode,
    resetRequestForm,
    supabase,
  ]);

  const handleDeleteTrip = useCallback(async (tripId: number) => {
    try {
      if (!confirm("이 출장을 삭제하면 연결된 카드사용/차량배차도 함께 삭제됩니다.\n\n정말 삭제하시겠습니까?")) return;

      // CASCADE 설정으로 연결된 card_usages, vehicle_requests 자동 삭제
      const { error } = await supabase.from("business_trips").delete().eq("id", tripId);
      if (error) throw error;

      toast.success("출장 요청이 삭제되었습니다.");
      loadTrips();
      onBadgeRefresh?.();
    } catch (err) {
      logger.error("출장 요청 삭제 실패", err);
      toast.error("출장 요청 삭제에 실패했습니다.");
    }
  }, [loadTrips, supabase]);

  const handleApproveTrip = useCallback(async (tripId: number) => {
    try {
      const { error } = await supabase
        .from("business_trips")
        .update({
          approval_status: "approved",
          approved_by: currentUser?.id || null,
          approved_at: new Date().toISOString(),
          rejection_reason: null,
        })
        .eq("id", tripId);
      if (error) throw error;

      // 연결된 차량 요청이 있으면 자동 승인 처리
      const { data: linkedVehicle } = await supabase
        .from("vehicle_requests")
        .select("id")
        .eq("business_trip_id", tripId)
        .eq("approval_status", "pending")
        .maybeSingle();

      if (linkedVehicle) {
        await supabase
          .from("vehicle_requests")
          .update({
            approval_status: "approved",
            approved_by: currentUser?.id || null,
            approved_at: new Date().toISOString(),
          })
          .eq("id", linkedVehicle.id);
        toast.success("출장이 승인되었습니다. 차량 배차도 자동 승인되었습니다.");
      } else {
        toast.success("출장 요청이 승인되었습니다.");
      }

      loadTrips();
      onBadgeRefresh?.();
    } catch (err) {
      logger.error("출장 승인 실패", err);
      toast.error("승인 처리에 실패했습니다.");
    }
  }, [currentUser?.id, loadTrips, supabase]);

  const openRejectDialog = useCallback((tripId: number, mode: "approval" | "settlement") => {
    setRejectTargetTripId(tripId);
    setRejectMode(mode);
    setRejectReason("");
    setRejectDialogOpen(true);
  }, []);

  const handleReject = useCallback(async () => {
    if (!rejectTargetTripId) return;
    if (!rejectReason.trim()) {
      toast.error("반려 사유를 입력해주세요.");
      return;
    }
    try {
      if (rejectMode === "approval") {
        const { error } = await supabase
          .from("business_trips")
          .update({
            approval_status: "rejected",
            approved_by: currentUser?.id || null,
            approved_at: new Date().toISOString(),
            rejection_reason: rejectReason.trim(),
          })
          .eq("id", rejectTargetTripId);
        if (error) throw error;

        // 연결된 차량 요청도 자동 반려
        await supabase
          .from("vehicle_requests")
          .update({
            approval_status: "rejected",
            approved_by: currentUser?.id || null,
            approved_at: new Date().toISOString(),
            rejection_reason: `출장 반려: ${rejectReason.trim()}`,
          })
          .eq("business_trip_id", rejectTargetTripId)
          .eq("approval_status", "pending");

        toast.success("출장 승인 반려 처리되었습니다.");
      } else {
        const { error } = await supabase
          .from("business_trips")
          .update({
            settlement_status: "rejected",
            settlement_rejection_reason: rejectReason.trim(),
            settlement_approved_by: currentUser?.id || null,
            settlement_approved_at: new Date().toISOString(),
          })
          .eq("id", rejectTargetTripId);
        if (error) throw error;
        toast.success("정산 반려 처리되었습니다.");
      }
      setRejectDialogOpen(false);
      setRejectTargetTripId(null);
      setRejectReason("");
      loadTrips();
      onBadgeRefresh?.();
    } catch (err) {
      logger.error("반려 처리 실패", err);
      toast.error("반려 처리에 실패했습니다.");
    }
  }, [currentUser?.id, loadTrips, rejectMode, rejectReason, rejectTargetTripId, supabase]);

  const [settlementApproveConfirmOpen, setSettlementApproveConfirmOpen] = useState(false);
  const [settlementApproveTargetId, setSettlementApproveTargetId] = useState<number | null>(null);

  const requestApproveSettlement = useCallback((tripId: number) => {
    setSettlementApproveTargetId(tripId);
    setSettlementApproveConfirmOpen(true);
  }, []);

  const handleApproveSettlement = useCallback(async () => {
    if (!settlementApproveTargetId) return;
    try {
      const { error } = await supabase
        .from("business_trips")
        .update({
          settlement_status: "approved",
          settlement_approved_by: currentUser?.id || null,
          settlement_approved_at: new Date().toISOString(),
          settlement_rejection_reason: null,
        })
        .eq("id", settlementApproveTargetId);
      if (error) throw error;

      const trip = trips.find((t) => t.id === settlementApproveTargetId);
      if (trip?.linkedCard?.id) {
        const { error: cardError } = await supabase
          .from("card_usages")
          .update({
            card_returned: true,
            card_returned_at: new Date().toISOString(),
            card_returned_by: currentUser?.id || null,
            approval_status: "returned",
          })
          .eq("id", trip.linkedCard.id);
        if (cardError) {
          logger.warn("카드 반납 처리 실패 (정산 승인은 완료)", { cardError });
        }
      }

      toast.success("정산 승인 및 카드 반납 처리가 완료되었습니다.");
      setSettlementApproveConfirmOpen(false);
      setSettlementApproveTargetId(null);
      setSettlementTrip(null);
      setSettlementViewOnly(false);
      loadTrips();
      onBadgeRefresh?.();
    } catch (err) {
      logger.error("정산 승인 실패", err);
      toast.error("정산 승인에 실패했습니다.");
    }
  }, [currentUser?.id, loadTrips, onBadgeRefresh, settlementApproveTargetId, supabase, trips]);

  const getTripDateRange = useCallback((trip?: BusinessTrip | null): string[] => {
    if (!trip?.trip_start_date || !trip?.trip_end_date) return [];
    const start = new Date(trip.trip_start_date);
    const end = new Date(trip.trip_end_date);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
    const dates: string[] = [];
    const cur = new Date(start);
    while (cur <= end && dates.length < 60) {
      dates.push(format(cur, "MM-dd"));
      cur.setDate(cur.getDate() + 1);
    }
    return dates.length > 0 ? dates : [toMonthDay(trip.trip_start_date) || ""];
  }, []);

  const createEmptyExpense = useCallback((trip?: BusinessTrip | null, dateStr?: string, startsNewReceiptGroup = false): ExpenseFormRow => ({
    key: newKey(),
    expense_type: "corporate_card",
    expense_date: dateStr ?? toMonthDay(trip?.trip_start_date),
    vendor_name: "",
    category_detail: "",
    specification: "",
    quantity: "1",
    unit_price: "",
    amount: "",
    currency: "KRW",
    companion_note: "",
    expense_purpose: "",
    remark: "",
    existingReceipts: [],
    newReceiptFiles: [],
    starts_new_receipt_group: startsNewReceiptGroup,
  }), []);

  const createEmptyMileage = useCallback((trip?: BusinessTrip | null, dateStr?: string): MileageFormRow => ({
    key: newKey(),
    travel_date: dateStr ?? toMonthDay(trip?.trip_start_date),
    origin: "",
    destination: "",
    distance_km: "",
    description: "",
    mileage_unit_amount: "300",
  }), []);

  const createEmptyAllowance = useCallback((personName = ""): AllowanceFormRow => ({
    key: newKey(),
    person_name: personName,
    region: "Domestic",
    day_count: "",
    unit_amount: "",
  }), []);

  const openSettlementModal = useCallback(async (trip: BusinessTrip, viewOnly = false) => {
    try {
      setSettlementTrip(trip);
      setSettlementViewOnly(viewOnly);
      setSettlementLoading(true);
      setSettlementSaving(false);

      const [expenseRes, mileageRes, allowanceRes] = await Promise.all([
        supabase
          .from("business_trip_expenses")
          .select("*")
          .eq("business_trip_id", trip.id)
          .order("line_order", { ascending: true }),
        supabase
          .from("business_trip_mileages")
          .select("*")
          .eq("business_trip_id", trip.id)
          .order("line_order", { ascending: true }),
        supabase
          .from("business_trip_allowances")
          .select("*")
          .eq("business_trip_id", trip.id)
          .order("line_order", { ascending: true }),
      ]);

      if (expenseRes.error) throw expenseRes.error;
      if (mileageRes.error) throw mileageRes.error;
      if (allowanceRes.error) throw allowanceRes.error;

      const expenseData = (expenseRes.data || []) as BusinessTripExpense[];
      const mileageData = (mileageRes.data || []) as BusinessTripMileage[];
      const allowanceData = (allowanceRes.data || []) as BusinessTripAllowance[];

      const receiptMap = new Map<number, BusinessTripExpenseReceipt[]>();
      if (expenseData.length > 0) {
        const expenseIds = expenseData.map((e) => e.id);
        const { data: receiptData, error: receiptError } = await supabase
          .from("business_trip_expense_receipts")
          .select("id, business_trip_expense_id, receipt_url")
          .in("business_trip_expense_id", expenseIds);
        if (receiptError) throw receiptError;

        ((receiptData || []) as BusinessTripExpenseReceipt[]).forEach((r) => {
          const prev = receiptMap.get(r.business_trip_expense_id) || [];
          prev.push(r);
          receiptMap.set(r.business_trip_expense_id, prev);
        });
      }

      // 기존 정산 비용 데이터가 없을 때, 모바일에서 업로드한 카드사용 영수증 자동 반영
      let mobileReceiptRows: ExpenseFormRow[] = [];
      if (expenseData.length === 0 && trip.linkedCard?.id) {
        const { data: cardReceipts } = await supabase
          .from("card_usage_receipts")
          .select("id, card_usage_id, receipt_url, merchant_name, item_name, specification, quantity, unit_price, total_amount, remark, created_at")
          .eq("card_usage_id", trip.linkedCard.id)
          .order("created_at", { ascending: true });

        if (cardReceipts && cardReceipts.length > 0) {
          // receipt_url 기준으로 그룹 구분 (같은 영수증의 품목들을 묶음)
          const seenUrls = new Set<string>();
          mobileReceiptRows = cardReceipts.map((cr: {
            id: number; receipt_url: string; merchant_name: string | null;
            specification: string | null;
            item_name: string | null; quantity: number | null;
            unit_price: number | null; total_amount: number | null;
            remark: string | null;
          }) => {
            const isFirstOfGroup = !seenUrls.has(cr.receipt_url);
            if (cr.receipt_url) seenUrls.add(cr.receipt_url);
            return {
              key: `mobile-${cr.id}-${newKey()}`,
              expense_type: "corporate_card" as const,
              expense_date: toMonthDay(trip.trip_start_date),
              vendor_name: cr.merchant_name || "",
              category_detail: cr.item_name || "",
              specification: cr.specification || "",
              quantity: String(cr.quantity ?? 1),
              unit_price: cr.unit_price != null ? Number(cr.unit_price).toLocaleString("ko-KR") : "",
              amount: cr.total_amount != null ? Number(cr.total_amount).toLocaleString("ko-KR") : "",
              currency: "KRW",
              companion_note: "",
              expense_purpose: "",
              remark: cr.remark || "",
              existingReceipts: isFirstOfGroup && cr.receipt_url
                ? [{ id: cr.id, business_trip_expense_id: 0, receipt_url: cr.receipt_url }]
                : [],
              newReceiptFiles: [],
              starts_new_receipt_group: isFirstOfGroup,
            };
          });
        }
      }

      setExpenseRows(
        expenseData.length > 0
          ? (() => {
              const seenReceiptUrls = new Set<string>();
              return expenseData.map((r) => {
                const receipts = receiptMap.get(r.id) || [];
                const firstReceiptUrl = receipts[0]?.receipt_url;
                const isNewGroup = firstReceiptUrl ? !seenReceiptUrls.has(firstReceiptUrl) : receipts.length > 0;
                if (firstReceiptUrl) seenReceiptUrls.add(firstReceiptUrl);
                return {
                  key: `exp-${r.id}-${newKey()}`,
                  expense_type: r.expense_type,
                  expense_date: toMonthDay(r.expense_date),
                  vendor_name: r.vendor_name || "",
                  category_detail: r.category_detail || "",
                  specification: r.specification || "",
                  quantity: String(r.quantity ?? 1),
                  unit_price: r.unit_price != null ? String(r.unit_price) : "",
                  amount: r.amount != null ? Number(r.amount).toLocaleString("ko-KR") : "",
                  currency: r.currency || "KRW",
                  companion_note: r.companion_note || "",
                  expense_purpose: r.expense_purpose || "",
                  remark: r.remark || "",
                  existingReceipts: receipts,
                  newReceiptFiles: [],
                  starts_new_receipt_group: isNewGroup,
                };
              });
            })()
          : mobileReceiptRows.length > 0
            ? mobileReceiptRows
            : (trip.requested_card_number?.trim() || trip.linkedCard)
              ? [createEmptyExpense(trip)]
              : []
      );

      setMileageRows(
        mileageData.length > 0
          ? mileageData.map((r) => ({
              key: `mil-${r.id}-${newKey()}`,
              travel_date: toMonthDay(r.travel_date),
              origin: r.origin || "",
              destination: r.destination || "",
              distance_km: r.distance_km != null ? Number(r.distance_km).toLocaleString("ko-KR") : "",
              description: r.description || "",
              mileage_unit_amount:
                r.mileage_unit_amount != null
                  ? Number(r.mileage_unit_amount).toLocaleString("ko-KR")
                  : "300",
            }))
          : [createEmptyMileage(trip)]
      );

      setAllowanceRows(
        allowanceData.length > 0
          ? allowanceData.map((r) => ({
              key: `all-${r.id}-${newKey()}`,
              person_name: r.person_name || "",
              region: r.region,
              day_count: String(r.day_count ?? ""),
              unit_amount:
                r.unit_amount != null
                  ? Number(r.unit_amount).toLocaleString("ko-KR")
                  : "",
            }))
          : (() => {
              const travelers = [trip.requester?.name, ...(trip.companions?.map((c) => c.name) || [])].filter(Boolean) as string[];
              return travelers.length > 0
                ? travelers.map((name) => createEmptyAllowance(name))
                : [createEmptyAllowance()];
            })()
      );
    } catch (err) {
      logger.error("정산 데이터 로딩 실패", err);
      toast.error("정산 데이터를 불러오지 못했습니다.");
    } finally {
      setSettlementLoading(false);
    }
  }, [createEmptyAllowance, createEmptyExpense, createEmptyMileage, supabase]);

  const closeSettlementModal = useCallback(() => {
    setSettlementTrip(null);
    setSettlementViewOnly(false);
    setExpenseRows([]);
    setMileageRows([]);
    setAllowanceRows([]);
    setReceiptViewerRowKey(null);
    setReceiptPreviewUrl(null);
    setReceiptPreviewPath("");
    setReceiptPreviewLoading(false);
    setSettlementSaving(false);
    setSettlementLoading(false);
  }, []);

  const hasSettlementData = useMemo(() => {
    const hasExpense = expenseRows.some(
      (r) =>
        r.vendor_name.trim() ||
        r.category_detail.trim() ||
        r.specification.trim() ||
        toNumber(r.amount) > 0 ||
        r.existingReceipts.length > 0 ||
        r.newReceiptFiles.length > 0
    );
    const hasMileage = mileageRows.some((r) => r.origin.trim() || r.destination.trim() || toNumber(r.distance_km) > 0);
    const hasAllowance = allowanceRows.some((r) => toNumber(r.day_count) > 0 || toNumber(r.unit_amount) > 0);
    return hasExpense || hasMileage || hasAllowance;
  }, [allowanceRows, expenseRows, mileageRows]);

  const expenseTotal = useMemo(
    () => expenseRows.reduce((sum, r) => sum + toNumber(r.amount), 0),
    [expenseRows]
  );
  const mileageTotal = useMemo(
    () => mileageRows.reduce((sum, r) => sum + toNumber(r.distance_km) * 300, 0),
    [mileageRows]
  );
  const allowanceTotal = useMemo(
    () => allowanceRows.reduce((sum, r) => sum + toNumber(r.day_count) * toNumber(r.unit_amount), 0),
    [allowanceRows]
  );
  const grandTotal = useMemo(() => expenseTotal + mileageTotal + allowanceTotal, [expenseTotal, mileageTotal, allowanceTotal]);
  const settlementYearLabel = useMemo(() => {
    if (!settlementTrip?.trip_start_date) return format(new Date(), "yyyy");
    const d = new Date(settlementTrip.trip_start_date);
    if (Number.isNaN(d.getTime())) return format(new Date(), "yyyy");
    return format(d, "yyyy");
  }, [settlementTrip?.trip_start_date]);

  const tripPeriod = useMemo(() => {
    if (!settlementTrip?.trip_start_date || !settlementTrip?.trip_end_date) return { start: "", end: "", sameDay: true };
    const s = new Date(settlementTrip.trip_start_date);
    const e = new Date(settlementTrip.trip_end_date);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return { start: "", end: "", sameDay: true };
    const startStr = format(s, "MM/dd");
    const endStr = format(e, "MM/dd");
    return { start: startStr, end: endStr, sameDay: startStr === endStr };
  }, [settlementTrip?.trip_start_date, settlementTrip?.trip_end_date]);

  const activeReceiptRow = useMemo(
    () => expenseRows.find((r) => r.key === receiptViewerRowKey) || null,
    [expenseRows, receiptViewerRowKey]
  );

  const handleExpenseReceiptFiles = useCallback((rowKey: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const incoming = Array.from(files);
    setExpenseRows((prev) =>
      prev.map((r) => {
        if (r.key !== rowKey) return r;
        const merged = [...r.newReceiptFiles];
        incoming.forEach((f) => {
          const exists = merged.some(
            (m) => m.name === f.name && m.size === f.size && m.lastModified === f.lastModified
          );
          if (!exists) merged.push(f);
        });
        return { ...r, newReceiptFiles: merged };
      })
    );
  }, []);

  const appendExpenseItemForSameReceipt = useCallback((rowKey: string) => {
    setExpenseRows((prev) => {
      const targetIdx = prev.findIndex((r) => r.key === rowKey);
      if (targetIdx < 0) return prev;

      const source = prev[targetIdx];
      const hasReceipt = source.existingReceipts.length > 0 || source.newReceiptFiles.length > 0;
      if (!hasReceipt) {
        toast.error("먼저 해당 행에 영수증을 첨부해주세요.");
        return prev;
      }

      const cloned: ExpenseFormRow = {
        ...source,
        key: newKey(),
        category_detail: "",
        specification: "",
        quantity: "1",
        unit_price: "",
        amount: "",
        remark: "",
        existingReceipts: [...source.existingReceipts],
        newReceiptFiles: [...source.newReceiptFiles],
        starts_new_receipt_group: false,
      };

      return [
        ...prev.slice(0, targetIdx + 1),
        cloned,
        ...prev.slice(targetIdx + 1),
      ];
    });
  }, []);

  const handleDeleteExistingReceipt = useCallback(async (rowKey: string, receipt: BusinessTripExpenseReceipt) => {
    if (!isAppAdmin) {
      toast.error("영수증 삭제는 superadmin만 가능합니다.");
      return;
    }
    try {
      const { error: deleteError } = await supabase
        .from("business_trip_expense_receipts")
        .delete()
        .eq("id", receipt.id);
      if (deleteError) throw deleteError;

      const { error: storageDeleteError } = await supabase.storage
        .from("business-trip-receipts")
        .remove([receipt.receipt_url]);

      if (storageDeleteError) {
        logger.warn("출장 영수증 스토리지 삭제 실패(메타 삭제는 완료)", { receiptId: receipt.id, path: receipt.receipt_url, storageDeleteError });
      }

      setExpenseRows((prev) =>
        prev.map((r) =>
          r.key === rowKey
            ? { ...r, existingReceipts: r.existingReceipts.filter((rec) => rec.id !== receipt.id) }
            : r
        )
      );
      toast.success("영수증이 삭제되었습니다.");
    } catch (err) {
      logger.error("출장 영수증 삭제 실패", err);
      toast.error("영수증 삭제에 실패했습니다.");
    }
  }, [isAppAdmin, supabase]);

  const parseTripReceiptStorageInfo = useCallback((rawReceiptPath: string) => {
    const normalizeRaw = (raw: string) => {
      let value = (raw || "").trim();
      if (value.startsWith("business-trip-receipts/http")) {
        value = value.replace(/^business-trip-receipts\//, "");
      }
      if (value.startsWith("card-receipts/http")) {
        value = value.replace(/^card-receipts\//, "");
      }
      return value;
    };

    const sanitizePath = (rawPath: string) => rawPath.replace(/^\/+/, "").split("?")[0].split("#")[0];
    const normalized = normalizeRaw(rawReceiptPath);

    if (!normalized) {
      return { bucket: "business-trip-receipts", path: "" };
    }

    if (normalized.startsWith("business-trip-receipts/")) {
      return { bucket: "business-trip-receipts", path: sanitizePath(normalized.replace("business-trip-receipts/", "")) };
    }

    if (normalized.startsWith("card-receipts/")) {
      return { bucket: "card-receipts", path: sanitizePath(normalized.replace("card-receipts/", "")) };
    }

    if (normalized.startsWith("card-usage/")) {
      return { bucket: "card-receipts", path: sanitizePath(normalized) };
    }

    return { bucket: "business-trip-receipts", path: sanitizePath(normalized) };
  }, []);

  const openReceiptPreview = useCallback(async (receiptPath: string) => {
    try {
      setReceiptPreviewLoading(true);
      // 모바일 업로드 영수증은 이미 전체 공개 URL로 저장됨
      if (receiptPath.startsWith("http")) {
        setReceiptPreviewPath(receiptPath);
        setReceiptPreviewUrl(receiptPath);
      } else {
        const storageInfo = parseTripReceiptStorageInfo(receiptPath);
        const { data, error } = await supabase.storage
          .from(storageInfo.bucket)
          .createSignedUrl(storageInfo.path, 3600);
        if (error) throw error;
        setReceiptPreviewPath(receiptPath);
        setReceiptPreviewUrl(data?.signedUrl || null);
      }
    } catch (err) {
      logger.error("출장 영수증 미리보기 URL 생성 실패", err);
      toast.error("영수증 미리보기에 실패했습니다.");
    } finally {
      setReceiptPreviewLoading(false);
    }
  }, [parseTripReceiptStorageInfo, supabase]);

  const openDirectReceipt = useCallback(async (receipts: { id: number; receipt_url: string }[], startIdx = 0) => {
    if (!receipts.length) return;
    setDirectReceiptList(receipts);
    setDirectReceiptIdx(startIdx);
    const target = receipts[startIdx];
    try {
      setReceiptPreviewLoading(true);
      if (target.receipt_url.startsWith("http")) {
        setReceiptPreviewPath(target.receipt_url);
        setReceiptPreviewUrl(target.receipt_url);
      } else {
        const storageInfo = parseTripReceiptStorageInfo(target.receipt_url);
        const { data, error } = await supabase.storage
          .from(storageInfo.bucket)
          .createSignedUrl(storageInfo.path, 3600);
        if (error) throw error;
        setReceiptPreviewPath(target.receipt_url);
        setReceiptPreviewUrl(data?.signedUrl || null);
      }
    } catch (err) {
      logger.error("출장 영수증 직접 열기 실패", err);
      toast.error("영수증을 불러오지 못했습니다.");
    } finally {
      setReceiptPreviewLoading(false);
    }
  }, [parseTripReceiptStorageInfo, supabase]);

  const navigateDirectReceipt = useCallback(async (idx: number) => {
    if (idx < 0 || idx >= directReceiptList.length) return;
    setDirectReceiptIdx(idx);
    const target = directReceiptList[idx];
    try {
      setReceiptPreviewLoading(true);
      setReceiptPreviewUrl(null);
      if (target.receipt_url.startsWith("http")) {
        setReceiptPreviewPath(target.receipt_url);
        setReceiptPreviewUrl(target.receipt_url);
      } else {
        const storageInfo = parseTripReceiptStorageInfo(target.receipt_url);
        const { data, error } = await supabase.storage
          .from(storageInfo.bucket)
          .createSignedUrl(storageInfo.path, 3600);
        if (error) throw error;
        setReceiptPreviewPath(target.receipt_url);
        setReceiptPreviewUrl(data?.signedUrl || null);
      }
    } catch (err) {
      logger.error("영수증 네비게이션 실패", err);
      toast.error("영수증을 불러오지 못했습니다.");
    } finally {
      setReceiptPreviewLoading(false);
    }
  }, [directReceiptList, parseTripReceiptStorageInfo, supabase]);

  // 발주번호 자동 생성 (CardUsageTab과 동일 로직)
  const generatePurchaseOrderNumber = useCallback(async () => {
    const today = new Date();
    const koreaTime = new Date(today.getTime() + (9 * 60 * 60 * 1000));
    const dateStr = koreaTime.toISOString().slice(0, 10).replace(/-/g, "");
    const prefix = `F${dateStr}_`;

    const { data: existingOrders, error: queryError } = await supabase
      .from("purchase_requests")
      .select("purchase_order_number")
      .like("purchase_order_number", `${prefix}%`)
      .order("purchase_order_number", { ascending: false });

    if (queryError) throw queryError;

    let maxSequence = 0;
    if (existingOrders && existingOrders.length > 0) {
      for (const order of existingOrders) {
        const parts = order.purchase_order_number.split("_");
        if (parts.length >= 2) {
          const sequence = parseInt(parts[1], 10);
          if (!Number.isNaN(sequence) && sequence > maxSequence) {
            maxSequence = sequence;
          }
        }
      }
    }

    return `${prefix}${String(maxSequence + 1).padStart(3, "0")}`;
  }, [supabase]);

  // 업체 조회 또는 자동 생성
  const findOrCreateVendor = useCallback(async (merchantName: string): Promise<number> => {
    const trimmed = merchantName.trim();
    const { data: existing } = await supabase
      .from("vendors")
      .select("id")
      .eq("vendor_name", trimmed)
      .limit(1)
      .single();

    if (existing) return existing.id;

    const { data: created, error } = await supabase
      .from("vendors")
      .insert({ vendor_name: trimmed })
      .select("id")
      .single();

    if (error || !created) throw error || new Error("업체 생성 실패");
    return created.id;
  }, [supabase]);

  const saveSettlement = useCallback(async (mode: "draft" | "submitted"): Promise<boolean> => {
    const hasCardRequest = Boolean(settlementTrip?.requested_card_number?.trim()) || Boolean(settlementTrip?.linkedCard);
    if (!settlementTrip) return false;
    if (mode === "submitted") {
      if (settlementTrip.approval_status !== "approved") {
        toast.error("출장 승인 후 정산 제출이 가능합니다.");
        return false;
      }
      if (!hasSettlementData) {
        if (hasCardRequest) {
          toast.error("정산 제출 전 카드사용내역에 '+ 새 영수증 행'을 추가하고 사용처/품명/합계를 1건 이상 입력해주세요.");
          return false;
        }
      }
      const filledExpenseRows = expenseRows.filter(
        (r) =>
          r.vendor_name.trim() ||
          r.category_detail.trim() ||
          r.specification.trim() ||
          toNumber(r.amount) > 0 ||
          r.existingReceipts.length > 0 ||
          r.newReceiptFiles.length > 0
      );
      for (let i = 0; i < filledExpenseRows.length; i += 1) {
        const r = filledExpenseRows[i];
        const missing: string[] = [];
        if (!r.vendor_name.trim()) missing.push("사용처");
        if (!r.category_detail.trim()) missing.push("품명");
        if (toNumber(r.amount) <= 0) missing.push("합계");
        if (missing.length > 0) {
          toast.error(`카드사용내역 ${i + 1}행: ${missing.join(", ")}을(를) 입력해주세요.`);
          return false;
        }
      }
    }

    try {
      setSettlementSaving(true);

      await Promise.all([
        supabase.from("business_trip_expenses").delete().eq("business_trip_id", settlementTrip.id),
        supabase.from("business_trip_mileages").delete().eq("business_trip_id", settlementTrip.id),
        supabase.from("business_trip_allowances").delete().eq("business_trip_id", settlementTrip.id),
      ]);

      const expenseRowsForSave = expenseRows.filter(
        (r) =>
          r.vendor_name.trim() ||
          r.category_detail.trim() ||
          r.specification.trim() ||
          toNumber(r.amount) > 0 ||
          r.existingReceipts.length > 0 ||
          r.newReceiptFiles.length > 0
      );

      const expensePayload = expenseRowsForSave.map((r, i) => ({
          business_trip_id: settlementTrip.id,
          line_order: i + 1,
          expense_type: r.expense_type,
          expense_date: settlementTrip.trip_start_date || format(new Date(), "yyyy-MM-dd"),
          vendor_name: r.vendor_name.trim() || "미입력",
          category_detail: r.category_detail.trim() || null,
          specification: r.specification.trim() || null,
          quantity: Math.max(toNumber(r.quantity), 1),
          unit_price: r.unit_price.trim() ? Math.min(toNumber(r.unit_price), MAX_KRW_AMOUNT) : null,
          amount: Math.min(toNumber(r.amount), MAX_KRW_AMOUNT),
          currency: "KRW",
          companion_note: null,
          expense_purpose: null,
          linked_card_usage_id: r.expense_type === "corporate_card" ? settlementTrip.linkedCard?.id || null : null,
          remark: r.remark.trim() || null,
        }));

      const mileagePayload = mileageRows
        .filter((r) => r.origin.trim() || r.destination.trim() || toNumber(r.distance_km) > 0)
        .map((r, i) => ({
          business_trip_id: settlementTrip.id,
          line_order: i + 1,
          travel_date: settlementTrip.trip_start_date || format(new Date(), "yyyy-MM-dd"),
          origin: r.origin.trim() || "미입력",
          destination: r.destination.trim() || "미입력",
          distance_km: toNumber(r.distance_km),
          description: r.description.trim() || null,
          mileage_unit_amount: 300,
        }));

      const allowancePayload = allowanceRows
        .filter((r) => toNumber(r.day_count) > 0 || toNumber(r.unit_amount) > 0)
        .map((r, i) => ({
          business_trip_id: settlementTrip.id,
          line_order: i + 1,
          person_name: r.person_name.trim(),
          region: r.region,
          day_count: toNumber(r.day_count),
          unit_amount: Math.min(toNumber(r.unit_amount), MAX_KRW_AMOUNT),
        }));

      if (mileagePayload.length > 0) {
        const { error } = await supabase.from("business_trip_mileages").insert(mileagePayload);
        if (error) throw error;
      }
      if (allowancePayload.length > 0) {
        const { error } = await supabase.from("business_trip_allowances").insert(allowancePayload);
        if (error) throw error;
      }

      const linkedCardUsageId = settlementTrip.linkedCard?.id || null;
      const autoGeneratedProjectItem = `출장정산자동생성:${settlementTrip.trip_code}`;
      if (linkedCardUsageId) {
        const { error: cardReceiptDeleteError } = await supabase
          .from("card_usage_receipts")
          .delete()
          .eq("card_usage_id", linkedCardUsageId)
          .like("receipt_url", "business-trip-receipts/%");
        if (cardReceiptDeleteError) throw cardReceiptDeleteError;
      }

      if (mode === "submitted" && linkedCardUsageId) {
        // 기존 자동생성 발주 정리 후 재생성 (중복 방지)
        const { data: existingAutoRequests, error: existingAutoReqError } = await supabase
          .from("purchase_requests")
          .select("id")
          .eq("card_usage_id", linkedCardUsageId)
          .eq("project_item", autoGeneratedProjectItem);
        if (existingAutoReqError) throw existingAutoReqError;

        const existingAutoRequestIds = (existingAutoRequests || []).map((r: { id: number }) => r.id);
        if (existingAutoRequestIds.length > 0) {
          const { error: deleteItemsError } = await supabase
            .from("purchase_request_items")
            .delete()
            .in("purchase_request_id", existingAutoRequestIds);
          if (deleteItemsError) throw deleteItemsError;

          const { error: deleteRequestsError } = await supabase
            .from("purchase_requests")
            .delete()
            .in("id", existingAutoRequestIds);
          if (deleteRequestsError) throw deleteRequestsError;
        }
      }

      if (expensePayload.length > 0) {
        const { data: insertedExpenses, error: insertedExpenseError } = await supabase
          .from("business_trip_expenses")
          .insert(expensePayload)
          .select("id, line_order");
        if (insertedExpenseError) throw insertedExpenseError;

        const lineOrderToExpenseId = new Map<number, number>();
        ((insertedExpenses || []) as { id: number; line_order: number }[]).forEach((row) =>
          lineOrderToExpenseId.set(row.line_order, row.id)
        );

        const receiptInsertPayload: { business_trip_expense_id: number; receipt_url: string }[] = [];
        const corporateCardReceiptPayload: {
          card_usage_id: number;
          receipt_url: string;
          merchant_name: string;
          item_name: string;
          specification: string | null;
          quantity: number;
          unit_price: number | null;
          total_amount: number;
          remark: string | null;
        }[] = [];
        // 영수증 유무와 관계없이 법인카드 비용을 발주 생성용으로 수집
        const corporateCardExpensesForPurchase: {
          merchant_name: string;
          item_name: string;
          specification: string | null;
          quantity: number;
          unit_price: number | null;
          total_amount: number;
          remark: string | null;
        }[] = [];
        const uploadedReceiptPathMap = new WeakMap<File, string>();

        for (let i = 0; i < expenseRowsForSave.length; i += 1) {
          const row = expenseRowsForSave[i];
          const lineOrder = i + 1;
          const expenseId = lineOrderToExpenseId.get(lineOrder);
          if (!expenseId) continue;

          const rowReceiptPathsForCardUsage: string[] = [];

          // 기존 저장된 영수증 경로는 재연결
          row.existingReceipts.forEach((receipt) => {
            if (receipt.receipt_url) {
              receiptInsertPayload.push({
                business_trip_expense_id: expenseId,
                receipt_url: receipt.receipt_url,
              });
              rowReceiptPathsForCardUsage.push(`business-trip-receipts/${receipt.receipt_url}`);
            }
          });

          // 신규 파일 업로드 후 경로 저장
          for (const file of row.newReceiptFiles) {
            let storagePath = uploadedReceiptPathMap.get(file);
            if (!storagePath) {
              const safeName = toSafeFileName(file.name);
              storagePath = `${settlementTrip.trip_code}/${lineOrder}-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 8)}-${safeName}`;

              const { error: uploadError } = await supabase.storage
                .from("business-trip-receipts")
                .upload(storagePath, file, { upsert: false });
              if (uploadError) throw uploadError;
              uploadedReceiptPathMap.set(file, storagePath);
            }

            receiptInsertPayload.push({
              business_trip_expense_id: expenseId,
              receipt_url: storagePath,
            });
            rowReceiptPathsForCardUsage.push(`business-trip-receipts/${storagePath}`);
          }

          if (row.expense_type === "corporate_card" && linkedCardUsageId) {
            // 영수증이 있으면 card_usage_receipts 테이블에도 삽입
            if (rowReceiptPathsForCardUsage.length > 0) {
              rowReceiptPathsForCardUsage.forEach((receiptPath) => {
                corporateCardReceiptPayload.push({
                  card_usage_id: linkedCardUsageId,
                  receipt_url: receiptPath,
                  merchant_name: row.vendor_name.trim() || "미입력",
                  item_name: row.category_detail.trim() || "미입력",
                  specification: row.specification.trim() || null,
                  quantity: Math.max(toNumber(row.quantity), 1),
                  unit_price: row.unit_price.trim() ? Math.min(toNumber(row.unit_price), MAX_KRW_AMOUNT) : null,
                  total_amount: Math.min(toNumber(row.amount), MAX_KRW_AMOUNT),
                  remark: row.remark.trim() || null,
                });
              });
            }
            // 영수증 유무와 관계없이 발주 생성용 데이터 수집
            corporateCardExpensesForPurchase.push({
              merchant_name: row.vendor_name.trim() || "미입력",
              item_name: row.category_detail.trim() || "미입력",
              specification: row.specification.trim() || null,
              quantity: Math.max(toNumber(row.quantity), 1),
              unit_price: row.unit_price.trim() ? Math.min(toNumber(row.unit_price), MAX_KRW_AMOUNT) : null,
              total_amount: Math.min(toNumber(row.amount), MAX_KRW_AMOUNT),
              remark: row.remark.trim() || null,
            });
          }
        }

        if (receiptInsertPayload.length > 0) {
          const { error: receiptInsertError } = await supabase
            .from("business_trip_expense_receipts")
            .insert(receiptInsertPayload);
          if (receiptInsertError) throw receiptInsertError;
        }

        if (linkedCardUsageId && corporateCardReceiptPayload.length > 0) {
          const { error: cardReceiptInsertError } = await supabase
            .from("card_usage_receipts")
            .insert(corporateCardReceiptPayload);
          if (cardReceiptInsertError) throw cardReceiptInsertError;
        }

        if (mode === "submitted" && linkedCardUsageId && corporateCardExpensesForPurchase.length > 0) {
          // 업체(merchant_name) 기준으로 그룹핑하여 발주 생성 (업체 1곳 = 발주 1건)
          const expensesByMerchant: Record<string, typeof corporateCardExpensesForPurchase> = {};
          for (const expense of corporateCardExpensesForPurchase) {
            const merchantKey = expense.merchant_name.trim() || "미입력";
            if (!expensesByMerchant[merchantKey]) expensesByMerchant[merchantKey] = [];
            expensesByMerchant[merchantKey].push(expense);
          }

          const approvedAt = settlementTrip.approved_at || new Date().toISOString();
          const requesterName = settlementTrip.requester?.name || currentUser?.name || "";

          for (const [merchantName, merchantExpenses] of Object.entries(expensesByMerchant)) {
            const vendorId = await findOrCreateVendor(merchantName);
            const poNumber = await generatePurchaseOrderNumber();
            const totalAmount = merchantExpenses.reduce((sum, r) => sum + (r.total_amount || 0), 0);

            const { data: pr, error: prError } = await supabase
              .from("purchase_requests")
              .insert({
                card_usage_id: linkedCardUsageId,
                purchase_order_number: poNumber,
                requester_id: settlementTrip.requester_id,
                requester_name: requesterName,
                vendor_id: vendorId,
                vendor_name: merchantName,
                request_type: "소모품",
                progress_type: "일반",
                payment_category: "현장 결제",
                currency: "KRW",
                unit_price_currency: "KRW",
                po_template_type: "발주/구매",
                request_date: settlementTrip.trip_start_date,
                total_amount: totalAmount,
                is_payment_completed: true,
                middle_manager_status: "approved",
                middle_manager_approved_at: approvedAt,
                final_manager_status: "approved",
                final_manager_approved_at: approvedAt,
                project_item: autoGeneratedProjectItem,
                project_vendor: settlementTrip.trip_code,
              })
              .select("id")
              .single();

            if (prError || !pr) throw prError || new Error("출장 정산 자동 발주 생성 실패");

            for (const [idx, expense] of merchantExpenses.entries()) {
              const { error: itemErr } = await supabase
                .from("purchase_request_items")
                .insert({
                  purchase_request_id: pr.id,
                  line_number: idx + 1,
                  item_name: expense.item_name,
                  specification: expense.specification || null,
                  quantity: expense.quantity || 1,
                  unit_price_value: expense.unit_price || 0,
                  unit_price_currency: "KRW",
                  amount_value: expense.total_amount,
                  amount_currency: "KRW",
                  remark: expense.remark || null,
                  vendor_name: merchantName,
                  is_payment_completed: true,
                });
              if (itemErr) throw itemErr;
            }
          }
        }
      }
      const { error: tripUpdateError } = await supabase
        .from("business_trips")
        .update({
          settlement_status: mode,
          settlement_submitted_by: mode === "submitted" ? (currentUser?.name || null) : null,
          settlement_submitted_at: mode === "submitted" ? new Date().toISOString() : null,
          settlement_approved_by: null,
          settlement_approved_at: null,
          settlement_rejection_reason: null,
        })
        .eq("id", settlementTrip.id);
      if (tripUpdateError) throw tripUpdateError;

      // 정산 제출 시 발주가 자동생성되므로 구매 목록 캐시 무효화
      if (mode === "submitted") {
        invalidatePurchaseMemoryCache();
      }
      toast.success(
        mode === "submitted"
          ? "정산이 제출되었습니다. (영수증/발주 자동생성)"
          : "정산 임시저장 완료"
      );
      closeSettlementModal();
      loadTrips();
      onBadgeRefresh?.();
      return true;
    } catch (err) {
      logger.error("정산 저장 실패", err);
      toast.error("정산 저장에 실패했습니다.");
      return false;
    } finally {
      setSettlementSaving(false);
    }
  }, [
    allowanceRows,
    closeSettlementModal,
    expenseRows,
    hasSettlementData,
    loadTrips,
    mileageRows,
    currentUser?.name,
    settlementTrip,
    supabase,
    findOrCreateVendor,
    generatePurchaseOrderNumber,
  ]);

  const getApprovalBadge = (status: string) => {
    const map: Record<string, { text: string; cls: string }> = {
      pending: { text: "승인대기", cls: "bg-orange-500 text-white" },
      approved: { text: "승인완료", cls: "bg-green-500 text-white" },
      rejected: { text: "반려", cls: "bg-red-500 text-white" },
      completed: { text: "완료", cls: "bg-blue-500 text-white" },
    };
    const c = map[status] || { text: status, cls: "bg-gray-100 text-gray-600" };
    return <span className={`badge-stats ${c.cls}`}>{c.text}</span>;
  };

  const getSettlementBadge = (status: string) => {
    const map: Record<string, { text: string; cls: string }> = {
      draft: { text: "작성중", cls: "bg-gray-100 text-gray-600" },
      submitted: { text: "정산제출", cls: "bg-blue-500 text-white" },
      approved: { text: "정산승인", cls: "bg-green-500 text-white" },
      rejected: { text: "정산반려", cls: "bg-red-500 text-white" },
    };
    const c = map[status] || { text: status, cls: "bg-gray-100 text-gray-600" };
    return <span className={`badge-stats ${c.cls}`}>{c.text}</span>;
  };

  const getCardStatusText = (trip: BusinessTrip) => {
    const hasCardRequest = Boolean(trip.requested_card_number?.trim()) || Boolean(trip.linkedCard);
    if (!hasCardRequest) return "-";
    if (!trip.linkedCard) return "생성대기";
    if (trip.linkedCard.card_returned) return "반납완료";
    const map: Record<string, string> = {
      pending: "승인대기",
      approved: "사용승인",
      settled: "반납완료",
      returned: "반납완료",
      rejected: "반려",
    };
    return map[trip.linkedCard.approval_status] || trip.linkedCard.approval_status;
  };

  const getTransportLabel = (trip: BusinessTrip) => {
    return TRIP_TRANSPORT_LABEL_MAP[trip.transport_type] || "기타";
  };

  const getTransportDetailText = (trip: BusinessTrip) => {
    const detail = trip.requested_vehicle_info?.trim() || "";
    if (!detail) return "";
    if (trip.transport_type === "public_transport") {
      return PUBLIC_TRANSPORT_LABEL_MAP[detail] || detail;
    }
    return detail;
  };

  const getVehicleStatusText = (trip: BusinessTrip) => {
    if (trip.transport_type !== "company_vehicle") return "-";
    if (!trip.linkedVehicle) {
      if (trip.approval_status === "approved") return "요청생성대기";
      return "승인대기";
    }

    const map: Record<string, string> = {
      pending: "승인대기",
      approved: "배차승인",
      rejected: "반려",
    };
    return map[trip.linkedVehicle.approval_status] || trip.linkedVehicle.approval_status;
  };

  return (
    <div className="w-full">
      <div className="mb-4">
        <div className="flex items-center justify-between">
          {!isCreateMode && (
          <div>
            <h1 className="page-title">출장 관리</h1>
            <p className="page-subtitle" style={{ marginTop: "-2px", marginBottom: "-4px" }}>
              Business Trip Management
            </p>
          </div>
          )}
          {!isCreateMode && (
            <div className="flex items-center gap-2">
              <Button
                onClick={() => loadTrips()}
                variant="outline"
                className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {isCreateMode && (
        <div className="doc-form">
          <div className="doc-form-header">
            <h1>출 장 신 청 서</h1>
            <div className="doc-subtitle">Business Trip Request Form</div>
          </div>

          <div className="doc-form-body">
            <div className="doc-form-row">
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">사용부서 <span className="required">*</span></div>
                <div className="doc-select-container">
                  <ReactSelect
                    options={departmentOptions}
                    value={formDepartment ? { value: formDepartment, label: formDepartment } : null}
                    onChange={(opt) => setFormDepartment((opt as { value: string } | null)?.value || "")}
                    placeholder="선택"
                    isSearchable
                    styles={reactSelectStyles}
                    menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                    menuShouldBlockScroll={false}
                    noOptionsMessage={() => "없음"}
                  />
                </div>
              </div>
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">출장지/Project <span className="required">*</span></div>
                <Input
                  value={formProjectName}
                  onChange={(e) => setFormProjectName(e.target.value)}
                  placeholder="출장업체 또는 Project 명 입력"
                  className="doc-form-input"
                />
              </div>
            </div>

            <div className="doc-form-row">
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">출장지역 <span className="required">*</span></div>
                <Input
                  value={formDestination}
                  onChange={(e) => setFormDestination(e.target.value)}
                  placeholder="지역명 입력"
                  className="doc-form-input"
                />
              </div>
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">출장기간 <span className="required">*</span></div>
                <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" className="doc-date-trigger">
                      <CalendarIcon className="mr-1.5 h-3.5 w-3.5 text-gray-400" />
                      <span className={formDateRange?.from ? "text-gray-900" : "text-gray-300"}>
                        {formatDateRangeLabel(formDateRange?.from, formDateRange?.to)}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 border-gray-200 shadow-lg" align="start" side="bottom" sideOffset={8}>
                    <div className="bg-white business-radius-card p-3">
                      <div className="mb-2 px-1">
                        <div className="modal-label text-gray-600 text-center">날짜 선택 (1회: 당일, 2회: 기간)</div>
                      </div>
                      <Calendar
                        mode="range"
                        selected={formDateRange}
                        onSelect={(range) => setFormDateRange(range)}
                        locale={ko}
                        className="compact-calendar"
                        fromDate={new Date("2020-01-01")}
                        toDate={new Date("2035-12-31")}
                        defaultMonth={new Date()}
                      />
                      <div className="border-t border-gray-100 mt-3 pt-2 flex justify-end">
                        <Button
                          type="button"
                          className="button-base bg-blue-500 hover:bg-blue-600 text-white"
                          onClick={() => setDatePopoverOpen(false)}
                          disabled={!formDateRange?.from}
                        >
                          확인
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="doc-form-row">
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">출장 목적 <span className="required">*</span></div>
                <Input
                  value={formPurpose}
                  onChange={(e) => setFormPurpose(e.target.value)}
                  placeholder="출장 목적 입력"
                  className="doc-form-input"
                />
              </div>
            </div>

            <div className="doc-form-row">
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">동반직원(본인제외)</div>
                <div className="doc-select-container">
                  <ReactSelect
                    isMulti
                    options={companionOptions}
                    value={formCompanions}
                    onChange={(opts) => setFormCompanions((opts || []) as CompanionOption[])}
                    placeholder="선택"
                    isSearchable
                    styles={reactSelectStyles}
                    menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                    menuShouldBlockScroll={false}
                    noOptionsMessage={() => "없음"}
                  />
                </div>
              </div>
            </div>

            <div className="doc-form-row">
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">이동수단 <span className="required">*</span></div>
                <div className="doc-select-container">
                  <ReactSelect
                    options={TRIP_TRANSPORT_OPTIONS}
                    value={TRIP_TRANSPORT_OPTIONS.find((o) => o.value === formTransportType) || null}
                    onChange={(opt) => setFormTransportType(((opt as { value: string } | null)?.value || "public_transport") as BusinessTrip["transport_type"])}
                    placeholder="선택"
                    isSearchable={false}
                    styles={reactSelectStyles}
                    menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                    menuShouldBlockScroll={false}
                  />
                </div>
              </div>
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">
                  상세 선택
                  {(formTransportType === "company_vehicle" || formTransportType === "public_transport" || formTransportType === "other") && (
                    <span className="required"> *</span>
                  )}
                </div>
                {formTransportType === "company_vehicle" && (
                  <div className="doc-select-container">
                    <ReactSelect
                      options={availableCompanyVehicles}
                      value={formTransportDetail ? availableCompanyVehicles.find((v) => v.value === formTransportDetail) || null : null}
                      onChange={(opt) => setFormTransportDetail((opt as { value: string } | null)?.value || "")}
                      placeholder={availableCompanyVehicles.length > 0 ? "회사차량 선택" : "선택 가능한 회사차량 없음"}
                      isSearchable
                      styles={reactSelectStyles}
                      menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                      menuShouldBlockScroll={false}
                      noOptionsMessage={() => "없음"}
                      formatOptionLabel={(option) => (
                        <div className="flex items-center text-xs">
                          <span className="font-medium text-gray-900">{(option as { label: string }).label}</span>
                          <span className="text-gray-300 mx-1.5">|</span>
                          <span className="text-gray-500">{(option as { plate?: string }).plate || ""}</span>
                        </div>
                      )}
                    />
                    {availableCompanyVehicles.length === 0 && (
                      <p className="card-description text-red-500 mt-1">현재 선택 가능한 회사차량이 없습니다.</p>
                    )}
                  </div>
                )}
                {formTransportType === "public_transport" && (
                  <div className="doc-select-container">
                    <ReactSelect
                      options={PUBLIC_TRANSPORT_OPTIONS}
                      value={PUBLIC_TRANSPORT_OPTIONS.find((o) => o.value === formTransportDetail) || null}
                      onChange={(opt) => setFormTransportDetail((opt as { value: string } | null)?.value || "")}
                      placeholder="대중교통 선택"
                      isSearchable={false}
                      styles={reactSelectStyles}
                      menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                      menuShouldBlockScroll={false}
                    />
                  </div>
                )}
                {formTransportType === "private_car" && (
                  <Input value="선택 없음" disabled className="doc-form-input text-gray-400" />
                )}
                {formTransportType === "other" && (
                  <Input
                    value={formTransportDetail}
                    onChange={(e) => setFormTransportDetail(e.target.value)}
                    placeholder="기타 이동수단 입력"
                    className="doc-form-input"
                    maxLength={30}
                  />
                )}
              </div>
            </div>

            <div className="doc-form-row">
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">출장카드 선택</div>
                <div className="doc-select-container">
                  <ReactSelect
                    options={COMPANY_CARDS}
                    value={formCardNumber ? COMPANY_CARDS.find((c) => c.value === formCardNumber) || null : null}
                    onChange={(opt) => setFormCardNumber((opt as { value: string } | null)?.value || null)}
                      formatOptionLabel={(option) => formatCompanyCardOptionLabel(option as CompanyCardOption)}
                      getOptionLabel={(option) => formatCompanyCardOptionLabel(option as CompanyCardOption)}
                    placeholder="선택"
                    isSearchable={false}
                    styles={reactSelectStyles}
                    menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                    menuShouldBlockScroll={false}
                  />
                </div>
              </div>
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">예상비용</div>
                <Input
                  value={formExpectedAmount}
                  onChange={(e) => setFormExpectedAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="0"
                  className="doc-form-input"
                />
              </div>
            </div>

            <div className="doc-form-row" style={{ borderBottom: "none" }}>
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">사전 메모</div>
                <Textarea
                  value={formPrecheckNote}
                  onChange={(e) => setFormPrecheckNote(e.target.value)}
                  placeholder="출장 전 공유할 내용을 입력하세요."
                  className="doc-form-textarea"
                />
              </div>
            </div>
          </div>

          <div className="doc-form-footer">
            <Button
              type="button"
              onClick={handleCreateTrip}
              disabled={tripButtonDisabled}
              className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
            >
              {requestSubmitting ? "요청 중..." : "출장승인요청"}
            </Button>
          </div>
        </div>
      )}

      {!isCreateMode && (
      <>
      {/* 요약 */}
      <div className="mb-4 grid grid-cols-5 gap-2">
        <div className="border business-radius-card px-3 py-2.5 border-gray-200 bg-white">
          <p className="modal-label text-gray-500">승인대기</p>
          <p className="modal-value-large text-orange-600">{pendingApprovalCount}</p>
        </div>
        <div className="border business-radius-card px-3 py-2.5 border-gray-200 bg-white">
          <p className="modal-label text-gray-500">진행중 출장</p>
          <p className="modal-value-large text-blue-600">{tripInProgressCount}</p>
        </div>
        <div className="border business-radius-card px-3 py-2.5 border-gray-200 bg-white">
          <p className="modal-label text-gray-500">정산제출</p>
          <p className="modal-value-large text-purple-600">{settlementSubmittedCount}</p>
        </div>
        <div className="border business-radius-card px-3 py-2.5 border-gray-200 bg-white">
          <p className="modal-label text-gray-500">출장카드 선택</p>
          <p className="modal-value-large text-emerald-600">{cardRequestedCount}</p>
        </div>
        <div className="border business-radius-card px-3 py-2.5 border-gray-200 bg-white">
          <p className="modal-label text-gray-500">회사차량 신청</p>
          <p className="modal-value-large text-indigo-600">{vehicleRequestedCount}</p>
        </div>
      </div>

      <span className="text-[11px] font-medium text-gray-400">{new Date().getFullYear()}</span>
      <Card className="overflow-hidden border border-gray-200 w-full max-w-full">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-hansl-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 card-subtitle">로딩 중...</span>
            </div>
          ) : sortedTrips.length === 0 ? (
            <div className="text-center py-12">
              <Plane className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">출장 요청이 없습니다</h3>
              <p className="card-subtitle">새로운 출장 승인 요청을 등록해보세요.</p>
            </div>
          ) : (
            <div className="overflow-x-auto overflow-y-auto max-h-[70vh] border rounded-lg">
              <table className="w-full min-w-[1320px] border-collapse">
                <thead
                  className="sticky top-0 z-30 bg-gray-50"
                  style={{ boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)" }}
                >
                  <tr>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center w-[84px]">상태</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[68px]">신청일</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[110px]">출장코드</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[140px]">출장기간</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[76px]">요청자</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[100px]">동승자</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[125px]">출장지</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[90px]">카드신청</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[126px]">이동수단</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-right w-[88px]">예상비용</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center w-[98px]">정산상태</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[76px]">정산제출자</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left">출장목적</th>
                    {isAppAdmin && (
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center w-[40px]"></th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sortedTrips.map((trip) => {
                    const isOwner = currentUser?.id === trip.requester_id;
                    const isCompanion = trip.companions?.some((c) => c.id === currentUser?.id) || false;
                    const canEditSettlement =
                      trip.approval_status === "approved" &&
                      (isOwner || isCompanion || isAppAdmin) &&
                      ["draft", "rejected"].includes(trip.settlement_status);
                    const canApproveSettlementRow =
                      trip.approval_status === "approved" &&
                      trip.settlement_status === "submitted" &&
                      canApproveSettlement;

                    return (
                      <tr key={trip.id} className="border-b hover:bg-gray-100 transition-colors">
                        <td className="px-3 py-1.5 text-center whitespace-nowrap">
                          {trip.approval_status === "pending" && canApproveTrip(trip) ? (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button type="button" className="badge-stats bg-orange-500 text-white hover:bg-orange-600">
                                  승인대기
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-2 flex gap-1.5" side="right" align="start">
                                <Button
                                  className="button-base bg-green-500 hover:bg-green-600 text-white"
                                  onClick={() => handleApproveTrip(trip.id)}
                                >
                                  <Check className="w-3 h-3 mr-0.5" />
                                  승인
                                </Button>
                                <Button
                                  className="button-base border border-red-200 bg-white text-red-600 hover:bg-red-50"
                                  onClick={() => openRejectDialog(trip.id, "approval")}
                                >
                                  <X className="w-3 h-3 mr-0.5" />
                                  반려
                                </Button>
                              </PopoverContent>
                            </Popover>
                          ) : (
                            getApprovalBadge(trip.approval_status)
                          )}
                        </td>
                        <td className="px-3 py-1.5 card-date whitespace-nowrap">
                          {trip.created_at ? format(new Date(trip.created_at), "MM/dd") : "-"}
                        </td>
                        <td className="px-3 py-1.5 card-title whitespace-nowrap">{trip.trip_code}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <div className="text-[11px] font-medium text-gray-900">
                            {trip.trip_start_date ? format(new Date(trip.trip_start_date), "MM/dd") : "-"} ~{" "}
                            {trip.trip_end_date ? format(new Date(trip.trip_end_date), "MM/dd") : "-"}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 card-title whitespace-nowrap">{trip.requester?.name || "-"}</td>
                        <td className="px-3 py-1.5 card-title whitespace-normal break-keep">
                          {trip.companions && trip.companions.length > 0
                            ? trip.companions.map((c) => c.name).join(", ")
                            : "-"}
                        </td>
                        <td className="px-3 py-1.5 card-title truncate max-w-[120px]">{trip.trip_destination}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {trip.requested_card_number?.trim() || trip.linkedCard ? (
                            <div>
                              <div className="card-title">
                                {(() => {
                                  const raw = trip.linkedCard?.card_number || trip.requested_card_number || "";
                                  const parts = raw.trim().split(/\s+/);
                                  if (parts.length >= 2) return <>{parts[0]}<span className="text-gray-400"> ({parts.slice(1).join(" ")})</span></>;
                                  return parts[0] || "-";
                                })()}
                              </div>
                              <div className="card-description">{getCardStatusText(trip)}</div>
                            </div>
                          ) : (
                            <span className="card-description">미신청</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {trip.transport_type === "company_vehicle" ? (
                            <div>
                              <div className="card-title">
                                {trip.requested_vehicle_info?.split(" ")[0] || trip.linkedVehicle?.vehicle_info?.split(" ")[0] || "회사차량"}
                              </div>
                              <div className="card-description">{getVehicleStatusText(trip)}</div>
                            </div>
                          ) : (
                            <div>
                              <div className="card-title">{getTransportLabel(trip)}</div>
                              <div className="card-description">{getTransportDetailText(trip) || "-"}</div>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-1.5 card-title whitespace-nowrap text-right">
                          {trip.expected_total_amount > 0 ? `₩${Number(trip.expected_total_amount).toLocaleString()}` : "-"}
                        </td>
                        <td className="px-3 py-1.5 text-center whitespace-nowrap">
                          {canApproveSettlementRow ? (
                            <button
                              type="button"
                              className="badge-stats bg-blue-500 text-white hover:bg-blue-600"
                              onClick={() => openSettlementModal(trip)}
                            >
                              제출완료
                            </button>
                          ) : canEditSettlement ? (
                            <button
                              type="button"
                              className="badge-stats bg-orange-500 text-white hover:bg-orange-600"
                              onClick={() => openSettlementModal(trip)}
                            >
                              정산작성
                            </button>
                          ) : ["submitted", "approved"].includes(trip.settlement_status) ? (
                            <button
                              type="button"
                              onClick={() =>
                                openSettlementModal(
                                  trip,
                                  !(trip.settlement_status === "submitted" && canApproveSettlement)
                                )
                              }
                              className="cursor-pointer"
                            >
                              {getSettlementBadge(trip.settlement_status)}
                            </button>
                          ) : (
                            getSettlementBadge(trip.settlement_status)
                          )}
                        </td>
                        <td className="px-3 py-1.5 card-title whitespace-nowrap">
                          {trip.settlement_submitted_by || "-"}
                        </td>
                        <td className="px-3 py-1.5 card-title truncate max-w-[220px]">{trip.trip_purpose}</td>
                        {isAppAdmin && (
                          <td className="px-3 py-1.5 text-center">
                            <button
                              className="text-gray-300 hover:text-red-500 transition-colors"
                              onClick={() => handleDeleteTrip(trip.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      </>
      )}

      {/* 출장 사전승인 요청 모달 */}
      {!isCreateMode && (
      <Dialog open={isRequestModalOpen} onOpenChange={setIsRequestModalOpen}>
        <DialogContent className="sm:max-w-[560px] p-0 max-h-[90vh] overflow-y-auto">
          <DialogHeader className="px-5 pt-4 pb-3 border-b border-gray-100" style={{ gap: 0 }}>
            <DialogTitle className="text-[14px] font-bold leading-tight">출장 승인 요청</DialogTitle>
            <p className="page-subtitle leading-tight" style={{ marginTop: "-1px" }}>Business Trip Approval Request</p>
          </DialogHeader>

          <div className="px-5 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">사용부서<span className="text-red-500 ml-0.5">*</span></Label>
                <ReactSelect
                  options={departmentOptions}
                  value={formDepartment ? { value: formDepartment, label: formDepartment } : null}
                  onChange={(opt) => setFormDepartment((opt as { value: string } | null)?.value || "")}
                  placeholder="선택"
                  isSearchable
                  styles={reactSelectStyles}
                  menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                  menuShouldBlockScroll={false}
                  noOptionsMessage={() => "없음"}
                />
              </div>
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">출장지/Project<span className="text-red-500 ml-0.5">*</span></Label>
                <Input
                  value={formProjectName}
                  onChange={(e) => setFormProjectName(e.target.value)}
                  placeholder="출장업체 또는 Project 명 입력"
                  className="h-[28px] text-xs bg-white border-[#d2d2d7] business-radius-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">출장지역<span className="text-red-500 ml-0.5">*</span></Label>
                <Input
                  value={formDestination}
                  onChange={(e) => setFormDestination(e.target.value)}
                  placeholder="지역명 입력"
                  className="h-[28px] text-xs bg-white border-[#d2d2d7] business-radius-input"
                />
              </div>
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">출장기간<span className="text-red-500 ml-0.5">*</span></Label>
                <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full h-[28px] px-2.5 text-xs justify-start text-left font-normal bg-white border-[#d2d2d7] business-radius-input"
                    >
                      <CalendarIcon className="mr-1.5 h-3.5 w-3.5 text-gray-400" />
                      <span className={formDateRange?.from ? "text-gray-900" : "text-gray-400"}>
                        {formatDateRangeLabel(formDateRange?.from, formDateRange?.to)}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 border-gray-200 shadow-lg" align="start" side="bottom" sideOffset={8}>
                    <div className="bg-white business-radius-card p-3">
                      <div className="mb-2 px-1">
                        <div className="modal-label text-gray-600 text-center">날짜 선택 (1회: 당일, 2회: 기간)</div>
                      </div>
                      <Calendar
                        mode="range"
                        selected={formDateRange}
                        onSelect={(range) => setFormDateRange(range)}
                        locale={ko}
                        className="compact-calendar"
                        fromDate={new Date("2020-01-01")}
                        toDate={new Date("2035-12-31")}
                        defaultMonth={new Date()}
                      />
                      <div className="border-t border-gray-100 mt-3 pt-2 flex justify-end">
                        <Button
                          className="button-base bg-blue-500 hover:bg-blue-600 text-white"
                          onClick={() => setDatePopoverOpen(false)}
                          disabled={!formDateRange?.from}
                        >
                          확인
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div>
              <Label className="modal-label mb-1.5 block text-[11px]">출장 목적<span className="text-red-500 ml-0.5">*</span></Label>
              <Input
                value={formPurpose}
                onChange={(e) => setFormPurpose(e.target.value)}
                placeholder="출장 목적 입력"
                className="h-[28px] text-xs bg-white border-[#d2d2d7] business-radius-input"
              />
            </div>

            <div>
              <Label className="modal-label mb-1.5 block text-[11px]">동반직원(본인제외)</Label>
              <ReactSelect
                isMulti
                options={companionOptions}
                value={formCompanions}
                onChange={(opts) => setFormCompanions((opts || []) as CompanionOption[])}
                placeholder="선택"
                isSearchable
                styles={reactSelectStyles}
                menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                menuShouldBlockScroll={false}
                noOptionsMessage={() => "없음"}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-1">
                <Label className="modal-label mb-1.5 block text-[11px]">이동수단<span className="text-red-500 ml-0.5">*</span></Label>
                <ReactSelect
                  options={TRIP_TRANSPORT_OPTIONS}
                  value={TRIP_TRANSPORT_OPTIONS.find((o) => o.value === formTransportType) || null}
                  onChange={(opt) => setFormTransportType(((opt as { value: string } | null)?.value || "public_transport") as BusinessTrip["transport_type"])}
                  placeholder="선택"
                  isSearchable={false}
                  styles={reactSelectStyles}
                  menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                  menuShouldBlockScroll={false}
                />
              </div>
              <div className="col-span-1">
                <Label className="modal-label mb-1.5 block text-[11px]">
                  상세 선택
                  {(formTransportType === "company_vehicle" || formTransportType === "public_transport" || formTransportType === "other") && (
                    <span className="text-red-500 ml-0.5">*</span>
                  )}
                </Label>
                {formTransportType === "company_vehicle" && (
                  <>
                    <ReactSelect
                      options={availableCompanyVehicles}
                      value={formTransportDetail ? availableCompanyVehicles.find((v) => v.value === formTransportDetail) || null : null}
                      onChange={(opt) => setFormTransportDetail((opt as { value: string } | null)?.value || "")}
                      placeholder={availableCompanyVehicles.length > 0 ? "회사차량 선택" : "선택 가능한 회사차량 없음"}
                      isSearchable
                      styles={reactSelectStyles}
                      menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                      menuShouldBlockScroll={false}
                      noOptionsMessage={() => "없음"}
                      formatOptionLabel={(option) => (
                        <div className="flex items-center text-xs">
                          <span className="font-medium text-gray-900">{(option as { label: string }).label}</span>
                          <span className="text-gray-300 mx-1.5">|</span>
                          <span className="text-gray-500">{(option as { plate?: string }).plate || ""}</span>
                        </div>
                      )}
                    />
                    {availableCompanyVehicles.length === 0 && (
                      <p className="card-description text-red-500 mt-1">현재 선택 가능한 회사차량이 없습니다.</p>
                    )}
                  </>
                )}
                {formTransportType === "public_transport" && (
                  <ReactSelect
                    options={PUBLIC_TRANSPORT_OPTIONS}
                    value={PUBLIC_TRANSPORT_OPTIONS.find((o) => o.value === formTransportDetail) || null}
                    onChange={(opt) => setFormTransportDetail((opt as { value: string } | null)?.value || "")}
                    placeholder="대중교통 선택"
                    isSearchable={false}
                    styles={reactSelectStyles}
                    menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                    menuShouldBlockScroll={false}
                  />
                )}
                {formTransportType === "private_car" && (
                  <Input value="선택 없음" disabled className="h-[28px] text-xs bg-white border-[#d2d2d7] business-radius-input text-gray-400" />
                )}
                {formTransportType === "other" && (
                  <Input
                    value={formTransportDetail}
                    onChange={(e) => setFormTransportDetail(e.target.value)}
                    placeholder="기타 이동수단 입력"
                    className="h-[28px] text-xs bg-white border-[#d2d2d7] business-radius-input"
                    maxLength={30}
                  />
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-1">
                <Label className="modal-label mb-1.5 block text-[11px]">출장카드 선택</Label>
                <ReactSelect
                  options={COMPANY_CARDS}
                  value={formCardNumber ? COMPANY_CARDS.find((c) => c.value === formCardNumber) || null : null}
                  onChange={(opt) => setFormCardNumber((opt as { value: string } | null)?.value || null)}
                  formatOptionLabel={(option) => formatCompanyCardOptionLabel(option as CompanyCardOption)}
                  getOptionLabel={(option) => formatCompanyCardOptionLabel(option as CompanyCardOption)}
                  placeholder="선택"
                  isSearchable={false}
                  styles={reactSelectStyles}
                  menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                  menuShouldBlockScroll={false}
                />
              </div>
              <div className="col-span-1">
                <Label className="modal-label mb-1.5 block text-[11px]">예상비용</Label>
                <Input
                  value={formExpectedAmount}
                  onChange={(e) => setFormExpectedAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="0"
                  className="h-[28px] text-xs bg-white border-[#d2d2d7] business-radius-input"
                />
              </div>
            </div>

            <div>
              <Label className="modal-label mb-1.5 block text-[11px]">사전 메모</Label>
              <Textarea
                value={formPrecheckNote}
                onChange={(e) => setFormPrecheckNote(e.target.value)}
                placeholder="출장 전 공유할 내용을 입력하세요."
                className="text-xs min-h-[64px] bg-white border-[#d2d2d7] business-radius-input"
              />
            </div>
          </div>

          <div className="px-5 py-3">
            <DialogFooter className="gap-2 sm:gap-2 border-none p-0">
              <Button
                variant="outline"
                onClick={() => setIsRequestModalOpen(false)}
                className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                취소
              </Button>
              <Button
                onClick={handleCreateTrip}
                disabled={tripButtonDisabled}
                className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
              >
                {requestSubmitting ? "요청 중..." : "출장승인요청"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      )}

      {/* 정산 모달 */}
      <Dialog open={!!settlementTrip} onOpenChange={(open) => {
        if (!open && !receiptPreviewUrl && !receiptPreviewLoading && !receiptViewerRowKey) {
          closeSettlementModal();
        }
      }}>
        <DialogContent className="sm:max-w-[min(95vw,1220px)] p-0 max-h-[92vh] overflow-y-auto">
          <DialogHeader className="px-5 pt-4 pb-3 border-b border-gray-100" style={{ gap: 0 }}>
            <DialogTitle className="text-[14px] font-bold leading-tight">{settlementViewOnly ? "출장 정산 상세" : "출장 정산 작성"}</DialogTitle>
            <p className="page-subtitle leading-tight" style={{ marginTop: "-1px" }}>
              Business Trip Settlement {settlementViewOnly ? "Detail" : ""}
            </p>
          </DialogHeader>

          {settlementLoading || !settlementTrip ? (
            <div className="px-5 py-8 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-hansl-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 card-subtitle">정산 데이터를 불러오는 중...</span>
            </div>
          ) : (
            <fieldset disabled={settlementViewOnly} className="border-none p-0 m-0">
            <div className="px-5 py-4 space-y-4">
              {/* 상단 요약 */}
              <div className="border business-radius-card p-3 bg-gray-50">
                <div className="grid grid-cols-5 gap-2">
                  <div>
                    <p className="modal-label">출장코드</p>
                    <p className="modal-value">{settlementTrip.trip_code}</p>
                  </div>
                  <div>
                    <p className="modal-label">요청자</p>
                    <p className="modal-value">{settlementTrip.requester?.name || "-"}</p>
                  </div>
                  <div>
                    <p className="modal-label">출장기간</p>
                    <p className="modal-value">
                      ({settlementYearLabel}) {format(new Date(settlementTrip.trip_start_date), "MM/dd")} ~{" "}
                      {format(new Date(settlementTrip.trip_end_date), "MM/dd")}
                    </p>
                  </div>
                  <div>
                    <p className="modal-label">현재 정산상태</p>
                    <div className="mt-0.5">{getSettlementBadge(settlementTrip.settlement_status)}</div>
                  </div>
                  <div>
                    <p className="modal-label">총 정산금액</p>
                    <p className="modal-value-large text-hansl-700">₩{grandTotal.toLocaleString()}원</p>
                  </div>
                </div>
                {settlementViewOnly && (
                  <div className="grid grid-cols-5 gap-2 mt-2 pt-2 border-t border-gray-200">
                    <div>
                      <p className="modal-label">부서</p>
                      <p className="modal-value">{settlementTrip.request_department || "-"}</p>
                    </div>
                    <div>
                      <p className="modal-label">출장지</p>
                      <p className="modal-value">{settlementTrip.trip_destination || "-"}</p>
                    </div>
                    <div>
                      <p className="modal-label">출장목적</p>
                      <p className="modal-value">{settlementTrip.trip_purpose || "-"}</p>
                    </div>
                    <div>
                      <p className="modal-label">동반자</p>
                      <p className="modal-value">{settlementTrip.companions?.map((c) => c.name).join(", ") || "-"}</p>
                    </div>
                    <div>
                      <p className="modal-label">예상금액</p>
                      <p className="modal-value">{settlementTrip.expected_total_amount > 0 ? `₩${Number(settlementTrip.expected_total_amount).toLocaleString()}` : "-"}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* 카드사용내역 - 법인카드 신청한 경우에만 표시 */}
              {(settlementTrip.requested_card_number?.trim() || settlementTrip.linkedCard) && (
      <div className="border business-radius-card">
                <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between">
                  <h3 className="section-title text-gray-800">카드사용내역</h3>
                  {!settlementViewOnly && (
                    <Button
                      onClick={() =>
                        setExpenseRows((prev) => [
                          ...prev,
                          createEmptyExpense(settlementTrip, undefined, prev.length > 0),
                        ])
                      }
                      className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    >
                      + 새 영수증 행
                    </Button>
                  )}
                </div>
                {!settlementViewOnly && (
                  <div className="px-3 py-1 border-b bg-blue-50 text-[10px] text-blue-700">
                    같은 영수증에 품목을 추가하려면 해당 행의 <span className="font-semibold">+품목</span> 버튼을 사용하세요.
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-auto">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-1.5 py-1 modal-label text-left w-[100px]">구분<span className="text-red-500 ml-0.5">*</span></th>
                        <th className="px-1.5 py-1 modal-label text-left w-[92px]">날짜 ({settlementYearLabel})</th>
                        <th className="px-1.5 py-1 modal-label text-left w-[220px]">사용처<span className="text-red-500 ml-0.5">*</span></th>
                        <th className="px-1.5 py-1 modal-label text-left w-[170px]">품명<span className="text-red-500 ml-0.5">*</span></th>
                        <th className="px-1.5 py-1 modal-label text-left w-[160px]">규격</th>
                        <th className="px-1.5 py-1 modal-label text-left w-[56px]">수량<span className="text-red-500 ml-0.5">*</span></th>
                        <th className="px-1.5 py-1 modal-label text-left w-[116px]">단가</th>
                        <th className="px-1.5 py-1 modal-label text-left w-[120px]">합계<span className="text-red-500 ml-0.5">*</span></th>
                        <th className="px-1.5 py-1 modal-label text-left w-[148px]">영수증</th>
                        <th className="px-1.5 py-1 modal-label text-left w-[220px]">비고(사용이유)</th>
                        <th className="px-1.5 py-1 modal-label text-center w-[96px]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenseRows.map((row, rowIdx) => {
                        const nextRow = expenseRows[rowIdx + 1];
                        const isLastOfGroup = !nextRow || nextRow.starts_new_receipt_group;
                        const borderStyle: React.CSSProperties = {
                          ...(row.starts_new_receipt_group ? { borderTop: "3px solid #60a5fa" } : {}),
                          ...(isLastOfGroup ? { borderBottom: "3px solid #60a5fa" } : {}),
                        };
                        return (
                        <tr
                          key={row.key}
                          className="border-t"
                          style={Object.keys(borderStyle).length > 0 ? borderStyle : undefined}
                        >
                          <td className="px-1.5 py-1">
                            <select
                              value={row.expense_type}
                              onChange={(e) => setExpenseRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, expense_type: e.target.value as ExpenseFormRow["expense_type"] } : r)))}
                              className="h-7 text-xs border border-[#d2d2d7] business-radius-input pl-1.5 pr-5 w-[96px] bg-white appearance-none bg-no-repeat bg-[length:12px] cursor-pointer"
                              style={{ paddingTop: 0, paddingBottom: 0, lineHeight: "26px", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")", backgroundPosition: "right 6px center" }}
                            >
                              {EXPENSE_TYPE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-1.5 py-1">
                            <div className="h-7 flex items-center">
                              <span className="card-description whitespace-nowrap">{tripPeriod.sameDay ? tripPeriod.start : `${tripPeriod.start}~${tripPeriod.end}`}</span>
                            </div>
                          </td>
                          <td className="px-1.5 py-1">
                            <CreatableSelect
                              isClearable
                              placeholder="선택 or 검색"
                              formatCreateLabel={(input: string) => `"${input}" 신규 등록`}
                              value={row.vendor_name ? { label: row.vendor_name, value: row.vendor_name } : null}
                              onChange={(opt) =>
                                setExpenseRows((prev) =>
                                  prev.map((r) =>
                                    r.key === row.key
                                      ? { ...r, vendor_name: ((opt as { value: string } | null)?.value || "") }
                                      : r
                                  )
                                )
                              }
                              options={vendors.map((v) => ({ label: v.vendor_name, value: v.vendor_name }))}
                              styles={{
                                ...reactSelectStyles,
                                placeholder: (base: Record<string, unknown>) => ({
                                  ...base,
                                  color: "#d1d5db",
                                }),
                              }}
                              menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                              menuPosition="fixed"
                              menuShouldBlockScroll={false}
                              isDisabled={settlementViewOnly}
                            />
                          </td>
                          <td className="px-1.5 py-1"><Input value={row.category_detail} maxLength={20} onChange={(e) => setExpenseRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, category_detail: e.target.value } : r)))} className="h-7 text-xs" /></td>
                          <td className="px-1.5 py-1"><Input value={row.specification} maxLength={30} onChange={(e) => setExpenseRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, specification: e.target.value } : r)))} className="h-7 text-xs" /></td>
                          <td className="px-1.5 py-1">
                            <Input
                              value={row.quantity}
                              onChange={(e) => {
                                const qty = e.target.value.replace(/[^0-9]/g, "");
                                setExpenseRows((prev) =>
                                  prev.map((r) => {
                                    if (r.key !== row.key) return r;
                                    const next = { ...r, quantity: qty };
                                    if (r.unit_price.trim()) {
                                      const calc = (toNumber(qty) || 0) * (toNumber(r.unit_price) || 0);
                                      const clamped = Math.min(calc, MAX_KRW_AMOUNT);
                                      next.amount = clamped > 0 ? clamped.toLocaleString("ko-KR") : "";
                                    }
                                    return next;
                                  })
                                );
                              }}
                              className="h-7 text-xs text-right w-[48px]"
                            />
                          </td>
                          <td className="px-1.5 py-1">
                            <div className="flex items-center gap-1">
                              <Input
                                value={row.unit_price}
                                onChange={(e) => {
                                  const unitPrice = formatKrwInput(e.target.value);
                                  setExpenseRows((prev) =>
                                    prev.map((r) => {
                                      if (r.key !== row.key) return r;
                                      const next = { ...r, unit_price: unitPrice };
                                      if (unitPrice.trim()) {
                                        const calc = (toNumber(r.quantity) || 1) * (toNumber(unitPrice) || 0);
                                        const clamped = Math.min(calc, MAX_KRW_AMOUNT);
                                        next.amount = clamped > 0 ? clamped.toLocaleString("ko-KR") : "";
                                      }
                                      return next;
                                    })
                                  );
                                }}
                                className="h-7 text-xs text-right w-[96px]"
                              />
                              <span className="card-description whitespace-nowrap">원</span>
                            </div>
                          </td>
                          <td className="px-1.5 py-1">
                            <div className="flex items-center gap-1">
                              <Input
                                value={row.amount}
                                onChange={(e) => {
                                  const total = formatKrwInput(e.target.value);
                                  setExpenseRows((prev) =>
                                    prev.map((r) =>
                                      r.key === row.key
                                        ? { ...r, amount: total, unit_price: "" }
                                        : r
                                    )
                                  );
                                }}
                                className="h-7 text-xs text-right w-[100px]"
                              />
                              <span className="card-description whitespace-nowrap">원</span>
                            </div>
                          </td>
                          <td className="px-1.5 py-1">
                            <div className="flex items-center gap-1 justify-between">
                              <div className="flex items-center gap-1 min-w-0">
                                {row.existingReceipts.length > 0 && (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => {
                                      if (settlementViewOnly || row.existingReceipts.length === 1) {
                                        openDirectReceipt(row.existingReceipts);
                                      } else {
                                        setReceiptViewerRowKey(row.key);
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        if (settlementViewOnly || row.existingReceipts.length === 1) openDirectReceipt(row.existingReceipts);
                                        else setReceiptViewerRowKey(row.key);
                                      }
                                    }}
                                    className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap cursor-pointer select-none"
                                  >
                                    {settlementViewOnly ? `${row.existingReceipts.length}건 보기` : `기존 ${row.existingReceipts.length}건`}
                                  </span>
                                )}
                                {!settlementViewOnly && row.newReceiptFiles.length > 0 && (
                                  <span className="text-[10px] text-blue-600 whitespace-nowrap">
                                    {format(new Date(row.newReceiptFiles[0].lastModified), "MM/dd")}
                                    {row.newReceiptFiles.length > 1 ? ` 외 ${row.newReceiptFiles.length - 1}건` : ""}
                                  </span>
                                )}
                                {!settlementViewOnly && row.newReceiptFiles.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpenseRows((prev) =>
                                        prev.map((r) => (r.key === row.key ? { ...r, newReceiptFiles: [] } : r))
                                      )
                                    }
                                    className="text-[10px] text-red-500 hover:text-red-600 whitespace-nowrap"
                                  >
                                    삭제
                                  </button>
                                )}
                                {!settlementViewOnly && (
                                  <span className="badge-stats bg-gray-100 text-gray-600">
                                    {row.existingReceipts.length + row.newReceiptFiles.length}
                                  </span>
                                )}
                                {settlementViewOnly && row.existingReceipts.length === 0 && (
                                  <span className="text-[10px] text-gray-400 whitespace-nowrap">없음</span>
                                )}
                              </div>
                              {!settlementViewOnly && (
                                <div className="flex-shrink-0 flex items-center gap-1">
                                  <input
                                    id={`trip-expense-receipt-${row.key}`}
                                    type="file"
                                    multiple
                                    accept="image/*,application/pdf"
                                    className="hidden"
                                    onChange={(e) => {
                                      handleExpenseReceiptFiles(row.key, e.target.files);
                                      e.currentTarget.value = "";
                                    }}
                                  />
                                  <label
                                    htmlFor={`trip-expense-receipt-${row.key}`}
                                    className="button-base border border-blue-200 bg-white text-blue-600 hover:bg-blue-50 cursor-pointer inline-flex items-center"
                                  >
                                    <Upload className="w-3 h-3 mr-0.5" />
                                    첨부
                                  </label>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-1.5 py-1"><Input value={row.remark} onChange={(e) => setExpenseRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, remark: e.target.value } : r)))} className="h-7 text-xs" /></td>
                          <td className="px-1.5 py-1">
                            <div className="flex items-center justify-center gap-1">
                              {!settlementViewOnly && (
                                <button
                                  type="button"
                                  onClick={() => appendExpenseItemForSameReceipt(row.key)}
                                  disabled={row.existingReceipts.length === 0 && row.newReceiptFiles.length === 0}
                                  className={`button-base border text-[10px] whitespace-nowrap ${
                                    row.existingReceipts.length === 0 && row.newReceiptFiles.length === 0
                                      ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                      : "border-blue-200 bg-white text-blue-600 hover:bg-blue-50"
                                  }`}
                                >
                                  +품목
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setExpenseRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== row.key) : prev))}
                                className="text-gray-300 hover:text-red-500"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              )}

              {/* 마일리지 */}
              <div className="border business-radius-card" style={{ width: "max-content", minWidth: "720px" }}>
                <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between">
                  <div>
                    <h3 className="section-title text-gray-800">차량 마일리지 (개인차량)</h3>
                    <p className="text-[10px] text-gray-500 mt-0.5">기준금액: 300원/km · 왕복 300km 이상 시 2인 이상, 오지·핸드캐리 불가 장비 적재 시만 허용</p>
                  </div>
                  {!settlementViewOnly && (
                    <Button
                      onClick={() => setMileageRows((prev) => [...prev, createEmptyMileage(settlementTrip)])}
                      className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    >
                      + 행 추가
                    </Button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-1 modal-label text-left w-[92px]">날짜 ({settlementYearLabel})</th>
                        <th className="px-2 py-1 modal-label text-left w-[104px]">출발지</th>
                        <th className="px-2 py-1 modal-label text-left w-[104px]">도착지</th>
                        <th className="px-2 py-1 modal-label text-left w-[80px]">거리(km)</th>
                        <th className="px-2 py-1 modal-label text-left w-[60px]">단가</th>
                        <th className="px-2 py-1 modal-label text-left w-[110px]">금액</th>
                        <th className="px-2 py-1 modal-label text-left w-[187px]">설명</th>
                        <th className="px-2 py-1 modal-label text-center w-[36px]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {mileageRows.map((row) => (
                        <tr key={row.key} className="border-t">
                          <td className="px-2 py-1">
                            <div className="h-7 flex items-center">
                              <span className="card-description whitespace-nowrap">{tripPeriod.sameDay ? tripPeriod.start : `${tripPeriod.start}~${tripPeriod.end}`}</span>
                            </div>
                          </td>
                          <td className="px-2 py-1"><Input maxLength={20} value={row.origin} onChange={(e) => setMileageRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, origin: e.target.value } : r)))} className="h-7 text-xs" /></td>
                          <td className="px-2 py-1"><Input maxLength={20} value={row.destination} onChange={(e) => setMileageRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, destination: e.target.value } : r)))} className="h-7 text-xs" /></td>
                          <td className="px-2 py-1"><Input value={row.distance_km} onChange={(e) => setMileageRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, distance_km: formatDistanceInput(e.target.value) } : r)))} className="h-7 text-xs text-right w-[80px]" /></td>
                          <td className="px-2 py-1">
                            <div className="h-7 flex items-center">
                              <span className="card-description whitespace-nowrap">300원</span>
                            </div>
                          </td>
                          <td className="px-2 py-1">
                            <div className="h-7 flex items-center justify-end">
                              <span className="card-title whitespace-nowrap">₩{(toNumber(row.distance_km) * 300).toLocaleString()}원</span>
                            </div>
                          </td>
                          <td className="px-2 py-1"><Input value={row.description} onChange={(e) => setMileageRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, description: e.target.value } : r)))} className="h-7 text-xs w-[173px]" /></td>
                          <td className="px-2 py-1 text-center">
                            <button
                              onClick={() => setMileageRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== row.key) : prev))}
                              className="text-gray-300 hover:text-red-500"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 일비 */}
              <div className="border business-radius-card" style={{ width: "max-content", minWidth: "540px" }}>
                <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between">
                  <h3 className="section-title text-gray-800">일비</h3>
                  {!settlementViewOnly && (
                    <Button
                      onClick={() => setAllowanceRows((prev) => [...prev, createEmptyAllowance()])}
                      className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    >
                      + 행 추가
                    </Button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-1 modal-label text-left w-[90px]">이름</th>
                        <th className="px-2 py-1 modal-label text-left w-[138px]">지역</th>
                        <th className="px-2 py-1 modal-label text-left w-[64px]">해당일수</th>
                        <th className="px-2 py-1 modal-label text-left w-[136px]">단위금액</th>
                        <th className="px-2 py-1 modal-label text-left w-[120px]">지급액</th>
                        <th className="px-2 py-1 modal-label text-center w-[36px]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {allowanceRows.map((row) => (
                        <tr key={row.key} className="border-t">
                          <td className="px-2 py-1">
                            {settlementViewOnly ? (
                              <span className="text-xs">{row.person_name || "-"}</span>
                            ) : (
                              <Input value={row.person_name} onChange={(e) => setAllowanceRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, person_name: e.target.value } : r)))} className="h-7 text-xs w-[80px]" />
                            )}
                          </td>
                          <td className="px-2 py-1">
                            <select
                              value={row.region}
                              onChange={(e) => setAllowanceRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, region: e.target.value as AllowanceFormRow["region"] } : r)))}
                              className="h-7 text-xs border border-[#d2d2d7] business-radius-input pl-2 pr-6 w-[130px] bg-white appearance-none bg-no-repeat bg-[length:12px] cursor-pointer"
                              style={{ paddingTop: 0, paddingBottom: 0, lineHeight: "26px", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")", backgroundPosition: "right 6px center" }}
                            >
                              {REGION_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1"><Input value={row.day_count} onChange={(e) => setAllowanceRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, day_count: e.target.value.replace(/[^0-9.]/g, "") } : r)))} className="h-7 text-xs text-right w-[50px]" /></td>
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-1">
                              <Input value={row.unit_amount} onChange={(e) => setAllowanceRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, unit_amount: formatKrwInput(e.target.value) } : r)))} className="h-7 text-xs text-right w-[118px]" />
                              <span className="card-description whitespace-nowrap">원</span>
                            </div>
                          </td>
                          <td className="px-2 py-1 text-right card-title">₩{(toNumber(row.day_count) * toNumber(row.unit_amount)).toLocaleString()}원</td>
                          <td className="px-2 py-1 text-center">
                            <button
                              onClick={() => setAllowanceRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== row.key) : prev))}
                              className="text-gray-300 hover:text-red-500"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            </fieldset>
          )}

          <div className="px-5 py-3 border-t bg-white">
            <DialogFooter className="gap-2 sm:gap-2 border-none p-0">
              {settlementViewOnly ? (
                <>
                  <Button
                    variant="outline"
                    onClick={closeSettlementModal}
                    className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  >
                    닫기
                  </Button>
                  {canApproveSettlement && (
                    <Button
                      className="button-base border border-blue-200 bg-white text-blue-600 hover:bg-blue-50"
                      onClick={() => setSettlementViewOnly(false)}
                    >
                      수정
                    </Button>
                  )}
                  {settlementTrip?.settlement_status === "submitted" && canApproveSettlement && (
                    <>
                      <Button
                        className="button-base border border-red-200 bg-white text-red-600 hover:bg-red-50"
                        onClick={() => {
                          if (settlementTrip) openRejectDialog(settlementTrip.id, "settlement");
                        }}
                      >
                        <X className="w-3 h-3 mr-0.5" />
                        반려
                      </Button>
                      <Button
                        className="button-base bg-green-500 hover:bg-green-600 text-white"
                        onClick={() => {
                          if (settlementTrip) {
                            requestApproveSettlement(settlementTrip.id);
                          }
                        }}
                      >
                        <Check className="w-3 h-3 mr-0.5" />
                        승인
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={closeSettlementModal}
                    className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  >
                    취소
                  </Button>
                  <Button
                    onClick={() => saveSettlement("draft")}
                    disabled={settlementSaving || settlementLoading}
                    className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  >
                    임시저장
                  </Button>
                  <Button
                    onClick={() => saveSettlement("submitted")}
                    disabled={
                      settlementSaving ||
                      settlementLoading ||
                      settlementTrip?.approval_status !== "approved" ||
                      settlementTrip?.settlement_status === "submitted"
                    }
                    className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
                  >
                    {settlementSaving ? "저장 중..." : "정산 제출"}
                  </Button>
                  {settlementTrip?.settlement_status === "submitted" && canApproveSettlement && (
                    <Button
                      onClick={async () => {
                        if (!settlementTrip) return;
                        const tripId = settlementTrip.id;
                        const isSaved = await saveSettlement("submitted");
                        if (isSaved) {
                          requestApproveSettlement(tripId);
                        }
                      }}
                      disabled={settlementSaving || settlementLoading}
                      className="button-base bg-green-500 hover:bg-green-600 text-white"
                    >
                      {settlementSaving ? "저장 중..." : "저장 후 승인"}
                    </Button>
                  )}
                </>
              )}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* 정산 영수증 목록 모달 */}
      <Dialog open={!!receiptViewerRowKey} onOpenChange={(open) => !open && setReceiptViewerRowKey(null)}>
        <DialogContent className="sm:max-w-[620px] p-0 max-h-[85vh] overflow-y-auto">
          <DialogHeader className="px-5 pt-4 pb-3 border-b border-gray-100" style={{ gap: 0 }}>
            <DialogTitle className="text-[14px] font-bold leading-tight">정산 영수증</DialogTitle>
            <p className="page-subtitle leading-tight" style={{ marginTop: "-1px" }}>
              Expense Receipts
            </p>
          </DialogHeader>

          <div className="px-5 py-4">
            {!activeReceiptRow || activeReceiptRow.existingReceipts.length === 0 ? (
              <div className="text-center py-8">
                <p className="card-subtitle">등록된 영수증이 없습니다.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {activeReceiptRow.existingReceipts.map((receipt, idx) => {
                  const fileName = receipt.receipt_url.split("/").pop() || `receipt-${idx + 1}`;
                  return (
                    <div
                      key={receipt.id}
                      className="border business-radius-card px-3 py-2 flex items-center justify-between bg-white"
                    >
                      <div className="min-w-0">
                        <p className="card-title truncate">{fileName}</p>
                        <p className="card-description truncate">{receipt.receipt_url}</p>
                      </div>
                      <div className="flex items-center gap-1.5 ml-3">
                        <Button
                          type="button"
                          className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                          onClick={() => openReceiptPreview(receipt.receipt_url)}
                        >
                          보기
                        </Button>
                        {isAppAdmin && !settlementViewOnly && (
                          <Button
                            type="button"
                            className="button-base border border-red-200 bg-white text-red-600 hover:bg-red-50"
                            onClick={() => {
                              if (!confirm("이 영수증을 삭제하시겠습니까?")) return;
                              handleDeleteExistingReceipt(activeReceiptRow.key, receipt);
                            }}
                          >
                            삭제
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 영수증 미리보기 모달 */}
      <Dialog
        open={receiptPreviewLoading || !!receiptPreviewUrl}
        onOpenChange={(open) => {
          if (!open) {
            setReceiptPreviewLoading(false);
            setReceiptPreviewUrl(null);
            setReceiptPreviewPath("");
            setDirectReceiptList([]);
            setDirectReceiptIdx(0);
          }
        }}
      >
        <DialogContent className="sm:max-w-[860px] p-0 max-h-[90vh] overflow-hidden" showCloseButton={false}>
          <DialogHeader className="px-5 pt-4 pb-3 border-b border-gray-100" style={{ gap: 0 }}>
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <DialogTitle className="text-[14px] font-bold leading-tight">
                  영수증 미리보기
                  {directReceiptList.length > 1 && (
                    <span className="text-[11px] font-normal text-gray-500 ml-2">
                      ({directReceiptIdx + 1} / {directReceiptList.length})
                    </span>
                  )}
                </DialogTitle>
                <p className="page-subtitle leading-tight truncate" style={{ marginTop: "-1px" }}>
                  {receiptPreviewPath.split("/").pop() || "Receipt Preview"}
                </p>
              </div>
              <div className="flex items-center gap-1.5 ml-3 flex-shrink-0">
                {receiptPreviewUrl && (
                  <>
                    <Button
                      type="button"
                      className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      onClick={() => {
                        if (!receiptPreviewUrl) return;
                        const link = document.createElement("a");
                        link.href = receiptPreviewUrl;
                        link.download = receiptPreviewPath.split("/").pop() || "receipt";
                        link.target = "_blank";
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      }}
                    >
                      <Download className="w-3.5 h-3.5 mr-1" />
                      다운로드
                    </Button>
                    {!receiptPreviewPath.toLowerCase().endsWith(".pdf") && (
                      <Button
                        type="button"
                        className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                        onClick={() => {
                          if (!receiptPreviewUrl) return;
                          const w = window.open("", "_blank");
                          if (w) {
                            w.document.write(`<html><head><title>영수증 출력</title></head><body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f5f5f5"><img src="${receiptPreviewUrl}" style="max-width:100%;max-height:100vh;object-fit:contain" onload="window.print();"/></body></html>`);
                            w.document.close();
                          }
                        }}
                      >
                        <Printer className="w-3.5 h-3.5 mr-1" />
                        출력
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </DialogHeader>
          <div className="px-5 py-4 bg-gray-50">
            {receiptPreviewLoading ? (
              <div className="h-[65vh] flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-hansl-500 border-t-transparent rounded-full animate-spin" />
                <span className="ml-3 card-subtitle">미리보기를 불러오는 중...</span>
              </div>
            ) : receiptPreviewUrl ? (
              receiptPreviewPath.toLowerCase().endsWith(".pdf") ? (
                <iframe src={receiptPreviewUrl} className="w-full h-[70vh] bg-white business-radius-card" title="receipt-preview" />
              ) : (
                <div className="w-full h-[70vh] bg-white business-radius-card flex items-center justify-center overflow-hidden">
                  <img src={receiptPreviewUrl} alt="receipt-preview" className="max-w-full max-h-full object-contain" />
                </div>
              )
            ) : (
              <div className="h-[65vh] flex items-center justify-center">
                <p className="card-subtitle">미리보기 URL을 불러오지 못했습니다.</p>
              </div>
            )}
          </div>
          {directReceiptList.length > 1 && (
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-center gap-3">
              <Button
                type="button"
                disabled={directReceiptIdx <= 0 || receiptPreviewLoading}
                className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                onClick={() => navigateDirectReceipt(directReceiptIdx - 1)}
              >
                <ChevronLeft className="w-3.5 h-3.5 mr-0.5" />
                이전
              </Button>
              <span className="text-[11px] text-gray-500">
                {directReceiptIdx + 1} / {directReceiptList.length}
              </span>
              <Button
                type="button"
                disabled={directReceiptIdx >= directReceiptList.length - 1 || receiptPreviewLoading}
                className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                onClick={() => navigateDirectReceipt(directReceiptIdx + 1)}
              >
                다음
                <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 반려 입력 다이얼로그 */}
      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="modal-title">
              {rejectMode === "approval" ? "출장 승인 반려" : "정산 반려"}
            </AlertDialogTitle>
            <AlertDialogDescription className="card-subtitle">
              반려 사유를 입력해주세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="반려 사유를 입력해주세요"
            className="text-xs min-h-[80px] bg-white border-[#d2d2d7] business-radius-input"
          />
          <AlertDialogFooter>
            <AlertDialogCancel className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              className="button-base bg-red-500 hover:bg-red-600 text-white"
            >
              반려
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 정산 승인 + 카드 반납 확인 다이얼로그 */}
      <AlertDialog open={settlementApproveConfirmOpen} onOpenChange={setSettlementApproveConfirmOpen}>
        <AlertDialogContent className="sm:max-w-[420px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="modal-title">정산 승인 확인</AlertDialogTitle>
            <AlertDialogDescription className="text-[12px] text-gray-600 whitespace-normal break-keep leading-relaxed">
              {(() => {
                const targetTrip = trips.find((t) => t.id === settlementApproveTargetId);
                const hasCard = Boolean(targetTrip?.linkedCard);
                return hasCard
                  ? "정산을 승인하면 법인카드가 자동으로 반납 처리됩니다. 카드가 실제로 반납되었는지 확인하셨습니까?"
                  : "해당 출장의 정산을 승인하시겠습니까?";
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleApproveSettlement}
              className="button-base bg-green-500 hover:bg-green-600 text-white"
            >
              확인 및 승인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
        <AlertDialogContent className="sm:max-w-[360px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="modal-title">신청 완료</AlertDialogTitle>
            <AlertDialogDescription className="text-[12px] text-gray-600">
              출장 신청이 정상적으로 완료되었습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => setSuccessDialogOpen(false)}
              className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
            >
              확인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
