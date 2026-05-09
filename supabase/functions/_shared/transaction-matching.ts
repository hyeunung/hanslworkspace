// 거래명세서 라인 ↔ 시스템 발주(purchase_requests) 매칭 통합 엔진.
//
// 두 단계로 구성:
//   Layer 1: PO/SO 번호로 시스템 발주를 찾고 그 안에서 라인 결정
//     1a) extracted_po_line_number 가 있고 시스템 라인과 일치 → 즉시 매칭
//     1b) 그 외엔 발주 안의 모든 라인에 대해 (item_name/spec 유사도 + 수량 보너스) 점수
//   Layer 2: PO 가 없거나 시스템에서 못 찾은 경우의 fallback
//     - 명세서의 다른 라인 매칭 결과 / extracted_vendor_name 으로 vendor 추정
//     - 그 vendor 의 최근 발주들 안에서 같은 점수로 매칭
//
// vendor 게이트는 두지 않는다. PO 100% 일치가 vendor 보다 강한 신호이고,
// vendor 추출이 잘못된 경우(예: '퍼스트코어' vs 실제 '(주)환화') 에도 매칭이 살아남아야 한다.

import { normalizeOrderNumber } from './order-number.ts'
import { calculateVendorSimilarity } from './vendor-matching.ts'

export interface MatchInputItem {
  line_number: number
  item_name?: string | null
  specification?: string | null
  quantity?: number | null
  po_number?: string | null
  po_line_number?: number | null
}

export interface MatchContext {
  /** 명세서 헤더에서 추출된 PO. 라인에 PO 가 없을 때 fallback 으로 사용 */
  headerPoNumber?: string | null
  /** 명세서에서 추출된 거래처명. Layer 2 vendor 추정 후보로 사용 */
  extractedVendorName?: string | null
}

export type MatchMethod = 'po_number' | 'item_similarity' | null

export interface MatchOutput {
  lineNumber: number
  matchedPurchaseId: number | null
  matchedItemId: number | null
  matchedVendorName: string | null
  matchMethod: MatchMethod
  /** 디버깅용. DB 에는 저장되지 않음 */
  score?: number
  /** 디버깅용. 어떤 단계에서 잡혔는지 */
  matchStage?: 'po_line' | 'po_score' | 'po_only' | 'vendor_scoped'
}

const ITEM_MATCH_THRESHOLD_IN_PO = 30 // PO 안 라인 매칭 최소 점수
const VENDOR_SCOPED_THRESHOLD = 70 // PO 없는 줄의 vendor-scoped 매칭 최소 점수
const VENDOR_NAME_CONFIDENT_THRESHOLD = 85 // 추출 vendor 이름을 신뢰할 임계
const VENDOR_LOOKBACK_MONTHS = 6
const QUANTITY_EXACT_BONUS = 15
const QUANTITY_PARTIAL_BONUS = 5

interface SystemPurchaseLine {
  id: number
  line_number: number | null
  item_name: string | null
  specification: string | null
  quantity: number | null
}

interface SystemPurchase {
  id: number
  purchase_order_number: string | null
  sales_order_number: string | null
  vendor_id: number | null
  vendor_name: string
  items: SystemPurchaseLine[]
}

const PURCHASE_SELECT = `
  id,
  purchase_order_number,
  sales_order_number,
  vendor_id,
  vendor:vendors(vendor_name),
  items:purchase_request_items(id, line_number, item_name, specification, quantity)
` as const

function nameSimilarity(a: string, b: string): number {
  const s1 = a.toLowerCase().replace(/\s+/g, '')
  const s2 = b.toLowerCase().replace(/\s+/g, '')
  if (!s1 || !s2) return 0
  if (s1 === s2) return 100
  if (s1.includes(s2) || s2.includes(s1)) return 80
  const m = s1.length
  const n = s2.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = s1[i - 1] === s2[j - 1]
        ? dp[i - 1][j - 1]
        : Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]) + 1
    }
  }
  const maxLen = Math.max(m, n)
  return Math.round(((maxLen - dp[m][n]) / maxLen) * 100)
}

function itemMatchScore(
  ocrName: string,
  sysName: string | null,
  sysSpec: string | null,
): number {
  if (!ocrName) return 0
  const a = sysName ? nameSimilarity(ocrName, sysName) : 0
  const b = sysSpec ? nameSimilarity(ocrName, sysSpec) : 0
  return Math.max(a, b)
}

function quantityBonus(ocrQty: number | null | undefined, sysQty: number | null): number {
  if (ocrQty == null || sysQty == null) return 0
  const o = Number(ocrQty)
  const s = Number(sysQty)
  if (!Number.isFinite(o) || !Number.isFinite(s)) return 0
  if (o === s) return QUANTITY_EXACT_BONUS
  if (o <= s) return QUANTITY_PARTIAL_BONUS
  return 0
}

