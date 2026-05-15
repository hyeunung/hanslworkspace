import { useMemo, useState } from "react";
import {
  startOfMonth,
  startOfWeek,
  addDays,
  format,
  isSameDay,
  isSameMonth,
  addMonths,
} from "date-fns";
import { ko } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface LeaveRecord {
  id: number;
  user_email: string;
  name: string | null;
  type: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
}

interface LeaveCalendarProps {
  leaves: LeaveRecord[];
  /** 본인 이메일 — 동행 출장(본인 user_email이 아닌 출장) 표기용 */
  currentUserEmail?: string;
}

const GREEN_TYPES = new Set(["annual", "full", "half_am", "half_pm", "official"]);
const BLUE_TYPES = new Set(["biztrip", "biztrip_migrated"]);

const SHORT_LABEL: Record<string, string> = {
  annual: "연차",
  full: "연차",
  half_am: "오전반차",
  half_pm: "오후반차",
  official: "공가",
  biztrip: "출장",
  biztrip_migrated: "출장",
};

const COLOR_GREEN = "#34C759";
const COLOR_BLUE = "#1976D2";
const COLOR_SUN = "#FF3B30";
const COLOR_SAT = "#007AFF";
const COLOR_WEEKDAY = "#1C1C1E";

function parseDateOnly(s: string): Date {
  const datePart = s.includes("T") ? s.split("T")[0] : s;
  const [y, m, d] = datePart.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fmtRange(l: LeaveRecord): string {
  const s = parseDateOnly(l.start_date);
  const e = parseDateOnly(l.end_date);
  if (isSameDay(s, e)) return format(s, "M/d");
  return `${format(s, "M/d")} ~ ${format(e, "M/d")}`;
}

export default function LeaveCalendar({ leaves, currentUserEmail }: LeaveCalendarProps) {
  const [focusedMonth, setFocusedMonth] = useState<Date>(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());

  // 셀 별 이벤트 매핑
  const { cells, eventsByDate } = useMemo(() => {
    const approved = leaves.filter((l) => l.status === "approved");
    const gridStart = startOfWeek(startOfMonth(focusedMonth), { weekStartsOn: 0 });
    const cellList = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

    const byDate = new Map<string, LeaveRecord[]>();
    for (const cell of cellList) {
      const key = format(cell, "yyyy-MM-dd");
      const evs: LeaveRecord[] = [];
      for (const l of approved) {
        const s = parseDateOnly(l.start_date);
        const e = parseDateOnly(l.end_date);
        if (cell >= s && cell <= e) evs.push(l);
      }
      // 연차류 먼저, 출장 뒤
      evs.sort((a, b) => {
        const aBiz = BLUE_TYPES.has(a.type) ? 1 : 0;
        const bBiz = BLUE_TYPES.has(b.type) ? 1 : 0;
        return aBiz - bBiz;
      });
      byDate.set(key, evs);
    }

    return { cells: cellList, eventsByDate: byDate };
  }, [leaves, focusedMonth]);

  // 선택한 날짜의 이벤트 (월 전체가 아닌 선택 날짜만)
  const selectedDayEvents = useMemo(() => {
    const key = format(selectedDay, "yyyy-MM-dd");
    return eventsByDate.get(key) || [];
  }, [eventsByDate, selectedDay]);

  const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];

  return (
    <div className="flex flex-col h-full border border-gray-200 rounded-lg bg-white overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 shrink-0">
        <button
          type="button"
          onClick={() => setFocusedMonth((d) => addMonths(d, -1))}
          className="p-1 rounded hover:bg-gray-100 text-gray-600"
          aria-label="이전 달"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-[12px] font-semibold text-gray-900">
          {format(focusedMonth, "yyyy년 M월", { locale: ko })}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              const today = new Date();
              setFocusedMonth(today);
              setSelectedDay(today);
            }}
            className="text-[10px] px-2 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            오늘
          </button>
          <button
            type="button"
            onClick={() => setFocusedMonth((d) => addMonths(d, 1))}
            className="p-1 rounded hover:bg-gray-100 text-gray-600"
            aria-label="다음 달"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50 shrink-0">
        {weekdayLabels.map((w, i) => (
          <div
            key={w}
            className="text-center text-[10px] font-semibold py-1.5"
            style={{ color: i === 0 ? COLOR_SUN : i === 6 ? COLOR_SAT : COLOR_WEEKDAY }}
          >
            {w}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 (각 셀 ~62px 고정) */}
      <div className="grid grid-cols-7 shrink-0" style={{ gridAutoRows: "62px" }}>
        {cells.map((cell) => {
          const key = format(cell, "yyyy-MM-dd");
          const evs = eventsByDate.get(key) || [];
          const inMonth = isSameMonth(cell, focusedMonth);
          const isSelected = isSameDay(cell, selectedDay);
          const isToday = isSameDay(cell, new Date());
          const dow = cell.getDay();
          const dateColor = dow === 0 ? COLOR_SUN : dow === 6 ? COLOR_SAT : COLOR_WEEKDAY;

          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedDay(cell)}
              className={`
                flex flex-col items-stretch text-left
                border-r border-b border-gray-100 last:border-r-0
                px-1 pt-0.5 pb-0.5 overflow-hidden transition-colors
                ${isSelected ? "bg-blue-50 ring-1 ring-inset ring-blue-300" : "hover:bg-gray-50"}
                ${!inMonth ? "opacity-40" : ""}
              `}
            >
              <span
                className="text-[12px] leading-tight"
                style={{
                  color: dateColor,
                  fontWeight: isToday ? 800 : 600,
                  textDecoration: isToday ? "underline" : "none",
                }}
              >
                {cell.getDate()}
              </span>
              <div className="flex flex-col gap-0.5 mt-0.5 min-h-0 flex-1 w-full">
                {evs.slice(0, 2).map((e, i) => (
                  <span
                    key={`${e.id}-${i}`}
                    className="text-[10px] font-bold leading-[1.1] truncate rounded-sm px-1 py-px text-white"
                    style={{ backgroundColor: BLUE_TYPES.has(e.type) ? COLOR_BLUE : COLOR_GREEN }}
                  >
                    {SHORT_LABEL[e.type] || e.type}
                  </span>
                ))}
                {evs.length > 2 && (
                  <span className="text-[9px] font-bold text-gray-600 leading-tight">+{evs.length - 2}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* 선택한 날짜의 일정 (텍스트) */}
      <div className="flex-1 min-h-0 overflow-y-auto border-t border-gray-200 px-3 py-2 bg-gray-50">
        <div className="text-[12px] font-bold text-gray-900 mb-1.5">
          {format(selectedDay, "M월 d일 (eee)", { locale: ko })} 일정 ({selectedDayEvents.length})
        </div>
        {selectedDayEvents.length === 0 ? (
          <div className="text-[11px] text-gray-500">선택한 날짜에 등록된 연차/출장이 없습니다</div>
        ) : (
          <ul className="space-y-1">
            {selectedDayEvents.map((e) => {
              const isBiz = BLUE_TYPES.has(e.type);
              const isCoTraveler =
                isBiz && currentUserEmail && e.user_email !== currentUserEmail;
              return (
                <li key={e.id} className="flex items-center gap-1.5 text-[11px] leading-tight">
                  <span
                    className="shrink-0 px-1.5 py-0.5 rounded font-bold text-white text-[10px]"
                    style={{ backgroundColor: isBiz ? COLOR_BLUE : COLOR_GREEN }}
                  >
                    {SHORT_LABEL[e.type] || e.type}
                  </span>
                  <span className="text-gray-900 font-semibold shrink-0">{fmtRange(e)}</span>
                  {isCoTraveler && (
                    <span className="text-gray-700 font-medium shrink-0">· 동행({e.name || ""})</span>
                  )}
                  {e.reason && (
                    <span className="text-gray-700 truncate">· {e.reason}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
