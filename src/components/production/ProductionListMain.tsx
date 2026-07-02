import React, { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { productionService, ProductionPcb, ProductionCable } from '@/services/productionService'
import { Plus, Search, Edit2, X, Filter, Save, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { vendorService } from '@/services/vendorService'


interface Employee {
  id: string
  name: string
  email: string
}

// Date utilities for formatting text inputs (e.g. 7/6 -> 07월 06일)
const formatDbDateToDisplay = (dbDate: string | null | undefined): string => {
  if (!dbDate || dbDate.trim() === '' || dbDate === '-') return '-월 -일';
  const match = dbDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[2]}월 ${match[3]}일`;
  }
  return dbDate;
};

const formatDisplayDateToDb = (displayDate: string | null | undefined): string | null => {
  if (!displayDate || displayDate.trim() === '' || displayDate === '-') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(displayDate)) {
    return displayDate;
  }
  const match = displayDate.match(/(\d+)월\s*(\d+)일/);
  if (match) {
    const year = new Date().getFullYear();
    const mm = match[1].padStart(2, '0');
    const dd = match[2].padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }
  const numbers = displayDate.match(/\d+/g);
  if (numbers && numbers.length >= 2) {
    const year = new Date().getFullYear();
    const mm = numbers[0].padStart(2, '0');
    const dd = numbers[1].padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }
  return null;
};

const parseAndFormatInputDate = (val: string, defaultMonth?: number | null): string => {
  if (!val) return '';
  const clean = val.trim();
  if (!clean) return '';
  if (clean.includes('월') && clean.includes('일')) {
    return clean;
  }
  const numbers = clean.match(/\d+/g);
  if (!numbers || numbers.length === 0) return val;

  let month = defaultMonth || (new Date().getMonth() + 1);
  let day = 1;

  if (numbers.length >= 3) {
    if (numbers[0].length === 4) {
      month = parseInt(numbers[1], 10);
      day = parseInt(numbers[2], 10);
    } else {
      month = parseInt(numbers[0], 10);
      day = parseInt(numbers[1], 10);
    }
  } else if (numbers.length === 2) {
    month = parseInt(numbers[0], 10);
    day = parseInt(numbers[1], 10);
  } else if (numbers.length === 1) {
    day = parseInt(numbers[0], 10);
  }

  const mStr = String(Math.min(12, Math.max(1, month))).padStart(2, '0');
  const dStr = String(Math.min(31, Math.max(1, day))).padStart(2, '0');
  return `${mStr}월 ${dStr}일`;
};

export default function ProductionListMain() {
  const [pcbs, setPcbs] = useState<ProductionPcb[]>([])
  const [cables, setCables] = useState<ProductionCable[]>([])
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [addingPcbRow, setAddingPcbRow] = useState<Omit<ProductionPcb, 'id' | 'created_at' | 'updated_at'> | null>(null)
  const [addingCableRow, setAddingCableRow] = useState<Omit<ProductionCable, 'id' | 'created_at' | 'updated_at'> | null>(null)

  // 필터 및 검색 상태
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedMonth, setSelectedMonth] = useState<number | null>(() => new Date().getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const savedYear = localStorage.getItem('hansl_prod_filter_year')
    return savedYear ? Number(savedYear) : new Date().getFullYear()
  })
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i)
  const [selectedCategories, setSelectedCategories] = useState<string[]>(['LG_PCB', 'LG_Socket Board', 'LG_Cable', 'LG_Case', 'PCB', 'Cable', 'Case'])

  // 로컬스토리지에서 저장된 필터 불러오기
  useEffect(() => {
    const savedMonth = localStorage.getItem('hansl_prod_filter_month')
    const savedYear = localStorage.getItem('hansl_prod_filter_year')
    const savedCats = localStorage.getItem('hansl_prod_filter_categories')
    if (savedMonth !== null && savedMonth !== undefined && savedMonth !== '') {
      setSelectedMonth(savedMonth === 'null' ? null : Number(savedMonth))
    }
    if (savedYear !== null && savedYear !== undefined && savedYear !== '') {
      setSelectedYear(Number(savedYear))
    }
    if (savedCats) {
      try {
        const parsed = JSON.parse(savedCats) as string[]
        // 레거시 카테고리 명칭 (suffix _LG)이 있으면 prefix LG_ 형식으로 마이그레이션
        const migrated = parsed.map(cat => {
          if (cat === 'PCB_LG') return 'LG_PCB'
          if (cat === 'Socket Board_LG') return 'LG_Socket Board'
          if (cat === 'Cable_LG') return 'LG_Cable'
          if (cat === 'Case_LG') return 'LG_Case'
          return cat
        })
        setSelectedCategories(migrated)
      } catch (e) {
        console.error(e)
      }
    }
  }, [])

  const handleSaveFilters = () => {
    localStorage.setItem('hansl_prod_filter_month', String(selectedMonth))
    localStorage.setItem('hansl_prod_filter_year', String(selectedYear))
    localStorage.setItem('hansl_prod_filter_categories', JSON.stringify(selectedCategories))
    toast.success('현재 필터 설정이 저장되었습니다.')
  }

  const handleResetMonthFilter = () => {
    setSelectedMonth(null)
    setSelectedYear(new Date().getFullYear())
    toast.info('월 필터가 초기화되었습니다.')
  }

  const handleResetCategoryFilter = () => {
    setSelectedCategories(['LG_PCB', 'LG_Socket Board', 'LG_Cable', 'LG_Case', 'PCB', 'Cable', 'Case'])
    toast.info('제작구분 필터가 초기화되었습니다.')
  }

  // 컬럼 좌우 여백 (각각 6px, 총 12px)
  const COLUMN_PADDING_SIDE = 6

  // 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalType, setModalType] = useState<'pcb' | 'cable'>('pcb')
  const [modalAction, setModalAction] = useState<'add' | 'edit'>('add')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'pcb' | 'cable', id: string } | null>(null)

  // 인라인 셀 수정 상태
  const [editingCell, setEditingCell] = useState<{ id: string, type: 'pcb' | 'cable', field: string } | null>(null)
  const [editValue, setEditValue] = useState<string>('')

  // 로그인 사용자 및 직원 정보
  const { currentUserName, employee } = useAuth()

  // 업체 관리 DB 연동 상태
  const [vendors, setVendors] = useState<any[]>([])

  // 행 색상 피커 상태
  const [activeColorPicker, setActiveColorPicker] = useState<{ id: string, type: 'pcb' | 'cable' } | null>(null)

  // 드래그 선택 관련 상태 정의
  const [selectedCells, setSelectedCells] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [dragStartCell, setDragStartCell] = useState<{ id: string; field: string; type: 'pcb' | 'cable' } | null>(null)
  const [floatingMenuPos, setFloatingMenuPos] = useState<{ x: number; y: number } | null>(null)

  const pcbColumns = [
    'production_category',
    'board_name',
    'reference',
    'request_date',
    'estimate_no',
    'delivery_deadline',
    'client_name',
    'client_manager',
    'hansl_manager',
    'revision_count',
    'quantity',
    'artwork_status',
    'metal_mask',
    'changes_memo',
    'stock_count',
    'pcb_vendor',
    'delivery_schedule',
    'pcb_lead_time',
    'received_quantity',
    'received_destination',
    'parts_organization',
    'assy_hanwha',
    'assy_evertech',
    'assy_requested_date',
    'final_product_stock',
    'qa_passed',
    'qa_failed',
    'qa_notes',
    'design_review',
    'delivery_quantity',
    'delivery_date',
    'delivery_destination'
  ]

  const cableColumns = [
    'production_category',
    'board_name',
    'reference',
    'request_date',
    'estimate_no',
    'delivery_deadline',
    'client_name',
    'client_manager',
    'hansl_manager',
    'revision_count',
    'quantity',
    'spec_details',
    'cable_vendor',
    'cable_requested_date',
    'cable_actual_date',
    'delivery_notes'
  ]

  const getRowIndex = (type: 'pcb' | 'cable', id: string) => {
    const list = type === 'pcb' ? filteredPcbs : filteredCables
    return list.findIndex(item => item.id === id)
  }

  const handleCellMouseDown = (e: React.MouseEvent, id: string, field: string, type: 'pcb' | 'cable') => {
    if (e.button !== 0) return // 마우스 왼쪽 클릭만 지원
    setEditingCell(null)
    setIsDragging(true)
    setDragStartCell({ id, field, type })
    setSelectedCells([`${id}::${field}`])
    setFloatingMenuPos(null)
  }

  const handleCellMouseEnter = (id: string, field: string, type: 'pcb' | 'cable') => {
    if (!isDragging || !dragStartCell || dragStartCell.type !== type) return
    
    const cols = type === 'pcb' ? pcbColumns : cableColumns
    const startRowIdx = getRowIndex(type, dragStartCell.id)
    const endRowIdx = getRowIndex(type, id)
    const startColIdx = cols.indexOf(dragStartCell.field)
    const endColIdx = cols.indexOf(field)
    
    if (startRowIdx === -1 || endRowIdx === -1 || startColIdx === -1 || endColIdx === -1) return
    
    const minRow = Math.min(startRowIdx, endRowIdx)
    const maxRow = Math.max(startRowIdx, endRowIdx)
    const minCol = Math.min(startColIdx, endColIdx)
    const maxCol = Math.max(startColIdx, endColIdx)
    
    const list = type === 'pcb' ? filteredPcbs : filteredCables
    const newSelection: string[] = []
    
    for (let r = minRow; r <= maxRow; r++) {
      const rowId = list[r].id
      for (let c = minCol; c <= maxCol; c++) {
        newSelection.push(`${rowId}::${cols[c]}`)
      }
    }
    
    setSelectedCells(newSelection)
  }

  // 드래그 종료 마우스 리스너 및 아웃사이드 클릭 해제 처리
  useEffect(() => {
    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (isDragging) {
        setIsDragging(false)
        if (selectedCells.length > 1) {
          setFloatingMenuPos({ x: e.clientX, y: e.clientY })
        }
      }
    }

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        target.closest('.floating-bulk-picker') || 
        target.closest('.cursor-pointer') || 
        target.closest('.color-picker-trigger') || 
        target.closest('.color-picker-popover')
      ) {
        return
      }
      setSelectedCells([])
      setFloatingMenuPos(null)
    }

    window.addEventListener('mouseup', handleGlobalMouseUp)
    window.addEventListener('mousedown', handleOutsideClick)
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp)
      window.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [isDragging, selectedCells])

  // 일괄 상태 변경 핸들러
  const handleBulkUpdateCellColor = async (colorAction: string | null, isToggleStrike = false) => {
    if (selectedCells.length === 0) return
    
    const type = dragStartCell?.type || 'pcb'
    const table = type === 'pcb' ? 'production_pcbs' : 'production_cables'
    const list = type === 'pcb' ? filteredPcbs : filteredCables
    
    try {
      const supabase = createClient()
      const updatesByRow: { [rowId: string]: { [field: string]: string | null } } = {}
      
      let targetStrike: 'strike' | 'nostrike' | null = null
      if (isToggleStrike) {
        const firstCellKey = selectedCells[0]
        const [firstId, firstField] = firstCellKey.split('::')
        const firstItem = list.find(i => i.id === firstId)
        const firstCellColor = firstItem?.cell_colors?.[firstField]
        const { strike: firstStrike } = parseColorState(firstCellColor)
        const { strike: rowStrike } = parseColorState(firstItem?.row_color)
        const effectiveStrike = firstStrike || rowStrike || null
        targetStrike = effectiveStrike === 'strike' ? 'nostrike' : 'strike'
      }
      
      selectedCells.forEach(key => {
        const [rowId, field] = key.split('::')
        if (!updatesByRow[rowId]) {
          updatesByRow[rowId] = {}
        }
        updatesByRow[rowId][field] = colorAction
      })
      
      const promises = Object.entries(updatesByRow).map(async ([rowId, fields]) => {
        const rowItem = list.find(i => i.id === rowId)
        if (!rowItem) return
        
        const newCellColors = { ...(rowItem.cell_colors || {}) }
        
        Object.keys(fields).forEach(field => {
          const currentVal = newCellColors[field]
          const { color: curColor, strike: curStrike } = parseColorState(currentVal)
          
          let nextColor: string | null = curColor
          let nextStrike: 'strike' | 'nostrike' | null = curStrike
          
          if (isToggleStrike) {
            nextStrike = targetStrike
          } else if (colorAction === null) {
            nextColor = null
            nextStrike = null
          } else {
            nextColor = colorAction
          }
          
          const serialized = serializeColorState(nextColor, nextStrike)
          if (serialized === null) {
            delete newCellColors[field]
          } else {
            newCellColors[field] = serialized
          }
        })
        
        return supabase.from(table).update({ cell_colors: newCellColors }).eq('id', rowId)
      })
      
      const results = await Promise.all(promises)
      const dbError = results.find(r => r?.error)?.error
      if (dbError) throw dbError
      
      loadData()
      setSelectedCells([])
      setFloatingMenuPos(null)
      toast.success(`${selectedCells.length}개 칸의 상태가 변경되었습니다.`)
    } catch (err) {
      console.error(err)
      toast.error('일괄 상태 변경에 실패했습니다.')
    }
  }

  // 폼 필드 상태
  const [formFields, setFormFields] = useState<Record<string, any>>({
    sales_order_number: '',
    production_category: '',
    board_name: '',
    request_date: '',
    estimate_no: '',
    delivery_deadline: '',
    client_name: '',
    client_manager: '',
    hansl_manager: '',
    creator: '',
    revision_count: 1,
    quantity: 0,
    // PCB 전용
    artwork_status: '',
    metal_mask: '',
    pcb_vendor: '',
    delivery_schedule: '',
    stock_count: 0,
    changes_memo: '',
    // 케이블 전용
    spec_details: ''
  })

  // 데이터 로드
  const loadData = async () => {
    setLoading(true)
    
    // 월별 필터에 기반한 날짜 자동 계산
    let calculatedStartDate = ''
    let calculatedEndDate = ''
    const pad = (n: number) => String(n).padStart(2, '0')
    if (selectedMonth !== null) {
      calculatedStartDate = `${selectedYear}-${pad(selectedMonth)}-01`
      const lastDay = new Date(selectedYear, selectedMonth, 0).getDate()
      calculatedEndDate = `${selectedYear}-${pad(selectedMonth)}-${pad(lastDay)}`
    } else {
      calculatedStartDate = `${selectedYear}-01-01`
      calculatedEndDate = `${selectedYear}-12-31`
    }

    try {
      const pcbData = await productionService.getProductionPcbs({
        query: searchQuery,
        startDate: calculatedStartDate,
        endDate: calculatedEndDate
      })
      const cableData = await productionService.getProductionCables({
        query: searchQuery,
        startDate: calculatedStartDate,
        endDate: calculatedEndDate
      })
      setPcbs(pcbData)
      setCables(cableData)
    } catch (error) {
      console.error('Failed to load production status data', error)
      toast.error('데이터 조회에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  // 직원 목록 로드
  useEffect(() => {
    const loadEmployees = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('employees').select('id, name, email').order('name')
      if (data) setEmployees(data)
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

  // 검색/필터 변경 시 로드
  useEffect(() => {
    loadData()
  }, [searchQuery, selectedMonth, selectedYear])

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
  }, [searchQuery, selectedMonth, selectedYear])

  // 행 색상 피커 바깥 영역 클릭 시 닫기
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.color-picker-trigger') || target.closest('.color-picker-popover')) {
        return
      }
      setActiveColorPicker(null)
    }
    window.addEventListener('click', handleOutsideClick)
    return () => {
      window.removeEventListener('click', handleOutsideClick)
    }
  }, [])

  // 카테고리 필터 토글
  const toggleCategory = (cat: string) => {
    if (selectedCategories.includes(cat)) {
      setSelectedCategories(selectedCategories.filter(c => c !== cat))
    } else {
      setSelectedCategories([...selectedCategories, cat])
    }
  }

  // 행 추가 인라인 모드로 전환
  const handleAddClick = async (type: 'pcb' | 'cable') => {
    const today = new Date().toISOString().split('T')[0]
    setLoading(true)
    try {
      const nextNo = await productionService.generateNextSalesOrderNumber(today)
      const currentUserStr = currentUserName || employee?.name || ''
      if (type === 'pcb') {
        setAddingPcbRow({
          sales_order_number: nextNo,
          production_category: 'LG_PCB',
          board_name: '',
          reference: '',
          request_date: today,
          estimate_no: '',
          delivery_deadline: '',
          client_name: '',
          client_manager: '',
          hansl_manager: '',
          creator: currentUserStr,
          revision_count: 1,
          quantity: 0,
          artwork_status: '',
          metal_mask: '',
          pcb_vendor: '',
          delivery_schedule: '',
          stock_count: 0,
          changes_memo: ''
        })
        setAddingCableRow(null) // 하나만 추가 가능하게
      } else {
        setAddingCableRow({
          sales_order_number: nextNo,
          production_category: 'LG_Cable',
          board_name: '',
          reference: '',
          request_date: today,
          estimate_no: '',
          delivery_deadline: '',
          client_name: '',
          client_manager: '',
          hansl_manager: '',
          creator: currentUserStr,
          revision_count: 1,
          quantity: 0,
          spec_details: ''
        })
        setAddingPcbRow(null)
      }
    } catch (err) {
      console.error(err)
      toast.error('수주번호 자동 생성에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleSavePcbInline = async () => {
    if (!addingPcbRow) return
    if (!addingPcbRow.board_name) {
      toast.error('보드명을 입력해 주세요.')
      return
    }
    try {
      // 빈 문자열을 null로 변환하여 데이트/데시멀 컬럼 에러 방지
      const sanitized = { ...addingPcbRow } as any
      Object.keys(sanitized).forEach((key) => {
        if (sanitized[key] === '') {
          sanitized[key] = null
        }
      })
      await productionService.createProductionPcb(sanitized)
      toast.success('신규 PCB 항목이 저장되었습니다.')
      setAddingPcbRow(null)
      loadData()
    } catch (err) {
      console.error(err)
      toast.error('저장에 실패했습니다.')
    }
  }

  const handleSaveCableInline = async () => {
    if (!addingCableRow) return
    if (!addingCableRow.board_name) {
      toast.error('품명을 입력해 주세요.')
      return
    }
    try {
      // 빈 문자열을 null로 변환하여 데이트/데시멀 컬럼 에러 방지
      const sanitized = { ...addingCableRow } as any
      Object.keys(sanitized).forEach((key) => {
        if (sanitized[key] === '') {
          sanitized[key] = null
        }
      })
      await productionService.createProductionCable(sanitized)
      toast.success('신규 Cable/Case 항목이 저장되었습니다.')
      setAddingCableRow(null)
      loadData()
    } catch (err) {
      console.error(err)
      toast.error('저장에 실패했습니다.')
    }
  }

  // 인라인 셀 수정 클릭 핸들러
  const handleCellClick = (id: string, type: 'pcb' | 'cable', field: string, currentValue: any) => {
    if (selectedCells.length > 1) return
    setEditingCell({ id, type, field })
    setEditValue(currentValue === null || currentValue === undefined ? '' : String(currentValue))
  }

  // 인라인 셀 수정 저장 핸들러
  const handleCellSave = async (currentCell: { id: string, type: 'pcb' | 'cable', field: string }, val: string) => {
    const { id, type, field } = currentCell
    
    // 날짜 컬럼 보정
    let valueToSave: any = val
    if (['request_date', 'delivery_deadline', 'delivery_schedule', 'assy_requested_date', 'delivery_date', 'cable_requested_date', 'cable_actual_date'].includes(field)) {
      if (val) {
        const parsed = parseAndFormatInputDate(val, selectedMonth)
        const dbDate = formatDisplayDateToDb(parsed)
        valueToSave = dbDate || null
      } else {
        valueToSave = null
      }
    } else if (['revision_count', 'quantity', 'stock_count', 'received_quantity', 'delivery_quantity'].includes(field)) {
      valueToSave = val === '' ? 0 : Number(val)
    } else if (val === '') {
      valueToSave = null
    }

    try {
      if (type === 'pcb') {
        await productionService.updateProductionPcb(id, { [field]: valueToSave })
      } else {
        await productionService.updateProductionCable(id, { [field]: valueToSave })
      }
      loadData()
    } catch (err) {
      console.error(err)
      toast.error('수정에 실패했습니다.')
    }
  }

  // 색상 문자열 파싱 (예: 'yellow::strike' -> { color: 'yellow', strike: 'strike' | 'nostrike' | null })
  const parseColorState = (value: string | null | undefined): { color: string | null, strike: 'strike' | 'nostrike' | null } => {
    if (!value) return { color: null, strike: null };
    if (value === 'strike') return { color: null, strike: 'strike' };
    if (value === 'nostrike') return { color: null, strike: 'nostrike' };
    if (value.includes('::')) {
      const [color, strikeFlag] = value.split('::');
      return { 
        color: color || null, 
        strike: (strikeFlag === 'strike' || strikeFlag === 'nostrike') ? strikeFlag as 'strike' | 'nostrike' : null 
      };
    }
    return { color: value, strike: null };
  };

  // 색상 상태 직렬화
  const serializeColorState = (color: string | null, strike: 'strike' | 'nostrike' | null) => {
    if (!color && !strike) return null;
    if (!color && strike) return strike;
    if (color && strike) return `${color}::${strike}`;
    return color;
  };

  // 행 배경색 업데이트 핸들러
  const handleUpdateRowColor = async (type: 'pcb' | 'cable', id: string, colorAction: string | null, isToggleStrike = false) => {
    try {
      const supabase = createClient()
      const table = type === 'pcb' ? 'production_pcbs' : 'production_cables'
      const list = type === 'pcb' ? filteredPcbs : filteredCables
      const currentItem = list.find(i => i.id === id)
      if (!currentItem) return
      
      const { color: curColor, strike: curStrike } = parseColorState(currentItem.row_color)
      
      let nextColor: string | null = curColor
      let nextStrike: 'strike' | 'nostrike' | null = curStrike
      
      if (isToggleStrike) {
        nextStrike = curStrike === 'strike' ? null : 'strike'
      } else if (colorAction === null) {
        nextColor = null
        nextStrike = null
      } else {
        nextColor = colorAction
      }
      
      const serialized = serializeColorState(nextColor, nextStrike)
      const { error } = await supabase.from(table).update({ row_color: serialized }).eq('id', id)
      if (error) throw error
      
      loadData()
      setActiveColorPicker(null)
      toast.success('행 상태가 변경되었습니다.')
    } catch (err) {
      console.error(err)
      toast.error('상태 변경에 실패했습니다.')
    }
  }

  // 개별 셀 배경색 업데이트 핸들러
  const handleUpdateCellColor = async (type: 'pcb' | 'cable', id: string, field: string, colorAction: string | null, currentCellColors: any, isToggleStrike = false) => {
    try {
      const supabase = createClient()
      const table = type === 'pcb' ? 'production_pcbs' : 'production_cables'
      const newCellColors = { ...(currentCellColors || {}) }
      
      const currentVal = newCellColors[field]
      const { color: curColor, strike: curStrike } = parseColorState(currentVal)
      
      let nextColor: string | null = curColor
      let nextStrike: 'strike' | 'nostrike' | null = curStrike
      
      if (isToggleStrike) {
        const list = type === 'pcb' ? filteredPcbs : filteredCables
        const currentItem = list.find(i => i.id === id)
        const { strike: rowStrike } = parseColorState(currentItem?.row_color)
        
        const effectiveStrike = curStrike || rowStrike || null
        nextStrike = effectiveStrike === 'strike' ? 'nostrike' : 'strike'
      } else if (colorAction === null) {
        nextColor = null
        nextStrike = null
      } else {
        nextColor = colorAction
      }
      
      const serialized = serializeColorState(nextColor, nextStrike)
      if (serialized === null) {
        delete newCellColors[field]
      } else {
        newCellColors[field] = serialized
      }
      
      const { error } = await supabase.from(table).update({ cell_colors: newCellColors }).eq('id', id)
      if (error) throw error
      
      // 색상 선택 시, 입력칸에 수정 중이던 텍스트도 자동으로 함께 저장하고 수정을 완료합니다.
      await handleCellSave({ id, type, field }, editValue)
      setEditingCell(null)
      toast.success('칸 상태가 변경되었습니다.')
    } catch (err) {
      console.error(err)
      toast.error('상태 변경에 실패했습니다.')
    }
  }

  // 셀 색상에 따른 배경색 클래스 매퍼
  const getCellBgClass = (color: string | null | undefined) => {
    if (color === 'red') return 'bg-red-100'
    if (color === 'green') return 'bg-emerald-100'
    if (color === 'yellow') return 'bg-amber-100'
    if (color === 'blue') return 'bg-blue-100'
    return ''
  }

  // 행 색상에 따른 sticky 셀 배경색 클래스 매퍼
  const getStickyBgClass = (rowColor: string | null | undefined) => {
    if (!rowColor) return 'bg-white group-hover:bg-[#fafafa]'
    if (rowColor === 'red') return 'bg-red-100'
    if (rowColor === 'green') return 'bg-emerald-100'
    if (rowColor === 'yellow') return 'bg-amber-100'
    if (rowColor === 'blue') return 'bg-blue-100'
    return 'bg-white group-hover:bg-[#fafafa]'
  }

  // 카테고리 필터 매칭 데이터
  const filteredPcbs = pcbs.filter(item => selectedCategories.includes(item.production_category))
  const filteredCables = cables.filter(item => selectedCategories.includes(item.production_category))

  // 가장 긴 보드명 길이에 따른 동적 열 너비 계산 (한글 13px, 영문/숫자 7.5px 기준으로 안전하게 계산)
  const getVisualLength = (str: string): number => {
    if (!str) return 0
    let len = 0
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) > 128) {
        len += 13
      } else {
        len += 7.5
      }
    }
    return len
  }

  const getColumnTitle = (field: string): string => {
    switch (field) {
      case 'estimate_no': return '견적NO.'
      case 'delivery_deadline': return '납품기한'
      case 'client_name': return '업체'
      case 'client_manager': return '업체 담당자'
      case 'hansl_manager': return 'HANSL'
      case 'creator': return '작성자'
      case 'revision_count': return '횟수'
      case 'quantity': return '수량'
      case 'artwork_status': return 'ARTWORK'
      case 'metal_mask': return 'MetalMask'
      case 'pcb_vendor': return 'PCB업체'
      case 'delivery_schedule': return '입고(일정)'
      case 'stock_count': return '재고'
      case 'changes_memo': return '수정 또는 변경사항'
      case 'pcb_lead_time': return '제작 기간(PCB)'
      case 'received_quantity': return '입고(수량)'
      case 'received_destination': return '입고처'
      case 'production_type': return '구분'
      case 'parts_organization': return '부품정리'
      case 'assy_hanwha': return '환화'
      case 'assy_evertech': return '에버텍'
      case 'assy_requested_date': return '입고요청일'
      case 'final_product_stock': return '완제품 입고'
      case 'qa_passed': return '양품'
      case 'qa_failed': return '불량'
      case 'qa_notes': return '비고'
      case 'design_review': return '디자인리뷰'
      case 'delivery_quantity': return '수량'
      case 'delivery_date': return '일자'
      case 'delivery_destination': return '배송처'
      case 'spec_details': return '사양'
      case 'cable_vendor': return '업체'
      case 'cable_requested_date': return '입고 요청일'
      case 'cable_actual_date': return '실제 입고일'
      case 'delivery_notes': return '납품/비고'
      case 'reference': return '참고'
      default: return '내용'
    }
  }

  const getDisplayValueForField = (type: 'pcb' | 'cable', field: string, item: any): string => {
    if (!item) return '-'
    const val = item[field]
    
    // Date fields
    const dateFields = [
      'request_date', 'delivery_deadline', 'delivery_schedule',
      'assy_requested_date', 'delivery_date', 'cable_requested_date', 'cable_actual_date'
    ]
    if (dateFields.includes(field)) {
      return formatDbDateToDisplay(val)
    }
    
    if (val === null || val === undefined || val === '') return '-'
    return val.toString()
  }

  const getColumnWidth = (type: 'pcb' | 'cable', field: string, defaultWidth: number): number => {
    // 1. Title length
    const title = getColumnTitle(field)
    const titleLen = getVisualLength(title)

    // 2. Value lengths across all rows
    const list = type === 'pcb' ? filteredPcbs : filteredCables
    
    // Add addingRow's value if active
    const addingRow = type === 'pcb' ? addingPcbRow : addingCableRow
    const rows: any[] = [...list]
    if (addingRow) {
      rows.push(addingRow)
    }

    const valLengths = rows.map(item => {
      const valStr = getDisplayValueForField(type, field, item)
      return getVisualLength(valStr)
    })

    const maxValLen = valLengths.length > 0 ? Math.max(...valLengths) : 0
    const rawWidth = Math.max(titleLen, maxValLen)

    // 3. Add padding
    const padding = COLUMN_PADDING_SIDE * 2
    
    // Minimum width bounds for select/input fields to be usable when editing
    if (field === 'board_name') return Math.max(120, Math.ceil(rawWidth + padding))
    if (field === 'changes_memo') return Math.max(150, Math.ceil(rawWidth + padding))
    if (field === 'spec_details') return Math.max(180, Math.ceil(rawWidth + padding))
    if (field === 'delivery_notes') return Math.max(120, Math.ceil(rawWidth + padding))
    if (field === 'production_category') return Math.max(80, Math.ceil(rawWidth + padding))
    if (field === 'reference') return Math.max(40, Math.ceil(rawWidth + padding))
    if (field === 'request_date') return Math.max(80, Math.ceil(rawWidth + padding))

    return Math.ceil(Math.max(50, rawWidth + padding))
  }

  const getHeaderStyle = (type: 'pcb' | 'cable', field: string, defaultWidth: number): React.CSSProperties => {
    const w = getColumnWidth(type, field, defaultWidth)
    return {
      width: `${w}px`,
      minWidth: `${w}px`,
      maxWidth: `${w}px`
    }
  }

  const productionCategoryPcbWidth = getColumnWidth('pcb', 'production_category', 80)
  const productionCategoryCableWidth = getColumnWidth('cable', 'production_category', 80)
  const pcbBoardWidth = getColumnWidth('pcb', 'board_name', 150)
  const cableBoardWidth = getColumnWidth('cable', 'board_name', 150)
  const referencePcbWidth = getColumnWidth('pcb', 'reference', 150)
  const referenceCableWidth = getColumnWidth('cable', 'reference', 150)
  const requestDatePcbWidth = getColumnWidth('pcb', 'request_date', 80)
  const requestDateCableWidth = getColumnWidth('cable', 'request_date', 80)

  // 인라인 수정용 공통 렌더러 함수
  const renderEditableCell = (
    id: string,
    type: 'pcb' | 'cable',
    field: string,
    item: any,
    displayValue: any,
    cellClassName = '',
    inputType: 'text' | 'number' | 'select' = 'text',
    selectOptions: string[] = []
  ) => {
    const isEditing = editingCell?.id === id && editingCell?.type === type && editingCell?.field === field
    const cellStyle: React.CSSProperties = {}

    const activeProdCatWidth = type === 'pcb' ? productionCategoryPcbWidth : productionCategoryCableWidth
    const activeBoardWidth = type === 'pcb' ? pcbBoardWidth : cableBoardWidth
    const activeRefWidth = type === 'pcb' ? referencePcbWidth : referenceCableWidth
    const activeReqDateWidth = type === 'pcb' ? requestDatePcbWidth : requestDateCableWidth

    if (field === 'production_category') {
      cellStyle.left = '136px'
      cellStyle.width = `${activeProdCatWidth}px`
      cellStyle.minWidth = `${activeProdCatWidth}px`
      cellStyle.maxWidth = `${activeProdCatWidth}px`
    } else if (field === 'board_name') {
      cellStyle.left = `${136 + activeProdCatWidth}px`
      cellStyle.width = `${activeBoardWidth}px`
      cellStyle.minWidth = `${activeBoardWidth}px`
      cellStyle.maxWidth = `${activeBoardWidth}px`
    } else if (field === 'reference') {
      cellStyle.left = `${136 + activeProdCatWidth + activeBoardWidth}px`
      cellStyle.width = `${activeRefWidth}px`
      cellStyle.minWidth = `${activeRefWidth}px`
      cellStyle.maxWidth = `${activeRefWidth}px`
    } else if (field === 'request_date') {
      cellStyle.left = `${136 + activeProdCatWidth + activeBoardWidth + activeRefWidth}px`
      cellStyle.width = `${activeReqDateWidth}px`
      cellStyle.minWidth = `${activeReqDateWidth}px`
      cellStyle.maxWidth = `${activeReqDateWidth}px`
    } else {
      const activeWidth = getColumnWidth(type, field, 0)
      cellStyle.width = `${activeWidth}px`
      cellStyle.minWidth = `${activeWidth}px`
      cellStyle.maxWidth = `${activeWidth}px`
    }

    const renderCellColorPicker = () => {
      const cellVal = item.cell_colors?.[field];
      const { color: activeColor, strike: isCellStruck } = parseColorState(cellVal);

      return (
        <div 
          className="absolute left-0 bottom-full mb-1 bg-white border border-gray-200 rounded-md shadow-lg p-1 z-50 flex items-center gap-1"
          style={{ width: 'max-content' }}
        >
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleUpdateCellColor(type, id, field, 'yellow', item.cell_colors);
            }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 border transition-colors text-[9px] text-amber-700 font-medium shrink-0 ${activeColor === 'yellow' ? 'border-amber-500 ring-1 ring-amber-400 font-bold bg-amber-100' : 'border-amber-200 hover:bg-amber-100'}`}
            title="신규"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span>신규</span>
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleUpdateCellColor(type, id, field, 'blue', item.cell_colors);
            }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 border transition-colors text-[9px] text-blue-700 font-medium shrink-0 ${activeColor === 'blue' ? 'border-blue-500 ring-1 ring-blue-400 font-bold bg-blue-100' : 'border-blue-200 hover:bg-blue-100'}`}
            title="재발주"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            <span>재발주</span>
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleUpdateCellColor(type, id, field, 'red', item.cell_colors);
            }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-50 border transition-colors text-[9px] text-red-700 font-medium shrink-0 ${activeColor === 'red' ? 'border-red-500 ring-1 ring-red-400 font-bold bg-red-100' : 'border-red-200 hover:bg-red-100'}`}
            title="취소"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            <span>취소</span>
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleUpdateCellColor(type, id, field, null, item.cell_colors, true);
            }}
            className={`flex items-center justify-center px-1.5 py-0.5 rounded-full border transition-colors text-[9px] font-bold shrink-0 ${isCellStruck ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'}`}
            title="취소선"
          >
            -
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleUpdateCellColor(type, id, field, null, item.cell_colors);
            }}
            className="text-[9px] text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-1 py-0 bg-gray-50 hover:bg-gray-100 shrink-0 font-medium transition-colors"
            title="색상 초기화"
          >
            초기화
          </button>
        </div>
      );
    };

    if (isEditing) {
      const editCellStyle = { ...cellStyle, overflow: 'visible', zIndex: 50 }
      if (inputType === 'select') {
        return (
          <td className={`${cellClassName} p-0.5 relative`} style={editCellStyle}>
            <select
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => {
                handleCellSave({ id, type, field }, editValue)
                setEditingCell(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCellSave({ id, type, field }, editValue)
                  setEditingCell(null)
                }
                if (e.key === 'Escape') setEditingCell(null)
              }}
              className="w-full h-5 bg-white border border-gray-300 rounded px-1 py-0 text-[11px] focus:outline-none"
              style={{ appearance: 'none', WebkitAppearance: 'none', backgroundImage: "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234b5563' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 3px center', backgroundSize: '8px 8px', paddingRight: '12px' }}
            >
              {selectOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
            {renderCellColorPicker()}
          </td>
        )
      }
      
      let listId: string | undefined = undefined
      let datalistNode: React.ReactNode = null
      
      if (field === 'client_name') {
        listId = 'vendors-list'
      } else if (field === 'client_manager') {
        listId = `contacts-list-${id}`
        const parentVendorName = item.client_name || ''
        const contacts = vendors.find(v => v.vendor_name === parentVendorName)?.vendor_contacts || []
        datalistNode = (
          <datalist id={listId}>
            {contacts.map((c: any, i: number) => (
              <option key={i} value={c.contact_name} />
            ))}
          </datalist>
        )
      } else if (field === 'hansl_manager') {
        listId = 'employees-list'
      }

      return (
        <td className={`${cellClassName} p-0.5 relative`} style={editCellStyle}>
          <input
            autoFocus
            type={inputType}
            list={listId}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => {
              handleCellSave({ id, type, field }, editValue)
              setEditingCell(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleCellSave({ id, type, field }, editValue)
                setEditingCell(null)
              }
              if (e.key === 'Escape') setEditingCell(null)
            }}
            className={`w-full h-5 bg-white border border-gray-300 rounded px-1.5 py-0 text-[10px] focus:outline-none ${field === 'reference' ? 'text-red-500 font-semibold' : ''}`}
          />
          {datalistNode}
          {renderCellColorPicker()}
        </td>
      )
    }

    let computedClassName = cellClassName
    const isDateField = field.endsWith('_date') || field.endsWith('_deadline') || field.endsWith('_schedule');
    const hasValue = item[field] !== null && item[field] !== undefined && item[field] !== '';
    if (isDateField && hasValue) {
      computedClassName += ' font-semibold text-gray-900'
    }

    const cState = parseColorState(item.cell_colors?.[field]);
    const rState = parseColorState(item.row_color);
    
    // 이 셀 자체의 명시적인 하이픈(취소선) 설정이 최우선이고, 없을 시 행 전체 하이픈 설정을 상속받음
    const isStruck = cState.strike === 'strike' ? true :
                     cState.strike === 'nostrike' ? false :
                     (rState.strike === 'strike');

    if (isStruck) {
      computedClassName = computedClassName
        .replace('text-gray-900', '')
        .replace('text-gray-500', '')
        .replace('text-red-500', '')
        .replace('font-semibold', '')
        + ' line-through text-gray-400 font-normal'
    }

    if (cellClassName.includes('sticky')) {
      computedClassName = computedClassName
        .replace('bg-white', '')
        .replace('group-hover:bg-[#fafafa]', '')
        + ' ' + (cState.color ? getStickyBgClass(cState.color) : getStickyBgClass(rState.color))
    } else {
      const activeColor = cState.color || rState.color;
      if (activeColor) {
        computedClassName = computedClassName
          .replace('bg-white', '')
          .replace('group-hover:bg-gray-50/50', '')
        if (cState.color) {
          computedClassName += ' ' + getCellBgClass(cState.color)
        }
      }
    }

    const isSelected = selectedCells.includes(`${id}::${field}`);
    const selectStyle: React.CSSProperties = isSelected ? {
      outline: '1.5px solid #3b82f6',
      outlineOffset: '-1.5px',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      ...cellStyle
    } : cellStyle;

    return (
      <td 
        className={`${computedClassName} cursor-pointer ${item.row_color || item.cell_colors?.[field] ? '' : 'hover:bg-gray-100/50'} transition-colors select-none`}
        style={selectStyle}
        onMouseDown={(e) => handleCellMouseDown(e, id, field, type)}
        onMouseEnter={() => handleCellMouseEnter(id, field, type)}
        onClick={() => handleCellClick(id, type, field, item[field])}
        title={field === 'board_name' ? item.board_name : undefined}
      >
        {displayValue}
      </td>
    )
  }

  // 행 수정 모달 열기
  const handleEditClick = (type: 'pcb' | 'cable', item: any) => {
    setFormFields({
      sales_order_number: item.sales_order_number,
      production_category: item.production_category,
      board_name: item.board_name,
      request_date: item.request_date || '',
      estimate_no: item.estimate_no || '',
      delivery_deadline: item.delivery_deadline || '',
      client_name: item.client_name || '',
      client_manager: item.client_manager || '',
      hansl_manager: item.hansl_manager || '',
      creator: item.creator || '',
      revision_count: item.revision_count ?? 1,
      quantity: item.quantity ?? 0,
      artwork_status: item.artwork_status || '',
      metal_mask: item.metal_mask || '',
      pcb_vendor: item.pcb_vendor || '',
      delivery_schedule: item.delivery_schedule || '',
      stock_count: item.stock_count ?? 0,
      changes_memo: item.changes_memo || '',
      spec_details: item.spec_details || ''
    })
    setModalType(type)
    setModalAction('edit')
    setSelectedId(item.id)
    setIsModalOpen(true)
  }

  // 삭제 처리
  const handleDeleteClick = (type: 'pcb' | 'cable', id: string) => {
    setDeleteConfirm({ type, id })
  }

  const handleExecuteDelete = async () => {
    if (!deleteConfirm) return
    const { type, id } = deleteConfirm
    setDeleteConfirm(null)
    try {
      if (type === 'pcb') {
        await productionService.deleteProductionPcb(id)
      } else {
        await productionService.deleteProductionCable(id)
      }
      toast.success('성공적으로 삭제되었습니다.')
      loadData()
    } catch (err) {
      console.error(err)
      toast.error('삭제에 실패했습니다.')
    }
  }

  // 모달 등록/수정 제출
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formFields.board_name) {
      toast.error('보드명(품명)을 입력해 주세요.')
      return
    }

    try {
      if (modalType === 'pcb') {
        const payload: Omit<ProductionPcb, 'id' | 'created_at' | 'updated_at'> = {
          sales_order_number: formFields.sales_order_number,
          production_category: formFields.production_category || 'PCB',
          board_name: formFields.board_name,
          request_date: formFields.request_date,
          estimate_no: formFields.estimate_no || null,
          delivery_deadline: formFields.delivery_deadline || null,
          client_name: formFields.client_name || null,
          client_manager: formFields.client_manager || null,
          hansl_manager: formFields.hansl_manager || null,
          creator: formFields.creator || null,
          revision_count: Number(formFields.revision_count),
          quantity: Number(formFields.quantity),
          artwork_status: formFields.artwork_status || null,
          metal_mask: formFields.metal_mask || null,
          pcb_vendor: formFields.pcb_vendor || null,
          delivery_schedule: formFields.delivery_schedule || null,
          stock_count: Number(formFields.stock_count),
          changes_memo: formFields.changes_memo || null
        }

        if (modalAction === 'add') {
          await productionService.createProductionPcb(payload)
          toast.success('신규 PCB 항목이 추가되었습니다.')
        } else if (selectedId) {
          await productionService.updateProductionPcb(selectedId, payload)
          toast.success('PCB 항목이 수정되었습니다.')
        }
      } else {
        const payload: Omit<ProductionCable, 'id' | 'created_at' | 'updated_at'> = {
          sales_order_number: formFields.sales_order_number,
          production_category: formFields.production_category || 'Cable',
          board_name: formFields.board_name,
          request_date: formFields.request_date,
          estimate_no: formFields.estimate_no || null,
          delivery_deadline: formFields.delivery_deadline || null,
          client_name: formFields.client_name || null,
          client_manager: formFields.client_manager || null,
          hansl_manager: formFields.hansl_manager || null,
          creator: formFields.creator || null,
          revision_count: Number(formFields.revision_count),
          quantity: Number(formFields.quantity),
          spec_details: formFields.spec_details || null
        }

        if (modalAction === 'add') {
          await productionService.createProductionCable(payload)
          toast.success('신규 케이블/케이스 항목이 추가되었습니다.')
        } else if (selectedId) {
          await productionService.updateProductionCable(selectedId, payload)
          toast.success('케이블/케이스 항목이 수정되었습니다.')
        }
      }
      setIsModalOpen(false)
      loadData()
    } catch (err) {
      console.error(err)
      toast.error('저장에 실패했습니다.')
    }
  }

  // 테이블 표시 조건
  const showPcbTable = selectedCategories.includes('PCB') || selectedCategories.includes('LG_PCB') || selectedCategories.includes('LG_Socket Board')
  const showCableTable = selectedCategories.includes('Cable') || selectedCategories.includes('LG_Cable') || selectedCategories.includes('Case') || selectedCategories.includes('LG_Case')


  return (
    <div className="p-4 sm:p-5 space-y-4 bg-gray-50 min-h-screen">
      <style>{`
        .production-compact-table th, 
        .production-compact-table td {
          padding-left: ${COLUMN_PADDING_SIDE}px !important;
          padding-right: ${COLUMN_PADDING_SIDE}px !important;
        }
      `}</style>


      {/* 필터 툴바 */}
      <div className="card-professional p-3 space-y-3">
        {/* Row 1: 통합 검색창 */}
        <div className="flex items-center">
          <div className="relative w-[240px] flex-shrink-0 h-5 flex items-center">
            <Search className="w-3 h-3 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="제작번호, 보드명, 업체명 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '26px', height: '20px' }}
              className="w-full block business-radius-input border border-gray-300 bg-white text-gray-700 pr-3 text-[11px]"
            />
          </div>
        </div>

        {/* Row 2: 요청월 필터 버튼 그룹 */}
        {/* Row 2: 요청월 필터 버튼 그룹 */}
        <div className="grid grid-cols-[75px_575px_auto] items-center gap-2 pt-2 border-t border-gray-100">
          <span className="text-[10px] font-semibold text-gray-500 uppercase mr-1">
            요청월:
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              style={{ 
                width: '56px', 
                textAlign: 'center',
                WebkitAppearance: 'none',
                MozAppearance: 'none',
                appearance: 'none',
                background: 'none'
              }}
              className="badge-stats cursor-pointer border bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 transition-all justify-center text-center px-1"
            >
              {years.map(y => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setSelectedMonth(null)}
              className={`badge-stats cursor-pointer border transition-all ${
                selectedMonth === null
                  ? 'bg-blue-500 border-blue-500 text-white font-bold shadow-sm hover:bg-blue-600'
                  : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              전체
            </button>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setSelectedMonth(m)}
                className={`badge-stats cursor-pointer border transition-all ${
                  selectedMonth === m
                    ? 'bg-blue-500 border-blue-500 text-white font-bold shadow-sm hover:bg-blue-600'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {m}월
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <div className="h-4 w-px bg-gray-300 mx-1.5" />
            <button
              type="button"
              onClick={handleSaveFilters}
              className="p-1 hover:bg-gray-100 rounded-md text-gray-500 hover:text-blue-600 transition-colors"
              title="필터 저장"
            >
              <Save className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleResetMonthFilter}
              className="p-1 hover:bg-gray-100 rounded-md text-gray-500 hover:text-red-600 transition-colors"
              title="초기화"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Row 3: 카테고리 필터 토글 버튼 그룹 */}
        <div className="grid grid-cols-[75px_575px_auto] items-center gap-2 pt-2 border-t border-gray-100">
          <span className="text-[10px] font-semibold text-gray-500 uppercase mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> 제작구분:
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {['LG_PCB', 'LG_Socket Board', 'LG_Cable', 'LG_Case', 'PCB', 'Cable', 'Case'].map(cat => {
              const isSelected = selectedCategories.includes(cat)
              return (
                <React.Fragment key={cat}>
                  {cat === 'PCB' && (
                    <div className="h-4 w-px bg-gray-300 mx-1.5 self-center" />
                  )}
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`badge-stats cursor-pointer border transition-all ${
                      isSelected
                        ? 'bg-blue-500 border-blue-500 text-white font-bold shadow-sm hover:bg-blue-600'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {cat}
                  </button>
                </React.Fragment>
              )
            })}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <div className="h-4 w-px bg-gray-300 mx-1.5" />
            <button
              type="button"
              onClick={handleSaveFilters}
              className="p-1 hover:bg-gray-100 rounded-md text-gray-500 hover:text-blue-600 transition-colors"
              title="필터 저장"
            >
              <Save className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleResetCategoryFilter}
              className="p-1 hover:bg-gray-100 rounded-md text-gray-500 hover:text-red-600 transition-colors"
              title="초기화"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 테이블 영역 */}
      <div className="space-y-6">
        
        {/* 테이블 1: PCB & 소켓보드 제작현황 */}
        {showPcbTable && (
          <div className="card-professional overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2">
                <span className="modal-section-title">PCB & Socket Board 제작 현황</span>
                <span className="badge-stats bg-blue-50 text-blue-700 border border-blue-200 font-bold">
                  {filteredPcbs.length}건
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleAddClick('pcb')}
                className="button-base bg-blue-500 hover:bg-blue-600 text-white flex items-center gap-1.5 h-8 px-3 business-radius-button"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="button-text text-white">행 추가</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="text-left border-separate border-spacing-0 w-max min-w-full [&_th]:border-l-0 [&_td]:border-l-0 [&_th]:border-t-0 [&_td]:border-t-0 production-compact-table table-fixed">
                <thead className="whitespace-nowrap">
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 text-center sticky left-0 bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ width: '40px', minWidth: '40px', maxWidth: '40px' }}>NO.</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky left-[40px] bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ width: '96px', minWidth: '96px', maxWidth: '96px' }}>제작 번호</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky left-[136px] bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ width: `${productionCategoryPcbWidth}px`, minWidth: `${productionCategoryPcbWidth}px`, maxWidth: `${productionCategoryPcbWidth}px` }}>제작구분</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] align-left" style={{ left: `${136 + productionCategoryPcbWidth}px`, width: `${pcbBoardWidth}px`, minWidth: `${pcbBoardWidth}px`, maxWidth: `${pcbBoardWidth}px` }}>보드명</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${136 + productionCategoryPcbWidth + pcbBoardWidth}px`, width: `${referencePcbWidth}px`, minWidth: `${referencePcbWidth}px`, maxWidth: `${referencePcbWidth}px` }}>참고</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${136 + productionCategoryPcbWidth + pcbBoardWidth + referencePcbWidth}px`, width: `${requestDatePcbWidth}px`, minWidth: `${requestDatePcbWidth}px`, maxWidth: `${requestDatePcbWidth}px` }}>요청일</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border-y border-r border-gray-200" style={getHeaderStyle('pcb', 'estimate_no', 80)}>견적NO.</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'delivery_deadline', 80)}>납품기한</th>
                    <th colSpan={3} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">PJT 담당자</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'creator', 80)}>작성자</th>
                    <th colSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">제작수량</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'artwork_status', 80)}>ARTWORK</th>
                    <th colSpan={8} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center bg-blue-50/20 font-bold">PCB 제작</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center font-bold" style={getHeaderStyle('pcb', 'parts_organization', 96)}>부품정리</th>
                    <th colSpan={3} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center font-bold">ASS'Y</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 font-bold" style={getHeaderStyle('pcb', 'final_product_stock', 80)}>완제품 입고</th>
                    <th colSpan={3} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">IN-House Checking</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'design_review', 80)}>디자인리뷰</th>
                    <th colSpan={3} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">납품</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={{ width: '56px', minWidth: '56px', maxWidth: '56px' }}>작업</th>
                  </tr>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'client_name', 80)}>업체</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'client_manager', 80)}>업체 담당자</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'hansl_manager', 80)}>HANSL</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'revision_count', 50)}>횟수</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'quantity', 60)}>수량</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'metal_mask', 80)}>MetalMask</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'changes_memo', 160)}>수정 또는 변경사항</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'stock_count', 60)}>재고</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'pcb_vendor', 80)}>PCB업체</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'delivery_schedule', 80)}>입고(일정)</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'pcb_lead_time', 80)}>제작 기간(PCB)</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'received_quantity', 60)}>입고(수량)</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'received_destination', 80)}>입고처</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'assy_hanwha', 80)}>환화</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'assy_evertech', 80)}>에버텍</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'assy_requested_date', 80)}>입고요청일</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'qa_passed', 60)}>양품</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'qa_failed', 60)}>불량</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'qa_notes', 120)}>비고</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('pcb', 'delivery_quantity', 60)}>수량</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'delivery_date', 80)}>일자</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('pcb', 'delivery_destination', 100)}>배송처</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-[10px] text-gray-500 whitespace-nowrap">
                  {addingPcbRow && (
                    <tr 
                      className="bg-[#f8fbff] adding-row"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSavePcbInline()
                        }
                      }}
                    >
                      <td className="px-2 py-1.5 text-center font-bold text-blue-600 sticky left-0 bg-[#f8fbff] z-10 w-[40px] min-w-[40px] max-w-[40px] border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]">+</td>
                      <td className="px-2 py-1.5 font-semibold text-gray-900 sticky left-[40px] bg-[#f8fbff] z-10 w-[96px] min-w-[96px] max-w-[96px] truncate border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]">{addingPcbRow.sales_order_number}</td>
                      <td className="px-1 py-1 sticky left-[136px] bg-[#f8fbff] z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ width: `${productionCategoryPcbWidth}px`, minWidth: `${productionCategoryPcbWidth}px`, maxWidth: `${productionCategoryPcbWidth}px` }}>
                        <select
                          value={addingPcbRow.production_category}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, production_category: e.target.value })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        >
                          <option value="LG_PCB">LG_PCB</option>
                          <option value="LG_Socket Board">LG_Socket Board</option>
                          <option value="PCB">PCB</option>
                        </select>
                      </td>
                      <td className="px-1 py-1 sticky bg-[#f8fbff] z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] align-left" style={{ left: `${136 + productionCategoryPcbWidth}px`, width: `${pcbBoardWidth}px`, minWidth: `${pcbBoardWidth}px`, maxWidth: `${pcbBoardWidth}px` }}>
                        <input
                          type="text"
                          value={addingPcbRow.board_name}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, board_name: e.target.value })}
                          placeholder="보드명 입력"
                          className="w-full bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[10px] focus:outline-none align-left"
                        >
                        </input>
                      </td>
                      <td className="px-1 py-1 sticky bg-[#f8fbff] z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${136 + productionCategoryPcbWidth + pcbBoardWidth}px`, width: `${referencePcbWidth}px`, minWidth: `${referencePcbWidth}px`, maxWidth: `${referencePcbWidth}px` }}>
                        <input
                          type="text"
                          value={addingPcbRow.reference || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, reference: e.target.value })}
                          placeholder="참고"
                          className="w-full bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[10px] focus:outline-none text-red-500 font-semibold"
                        />
                      </td>
                      <td className="px-1 py-1 sticky bg-[#f8fbff] z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${136 + productionCategoryPcbWidth + pcbBoardWidth + referencePcbWidth}px`, width: `${requestDatePcbWidth}px`, minWidth: `${requestDatePcbWidth}px`, maxWidth: `${requestDatePcbWidth}px` }}>
                        <input
                          type="text"
                          value={addingPcbRow.request_date ? formatDbDateToDisplay(addingPcbRow.request_date) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, request_date: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, request_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[10px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border-y border-r border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.estimate_no || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, estimate_no: e.target.value })}
                          placeholder="견적NO"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.delivery_deadline ? formatDbDateToDisplay(addingPcbRow.delivery_deadline) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_deadline: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_deadline: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          list="vendors-list"
                          value={addingPcbRow.client_name || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, client_name: e.target.value })}
                          placeholder="업체"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          list="contacts-list-adding-pcb"
                          value={addingPcbRow.client_manager || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, client_manager: e.target.value })}
                          placeholder="업체 담당자"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                        <datalist id="contacts-list-adding-pcb">
                          {(vendors.find(v => v.vendor_name === addingPcbRow.client_name)?.vendor_contacts || []).map((c: any, i: number) => (
                            <option key={i} value={c.contact_name} />
                          ))}
                        </datalist>
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          list="employees-list"
                          value={addingPcbRow.hansl_manager || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, hansl_manager: e.target.value })}
                          placeholder="HANSL 담당"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200 text-gray-500 text-center select-none font-semibold">
                        {addingPcbRow.creator || '-'}
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="number"
                          value={addingPcbRow.revision_count}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, revision_count: Number(e.target.value) })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                          min="1"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="number"
                          value={addingPcbRow.quantity}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, quantity: Number(e.target.value) })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                          min="0"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.artwork_status || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, artwork_status: e.target.value })}
                          placeholder="Artwork"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.metal_mask || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, metal_mask: e.target.value })}
                          placeholder="MetalMask"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.changes_memo || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, changes_memo: e.target.value })}
                          placeholder="변경사항"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="number"
                          value={addingPcbRow.stock_count}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, stock_count: Number(e.target.value) })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                          min="0"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.pcb_vendor || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, pcb_vendor: e.target.value })}
                          placeholder="PCB업체"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.delivery_schedule ? formatDbDateToDisplay(addingPcbRow.delivery_schedule) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_schedule: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_schedule: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.pcb_lead_time || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, pcb_lead_time: e.target.value })}
                          placeholder="제작기간"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="number"
                          value={addingPcbRow.received_quantity || 0}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, received_quantity: Number(e.target.value) })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                          min="0"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.received_destination || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, received_destination: e.target.value })}
                          placeholder="입고처"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.parts_organization || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, parts_organization: e.target.value })}
                          placeholder="부품정리"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.assy_hanwha || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, assy_hanwha: e.target.value })}
                          placeholder="환화"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.assy_evertech || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, assy_evertech: e.target.value })}
                          placeholder="에버텍"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.assy_requested_date ? formatDbDateToDisplay(addingPcbRow.assy_requested_date) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, assy_requested_date: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, assy_requested_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.final_product_stock || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, final_product_stock: e.target.value })}
                          placeholder="완제품 입고"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.qa_passed || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, qa_passed: e.target.value })}
                          placeholder="양품"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.qa_failed || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, qa_failed: e.target.value })}
                          placeholder="불량"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.qa_notes || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, qa_notes: e.target.value })}
                          placeholder="비고"
                          className="w-full bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.design_review || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, design_review: e.target.value })}
                          placeholder="디자인리뷰"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="number"
                          value={addingPcbRow.delivery_quantity || 0}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_quantity: Number(e.target.value) })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                          min="0"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.delivery_date ? formatDbDateToDisplay(addingPcbRow.delivery_date) : ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_date: e.target.value })}
                          onBlur={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingPcbRow.delivery_destination || ''}
                          onChange={(e) => setAddingPcbRow({ ...addingPcbRow, delivery_destination: e.target.value })}
                          placeholder="배송처"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 text-center border border-gray-200">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={handleSavePcbInline}
                            className="p-1 hover:bg-blue-50 rounded text-blue-600"
                            title="저장"
                          >
                            <Save className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddingPcbRow(null)}
                            className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
                            title="취소"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {filteredPcbs.length === 0 && !addingPcbRow ? (
                    <tr>
                      <td colSpan={35} className="text-center py-6 text-gray-400 border border-gray-200">검색 조건에 맞는 데이터가 없습니다.</td>
                    </tr>
                  ) : (
                    filteredPcbs.map((item, index) => {
                      const { color: rColor, strike: rStrike } = parseColorState(item.row_color)
                      const rowBgClass = rColor === 'red' ? 'bg-red-100' :
                                         rColor === 'green' ? 'bg-emerald-100' :
                                         rColor === 'yellow' ? 'bg-amber-100' :
                                         rColor === 'blue' ? 'bg-blue-100' :
                                         'hover:bg-gray-50/50'

                      return (
                        <tr key={item.id} className={`group transition-colors ${rowBgClass}`}>
                          <td 
                            className={`px-2 py-1.5 text-center text-gray-400 sticky left-0 transition-colors ${activeColorPicker?.id === item.id && activeColorPicker?.type === 'pcb' ? 'z-20' : 'z-10'} w-[40px] min-w-[40px] max-w-[40px] border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] cursor-pointer relative color-picker-trigger ${getStickyBgClass(rColor)} ${rStrike ? 'line-through text-gray-400/80 font-normal' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              e.nativeEvent.stopPropagation()
                              setActiveColorPicker(activeColorPicker?.id === item.id && activeColorPicker?.type === 'pcb' ? null : { id: item.id, type: 'pcb' })
                            }}
                          >
                            {index + 1}
                            {activeColorPicker?.id === item.id && activeColorPicker?.type === 'pcb' && (
                              <div className="absolute left-[38px] top-1/2 -translate-y-1/2 bg-white border border-gray-200 rounded-md shadow-lg p-1.5 z-50 flex items-center gap-1.5 color-picker-popover">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('pcb', item.id, 'yellow'); }}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors text-[10px] text-amber-700 font-medium shrink-0"
                                  title="신규"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                  <span>신규</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('pcb', item.id, 'blue'); }}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors text-[10px] text-blue-700 font-medium shrink-0"
                                  title="재발주"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                  <span>재발주</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('pcb', item.id, 'red'); }}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-50 border border-red-200 hover:bg-red-100 transition-colors text-[10px] text-red-700 font-medium shrink-0"
                                  title="취소"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                  <span>취소</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('pcb', item.id, null, true); }}
                                  className="flex items-center justify-center px-2 py-0.5 rounded-full border border-gray-300 hover:bg-gray-100 transition-colors text-[10px] text-gray-600 font-bold shrink-0 bg-white"
                                  title="취소선"
                                >
                                  -
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('pcb', item.id, null); }}
                                  className="text-[10px] text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-1.5 py-0.5 bg-gray-50 hover:bg-gray-100 shrink-0 font-medium transition-colors"
                                  title="색상 초기화"
                                >
                                  초기화
                                </button>
                              </div>
                            )}
                          </td>
                          <td className={`px-2 py-1.5 font-semibold text-gray-900 sticky left-[40px] transition-colors z-10 w-[96px] min-w-[96px] max-w-[96px] truncate border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] ${getStickyBgClass(rColor)} ${rStrike ? 'line-through text-gray-400/80 font-normal' : ''}`}>{item.sales_order_number}</td>
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'production_category',
                          item,
                          item.production_category,
                          'px-2 py-1.5 sticky left-[136px] bg-white group-hover:bg-[#fafafa] transition-colors z-10 w-[80px] min-w-[80px] max-w-[80px] border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]',
                          'select',
                          ['LG_PCB', 'LG_Socket Board', 'PCB']
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'board_name',
                          item,
                          item.board_name,
                          'px-2 py-1.5 font-medium text-gray-900 sticky bg-white group-hover:bg-[#fafafa] transition-colors z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] align-left'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'reference',
                          item,
                          item.reference || '-',
                          'px-2 py-1.5 sticky bg-white group-hover:bg-[#fafafa] transition-colors z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] text-red-500 font-semibold'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'request_date',
                          item,
                          formatDbDateToDisplay(item.request_date),
                          'px-2 py-1.5 text-gray-500 w-[80px] min-w-[80px] max-w-[80px] sticky bg-white group-hover:bg-[#fafafa] transition-colors z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'estimate_no',
                          item,
                          item.estimate_no || '-',
                          'px-2 py-1.5 text-gray-500 border-y border-r border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'delivery_deadline',
                          item,
                          formatDbDateToDisplay(item.delivery_deadline),
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'client_name',
                          item,
                          item.client_name || '-',
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'client_manager',
                          item,
                          item.client_manager || '-',
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'hansl_manager',
                          item,
                          item.hansl_manager || '-',
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        <td className="px-2 py-1.5 text-gray-500 border border-gray-200">{item.creator || '-'}</td>
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'revision_count',
                          item,
                          item.revision_count,
                          'px-2 py-1.5 text-gray-500 border border-gray-200',
                          'number'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'quantity',
                          item,
                          item.quantity,
                          'px-2 py-1.5 text-gray-500 border border-gray-200',
                          'number'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'artwork_status',
                          item,
                          item.artwork_status || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'metal_mask',
                          item,
                          item.metal_mask || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'changes_memo',
                          item,
                          item.changes_memo || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'stock_count',
                          item,
                          item.stock_count,
                          'px-2 py-1.5 text-center border border-gray-200',
                          'number'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'pcb_vendor',
                          item,
                          item.pcb_vendor || '-',
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'delivery_schedule',
                          item,
                          formatDbDateToDisplay(item.delivery_schedule),
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'pcb_lead_time',
                          item,
                          item.pcb_lead_time || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'received_quantity',
                          item,
                          item.received_quantity || 0,
                          'px-2 py-1.5 text-center border border-gray-200',
                          'number'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'received_destination',
                          item,
                          item.received_destination || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'parts_organization',
                          item,
                          item.parts_organization || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'assy_hanwha',
                          item,
                          item.assy_hanwha || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'assy_evertech',
                          item,
                          item.assy_evertech || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'assy_requested_date',
                          item,
                          formatDbDateToDisplay(item.assy_requested_date),
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'final_product_stock',
                          item,
                          item.final_product_stock || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'qa_passed',
                          item,
                          item.qa_passed || '-',
                          'px-2 py-1.5 text-center border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'qa_failed',
                          item,
                          item.qa_failed || '-',
                          'px-2 py-1.5 text-center border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'qa_notes',
                          item,
                          item.qa_notes || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'design_review',
                          item,
                          item.design_review || '-',
                          'px-2 py-1.5 text-center border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'delivery_quantity',
                          item,
                          item.delivery_quantity || 0,
                          'px-2 py-1.5 text-center border border-gray-200',
                          'number'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'delivery_date',
                          item,
                          formatDbDateToDisplay(item.delivery_date),
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'pcb',
                          'delivery_destination',
                          item,
                          item.delivery_destination || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        <td className="px-2 py-1 border border-gray-200">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteClick('pcb', item.id)
                            }}
                            className="text-red-500 hover:text-red-700 transition-colors font-medium"
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    )
                  }))
                }
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 테이블 2: 케이블 & 케이스 제작현황 */}
        {showCableTable && (
          <div className="card-professional overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2">
                <span className="modal-section-title">Cable & Case 제작 현황</span>
                <span className="badge-stats bg-blue-50 text-blue-700 border border-blue-200 font-bold">
                  {filteredCables.length}건
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleAddClick('cable')}
                className="button-base bg-blue-500 hover:bg-blue-600 text-white flex items-center gap-1.5 h-8 px-3 business-radius-button"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="button-text text-white">행 추가</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="text-left border-separate border-spacing-0 w-max min-w-full [&_th]:border-l-0 [&_td]:border-l-0 [&_th]:border-t-0 [&_td]:border-t-0 production-compact-table table-fixed">
                <thead className="whitespace-nowrap">
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 text-center sticky left-0 bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ width: '40px', minWidth: '40px', maxWidth: '40px' }}>NO.</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky left-[40px] bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ width: '96px', minWidth: '96px', maxWidth: '96px' }}>제작 번호</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky left-[136px] bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ width: `${productionCategoryCableWidth}px`, minWidth: `${productionCategoryCableWidth}px`, maxWidth: `${productionCategoryCableWidth}px` }}>제작구분</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] align-left" style={{ left: `${136 + productionCategoryCableWidth}px`, width: `${cableBoardWidth}px`, minWidth: `${cableBoardWidth}px`, maxWidth: `${cableBoardWidth}px` }}>품명</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${136 + productionCategoryCableWidth + cableBoardWidth}px`, width: `${referenceCableWidth}px`, minWidth: `${referenceCableWidth}px`, maxWidth: `${referenceCableWidth}px` }}>참고</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 sticky bg-gray-50 z-30 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${136 + productionCategoryCableWidth + cableBoardWidth + referenceCableWidth}px`, width: `${requestDateCableWidth}px`, minWidth: `${requestDateCableWidth}px`, maxWidth: `${requestDateCableWidth}px` }}>요청일</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border-y border-r border-gray-200" style={getHeaderStyle('cable', 'estimate_no', 80)}>견적NO.</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'delivery_deadline', 80)}>납품기한</th>
                    <th colSpan={3} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">PJT 담당자</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'creator', 80)}>작성자</th>
                    <th colSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center">제작수량</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'spec_details', 250)}>사양</th>
                    <th colSpan={3} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center bg-blue-50/20 font-bold">CASE/CABLE 입고</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 font-bold" style={getHeaderStyle('cable', 'delivery_notes', 150)}>납품/비고</th>
                    <th rowSpan={2} className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={{ width: '56px', minWidth: '56px', maxWidth: '56px' }}>작업</th>
                  </tr>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'client_name', 80)}>업체</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'client_manager', 80)}>업체 담당자</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'hansl_manager', 80)}>HANSL</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('cable', 'revision_count', 50)}>횟수</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200 text-center" style={getHeaderStyle('cable', 'quantity', 60)}>수량</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'cable_vendor', 80)}>업체</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'cable_requested_date', 80)}>입고 요청일</th>
                    <th className="px-2 py-[2px] table-header-text text-gray-500 border border-gray-200" style={getHeaderStyle('cable', 'cable_actual_date', 80)}>실제 입고일</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-[10px] text-gray-700 whitespace-nowrap">
                  {addingCableRow && (
                    <tr 
                      className="bg-[#f8fbff] adding-row"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSaveCableInline()
                        }
                      }}
                    >
                      <td className="px-2 py-1.5 text-center font-bold text-blue-600 sticky left-0 bg-[#f8fbff] z-10 w-[40px] min-w-[40px] max-w-[40px] border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]">+</td>
                      <td className="px-2 py-1.5 font-semibold text-gray-900 sticky left-[40px] bg-[#f8fbff] z-10 w-[96px] min-w-[96px] max-w-[96px] truncate border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]">{addingCableRow.sales_order_number}</td>
                      <td className="px-1 py-1 sticky left-[136px] bg-[#f8fbff] z-10 w-[80px] min-w-[80px] max-w-[80px] border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]">
                        <select
                          value={addingCableRow.production_category}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, production_category: e.target.value })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        >
                          <option value="LG_Cable">LG_Cable</option>
                          <option value="LG_Case">LG_Case</option>
                          <option value="Cable">Cable</option>
                          <option value="Case">Case</option>
                        </select>
                      </td>
                      <td className="px-1 py-1 sticky bg-[#f8fbff] z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] align-left" style={{ left: '216px', width: `${cableBoardWidth}px`, minWidth: `${cableBoardWidth}px`, maxWidth: `${cableBoardWidth}px` }}>
                        <input
                          type="text"
                          value={addingCableRow.board_name}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, board_name: e.target.value })}
                          placeholder="품명 입력"
                          className="w-full bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[10px] focus:outline-none align-left"
                        />
                      </td>
                      <td className="px-1 py-1 sticky bg-[#f8fbff] z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${216 + cableBoardWidth}px`, width: `${getColumnWidth('cable', 'reference', 150)}px`, minWidth: `${getColumnWidth('cable', 'reference', 150)}px`, maxWidth: `${getColumnWidth('cable', 'reference', 150)}px` }}>
                        <input
                          type="text"
                          value={addingCableRow.reference || ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, reference: e.target.value })}
                          placeholder="참고"
                          className="w-full bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[10px] focus:outline-none text-red-500 font-semibold"
                        />
                      </td>
                      <td className="px-1 py-1 sticky bg-[#f8fbff] z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]" style={{ left: `${216 + cableBoardWidth + getColumnWidth('cable', 'reference', 150)}px`, width: '80px', minWidth: '80px', maxWidth: '80px' }}>
                        <input
                          type="text"
                          value={addingCableRow.request_date ? formatDbDateToDisplay(addingCableRow.request_date) : ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, request_date: e.target.value })}
                          onBlur={(e) => setAddingCableRow({ ...addingCableRow, request_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[10px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border-y border-r border-gray-200">
                        <input
                          type="text"
                          value={addingCableRow.estimate_no || ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, estimate_no: e.target.value })}
                          placeholder="견적NO"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingCableRow.delivery_deadline ? formatDbDateToDisplay(addingCableRow.delivery_deadline) : ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, delivery_deadline: e.target.value })}
                          onBlur={(e) => setAddingCableRow({ ...addingCableRow, delivery_deadline: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          list="vendors-list"
                          value={addingCableRow.client_name || ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, client_name: e.target.value })}
                          placeholder="업체명"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          list="contacts-list-adding-cable"
                          value={addingCableRow.client_manager || ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, client_manager: e.target.value })}
                          placeholder="업체 담당자"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                        <datalist id="contacts-list-adding-cable">
                          {(vendors.find(v => v.vendor_name === addingCableRow.client_name)?.vendor_contacts || []).map((c: any, i: number) => (
                            <option key={i} value={c.contact_name} />
                          ))}
                        </datalist>
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          list="employees-list"
                          value={addingCableRow.hansl_manager || ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, hansl_manager: e.target.value })}
                          placeholder="HANSL 담당"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200 text-gray-500 text-center select-none font-semibold">
                        {addingCableRow.creator || '-'}
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="number"
                          value={addingCableRow.revision_count}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, revision_count: Number(e.target.value) })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                          min="1"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="number"
                          value={addingCableRow.quantity}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, quantity: Number(e.target.value) })}
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none"
                          min="0"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingCableRow.spec_details || ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, spec_details: e.target.value })}
                          placeholder="상세 사양"
                          className="w-full bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingCableRow.cable_vendor || ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, cable_vendor: e.target.value })}
                          placeholder="업체"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingCableRow.cable_requested_date ? formatDbDateToDisplay(addingCableRow.cable_requested_date) : ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, cable_requested_date: e.target.value })}
                          onBlur={(e) => setAddingCableRow({ ...addingCableRow, cable_requested_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingCableRow.cable_actual_date ? formatDbDateToDisplay(addingCableRow.cable_actual_date) : ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, cable_actual_date: e.target.value })}
                          onBlur={(e) => setAddingCableRow({ ...addingCableRow, cable_actual_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
                          placeholder="예: 7/6"
                          className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <input
                          type="text"
                          value={addingCableRow.delivery_notes || ''}
                          onChange={(e) => setAddingCableRow({ ...addingCableRow, delivery_notes: e.target.value })}
                          placeholder="납품/비고"
                          className="w-full bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[11px] focus:outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 text-center border border-gray-200">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={handleSaveCableInline}
                            className="p-1 hover:bg-blue-50 rounded text-blue-600"
                            title="저장"
                          >
                            <Save className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddingCableRow(null)}
                            className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
                            title="취소"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {filteredCables.length === 0 && !addingCableRow ? (
                    <tr>
                      <td colSpan={19} className="text-center py-6 text-gray-400 border border-gray-200">검색 조건에 맞는 데이터가 없습니다.</td>
                    </tr>
                  ) : (
                    filteredCables.map((item, index) => {
                      const { color: rColor, strike: rStrike } = parseColorState(item.row_color)
                      const rowBgClass = rColor === 'red' ? 'bg-red-100' :
                                         rColor === 'green' ? 'bg-emerald-100' :
                                         rColor === 'yellow' ? 'bg-amber-100' :
                                         rColor === 'blue' ? 'bg-blue-100' :
                                         'hover:bg-gray-50/50'

                      return (
                        <tr key={item.id} className={`group transition-colors ${rowBgClass}`}>
                          <td 
                            className={`px-2 py-1.5 text-center text-gray-400 sticky left-0 transition-colors ${activeColorPicker?.id === item.id && activeColorPicker?.type === 'cable' ? 'z-20' : 'z-10'} w-[40px] min-w-[40px] max-w-[40px] border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] cursor-pointer relative color-picker-trigger ${getStickyBgClass(rColor)} ${rStrike ? 'line-through text-gray-400/80 font-normal' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              e.nativeEvent.stopPropagation()
                              setActiveColorPicker(activeColorPicker?.id === item.id && activeColorPicker?.type === 'cable' ? null : { id: item.id, type: 'cable' })
                            }}
                          >
                            {index + 1}
                            {activeColorPicker?.id === item.id && activeColorPicker?.type === 'cable' && (
                              <div className="absolute left-[38px] top-1/2 -translate-y-1/2 bg-white border border-gray-200 rounded-md shadow-lg p-1.5 z-50 flex items-center gap-1.5 color-picker-popover">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('cable', item.id, 'yellow'); }}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors text-[10px] text-amber-700 font-medium shrink-0"
                                  title="신규"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                  <span>신규</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('cable', item.id, 'blue'); }}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors text-[10px] text-blue-700 font-medium shrink-0"
                                  title="재발주"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                  <span>재발주</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('cable', item.id, 'red'); }}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-50 border border-red-200 hover:bg-red-100 transition-colors text-[10px] text-red-700 font-medium shrink-0"
                                  title="취소"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                  <span>취소</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('cable', item.id, null, true); }}
                                  className="flex items-center justify-center px-2 py-0.5 rounded-full border border-gray-300 hover:bg-gray-100 transition-colors text-[10px] text-gray-600 font-bold shrink-0 bg-white"
                                  title="취소선"
                                >
                                  -
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); handleUpdateRowColor('cable', item.id, null); }}
                                  className="text-[10px] text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-1.5 py-0.5 bg-gray-50 hover:bg-gray-100 shrink-0 font-medium transition-colors"
                                  title="색상 초기화"
                                >
                                  초기화
                                </button>
                              </div>
                            )}
                          </td>
                          <td className={`px-2 py-1.5 font-semibold text-gray-900 sticky left-[40px] transition-colors z-10 w-[96px] min-w-[96px] max-w-[96px] truncate border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] ${getStickyBgClass(rColor)} ${rStrike ? 'line-through text-gray-400/80 font-normal' : ''}`}>{item.sales_order_number}</td>
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'production_category',
                          item,
                          item.production_category,
                          'px-2 py-1.5 sticky left-[136px] bg-white group-hover:bg-[#fafafa] transition-colors z-10 w-[80px] min-w-[80px] max-w-[80px] border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]',
                          'select',
                          ['LG_Cable', 'LG_Case', 'Cable', 'Case']
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'board_name',
                          item,
                          item.board_name,
                          'px-2 py-1.5 font-medium text-gray-900 sticky bg-white group-hover:bg-[#fafafa] transition-colors z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] align-left'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'reference',
                          item,
                          item.reference || '-',
                          'px-2 py-1.5 sticky bg-white group-hover:bg-[#fafafa] transition-colors z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb] text-red-500 font-semibold'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'request_date',
                          item,
                          formatDbDateToDisplay(item.request_date),
                          'px-2 py-1.5 text-gray-500 w-[80px] min-w-[80px] max-w-[80px] sticky bg-white group-hover:bg-[#fafafa] transition-colors z-10 border-b border-gray-200 shadow-[inset_-1px_0_0_0_#e5e7eb]'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'estimate_no',
                          item,
                          item.estimate_no || '-',
                          'px-2 py-1.5 text-gray-500 border-y border-r border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'delivery_deadline',
                          item,
                          formatDbDateToDisplay(item.delivery_deadline),
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'client_name',
                          item,
                          item.client_name || '-',
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'client_manager',
                          item,
                          item.client_manager || '-',
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'hansl_manager',
                          item,
                          item.hansl_manager || '-',
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        <td className="px-2 py-1.5 text-gray-500 border border-gray-200">{item.creator || '-'}</td>
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'revision_count',
                          item,
                          item.revision_count,
                          'px-2 py-1.5 text-gray-500 border border-gray-200',
                          'number'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'quantity',
                          item,
                          item.quantity,
                          'px-2 py-1.5 text-gray-500 border border-gray-200',
                          'number'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'spec_details',
                          item,
                          item.spec_details || '-',
                          'px-2 py-1.5 text-gray-600 font-normal max-w-sm truncate whitespace-pre-line border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'cable_vendor',
                          item,
                          item.cable_vendor || '-',
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'cable_requested_date',
                          item,
                          formatDbDateToDisplay(item.cable_requested_date),
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'cable_actual_date',
                          item,
                          formatDbDateToDisplay(item.cable_actual_date),
                          'px-2 py-1.5 text-gray-500 border border-gray-200'
                        )}
                        {renderEditableCell(
                          item.id,
                          'cable',
                          'delivery_notes',
                          item,
                          item.delivery_notes || '-',
                          'px-2 py-1.5 border border-gray-200'
                        )}
                        <td className="px-2 py-1 border border-gray-200">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteClick('cable', item.id)
                            }}
                            className="text-red-500 hover:text-red-700 transition-colors font-medium"
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    )
                  }))
                }
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 등록 및 수정 모달 다이얼로그 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* 아웃사이드 백드롭 */}
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
          
          {/* 모달 박스 */}
          <div className="bg-white rounded-lg shadow-2xl border border-gray-200 w-full max-w-xl z-10 overflow-hidden animate-in fade-in zoom-in-95 duration-200 compact-modal">
            <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <span className="modal-title">
                {modalAction === 'add' ? '신규 수주 행 추가' : '수주 정보 수정'} ({modalType === 'pcb' ? 'PCB/소켓' : '케이블/케이스'})
              </span>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 hover:bg-gray-200 rounded-md text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-3.5 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                {/* 수주제작번호 (자동 생성) */}
                <div>
                  <label className="modal-label mb-1 block">제작 번호 (자동 채번)</label>
                  <input
                    type="text"
                    value={formFields.sales_order_number}
                    readOnly
                    className="h-8 bg-gray-100 border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full text-gray-500 font-semibold focus:outline-none"
                  />
                </div>

                {/* 제작 구분 */}
                <div>
                  <label className="modal-label mb-1 block">제작 구분 *</label>
                  <select
                    value={formFields.production_category}
                    onChange={(e) => setFormFields({ ...formFields, production_category: e.target.value })}
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {modalType === 'pcb' ? (
                      <>
                        <option value="PCB">PCB</option>
                        <option value="LG_PCB">LG_PCB</option>
                        <option value="LG_Socket Board">LG_Socket Board</option>
                      </>
                    ) : (
                      <>
                        <option value="Cable">Cable</option>
                        <option value="LG_Cable">LG_Cable</option>
                        <option value="Case">Case</option>
                        <option value="LG_Case">LG_Case</option>
                      </>
                    )}
                  </select>
                </div>

                {/* 보드명 / 품명 */}
                <div className="col-span-2">
                  <label className="modal-label mb-1 block">보드명 / 품목 이름 *</label>
                  <input
                    type="text"
                    value={formFields.board_name}
                    onChange={(e) => setFormFields({ ...formFields, board_name: e.target.value })}
                    placeholder="예: Inkjet Trigger Board V1.0"
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>

                {/* 요청일 */}
                <div>
                  <label className="modal-label mb-1 block">요청일 *</label>
                  <input
                    type="text"
                    value={formFields.request_date ? formatDbDateToDisplay(formFields.request_date) : ''}
                    onChange={(e) => setFormFields({ ...formFields, request_date: e.target.value })}
                    onBlur={(e) => setFormFields({ ...formFields, request_date: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
                    placeholder="예: 7/6"
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>

                {/* 견적NO */}
                <div>
                  <label className="modal-label mb-1 block">견적 번호 (견적NO.)</label>
                  <input
                    type="text"
                    value={formFields.estimate_no}
                    onChange={(e) => setFormFields({ ...formFields, estimate_no: e.target.value })}
                    placeholder="입력"
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {/* 납품기한 */}
                <div>
                  <label className="modal-label mb-1 block">납품 기한</label>
                  <input
                    type="text"
                    value={formFields.delivery_deadline ? formatDbDateToDisplay(formFields.delivery_deadline) : ''}
                    onChange={(e) => setFormFields({ ...formFields, delivery_deadline: e.target.value })}
                    onBlur={(e) => setFormFields({ ...formFields, delivery_deadline: formatDisplayDateToDb(parseAndFormatInputDate(e.target.value, selectedMonth)) || '' })}
                    placeholder="예: 7/6"
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {/* 수량 */}
                <div>
                  <label className="modal-label mb-1 block">제작 수량 *</label>
                  <input
                    type="number"
                    value={formFields.quantity}
                    onChange={(e) => setFormFields({ ...formFields, quantity: e.target.value })}
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                    min="0"
                    required
                  />
                </div>

                {/* 업체명 */}
                <div>
                  <label className="modal-label mb-1 block">발주 업체명</label>
                  <input
                    type="text"
                    value={formFields.client_name}
                    onChange={(e) => setFormFields({ ...formFields, client_name: e.target.value })}
                    placeholder="예: LG생기원, 삼성전자"
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {/* 업체 담당자 */}
                <div>
                  <label className="modal-label mb-1 block">업체 담당자 성함</label>
                  <input
                    type="text"
                    value={formFields.client_manager}
                    onChange={(e) => setFormFields({ ...formFields, client_manager: e.target.value })}
                    placeholder="예: 김선범 책임"
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {/* HANSL 담당자 */}
                <div>
                  <label className="modal-label mb-1 block">HANSL 담당자</label>
                  <select
                    value={formFields.hansl_manager}
                    onChange={(e) => setFormFields({ ...formFields, hansl_manager: e.target.value })}
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">-- 선택 --</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.name}>{emp.name}</option>
                    ))}
                  </select>
                </div>

                {/* 작성자 */}
                <div>
                  <label className="modal-label mb-1 block">작성자</label>
                  <select
                    value={formFields.creator}
                    onChange={(e) => setFormFields({ ...formFields, creator: e.target.value })}
                    className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">-- 선택 --</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.name}>{emp.name}</option>
                    ))}
                  </select>
                </div>

                {/* PCB / 소켓 전용 필드들 */}
                {modalType === 'pcb' && (
                  <>
                    <div className="border-t border-gray-200 col-span-2 pt-3 mt-1.5">
                      <span className="modal-section-title">PCB 제작 관련 상세 공정 정보</span>
                    </div>

                    <div>
                      <label className="modal-label mb-1 block">ARTWORK 상태</label>
                      <input
                        type="text"
                        value={formFields.artwork_status}
                        onChange={(e) => setFormFields({ ...formFields, artwork_status: e.target.value })}
                        placeholder="예: 강철-9"
                        className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="modal-label mb-1 block">MetalMask 상태</label>
                      <input
                        type="text"
                        value={formFields.metal_mask}
                        onChange={(e) => setFormFields({ ...formFields, metal_mask: e.target.value })}
                        placeholder="입력"
                        className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="modal-label mb-1 block">PCB 제작 업체</label>
                      <input
                        type="text"
                        value={formFields.pcb_vendor}
                        onChange={(e) => setFormFields({ ...formFields, pcb_vendor: e.target.value })}
                        placeholder="예: 우리기술"
                        className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="modal-label mb-1 block">입고 일정 (일정)</label>
                      <input
                        type="text"
                        value={formFields.delivery_schedule}
                        onChange={(e) => setFormFields({ ...formFields, delivery_schedule: e.target.value })}
                        placeholder="예: 2/26 입고 완료"
                        className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="modal-label mb-1 block">재고 수량</label>
                      <input
                        type="number"
                        value={formFields.stock_count}
                        onChange={(e) => setFormFields({ ...formFields, stock_count: e.target.value })}
                        className="h-8 bg-white border border-[#d2d2d7] rounded-md text-xs px-2 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                        min="0"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="modal-label mb-1 block">수정 또는 변경사항 (비고)</label>
                      <textarea
                        value={formFields.changes_memo}
                        onChange={(e) => setFormFields({ ...formFields, changes_memo: e.target.value })}
                        placeholder="입력"
                        rows={2}
                        className="bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 py-1.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </>
                )}

                {/* 케이블 / 케이스 전용 필드들 */}
                {modalType === 'cable' && (
                  <div className="col-span-2 border-t border-gray-200 pt-3 mt-1.5">
                    <label className="modal-label mb-1 block">사양 (상세 스펙 / 구성품 정보)</label>
                    <textarea
                      value={formFields.spec_details}
                      onChange={(e) => setFormFields({ ...formFields, spec_details: e.target.value })}
                      placeholder="예) TOP, BOTTOM 조립 구성품 목록 또는 핀 정보 기입"
                      rows={5}
                      className="bg-white border border-[#d2d2d7] rounded-md text-xs px-2.5 py-1.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500 whitespace-pre-wrap"
                    />
                  </div>
                )}
              </div>

              {/* 하단 버튼 그룹 */}
              <div className="border-t border-gray-200 pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 h-8 px-4 rounded-md"
                >
                  <span className="button-text">취소</span>
                </button>
                <button
                  type="submit"
                  className="button-base bg-blue-500 hover:bg-blue-600 text-white h-8 px-4 rounded-md"
                >
                  <span className="button-text text-white">
                    {modalAction === 'add' ? '저장 및 추가' : '수정 완료'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* 아웃사이드 백드롭 */}
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
          
          {/* 모달 박스 */}
          <div className="bg-white rounded-lg shadow-2xl border border-gray-200 w-full max-w-sm z-10 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <span className="modal-title font-bold text-red-600">수주 항목 삭제</span>
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="p-1 hover:bg-gray-200 rounded-md text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-[11px] text-gray-600 leading-relaxed text-center py-2">
                정말로 이 수주 항목을 삭제하시겠습니까?<br />
                삭제된 데이터는 완전히 유실되며 복구할 수 없습니다.
              </p>
              <div className="border-t border-gray-200 pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(null)}
                  className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 h-8 px-4 rounded-md"
                >
                  <span className="button-text">취소</span>
                </button>
                <button
                  type="button"
                  onClick={handleExecuteDelete}
                  className="button-base bg-red-500 hover:bg-red-600 text-white h-8 px-4 rounded-md"
                >
                  <span className="button-text text-white">삭제 실행</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 글로벌 검색/연동을 위한 datalist 정의 */}
      <datalist id="vendors-list">
        {vendors.map(v => (
          <option key={v.id} value={v.vendor_name} />
        ))}
      </datalist>
      <datalist id="employees-list">
        {employees.map(emp => (
          <option key={emp.id} value={emp.name} />
        ))}
      </datalist>

      {/* 드래그 선택 시 나타나는 일괄 상태 변경 플로팅 툴바 */}
      {floatingMenuPos && selectedCells.length > 1 && (
        <div 
          className="fixed bg-white border border-gray-200 rounded-md shadow-2xl p-1.5 z-[999] flex items-center gap-1.5 floating-bulk-picker animate-in fade-in slide-in-from-bottom-2 duration-150"
          style={{ 
            left: `${floatingMenuPos.x}px`, 
            top: `${floatingMenuPos.y - 42}px` 
          }}
        >
          <span className="text-[10px] font-semibold text-gray-500 px-1 border-r border-gray-100 mr-0.5 select-none">
            {selectedCells.length}개 선택됨:
          </span>
          <button
            type="button"
            onClick={() => handleBulkUpdateCellColor('yellow')}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors text-[9px] text-amber-700 font-medium shrink-0"
            title="신규"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span>신규</span>
          </button>
          <button
            type="button"
            onClick={() => handleBulkUpdateCellColor('blue')}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors text-[9px] text-blue-700 font-medium shrink-0"
            title="재발주"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            <span>재발주</span>
          </button>
          <button
            type="button"
            onClick={() => handleBulkUpdateCellColor('red')}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-50 border border-red-200 hover:bg-red-100 transition-colors text-[9px] text-red-700 font-medium shrink-0"
            title="취소"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            <span>취소</span>
          </button>
          <button
            type="button"
            onClick={() => handleBulkUpdateCellColor(null, true)}
            className="flex items-center justify-center px-2 py-0.5 rounded-full border border-gray-300 hover:bg-gray-100 transition-colors text-[9px] text-gray-600 font-bold shrink-0 bg-white"
            title="취소선 토글"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => handleBulkUpdateCellColor(null)}
            className="text-[9px] text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-1.5 py-0.5 bg-gray-50 hover:bg-gray-100 shrink-0 font-medium transition-colors"
            title="색상 및 상태 초기화"
          >
            초기화
          </button>
          <div className="h-4 w-px bg-gray-200 mx-0.5" />
          <button
            type="button"
            onClick={() => { setSelectedCells([]); setFloatingMenuPos(null); }}
            className="text-[9px] text-gray-400 hover:text-gray-600 px-1 py-0.5 rounded transition-colors"
            title="선택 해제"
          >
            닫기
          </button>
        </div>
      )}
    </div>
  )
}
