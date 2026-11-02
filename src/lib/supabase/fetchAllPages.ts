// PostgREST 1회 응답 상한(max_rows) — .limit()을 더 크게 줘도 이 건수까지만 내려오고 에러도 나지 않는다
export const SUPABASE_PAGE_SIZE = 1000

/**
 * 페이지 단위로 반복 조회해 전체 행을 가져온다.
 * - 한 페이지라도 실패하면 일부만 돌려주지 않고 throw 한다
 * - fetchPage는 유일 컬럼까지 포함해 정렬해야 페이지 경계가 고정된다
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const rows: T[] = []
  const seenIds = new Set<unknown>()
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + SUPABASE_PAGE_SIZE - 1)
    if (error) throw error
    const page = data ?? []
    for (const row of page) {
      // 조회 중 새 행이 들어와 다음 페이지로 밀린 행이 중복되지 않도록 id로 제거
      const id = (row as { id?: unknown }).id
      if (id !== undefined) {
        if (seenIds.has(id)) continue
        seenIds.add(id)
      }
      rows.push(row)
    }
    if (page.length < SUPABASE_PAGE_SIZE) break
  }
  return rows
}
