import * as React from "react"
import { CalendarIcon, X } from "lucide-react"
import { DateRange } from "react-day-picker"
import { ko } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DateRangePickerProps extends React.HTMLAttributes<HTMLDivElement> {
  date?: DateRange
  onDateChange?: (date: DateRange | undefined) => void
  placeholder?: string
  disabled?: boolean
  triggerClassName?: string
}

export function DateRangePicker({
  className,
  date,
  onDateChange,
  placeholder = "기간을 선택하세요",
  disabled = false,
  triggerClassName,
  ...props
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false)

  const formatDateRange = (range: DateRange | undefined) => {
    if (!range?.from) {
      return placeholder
    }

    const formatDate = (date: Date) => {
      return date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    }

    if (range.from && range.to) {
      // 같은 달인지 확인
      const isSameMonth = range.from.getFullYear() === range.to.getFullYear() && 
                         range.from.getMonth() === range.to.getMonth()
      
      if (isSameMonth) {
        const year = range.from.getFullYear()
        const month = range.from.toLocaleDateString('ko-KR', { month: 'long' })
        const fromDay = range.from.getDate()
        const toDay = range.to.getDate()
        return `${year}년 ${month} ${fromDay}일 - ${toDay}일`
      }
      
      return `${formatDate(range.from)} - ${formatDate(range.to)}`
    }

    return formatDate(range.from)
  }

  return (
    <div className={cn("grid gap-2", className)} {...props}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id="date"
            className={cn(
              "button-base w-full justify-start text-left font-normal border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors",
              !date && "text-gray-500",
              date && "text-gray-900",
              triggerClassName
            )}
            disabled={disabled}
          >
            <CalendarIcon className="mr-2 h-4 w-4 text-gray-400" />
            <span className="truncate">{formatDateRange(date)}</span>
            {date && (
              <X 
                className="ml-auto h-4 w-4 text-gray-400 hover:text-gray-600 transition-colors" 
                onClick={(e) => {
                  e.stopPropagation()
                  onDateChange?.(undefined)
                  setOpen(false)
                }}
              />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 shadow-lg border border-gray-200 business-radius-card" align="start">
          <div className="bg-white business-radius-card overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-100 px-4 py-3">
              <h4 className="text-[11px] font-semibold text-gray-900">기간 선택</h4>
              <p className="text-[10px] text-gray-500 mt-1">시작일과 종료일을 선택하세요</p>
            </div>
            <div className="p-4">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={date?.from}
                selected={date}
                onSelect={(newDate) => {
                  onDateChange?.(newDate)
                  // 종료일이 선택되면 자동으로 팝오버 닫기
                  if (newDate?.from && newDate?.to) {
                    setOpen(false)
                  }
                }}
                numberOfMonths={2}
                disabled={disabled}
                locale={ko}
                className="business-radius-card"
                classNames={{
                  months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
                  month: "space-y-4",
                  caption: "flex justify-center pt-1 relative items-center text-[11px] font-medium",
                  caption_label: "text-[11px] font-medium text-gray-900",
                  nav: "space-x-1 flex items-center",
                  nav_button: "inline-flex items-center justify-center rounded-md text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none border border-input bg-background hover:bg-accent hover:text-accent-foreground h-6 w-6",
                  nav_button_previous: "absolute left-1",
                  nav_button_next: "absolute right-1",
                  table: "w-full border-collapse space-y-1",
                  head_row: "flex",
                  head_cell: "text-gray-500 rounded-md w-7 font-normal text-[10px]",
                  row: "flex w-full mt-2",
                  cell: "h-7 w-7 text-center text-[11px] p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
                  day: "inline-flex items-center justify-center rounded-md text-[11px] font-normal ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 aria-selected:opacity-100 h-7 w-7 hover:bg-gray-100 hover:text-gray-900 text-gray-900",
                  day_range_start: "day-range-start bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                  day_range_end: "day-range-end bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                  day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                  day_today: "bg-accent text-accent-foreground font-semibold",
                  outside: "!text-gray-400 !opacity-40 hover:!text-gray-500 hover:bg-gray-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
                  day_disabled: "!text-gray-400 !opacity-40",
                  day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
                  day_hidden: "invisible",
                }}
              />
            </div>
            {date && (
              <div className="bg-gray-50 border-t border-gray-100 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="badge-text text-gray-600">
                    선택된 기간: {formatDateRange(date)}
                  </span>
                  <Button
                    onClick={() => {
                      onDateChange?.(undefined)
                      setOpen(false)
                    }}
                    className="button-action-secondary"
                  >
                    지우기
                  </Button>
                </div>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}