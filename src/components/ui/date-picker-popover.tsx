import { useState } from 'react'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Calendar as CalendarIcon } from 'lucide-react'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'

interface DatePickerPopoverProps {
  children: React.ReactNode
  onDateSelect: (date: Date) => void
  disabled?: boolean
  placeholder?: string
  align?: "center" | "start" | "end"
  side?: "top" | "right" | "bottom" | "left"
}

export function DatePickerPopover({
  children,
  onDateSelect,
  disabled = false,
  placeholder = "날짜를 선택하세요",
  align = "center",
  side = "bottom"
}: DatePickerPopoverProps) {
  const [open, setOpen] = useState(false)

  const handleDateSelect = (date: Date | undefined) => {
    logger.debug('📅 DatePickerPopover handleDateSelect 호출:', { 
      date, 
      isToday: date && new Date().toDateString() === date.toDateString(),
      dateString: date?.toDateString(),
      todayString: new Date().toDateString()
    });
    if (date) {
      logger.debug('✅ 날짜 선택됨, onDateSelect 호출 예정');
      onDateSelect(date)
      setOpen(false) // 날짜 선택 후 팝오버 닫기
      logger.debug('🔚 DatePickerPopover 처리 완료');
    } else {
      logger.debug('❌ 날짜가 undefined임');
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {children}
      </PopoverTrigger>
      <PopoverContent 
        className="w-auto p-0 border-gray-200 shadow-lg" 
        align={align}
        side={side}
        sideOffset={8}
      >
        <div className="bg-white business-radius-card p-2">
          <div className="mb-2 px-1">
            <div className="modal-label text-gray-600 text-center">
              {placeholder}
            </div>
          </div>
          <Calendar
            mode="single"
            selected={undefined}
            onSelect={(date) => {
              logger.debug('🗓️ Calendar onSelect 직접 호출:', { 
                date, 
                isToday: date && new Date().toDateString() === date.toDateString(),
                dateValue: date?.getTime(),
                todayValue: new Date().getTime()
              });
              handleDateSelect(date);
            }}
            locale={ko}
            initialFocus
            className="compact-calendar"
            disabled={false}
            fromDate={new Date('2020-01-01')}
            toDate={new Date('2030-12-31')}
            defaultMonth={new Date()}
            modifiers={{
              today: new Date()
            }}
            modifiersClassNames={{
              today: "bg-hansl-500 text-white font-semibold cursor-pointer hover:bg-hansl-600 rounded-md"
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}