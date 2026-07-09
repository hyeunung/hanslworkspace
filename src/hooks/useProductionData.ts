import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { productionService, ProductionPcb, ProductionCable } from '@/services/productionService'
import { vendorService } from '@/services/vendorService'
import { toast } from 'sonner'

export interface Employee {
  id: string
  name: string
  email: string
}

// ─── 제작현황 데이터 계층 훅 ─────────────────────────────────────────
// PCB/Cable 목록 로드 + 직원/업체 참조 데이터 + Supabase 실시간 구독.
// ProductionListMain.tsx에서 분리 — 동작 동일.
export function useProductionData() {
  const [pcbs, setPcbs] = useState<ProductionPcb[]>([])
  const [cables, setCables] = useState<ProductionCable[]>([])
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [vendors, setVendors] = useState<any[]>([])

  // 데이터 로드
  // 동시에 여러 loadData가 날아갈 때, 늦게 도착한 이전 요청 응답이 최신 데이터를 덮어쓰는 것을 방지
  const loadSeqRef = useRef(0)

  const loadData = async () => {
    const seq = ++loadSeqRef.current
    setLoading(true)

    // 전체 로드 — 년/월은 클라이언트 표시 필터(matchDateFilter)로 처리한다.
    // 날짜범위를 서버에서 자르면 request_date가 NULL인 행이 영영 안 보이는 문제도 있었음.
    try {
      const pcbData = await productionService.getProductionPcbs()
      const cableData = await productionService.getProductionCables()
      if (seq !== loadSeqRef.current) return // 더 최신 요청이 있으면 이 응답은 버림
      setPcbs(pcbData)
      setCables(cableData)
    } catch (error) {
      if (seq !== loadSeqRef.current) return
      console.error('Failed to load production status data', error)
      toast.error('데이터 조회에 실패했습니다.')
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }

  // 직원 목록 로드
  useEffect(() => {
    const loadEmployees = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('employees').select('id, name, email').order('name')
      if (data) {
        // name에서 직함(공백 뒤의 텍스트) 제거 (예: "홍길동 사원" → "홍길동")
        const cleaned = data.map((emp: any) => ({
          ...emp,
          name: emp.name.split(/\s+/)[0] // 첫 번째 공백까지만 추출
        }))
        setEmployees(cleaned)
      }
    }
    loadEmployees()
  }, [])

  // 업체 목록 로드
  useEffect(() => {
    const loadVendors = async () => {
      const result = await vendorService.getVendors()
      if (result.success && result.data) {
        setVendors(result.data)
      }
    }
    loadVendors()
  }, [])

  // 최초 로드 (검색은 클라이언트에서 처리 — 날짜 패턴 검색 포함)
  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 실시간 구독 설정
  useEffect(() => {
    const supabase = createClient()

    const pcbChannel = supabase
      .channel('realtime-production-pcbs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_pcbs' }, () => {
        loadData()
      })
      .subscribe()

    const cableChannel = supabase
      .channel('realtime-production-cables')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_cables' }, () => {
        loadData()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(pcbChannel)
      supabase.removeChannel(cableChannel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { pcbs, cables, loading, setLoading, employees, vendors, loadData }
}
