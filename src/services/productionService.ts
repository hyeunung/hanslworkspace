import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'

export interface ProductionPcb {
  id: string
  sales_order_number: string
  production_category: string // 'PCB' | 'Socket Board' | '기타'
  board_name: string
  request_date: string
  estimate_no?: string
  delivery_deadline?: string
  client_name?: string
  client_manager?: string
  hansl_manager?: string
  creator?: string
  revision_count: number
  quantity: number
  quantity_unit?: string // 수량 단위 (기본 'ea', 'set' 선택 가능)
  artwork_status?: string
  metal_mask?: string
  pcb_vendor?: string
  delivery_schedule?: string
  stock_count: number
  changes_memo?: string
  // 신규 추가 칼럼들
  pcb_lead_time?: string
  received_quantity?: number
  received_destination?: string
  production_type?: string
  parts_organization?: string
  assy_hanwha?: string
  assy_evertech?: string
  assy_requested_date?: string
  final_product_stock?: string
  qa_passed?: string
  qa_failed?: string
  qa_notes?: string
  design_review?: string
  delivery_quantity?: number
  delivery_date?: string
  delivery_destination?: string
  row_color?: string | null
  cell_colors?: Record<string, string | null> | null
  reference?: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  deleted_by?: string | null
}

export interface ProductionCable {
  id: string
  sales_order_number: string
  production_category: string // 'Cable' | 'Case' | '기타'
  board_name: string
  request_date: string
  estimate_no?: string
  delivery_deadline?: string
  client_name?: string
  client_manager?: string
  hansl_manager?: string
  creator?: string
  revision_count: number
  quantity: number
  quantity_unit?: string // 수량 단위 (기본 'ea', 'set' 선택 가능)
  spec_details?: string
  // 신규 추가 칼럼들
  cable_vendor?: string
  cable_requested_date?: string
  cable_actual_date?: string
  delivery_notes?: string
  row_color?: string | null
  cell_colors?: Record<string, string | null> | null
  reference?: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  deleted_by?: string | null
}

// PostgREST 기본 응답 한도(1000행)에 걸려 데이터가 조용히 잘리지 않도록
// 페이지 단위로 반복 조회하여 전체 행을 가져온다
const FETCH_PAGE_SIZE = 1000

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += FETCH_PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + FETCH_PAGE_SIZE - 1)
    if (error) throw error
    const page = data ?? []
    rows.push(...page)
    if (page.length < FETCH_PAGE_SIZE) break
  }
  return rows
}

