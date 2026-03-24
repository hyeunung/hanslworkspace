
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
import ReactSelect from "react-select";
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
import { Car, RefreshCw, AlertTriangle, Check, X, Calendar as CalendarIcon, Trash2 } from "lucide-react";
import { parseRoles } from '@/utils/roleHelper';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import type { DateRange } from "react-day-picker";

const VEHICLE_APPROVER_ROLES = ["hr", "superadmin"];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return { value: `${h}:${m}`, label: `${h}:${m}` };
});

interface VehicleRequest {
  id: number;
  requester_id: string | null;
  use_department: string;
  purpose: string;
  vehicle_info: string;
  route: string;
  driver_id: string | null;
  companions: { id: string; name: string }[] | null;
  passenger_count: number;
  start_at: string;
  end_at: string;
  duration_hours: number | null;
  notes: string | null;
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  business_trip_id: number | null;
  auto_created_by_trip: boolean;
  created_at: string | null;
  updated_at: string | null;
  requester?: { name: string; department: string | null } | null;
  driver?: { name: string } | null;
  business_trip?: { trip_code: string } | null;
}

interface Employee {
  id: string;
  name: string | null;
  department: string | null;
  position: string | null;
  email: string | null;
  roles?: string[] | null;
}

interface VehicleTabProps {
  mode?: "list" | "create";
  onBadgeRefresh?: () => void;
}

const COMPANY_VEHICLES = [
  { label: "PALISADE", plate: "259누 8222", value: "PALISADE 259누 8222" },
  { label: "STARIA", plate: "715루 7024", value: "STARIA 715루 7024" },
  { label: "GV80", plate: "330조 1022", value: "GV80 330조 1022" },
  { label: "G90", plate: "322모 3801", value: "G90 322모 3801" },
  { label: "F150 Raptor", plate: "8381", value: "F150 Raptor 8381" },
  { label: "PORTER", plate: "93부 0351", value: "PORTER 93부 0351" },
];

const VEHICLE_NAME_WIDTH = "90px";

const VEHICLE_FIXED_STATUS: Record<string, { status: "away"; driver: string; destination: string }> = {
  "PORTER": { status: "away", driver: "", destination: "청송 출장중" },
};

const formatVehicleOption = (option: { label: string; plate: string; value: string }) => (
  <div className="flex items-center text-xs" style={{ pointerEvents: "none" }}>
    <span className="font-medium text-gray-900" style={{ width: VEHICLE_NAME_WIDTH, flexShrink: 0 }}>{option.label}</span>
    <span className="text-gray-300 mx-1.5">|</span>
    <span className="text-gray-500">{option.plate}</span>
  </div>
);

const VEHICLE_NOTICE = `[차량신청자 주의사항]
1. 차량 사용 후 반드시 주행거리, 주유상태를 확인하고 반납하여 주시기 바랍니다.
2. 차량 내부를 깨끗이 정리 후 반납하여 주시기 바랍니다.
3. 차량 이상 발견 시 즉시 관리부서에 보고하여 주시기 바랍니다.
4. 음주운전, 무면허 운전 등 교통법규를 준수하여 주시기 바랍니다.
5. 사고 발생 시 즉시 관리부서에 보고하여 주시기 바랍니다.`;

const reactSelectStyles = {
  control: (base: Record<string, unknown>) => ({
    ...base,
    height: "28px",
    minHeight: "28px",
    fontSize: "0.75rem",
    backgroundColor: "#fff",
    borderColor: "#d2d2d7",
    borderRadius: "6px",
    boxShadow: "none",
    "&:hover": {
      borderColor: "#b8b8bd",
    },
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
    "&:active": {
      backgroundColor: "#d1d5db",
    },
  }),
  menu: (base: Record<string, unknown>) => ({
    ...base,
    zIndex: 99999,
  }),
  menuList: (base: Record<string, unknown>) => ({
    ...base,
    maxHeight: "200px",
    overflowY: "auto" as const,
  }),
  menuPortal: (base: Record<string, unknown>) => ({
    ...base,
    zIndex: 99999,
    pointerEvents: "auto" as const,
  }),
};

