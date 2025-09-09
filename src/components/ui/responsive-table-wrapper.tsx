
import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ResponsiveTableWrapperProps {
  children: ReactNode
  className?: string
}

export function ResponsiveTableWrapper({ 
  children, 
  className 
}: ResponsiveTableWrapperProps) {
  return (
    <div className={cn("w-full", className)}>
      {/* 데스크톱: 일반 테이블 뷰 */}
      <div className="hidden md:block overflow-x-auto">
        <div className="inline-block min-w-full align-middle">
          {children}
        </div>
      </div>
      
      {/* 모바일: 스크롤 가능한 테이블 */}
      <div className="block md:hidden">
        <div className="overflow-x-auto -mx-4 sm:-mx-6">
          <div className="inline-block min-w-full align-middle px-4 sm:px-6">
            <div className="overflow-hidden">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}