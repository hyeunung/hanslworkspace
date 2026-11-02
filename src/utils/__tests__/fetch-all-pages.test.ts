import { describe, expect, it } from 'vitest'

import { fetchAllPages, SUPABASE_PAGE_SIZE } from '@/lib/supabase/fetchAllPages'

// PostgREST처럼 요청 범위와 무관하게 1회 응답을 상한까지만 내려주는 가짜 조회
const cappedFetch = (table: { id: number }[], failFrom?: number) => async (from: number, to: number) => {
  if (from === failFrom) return { data: null, error: new Error('page failed') }
  const end = Math.min(to + 1, from + SUPABASE_PAGE_SIZE, table.length)
  return { data: table.slice(from, end), error: null }
}

const rows = (count: number) => Array.from({ length: count }, (_, id) => ({ id }))

describe('fetchAllPages', () => {
  it.each([0, 1, 999, 1000, 1001, 2000, 4785])('%i건을 빠짐없이 가져온다', async (count) => {
    expect(await fetchAllPages(cappedFetch(rows(count)))).toHaveLength(count)
  })

  it('한 페이지라도 실패하면 일부만 돌려주지 않고 throw 한다', async () => {
    await expect(fetchAllPages(cappedFetch(rows(2500), 1000))).rejects.toThrow('page failed')
  })

  it('조회 중 행이 밀려 다음 페이지에 다시 나와도 중복되지 않는다', async () => {
    const table = rows(1500)
    const result = await fetchAllPages(async (from, to) => {
      // 첫 페이지 조회 직후 새 행이 맨 앞에 들어온 상황
      const shifted = from === 0 ? table : [{ id: 9999 }, ...table]
      return { data: shifted.slice(from, to + 1), error: null }
    })
    expect(result.map((row) => row.id)).toEqual(table.map((row) => row.id))
  })

  it('id가 없는 행은 그대로 둔다', async () => {
    const result = await fetchAllPages(async () => ({ data: [{ name: 'a' }, { name: 'a' }], error: null }))
    expect(result).toHaveLength(2)
  })
})