export const productionService = {
  /**
   * PCB 및 소켓보드 목록 조회
   */
  async getProductionPcbs(filters?: { query?: string; startDate?: string; endDate?: string }): Promise<ProductionPcb[]> {
    const supabase = createClient()
    return fetchAllPages<ProductionPcb>((from, to) => {
      // 소프트 삭제된 행은 제외 (삭제 이력은 DB에 보존되지만 UI에는 노출하지 않는다)
      let query = supabase.from('production_pcbs').select('*').is('deleted_at', null)

      if (filters?.startDate) {
        query = query.gte('request_date', filters.startDate)
      }
      if (filters?.endDate) {
        query = query.lte('request_date', filters.endDate)
      }
      if (filters?.query) {
        const q = `%${filters.query}%`
        query = query.or(`sales_order_number.ilike.${q},board_name.ilike.${q},client_name.ilike.${q}`)
      }

      // 기본적으로 제작 번호(수주번호) 내림차순 정렬
      // 제작번호는 여러 부품이 공유해 유일하지 않으므로 id 2차 정렬로 페이지 경계를 고정한다
      return query
        .order('sales_order_number', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
    })
  },

  /**
   * 케이블 및 케이스 목록 조회
   */
  async getProductionCables(filters?: { query?: string; startDate?: string; endDate?: string }): Promise<ProductionCable[]> {
    const supabase = createClient()
    return fetchAllPages<ProductionCable>((from, to) => {
      // 소프트 삭제된 행은 제외 (삭제 이력은 DB에 보존되지만 UI에는 노출하지 않는다)
      let query = supabase.from('production_cables').select('*').is('deleted_at', null)

      if (filters?.startDate) {
        query = query.gte('request_date', filters.startDate)
      }
      if (filters?.endDate) {
        query = query.lte('request_date', filters.endDate)
      }
      if (filters?.query) {
        const q = `%${filters.query}%`
        query = query.or(`sales_order_number.ilike.${q},board_name.ilike.${q},client_name.ilike.${q}`)
      }

      // 기본적으로 제작 번호(수주번호) 내림차순 정렬
      // 제작번호는 여러 부품이 공유해 유일하지 않으므로 id 2차 정렬로 페이지 경계를 고정한다
      return query
        .order('sales_order_number', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
    })
  },

  /**
   * PCB 신규 추가
   */
  async createProductionPcb(pcb: Omit<ProductionPcb, 'id' | 'created_at' | 'updated_at'>): Promise<ProductionPcb> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('production_pcbs')
      .insert([pcb])
      .select()
      .single()

    if (error) throw error
    return data
  },

  /**
   * 케이블 신규 추가
   */
  async createProductionCable(cable: Omit<ProductionCable, 'id' | 'created_at' | 'updated_at'>): Promise<ProductionCable> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('production_cables')
      .insert([cable])
      .select()
      .single()

    if (error) throw error
    return data
  },

  /**
   * PCB 수정
   */
  async updateProductionPcb(id: string, pcb: Partial<ProductionPcb>): Promise<ProductionPcb> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('production_pcbs')
      .update({ ...pcb, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  /**
   * 케이블 수정
   */
  async updateProductionCable(id: string, cable: Partial<ProductionCable>): Promise<ProductionCable> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('production_cables')
      .update({ ...cable, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  /**
   * PCB 삭제 (소프트 삭제)
   * - 실제로 행을 지우지 않고 deleted_at/deleted_by 만 기록한다.
   * - UI 조회는 deleted_at IS NULL 만 가져오므로 화면에서는 사라지지만 DB에는 이력이 남는다.
   */
  async deleteProductionPcb(id: string): Promise<void> {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase
      .from('production_pcbs')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.email ?? user?.id ?? null })
      .eq('id', id)
      .is('deleted_at', null)
    if (error) throw error
    logger.info('제작현황 PCB 삭제(소프트)', {
      category: 'production', action: 'soft_delete',
      target_table: 'production_pcbs', target_id: id,
    })
  },

  /**
   * 케이블 삭제 (소프트 삭제)
   */
  async deleteProductionCable(id: string): Promise<void> {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase
      .from('production_cables')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.email ?? user?.id ?? null })
      .eq('id', id)
      .is('deleted_at', null)
    if (error) throw error
    logger.info('제작현황 케이블 삭제(소프트)', {
      category: 'production', action: 'soft_delete',
      target_table: 'production_cables', target_id: id,
    })
  },

  /**
   * 수주번호(제작번호) 자동 생성
   * - 포맷: HS + YYMMDD + - + 순번(2자리)
   * - 중복 생성을 원천 방지하기 위해 PCB와 케이블 테이블 모두 검색하여 고유 순번을 매깁니다.
   */
  async generateNextSalesOrderNumber(dateStr: string): Promise<string> {
    const supabase = createClient()
    
    // dateStr: '2026-07-01' -> YYMMDD로 변환 ('260701')
    const dateObj = new Date(dateStr)
    const yy = String(dateObj.getFullYear()).slice(-2)
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0')
    const dd = String(dateObj.getDate()).padStart(2, '0')
    const prefix = `HS${yy}${mm}${dd}`
    const likePattern = `${prefix}-%`

    // 두 테이블에서 오늘 날짜 패턴을 가진 수주번호 리스트 동시 조회
    const [pcbRes, cableRes] = await Promise.all([
      supabase.from('production_pcbs').select('sales_order_number').like('sales_order_number', likePattern),
      supabase.from('production_cables').select('sales_order_number').like('sales_order_number', likePattern)
    ])

    if (pcbRes.error) throw pcbRes.error
    if (cableRes.error) throw cableRes.error

    const allNumbers = [
      ...(pcbRes.data || []).map((r: any) => r.sales_order_number),
      ...(cableRes.data || []).map((r: any) => r.sales_order_number)
    ]

    let maxSeq = 0
    allNumbers.forEach(num => {
      const parts = num.split('-')
      if (parts.length === 2) {
        const seq = parseInt(parts[1], 10)
        if (!isNaN(seq) && seq > maxSeq) {
          maxSeq = seq
        }
      }
    })

    const nextSeq = String(maxSeq + 1).padStart(2, '0')
    return `${prefix}-${nextSeq}`
  }
}
