
import { useState, useMemo, useCallback } from 'react'

export type SortDirection = 'asc' | 'desc' | null
export type SortConfig<T> = {
  key: keyof T | null
  direction: SortDirection
}

export function useTableSort<T>(
  data: T[],
  defaultSortKey?: keyof T,
  defaultDirection: SortDirection = 'asc'
) {
  const [sortConfig, setSortConfig] = useState<SortConfig<T>>({
    key: defaultSortKey || null,
    direction: defaultSortKey ? defaultDirection : null
  })

  const handleSort = useCallback((key: keyof T) => {
    setSortConfig(prev => {
      // 같은 키를 다시 클릭하면 방향 변경
      if (prev.key === key) {
        if (prev.direction === 'asc') {
          return { key, direction: 'desc' }
        } else if (prev.direction === 'desc') {
          return { key: null, direction: null }
        }
      }
      // 새로운 키를 클릭하면 오름차순으로 시작
      return { key, direction: 'asc' }
    })
  }, [])

  const sortedData = useMemo(() => {
    if (!sortConfig.key || !sortConfig.direction) {
      return data
    }

    return [...data].sort((a, b) => {
      const key = sortConfig.key as keyof T
      const aValue = a[key]
      const bValue = b[key]

      // null/undefined 처리
      if (aValue === null || aValue === undefined) return 1
      if (bValue === null || bValue === undefined) return -1

      // 숫자 비교
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortConfig.direction === 'asc' 
          ? aValue - bValue 
          : bValue - aValue
      }

      // 날짜 비교
      if (aValue instanceof Date && bValue instanceof Date) {
        return sortConfig.direction === 'asc'
          ? aValue.getTime() - bValue.getTime()
          : bValue.getTime() - aValue.getTime()
      }

      // 문자열 비교 (대소문자 무시)
      const aStr = String(aValue).toLowerCase()
      const bStr = String(bValue).toLowerCase()
      
      if (sortConfig.direction === 'asc') {
        return aStr < bStr ? -1 : aStr > bStr ? 1 : 0
      } else {
        return aStr > bStr ? -1 : aStr < bStr ? 1 : 0
      }
    })
  }, [data, sortConfig])

  return {
    sortedData,
    sortConfig,
    handleSort
  }
}