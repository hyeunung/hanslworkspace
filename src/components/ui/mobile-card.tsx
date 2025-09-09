
import { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'

interface MobileCardProps {
  children: ReactNode
  className?: string
}

interface MobileCardItemProps {
  label: ReactNode
  value: ReactNode
  className?: string
  valueClassName?: string
}

export function MobileCard({ children, className }: MobileCardProps) {
  return (
    <Card className={cn("mb-3", className)}>
      <CardContent className="p-4 space-y-2">
        {children}
      </CardContent>
    </Card>
  )
}

export function MobileCardItem({ 
  label, 
  value, 
  className,
  valueClassName 
}: MobileCardItemProps) {
  return (
    <div className={cn("flex justify-between items-start", className)}>
      <span className="text-sm text-muted-foreground font-medium min-w-[100px]">
        {label}
      </span>
      <span className={cn("text-sm text-right flex-1 ml-2", valueClassName)}>
        {value}
      </span>
    </div>
  )
}

export function MobileCardHeader({ children }: { children: ReactNode }) {
  return (
    <div className="font-semibold text-base mb-3 pb-2 border-b">
      {children}
    </div>
  )
}

export function MobileCardActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end gap-2 pt-2 mt-2 border-t">
      {children}
    </div>
  )
}