// 거래처(vendor) 정규화 / 유사도 / vendors 테이블 매칭 공통 모듈

export function normalizeVendorName(s: string | null | undefined): string {
  if (!s) return ''
  const result = s
    .toLowerCase()
    .replace(/\(주\)|주식회사|㈜|co\.?|ltd\.?|inc\.?|corp\.?/gi, '')
    .replace(/[^a-z0-9가-힣]/g, '')
  if (!result) {
    return s.toLowerCase().replace(/[^a-z0-9가-힣]/g, '')
  }
  return result
}

function vendorLevenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]) + 1
    }
  }
  return dp[m][n]
}

/**
 * 거래처명 유사도 (0-100)
 * - 정규화 후 완전일치 → 100
 * - 포함관계 → 85
 * - 그 외 Levenshtein 비율
 */
export function calculateVendorSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizeVendorName(a || '')
  const nb = normalizeVendorName(b || '')
  if (!na || !nb) return 0
  if (na === nb) return 100
  if (na.includes(nb) || nb.includes(na)) return 85
  const maxLen = Math.max(na.length, nb.length)
  const dist = vendorLevenshtein(na, nb)
  return Math.round(((maxLen - dist) / maxLen) * 100)
}

export interface VendorMatchResult {
  matched: boolean
  vendor_name?: string
  vendor_id?: number
  similarity: number
}

/**
 * 추출된 거래처명을 vendors 테이블의 vendor_name/vendor_alias 와 비교해 가장 유사한 거래처를 찾는다.
 * threshold (기본 60) 이상일 때만 matched=true 반환.
 */
export async function validateAndMatchVendor(
  supabase: any,
  extractedVendorName: string | null | undefined,
  threshold = 60,
): Promise<VendorMatchResult> {
  if (!extractedVendorName) return { matched: false, similarity: 0 }

  const { data: vendors, error } = await supabase
    .from('vendors')
    .select('id, vendor_name, vendor_alias')
    .limit(500)

  if (error || !vendors || vendors.length === 0) {
    return { matched: false, similarity: 0 }
  }

  let best: { vendor_id: number; vendor_name: string; similarity: number } | null = null
  for (const vendor of vendors as Array<{ id: number; vendor_name: string; vendor_alias?: string | null }>) {
    let similarity = calculateVendorSimilarity(extractedVendorName, vendor.vendor_name)
    if (vendor.vendor_alias) {
      similarity = Math.max(similarity, calculateVendorSimilarity(extractedVendorName, vendor.vendor_alias))
    }
    if (!best || similarity > best.similarity) {
      best = { vendor_id: vendor.id, vendor_name: vendor.vendor_name, similarity }
    }
  }

  if (best && best.similarity >= threshold) {
    return {
      matched: true,
      vendor_name: best.vendor_name,
      vendor_id: best.vendor_id,
      similarity: best.similarity,
    }
  }

  return { matched: false, similarity: best?.similarity || 0 }
}
