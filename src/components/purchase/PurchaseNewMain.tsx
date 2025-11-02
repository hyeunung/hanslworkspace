import { useState, useEffect, useRef, useLayoutEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Save, Calculator, Pencil, Trash2, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { useNavigate } from "react-router-dom";
import { useForm as useFormRH, Controller, useFieldArray } from "react-hook-form";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { FormValues, FormItem } from "@/types/purchase";
import { toast } from "sonner";
import { DatePicker } from "@/components/ui/datepicker";
import { Separator } from "@/components/ui/separator";
import ReactSelect from 'react-select';

interface EmployeeOption {
  value: string;
  label: string;
}

export default function PurchaseNewMain() {
  const navigate = useNavigate();
  const supabase = createClient();
  
  const [user, setUser] = useState<any>(null);
  const [employeeName, setEmployeeName] = useState<string>("");
  const [employees, setEmployees] = useState<{id: string; name: string; email?: string; phone?: string; address?: string; position?: string; department?: string;}[]>([]);
  const [defaultRequesterLoaded, setDefaultRequesterLoaded] = useState(false);
  const [addCount, setAddCount] = useState(1);
  const [vendorSearchTerm, setVendorSearchTerm] = useState("");
  
  // 초기 사용자 정보 로드
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, []);

  useEffect(() => {
    // DB에서 직원 목록 가져오기
    const loadEmployees = async () => {
      try {
        const { data, error } = await supabase
          .from('employees')
          .select('id, name, email, phone, address, position, department')
          .order('name');
        
        
        if (data && !error && data.length > 0) {
          setEmployees(data.map(dbEmp => ({
            id: dbEmp.id,
            name: dbEmp.name,
            email: dbEmp.email || '',
            phone: dbEmp.phone || '',
            address: dbEmp.address || '',
            position: dbEmp.position || '',
            department: dbEmp.department || ''
          })));
          
          // 이미 설정된 employeeName이 있고 employees 배열에 해당 직원이 있는지 확인
          if (employeeName && !data.find(emp => emp.name === employeeName)) {
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
            setEmployees([...data.map(dbEmp => ({
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
  const [inputValues, setInputValues] = useState<{[key: string]: string}>({});
  const [isContactDialogOpen, setIsContactDialogOpen] = useState(false);
  const [contactsForEdit, setContactsForEdit] = useState<{ id?: number; contact_name: string; contact_email: string; contact_phone: string; position: string; isNew?: boolean }[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  // 중복 제출 방지용 ref
  const isSubmittingRef = useRef(false);

  const { control, handleSubmit: rhHandleSubmit, watch, setValue, reset, getValues } = useFormRH<FormValues>({
    defaultValues: {
      progress_type: "",
      payment_category: "",
      currency: "KRW",
      po_template_type: "일반",
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

  const { fields, append, remove, update } = useFieldArray({
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

  // 전체 금액 계산
  const getTotalAmount = () => {
    const items = getValues("items");
    return items.reduce((sum, item) => sum + item.amount_value, 0);
  };

  // 필수 항목 체크 함수
  const checkRequiredFields = () => {
    const requestType = watch('request_type');
    const progressType = watch('progress_type');
    const paymentCategory = watch('payment_category');
    const vendorId = watch('vendor_id');
    
    return !!(requestType && progressType && paymentCategory && vendorId && vendorId !== 0 && fields.length > 0);
  };

  // 실시간 필수항목 체크를 위한 state
  const [isFormValid, setIsFormValid] = useState(false);

  // 필수항목 변경 감지
  useEffect(() => {
    setIsFormValid(checkRequiredFields());
  }, [watch('request_type'), watch('progress_type'), watch('payment_category'), watch('vendor_id'), fields]);

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
          
        } catch (retryError: any) {
          // 발주요청번호 중복이 아닌 에러는 바로 throw
          if (!retryError.message.includes('duplicate key value violates unique constraint')) {
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

      // 품목들 저장
      for (const [idx, item] of fields.entries()) {
        const { error: itemErr } = await supabase.from("purchase_request_items").insert({
          purchase_request_id: prId,
          line_number: idx + 1,
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
      }
      
      // 1. 폼 초기화
      reset({
        progress_type: "",
        payment_category: "",
        currency: "KRW",
        po_template_type: "일반",
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
      
      // 3. 성공 메시지 표시
      toast.success("발주요청서가 성공적으로 생성되었습니다.");
      
      // 4. 발주요청 목록으로 이동
      try {
        await navigate('/purchase/list');
      } catch (routerError) {
        // 대체 라우팅 방법
        window.location.href = '/purchase/list';
      }
      return;
    } catch (err: any) {
      setError(err.message || "오류가 발생했습니다.");
      toast.error(err.message || "발주요청서 저장에 실패했습니다.");
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

      for (const contact of contactsForEdit) {
        if (contact.contact_name && contact.contact_email) {
          if (!contact.isNew && contact.id) {
            // 기존 담당자 업데이트
            await supabase
              .from('vendor_contacts')
              .update({
                contact_name: contact.contact_name,
                contact_email: contact.contact_email,
                contact_phone: contact.contact_phone || '',
                position: contact.position || ''
              })
              .eq('id', contact.id);
          } else if (contact.isNew) {
            // 새로운 담당자 추가
            await supabase
              .from('vendor_contacts')
              .insert({
                vendor_id: selectedVendor,
                contact_name: contact.contact_name,
                contact_email: contact.contact_email,
                contact_phone: contact.contact_phone || '',
                position: contact.position || ''
              });
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
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
        {/* 발주 기본 정보 - 모바일: 전체폭, 데스크톱: 1/4 폭 */}
        <div className="w-full lg:w-1/4 relative bg-muted/20 border border-border rounded-lg shadow-sm hover:shadow-md transition-shadow duration-300 p-4 lg:p-5 space-y-4">
          <div className="flex flex-row items-start justify-between w-full mb-4">
            <div className="flex flex-col">
              <h4 className="font-semibold text-foreground">발주 기본 정보</h4>
              <p className="text-xs text-muted-foreground mt-0.5">Basic Information</p>
            </div>
            <div className="flex flex-col items-start">
              <Label className="mb-1 block text-xs">발주서 종류<span className="text-red-500 ml-1">*</span></Label>
              <Select value={watch('po_template_type')} onValueChange={value => setValue('po_template_type', value)}>
                <SelectTrigger className="h-9 w-28 bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md transition-shadow duration-200">
                  <SelectValue placeholder="종류 선택" />
                </SelectTrigger>
                <SelectContent position="popper" className="z-[9999]">
                  <SelectItem value="일반">일반</SelectItem>
                  <SelectItem value="PCB">PCB</SelectItem>
                  <SelectItem value="소모품">소모품</SelectItem>
                  <SelectItem value="기타">기타</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {watch('po_template_type') === '일반' && (
            <div className="space-y-4">
              {/* 요청 설정 */}
              <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                <div>
                  <Label className="mb-0.5 block text-[10px] sm:text-xs">요청 유형<span className="text-red-500 ml-0.5">*</span></Label>
                  <Select value={watch('request_type')} onValueChange={(value) => setValue('request_type', value)}>
                    <SelectTrigger className="h-9 bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md transition-shadow duration-200">
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
                    <SelectTrigger className="h-9 bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md transition-shadow duration-200">
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
                    <SelectTrigger className="h-9 bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md transition-shadow duration-200">
                      <SelectValue placeholder="선택" />
                    </SelectTrigger>
                    <SelectContent position="popper" className="z-[9999]">
                      <SelectItem value="구매 요청">구매 요청</SelectItem>
                      <SelectItem value="발주">발주</SelectItem>
                      <SelectItem value="현장 결제">현장 결제</SelectItem>
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
                      isClearable
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
                        control: base => ({ ...base, height: 36, minHeight: 36, background: '#fff', border: '1px solid #d2d2d7', borderRadius: 6, fontSize: '0.75rem', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)', '&:hover': { boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' } }),
                        valueContainer: base => ({ ...base, height: 34, padding: '0 8px', fontSize: '0.75rem' }),
                        input: base => ({ ...base, margin: 0, padding: 0, fontSize: '0.75rem' }),
                        indicatorsContainer: base => ({ ...base, height: 36 }),
                        indicatorSeparator: () => ({ display: 'none' }),
                        dropdownIndicator: base => ({ ...base, padding: 6 }),
                        clearIndicator: base => ({ ...base, padding: 6 }),
                        menuPortal: base => ({ ...base, zIndex: 1400 })
                      }}
                    />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-0.5 sm:mb-1">
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
                    <SelectTrigger className="h-9 bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md transition-shadow duration-200">
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
                          minHeight: '36px',
                          height: '36px',
                          fontSize: '0.75rem',
                          borderColor: '#d2d2d7',
                          borderRadius: '6px',
                          boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
                          '&:hover': {
                            borderColor: '#d2d2d7',
                            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
                          }
                        }),
                        valueContainer: (base) => ({
                          ...base,
                          height: '34px',
                          padding: '0 8px',
                          fontSize: '0.75rem'
                        }),
                        input: (base) => ({ ...base, margin: '0px', padding: '0px', fontSize: '0.75rem' }),
                        indicatorSeparator: () => ({ display: 'none' }),
                        indicatorsContainer: (base) => ({ ...base, height: '36px' }),
                        dropdownIndicator: base => ({ ...base, padding: 6 }),
                        clearIndicator: base => ({ ...base, padding: 6 }),
                        menu: (base) => ({ ...base, fontSize: '0.75rem', zIndex: 9999 }),
                        option: (base) => ({ ...base, fontSize: '0.75rem', padding: '6px 10px' })
                      }}
                    />
                </div>
                <div>
                  <Label className="mb-0.5 block text-[10px] sm:text-xs">청구일</Label>
                  <Input
                    type="date"
                    value={watch('request_date')}
                    onChange={e => setValue('request_date', e.target.value)}
                    className="h-9 bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md transition-shadow duration-200"
                  />
                </div>
                <div>
                  <Label className="mb-0.5 block text-[10px] sm:text-xs">입고 요청일</Label>
                  <Input
                    type="date"
                    value={watch('delivery_request_date')}
                    onChange={e => setValue('delivery_request_date', e.target.value)}
                    className="h-9 bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md transition-shadow duration-200"
                  />
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
                    className="h-9 bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md focus:shadow-md transition-shadow duration-200"
                  />
                </div>
                <div>
                  <Label className="mb-0.5 block text-[10px] sm:text-xs">수주번호</Label>
                  <Input 
                    type="text" 
                    value={watch('sales_order_number')} 
                    onChange={(e) => setValue('sales_order_number', e.target.value)} 
                    placeholder="입력"
                    className="h-9 bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md focus:shadow-md transition-shadow duration-200"
                  />
                </div>
                <div>
                  <Label className="mb-0.5 block text-[10px] sm:text-xs">Item</Label>
                  <Input 
                    type="text" 
                    value={watch('project_item')} 
                    onChange={(e) => setValue('project_item', e.target.value)} 
                    placeholder="입력"
                    className="h-9 bg-white border border-[#d2d2d7] rounded-md text-xs shadow-sm hover:shadow-md focus:shadow-md transition-shadow duration-200"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Professional Items Section - 모바일: 전체폭, 데스크톱: 3/4 폭 */}
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
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="w-20 h-8 text-xs border-border rounded-md shadow-sm hover:shadow-md transition-shadow duration-200 bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-md">
                    <SelectItem value="KRW">KRW</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-end gap-2 flex-wrap sm:flex-nowrap">
                <Badge variant="secondary" className="text-hansl-500 text-[10px] px-1.5 py-0.5 whitespace-nowrap flex-shrink-0 business-radius-badge">
                  총액: {totalAmount.toLocaleString('ko-KR')} {currency}
                </Badge>
                <Button 
                  type="button" 
                  className="inline-flex items-center gap-1 business-radius-badge px-2 py-1 text-[10px] font-medium leading-tight border border-gray-300 text-gray-600 bg-white hover:bg-red-50 hover:text-red-600" 
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
                  className="w-16 h-7 text-[10px] flex-shrink-0 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
                  className="inline-flex items-center gap-1 business-radius-badge px-2 py-1 text-[10px] font-medium leading-tight bg-blue-500 hover:bg-blue-600 text-white"
                >
                  <Plus className="w-3 h-3 mr-0.5" />
                  추가
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="max-h-[500px] overflow-y-auto">
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
                            value={item.item_name}
                            onChange={(e) => update(idx, { ...item, item_name: e.target.value })}
                            className="h-7 w-full bg-white border border-gray-200 text-xs"
                            placeholder="품목명 입력"
                          />
                        </td>

                        {/* 규격 */}
                        <td className="px-2 py-1">
                          <Input
                            value={item.specification}
                            onChange={(e) => update(idx, { ...item, specification: e.target.value })}
                            className="h-7 w-full bg-white border border-gray-200 text-xs"
                            placeholder="규격 입력"
                          />
                        </td>

                        {/* 수량 */}
                        <td className="px-2 py-1">
                          <Input
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
          {/* 품목 수 표시 */}
          <div className="mt-2 text-xs text-gray-500 text-right">
            총 {fields.length}개 품목
          </div>
        </div>
      </div>

      {/* 에러 메시지 */}
      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* 제출 버튼 */}
      <div className="flex justify-end gap-3 mt-6">
        <Button 
          type="button" 
          variant="outline"
          onClick={() => navigate(-1)}
        >
          취소
        </Button>
        <Button 
          type="submit"
          disabled={loading || !isFormValid}
          className="bg-hansl-600 hover:bg-hansl-700 text-white"
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
    </form>
  );
}