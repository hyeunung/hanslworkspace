import { useState } from 'react'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { CalendarIcon } from 'lucide-react'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'

interface DatePickerDialogProps {
  isOpen: boolean
  onClose: () => void
  onDateSelect: (date: Date) => void
  title?: string
  description?: string
  defaultDate?: Date
}

export function DatePickerDialog({
  isOpen,
  onClose,
  onDateSelect,
  title = "날짜 선택",
  description = "실제 입고된 날짜를 선택해주세요",
  defaultDate = new Date()
}: DatePickerDialogProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(defaultDate)

  const handleConfirm = () => {
    onDateSelect(selectedDate)
    onClose()
  }

  const handleCancel = () => {
    setSelectedDate(defaultDate)
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="w-5 h-5" />
            {title}
          </DialogTitle>
          {description && (
            <p className="text-sm text-gray-600 mt-2">{description}</p>
          )}
        </DialogHeader>
        
        <div className="flex justify-center py-4">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(date) => date && setSelectedDate(date)}
            locale={ko}
            className="rounded-md border"
          />
        </div>

        <div className="text-center text-sm text-gray-600 mb-4">
          선택한 날짜: {format(selectedDate, 'yyyy년 MM월 dd일 (E)', { locale: ko })}
        </div>

        <DialogFooter className="gap-2">
          <Button 
            variant="outline" 
            onClick={handleCancel}
            className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          >
            취소
          </Button>
          <Button 
            onClick={handleConfirm}
            className="button-base bg-blue-500 hover:bg-blue-600 text-white"
          >
            확인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}