function toSystemPurchase(row: any): SystemPurchase {
  return {
    id: row.id,
    purchase_order_number: row.purchase_order_number || null,
    sales_order_number: row.sales_order_number || null,
    vendor_id: row.vendor_id ?? null,
    vendor_name: (row.vendor as any)?.vendor_name || '',
    items: (row.items || []) as SystemPurchaseLine[],
  }
}

async function fetchPurchasesByOrderNumbers(
  supabase: any,
  orderNumbers: string[],
): Promise<Map<string, SystemPurchase>> {
  const cache = new Map<string, SystemPurchase>()
  if (!orderNumbers.length) return cache

  const unique = Array.from(new Set(orderNumbers.filter(Boolean)))
  if (!unique.length) return cache

  const orFilter = unique
    .flatMap((n) => [`purchase_order_number.eq.${n}`, `sales_order_number.eq.${n}`])
    .join(',')

  const { data } = await supabase
    .from('purchase_requests')
    .select(PURCHASE_SELECT)
    .or(orFilter)
    .limit(unique.length * 2)

  for (const row of (data || []) as any[]) {
    const purchase = toSystemPurchase(row)
    if (purchase.purchase_order_number && unique.includes(purchase.purchase_order_number)) {
      cache.set(purchase.purchase_order_number, purchase)
    }
    if (purchase.sales_order_number && unique.includes(purchase.sales_order_number)) {
      cache.set(purchase.sales_order_number, purchase)
    }
  }

  return cache
}

async function fetchPurchasesByVendor(
  supabase: any,
  vendorId: number,
): Promise<SystemPurchase[]> {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - VENDOR_LOOKBACK_MONTHS)
  const cutoffIso = cutoff.toISOString().slice(0, 10)

  const { data } = await supabase
    .from('purchase_requests')
    .select(PURCHASE_SELECT)
    .eq('vendor_id', vendorId)
    .gte('request_date', cutoffIso)
    .limit(200)

  return ((data || []) as any[]).map(toSystemPurchase)
}

function pickBestLineWithinPurchase(
  item: MatchInputItem,
  purchase: SystemPurchase,
): { line: SystemPurchaseLine; score: number } | null {
  const ocrName = (item.item_name || item.specification || '').trim()
  if (!ocrName) return null

  let best: { line: SystemPurchaseLine; score: number } | null = null
  for (const line of purchase.items) {
    const score = itemMatchScore(ocrName, line.item_name, line.specification)
      + quantityBonus(item.quantity ?? null, line.quantity)
    if (!best || score > best.score) best = { line, score }
  }
  return best
}

async function resolveVendorHint(
  supabase: any,
  extractedVendorName: string | null | undefined,
  layer1Results: MatchOutput[],
  purchaseCache: Map<string, SystemPurchase>,
): Promise<{ vendor_id: number; vendor_name: string } | null> {
  // 1) extractedVendorName 이 vendors 테이블과 충분히 유사하면 그것을 신뢰
  if (extractedVendorName) {
    const { data: vendors } = await supabase
      .from('vendors')
      .select('id, vendor_name, vendor_alias')
      .limit(500)

    if (vendors) {
      let best: { id: number; name: string; sim: number } | null = null
      for (const v of vendors as Array<{ id: number; vendor_name: string; vendor_alias?: string | null }>) {
        let sim = calculateVendorSimilarity(extractedVendorName, v.vendor_name)
        if (v.vendor_alias) {
          sim = Math.max(sim, calculateVendorSimilarity(extractedVendorName, v.vendor_alias))
        }
        if (!best || sim > best.sim) best = { id: v.id, name: v.vendor_name, sim }
      }
      if (best && best.sim >= VENDOR_NAME_CONFIDENT_THRESHOLD) {
        return { vendor_id: best.id, vendor_name: best.name }
      }
    }
  }

  // 2) Layer 1 매칭 결과의 다수결 vendor 사용
  const tally = new Map<number, { name: string; count: number }>()
  for (const r of layer1Results) {
    if (!r.matchedPurchaseId) continue
    const purchase = Array.from(purchaseCache.values()).find((p) => p.id === r.matchedPurchaseId)
    if (!purchase || purchase.vendor_id == null) continue
    const entry = tally.get(purchase.vendor_id)
    if (entry) entry.count += 1
    else tally.set(purchase.vendor_id, { name: purchase.vendor_name, count: 1 })
  }
  if (tally.size > 0) {
    const top = Array.from(tally.entries()).sort((a, b) => b[1].count - a[1].count)[0]
    return { vendor_id: top[0], vendor_name: top[1].name }
  }

  return null
}

/**
 * 거래명세서 라인 배열을 시스템 발주에 매칭한다.
 * vendor 게이트 없음 — PO 가 일치하면 거래처가 다르더라도 매칭한다.
 */
