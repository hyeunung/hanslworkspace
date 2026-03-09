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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CreditCard, RefreshCw, Check, X, Upload, Trash2, Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import type { DateRange } from "react-day-picker";

const CARD_APPROVER_ROLES = ["app_admin"];
const CARD_RETURN_ROLES = ["lead buyer", "app_admin"];

const COMPANY_CARDS = [
  { label: "공용1", number: "8967", value: "공용1 8967" },
  { label: "원자재", number: "4963", value: "원자재 4963" },
  { label: "출장용", number: "5914", value: "출장용 5914" },
  { label: "공용2", number: "9976", value: "공용2 9976" },
];

const USAGE_CATEGORIES = [
  { value: "자재구매", label: "자재구매 (현장에서 직접 구매)" },
  { value: "손님접대", label: "손님접대 (식사, 선물 등)" },
  { value: "회식", label: "회식 (팀/부서 회식)" },
  { value: "출장", label: "출장 (교통비, 숙박, 식사 등)" },
  { value: "기타", label: "기타 (직접입력)" },
];

const CARD_NAME_WIDTH = "50px";

interface CardUsage {
  id: number;
  requester_id: string | null;
  business_trip_id?: number | null;
  auto_created_by_trip?: boolean;
  card_number: string;
  usage_category: string;
  usage_date_start: string;
  usage_date_end: string | null;
  description: string | null;
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  card_returned: boolean;
  card_returned_at: string | null;
  card_returned_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  requester?: { name: string; department: string | null } | null;
  business_trip?: { trip_code: string } | null;
  receipts?: CardUsageReceipt[];
}

interface CardUsageReceipt {
  id: number;
  card_usage_id: number;
  receipt_url: string;
  merchant_name: string;
  item_name: string;
  quantity: number;
  unit_price: number | null;
  total_amount: number;
  remark: string | null;
  created_at: string | null;
}

interface Employee {
  id: string;
  name: string | null;
  department: string | null;
  position: string | null;
  email: string | null;
  purchase_role?: string[] | null;
}

interface CardUsageTabProps {
  mode?: "list" | "create";
  onBadgeRefresh?: () => void;
}

const MAX_KRW_AMOUNT = 1_000_000_000;

const formatKrwInput = (value: string, max = MAX_KRW_AMOUNT) => {
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return "";
  const clamped = Math.min(Number(digits), max);
  return clamped.toLocaleString("ko-KR");
};

const parseNumericInput = (value: string) => {
  const n = Number((value || "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

const parseReceiptStorageInfo = (receiptUrl: string) => {
  if (!receiptUrl) {
    return { bucket: "card-receipts", path: "", managedByTrip: false };
  }

  if (receiptUrl.startsWith("business-trip-receipts/")) {
    return {
      bucket: "business-trip-receipts",
      path: receiptUrl.replace("business-trip-receipts/", ""),
      managedByTrip: true,
    };
  }

  if (receiptUrl.startsWith("card-receipts/")) {
    return {
      bucket: "card-receipts",
      path: receiptUrl.replace("card-receipts/", ""),
      managedByTrip: false,
    };
  }

  if (receiptUrl.includes("card-receipts/")) {
    return {
      bucket: "card-receipts",
      path: receiptUrl.split("card-receipts/").pop() || "",
      managedByTrip: false,
    };
  }

  return { bucket: "card-receipts", path: receiptUrl, managedByTrip: false };
};

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
    maxHeight: "200px",
    overflowY: "auto" as const,
  }),
  menuPortal: (base: Record<string, unknown>) => ({
    ...base,
    zIndex: 99999,
    pointerEvents: "auto" as const,
  }),
};

