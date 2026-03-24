import { useState, useEffect, useRef } from "react";
import type { User } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Save, Package, Copy, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useNavigate } from "react-router-dom";
import { markCacheStaleAndNotify, invalidatePurchaseMemoryCache } from '@/stores/purchaseMemoryStore';
import { loadAllPurchaseData } from '@/services/purchaseDataLoader';
import { useForm as useFormRH, useFieldArray } from "react-hook-form";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FormValues, FormItem } from "@/types/purchase";
import { toast } from "sonner";
import ReactSelect from 'react-select';
import { DatePickerPopover } from '@/components/ui/date-picker-popover';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import CardUsageTab from "@/components/purchase/CardUsageTab";
import BusinessTripTab from "@/components/purchase/BusinessTripTab";
import VehicleTab from "@/components/purchase/VehicleTab";
import LeaveRequestForm from "@/components/leave/LeaveRequestForm";

interface EmployeeOption {
  value: string;
  label: string;
}

export default function PurchaseNewMain() {
  const navigate = useNavigate();
  const supabase = createClient();
  
  const [user, setUser] = useState<User | null>(null);
  const [employeeName, setEmployeeName] = useState<string>("");
  const [employees, setEmployees] = useState<{id: string; name: string; email?: string; phone?: string; address?: string; position?: string; department?: string;}[]>([]);
  const [defaultRequesterLoaded, setDefaultRequesterLoaded] = useState(false);
  const [addCount, setAddCount] = useState(1);
  const [vendorSearchTerm, setVendorSearchTerm] = useState("");
  
  // BOM 연동을 위한 상태
  const [boards, setBoards] = useState<{ id: string; board_name: string }[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<{ value: string; label: string } | null>(null);
  const [productionQuantity, setProductionQuantity] = useState<number>(100); // BOM 불러오기 시 사용할 생산 수량
  
  // 초기 사용자 정보 로드
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, []);

  // 보드 목록 로드 (BOM 연동)
  useEffect(() => {
    const loadBoards = async () => {
      const { data, error } = await supabase
        .from('cad_drawings')
        .select('id, board_name')
        .order('board_name');
      
      if (data && !error) {
        setBoards(data);
      }
    };
    loadBoards();
  }, [supabase]);

  useEffect(() => {
    // DB에서 직원 목록 가져오기
    const loadEmployees = async () => {
      try {
        const { data, error } = await supabase
          .from('employees')
          .select('id, name, email, phone, adress, position, department')
          .order('name');
        
        
        if (data && !error && data.length > 0) {
          setEmployees(data.map((dbEmp: { id: string; name: string; email?: string; phone?: string; address?: string; position?: string; department?: string }) => ({
            id: dbEmp.id,
            name: dbEmp.name,
            email: dbEmp.email || '',
            phone: dbEmp.phone || '',
            address: dbEmp.address || '',
            position: dbEmp.position || '',
            department: dbEmp.department || ''
          })));

          // 이미 설정된 employeeName이 있고 employees 배열에 해당 직원이 있는지 확인
          if (employeeName && !data.find((emp: { name: string }) => emp.name === employeeName)) {
            // 현재 사용자를 employees 배열에 추가
            const currentUser = {
              id: user?.id || 'current-user',
              name: employeeName,
              email: user?.email || '',
              phone: '',
              address: '',
              position: '',
              department: ''
            };
            setEmployees([...data.map((dbEmp: { id: string; name: string; email?: string; phone?: string; address?: string; position?: string; department?: string }) => ({
              id: dbEmp.id,
              name: dbEmp.name,
              email: dbEmp.email || '',
              phone: dbEmp.phone || '',
              address: dbEmp.address || '',
              position: dbEmp.position || '',
              department: dbEmp.department || ''
            })), currentUser]);
          }
        } else {
          // DB에서 못 불러와도 현재 사용자만이라도 추가
          if (employeeName) {
            setEmployees([{
              id: user?.id || 'current-user',
              name: employeeName,
              email: user?.email || '',
              phone: '',
              address: '',
              position: '',
              department: ''
            }]);
          } else {
            setEmployees([]);
          }
        }
      } catch (err) {
        // 오류 발생 시에도 현재 사용자 추가
        if (employeeName) {
          setEmployees([{
            id: user?.id || 'current-user',
            name: employeeName,
            email: user?.email || '',
            phone: '',
            address: '',
            position: '',
            department: ''
          }]);
        } else {
          setEmployees([]);
        }
      }
    };
    
    // user 상태와 관계없이 직원 목록 로드
    loadEmployees();
  }, [employeeName, user]);

  const [vendors, setVendors] = useState<{ id: number; vendor_name: string }[]>([]);
  const [contacts, setContacts] = useState<{ id: number; contact_name: string; contact_email: string; contact_phone: string; position: string }[]>([]);
  const [vendor, setVendor] = useState("");
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [currency, setCurrency] = useState("KRW");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [inputValues, setInputValues] = useState<{[key: string]: string}>({});
  const [isContactDialogOpen, setIsContactDialogOpen] = useState(false);
  const [contactsForEdit, setContactsForEdit] = useState<{ id?: number; contact_name: string; contact_email: string; contact_phone: string; position: string; isNew?: boolean }[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  // 중복 제출 방지용 ref
  const isSubmittingRef = useRef(false);
  
  // 전체복사 버튼 상태
  const [isCopied, setIsCopied] = useState(false);

  const { control, handleSubmit: rhHandleSubmit, watch, setValue, reset, getValues } = useFormRH<FormValues>({
    defaultValues: {
      progress_type: "",
      payment_category: "",
      currency: "KRW",
      po_template_type: "",
      request_type: "",
      contacts: [],
      sales_order_number: '',
      project_vendor: '',
      project_item: '',
      delivery_request_date: '',
      vendor_id: 0,
      requester_name: "",
      items: [
        {
          line_number: 1,
          item_name: "",
          specification: "",
          quantity: 1,
          unit_price_value: 0,
          unit_price_currency: "KRW",
          amount_value: 0,
          amount_currency: "KRW",
          remark: "",
          link: "",
        },
      ],
      request_date: new Date().toISOString().slice(0, 10),
    }
  });

  const { fields, append, remove, update, replace } = useFieldArray({
    control,
    name: "items"
  });

  // 사용자 정보로 구매요청자 기본값 설정
  useEffect(() => {
    if (!user?.email || defaultRequesterLoaded) return;
    
    const loadUserName = async () => {
      const { data: empData } = await supabase
        .from('employees')
        .select('name')
        .eq('email', user.email)
        .single();
      
      if (empData?.name) {
        setEmployeeName(empData.name);
        setValue('requester_name', empData.name);
        setDefaultRequesterLoaded(true);
      }
    };
    loadUserName();
  }, [user, supabase, setValue, defaultRequesterLoaded]);

  // 업체 목록 로드
  useEffect(() => {
    const setDefaultRequester = async () => {
      if (user?.email && setValue && !defaultRequesterLoaded) {
        try {
          const { data: employeeData, error } = await supabase
            .from('employees')
            .select('name')
            .eq('email', user.email)
            .single();
          
          if (employeeData && !error) {
            setEmployeeName(employeeData.name);
            // React Hook Form의 setValue를 약간의 지연 후 호출
            setTimeout(() => {
              setValue('requester_name', employeeData.name, { 
                shouldValidate: true,
                shouldDirty: true 
              });
            }, 100);
            setDefaultRequesterLoaded(true);
          } else {
            const fallbackName = user.email.split('@')[0] || "사용자";
            setEmployeeName(fallbackName);
            setTimeout(() => {
              setValue('requester_name', fallbackName, { 
                shouldValidate: true,
                shouldDirty: true 
              });
            }, 100);
            setDefaultRequesterLoaded(true);
          }
        } catch (err) {
          const fallbackName = user.email?.split('@')[0] || "사용자";
          setEmployeeName(fallbackName);
          setTimeout(() => {
            setValue('requester_name', fallbackName, { 
              shouldValidate: true,
              shouldDirty: true 
            });
          }, 100);
          setDefaultRequesterLoaded(true);
        }
      }
    };
    
    setDefaultRequester();
  }, [user, setValue, defaultRequesterLoaded]);

  // Vendors 로드
  useEffect(() => {
    const loadVendors = async () => {
      try {
        const { data, error } = await supabase
          .from("vendors")
          .select("*")
          .order("vendor_name");
        
        if (error) throw error;
        setVendors(data || []);
      } catch (error) {
        toast.error("업체 목록을 불러올 수 없습니다.");
      }
    };

    loadVendors();
  }, []);

  const selectedVendor = watch('vendor_id');

  // 업체 변경 시 담당자 목록 로드
  useEffect(() => {
    const loadContacts = async () => {
      if (selectedVendor) {
        try {
          const { data, error } = await supabase
            .from('vendor_contacts')
            .select('id, contact_name, contact_email, contact_phone, position')
            .eq('vendor_id', selectedVendor);
          
          if (error) throw error;
          setContacts(data || []);
        } catch (error) {
          setContacts([]);
        }
      } else {
        setContacts([]);
      }
    };
    
    loadContacts();
  }, [selectedVendor]);

  // 통화 변경시 품목들의 통화도 업데이트
  useEffect(() => {
    const items = getValues("items");
    const updatedItems = items.map(item => ({
      ...item,
      unit_price_currency: currency,
      amount_currency: currency
    }));
    setValue("items", updatedItems);
    setCurrency(currency);
  }, [currency, setValue, getValues]);

  // 수량이나 단가 변경 시 금액 자동 계산
  useEffect(() => {
    fields.forEach((item, idx) => {
      const calcAmount = Number(item.quantity) * Number(item.unit_price_value);
      if (item.amount_value !== calcAmount) {
        update(idx, { ...item, amount_value: calcAmount });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.map(f => `${f.quantity}-${f.unit_price_value}`).join(",")]);

  // 품목 추가
  const addItem = () => {
    const currentItems = getValues("items");
    const nextLineNumber = Math.max(...currentItems.map(item => item.line_number), 0) + 1;
    
    append({
      line_number: nextLineNumber,
      item_name: "",
      specification: "",
      quantity: 1,
      unit_price_value: 0,
      unit_price_currency: currency,
      amount_value: 0,
      amount_currency: currency,
      remark: "",
      link: ""
    });
  };

  // 금액 계산
  const calculateAmount = (index: number) => {
    const items = getValues("items");
    const item = items[index];
    const amount = item.quantity * item.unit_price_value;
    
    // update 함수를 사용하여 fields 배열 직접 업데이트
    update(index, { ...item, amount_value: amount });
  };

  // 엑셀 붙여넣기 핸들러
  const handlePasteFromExcel = (e: React.ClipboardEvent) => {
    // 붙여넣기 이벤트가 input 요소 내부에서 발생했다면, 해당 input의 기본 동작을 허용할 수도 있지만,
    // 여기서는 대량 붙여넣기를 위해 테이블 전체 동작으로 처리
    // 단, 단일 셀 붙여넣기(짧은 텍스트)인 경우는 제외하고 싶을 수 있으나,
    // 탭 문자가 포함되어 있거나 개행이 포함된 경우 엑셀 데이터로 간주
    
    const clipboardData = e.clipboardData.getData('text');
    if (!clipboardData) return;
    
    // 엑셀 데이터인지 확인 (탭이나 개행이 포함된 경우)
    const isExcelData = clipboardData.includes('\t') || clipboardData.includes('\n');
    if (!isExcelData) return; // 일반 텍스트 붙여넣기는 각 input의 기본 동작 따름

    e.preventDefault(); // 기본 붙여넣기 방지
    e.stopPropagation();

    try {
      // 행 분리
      const rows = clipboardData.split(/\r\n|\n|\r/).filter(row => row.trim() !== '');
      
      if (rows.length === 0) return;

      const currentItems = getValues("items");
      
      // 현재 포커스된 행 및 필드 찾기
      let startIndex = 0;
      let startFieldName = 'item_name';
      
      const activeElement = document.activeElement as HTMLInputElement;
      let targetInput: HTMLInputElement | null = null;
      
      if (activeElement && activeElement.tagName === 'INPUT') {
        targetInput = activeElement;
      } else {
        // fallback
        const targetElement = e.target as HTMLElement;
        if (targetElement) {
          let element: HTMLElement | null = targetElement;
          while (element && element.tagName !== 'INPUT') {
            element = element.parentElement;
            if (element && element.tagName === 'INPUT') {
              targetInput = element as HTMLInputElement;
              break;
            }
          }
        }
      }
      
      if (targetInput) {
        // 행 인덱스 찾기
        const rowIndexAttr = targetInput.getAttribute('data-row-index');
        if (rowIndexAttr !== null) {
          const parsedIndex = parseInt(rowIndexAttr, 10);
          if (!isNaN(parsedIndex) && parsedIndex >= 0 && parsedIndex < currentItems.length) {
            startIndex = parsedIndex;
          }
        } else {
            // data-row-index가 없으면 DOM 구조로 찾기 (fallback)
            let parent = targetInput.parentElement;
            while (parent && parent.tagName !== 'TR') {
              parent = parent.parentElement;
            }
            
            if (parent && parent.tagName === 'TR') {
              const tbody = parent.parentElement;
              if (tbody && tbody.tagName === 'TBODY') {
                const rowIndex = Array.from(tbody.children).indexOf(parent);
                if (rowIndex >= 0 && rowIndex < currentItems.length) {
                  startIndex = rowIndex;
                }
              }
            }
        }
        
        // 필드명 찾기
        const fieldNameAttr = targetInput.getAttribute('data-field-name');
        if (fieldNameAttr) {
          startFieldName = fieldNameAttr;
        }
      }

      // 필드 순서 정의 (화면상 순서와 일치해야 함)
      const FIELDS = [
        'item_name', 
        'specification', 
        'quantity', 
        'unit_price_value', 
        'amount_value', // ReadOnly (합계) - 건너뛰기용
        ...(paymentCategory === "구매 요청" ? ['link'] : []),
        'remark'
      ];
      
      const startColIndex = FIELDS.indexOf(startFieldName);
      if (startColIndex === -1) return; // 유효하지 않은 필드면 중단

      // 업데이트할 데이터 준비
      const updatedItems = [...currentItems];
      let maxRowIndex = currentItems.length - 1;

      // 붙여넣기 데이터 처리
      rows.forEach((row, rIndex) => {
        const columns = row.split('\t');
        const targetRowIndex = startIndex + rIndex;
        
        // 필요한 경우 새 행 데이터 준비
        if (targetRowIndex > maxRowIndex) {
          updatedItems.push({
            line_number: targetRowIndex + 1,
            item_name: "",
            specification: "",
            quantity: 1,
            unit_price_value: 0,
          unit_price_currency: currency,
            amount_value: 0,
          amount_currency: currency,
            remark: "",
            link: "",
          });
          maxRowIndex++;
        }
        
        // 현재 행 데이터
        const currentItem = updatedItems[targetRowIndex];
        
        // 컬럼별 데이터 매핑
        columns.forEach((colValue, cIndex) => {
          const targetColIndex = startColIndex + cIndex;
          
          // 필드 범위를 벗어나면 무시
          if (targetColIndex >= FIELDS.length) return;
          
          const fieldName = FIELDS[targetColIndex];
          const cleanValue = colValue.trim();
          
          // 합계(amount_value) 필드는 입력 불가하므로 건너뜀 (데이터가 있어도 무시)
          if (fieldName === 'amount_value') return;

          // 데이터 타입 변환 및 할당
          if (fieldName === 'quantity') {
             const qty = parseInt(cleanValue.replace(/,/g, '') || '0') || 0;
             currentItem.quantity = qty;
          } else if (fieldName === 'unit_price_value') {
             const price = parseFloat(cleanValue.replace(/,/g, '') || '0') || 0;
             currentItem.unit_price_value = price;
          } else if (fieldName === 'link') {
             currentItem.link = cleanValue;
          } else if (fieldName === 'remark') {
             currentItem.remark = cleanValue;
          } else if (fieldName === 'item_name') {
             currentItem.item_name = cleanValue;
          } else if (fieldName === 'specification') {
             currentItem.specification = cleanValue;
          }
        });
        
        // 금액 재계산 (수량 * 단가)
        currentItem.amount_value = currentItem.quantity * currentItem.unit_price_value;
        
        // 업데이트된 행 저장
        updatedItems[targetRowIndex] = currentItem;
      });
        
      // 상태 업데이트 (전체 리스트 교체 또는 개별 업데이트)
      // useFieldArray의 update를 반복 호출하면 성능 이슈가 있을 수 있으므로,
      // setValue로 전체를 업데이트하거나, 변경된 행만 update 호출
      
      // 변경된 행만 update 호출 (최적화)
      const changedRowCount = Math.min(rows.length + (updatedItems.length - currentItems.length), updatedItems.length - startIndex);
      
      // 기존 행 업데이트
      for (let i = 0; i < rows.length; i++) {
        const targetIdx = startIndex + i;
        if (targetIdx < currentItems.length) {
          update(targetIdx, updatedItems[targetIdx]);
        }
      }
      
      // 새로 추가된 행 추가 (append)
      if (updatedItems.length > currentItems.length) {
        const newRows = updatedItems.slice(currentItems.length);
        append(newRows);
      }

      toast.success(`${rows.length}개 행 데이터를 붙여넣었습니다.`);
      
    } catch (error) {
      logger.error('Excel paste error:', error);
      toast.error('엑셀 데이터 붙여넣기 중 오류가 발생했습니다.');
    }
  };

  // 보드 선택 시 품목 자동 채우기 핸들러
  const handleBoardSelect = async (selected: { value: string; label: string } | null) => {
    setSelectedBoard(selected);
    
    if (selected) {
      if (confirm(`"${selected.label}"의 BOM 데이터로 품목 목록을 덮어쓰시겠습니까?\n(기존 입력된 품목은 삭제됩니다)`)) {
        try {
          const { data: items, error } = await supabase
            .from('bom_items')
            .select('*')
            .eq('cad_drawing_id', selected.value)
            .order('line_number');
          
          if (error) throw error;
          
          if (items && items.length > 0) {
            // BOM 데이터 매핑
            const bomRows = items.map((item: { line_number: number; item_name: string; specification?: string; set_count?: number; remark?: string }) => ({
              line_number: item.line_number,
              item_name: item.item_name,
              specification: item.specification || '',
              // SET 수량 * 생산 수량 = 총 수량
              quantity: (item.set_count || 0) * productionQuantity,
              unit_price_value: 0, // 단가는 0으로 초기화
              unit_price_currency: currency,
              amount_value: 0,
              amount_currency: currency,
              remark: item.remark || '',
              link: ''
            }));
            
            // 기존 항목 전체 교체
            replace(bomRows);
            toast.success(`${items.length}개 품목을 불러왔습니다.`);
          } else {
            toast.warning('해당 보드의 BOM 데이터가 없습니다.');
          }
        } catch (error) {
          logger.error('BOM load error:', error);
          toast.error('BOM 데이터를 불러오는 중 오류가 발생했습니다.');
        }
      }
    }
  };

  // 생산수량 변경 시 자동 재계산 (선택된 보드가 있을 때만)
  const handleProductionQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQty = parseInt(e.target.value) || 0;
    setProductionQuantity(newQty);
    
    if (selectedBoard && newQty > 0) {
      // 1초 딜레이 후 재계산 (타이핑 중 빈번한 업데이트 방지)
      // 하지만 여기서는 사용자 명시적 액션이 낫으므로, 자동으로 바꾸진 않고
      // "재계산" 버튼을 두거나, 다시 보드를 선택하게 하는게 나을 수 있음.
      // 일단은 심플하게 보드가 선택된 상태에서 수량 바꾸면 다시 로드하겠냐고 물어보는건 너무 귀찮을 수 있으니
      // 수량 입력칸 옆에 [적용] 버튼을 두는게 좋겠음.
    }
  };

  // 수량 적용 버튼 핸들러
  const handleApplyQuantity = () => {
    if (!selectedBoard) {
      toast.error('먼저 보드를 선택해주세요.');
      return;
    }
    
    // 현재 리스트에 있는 항목들의 수량 업데이트
    // (단, BOM에서 가져온 항목이라는 보장이 없으므로, 다시 DB에서 가져오는게 안전)
    handleBoardSelect(selectedBoard);
  };

  // 전체 금액 계산
  const getTotalAmount = () => {
    const items = getValues("items");
    return items.reduce((sum, item) => sum + item.amount_value, 0);
  };

  // 필수 항목 체크 함수
  const checkRequiredFields = () => {
    const templateType = watch('po_template_type');
    if (!templateType) return false;
    
    if (templateType === '발주/구매') {
      const requestType = watch('request_type');
      const progressType = watch('progress_type');
      const paymentCategory = watch('payment_category');
      const vendorId = watch('vendor_id');
      return !!(requestType && progressType && paymentCategory && vendorId && vendorId !== 0 && fields.length > 0);
    }
    
    return true;
  };

  // 실시간 필수항목 체크를 위한 state
  const [isFormValid, setIsFormValid] = useState(false);

  // 필수항목 변경 감지
  useEffect(() => {
    setIsFormValid(checkRequiredFields());
  }, [watch('po_template_type'), watch('request_type'), watch('progress_type'), watch('payment_category'), watch('vendor_id'), fields]);

  // 발주요청번호 생성 함수 (재시도 로직 포함)
  const generatePurchaseOrderNumber = async () => {
    const today = new Date();
    // 한국 시간대(UTC+9) 기준으로 날짜 생성
    const koreaTime = new Date(today.getTime() + (9 * 60 * 60 * 1000));
    const dateStr = koreaTime.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    const prefix = `F${dateStr}_`;
    
    // 오늘 날짜로 시작하는 발주요청번호들 조회 (유효한 숫자 형식만)
    const { data: existingOrders, error: queryError } = await supabase
      .from('purchase_requests')
      .select('purchase_order_number')
      .like('purchase_order_number', `${prefix}%`)
      .order('purchase_order_number', { ascending: false });
    
    if (queryError) {
      logger.error('발주요청번호 조회 실패', queryError)
      throw queryError
    }
    
    // 다음 순번 계산 (숫자인 시퀀스만 찾기)
    let nextNumber = 1;
    let maxSequence = 0;
    
    if (existingOrders && existingOrders.length > 0) {
      // 모든 발주요청번호를 확인하여 가장 큰 유효한 숫자 시퀀스 찾기
      for (const order of existingOrders) {
        const orderNumber = order.purchase_order_number;
        
        // 발주요청번호 형식: F20250612_001
        const parts = orderNumber.split('_');
        if (parts.length >= 2) {
          const sequenceStr = parts[1];
          const sequence = parseInt(sequenceStr, 10);
          
          // 유효한 숫자이고 현재 최대값보다 크면 업데이트
          if (!isNaN(sequence) && sequence > maxSequence) {
            maxSequence = sequence;
          }
        }
      }
      
      nextNumber = maxSequence + 1;
    }
    
    // 3자리 패딩으로 발주요청번호 생성
    const safeNextNumber = isNaN(nextNumber) ? 1 : nextNumber;
    const purchaseOrderNumber = `${prefix}${String(safeNextNumber).padStart(3, '0')}`;
    
    return purchaseOrderNumber;
  };

  // 폼 제출
  const handleSubmit = async (data: FormValues) => {
    const currentEmployee = employees.find(emp => emp.name === data.requester_name);
    
    if (isSubmittingRef.current) {
      return;
    }

    if (!currentEmployee) {
      setError("구매요청자 이름에 해당하는 직원이 없습니다. 이름을 정확히 입력해 주세요.");
      return;
    }
    
    // 필수 항목이 모두 채워져 있는지 재확인
    if (!checkRequiredFields()) {
      return; // 버튼이 비활성화되어 있어야 하므로 별도 오류 메시지 없이 그냥 리턴
    }

    isSubmittingRef.current = true;
    setLoading(true);
    setError("");
    
    try {

      let prId: number = 0;
      let purchaseOrderNumber: string = '';
      const maxRetries = 5;
      let retryCount = 0;

      // 발주요청번호 중복 방지를 위한 재시도 로직
      while (retryCount < maxRetries) {
        try {
          // 발주요청번호 자동 생성
          purchaseOrderNumber = await generatePurchaseOrderNumber();

          // 구매요청 등록 시도
          const { data: pr, error: prError } = await supabase.from("purchase_requests").insert({
            requester_id: currentEmployee.id,
            purchase_order_number: purchaseOrderNumber,
            requester_name: data.requester_name,
            requester_phone: currentEmployee?.phone,
            requester_fax: null,
            requester_address: currentEmployee?.address,
            vendor_id: data.vendor_id,
            sales_order_number: data.sales_order_number,
            project_vendor: data.project_vendor,
            project_item: data.project_item,
            request_date: data.request_date,
            delivery_request_date: data.delivery_request_date || null,
            request_type: data.request_type,
            progress_type: data.progress_type,
            is_payment_completed: false,
            payment_category: data.payment_category,
            currency: currency,
            total_amount: fields.reduce((sum, i) => sum + i.amount_value, 0),
            unit_price_currency: fields[0]?.unit_price_currency || currency,
            po_template_type: data.po_template_type,
            contact_id: data.contact_id ? Number(data.contact_id) : null,
          }).select("id").single();
          
          // 발주요청번호 중복 에러가 아닌 다른 에러는 바로 throw
          if (prError && !prError.message.includes('duplicate key value violates unique constraint')) {
            throw prError;
          }
          
          // 발주요청번호 중복 에러인 경우
          if (prError && prError.message.includes('duplicate key value violates unique constraint')) {
            retryCount++;
            if (retryCount >= maxRetries) {
              throw new Error(`발주요청번호 생성에 ${maxRetries}번 실패했습니다. 잠시 후 다시 시도해주세요.`);
            }
            // 재시도를 위해 짧은 대기
            await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
            continue;
          }
          
          // 성공한 경우
          if (!pr) throw new Error("등록 실패");
          prId = pr.id;
          break; // 성공 시 루프 종료
          
        } catch (retryError: unknown) {
          // 발주요청번호 중복이 아닌 에러는 바로 throw
          if (!(retryError instanceof Error && retryError.message.includes('duplicate key value violates unique constraint'))) {
            throw retryError;
          }
          
          retryCount++;
          if (retryCount >= maxRetries) {
            throw new Error(`발주요청번호 생성에 ${maxRetries}번 실패했습니다. 잠시 후 다시 시도해주세요.`);
          }
          
          // 재시도를 위해 짧은 대기 (100-300ms 랜덤)
          await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
        }
      }

      // 품목들 저장 - 배열 순서 그대로 저장 (엑셀 붙여넣기 순서 유지)
      for (const [idx, item] of fields.entries()) {
        const { error: itemErr } = await supabase.from("purchase_request_items").insert({
          purchase_request_id: prId,
          line_number: idx + 1, // 배열 순서대로 1, 2, 3... 설정
          item_name: item.item_name,
          specification: item.specification,
          quantity: item.quantity,
          unit_price_value: item.unit_price_value,
          unit_price_currency: currency,
          amount_value: item.amount_value,
          amount_currency: currency,
          remark: item.remark,
          link: item.link || null,
        });
        if (itemErr) throw itemErr;
      }
      
      // 발주요청 성공 처리
      
      // 📨 중간관리자 DM 알림 발송 (품목 추가 완료 후 정확한 개수로)
      try {
        const notifyResponse = await fetch(`/api/purchase/${prId}/notify-middle-manager`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (notifyResponse.ok) {
          const notifyResult = await notifyResponse.json();
        } else {
          const errorText = await notifyResponse.text();
        }
      } catch (notifyError) {
        logger.error('중간관리자 알림 발송 실패', notifyError)
      }
      
      // 1. 폼 초기화
      reset({
        progress_type: "",
        payment_category: "",
        currency: "KRW",
        po_template_type: "",
        request_type: "",
        contacts: [],
        sales_order_number: '',
        project_vendor: '',
        project_item: '',
        delivery_request_date: '',
        vendor_id: 0,
        requester_name: employeeName, // 요청자 이름은 유지
        items: [
          {
            line_number: 1,
            item_name: "",
            specification: "",
            quantity: 1,
            unit_price_value: 0,
            unit_price_currency: "KRW",
            amount_value: 0,
            amount_currency: "KRW",
            remark: "",
            link: "",
          },
        ],
        request_date: new Date().toISOString().slice(0, 10),
      });
      
      // 2. 상태 초기화
      setVendor("");
      setSelectedContacts([]);
      setCurrency("KRW");
      setError("");
      setLoading(false);
      
      // 3. 성공 팝업 표시
      setSuccessDialogOpen(true);
      
      // 4. 메모리 캐시 무효화 및 즉시 새로고침 시도 (탭 이동 전 최신화)
      invalidatePurchaseMemoryCache() // 캐시 무효화로 다음 로드 시 새로고침
      try {
        await loadAllPurchaseData(String(currentEmployee.id))
      } catch (refreshError) {
        logger.error('새 발주 생성 후 데이터 새로고침 실패', refreshError)
      } finally {
        markCacheStaleAndNotify() // 구독자에게 캐시 변경 알림 + lastFetch 무효화
      }
      isSubmittingRef.current = false
      
      // 5. 발주요청 관리 페이지의 승인대기 탭으로 이동
      try {
        await navigate('/purchase/list?tab=pending');
      } catch (routerError) {
        // 대체 라우팅 방법
        window.location.href = '/purchase/list?tab=pending';
      }
      return;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "오류가 발생했습니다.";
      setError(errorMessage);
      toast.error(errorMessage || "발주요청서 저장에 실패했습니다.");
    } finally {
      // 오류가 있었을 때만 실행됨 (성공 시에는 return으로 빠짐)
      setLoading(false);
      isSubmittingRef.current = false;
    }
  };

  const totalAmount = fields.reduce((sum, item) => sum + item.amount_value, 0);

  const openContactsManager = () => {
    // 기존 담당자들을 복사하고 새로운 담당자 추가를 위한 빈 슬롯도 추가
    const existingContacts = contacts.map(c => ({ ...c, isNew: false }));
    const newEmptyContact = { contact_name: '', contact_email: '', contact_phone: '', position: '', isNew: true };
    setContactsForEdit([...existingContacts, newEmptyContact]);
    setHasChanges(false);
    setIsContactDialogOpen(true);
  };

  const handleContactChange = (index: number, field: string, value: string) => {
    setContactsForEdit(prev => prev.map((contact, i) => 
      i === index ? { ...contact, [field]: value } : contact
    ));
    setHasChanges(true);
  };

  const addNewContactSlot = () => {
    setContactsForEdit(prev => [...prev, { contact_name: '', contact_email: '', contact_phone: '', position: '', isNew: true }]);
    setHasChanges(true);
  };

  const removeContactSlot = (index: number) => {
    setContactsForEdit(prev => prev.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const handleSaveAllContacts = async () => {
    if (!selectedVendor) return;
    
    try {
      // @hansl로 끝나는 이메일 체크
      const hanslEmails = contactsForEdit.filter(c => c.contact_email && c.contact_email.endsWith('@hansl.io'));
      if (hanslEmails.length > 0) {
        alert('한슬 직원 이메일은 업체 담당자로 등록할 수 없습니다.');
        return;
      }

      // 삭제된 담당자 처리: 기존 contacts에 있었지만 contactsForEdit에 없는 항목들 삭제
      const editContactIds = contactsForEdit
        .filter(c => !c.isNew && c.id)
        .map(c => c.id);
      const deletedContacts = contacts.filter(c => c.id && !editContactIds.includes(c.id));
      
      const failedDeletes: string[] = [];
      for (const deleted of deletedContacts) {
        if (deleted.id) {
          const { error: deleteError } = await supabase
            .from('vendor_contacts')
            .delete()
            .eq('id', deleted.id);
          
          if (deleteError) {
            // 외래 키 제약조건 오류 (이 담당자가 발주에 연결되어 있음)
            failedDeletes.push(deleted.contact_name || `ID:${deleted.id}`);
          }
        }
      }
      
      if (failedDeletes.length > 0) {
        toast.error(`다음 담당자는 발주에 연결되어 삭제할 수 없습니다: ${failedDeletes.join(', ')}`);
      }

      // 이름만 있고 이메일이 비어있는 담당자가 있는지 체크
      const incompleteContacts = contactsForEdit.filter(c => 
        c.contact_name && c.contact_name.trim() && (!c.contact_email || !c.contact_email.trim())
      );
      if (incompleteContacts.length > 0) {
        toast.error('담당자의 이메일을 입력해주세요.');
        return;
      }

      for (const contact of contactsForEdit) {
        if (contact.contact_name && contact.contact_email) {
          if (!contact.isNew && contact.id) {
            // 기존 담당자 업데이트
            const { error: updateError } = await supabase
              .from('vendor_contacts')
              .update({
                contact_name: contact.contact_name,
                contact_email: contact.contact_email,
                contact_phone: contact.contact_phone || '',
                position: contact.position || ''
              })
              .eq('id', contact.id);
            
            if (updateError) {
              logger.error('담당자 업데이트 오류:', updateError);
            }
          } else if (contact.isNew) {
            // 새로운 담당자 추가
            const { error: insertError } = await supabase
              .from('vendor_contacts')
              .insert({
                vendor_id: selectedVendor,
                contact_name: contact.contact_name,
                contact_email: contact.contact_email,
                contact_phone: contact.contact_phone || '',
                position: contact.position || ''
              });
            
            if (insertError) {
              logger.error('담당자 추가 오류:', insertError);
              toast.error(`담당자 추가 실패: ${insertError.message}`);
            }
          }
        }
      }
      
      // 담당자 목록 새로고침
      const { data } = await supabase
        .from('vendor_contacts')
        .select('id, contact_name, contact_email, contact_phone, position')
        .eq('vendor_id', selectedVendor);
      
      if (data) setContacts(data);
      setIsContactDialogOpen(false);
      toast.success('담당자 정보가 저장되었습니다.');
    } catch (error) {
      toast.error('담당자 저장에 실패했습니다.');
    }
  };

  const handleDeleteContact = async (contactId: number) => {
    if (!confirm('정말 이 담당자를 삭제하시겠습니까?')) return;
    
    try {
      await supabase
        .from('vendor_contacts')
        .delete()
        .eq('id', contactId);
      
      // 담당자 목록 새로고침
      const { data } = await supabase
        .from('vendor_contacts')
        .select('id, contact_name, contact_email, contact_phone, position')
        .eq('vendor_id', selectedVendor);
      
      if (data) setContacts(data);
      toast.success('담당자가 삭제되었습니다.');
    } catch (error) {
      toast.error('담당자 삭제에 실패했습니다.');
    }
  };

  const paymentCategory = watch('payment_category');
  const selectedTemplate = watch('po_template_type');

  return (
    <form 
      onSubmit={(e) => {
        e.preventDefault();
        rhHandleSubmit(handleSubmit)(e);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.keyCode === 13) {
          e.preventDefault();
        }
      }}
    >
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-start">
        {/* 발주 기본 정보 - 모바일: 전체 폭, 데스크톱: 280px 고정 */}
        <div className="w-full lg:w-[280px] lg:min-w-[280px] lg:flex-shrink-0 relative bg-muted/20 border border-border rounded-lg shadow-sm hover:shadow-md transition-shadow duration-300 p-3 lg:p-4 space-y-2.5">
          {/* 헤더: 템플릿에 따라 제목 변경 */}
          <div className="flex flex-col">
            <h4 className="font-semibold text-foreground text-sm">
              {{'발주/구매': '발주/구매 요청 정보', '카드사용': '카드사용 요청 정보', '출장': '출장 요청 정보', '차량': '차량 요청 정보', '연차 신청': '연차 신청 정보'}[watch('po_template_type')] || '요청 정보'}
            </h4>
            <p className="text-[10px] text-muted-foreground">
              {{'발주/구매': 'Purchase Request', '카드사용': 'Card Usage Request', '출장': 'Business Trip Request', '차량': 'Vehicle Request', '연차 신청': 'Annual Leave Request'}[watch('po_template_type')] || 'Request Information'}
            </p>
          </div>

          {/* 템플릿 선택 */}
          <div>
            <Label className="mb-0.5 block text-[10px] sm:text-xs">템플릿<span className="text-red-500 ml-0.5">*</span></Label>
            <Select value={watch('po_template_type') || undefined} onValueChange={(value) => setValue('po_template_type', value)}>
              <SelectTrigger className={`!h-7 !py-0 !leading-none bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md transition-shadow duration-200 [&>svg]:hidden ${!watch('po_template_type') ? 'text-gray-400' : ''}`}>
                <SelectValue placeholder="선택" />
              </SelectTrigger>
              <SelectContent position="popper" className="z-[9999]">
                <SelectItem value="발주/구매">발주/구매</SelectItem>
                <SelectItem value="카드사용">카드사용</SelectItem>
                <SelectItem value="출장">출장</SelectItem>
                <SelectItem value="차량">차량</SelectItem>
                <SelectItem value="연차 신청">연차 신청</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 보드명 - 발주/구매에서만 표시 */}
          {watch('po_template_type') === '발주/구매' && (
          <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
            <div>
              <div className="flex items-center gap-1 mb-0.5">
                <Label className="text-[10px] sm:text-xs">보드명</Label>
                {selectedBoard && (
                  <span
                    className="text-[9px] text-blue-600 cursor-pointer hover:underline"
                    onClick={() => setSelectedBoard(null)}
                  >
                    초기화
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <ReactSelect
                  options={boards.map(b => ({ value: b.id, label: b.board_name }))}
                  value={selectedBoard}
                  onChange={handleBoardSelect}
                  placeholder="선택"
                  isClearable
                  isSearchable
                  className="text-xs flex-1"
                  menuPortalTarget={document.body}
                  styles={{
                    control: (base) => ({
                      ...base,
                      minHeight: '28px',
                      height: '28px',
                      fontSize: '0.75rem',
                      backgroundColor: '#fff',
                      borderColor: '#d2d2d7',
                      borderRadius: '6px',
                      boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
                      '&:hover': {
                        borderColor: '#d2d2d7',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
                      }
                    }),
                    valueContainer: (base) => ({ ...base, padding: '0 6px' }),
                    menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                    menu: (base) => ({ 
                      ...base, 
                      zIndex: 9999, 
                      fontSize: '0.75rem',
                      minWidth: '160px',
                      width: 'auto',
                      whiteSpace: 'nowrap'
                    }),
                    option: (base) => ({ ...base, padding: '4px 8px', whiteSpace: 'nowrap' }),
                    placeholder: (base) => ({ ...base, color: '#9ca3af' }),
                    dropdownIndicator: () => ({ display: 'none' }),
                    clearIndicator: (base) => ({ ...base, padding: '2px' }),
                    indicatorSeparator: () => ({ display: 'none' })
                  }}
                />
                {selectedBoard && (
                  <>
                    <Input
                      type="number"
                      min="1"
                      value={productionQuantity}
                      onChange={handleProductionQuantityChange}
                      className="h-7 w-12 text-center text-xs bg-white border border-[#d2d2d7] rounded-md shadow-sm hover:shadow-md transition-shadow duration-200"
                      placeholder="수량"
                    />
                    <Button 
                      type="button" 
                      size="sm" 
                      variant="outline" 
                      onClick={handleApplyQuantity}
                      className="h-7 px-2 text-[10px] border-[#d2d2d7] hover:bg-gray-50"
                    >
                      적용
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
          )}
              
          {watch('po_template_type') === '발주/구매' && (
            <div className="space-y-2.5">
              
              {/* 요청 설정 */}
              <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                <div>
                  <Label className="mb-0.5 block text-[10px] sm:text-xs">요청 유형<span className="text-red-500 ml-0.5">*</span></Label>
                  <Select value={watch('request_type')} onValueChange={(value) => setValue('request_type', value)}>
                    <SelectTrigger className="!h-7 !py-0 !leading-none bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md transition-shadow duration-200 [&>svg]:hidden">
                      <SelectValue placeholder="선택" />
                    </SelectTrigger>
                    <SelectContent position="popper" className="z-[9999]">
                      <SelectItem value="원자재">원자재</SelectItem>
                      <SelectItem value="소모품">소모품</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-0.5 block text-[10px] sm:text-xs">진행 종류<span className="text-red-500 ml-0.5">*</span></Label>
                  <Select value={watch('progress_type')} onValueChange={(value) => setValue('progress_type', value)}>
                    <SelectTrigger className="!h-7 !py-0 !leading-none bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md transition-shadow duration-200 [&>svg]:hidden">
                      <SelectValue placeholder="선택" />
                    </SelectTrigger>
                    <SelectContent position="popper" className="z-[9999]">
                      <SelectItem value="일반">일반</SelectItem>
                      <SelectItem value="선진행">선진행</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-0.5 block text-[10px] sm:text-xs">결제 종류<span className="text-red-500 ml-0.5">*</span></Label>
                  <Select value={watch('payment_category')} onValueChange={(value) => setValue('payment_category', value)}>
                    <SelectTrigger className="!h-7 !py-0 !leading-none bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md transition-shadow duration-200 [&>svg]:hidden">
                      <SelectValue placeholder="선택" />
                    </SelectTrigger>
                    <SelectContent position="popper" className="z-[9999]">
                      <SelectItem value="구매 요청">구매 요청</SelectItem>
                      <SelectItem value="발주">발주</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* 업체 정보 */}
              <div className="grid grid-cols-2 gap-1.5 sm:gap-2 lg:grid-cols-2">
                <div>
                  <Label className="mb-0.5 block text-[10px] sm:text-xs">업체명<span className="text-red-500 ml-0.5">*</span></Label>
                  <ReactSelect
                      options={vendors.map(v => ({ value: v.id.toString(), label: v.vendor_name }))}
                      value={vendors.find(v => v.id.toString() === vendor) ? { value: vendor, label: vendors.find(v => v.id.toString() === vendor)?.vendor_name } : null}
                      onChange={(option) => {
                        const opt = option as { value: string; label: string } | null;
                        if (opt) {
                          setVendor(opt.value);
                          setValue('vendor_id', Number(opt.value));
                        } else {
                          setVendor('');
                          setValue('vendor_id', 0);
                        }
                      }}
                      placeholder="업체 선택"
                      isClearable={false}
                      isSearchable
                      closeMenuOnSelect={false}
                      classNamePrefix="vendor-select"
                      blurInputOnSelect={false}
                      openMenuOnFocus={false}
                      openMenuOnClick={true}
                      tabSelectsValue={false}
                      captureMenuScroll={false}
                      pageSize={20}
                      styles={{
                        container: base => ({ ...base, width: '100%' }),
                        control: base => ({ 
                          ...base, 
                          height: '28px !important',
                          minHeight: '28px !important',
                          maxHeight: '28px !important',
                          background: '#fff',
                          border: '1px solid #d2d2d7',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
                          padding: '0 !important',
                          margin: '0 !important',
                          alignItems: 'center',
                          display: 'flex',
                          position: 'relative',
                          verticalAlign: 'top',
                          lineHeight: '1',
                          '&:hover': { 
                            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' 
                          }
                        }),
                        valueContainer: base => ({ 
                          ...base, 
                          height: '28px !important',
                          minHeight: '28px !important',
                          maxHeight: '28px !important',
                          padding: '0 8px !important',
                          margin: '0 !important',
                          fontSize: '0.75rem',
                          alignItems: 'center',
                          display: 'flex',
                          lineHeight: '1',
                          justifyContent: 'flex-start'
                        }),
                        input: base => ({ 
                          ...base, 
                          margin: '0 !important', 
                          padding: '0 !important', 
                          fontSize: '0.75rem',
                          lineHeight: '28px'
                        }),
                        singleValue: base => ({
                          ...base,
                          margin: '0 !important',
                          padding: '0 !important',
                          fontSize: '0.75rem',
                          lineHeight: '28px'
                        }),
                        placeholder: base => ({
                          ...base,
                          margin: '0 !important',
                          padding: '0 !important',
                          fontSize: '0.75rem',
                          lineHeight: '28px',
                          color: '#9ca3af'
                        }),
                        indicatorsContainer: base => ({ 
                          ...base, 
                          height: '28px !important',
                          padding: '0 4px !important',
                          alignItems: 'center',
                          display: 'flex'
                        }),
                        indicatorSeparator: () => ({ display: 'none' }),
                        dropdownIndicator: () => ({ display: 'none' }),
                        clearIndicator: base => ({ ...base, padding: '2px !important' }),
                        menuPortal: base => ({ ...base, zIndex: 1400 }),
                        option: base => ({ ...base, padding: '4px 8px' })
                      }}
                    />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <Label className="text-[10px] sm:text-xs">업체 담당자</Label>
                    <span
                      className="text-primary text-[9px] sm:text-[10px] cursor-pointer hover:underline select-none flex items-center"
                      onClick={openContactsManager}
                    >
                      <span className="-translate-y-px">+</span><span className="ml-0.5">추가/수정</span>
                    </span>
                  </div>
                  <Select
                    value={watch('contacts')[0] || ''}
                    onValueChange={val => {
                      setValue('contacts', [val]);
                      setValue('contact_id', val ? Number(val) : undefined);
                    }}
                  >
                    <SelectTrigger className="!h-7 !py-0 !leading-none bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md transition-shadow duration-200 [&>svg]:hidden">
                      <SelectValue placeholder="담당자 선택" />
                    </SelectTrigger>
                    <SelectContent position="popper" className="z-[9999]">
                      {contacts.map(c => (
                        <SelectItem key={c.id} value={c.id.toString()}>
                          {c.contact_name || c.contact_email || c.contact_phone || c.position || ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* 구매요구자 및 일정 정보 */}
              <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                <div>
                  <Label className="mb-0.5 block text-[10px] sm:text-xs">구매요구자</Label>
                  <ReactSelect
                      key={`employee-select-${employeeName}`}
                      value={employeeName ? { value: employeeName, label: employeeName } : null}
                      defaultValue={employeeName ? { value: employeeName, label: employeeName } : null}
                      onChange={(selectedOption) => {
                        const value = (selectedOption as EmployeeOption)?.value || "";
                        setValue('requester_name', value);
                        setEmployeeName(value);
                      }}
                      options={employees.map(employee => ({
                        value: employee.name,
                        label: employee.name
                      }))}
                      placeholder="선택"
                      isSearchable
                      isClearable={false}
                      noOptionsMessage={() => "일치하는 직원이 없습니다"}
                      filterOption={(option, inputValue) => {
                        const employee = employees.find(emp => emp.name === option.value);
                        const searchText = `${employee?.name || ''} ${employee?.position || ''} ${employee?.email || ''}`.toLowerCase();
                        return searchText.includes(inputValue.toLowerCase());
                      }}
                      styles={{
                        control: (base) => ({
                          ...base,
                          height: '28px !important',
                          minHeight: '28px !important',
                          maxHeight: '28px !important',
                          background: '#fff',
                          border: '1px solid #d2d2d7',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
                          padding: '0 !important',
                          margin: '0 !important',
                          alignItems: 'center',
                          display: 'flex',
                          position: 'relative',
                          verticalAlign: 'top',
                          lineHeight: '1',
                          '&:hover': {
                            borderColor: '#d2d2d7',
                            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
                          }
                        }),
                        valueContainer: (base) => ({
                          ...base,
                          height: '28px !important',
                          minHeight: '28px !important',
                          maxHeight: '28px !important',
                          padding: '0 8px !important',
                          margin: '0 !important',
                          fontSize: '0.75rem',
                          alignItems: 'center',
                          display: 'flex',
                          lineHeight: '28px',
                          justifyContent: 'flex-start',
                          overflow: 'visible'
                        }),
                        input: (base) => ({ 
                          ...base, 
                          margin: '0 !important', 
                          padding: '0 !important', 
                          fontSize: '0.75rem',
                          lineHeight: '28px'
                        }),
                        singleValue: base => ({
                          ...base,
                          margin: '0 !important',
                          padding: '0 !important',
                          fontSize: '0.75rem',
                          lineHeight: '28px',
                          overflow: 'visible',
                          textOverflow: 'clip',
                          whiteSpace: 'nowrap'
                        }),
                        placeholder: base => ({
                          ...base,
                          margin: '0 !important',
                          padding: '0 !important',
                          fontSize: '0.75rem',
                          lineHeight: '28px',
                          color: '#9ca3af'
                        }),
                        indicatorsContainer: (base) => ({ 
                          ...base, 
                          height: '28px !important',
                          padding: '0 4px !important',
                          alignItems: 'center',
                          display: 'flex'
                        }),
                        indicatorSeparator: () => ({ display: 'none' }),
                        dropdownIndicator: () => ({ display: 'none' }),
                        clearIndicator: base => ({ ...base, padding: '2px !important' }),
                        menu: (base) => ({ ...base, fontSize: '0.75rem', zIndex: 9999 }),
                        option: (base) => ({ ...base, fontSize: '0.75rem', padding: '4px 8px' })
                      }}
                    />
                </div>
                <div>
                  <Label className="mb-0.5 block text-[10px] sm:text-xs">청구일</Label>
                  <DatePickerPopover
                    onDateSelect={(date) => {
                      setValue('request_date', format(date, 'yyyy-MM-dd'));
                    }}
                    placeholder="청구일 선택"
                    align="start"
                  >
                    <div className="h-7 w-full bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md hover:bg-gray-50 transition-all duration-200 flex items-center justify-center gap-1 cursor-pointer">
                      <span>{watch('request_date') ? watch('request_date').slice(2).replace(/-/g, '.') : <span className="text-gray-400">연도.월.일</span>}</span>
                      <CalendarIcon className="w-3 h-3 text-gray-400" />
                    </div>
                  </DatePickerPopover>
                </div>
                <div>
                  <Label className="mb-0.5 block text-[10px] sm:text-xs">입고 요청일</Label>
                  <DatePickerPopover
                    onDateSelect={(date) => {
                      setValue('delivery_request_date', format(date, 'yyyy-MM-dd'));
                    }}
                    placeholder="입고 요청일 선택"
                    align="start"
                  >
                    <div className="h-7 w-full bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md hover:bg-gray-50 transition-all duration-200 flex items-center justify-center gap-1 cursor-pointer">
                      <span>{watch('delivery_request_date') ? watch('delivery_request_date').slice(2).replace(/-/g, '.') : <span className="text-gray-400">연도.월.일</span>}</span>
                      <CalendarIcon className="w-3 h-3 text-gray-400" />
                    </div>
                  </DatePickerPopover>
                </div>
              </div>

              {/* 프로젝트 정보 */}
              <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                <div>
                  <Label className="mb-0.5 block text-[10px] sm:text-xs">PJ업체</Label>
                  <Input 
                    type="text" 
                    value={watch('project_vendor')} 
                    onChange={(e) => setValue('project_vendor', e.target.value)} 
                    placeholder="입력"
                    className="h-7 bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md focus:shadow-md transition-shadow duration-200"
                  />
                </div>
                <div>
                  <Label className="mb-0.5 block text-[10px] sm:text-xs">수주번호</Label>
                  <Input 
                    type="text" 
                    value={watch('sales_order_number')} 
                    onChange={(e) => setValue('sales_order_number', e.target.value)} 
                    placeholder="입력"
                    className="h-7 bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md focus:shadow-md transition-shadow duration-200"
                  />
                </div>
                <div>
                  <Label className="mb-0.5 block text-[10px] sm:text-xs">Item</Label>
                  <Input 
                    type="text" 
                    value={watch('project_item')} 
                    onChange={(e) => setValue('project_item', e.target.value)} 
                    placeholder="입력"
                    className="h-7 bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md focus:shadow-md transition-shadow duration-200"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 발주/구매 템플릿 전용 입력 영역 */}
        {selectedTemplate === '발주/구매' && (
        <div className="w-full lg:w-3/4 space-y-4">

          {/* 테이블 형태의 품목 리스트 */}
          <div className="relative border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-100 px-2 sm:px-3 py-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-gray-600" />
                  <div className="flex flex-col">
                    <span className="font-semibold text-foreground leading-tight">품목 목록</span>
                    <span className="text-xs text-muted-foreground leading-tight">Purchase Items</span>
                  </div>
                  <span className="badge-secondary whitespace-nowrap">
                    {fields.length}개
                  </span>
                </div>
                <div className="flex items-center gap-2">
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="w-20 text-xs border-border business-radius-badge shadow-sm hover:shadow-md transition-shadow duration-200 bg-white [&>svg]:hidden" style={{ height: 'auto', padding: '2.5px 10px', minHeight: 'auto' }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-md">
                    <SelectItem value="KRW">KRW</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
                  {selectedBoard?.label && (
                    <span className="text-[11px] text-gray-400">
                      보드명: {selectedBoard.label}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 flex-wrap sm:flex-nowrap">
                <span className="badge-stats text-hansl-500 text-[10px] px-1.5 py-0.5 whitespace-nowrap flex-shrink-0 bg-hansl-50 business-radius-badge">
                  총액: {totalAmount.toLocaleString('ko-KR')} {currency}
                </span>
                <Button 
                  type="button" 
                  className={`button-base border transition-all duration-200 ${
                    isCopied 
                      ? 'border-green-400 text-green-600 bg-green-50' 
                      : 'border-gray-300 text-gray-600 bg-white hover:bg-blue-50 hover:text-blue-600'
                  }`}
                  disabled={isCopied}
                  onClick={async () => { 
                    const showCopiedFeedback = () => {
                      setIsCopied(true);
                      setTimeout(() => setIsCopied(false), 1000);
                    };
                    
                    try {
                      // 품목 데이터를 TSV 형식으로 변환 (탭으로 열 구분, 줄바꿈으로 행 구분)
                      const headers = paymentCategory === "구매 요청" 
                        ? ['품목', '규격', '수량', '단가', '합계', '링크', '비고']
                        : ['품목', '규격', '수량', '단가', '합계', '비고'];
                      
                      const rows = fields.map(item => {
                        const baseRow = [
                          item.item_name || '',
                          item.specification || '',
                          item.quantity?.toString() || '0',
                          item.unit_price_value?.toString() || '0',
                          item.amount_value?.toString() || '0',
                        ];
                        
                        if (paymentCategory === "구매 요청") {
                          baseRow.push(item.link || '');
                        }
                        baseRow.push(item.remark || '');
                        
                        return baseRow.join('\t');
                      });
                      
                      const tsvData = [headers.join('\t'), ...rows].join('\n');
                      
                      await navigator.clipboard.writeText(tsvData);
                      showCopiedFeedback();
                      toast.success(`📋 ${fields.length}개 품목 복사 완료! 엑셀에 붙여넣기 하세요.`);
                    } catch (err) {
                      // Fallback: 구형 브라우저 대응
                      try {
                        const headers = paymentCategory === "구매 요청" 
                          ? ['품목', '규격', '수량', '단가', '합계', '링크', '비고']
                          : ['품목', '규격', '수량', '단가', '합계', '비고'];
                        
                        const rows = fields.map(item => {
                          const baseRow = [
                            item.item_name || '',
                            item.specification || '',
                            item.quantity?.toString() || '0',
                            item.unit_price_value?.toString() || '0',
                            item.amount_value?.toString() || '0',
                          ];
                          
                          if (paymentCategory === "구매 요청") {
                            baseRow.push(item.link || '');
                          }
                          baseRow.push(item.remark || '');
                          
                          return baseRow.join('\t');
                        });
                        
                        const tsvData = [headers.join('\t'), ...rows].join('\n');
                        
                        const textArea = document.createElement('textarea');
                        textArea.value = tsvData;
                        textArea.style.position = 'fixed';
                        textArea.style.left = '-9999px';
                        document.body.appendChild(textArea);
                        textArea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textArea);
                        showCopiedFeedback();
                        toast.success(`📋 ${fields.length}개 품목 복사 완료! 엑셀에 붙여넣기 하세요.`);
                      } catch (fallbackErr) {
                        toast.error('클립보드 복사에 실패했습니다. 브라우저 권한을 확인해주세요.');
                      }
                    }
                  }}
                >
                  {isCopied ? (
                    <>
                      <Check className="w-3 h-3 mr-0.5" />
                      복사됨
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 mr-0.5" />
                      전체복사
                    </>
                  )}
                </Button>
                <Button 
                  type="button" 
                  className="button-base border border-gray-300 text-gray-600 bg-white hover:bg-red-50 hover:text-red-600" 
                  onClick={() => { 
                    if (confirm('모든 품목을 삭제하시겠습니까?')) {
                      fields.forEach((_idx, index) => remove(fields.length - 1 - index)); 
                      append({ 
                        line_number: 1, 
                        item_name: '', 
                        specification: '', 
                        quantity: 1, 
                        unit_price_value: 0, 
                        unit_price_currency: currency, 
                        amount_value: 0, 
                        amount_currency: currency, 
                        remark: '', 
                        link: '' 
                      });
                    }
                  }}
                >
                  전체삭제
                </Button>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={addCount}
                  onChange={e => setAddCount(Math.max(1, Number(e.target.value.replace(/[^0-9]/g, ''))))}
                  className="w-12 text-center flex-shrink-0 business-radius-badge border border-gray-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&]:!text-[12px] [&]:!font-medium [&]:!leading-tight"
                  style={{ 
                    height: 'auto',
                    padding: '2px 6px', 
                    minHeight: 'auto',
                    maxHeight: 'none',
                    lineHeight: '1.25'
                  }}
                />
                <Button
                  type="button"
                  onClick={() => {
                    for (let i = 0; i < addCount; i++) {
                      append({
                        line_number: fields.length + 1 + i,
                        item_name: '',
                        specification: '',
                        quantity: 1,
                        unit_price_value: 0,
                        unit_price_currency: currency,
                        amount_value: 0,
                        amount_currency: currency,
                        remark: '',
                        link: ''
                      });
                    }
                  }}
                  className="button-base bg-blue-500 hover:bg-blue-600 text-white"
                >
                  <Plus className="w-3 h-3 mr-0.5" />
                  추가
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto" onPaste={handlePasteFromExcel} tabIndex={0} style={{ outline: 'none' }}>
              <div className="max-h-[calc(100vh-180px)] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr className="border-b border-gray-200">
                      <th className="px-2 py-2 text-left font-medium text-gray-700 w-10">#</th>
                      <th className="px-2 py-2 text-left font-medium text-gray-700 min-w-[100px] sm:min-w-[120px]">
                        품목<span className="text-red-500">*</span>
                      </th>
                      <th className="px-2 py-2 text-left font-medium text-gray-700 min-w-[250px] sm:min-w-[320px]">규격</th>
                      <th className="px-2 py-2 text-center font-medium text-gray-700 w-20">
                        수량<span className="text-red-500">*</span>
                      </th>
                      <th className="px-2 py-2 text-right font-medium text-gray-700 w-[140px] sm:w-[160px]">
                        단가 ({currency})
                      </th>
                      <th className="px-2 py-2 text-right font-medium text-gray-700 min-w-[110px] sm:min-w-[140px]">
                        합계 ({currency})
                      </th>
                      {paymentCategory === "구매 요청" && (
                        <th className="px-2 py-2 text-left font-medium text-gray-700 min-w-[120px] sm:min-w-[150px]">링크</th>
                      )}
                      <th className="px-2 py-2 text-left font-medium text-gray-700 min-w-[100px] sm:min-w-[150px]">비고</th>
                      <th className="px-2 py-2 text-center font-medium text-gray-700 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {fields.map((item, idx) => (
                      <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-2 py-1 text-center text-gray-500">{idx + 1}</td>
                        {/* 품목 */}
                        <td className="px-2 py-1">
                          <Input
                            data-row-index={idx}
                            data-field-name="item_name"
                            value={item.item_name}
                            onChange={(e) => update(idx, { ...item, item_name: e.target.value })}
                            className="h-7 w-full bg-white border border-gray-200 text-xs"
                            placeholder="품목명 입력"
                          />
                        </td>

                        {/* 규격 */}
                        <td className="px-2 py-1">
                          <Input
                            data-row-index={idx}
                            data-field-name="specification"
                            value={item.specification}
                            onChange={(e) => update(idx, { ...item, specification: e.target.value })}
                            className="h-7 w-full bg-white border border-gray-200 text-xs"
                            placeholder="규격 입력"
                          />
                        </td>

                        {/* 수량 */}
                        <td className="px-2 py-1">
                          <Input
                            data-row-index={idx}
                            data-field-name="quantity"
                            type="number"
                            min="1"
                            value={item.quantity || ''}
                            className="h-7 w-20 bg-white border border-gray-200 text-xs text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            placeholder="0"
                            onChange={(e) => {
                              const newQuantity = parseInt(e.target.value) || 0;
                              update(idx, { ...item, quantity: newQuantity });
                            }}
                          />
                        </td>

                        {/* 단가 */}
                        <td className="px-2 py-1">
                          <div className="flex items-center">
                            <Input
                              data-row-index={idx}
                              data-field-name="unit_price_value"
                              type="text"
                              inputMode="decimal"
                              value={inputValues[`${idx}_unit_price_value`] ?? (item.unit_price_value === 0 ? "" : item.unit_price_value?.toLocaleString('ko-KR') || "")}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/,/g, "");
                                // 숫자와 소수점만 허용
                                const cleanValue = raw.replace(/[^0-9.]/g, '');
                                // 소수점 중복 방지
                                const parts = cleanValue.split('.');
                                const finalValue = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : cleanValue;
                                
                                // 입력 중인 값 저장 (소수점 유지)
                                setInputValues(prev => ({...prev, [`${idx}_unit_price_value`]: finalValue}));
                                
                                // 계산용 숫자 값 저장
                                const numVal = finalValue === '' ? 0 : parseFloat(finalValue) || 0;
                                update(idx, { ...item, unit_price_value: numVal });
                              }}
                              onBlur={() => {
                                // 포커스 벗어날 때 입력값 정리
                                setInputValues(prev => {
                                  const newState = {...prev};
                                  delete newState[`${idx}_unit_price_value`];
                                  return newState;
                                });
                              }}
                              className="h-7 w-32 bg-white border border-gray-200 text-xs text-right"
                              placeholder="0"
                            />
                            <span className="ml-1 text-xs text-gray-500">{currency === "KRW" ? "₩" : "$"}</span>
                          </div>
                        </td>

                        {/* 합계 */}
                        <td className="px-2 py-1">
                          <div className="flex items-center justify-end">
                            <span className="text-xs text-right font-medium">
                              {(item.amount_value || 0).toLocaleString('ko-KR')}
                            </span>
                            <span className="ml-1 text-xs text-gray-500">{currency === "KRW" ? "₩" : "$"}</span>
                          </div>
                        </td>

                        {/* 링크 (구매요청일 때만) */}
                        {paymentCategory === "구매 요청" && (
                          <td className="px-2 py-1">
                            <Input
                              data-row-index={idx}
                              data-field-name="link"
                              value={item.link || ''}
                              onChange={(e) => update(idx, { ...item, link: e.target.value })}
                              type="url"
                              className="h-7 w-full bg-white border border-gray-200 text-xs"
                              placeholder="https://..."
                            />
                          </td>
                        )}

                        {/* 비고 */}
                        <td className="px-2 py-1">
                          <Input
                            data-row-index={idx}
                            data-field-name="remark"
                            value={item.remark || ''}
                            onChange={(e) => update(idx, { ...item, remark: e.target.value })}
                            className="h-7 w-full bg-white border border-gray-200 text-xs"
                            placeholder="비고"
                          />
                        </td>
                        {/* 삭제 버튼 */}
                        <td className="px-2 py-1 text-center">
                          {fields.length > 1 && (
                            <Button
                              type="button"
                              onClick={() => remove(idx)}
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 hover:bg-red-50"
                            >
                              <X className="w-3 h-3 text-red-600" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          
          {/* 제출 버튼 */}
          <div className="flex justify-end gap-3 mt-2">
            <Button 
              type="button" 
              variant="outline"
              onClick={() => navigate(-1)}
              className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400"
            >
              취소
            </Button>
            <Button 
              type="submit"
              disabled={loading || !isFormValid}
              className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  처리 중...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  발주요청
                </>
              )}
            </Button>
          </div>
        </div>
        )}

        {selectedTemplate === '카드사용' && (
          <div className="w-full lg:w-3/4">
            <CardUsageTab mode="create" />
          </div>
        )}

        {selectedTemplate === '출장' && (
          <div className="w-full lg:w-3/4">
            <BusinessTripTab mode="create" />
          </div>
        )}

        {selectedTemplate === '차량' && (
          <div className="w-full lg:w-3/4">
            <VehicleTab mode="create" />
          </div>
        )}

        {selectedTemplate === '연차 신청' && (
          <div className="w-full lg:w-3/4">
            <LeaveRequestForm />
          </div>
        )}
      </div>

      {/* 에러 메시지 */}
      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* 담당자 관리 모달 */}
      <Dialog open={isContactDialogOpen} onOpenChange={setIsContactDialogOpen}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>담당자 관리</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {contactsForEdit.map((contact, index) => (
              <div key={index} className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label className="text-xs">이름</Label>
                  <Input
                    value={contact.contact_name}
                    onChange={(e) => handleContactChange(index, 'contact_name', e.target.value)}
                    placeholder="담당자 이름"
                    className="h-9"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs">이메일</Label>
                  <Input
                    value={contact.contact_email}
                    onChange={(e) => handleContactChange(index, 'contact_email', e.target.value)}
                    placeholder="이메일"
                    className="h-9"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs">전화번호</Label>
                  <Input
                    value={contact.contact_phone}
                    onChange={(e) => handleContactChange(index, 'contact_phone', e.target.value)}
                    placeholder="전화번호"
                    className="h-9"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs">직책</Label>
                  <Input
                    value={contact.position}
                    onChange={(e) => handleContactChange(index, 'position', e.target.value)}
                    placeholder="직책"
                    className="h-9"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => removeContactSlot(index)}
                  className="h-9 px-2"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={addNewContactSlot}
              size="sm"
            >
              <Plus className="h-4 w-4 mr-1" />
              담당자 추가
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm">
                취소
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={handleSaveAllContacts}
              disabled={!hasChanges}
              size="sm"
            >
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
        <AlertDialogContent className="sm:max-w-[360px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="modal-title">신청 완료</AlertDialogTitle>
            <AlertDialogDescription className="text-[12px] text-gray-600">
              발주요청서가 정상적으로 생성되었습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => setSuccessDialogOpen(false)}
              className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
            >
              확인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
