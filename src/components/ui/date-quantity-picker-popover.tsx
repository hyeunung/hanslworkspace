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

interface DateQuantityPickerPopoverProps {
  children: React.ReactNode
  onConfirm: (date: Date, quantity?: number) => void
  disabled?: boolean
  placeholder?: string
  align?: "center" | "start" | "end"
  side?: "top" | "right" | "bottom" | "left"
  defaultDate?: Date
  defaultQuantity?: number
  maxQuantity?: number
  hideQuantityInput?: boolean
  quantityInfoText?: string
}

export function DateQuantityPickerPopover({
  children,
  onConfirm,
  disabled = false,
  placeholder = "날짜와 실제입고수량을 입력하세요",
  align = "center",
  side = "bottom",
  defaultDate,
  defaultQuantity,
  maxQuantity,
  hideQuantityInput = false,
  quantityInfoText = "요청입고수량과 동일한 수량으로 입력됩니다"
}: DateQuantityPickerPopoverProps) {
  const [open, setOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(defaultDate)
  const [quantity, setQuantity] = useState<string>(defaultQuantity?.toString() || '')

  const handleFillRequestedQuantity = () => {
    if (maxQuantity !== undefined) {
      setQuantity(maxQuantity.toString())
    }
  }

  const handleConfirm = () => {
    if (!selectedDate) {
      return
    }
    
    if (hideQuantityInput) {
      // 수량 입력이 숨겨진 경우 (전체 입고완료), quantity를 undefined로 전달
      onConfirm(selectedDate, undefined)
      setOpen(false)
      // Reset after close
      setSelectedDate(defaultDate)
      setQuantity(defaultQuantity?.toString() || '')
      return
    }
    
    const quantityNum = parseFloat(quantity.replace(/,/g, ''))
    if (isNaN(quantityNum) || quantityNum < 0) {
      return
    }

    if (maxQuantity && quantityNum > maxQuantity) {
      return
    }

    onConfirm(selectedDate, quantityNum)
    setOpen(false)
    // Reset after close
    setSelectedDate(defaultDate)
    setQuantity(defaultQuantity?.toString() || '')
  }

  const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9]/g, '')
    setQuantity(value)
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
          {hideQuantityInput && (
            <div className="mb-2 px-1">
              <div className="text-[10px] text-gray-500 text-center leading-tight">
                <div>요청입고수량과 동일한</div>
                <div>수량으로 입력됩니다</div>
              </div>
            </div>
          )}
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
          {!hideQuantityInput && (
            <div className="mt-3 px-1">
              <div className="flex items-center justify-between mb-1 gap-2">
                <label className="block text-xs font-medium text-gray-700">
                  실제입고수량
                </label>
                {maxQuantity !== undefined && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleFillRequestedQuantity}
                    className="h-6 px-2 text-[10px] border-gray-200 text-hansl-600"
                  >
                    요청수량과 동일
                  </Button>
                )}
              </div>
              <Input
                type="number"
                value={quantity}
                onChange={handleQuantityChange}
                placeholder="수량을 입력하세요"
                className="border-gray-200 rounded-lg text-center w-full !h-5 !px-1.5 !py-0.5 !text-[9px] font-normal text-gray-600 focus:border-blue-400"
                min="0"
                max={maxQuantity}
              />
              {maxQuantity && (
                <p className="text-xs text-gray-500 mt-1">최대: {maxQuantity.toLocaleString()}</p>
              )}
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              className="button-base"
            >
              취소
            </Button>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={!selectedDate || (!hideQuantityInput && (!quantity || parseFloat(quantity.replace(/,/g, '')) < 0 || (maxQuantity !== undefined && parseFloat(quantity.replace(/,/g, '')) > maxQuantity)))}
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

