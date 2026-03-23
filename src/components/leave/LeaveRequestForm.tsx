import { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { X, Calendar as CalendarIcon } from "lucide-react";
import { format, isSameDay, addDays, differenceInDays } from "date-fns";
import { ko } from "date-fns/locale";

// ─── 타입 ────────────────────────────────────────────────
type LeaveType = "annual" | "half_am" | "half_pm" | "official";

interface LeaveRecord {
  id: number;
  user_email: string;
  type: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
}

const LEAVE_TYPE_OPTIONS: { value: LeaveType; label: string; days: number; sub: string }[] = [
  { value: "annual", label: "연차", days: 1.0, sub: "종일" },
  { value: "half_am", label: "오전반차", days: 0.5, sub: "오전 휴가" },
  { value: "half_pm", label: "오후반차", days: 0.5, sub: "오후 휴가" },
  { value: "official", label: "공가", days: 0.0, sub: "공식 휴가" },
];

// ─── 유틸 ────────────────────────────────────────────────
function groupConsecutiveDates(dates: Date[]): { start: Date; end: Date }[] {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const ranges: { start: Date; end: Date }[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    if (differenceInDays(curr, prev) > 1) {
      ranges.push({ start, end: prev });
      start = curr;
    }
    prev = curr;
  }
  ranges.push({ start, end: prev });
  return ranges;
}

function sanitizeInput(text: string): string {
  return text.replace(/<[^>]*>/g, "").trim().replace(/\s+/g, " ");
}

// ─── 메인 컴포넌트 ──────────────────────────────────────
export default function LeaveRequestForm() {
  const supabase = useMemo(() => createClient(), []);
  const { employee, currentUserEmail, currentUserName } = useAuth();

  const [selectedType, setSelectedType] = useState<LeaveType | null>(null);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [existingLeaves, setExistingLeaves] = useState<LeaveRecord[]>([]);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const remainingLeave = employee?.remaining_annual_leave ?? 0;
  const grantedLeave = employee?.annual_leave_granted_current_year ?? 0;
  const usedLeave = employee?.used_annual_leave ?? 0;
  const department = employee?.department || "-";

  useEffect(() => {
    if (!currentUserEmail) return;
    const load = async () => {
      const { data } = await supabase
        .from("leave")
        .select("id, user_email, type, start_date, end_date, reason, status")
        .eq("user_email", currentUserEmail);
      if (data) setExistingLeaves(data);
    };
    load();
  }, [currentUserEmail, supabase]);

  const disabledDates = useMemo(() => {
    const dates: Date[] = [];
    for (const leave of existingLeaves) {
      if (leave.status === "rejected") continue;
      if (leave.type === "annual" || leave.type === "official") {
        const start = new Date(leave.start_date + "T00:00:00");
        const end = new Date(leave.end_date + "T00:00:00");
        let d = start;
        while (d <= end) {
          dates.push(new Date(d));
          d = addDays(d, 1);
        }
      }
    }
    return dates;
  }, [existingLeaves]);

  const isDateDisabled = useCallback(
    (day: Date): boolean => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (day < today) return true;
      if (disabledDates.some((d) => isSameDay(d, day))) return true;
      if (selectedType === "half_am" || selectedType === "half_pm") {
        for (const leave of existingLeaves) {
          if (leave.status === "rejected") continue;
          const start = new Date(leave.start_date + "T00:00:00");
          const end = new Date(leave.end_date + "T00:00:00");
          let d = start;
          while (d <= end) {
            if (isSameDay(d, day) && leave.type === selectedType) return true;
            d = addDays(d, 1);
          }
        }
      }
      return false;
    },
    [disabledDates, existingLeaves, selectedType]
  );

  const handleDayClick = (day: Date) => {
    if (!selectedType) {
      toast.warning("먼저 휴가 유형을 선택해주세요.");
      return;
    }
    setSelectedDates((prev) => {
      const exists = prev.some((d) => isSameDay(d, day));
      if (exists) return prev.filter((d) => !isSameDay(d, day));
      if (prev.length >= 30) {
        toast.warning("최대 30일까지 선택할 수 있습니다.");
        return prev;
      }
      return [...prev, day];
    });
  };

  const requestedDays = useMemo(() => {
    if (!selectedType) return 0;
    const opt = LEAVE_TYPE_OPTIONS.find((o) => o.value === selectedType);
    return selectedDates.length * (opt?.days ?? 1);
  }, [selectedType, selectedDates]);

  const canSubmit =
    !submitting && selectedType !== null && selectedDates.length > 0 && reason.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (reason.trim().length > 500) {
      toast.error("사유는 500자 이내로 입력해주세요.");
      return;
    }
    if (selectedType !== "official" && requestedDays > remainingLeave) {
      toast.warning(`잔여 연차(${remainingLeave}일)가 부족합니다. 요청: ${requestedDays}일`);
      return;
    }

    setSubmitting(true);
    try {
      const sanitizedReason = sanitizeInput(reason);
      const ranges = groupConsecutiveDates(selectedDates);
      for (const range of ranges) {
        const { error } = await supabase.from("leave").insert({
          user_email: currentUserEmail,
          name: currentUserName,
          type: selectedType,
          start_date: format(range.start, "yyyy-MM-dd"),
          end_date: format(range.end, "yyyy-MM-dd"),
          reason: sanitizedReason,
          status: "pending",
          created_at: new Date().toISOString(),
        });
        if (error) throw error;
      }
      toast.success("연차 신청이 완료되었습니다.");
      setSelectedType(null);
      setSelectedDates([]);
      setReason("");
      const { data } = await supabase
        .from("leave")
        .select("id, user_email, type, start_date, end_date, reason, status")
        .eq("user_email", currentUserEmail);
      if (data) setExistingLeaves(data);
    } catch (err) {
      logger.error("연차 신청 실패", err);
      toast.error("연차 신청에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const sortedDates = useMemo(
    () => [...selectedDates].sort((a, b) => a.getTime() - b.getTime()),
    [selectedDates]
  );

  // 날짜 표시 텍스트
  const dateDisplayLabel = useMemo(() => {
    if (sortedDates.length === 0) return null;
    if (sortedDates.length === 1) return format(sortedDates[0], "yyyy-MM-dd (EEE)", { locale: ko });
    return `${format(sortedDates[0], "MM/dd")} 외 ${sortedDates.length - 1}일 (총 ${sortedDates.length}일)`;
  }, [sortedDates]);

  return (
    <div className="doc-form">
      {/* ── 헤더 ── */}
      <div className="doc-form-header">
        <h1>연 차 신 청 서</h1>
        <div className="doc-subtitle">Annual Leave Request</div>
      </div>

      <div className="doc-form-body">
        {/* ── 1행: 소속부서 / 신청자 ── */}
        <div className="doc-form-row">
          <div className="doc-form-cell">
            <div className="doc-form-cell-label">소속부서</div>
            <div className="doc-form-static">{department}</div>
          </div>
          <div className="doc-form-cell">
            <div className="doc-form-cell-label">신청자</div>
            <div className="doc-form-static">{currentUserName || "-"}</div>
          </div>
        </div>

        {/* ── 2행: 연차 현황 (부여 / 사용 / 잔여) ── */}
        <div className="doc-form-row">
          <div className="doc-form-cell" style={{ flex: "0 0 33%" }}>
            <div className="doc-form-cell-label doc-form-cell-label-title">부여 연차</div>
            <div className="doc-form-static" style={{ fontSize: "13px" }}>
              <span className="font-semibold text-gray-900">{grantedLeave}</span>
              <span className="text-gray-400 ml-0.5">일</span>
            </div>
          </div>
          <div className="doc-form-cell" style={{ flex: "0 0 33%" }}>
            <div className="doc-form-cell-label doc-form-cell-label-title">사용 연차</div>
            <div className="doc-form-static" style={{ fontSize: "13px" }}>
              <span className="font-semibold text-hansl-600">{usedLeave}</span>
              <span className="text-gray-400 ml-0.5">일</span>
            </div>
          </div>
          <div className="doc-form-cell" style={{ flex: "0 0 34%" }}>
            <div className="doc-form-cell-label doc-form-cell-label-title">잔여 연차</div>
            <div className="doc-form-static" style={{ fontSize: "13px" }}>
              <span className={`font-bold ${remainingLeave <= 0 ? "text-red-600" : "text-green-600"}`}>
                {remainingLeave}
              </span>
              <span className="text-gray-400 ml-0.5">일</span>
            </div>
          </div>
        </div>

        {/* ── 3행: 휴가 유형 ── */}
        <div className="doc-form-row">
          <div className="doc-form-cell">
            <div className="doc-form-cell-label">휴가 유형 <span className="required">*</span></div>
            <div className="flex gap-1.5 pt-1 pb-0.5">
              {LEAVE_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setSelectedType(opt.value);
                    setSelectedDates([]);
                  }}
                  className={`flex flex-col items-center px-3 py-1.5 rounded-md border text-center transition-all min-w-[72px] ${
                    selectedType === opt.value
                      ? "border-hansl-500 bg-hansl-50 text-hansl-700 shadow-sm"
                      : "border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  <span className="text-[11px] font-semibold leading-tight">{opt.label}</span>
                  <span className="text-[9px] text-gray-400 mt-0.5 leading-tight">{opt.sub}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── 4행: 휴가 기간 (Popover 캘린더) ── */}
        <div className="doc-form-row">
          <div className="doc-form-cell">
            <div className="doc-form-cell-label">
              휴가 기간 <span className="required">*</span>
              {requestedDays > 0 && (
                <span className="text-hansl-600 font-normal ml-1.5">
                  사용 {requestedDays}일
                  {selectedType !== "official" && (
                    <span className="text-gray-400"> / 잔여 {Math.max(0, remainingLeave - requestedDays)}일</span>
                  )}
                </span>
              )}
            </div>
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="ghost" className="doc-date-trigger">
                  <CalendarIcon className="mr-1.5 h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                  <span className={dateDisplayLabel ? "text-gray-900" : "text-gray-300"}>
                    {dateDisplayLabel || "날짜를 선택하세요"}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 border-gray-200 shadow-lg" align="start" side="bottom" sideOffset={8}>
                <div className="bg-white business-radius-card p-3">
                  <div className="mb-2 px-1">
                    <div className="modal-label text-gray-600 text-center">원하는 날짜를 클릭하세요 (복수 선택 가능)</div>
                  </div>
                  <Calendar
                    mode="multiple"
                    selected={selectedDates}
                    onDayClick={handleDayClick}
                    disabled={isDateDisabled}
                    locale={ko}
                    className="compact-calendar"
                    fromDate={new Date()}
                    toDate={new Date(new Date().getFullYear() + 1, 11, 31)}
                    modifiers={{ today: new Date() }}
                    modifiersClassNames={{
                      today: "bg-blue-500 text-white font-semibold cursor-pointer hover:bg-blue-600 rounded-md",
                    }}
                  />

                  {/* 선택된 날짜 칩 */}
                  {sortedDates.length > 0 && (
                    <div className="border-t border-gray-100 mt-2 pt-2 px-1">
                      <div className="flex flex-wrap gap-1">
                        {sortedDates.map((date) => (
                          <span
                            key={date.toISOString()}
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-hansl-50 text-hansl-700 border border-hansl-200 rounded"
                          >
                            {format(date, "M/d (EEE)", { locale: ko })}
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedDates((prev) => prev.filter((d) => !isSameDay(d, date)))
                              }
                              className="text-hansl-400 hover:text-red-500 ml-0.5"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="border-t border-gray-100 mt-3 pt-2 flex justify-end">
                    <Button
                      type="button"
                      className="button-base bg-blue-500 hover:bg-blue-600 text-white"
                      onClick={() => setCalendarOpen(false)}
                      disabled={selectedDates.length === 0}
                    >
                      확인
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* ── 5행: 사유 ── */}
        <div className="doc-form-row" style={{ borderBottom: "none" }}>
          <div className="doc-form-cell">
            <div className="doc-form-cell-label">
              사유 <span className="required">*</span>
              <span className="text-gray-300 font-normal ml-1">({reason.length}/500)</span>
            </div>
            <Textarea
              placeholder="사유를 입력해주세요"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              className="doc-form-textarea"
            />
          </div>
        </div>
      </div>

      {/* ── 주의사항 ── */}
      <div className="doc-form-notice">
        <pre className="whitespace-pre-wrap font-sans leading-relaxed">{`[연차 사용 안내]
1. 연차 신청은 사용일 기준 최소 1일 전까지 완료해 주시기 바랍니다.
2. 반차(오전/오후)는 같은 날 중복 신청이 불가합니다.
3. 긴급한 경우 관리부서에 별도 연락 후 사후 신청이 가능합니다.
4. 승인 전 취소는 요청 목록 > 연차 신청 탭에서 가능합니다.`}</pre>
      </div>

      {/* ── 하단 버튼 ── */}
      <div className="doc-form-footer">
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
        >
          {submitting ? "처리 중..." : "연차승인요청"}
        </Button>
      </div>
    </div>
  );
}
