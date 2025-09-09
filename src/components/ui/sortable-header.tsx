
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SortDirection } from '@/hooks/useTableSort'

interface SortableHeaderProps {
  children: React.ReactNode
  sortKey: string
  currentSortKey: string | null
  sortDirection: SortDirection
  onSort: (key: string) => void
  className?: string
}

export function SortableHeader({
  children,
  sortKey,
  currentSortKey,
  sortDirection,
  onSort,
  className
}: SortableHeaderProps) {
  const isActive = currentSortKey === sortKey
  
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={cn(
        "flex items-center gap-1 hover:text-foreground transition-colors",
        "text-left w-full",
        isActive && "text-foreground font-semibold",
        className
      )}
    >
      {children}
      <span className="ml-auto">
        {!isActive && (
          <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />
        )}
        {isActive && sortDirection === 'asc' && (
          <ArrowUp className="h-3 w-3" />
        )}
        {isActive && sortDirection === 'desc' && (
          <ArrowDown className="h-3 w-3" />
        )}
      </span>
    </button>
  )
}