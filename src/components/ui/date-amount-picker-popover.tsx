import { useState } from 'react'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

interface DateAmountPickerPopoverProps {
  children: React.ReactNode
  onConfirm: (date: Date, amount: number) => void
  disabled?: boolean
  placeholder?: string
  align?: "center" | "start" | "end"
  side?: "top" | "right" | "bottom" | "left"
  defaultDate?: Date
  defaultAmount?: number
}

export function DateAmountPickerPopover({
  children,
  onConfirm,
  disabled = false,
  placeholder = "날짜와 금액을 입력하세요",
  align = "center",
  side = "bottom",
  defaultDate,
  defaultAmount
}: DateAmountPickerPopoverProps) {
  const [open, setOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(defaultDate)
  const [amount, setAmount] = useState<string>(defaultAmount?.toString() || '')

  const handleConfirm = () => {
    if (!selectedDate) {
      return
    }
    
    const amountNum = parseFloat(amount.replace(/,/g, ''))
    if (isNaN(amountNum) || amountNum <= 0) {
      return
    }

    onConfirm(selectedDate, amountNum)
    setOpen(false)
    // Reset after close
    setSelectedDate(defaultDate)
    setAmount(defaultAmount?.toString() || '')
  }

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9]/g, '')
    if (value) {
      const numValue = parseInt(value, 10)
      setAmount(numValue.toLocaleString())
    } else {
      setAmount('')
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
        <div className="bg-white business-radius-card p-3">
          <div className="mb-2 px-1">
            <div className="modal-label text-gray-600 text-center">
              {placeholder}
            </div>
          </div>
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={setSelectedDate}
            locale={ko}
            initialFocus
            className="compact-calendar"
            disabled={false}
            fromDate={new Date('2020-01-01')}
            toDate={new Date('2030-12-31')}
            defaultMonth={selectedDate || new Date()}
            modifiers={{
              today: new Date()
            }}
            modifiersClassNames={{
              today: "bg-blue-500 text-white font-semibold cursor-pointer hover:bg-blue-600 rounded-md"
            }}
          />
          <div className="mt-3 px-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              지출금액
            </label>
            <Input
              type="text"
              value={amount}
              onChange={handleAmountChange}
              placeholder="금액을 입력하세요"
              className="w-full"
            />
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              취소
            </Button>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={!selectedDate || !amount || parseFloat(amount.replace(/,/g, '')) <= 0}
              className="button-base button-action-primary"
            >
              확인
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