export default function CardUsageTab({ mode = "list", onBadgeRefresh }: CardUsageTabProps) {
  const supabase = createClient();
  const isCreateMode = mode === "create";

  const [usages, setUsages] = useState<CardUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);

  // New request form
  const [formCard, setFormCard] = useState<typeof COMPANY_CARDS[0] | null>(null);
  const [formCategory, setFormCategory] = useState<string>("");
  const [formCategoryCustom, setFormCategoryCustom] = useState("");
  const [formDateRange, setFormDateRange] = useState<DateRange | undefined>(undefined);
  const [formDescription, setFormDescription] = useState("");
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);

  // Reject dialog
  const [rejectTargetId, setRejectTargetId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Receipt modal
  const [receiptModalUsage, setReceiptModalUsage] = useState<CardUsage | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptMerchant, setReceiptMerchant] = useState("");
  const [receiptItemName, setReceiptItemName] = useState("");
  const [receiptQuantity, setReceiptQuantity] = useState("1");
  const [receiptUnitPrice, setReceiptUnitPrice] = useState("");
  const [receiptTotalAmount, setReceiptTotalAmount] = useState("");
  const [receiptRemark, setReceiptRemark] = useState("");
  const [receiptUploading, setReceiptUploading] = useState(false);

  // Detail modal
  const [detailUsage, setDetailUsage] = useState<CardUsage | null>(null);
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null);

  const canApprove = useMemo(() => {
    if (!currentUser?.purchase_role) return false;
    const roles = Array.isArray(currentUser.purchase_role)
      ? currentUser.purchase_role
      : (currentUser.purchase_role as unknown as string).split(",").map((r: string) => r.trim());
    return roles.some((r: string) => CARD_APPROVER_ROLES.includes(r));
  }, [currentUser?.purchase_role]);

  const canReturnCard = useMemo(() => {
    if (!currentUser?.purchase_role) return false;
    const roles = Array.isArray(currentUser.purchase_role)
      ? currentUser.purchase_role
      : (currentUser.purchase_role as unknown as string).split(",").map((r: string) => r.trim());
    return roles.some((r: string) => CARD_RETURN_ROLES.includes(r));
  }, [currentUser?.purchase_role]);

  const isAppAdmin = useMemo(() => {
    if (!currentUser?.purchase_role) return false;
    const roles = Array.isArray(currentUser.purchase_role)
      ? currentUser.purchase_role
      : (currentUser.purchase_role as unknown as string).split(",").map((r: string) => r.trim());
    return roles.includes("app_admin");
  }, [currentUser?.purchase_role]);

  const unavailableCards = useMemo(() => {
    const inUse = new Set<string>();
    for (const u of usages) {
      if (["approved", "settled"].includes(u.approval_status) && !u.card_returned) {
        inUse.add(u.card_number);
      }
    }
    return inUse;
  }, [usages]);

  const loadUsages = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("card_usages")
        .select("*, requester:employees!card_usages_requester_id_fkey(name, department), business_trip:business_trips!card_usages_business_trip_id_fkey(trip_code)")
        .order("created_at", { ascending: false });
      if (error) throw error;

      if (data) {
        const usageIds = data.map((u: CardUsage) => u.id);
        const receiptsMap: Record<number, CardUsageReceipt[]> = {};
        if (usageIds.length > 0) {
          const { data: receipts } = await supabase
            .from("card_usage_receipts")
            .select("*")
            .in("card_usage_id", usageIds);
          if (receipts) {
            for (const r of receipts) {
              if (!receiptsMap[r.card_usage_id]) receiptsMap[r.card_usage_id] = [];
              receiptsMap[r.card_usage_id].push(r);
            }
          }
        }

        setUsages(
          data.map((u: CardUsage) => ({
            ...u,
            receipts: receiptsMap[u.id] || [],
          }))
        );
      }
    } catch (err) {
      logger.error("카드사용 목록 로딩 실패", err);
      toast.error("카드사용 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const handleDeleteUsage = useCallback(async (id: number) => {
    if (!confirm("이 카드사용 요청을 삭제하시겠습니까?")) return;
    try {
      const { error } = await supabase.from("card_usages").delete().eq("id", id);
      if (error) throw error;
      toast.success("삭제되었습니다.");
      loadUsages();
      onBadgeRefresh?.();
    } catch {
      toast.error("삭제에 실패했습니다.");
    }
  }, [supabase, loadUsages]);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        const { data } = await supabase
          .from("employees")
          .select("id, name, department, position, email, purchase_role")
          .eq("email", user.email)
          .single();
        if (data) setCurrentUser(data as Employee);
      }
      loadUsages();
    };
    init();
  }, [supabase, loadUsages]);

  // Scroll fix for ReactSelect in dialogs
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

  const sortedUsages = useMemo(() => {
    return [...usages].sort((a, b) => {
      const statusOrder: Record<string, number> = { pending: 0, approved: 1, settled: 2, returned: 3, rejected: 4 };
      const oa = statusOrder[a.approval_status] ?? 5;
      const ob = statusOrder[b.approval_status] ?? 5;
      if (oa !== ob) return oa - ob;
      return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
    });
  }, [usages]);

  const resetForm = useCallback(() => {
    setFormCard(null);
    setFormCategory("");
    setFormCategoryCustom("");
    setFormDateRange(undefined);
    setFormDescription("");
  }, []);

  useEffect(() => {
    if (isCreateMode) {
      resetForm();
    }
  }, [isCreateMode, resetForm]);

  const handleSubmit = useCallback(async () => {
    const startDate = formDateRange?.from;
    if (!formCard || !formCategory || !startDate || !formDescription.trim()) {
      toast.error("필수 항목을 모두 입력해주세요.");
      return;
    }
    const category = formCategory === "기타" ? formCategoryCustom.trim() : formCategory;
    if (!category) {
      toast.error("사용용도를 입력해주세요.");
      return;
    }
    const endDate = formDateRange?.to;
    try {
      setSubmitting(true);
      const { error } = await supabase.from("card_usages").insert({
        requester_id: currentUser?.id || null,
        card_number: formCard.value,
        usage_category: category,
        usage_date_start: format(startDate, "yyyy-MM-dd"),
        usage_date_end: endDate ? format(endDate, "yyyy-MM-dd") : null,
        description: formDescription.trim() || null,
      });
      if (error) throw error;
      if (isCreateMode) {
        resetForm();
      } else {
        setIsModalOpen(false);
      }
      loadUsages();
      onBadgeRefresh?.();
      setSuccessDialogOpen(true);
    } catch (err) {
      logger.error("카드사용 요청 실패", err);
      toast.error("요청 등록에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }, [formCard, formCategory, formCategoryCustom, formDateRange, formDescription, currentUser, supabase, loadUsages, isCreateMode, resetForm]);

  const handleApprove = useCallback(async (id: number) => {
    try {
      const { error } = await supabase
        .from("card_usages")
        .update({
          approval_status: "approved",
          approved_by: currentUser?.id || null,
          approved_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
      toast.success("승인 처리되었습니다.");
      loadUsages();
      onBadgeRefresh?.();
    } catch {
      toast.error("승인 처리에 실패했습니다.");
    }
  }, [supabase, currentUser, loadUsages, onBadgeRefresh]);

  const openRejectDialog = useCallback((id: number) => {
    setRejectTargetId(id);
    setRejectReason("");
  }, []);

  const handleReject = useCallback(async () => {
    if (!rejectTargetId || !rejectReason.trim()) return;
    try {
      const { error } = await supabase
        .from("card_usages")
        .update({
          approval_status: "rejected",
          approved_by: currentUser?.id || null,
          approved_at: new Date().toISOString(),
          rejection_reason: rejectReason.trim(),
        })
        .eq("id", rejectTargetId);
      if (error) throw error;
      toast.success("반려 처리되었습니다.");
      setRejectTargetId(null);
      loadUsages();
      onBadgeRefresh?.();
    } catch {
      toast.error("반려 처리에 실패했습니다.");
    }
  }, [supabase, currentUser, rejectTargetId, rejectReason, loadUsages, onBadgeRefresh]);

  const handleCardReturn = useCallback(async (id: number) => {
    try {
      const { error } = await supabase
        .from("card_usages")
        .update({
          approval_status: "returned",
          card_returned: true,
          card_returned_at: new Date().toISOString(),
          card_returned_by: currentUser?.id || null,
        })
        .eq("id", id);
      if (error) throw error;
      toast.success("카드 반납 처리되었습니다.");
      loadUsages();
      onBadgeRefresh?.();
    } catch {
      toast.error("카드 반납 처리에 실패했습니다.");
    }
  }, [supabase, currentUser, loadUsages]);

  const openReceiptModal = useCallback((usage: CardUsage) => {
    setReceiptModalUsage(usage);
    setReceiptFile(null);
    setReceiptMerchant("");
    setReceiptItemName("");
    setReceiptQuantity("1");
    setReceiptUnitPrice("");
    setReceiptTotalAmount("");
    setReceiptRemark("");
  }, []);

  const handleReceiptUpload = useCallback(async () => {
    if (!receiptModalUsage || !receiptFile) return;
    if (!receiptMerchant.trim() || !receiptItemName.trim() || !receiptTotalAmount.trim()) {
      toast.error("사용처, 상세내역/품명, 합계는 필수입니다.");
      return;
    }
    try {
      setReceiptUploading(true);
      const ext = receiptFile.name.split(".").pop() || "jpg";
      const storagePath = `card-usage/${receiptModalUsage.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("card-receipts")
        .upload(storagePath, receiptFile, {
          contentType: receiptFile.type,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("card_usage_receipts").insert({
        card_usage_id: receiptModalUsage.id,
        receipt_url: storagePath,
        merchant_name: receiptMerchant.trim(),
        item_name: receiptItemName.trim(),
        quantity: parseNumericInput(receiptQuantity) || 1,
        unit_price: receiptUnitPrice.trim() ? Math.min(parseNumericInput(receiptUnitPrice), MAX_KRW_AMOUNT) : null,
        total_amount: Math.min(parseNumericInput(receiptTotalAmount) || 0, MAX_KRW_AMOUNT),
        remark: receiptRemark.trim() || null,
      });
      if (insertError) throw insertError;

      if (receiptModalUsage.approval_status === "approved") {
        await supabase
          .from("card_usages")
          .update({ approval_status: "settled" })
          .eq("id", receiptModalUsage.id);
      }

      toast.success("영수증이 등록되었습니다.");
      setReceiptModalUsage(null);
      loadUsages();
    } catch (err) {
      logger.error("영수증 업로드 실패", err);
      toast.error("영수증 등록에 실패했습니다.");
    } finally {
      setReceiptUploading(false);
    }
  }, [receiptModalUsage, receiptFile, receiptMerchant, receiptItemName, receiptQuantity, receiptUnitPrice, receiptTotalAmount, receiptRemark, supabase, loadUsages]);

  const handleDeleteReceipt = useCallback(async (receiptId: number, receiptUrl: string) => {
    try {
      const storageInfo = parseReceiptStorageInfo(receiptUrl);
      if (storageInfo.path && !storageInfo.managedByTrip) {
        await supabase.storage.from(storageInfo.bucket).remove([storageInfo.path]);
      }
      await supabase.from("card_usage_receipts").delete().eq("id", receiptId);
      toast.success("영수증이 삭제되었습니다.");
      loadUsages();
      if (detailUsage) {
        const updated = usages.find(u => u.id === detailUsage.id);
        if (updated) setDetailUsage({ ...updated, receipts: (updated.receipts || []).filter(r => r.id !== receiptId) });
      }
    } catch {
      toast.error("영수증 삭제에 실패했습니다.");
    }
  }, [supabase, loadUsages, detailUsage, usages]);

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: "badge-stats bg-orange-500 text-white",
      approved: "badge-stats bg-blue-500 text-white",
      settled: "badge-stats bg-green-500 text-white",
      returned: "badge-stats bg-gray-500 text-white",
      rejected: "badge-stats bg-red-500 text-white",
    };
    const labels: Record<string, string> = {
      pending: "승인대기",
      approved: "승인완료",
      settled: "반납완료",
      returned: "카드반납",
      rejected: "반려",
    };
    return (
      <span className={styles[status] || "badge-stats bg-gray-300 text-gray-700"}>
        {labels[status] || status}
      </span>
    );
  };

  const cardStatusMap = useMemo(() => {
    const map: Record<string, { inUse: boolean; user: string; category: string }> = {};
    for (const card of COMPANY_CARDS) {
      const activeUsage = usages.find(
        u => u.card_number === card.value
          && ["approved", "settled"].includes(u.approval_status)
          && !u.card_returned
      );
      if (activeUsage) {
        map[card.value] = {
          inUse: true,
          user: activeUsage.requester?.name || "-",
          category: activeUsage.usage_category,
        };
      } else {
        map[card.value] = { inUse: false, user: "", category: "" };
      }
    }
    return map;
  }, [usages]);

  return (
    <div className="w-full space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        {!isCreateMode && (
        <div>
          <h1 className="page-title">카드사용 관리</h1>
          <p className="page-subtitle" style={{ marginTop: "-2px", marginBottom: "-4px" }}>
            Card Usage Management
          </p>
        </div>
        )}
        {!isCreateMode && (
          <div className="flex items-center gap-2">
            <Button
              onClick={() => loadUsages()}
              variant="outline"
              className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              새로고침
            </Button>
          </div>
        )}
      </div>

      {isCreateMode && (
        <div className="doc-form">
          <div className="doc-form-header">
            <h1>법인카드 사용신청서</h1>
            <div className="doc-subtitle">Corporate Card Usage Request</div>
          </div>

          <div className="doc-form-body">
            <div className="doc-form-row">
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">법인카드 <span className="required">*</span></div>
                <div className="doc-select-container">
                  <ReactSelect
                    options={COMPANY_CARDS.map((c) => ({
                      ...c,
                      isDisabled: unavailableCards.has(c.value),
                    }))}
                    value={formCard}
                    onChange={(v) => setFormCard(v as typeof COMPANY_CARDS[0])}
                    formatOptionLabel={(option) => {
                      const card = COMPANY_CARDS.find((c) => c.value === option.value);
                      if (!card) return option.label;
                      const disabled = unavailableCards.has(card.value);
                      return (
                        <div className="flex items-center text-[11px]" style={{ pointerEvents: "none" }}>
                          <span className={`font-medium ${disabled ? "text-gray-400" : "text-gray-900"}`} style={{ width: CARD_NAME_WIDTH, flexShrink: 0 }}>
                            {card.label}
                          </span>
                          <span className="text-gray-300 mx-1.5">|</span>
                          <span className={disabled ? "text-gray-400" : "text-gray-500"}>{card.number}</span>
                          {disabled && <span className="ml-1 text-[9px] text-red-400">(사용중)</span>}
                        </div>
                      );
                    }}
                    placeholder="선택"
                    isSearchable={false}
                    styles={reactSelectStyles}
                    menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                    menuShouldBlockScroll={false}
                  />
                </div>
              </div>
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">사용용도 <span className="required">*</span></div>
                <div className="doc-select-container">
                  <ReactSelect
                    options={USAGE_CATEGORIES}
                    value={USAGE_CATEGORIES.find((c) => c.value === formCategory) || null}
                    onChange={(v) => {
                      setFormCategory(v?.value || "");
                      if (v?.value !== "기타") setFormCategoryCustom("");
                    }}
                    placeholder="선택"
                    isSearchable={false}
                    styles={reactSelectStyles}
                    menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                    menuShouldBlockScroll={false}
                  />
                </div>
              </div>
            </div>

            {formCategory === "기타" && (
              <div className="doc-form-row">
                <div className="doc-form-cell">
                  <div className="doc-form-cell-label">용도 직접입력 <span className="required">*</span></div>
                  <Input
                    value={formCategoryCustom}
                    onChange={(e) => setFormCategoryCustom(e.target.value)}
                    placeholder="사용용도를 입력하세요"
                    className="doc-form-input"
                  />
                </div>
              </div>
            )}

            <div className="doc-form-row">
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">사용예정일 <span className="required">*</span></div>
                <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" className="doc-date-trigger">
                      <CalendarIcon className="mr-1.5 h-3.5 w-3.5 text-gray-400" />
                      {formDateRange?.from ? (
                        formDateRange.to && formDateRange.to.getTime() !== formDateRange.from.getTime() ? (
                          <span>{format(formDateRange.from, "yyyy-MM-dd")} ~ {format(formDateRange.to, "yyyy-MM-dd")}</span>
                        ) : (
                          <span>{format(formDateRange.from, "yyyy-MM-dd")}</span>
                        )
                      ) : (
                        <span className="text-gray-300">날짜를 선택하세요</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 border-gray-200 shadow-lg" align="start" side="bottom" sideOffset={8}>
                    <div className="bg-white business-radius-card p-3">
                      <div className="mb-2 px-1">
                        <div className="modal-label text-gray-600 text-center">1회 클릭: 당일 / 2회 클릭: 기간 선택</div>
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
                          today: "bg-blue-500 text-white font-semibold cursor-pointer hover:bg-blue-600 rounded-md",
                        }}
                      />
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="doc-form-row" style={{ borderBottom: "none" }}>
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">비고(프로젝트/내용) <span className="required">*</span></div>
                <Textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="프로젝트명 또는 사용 내용을 입력하세요"
                  className="doc-form-textarea"
                />
              </div>
            </div>
          </div>

          <div className="doc-form-footer">
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !formCard || !formCategory || !formDateRange?.from || !formDescription.trim() || (formCategory === "기타" && !formCategoryCustom.trim())}
              className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
            >
              {submitting ? "요청 중..." : "카드사용 요청"}
            </Button>
          </div>
        </div>
      )}

      {!isCreateMode && (
      <>
      {/* Card Status Panel */}
      <div className="grid grid-cols-4 gap-2">
        {COMPANY_CARDS.map((card) => {
          const status = cardStatusMap[card.value];
          return (
            <div
              key={card.value}
              className={`p-2.5 rounded-lg border ${
                status?.inUse
                  ? "border-blue-200 bg-blue-50/60"
                  : "border-gray-200 bg-white"
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] font-semibold text-gray-900">
                  {card.label}
                  <span className="ml-1 text-[9px] font-normal text-gray-400">{card.number}</span>
                </span>
                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${
                  status?.inUse
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 text-gray-500"
                }`}>
                  {status?.inUse ? "사용중" : "보관중"}
                </span>
              </div>
              {status?.inUse ? (
                <p className="text-[10px] text-blue-600">{status.user} · {status.category}</p>
              ) : (
                <p className="text-[10px] text-gray-400">사용 가능</p>
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
          ) : sortedUsages.length === 0 ? (
            <div className="text-center py-12">
              <CreditCard className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">카드사용 요청이 없습니다</h3>
              <p className="card-subtitle">새로운 카드사용 요청을 등록해보세요.</p>
            </div>
          ) : (
            <div className="overflow-x-auto overflow-y-auto max-h-[70vh] border rounded-lg">
              <table className="w-full min-w-[980px] border-collapse">
                <thead
                  className="sticky top-0 z-30 bg-gray-50"
                  style={{ boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)" }}
                >
                  <tr>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center w-[72px]">상태</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[58px]">신청일</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[102px]">출장코드</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[90px]">카드</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[76px]">요청자</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[90px]">사용용도</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left w-[100px]">사용예정일</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center w-[60px]">영수증</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-right w-[90px]">합계금액</th>
                    <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-left">비고(프로젝트/내용)</th>
                    {isAppAdmin && (
                      <th className="px-3 py-1.5 modal-label text-gray-900 whitespace-nowrap text-center w-[40px]"></th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sortedUsages.map((u) => {
                    const receiptCount = u.receipts?.length || 0;
                    const totalAmount = (u.receipts || []).reduce((sum, r) => sum + (r.total_amount || 0), 0);
                    const isOwner = currentUser?.id === u.requester_id;
                    const canUploadReceipt = isOwner && ["approved", "settled"].includes(u.approval_status) && !u.card_returned;
                    const canReturn = canReturnCard && u.approval_status === "settled" && !u.card_returned;

                    return (
                      <tr
                        key={u.id}
                        className="border-b hover:bg-gray-100 cursor-pointer"
                        onClick={() => setDetailUsage(u)}
                      >
                        <td className="px-3 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                          {u.approval_status === "pending" && canApprove ? (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="badge-stats bg-orange-500 text-white cursor-pointer hover:bg-orange-600">
                                  승인대기
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-2 flex gap-1.5" side="right" align="start">
                                <Button
                                  className="button-base bg-green-500 hover:bg-green-600 text-white"
                                  onClick={() => handleApprove(u.id)}
                                >
                                  <Check className="w-3.5 h-3.5 mr-1" />승인
                                </Button>
                                <Button
                                  className="button-base bg-red-500 hover:bg-red-600 text-white"
                                  onClick={() => openRejectDialog(u.id)}
                                >
                                  <X className="w-3.5 h-3.5 mr-1" />반려
                                </Button>
                              </PopoverContent>
                            </Popover>
                          ) : u.approval_status === "settled" && canReturn ? (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="badge-stats bg-green-500 text-white cursor-pointer hover:bg-green-600">
                                  반납완료
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-2" side="right" align="start">
                                <Button
                                  className="button-base bg-gray-600 hover:bg-gray-700 text-white"
                                  onClick={() => handleCardReturn(u.id)}
                                >
                                  카드반납 처리
                                </Button>
                              </PopoverContent>
                            </Popover>
                          ) : (
                            getStatusBadge(u.approval_status)
                          )}
                        </td>
                        <td className="px-3 py-1.5 card-date whitespace-nowrap">
                          {u.created_at ? format(new Date(u.created_at), "MM/dd") : "-"}
                        </td>
                        <td className="px-3 py-1.5 card-title whitespace-nowrap">
                          {u.business_trip?.trip_code || "-"}
                        </td>
                        <td className="px-3 py-1.5 card-title whitespace-nowrap">
                          {u.card_number?.split(" ")[0] || "-"}
                        </td>
                        <td className="px-3 py-1.5 card-title whitespace-nowrap">
                          {u.requester?.name || "-"}
                        </td>
                        <td className="px-3 py-1.5 card-title whitespace-nowrap">
                          {u.usage_category}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <div className="text-[11px] font-medium text-gray-900">
                            {u.usage_date_start ? (
                              u.usage_date_end && u.usage_date_end !== u.usage_date_start
                                ? `${format(new Date(u.usage_date_start), "MM/dd")} ~ ${format(new Date(u.usage_date_end), "MM/dd")}`
                                : format(new Date(u.usage_date_start), "MM/dd")
                            ) : "-"}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                          {canUploadReceipt ? (
                            <button
                              className="badge-stats bg-blue-100 text-blue-700 cursor-pointer hover:bg-blue-200"
                              onClick={() => openReceiptModal(u)}
                            >
                              <Upload className="w-3 h-3 inline mr-0.5" />{receiptCount}
                            </button>
                          ) : (
                            <span className="badge-stats bg-gray-100 text-gray-600">
                              {receiptCount}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 card-title whitespace-nowrap text-right">
                          {totalAmount > 0 ? `₩${totalAmount.toLocaleString()}` : "-"}
                        </td>
                        <td className="px-3 py-1.5 card-title truncate max-w-[150px]">
                          {u.description || "-"}
                        </td>
                        {isAppAdmin && (
                          <td className="px-3 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              className="text-gray-300 hover:text-red-500 transition-colors"
                              onClick={() => handleDeleteUsage(u.id)}
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

      {/* New Request Modal */}
      {!isCreateMode && (
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[520px] p-0">
          <DialogHeader className="px-5 pt-4 pb-3 border-b border-gray-100" style={{ gap: 0 }}>
            <DialogTitle className="text-[14px] font-bold leading-tight">카드사용 요청</DialogTitle>
            <p className="page-subtitle leading-tight" style={{ marginTop: "-1px" }}>Card Usage Request</p>
          </DialogHeader>

          <div className="px-5 py-4 space-y-4">
            {/* 카드 선택 + 사용용도 */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">
                  법인카드<span className="text-red-500 ml-0.5">*</span>
                </Label>
                <ReactSelect
                  options={COMPANY_CARDS.map(c => ({
                    ...c,
                    isDisabled: unavailableCards.has(c.value),
                  }))}
                  value={formCard}
                  onChange={(v) => setFormCard(v as typeof COMPANY_CARDS[0])}
                  formatOptionLabel={(option) => {
                    const card = COMPANY_CARDS.find(c => c.value === option.value);
                    if (!card) return option.label;
                    const disabled = unavailableCards.has(card.value);
                    return (
                      <div className="flex items-center text-xs" style={{ pointerEvents: "none" }}>
                        <span className={`font-medium ${disabled ? "text-gray-400" : "text-gray-900"}`} style={{ width: CARD_NAME_WIDTH, flexShrink: 0 }}>
                          {card.label}
                        </span>
                        <span className="text-gray-300 mx-1.5">|</span>
                        <span className={disabled ? "text-gray-400" : "text-gray-500"}>{card.number}</span>
                        {disabled && <span className="ml-1 text-[9px] text-red-400">(사용중)</span>}
                      </div>
                    );
                  }}
                  placeholder="선택"
                  isSearchable={false}
                  styles={reactSelectStyles}
                  menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                  menuShouldBlockScroll={false}
                />
              </div>
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">
                  사용용도<span className="text-red-500 ml-0.5">*</span>
                </Label>
                <ReactSelect
                  options={USAGE_CATEGORIES}
                  value={USAGE_CATEGORIES.find(c => c.value === formCategory) || null}
                  onChange={(v) => {
                    setFormCategory(v?.value || "");
                    if (v?.value !== "기타") setFormCategoryCustom("");
                  }}
                  placeholder="선택"
                  isSearchable={false}
                  styles={reactSelectStyles}
                  menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                  menuShouldBlockScroll={false}
                />
              </div>
            </div>

            {formCategory === "기타" && (
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">
                  용도 직접입력<span className="text-red-500 ml-0.5">*</span>
                </Label>
                <Input
                  value={formCategoryCustom}
                  onChange={(e) => setFormCategoryCustom(e.target.value)}
                  placeholder="사용용도를 입력하세요"
                  className="h-[28px] text-xs business-radius-input"
                />
              </div>
            )}

            {/* 사용예정일 */}
            <div>
              <Label className="modal-label mb-1.5 block text-[11px]">
                사용예정일<span className="text-red-500 ml-0.5">*</span>
              </Label>
              <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full h-[28px] px-2.5 text-xs justify-start text-left font-normal bg-white business-radius-input border-[#d2d2d7]"
                  >
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5 text-gray-400" />
                    {formDateRange?.from ? (
                      formDateRange.to && formDateRange.to.getTime() !== formDateRange.from.getTime() ? (
                        <span>{format(formDateRange.from, "yyyy-MM-dd")} ~ {format(formDateRange.to, "yyyy-MM-dd")}</span>
                      ) : (
                        <span>{format(formDateRange.from, "yyyy-MM-dd")}</span>
                      )
                    ) : (
                      <span className="text-gray-400">날짜를 선택하세요</span>
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
                      1회 클릭: 당일 / 2회 클릭: 기간 선택
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
                      today: "bg-blue-500 text-white font-semibold cursor-pointer hover:bg-blue-600 rounded-md",
                    }}
                  />
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* 비고(프로젝트/내용) */}
            <div>
              <Label className="modal-label mb-1.5 block text-[11px]">비고(프로젝트/내용)<span className="text-red-500 ml-0.5">*</span></Label>
              <Textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="프로젝트명 또는 사용 내용을 입력하세요"
                className="text-xs business-radius-input min-h-[60px]"
              />
            </div>
          </div>

          <DialogFooter className="px-5 py-3 border-t border-gray-100">
            <Button
              variant="outline"
              className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              onClick={() => setIsModalOpen(false)}
            >
              취소
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !formCard || !formCategory || !formDateRange?.from || !formDescription.trim() || (formCategory === "기타" && !formCategoryCustom.trim())}
              className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
            >
              {submitting ? "요청 중..." : "카드사용 요청"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}

      {/* Receipt Upload Modal */}
      <Dialog open={!!receiptModalUsage} onOpenChange={(open) => !open && setReceiptModalUsage(null)}>
        <DialogContent className="sm:max-w-[480px] p-0">
          <DialogHeader className="px-5 pt-4 pb-3 border-b border-gray-100" style={{ gap: 0 }}>
            <DialogTitle className="text-[14px] font-bold leading-tight">영수증 등록</DialogTitle>
            <p className="page-subtitle leading-tight" style={{ marginTop: "-1px" }}>Receipt Upload</p>
          </DialogHeader>

          <div className="px-5 py-4 space-y-3">
            <div>
              <Label className="modal-label mb-1.5 block text-[11px]">
                영수증 이미지<span className="text-red-500 ml-0.5">*</span>
              </Label>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center px-3 h-[28px] text-xs font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md cursor-pointer hover:bg-gray-200 transition-colors whitespace-nowrap">
                  <Upload className="w-3 h-3 mr-1.5" />
                  파일 선택
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
                <span className="text-xs text-gray-500 truncate">
                  {receiptFile ? receiptFile.name : "선택된 파일 없음"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">
                  사용처<span className="text-red-500 ml-0.5">*</span>
                </Label>
                <Input
                  value={receiptMerchant}
                  onChange={(e) => setReceiptMerchant(e.target.value)}
                  placeholder="입력"
                  className="h-[28px] text-xs business-radius-input"
                />
              </div>
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">
                  상세내역/품명<span className="text-red-500 ml-0.5">*</span>
                </Label>
                <Input
                  value={receiptItemName}
                  onChange={(e) => setReceiptItemName(e.target.value)}
                  placeholder="입력"
                  className="h-[28px] text-xs business-radius-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">수량</Label>
                <Input
                  type="text"
                  value={receiptQuantity}
                  onChange={(e) => {
                    const qty = e.target.value.replace(/[^0-9]/g, "");
                    setReceiptQuantity(qty);
                    if (receiptUnitPrice.trim()) {
                      const calc = (parseNumericInput(qty) || 0) * (parseNumericInput(receiptUnitPrice) || 0);
                      const clamped = Math.min(calc, MAX_KRW_AMOUNT);
                      setReceiptTotalAmount(clamped > 0 ? clamped.toLocaleString("ko-KR") : "");
                    }
                  }}
                  placeholder="1"
                  className="h-[28px] text-xs business-radius-input"
                />
              </div>
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">단가</Label>
                <div className="flex items-center gap-1">
                  <Input
                    type="text"
                    value={receiptUnitPrice}
                    onChange={(e) => {
                      const price = formatKrwInput(e.target.value);
                      setReceiptUnitPrice(price);
                      if (price.trim()) {
                        const calc = (parseNumericInput(receiptQuantity) || 1) * (parseNumericInput(price) || 0);
                        const clamped = Math.min(calc, MAX_KRW_AMOUNT);
                        setReceiptTotalAmount(clamped > 0 ? clamped.toLocaleString("ko-KR") : "");
                      }
                    }}
                    placeholder="최대 1,000,000,000"
                    className="h-[28px] text-xs business-radius-input text-right w-[140px]"
                  />
                  <span className="text-[11px] text-gray-500 whitespace-nowrap">원</span>
                </div>
              </div>
              <div>
                <Label className="modal-label mb-1.5 block text-[11px]">
                  합계<span className="text-red-500 ml-0.5">*</span>
                </Label>
                <div className="flex items-center gap-1">
                  <Input
                    type="text"
                    value={receiptTotalAmount}
                    onChange={(e) => {
                      setReceiptTotalAmount(formatKrwInput(e.target.value));
                      setReceiptUnitPrice("");
                    }}
                    placeholder="최대 1,000,000,000"
                    className="h-[28px] text-xs business-radius-input text-right w-[140px]"
                  />
                  <span className="text-[11px] text-gray-500 whitespace-nowrap">원</span>
                </div>
              </div>
            </div>

            <div>
              <Label className="modal-label mb-1.5 block text-[11px]">비고</Label>
              <Input
                value={receiptRemark}
                onChange={(e) => setReceiptRemark(e.target.value)}
                placeholder="입력"
                className="h-[28px] text-xs business-radius-input"
              />
            </div>
          </div>

          <DialogFooter className="px-5 py-3 border-t border-gray-100">
            <Button
              variant="outline"
              className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              onClick={() => setReceiptModalUsage(null)}
            >
              취소
            </Button>
            <Button
              onClick={handleReceiptUpload}
              disabled={receiptUploading || !receiptFile || !receiptMerchant.trim() || !receiptItemName.trim() || !receiptTotalAmount.trim()}
              className="button-base bg-blue-500 hover:bg-blue-600 text-white"
            >
              <Upload className="w-3.5 h-3.5 mr-1" />
              {receiptUploading ? "업로드 중..." : "영수증 등록"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Modal */}
      <Dialog open={!!detailUsage} onOpenChange={(open) => !open && setDetailUsage(null)}>
        <DialogContent className="sm:max-w-[600px] p-0 max-h-[85vh] overflow-y-auto">
          <DialogHeader className="px-5 pt-4 pb-3 border-b border-gray-100" style={{ gap: 0 }}>
            <DialogTitle className="text-[14px] font-bold leading-tight">카드사용 상세</DialogTitle>
            <p className="page-subtitle leading-tight" style={{ marginTop: "-1px" }}>Card Usage Detail</p>
          </DialogHeader>

          {detailUsage && (
            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <span className="modal-label block">상태</span>
                  <div className="mt-0.5">{getStatusBadge(detailUsage.approval_status)}</div>
                </div>
                <div>
                  <span className="modal-label block">신청일</span>
                  <span className="modal-value">{detailUsage.created_at ? format(new Date(detailUsage.created_at), "yyyy-MM-dd") : "-"}</span>
                </div>
                <div>
                  <span className="modal-label block">법인카드</span>
                  <span className="modal-value">{detailUsage.card_number}</span>
                </div>
                <div>
                  <span className="modal-label block">출장코드</span>
                  <span className="modal-value">{detailUsage.business_trip?.trip_code || "-"}</span>
                </div>
                <div>
                  <span className="modal-label block">요청자</span>
                  <span className="modal-value">{detailUsage.requester?.name || "-"}</span>
                </div>
                <div>
                  <span className="modal-label block">사용용도</span>
                  <span className="modal-value">{detailUsage.usage_category}</span>
                </div>
                <div>
                  <span className="modal-label block">사용예정일</span>
                  <span className="modal-value">
                    {detailUsage.usage_date_start ? (
                      detailUsage.usage_date_end && detailUsage.usage_date_end !== detailUsage.usage_date_start
                        ? `${detailUsage.usage_date_start} ~ ${detailUsage.usage_date_end}`
                        : detailUsage.usage_date_start
                    ) : "-"}
                  </span>
                </div>
                {detailUsage.description && (
                  <div className="col-span-2">
                    <span className="modal-label block">비고(프로젝트/내용)</span>
                    <span className="modal-value">{detailUsage.description}</span>
                  </div>
                )}
                {detailUsage.rejection_reason && (
                  <div className="col-span-2">
                    <span className="modal-label block text-red-500">반려사유</span>
                    <span className="modal-value text-red-600">{detailUsage.rejection_reason}</span>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="modal-section-title">영수증 내역</span>
                  {currentUser?.id === detailUsage.requester_id
                    && ["approved", "settled"].includes(detailUsage.approval_status)
                    && !detailUsage.card_returned && (
                    <Button
                      className="button-base bg-blue-500 hover:bg-blue-600 text-white"
                      onClick={() => {
                        setDetailUsage(null);
                        openReceiptModal(detailUsage);
                      }}
                    >
                      <Upload className="w-3.5 h-3.5 mr-1" />영수증 추가
                    </Button>
                  )}
                </div>
                {(detailUsage.receipts || []).length === 0 ? (
                  <p className="card-subtitle text-center py-4">등록된 영수증이 없습니다.</p>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full border-collapse">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-2 py-1 modal-label text-gray-900 text-left">사용처</th>
                          <th className="px-2 py-1 modal-label text-gray-900 text-left">품명</th>
                          <th className="px-2 py-1 modal-label text-gray-900 text-right">수량</th>
                          <th className="px-2 py-1 modal-label text-gray-900 text-right">단가</th>
                          <th className="px-2 py-1 modal-label text-gray-900 text-right">합계</th>
                          <th className="px-2 py-1 modal-label text-gray-900 text-left">비고</th>
                          <th className="px-2 py-1 modal-label text-gray-900 text-center w-[50px]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detailUsage.receipts || []).map((r) => (
                          <tr
                            key={r.id}
                            className="border-t border-gray-100 hover:bg-blue-50 cursor-pointer"
                            onClick={async () => {
                              if (!r.receipt_url) return;
                              const storageInfo = parseReceiptStorageInfo(r.receipt_url);
                              if (!storageInfo.path) return;
                              const { data } = await supabase.storage
                                .from(storageInfo.bucket)
                                .createSignedUrl(storageInfo.path, 3600);
                              if (data?.signedUrl) {
                                setReceiptImageUrl(data.signedUrl);
                              } else {
                                toast.error("영수증 이미지를 불러올 수 없습니다.");
                              }
                            }}
                          >
                            <td className="px-2 py-1 card-title">{r.merchant_name}</td>
                            <td className="px-2 py-1 card-title">{r.item_name}</td>
                            <td className="px-2 py-1 card-title text-right">{r.quantity}</td>
                            <td className="px-2 py-1 card-title text-right">
                              {r.unit_price != null ? `₩${r.unit_price.toLocaleString()}` : "-"}
                            </td>
                            <td className="px-2 py-1 card-title text-right font-semibold">
                              ₩{r.total_amount.toLocaleString()}
                            </td>
                            <td className="px-2 py-1 card-title">{r.remark || "-"}</td>
                            <td className="px-2 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                              <div className="flex gap-1 justify-center">
                                {isAppAdmin && (
                                  <button
                                    className="text-gray-300 hover:text-red-500 transition-colors"
                                    onClick={() => handleDeleteReceipt(r.id, r.receipt_url)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t">
                        <tr>
                          <td colSpan={4} className="px-2 py-1.5 modal-label text-gray-900 text-right font-semibold">
                            총 합계
                          </td>
                          <td className="px-2 py-1.5 modal-value text-right text-blue-600">
                            ₩{(detailUsage.receipts || []).reduce((s, r) => s + (r.total_amount || 0), 0).toLocaleString()}
                          </td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Receipt Image Modal */}
      <Dialog open={!!receiptImageUrl} onOpenChange={(open) => !open && setReceiptImageUrl(null)}>
        <DialogContent className="sm:max-w-[600px] p-0">
          <DialogHeader className="px-5 pt-4 pb-3 border-b border-gray-100" style={{ gap: 0 }}>
            <DialogTitle className="text-[14px] font-bold leading-tight">영수증 이미지</DialogTitle>
          </DialogHeader>
          <div className="p-4 flex items-center justify-center">
            {receiptImageUrl && (
              <img
                src={receiptImageUrl}
                alt="영수증"
                className="max-w-full max-h-[60vh] object-contain rounded-md"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <AlertDialog open={rejectTargetId !== null} onOpenChange={(open) => !open && setRejectTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>카드사용 요청 반려</AlertDialogTitle>
            <AlertDialogDescription>반려 사유를 입력해주세요.</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="반려 사유를 입력하세요"
            className="text-xs business-radius-input min-h-[80px]"
          />
          <AlertDialogFooter>
            <AlertDialogCancel className="button-base">취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={!rejectReason.trim()}
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
              카드사용 신청이 정상적으로 완료되었습니다.
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