export async function matchTransactionItems(
  supabase: any,
  items: MatchInputItem[],
  context: MatchContext = {},
): Promise<MatchOutput[]> {
  const headerPo = normalizeOrderNumber(context.headerPoNumber || '')

  // 라인별 effective PO 결정 (라인 PO 우선, 없으면 헤더 PO)
  const effectivePoByLine = new Map<number, string>()
  const uniquePos = new Set<string>()
  for (const item of items) {
    const linePo = normalizeOrderNumber(item.po_number || '')
    const effective = linePo || headerPo
    if (effective) {
      effectivePoByLine.set(item.line_number, effective)
      uniquePos.add(effective)
    }
  }

  const purchaseCache = await fetchPurchasesByOrderNumbers(supabase, Array.from(uniquePos))

  const results: MatchOutput[] = []

  // Layer 1: PO 기반 매칭
  for (const item of items) {
    const po = effectivePoByLine.get(item.line_number)
    if (!po) {
      results.push({
        lineNumber: item.line_number,
        matchedPurchaseId: null,
        matchedItemId: null,
        matchedVendorName: null,
        matchMethod: null,
      })
      continue
    }

    const purchase = purchaseCache.get(po)
    if (!purchase) {
      results.push({
        lineNumber: item.line_number,
        matchedPurchaseId: null,
        matchedItemId: null,
        matchedVendorName: null,
        matchMethod: null,
      })
      continue
    }

    // 1a) 명시적 라인번호 일치
    if (item.po_line_number != null) {
      const exact = purchase.items.find((i) => i.line_number === item.po_line_number)
      if (exact) {
        results.push({
          lineNumber: item.line_number,
          matchedPurchaseId: purchase.id,
          matchedItemId: exact.id,
          matchedVendorName: purchase.vendor_name,
          matchMethod: 'po_number',
          matchStage: 'po_line',
        })
        continue
      }
    }

    // 1b) PO 안에서 점수 기반 라인 매칭
    const best = pickBestLineWithinPurchase(item, purchase)
    if (best && best.score >= ITEM_MATCH_THRESHOLD_IN_PO) {
      results.push({
        lineNumber: item.line_number,
        matchedPurchaseId: purchase.id,
        matchedItemId: best.line.id,
        matchedVendorName: purchase.vendor_name,
        matchMethod: 'po_number',
        matchStage: 'po_score',
        score: best.score,
      })
    } else {
      // PO 만 잡고 라인은 사용자 결정
      results.push({
        lineNumber: item.line_number,
        matchedPurchaseId: purchase.id,
        matchedItemId: null,
        matchedVendorName: purchase.vendor_name,
        matchMethod: 'po_number',
        matchStage: 'po_only',
      })
    }
  }

  // Layer 2: PO 매칭 실패한 라인에 대해 vendor-scoped fallback
  const unmatched = results.filter((r) => r.matchedPurchaseId === null)
  if (unmatched.length === 0) return results

  const vendorHint = await resolveVendorHint(
    supabase,
    context.extractedVendorName,
    results,
    purchaseCache,
  )
  if (!vendorHint) return results

  const vendorPurchases = await fetchPurchasesByVendor(supabase, vendorHint.vendor_id)
  if (vendorPurchases.length === 0) return results

  const vendorCandidates: { purchase: SystemPurchase; line: SystemPurchaseLine }[] = []
  for (const p of vendorPurchases) {
    for (const line of p.items) vendorCandidates.push({ purchase: p, line })
  }
  if (vendorCandidates.length === 0) return results

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.matchedPurchaseId !== null) continue

    const item = items.find((it) => it.line_number === r.lineNumber)
    if (!item) continue
    const ocrName = (item.item_name || item.specification || '').trim()
    if (!ocrName) continue

    let bestEntry: { purchase: SystemPurchase; line: SystemPurchaseLine; score: number } | null = null
    for (const cand of vendorCandidates) {
      const score = itemMatchScore(ocrName, cand.line.item_name, cand.line.specification)
        + quantityBonus(item.quantity ?? null, cand.line.quantity)
      if (!bestEntry || score > bestEntry.score) {
        bestEntry = { ...cand, score }
      }
    }

    if (bestEntry && bestEntry.score >= VENDOR_SCOPED_THRESHOLD) {
      results[i] = {
        lineNumber: r.lineNumber,
        matchedPurchaseId: bestEntry.purchase.id,
        matchedItemId: bestEntry.line.id,
        matchedVendorName: bestEntry.purchase.vendor_name || vendorHint.vendor_name,
        matchMethod: 'item_similarity',
        matchStage: 'vendor_scoped',
        score: bestEntry.score,
      }
    }
  }

  return results
}