function formatDuration(hours: number | null): string {
  if (hours == null || hours < 0) return "-";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

export default function VehicleTab({ mode = "list", onBadgeRefresh }: VehicleTabProps) {
  const supabase = createClient();
  const isCreateMode = mode === "create";

  const [requests, setRequests] = useState<VehicleRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // form state
  const [formDepartment, setFormDepartment] = useState("");
  const [formPurpose, setFormPurpose] = useState("");
  const [formVehicle, setFormVehicle] = useState<string | null>(null);
  const [formRoute, setFormRoute] = useState("");
  const [formDriverId, setFormDriverId] = useState<string | null>(null);
  const [formCompanions, setFormCompanions] = useState<
    { id: string; name: string }[]
  >([]);
  const [formDateRange, setFormDateRange] = useState<DateRange | undefined>(undefined);
  const [formStartTime, setFormStartTime] = useState("09:00");
  const [formEndTime, setFormEndTime] = useState("18:00");
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [formNotes, setFormNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const vehicleStatusMap = useMemo(() => {
    const map: Record<string, { status: "standby" | "away"; driver: string; destination: string }> = {};
    for (const v of COMPANY_VEHICLES) {
      const fixed = VEHICLE_FIXED_STATUS[v.label];
      if (fixed) {
        map[v.label] = fixed;
        continue;
      }
      const activeReq = requests.find(
        (r) =>
          r.approval_status === "approved" &&
          r.vehicle_info?.startsWith(v.label) &&
          new Date(r.start_at) <= now &&
          new Date(r.end_at) >= now
      );
      if (activeReq) {
        map[v.label] = {
          status: "away",
          driver: activeReq.driver?.name || activeReq.requester?.name || "",
          destination: activeReq.route || "",
        };
      } else {
        map[v.label] = { status: "standby", driver: "", destination: "" };
      }
    }
    return map;
  }, [requests, now]);

  useEffect(() => {
    const handler = (e: WheelEvent) => {
      const target = e.target as HTMLElement;
      const menuList = target?.closest('[id*="listbox"]') as HTMLElement | null;
      if (menuList) menuList.scrollTop += e.deltaY;
    };
    document.addEventListener('wheel', handler, { capture: true, passive: true });
    return () => document.removeEventListener('wheel', handler, { capture: true });
  }, []);

  const canApprove = useMemo(() => {
    const roles = parseRoles(currentUser?.roles);
    return roles.some((r: string) => VEHICLE_APPROVER_ROLES.includes(r));
  }, [currentUser?.roles]);

  const isAppAdmin = useMemo(() => {
    const roles = parseRoles(currentUser?.roles);
    return roles.includes("superadmin");
  }, [currentUser?.roles]);

  const loadRequests = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("vehicle_requests")
        .select(
          "*, requester:employees!vehicle_requests_requester_id_fkey(name, department), driver:employees!vehicle_requests_driver_id_fkey(name), business_trip:business_trips!vehicle_requests_business_trip_id_fkey(trip_code)"
        )
        .order("created_at", { ascending: false });

      if (error) throw error;
      setRequests((data as unknown as VehicleRequest[]) || []);
    } catch (err) {
      logger.error("차량 요청 목록 조회 실패", err);
      toast.error("차량 요청 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const handleDeleteRequest = useCallback(async (id: number) => {
    if (!confirm("이 배차 요청을 삭제하시겠습니까?")) return;
    try {
      const { error } = await supabase.from("vehicle_requests").delete().eq("id", id);
      if (error) throw error;
      toast.success("삭제되었습니다.");
      loadRequests();
      onBadgeRefresh?.();
    } catch {
      toast.error("삭제에 실패했습니다.");
    }
  }, [supabase, loadRequests]);

  const loadEmployees = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("employees")
        .select("id, name, department, position, email")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      setEmployees(data || []);
    } catch (err) {
      logger.error("직원 목록 조회 실패", err);
    }
  }, [supabase]);

  const loadCurrentUser = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.email) return;
      const { data } = await supabase
        .from("employees")
        .select("id, name, department, position, email, roles")
        .eq("email", user.email)
        .single();
      if (data) setCurrentUser(data);
    } catch (err) {
      logger.error("현재 사용자 조회 실패", err);
    }
  }, [supabase]);

  useEffect(() => {
    loadRequests();
    loadEmployees();
    loadCurrentUser();
  }, [loadRequests, loadEmployees, loadCurrentUser]);

  const sortedRequests = useMemo(() => {
    return [...requests].sort((a, b) => {
      if (a.approval_status === "pending" && b.approval_status !== "pending") return -1;
      if (a.approval_status !== "pending" && b.approval_status === "pending") return 1;
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();
      return dateB - dateA;
    });
  }, [requests]);

  const passengerCount = useMemo(() => {
    return 1 + formCompanions.length;
  }, [formCompanions]);

  const combineDateTime = useCallback((date: Date | undefined | null, time: string): Date | null => {
    if (!date) return null;
    const [h, m] = time.split(":").map(Number);
    const combined = new Date(date);
    combined.setHours(h || 0, m || 0, 0, 0);
    return combined;
  }, []);

  const startDate = formDateRange?.from;
  const endDate = formDateRange?.to ?? formDateRange?.from;

  const combinedStart = useMemo(() => combineDateTime(startDate, formStartTime), [startDate, formStartTime, combineDateTime]);
  const combinedEnd = useMemo(() => combineDateTime(endDate, formEndTime), [endDate, formEndTime, combineDateTime]);

  const isTimeReversed = useMemo(() => {
    if (!combinedStart || !combinedEnd) return false;
    return combinedEnd.getTime() <= combinedStart.getTime();
  }, [combinedStart, combinedEnd]);

  const calculatedDuration = useMemo(() => {
    if (!combinedStart || !combinedEnd) return null;
    const diffMs = combinedEnd.getTime() - combinedStart.getTime();
    if (diffMs <= 0) return null;
    return diffMs / (1000 * 60 * 60);
  }, [combinedStart, combinedEnd]);

  const employeeOptions = useMemo(
    () =>
      employees
        .filter((e) => e.name)
        .map((e) => ({
          value: e.id,
          label: `${e.name}${e.department ? ` (${e.department})` : ""}`,
        })),
    [employees]
  );

  const departmentOptions = useMemo(() => {
    const depts = new Set<string>();
    employees.forEach((e) => {
      if (e.department) depts.add(e.department);
    });
    return Array.from(depts)
      .sort()
      .map((d) => ({ value: d, label: d }));
  }, [employees]);

  const resetForm = useCallback(() => {
    setFormDepartment(currentUser?.department || "");
    setFormPurpose("");
    setFormVehicle(null);
    setFormRoute("");
    setFormDriverId(currentUser?.id || null);
    setFormCompanions([]);
    setFormDateRange(undefined);
    setFormStartTime("09:00");
    setFormEndTime("18:00");
    setFormNotes("");
  }, [currentUser]);

  useEffect(() => {
    if (isCreateMode) {
      resetForm();
    }
  }, [isCreateMode, resetForm]);

  const vehicleButtonDisabled = submitting || isTimeReversed || !formDepartment || !formPurpose || !formVehicle || !formRoute || !formDriverId || !combinedStart || !combinedEnd;

  const handleSubmit = useCallback(async () => {
    if (!formDepartment || !formPurpose || !formVehicle || !formRoute || !formDriverId) {
      toast.error("필수 항목을 모두 입력해주세요.");
      return;
    }
    if (!combinedStart || !combinedEnd) {
      toast.error("운행 날짜 및 시간을 입력해주세요.");
      return;
    }
    if (combinedEnd <= combinedStart) {
      toast.error("종료 일시는 시작 일시보다 이후여야 합니다.");
      return;
    }

    try {
      setSubmitting(true);
      const { error } = await supabase.from("vehicle_requests").insert({
        requester_id: currentUser?.id || null,
        use_department: formDepartment,
        purpose: formPurpose,
        vehicle_info: formVehicle,
        route: formRoute,
        driver_id: formDriverId,
        companions: formCompanions,
        passenger_count: passengerCount,
        start_at: combinedStart.toISOString(),
        end_at: combinedEnd.toISOString(),
        notes: formNotes || null,
      });

      if (error) throw error;

      if (isCreateMode) {
        resetForm();
      } else {
        setIsModalOpen(false);
      }
      loadRequests();
      onBadgeRefresh?.();
      setSuccessDialogOpen(true);
    } catch (err) {
      logger.error("차량 요청 등록 실패", err);
      toast.error("등록에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }, [
    formDepartment,
    formPurpose,
    formVehicle,
    formRoute,
    combinedStart,
    combinedEnd,
    formDriverId,
    formCompanions,
    formNotes,
    passengerCount,
    currentUser,
    supabase,
    loadRequests,
    isCreateMode,
    resetForm,
  ]);

  const handleApprove = useCallback(
    async (requestId: number) => {
      try {
        const { error } = await supabase
          .from("vehicle_requests")
          .update({
            approval_status: "approved",
            approved_by: currentUser?.id || null,
            approved_at: new Date().toISOString(),
          })
          .eq("id", requestId);

        if (error) throw error;
        toast.success("배차 요청이 승인되었습니다.");
        loadRequests();
        onBadgeRefresh?.();
      } catch (err) {
        logger.error("배차 승인 실패", err);
        toast.error("승인 처리에 실패했습니다.");
      }
    },
    [supabase, currentUser, loadRequests]
  );

  const handleReject = useCallback(async () => {
    if (!rejectTargetId) return;
    if (!rejectReason.trim()) {
      toast.error("반려 사유를 입력해주세요.");
      return;
    }
    try {
      const { error } = await supabase
        .from("vehicle_requests")
        .update({
          approval_status: "rejected",
          approved_by: currentUser?.id || null,
          approved_at: new Date().toISOString(),
          rejection_reason: rejectReason.trim(),
        })
        .eq("id", rejectTargetId);

      if (error) throw error;
      toast.success("배차 요청이 반려되었습니다.");
      setRejectDialogOpen(false);
      setRejectTargetId(null);
      setRejectReason("");
      loadRequests();
      onBadgeRefresh?.();
    } catch (err) {
      logger.error("배차 반려 실패", err);
      toast.error("반려 처리에 실패했습니다.");
    }
  }, [supabase, currentUser, rejectTargetId, rejectReason, loadRequests]);

  const openRejectDialog = useCallback((requestId: number) => {
    setRejectTargetId(requestId);
    setRejectReason("");
    setRejectDialogOpen(true);
  }, []);

  const getStatusBadge = (status: string) => {
    const map: Record<string, { text: string; cls: string }> = {
      pending: { text: "승인대기", cls: "bg-orange-500 text-white" },
      approved: { text: "승인완료", cls: "bg-green-500 text-white" },
      rejected: { text: "반려", cls: "bg-red-500 text-white" },
    };
    const conf = map[status] || { text: status, cls: "bg-gray-100 text-gray-600" };
    return <span className={`badge-stats ${conf.cls}`}>{conf.text}</span>;
  };

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          {!isCreateMode && (
          <div>
            <h1 className="page-title">차량 관리</h1>
            <p
              className="page-subtitle"
              style={{ marginTop: "-2px", marginBottom: "-4px" }}
            >
              Vehicle Management
            </p>
          </div>
          )}
          {!isCreateMode && (
            <div className="flex items-center gap-2">
              <Button
                onClick={() => loadRequests()}
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
            <h1>배 차 요 청 서</h1>
            <div className="doc-subtitle">Vehicle Request Form</div>
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
                    placeholder="부서 선택"
                    isSearchable
                    menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                    menuShouldBlockScroll={false}
                    styles={reactSelectStyles}
                    noOptionsMessage={() => "없음"}
                  />
                </div>
              </div>
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">운행차량 <span className="required">*</span></div>
                <div className="doc-select-container">
                  <ReactSelect
                    options={COMPANY_VEHICLES}
                    value={formVehicle ? COMPANY_VEHICLES.find((v) => v.value === formVehicle) || null : null}
                    onChange={(opt) => setFormVehicle((opt as { value: string } | null)?.value || null)}
                    placeholder="차량 선택"
                    isSearchable
                    menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                    menuShouldBlockScroll={false}
                    styles={reactSelectStyles}
                    noOptionsMessage={() => "없음"}
                    formatOptionLabel={formatVehicleOption}
                  />
                </div>
              </div>
            </div>

            <div className="doc-form-row" style={{ flexWrap: "wrap" }}>
              <div className="doc-form-cell" style={{ flex: "1 1 30%" }}>
                <div className="doc-form-cell-label">운전자 <span className="required">*</span></div>
                <div className="doc-select-container">
                  <ReactSelect
                    options={employeeOptions}
                    value={formDriverId ? employeeOptions.find((o) => o.value === formDriverId) || null : null}
                    onChange={(opt) => setFormDriverId((opt as { value: string } | null)?.value || null)}
                    placeholder="선택"
                    isSearchable
                    menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                    menuShouldBlockScroll={false}
                    styles={reactSelectStyles}
                    noOptionsMessage={() => "없음"}
                    filterOption={(option, inputValue) => option.label.toLowerCase().includes(inputValue.toLowerCase())}
                    formatOptionLabel={(option, { context }) => {
                      if (context === "value") {
                        const name = (option as { label: string }).label.replace(/\s*\(.*\)$/, "");
                        return <span className="text-[11px]">{name}</span>;
                      }
                      return <span className="text-[11px]">{(option as { label: string }).label}</span>;
                    }}
                  />
                </div>
              </div>
              <div className="doc-form-cell" style={{ flex: "1 1 30%" }}>
                <div className="doc-form-cell-label">동승자</div>
                <div className="doc-select-container">
                  <ReactSelect
                    options={employeeOptions.filter(
                      (o) => o.value !== formDriverId && !formCompanions.some((c) => c.id === o.value)
                    )}
                    value={null}
                    onChange={(opt) => {
                      const selected = opt as { value: string; label: string } | null;
                      if (!selected) return;
                      const emp = employees.find((e) => e.id === selected.value);
                      if (emp) {
                        setFormCompanions((prev) => [...prev, { id: emp.id, name: emp.name || "" }]);
                      }
                    }}
                    placeholder="추가"
                    isSearchable
                    menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                    menuShouldBlockScroll={false}
                    styles={reactSelectStyles}
                    noOptionsMessage={() => "없음"}
                    filterOption={(option, inputValue) => option.label.toLowerCase().includes(inputValue.toLowerCase())}
                  />
                </div>
              </div>
              <div className="doc-form-cell" style={{ flex: "0 0 80px" }}>
                <div className="doc-form-cell-label">탑승인원</div>
                <div className="doc-form-static justify-center">{passengerCount}명</div>
              </div>
              {formCompanions.length > 0 && (
                <div className="flex flex-wrap gap-1 w-full pt-1">
                  {formCompanions.map((c) => (
                    <span
                      key={c.id}
                      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded"
                    >
                      {c.name}
                      <button
                        type="button"
                        onClick={() => setFormCompanions((prev) => prev.filter((p) => p.id !== c.id))}
                        className="text-blue-400 hover:text-blue-600 ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="doc-form-row">
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">운행지 <span className="required">*</span></div>
                <Input
                  value={formRoute}
                  onChange={(e) => setFormRoute(e.target.value)}
                  placeholder="입력"
                  className="doc-form-input"
                />
              </div>
              <div className="doc-form-cell">
                <div className="doc-form-cell-label flex items-center gap-1">
                  운행 날짜 및 시간 <span className="required">*</span>
                  {isTimeReversed ? (
                    <span className="text-red-500 text-[9px] font-medium">역행</span>
                  ) : calculatedDuration != null && calculatedDuration > 0 ? (
                    <span className="text-blue-600 text-[9px] font-medium">{formatDuration(calculatedDuration)}</span>
                  ) : null}
                </div>
                <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className={`doc-date-trigger ${isTimeReversed ? "!border-b-red-400" : ""}`}
                    >
                      <CalendarIcon className={`mr-1.5 h-3.5 w-3.5 flex-shrink-0 ${isTimeReversed ? "text-red-400" : "text-gray-400"}`} />
                      {startDate ? (
                        endDate && endDate.getTime() !== startDate.getTime() ? (
                          <span className="truncate">{format(startDate, "MM/dd")} {formStartTime} ~ {format(endDate, "MM/dd")} {formEndTime}</span>
                        ) : (
                          <span className="truncate">{format(startDate, "yyyy-MM-dd")} {formStartTime} ~ {formEndTime}</span>
                        )
                      ) : (
                        <span className="text-gray-300">선택</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 border-gray-200 shadow-lg" align="start" side="bottom" sideOffset={8}>
                    <div className="bg-white business-radius-card p-3">
                      <div className="mb-2 px-1">
                        <div className="modal-label text-gray-600 text-center">날짜를 선택하세요 (1회: 당일, 2회: 기간)</div>
                      </div>
                      <Calendar
                        mode="range"
                        selected={formDateRange}
                        onSelect={(range) => setFormDateRange(range)}
                        locale={ko}
                        className="compact-calendar"
                        fromDate={new Date("2020-01-01")}
                        toDate={new Date("2030-12-31")}
                        defaultMonth={new Date()}
                        modifiers={{ today: new Date() }}
                        modifiersClassNames={{
                          today:
                            "bg-blue-500 text-white font-semibold cursor-pointer hover:bg-blue-600 rounded-md",
                        }}
                      />
                      <div className="border-t border-gray-100 mt-2 pt-3 px-1">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="modal-label mb-1 block">시작 시간</Label>
                            <ReactSelect
                              options={TIME_OPTIONS}
                              value={TIME_OPTIONS.find((o) => o.value === formStartTime) || null}
                              onChange={(opt) => setFormStartTime((opt as { value: string } | null)?.value || "09:00")}
                              placeholder="시간"
                              isSearchable={false}
                              menuPlacement="auto"
                              styles={reactSelectStyles}
                            />
                          </div>
                          <div>
                            <Label className="modal-label mb-1 block">종료 시간</Label>
                            <ReactSelect
                              options={TIME_OPTIONS}
                              value={TIME_OPTIONS.find((o) => o.value === formEndTime) || null}
                              onChange={(opt) => setFormEndTime((opt as { value: string } | null)?.value || "18:00")}
                              placeholder="시간"
                              isSearchable={false}
                              menuPlacement="auto"
                              styles={reactSelectStyles}
                            />
                          </div>
                        </div>
                      </div>
                      {isTimeReversed && (
                        <div className="mt-2 px-1">
                          <p className="card-description text-red-500 font-medium">종료 일시가 시작 일시보다 빠릅니다. 시간을 다시 선택해주세요.</p>
                        </div>
                      )}
                      <div className="border-t border-gray-100 mt-3 pt-2 flex justify-end">
                        <Button
                          type="button"
                          className="button-base bg-blue-500 hover:bg-blue-600 text-white"
                          onClick={() => setDatePopoverOpen(false)}
                          disabled={!startDate || isTimeReversed}
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
                <div className="doc-form-cell-label">사용목적 <span className="required">*</span></div>
                <Input
                  value={formPurpose}
                  onChange={(e) => setFormPurpose(e.target.value)}
                  placeholder="거래처 미팅, 현장 출장 등"
                  className="doc-form-input"
                />
              </div>
            </div>

            <div className="doc-form-row" style={{ borderBottom: "none" }}>
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">특이사항 (메모)</div>
                <Textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="특이사항이 있으면 입력해주세요"
                  className="doc-form-textarea"
                />
              </div>
            </div>
          </div>

          <div className="doc-form-notice">
            <pre className="whitespace-pre-wrap font-sans leading-relaxed">{VEHICLE_NOTICE}</pre>
          </div>

          <div className="doc-form-footer">
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={vehicleButtonDisabled}
              className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
            >
              {submitting ? "등록 중..." : "배차요청"}
            </Button>
          </div>
        </div>
      )}

      {!isCreateMode && (
      <>
      {/* 법인차량 실시간 현황 */}
      <div className="mb-4 grid grid-cols-6 gap-2">
        {COMPANY_VEHICLES.map((v) => {
          const info = vehicleStatusMap[v.label];
          const isAway = info?.status === "away";
          return (
            <div
              key={v.label}
              className={`border business-radius-card px-3 py-2.5 ${isAway ? "border-orange-200 bg-orange-50/50" : "border-gray-200 bg-white"}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-gray-900">{v.label}</span>
                <span className={`badge-stats ${isAway ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-600"}`}>
                  {isAway ? "출타중" : "대기중"}
                </span>
              </div>
              {isAway && info ? (
                <div>
                  {info.driver && <p className="text-[10px] text-gray-600 truncate">{info.driver}</p>}
                  <p className="text-[10px] text-gray-500 truncate">{info.destination}</p>
                </div>
              ) : (
                <p className="text-[10px] text-gray-400">배차 가능</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Table */}
      <span className="text-[11px] font-medium text-gray-400">{new Date().getFullYear()}</span>
      <Card className="overflow-hidden border border-gray-200 w-full max-w-full">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-hansl-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 card-subtitle">로딩 중...</span>
            </div>
          ) : sortedRequests.length === 0 ? (
            <div className="text-center py-12">
              <Car className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                배차 요청이 없습니다
              </h3>
              <p className="card-subtitle">
                새로운 배차 요청을 등록해보세요.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto overflow-y-auto max-h-[70vh] border rounded-lg">
              <table className="w-full min-w-[1300px] border-collapse">
                <thead
                  className="sticky top-0 z-30 bg-gray-50"
                  style={{ boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)" }}
                >
                  <tr>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center w-[80px]">
                      상태
                    </th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[68px]">
                      신청일
                    </th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[110px]">
                      출장코드
                    </th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[135px]">
                      운행일시
                    </th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[120px]">
                      요청차량
                    </th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[76px]">
                      요청자
                    </th>
                    <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[100px]">
                      동승자
                    </th>
                    <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[150px]">
                      운행지
                    </th>
                    <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left">
                      사용목적
                    </th>
                    <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left">
                      특이사항
                    </th>
                    {isAppAdmin && (
                      <th className="px-2 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center w-[40px]"></th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sortedRequests.map((req) => (
                    <tr
                      key={req.id}
                      className="border-b hover:bg-gray-100 cursor-pointer transition-colors"
                    >
                      <td className="px-2 py-1.5 text-center whitespace-nowrap">
                        {canApprove && req.approval_status === "pending" ? (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => e.stopPropagation()}
                                className="badge-stats bg-orange-500 text-white cursor-pointer hover:bg-orange-600 transition-colors"
                              >
                                승인대기
                              </button>
                            </PopoverTrigger>
                            <PopoverContent
                              className="w-auto p-2 border-gray-200 shadow-lg"
                              align="start"
                              side="bottom"
                              sideOffset={4}
                              onClick={(e: React.MouseEvent) => e.stopPropagation()}
                            >
                              <div className="flex gap-1.5">
                                <Button
                                  onClick={(e) => { e.stopPropagation(); handleApprove(req.id); }}
                                  className="button-base bg-green-500 hover:bg-green-600 text-white"
                                >
                                  <Check className="w-3 h-3 mr-0.5" />
                                  승인
                                </Button>
                                <Button
                                  onClick={(e) => { e.stopPropagation(); openRejectDialog(req.id); }}
                                  className="button-base border border-red-200 bg-white text-red-600 hover:bg-red-50"
                                >
                                  <X className="w-3 h-3 mr-0.5" />
                                  반려
                                </Button>
                              </div>
                            </PopoverContent>
                          </Popover>
                        ) : (
                          getStatusBadge(req.approval_status)
                        )}
                      </td>
                      <td className="px-2 py-1.5 card-date whitespace-nowrap">
                        {req.created_at ? format(new Date(req.created_at), "MM/dd") : "-"}
                      </td>
                      <td className="px-2 py-1.5 card-title whitespace-nowrap">
                        {req.business_trip?.trip_code || "-"}
                      </td>
                      <td className="px-2 py-0.5 whitespace-nowrap">
                        {req.start_at && req.end_at ? (
                          <div className="leading-tight">
                            <div className="text-[11px] font-medium text-gray-900">
                              {format(new Date(req.start_at), "MM/dd")} ~ {format(new Date(req.end_at), "MM/dd")}
                            </div>
                            <div className="text-[9.5px] text-gray-500">
                              {format(new Date(req.start_at), "HH:mm")} ~ {format(new Date(req.end_at), "HH:mm")}
                            </div>
                          </div>
                        ) : "-"}
                      </td>
                      <td className="px-2 py-1.5 card-title whitespace-nowrap truncate max-w-[100px]">
                        {req.vehicle_info?.split(" ")[0] || "-"}
                      </td>
                      <td className="px-2 py-1.5 card-title whitespace-nowrap truncate max-w-[80px]">
                        {req.requester?.name || "-"}
                      </td>
                      <td className="px-2 py-1.5 card-title whitespace-normal break-keep">
                        {req.companions && req.companions.length > 0
                          ? req.companions.map((c) => c.name).join(", ")
                          : "-"}
                      </td>
                      <td className="px-2 py-1.5 card-title truncate max-w-[140px]">
                        {req.route}
                      </td>
                      <td className="px-2 py-1.5 card-title truncate max-w-[100px]">
                        {req.purpose}
                      </td>
                      <td className="px-2 py-1.5 card-title truncate max-w-[100px]">
                        {req.notes || "-"}
                      </td>
                      {isAppAdmin && (
                        <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="text-gray-300 hover:text-red-500 transition-colors"
                            onClick={() => handleDeleteRequest(req.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      </>
      )}

      {/* 배차 요청 모달 */}
      {!isCreateMode && (
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto p-0 gap-0">
          <DialogHeader className="gap-0 py-3">
            <DialogTitle className="modal-title leading-tight">배차 요청</DialogTitle>
            <p className="page-subtitle leading-tight" style={{ marginTop: "-1px" }}>Vehicle Dispatch Request</p>
          </DialogHeader>

          <div className="px-5 py-3 space-y-4">
            {/* 사용부서 / 운행차량 (2열) */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">사용부서<span className="text-red-500 ml-0.5">*</span></Label>
                <ReactSelect
                  options={departmentOptions}
                  value={formDepartment ? { value: formDepartment, label: formDepartment } : null}
                  onChange={(opt) => setFormDepartment((opt as { value: string } | null)?.value || "")}
                  placeholder="부서 선택"
                  isSearchable
                  menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                  menuShouldBlockScroll={false}
                  styles={reactSelectStyles}
                  noOptionsMessage={() => "없음"}
                />
              </div>
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">운행차량<span className="text-red-500 ml-0.5">*</span></Label>
                <ReactSelect
                  options={COMPANY_VEHICLES}
                  value={formVehicle ? COMPANY_VEHICLES.find((v) => v.value === formVehicle) || null : null}
                  onChange={(opt) => setFormVehicle((opt as { value: string } | null)?.value || null)}
                  placeholder="차량 선택"
                  isSearchable
                  menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                  menuShouldBlockScroll={false}
                  styles={reactSelectStyles}
                  noOptionsMessage={() => "없음"}
                  formatOptionLabel={formatVehicleOption}
                />
              </div>
            </div>

            {/* 운전자 / 동승자 / 탑승인원 (3열) */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">운전자<span className="text-red-500 ml-0.5">*</span></Label>
                <ReactSelect
                  options={employeeOptions}
                  value={formDriverId ? employeeOptions.find((o) => o.value === formDriverId) || null : null}
                  onChange={(opt) => setFormDriverId((opt as { value: string } | null)?.value || null)}
                  placeholder="요청자"
                  isSearchable
                  menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                  menuShouldBlockScroll={false}
                  styles={reactSelectStyles}
                  noOptionsMessage={() => "없음"}
                  filterOption={(option, inputValue) => option.label.toLowerCase().includes(inputValue.toLowerCase())}
                  formatOptionLabel={(option, { context }) => {
                    if (context === "value") {
                      const name = (option as { label: string }).label.replace(/\s*\(.*\)$/, "");
                      return <span className="text-xs">{name}</span>;
                    }
                    return <span className="text-xs">{(option as { label: string }).label}</span>;
                  }}
                />
              </div>
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">동승자</Label>
                <ReactSelect
                  options={employeeOptions.filter(
                    (o) => o.value !== formDriverId && !formCompanions.some((c) => c.id === o.value)
                  )}
                  value={null}
                  onChange={(opt) => {
                    const selected = opt as { value: string; label: string } | null;
                    if (!selected) return;
                    const emp = employees.find((e) => e.id === selected.value);
                    if (emp) {
                      setFormCompanions((prev) => [...prev, { id: emp.id, name: emp.name || "" }]);
                    }
                  }}
                  placeholder="추가"
                  isSearchable
                  menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                  menuShouldBlockScroll={false}
                  styles={reactSelectStyles}
                  noOptionsMessage={() => "없음"}
                  filterOption={(option, inputValue) => option.label.toLowerCase().includes(inputValue.toLowerCase())}
                />
              </div>
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">탑승인원</Label>
                <div className="h-[28px] flex items-center justify-center bg-gray-50 border border-[#d2d2d7] business-radius-input">
                  <span className="text-xs text-gray-700">{passengerCount}명</span>
                </div>
              </div>
            </div>
            {formCompanions.length > 0 && (
              <div className="flex flex-wrap gap-1 -mt-1">
                {formCompanions.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1 badge-stats bg-blue-50 text-blue-700 border border-blue-200"
                  >
                    {c.name}
                    <button
                      type="button"
                      onClick={() => setFormCompanions((prev) => prev.filter((p) => p.id !== c.id))}
                      className="text-blue-400 hover:text-blue-600 ml-0.5"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* 운행지 / 운행 날짜 및 시간 (2열) */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">운행지<span className="text-red-500 ml-0.5">*</span></Label>
                <Input
                  value={formRoute}
                  onChange={(e) => setFormRoute(e.target.value)}
                  placeholder="입력"
                  className="h-[28px] text-xs bg-white border-[#d2d2d7] business-radius-input"
                />
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Label className="modal-label text-[11px] gap-0">운행 날짜 및 시간<span className="text-red-500 ml-0.5">*</span></Label>
                  {isTimeReversed ? (
                    <span className="card-description text-red-500 font-medium">역행</span>
                  ) : calculatedDuration != null && calculatedDuration > 0 ? (
                    <span className="card-description text-blue-600 font-medium">{formatDuration(calculatedDuration)}</span>
                  ) : null}
                </div>
                <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={`w-full h-[28px] px-2.5 text-xs justify-start text-left font-normal bg-white business-radius-input ${isTimeReversed ? "border-red-400" : "border-[#d2d2d7]"}`}
                    >
                      <CalendarIcon className={`mr-1.5 h-3.5 w-3.5 flex-shrink-0 ${isTimeReversed ? "text-red-400" : "text-gray-400"}`} />
                      {startDate ? (
                        endDate && endDate.getTime() !== startDate.getTime() ? (
                          <span className="truncate">{format(startDate, "MM/dd")} {formStartTime} ~ {format(endDate, "MM/dd")} {formEndTime}</span>
                        ) : (
                          <span className="truncate">{format(startDate, "yyyy-MM-dd")} {formStartTime} ~ {formEndTime}</span>
                        )
                      ) : (
                        <span className="text-gray-400">선택</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-auto p-0 border-gray-200 shadow-lg"
                    align="start"
                    side="bottom"
                    sideOffset={8}
                  >
                    <div className="bg-white business-radius-card p-3">
                      <div className="mb-2 px-1">
                        <div className="modal-label text-gray-600 text-center">
                          날짜를 선택하세요 (1회: 당일, 2회: 기간)
                        </div>
                      </div>
                      <Calendar
                        mode="range"
                        selected={formDateRange}
                        onSelect={(range) => setFormDateRange(range)}
                        locale={ko}
                        className="compact-calendar"
                        fromDate={new Date("2020-01-01")}
                        toDate={new Date("2030-12-31")}
                        defaultMonth={new Date()}
                        modifiers={{
                          today: new Date(),
                        }}
                        modifiersClassNames={{
                          today:
                            "bg-blue-500 text-white font-semibold cursor-pointer hover:bg-blue-600 rounded-md",
                        }}
                      />
                      <div className="border-t border-gray-100 mt-2 pt-3 px-1">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="modal-label mb-1 block">시작 시간</Label>
                            <ReactSelect
                              options={TIME_OPTIONS}
                              value={TIME_OPTIONS.find((o) => o.value === formStartTime) || null}
                              onChange={(opt) => setFormStartTime((opt as { value: string } | null)?.value || "09:00")}
                              placeholder="시간"
                              isSearchable={false}
                              menuPlacement="auto"
                              styles={reactSelectStyles}
                            />
                          </div>
                          <div>
                            <Label className="modal-label mb-1 block">종료 시간</Label>
                            <ReactSelect
                              options={TIME_OPTIONS}
                              value={TIME_OPTIONS.find((o) => o.value === formEndTime) || null}
                              onChange={(opt) => setFormEndTime((opt as { value: string } | null)?.value || "18:00")}
                              placeholder="시간"
                              isSearchable={false}
                              menuPlacement="auto"
                              styles={reactSelectStyles}
                            />
                          </div>
                        </div>
                      </div>
                      {isTimeReversed && (
                        <div className="mt-2 px-1">
                          <p className="card-description text-red-500 font-medium">종료 일시가 시작 일시보다 빠릅니다. 시간을 다시 선택해주세요.</p>
                        </div>
                      )}
                      <div className="border-t border-gray-100 mt-3 pt-2 flex justify-end">
                        <Button
                          className="button-base bg-blue-500 hover:bg-blue-600 text-white"
                          onClick={() => setDatePopoverOpen(false)}
                          disabled={!startDate || isTimeReversed}
                        >
                          확인
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* 사용목적 (텍스트 인풋 - 전체폭) */}
            <div>
              <Label className="modal-label mb-1.5 block text-[11px]">사용목적<span className="text-red-500 ml-0.5">*</span></Label>
              <Input
                value={formPurpose}
                onChange={(e) => setFormPurpose(e.target.value)}
                placeholder="거래처 미팅, 현장 출장 등"
                className="h-[28px] text-xs bg-white border-[#d2d2d7] business-radius-input"
              />
            </div>

            {/* 특이사항 (텍스트에어리어 - 전체폭) */}
            <div>
              <Label className="modal-label mb-1.5 block text-[11px]">특이사항 (메모)</Label>
              <Textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="특이사항이 있으면 입력해주세요"
                className="text-xs min-h-[56px] bg-white border-[#d2d2d7] business-radius-input"
              />
            </div>

            {/* 주의사항 */}
            <div className="bg-gray-50 business-radius-card p-2.5 mt-1">
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 text-gray-400 mt-0.5 flex-shrink-0" />
                <pre className="card-description text-gray-500 whitespace-pre-wrap font-sans leading-relaxed">
                  {VEHICLE_NOTICE}
                </pre>
              </div>
            </div>
          </div>

          <div className="px-5 py-3">
            <DialogFooter className="gap-2 sm:gap-2 border-none p-0">
              <Button
                variant="outline"
                onClick={() => setIsModalOpen(false)}
                className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                취소
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={vehicleButtonDisabled}
                className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
              >
                {submitting ? "등록 중..." : "배차요청"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      )}

      {/* 반려 사유 입력 모달 */}
      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="modal-title">
              배차 요청 반려
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

      <AlertDialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
        <AlertDialogContent className="sm:max-w-[360px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="modal-title">신청 완료</AlertDialogTitle>
            <AlertDialogDescription className="text-[12px] text-gray-600">
              차량 배차 신청이 정상적으로 완료되었습니다.
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
