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
  const [selectedDate, setSelectedDate] = useState<Date>()

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      setSelectedDate(date)
      onDateSelect(date)
      setOpen(false) // 날짜 선택 후 팝오버 닫기
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
            selected={selectedDate}
            onSelect={handleDateSelect}
            locale={ko}
            initialFocus
            className="compact-calendar"
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}