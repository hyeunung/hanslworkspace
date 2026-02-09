import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { 
  Search, 
  FileCheck, 
  Plus, 
  Trash2, 
  Eye,
  CheckCircle,
  Clock,
  AlertCircle,
  XCircle,
  Loader2,
  RefreshCw,
  Image as ImageIcon,
  SlidersHorizontal,
  ChevronRight,
  ExternalLink,
  X,
  ChevronDown,
  Package,
  ChevronsUpDown,
  Check
} from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import transactionStatementService from "@/services/transactionStatementService";
import { useAuth } from "@/contexts/AuthContext";
import type { 
  TransactionStatement, 
  TransactionStatementStatus,
  StatementMode
} from "@/types/transactionStatement";
import StatementUploadModal from "./StatementUploadModal";
import ReceiptQuantityUploadModal from "./ReceiptQuantityUploadModal";
import StatementConfirmModal from "./StatementConfirmModal";
import StatementImageViewer from "./StatementImageViewer";
import PurchaseDetailModal from "@/components/purchase/PurchaseDetailModal";

/**
 * 거래명세서 확인 메인 페이지 컴포넌트
 * 
 * 거래명세서 목록 조회, 업로드, OCR 추출, 발주 매칭, 확정 기능을 제공합니다.
 */
// 직원 목록 타입 (등록자 변경용)
interface EmployeeOption {
  id: string;
  name: string;
}

export default function TransactionStatementMain() {
  const { currentUserRoles } = useAuth();
  const supabase = createClient();
  
  // app_admin 권한 확인
  const isAppAdmin = currentUserRoles.includes('app_admin');
  
  const [statements, setStatements] = useState<TransactionStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState("");
  const [totalCount, setTotalCount] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  
  // 서브 탭 상태 (거래명세서 / 입고수량)
  const [activeTab, setActiveTab] = useState<'default' | 'receipt'>('default');
  
  // 직원 목록 (등록자 변경용 - app_admin만)
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [editingUploaderId, setEditingUploaderId] = useState<string | null>(null);
  
  // 모달 상태
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isReceiptUploadModalOpen, setIsReceiptUploadModalOpen] = useState(false); // 입고수량 업로드 모달
  const [selectedStatement, setSelectedStatement] = useState<TransactionStatement | null>(null);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [viewerImageUrl, setViewerImageUrl] = useState<string>("");
  
  // OCR 추출 진행 중인 ID들
  const [extractingIds, setExtractingIds] = useState<Set<string>>(new Set());
  
  // 발주 상세 모달 상태
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<number | null>(null);
  
  // 발주 목록 드롭다운 상태
  const [purchaseDropdown, setPurchaseDropdown] = useState<{
    isOpen: boolean;
    statement: TransactionStatement | null;
    position: { top: number; left: number };
  }>({ isOpen: false, statement: null, position: { top: 0, left: 0 } });

  // 탭별 필터링된 목록 및 카운트
  const { filteredStatements, defaultCount, receiptCount } = useMemo(() => {
    const defaultItems = statements.filter(s => (s.statement_mode ?? 'default') === 'default');
    const receiptItems = statements.filter(s => s.statement_mode === 'receipt');
    
    return {
      filteredStatements: activeTab === 'default' ? defaultItems : receiptItems,
      defaultCount: defaultItems.length,
      receiptCount: receiptItems.length
    };
  }, [statements, activeTab]);

  // 직원 목록 로드 (app_admin만)
  useEffect(() => {
    if (!isAppAdmin) return;
    
    const loadEmployees = async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name')
        .order('name');
      
      if (!error && data) {
        setEmployees(data.map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })));
      }
    };
    
    loadEmployees();
  }, [isAppAdmin, supabase]);

  // 등록자 변경 핸들러 (app_admin만)
  const handleUploaderChange = async (statementId: string, newUploaderId: string) => {
    if (!isAppAdmin) return;
    
    const selectedEmployee = employees.find(e => e.id === newUploaderId);
    if (!selectedEmployee) return;
    
    const { error } = await supabase
      .from('transaction_statements')
      .update({ 
        uploaded_by: newUploaderId,
        uploaded_by_name: selectedEmployee.name
      })
      .eq('id', statementId);
    
    if (error) {
      if (error.message?.includes('transaction_statements_uploaded_by_fkey')) {
        const { error: fallbackError } = await supabase
          .from('transaction_statements')
          .update({
            uploaded_by: null,
            uploaded_by_name: selectedEmployee.name
          })
          .eq('id', statementId);
        if (fallbackError) {
          toast.error('등록자 변경에 실패했습니다.');
          return;
        }
        setStatements(prev => prev.map(s => 
          s.id === statementId 
            ? { ...s, uploaded_by: null, uploaded_by_name: selectedEmployee.name }
            : s
        ));
        setEditingUploaderId(null);
        return;
      }
      toast.error('등록자 변경에 실패했습니다.');
      return;
    }
    
    // 로컬 상태 업데이트
    setStatements(prev => prev.map(s => 
      s.id === statementId 
        ? { ...s, uploaded_by: newUploaderId, uploaded_by_name: selectedEmployee.name }
        : s
    ));
    setEditingUploaderId(null);
    toast.success('등록자가 변경되었습니다.');
  };

  // 데이터 로드
  const loadStatements = useCallback(async () => {
    try {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:loadStatements:start',message:'loadStatements start',data:{statusFilter,dateFilter,searchTerm},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
      // #endregion
      setLoading(true);
      const result = await transactionStatementService.getStatements({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        dateFrom: dateFilter || undefined,
        search: searchTerm || undefined,
        limit: 50
      });

      if (result.success) {
        setStatements(result.data || []);
        setTotalCount(result.count || 0);
        const processingIds = (result.data || [])
          .filter((item) => item.status === 'processing')
          .map((item) => item.id);
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:loadStatements:processing',message:'loadStatements processing snapshot',data:{processingCount:processingIds.length,processingIds:processingIds.slice(0,5),extractingCount:extractingIds.size},timestamp:Date.now(),runId:'run1',hypothesisId:'H1'} )}).catch(()=>{});
        // #endregion
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:loadStatements:success',message:'loadStatements success',data:{count:result.count,firstStatuses:(result.data||[]).slice(0,5).map((s)=>({id:s.id,status:s.status}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
        // #endregion
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:loadStatements:failure',message:'loadStatements failure',data:{error:result.error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
        // #endregion
        toast.error(result.error || '데이터를 불러오는데 실패했습니다.');
      }
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:loadStatements:error',message:'loadStatements error',data:{error:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
      // #endregion
      toast.error('데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, dateFilter, searchTerm]);

  useEffect(() => {
    loadStatements();
  }, [loadStatements]);

  useEffect(() => {
    transactionStatementService.kickQueue();
  }, []);

  // Supabase Realtime 구독 - 상태 변경 시 자동 갱신
  const supabaseRef = useRef(createClient());
  const realtimeChannelRef = useRef<ReturnType<typeof createClient>['channel'] | null>(null);
  const realtimeReconnectAttemptsRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const realtimeIsSubscribingRef = useRef(false);
  const realtimeIsSubscribedRef = useRef(false);
  const realtimeInstanceIdRef = useRef(Math.random().toString(36).slice(2, 8));
  
  useEffect(() => {
    const supabase = supabaseRef.current;

    const setupRealtimeAuth = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:realtime:auth',message:'realtime auth session checked',data:{hasSession:!!data?.session,hasToken:!!token},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'H4'})}).catch(()=>{});
        // #endregion
        if (token) {
          supabase.realtime.setAuth(token);
        }
        supabase.realtime.connect();
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:realtime:connect',message:'realtime connect called',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'H4'})}).catch(()=>{});
        // #endregion
      } catch (_) {
        // ignore auth setup errors; fallback to anon
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:realtime:auth-error',message:'realtime auth setup failed',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'H4'})}).catch(()=>{});
        // #endregion
      }
    };

    const subscribeRealtime = () => {
      if (!shouldReconnectRef.current) return;
      if (realtimeIsSubscribingRef.current || realtimeIsSubscribedRef.current) {
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:realtime:subscribe:skip',message:'subscribe skipped (already active)',data:{isSubscribing:realtimeIsSubscribingRef.current,isSubscribed:realtimeIsSubscribedRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'H5'})}).catch(()=>{});
        // #endregion
        return;
      }
      realtimeIsSubscribingRef.current = true;
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:realtime:subscribe:start',message:'subscribeRealtime called',data:{attempt:realtimeReconnectAttemptsRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }

      realtimeChannelRef.current = supabase
        .channel('transaction-statements-changes')
        .on(
          'postgres_changes',
          {
            event: '*', // INSERT, UPDATE, DELETE 모두 구독
            schema: 'public',
            table: 'transaction_statements'
          },
          (payload: any) => {
            // #region agent log
            fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:realtime:callback',message:'realtime event received',data:{eventType:payload.eventType,oldStatus:payload.old?.status,newStatus:payload.new?.status,statementId:payload.new?.id||payload.old?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
            // #endregion
            console.log('[Realtime] Statement changed:', payload);
            
            // 상태가 변경되면 목록 갱신
            if (payload.eventType === 'UPDATE') {
              const newStatus = payload.new?.status;
              const oldStatus = payload.old?.status;
              
              // 상태가 processing → extracted 또는 다른 상태로 변경됐을 때
              if (newStatus !== oldStatus) {
                // #region agent log
                fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:realtime:status-change',message:'realtime status change detected',data:{oldStatus,newStatus},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
                // #endregion
                console.log(`[Realtime] Status changed: ${oldStatus} → ${newStatus}`);
                loadStatements();

                if (
                  oldStatus === 'processing' &&
                  ['extracted', 'failed', 'confirmed', 'rejected'].includes(newStatus)
                ) {
                  transactionStatementService.kickQueue();
                }
              }
            } else if (payload.eventType === 'INSERT' || payload.eventType === 'DELETE') {
              // #region agent log
              fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:realtime:insert-delete',message:'realtime insert/delete triggers loadStatements',data:{eventType:payload.eventType},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
              // #endregion
              loadStatements();
            }
          }
        )
        .subscribe((status: string, err?: Error) => {
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:realtime:subscribe',message:'realtime subscribe status',data:{status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
          // #endregion
          if (err) {
            // #region agent log
            fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:realtime:subscribe-error',message:'realtime subscribe error',data:{message:err.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'H6'})}).catch(()=>{});
            // #endregion
          }
          if (status === 'SUBSCRIBED') {
            realtimeReconnectAttemptsRef.current = 0;
            realtimeIsSubscribingRef.current = false;
            realtimeIsSubscribedRef.current = true;
            loadStatements();
          }
          if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
            realtimeIsSubscribingRef.current = false;
            realtimeIsSubscribedRef.current = false;
            if (shouldReconnectRef.current && realtimeReconnectAttemptsRef.current < 3) {
              realtimeReconnectAttemptsRef.current += 1;
              subscribeRealtime();
            }
          }
        });
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:realtime:subscribe:created',message:'realtime channel created',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
    };

    shouldReconnectRef.current = true;
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:realtime:effect',message:'realtime effect init',data:{instanceId:realtimeInstanceIdRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'H7'})}).catch(()=>{});
    // #endregion
    setupRealtimeAuth().finally(() => {
      subscribeRealtime();
    });

    return () => {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:realtime:cleanup',message:'realtime effect cleanup',data:{instanceId:realtimeInstanceIdRef.current,wasSubscribed:realtimeIsSubscribedRef.current,wasSubscribing:realtimeIsSubscribingRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'H7'})}).catch(()=>{});
      // #endregion
      shouldReconnectRef.current = false;
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, [loadStatements]);

  // 상태 배지 렌더링
  const renderStatusBadge = (status: TransactionStatementStatus, errorMessage?: string | null, statementMode?: 'default' | 'receipt') => {
    const baseClass = "inline-flex items-center gap-1 business-radius-badge px-2 py-0.5 text-[10px] font-medium leading-tight";
    
    switch (status) {
      case 'pending':
        return (
          <span className={`${baseClass} bg-gray-100 text-gray-600 border border-gray-200`}>
            <Clock className="w-3 h-3" />
            대기중
          </span>
        );
      case 'queued':
        return (
          <span className={`${baseClass} bg-slate-100 text-slate-600 border border-slate-200`}>
            <Clock className="w-3 h-3" />
            대기열
          </span>
        );
      case 'processing':
        return (
          <span className={`${baseClass} bg-blue-50 text-blue-600 border border-blue-200`}>
            <Loader2 className="w-3 h-3 animate-spin" />
            처리중
          </span>
        );
      case 'extracted':
        return (
          <span className={`${baseClass} bg-yellow-50 text-yellow-600 border border-yellow-200`}>
            <AlertCircle className="w-3 h-3" />
            확인필요
          </span>
        );
      case 'confirmed':
        // 입고수량 모드에서는 "완료"로 표시
        return (
          <span className={`${baseClass} bg-green-50 text-green-600 border border-green-200`}>
            <CheckCircle className="w-3 h-3" />
            {statementMode === 'receipt' ? '완료' : '확정됨'}
          </span>
        );
      case 'rejected':
        return (
          <span className={`${baseClass} bg-red-50 text-red-600 border border-red-200`}>
            <XCircle className="w-3 h-3" />
            거부됨
          </span>
        );
      case 'failed':
        return (
          <span
            className={`${baseClass} bg-red-50 text-red-700 border border-red-200`}
            title={errorMessage || '처리 실패'}
          >
            <XCircle className="w-3 h-3" />
            실패
          </span>
        );
      default:
        return <span className={`${baseClass} bg-gray-100 text-gray-600`}>{status}</span>;
    }
  };

  // 상세 모달 열기
  const handleViewStatement = (statement: TransactionStatement, event?: React.MouseEvent) => {
    const target = event?.target as HTMLElement | undefined;
    const isUploaderInteraction = Boolean(target?.closest?.('[data-uploader-control="true"]'));
    if (isUploaderInteraction) return;
    setSelectedStatement(statement);
    
    if (statement.status === 'extracted') {
      // 확인필요 상태 - 확인 모달 열기
      setIsConfirmModalOpen(true);
    } else if (statement.status === 'confirmed' && statement.matched_purchases && statement.matched_purchases.length > 0) {
      // 확정됨 + 발주 매칭됨
      if (statement.matched_purchases.length === 1) {
        // 발주가 1개면 바로 상세 모달 열기
        setSelectedPurchaseId(statement.matched_purchases[0].purchase_id);
        setIsPurchaseModalOpen(true);
      } else {
        // 발주가 여러 개면 드롭다운 표시
        const rect = (event?.currentTarget as HTMLElement)?.getBoundingClientRect();
        setPurchaseDropdown({
          isOpen: true,
          statement,
          position: {
            top: rect ? rect.bottom + window.scrollY : 0,
            left: rect ? rect.left + window.scrollX : 0
          }
        });
      }
    } else if (
      statement.status === 'confirmed' ||
      statement.status === 'pending' ||
      statement.status === 'queued' ||
      statement.status === 'failed'
    ) {
      // 그 외 - 이미지 뷰어 열기
      setViewerImageUrl(statement.image_url);
      setIsImageViewerOpen(true);
    }
  };
  
  // 발주 선택하여 상세 모달 열기
  const handleSelectPurchase = (purchaseId: number) => {
    setPurchaseDropdown({ isOpen: false, statement: null, position: { top: 0, left: 0 } });
    setSelectedPurchaseId(purchaseId);
    setIsPurchaseModalOpen(true);
  };
  
  // 드롭다운 외부 클릭 시 닫기
  const handleClosePurchaseDropdown = () => {
    setPurchaseDropdown({ isOpen: false, statement: null, position: { top: 0, left: 0 } });
  };

  // 이미지 뷰어 열기
  const handleViewImage = (e: React.MouseEvent, imageUrl: string) => {
    e.stopPropagation();
    setViewerImageUrl(imageUrl);
    setIsImageViewerOpen(true);
  };

  // OCR 추출 시작
  const handleStartExtraction = async (e: React.MouseEvent, statement: TransactionStatement) => {
    e.stopPropagation();
    console.log('[OCR] Button clicked, statement:', statement);
    
    const canExtract = ['pending', 'queued', 'failed'].includes(statement.status);
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:handleStartExtraction:entry',message:'start extraction clicked',data:{statementId:statement.id,status:statement.status,canExtract,alreadyExtracting:extractingIds.has(statement.id)},timestamp:Date.now(),runId:'run1',hypothesisId:'H2'} )}).catch(()=>{});
    // #endregion
    if (!canExtract || extractingIds.has(statement.id)) {
      console.log('[OCR] Status is not eligible or already extracting:', statement.status);
      toast.info('이미 처리 중이거나 완료된 건입니다.');
      return;
    }

    // 추출 시작 - ID 추가
    setExtractingIds(prev => new Set(prev).add(statement.id));

    try {
      console.log('[OCR] Starting extraction...');
      toast.loading('OCR 추출 중... (약 10~30초 소요)', { id: `extraction-${statement.id}` });
      
      const result = await transactionStatementService.extractStatementData(
        statement.id,
        statement.image_url
      );
      console.log('[OCR] Result:', result);

      if (result.success) {
        if (result.queued) {
          toast.info('처리 대기열에 등록되었습니다.', { id: `extraction-${statement.id}` });
          loadStatements();
          return;
        }

        toast.success('OCR 추출이 완료되었습니다!', { id: `extraction-${statement.id}` });
        loadStatements();
        
        if (result.data) {
          setSelectedStatement(result.data);
          setIsConfirmModalOpen(true);
        }
      } else {
        console.error('[OCR] Failed:', result.error);
        toast.error(result.error || 'OCR 추출에 실패했습니다.', { id: `extraction-${statement.id}` });
      }
    } catch (error) {
      console.error('[OCR] Error:', error);
      toast.error('OCR 추출 중 오류가 발생했습니다.', { id: `extraction-${statement.id}` });
    } finally {
      // 추출 완료 - ID 제거
      setExtractingIds(prev => {
        const next = new Set(prev);
        next.delete(statement.id);
        return next;
      });
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:handleStartExtraction:finally',message:'extraction finished cleanup',data:{statementId:statement.id},timestamp:Date.now(),runId:'run1',hypothesisId:'H2'} )}).catch(()=>{});
      // #endregion
    }
  };

  // 삭제
  const handleDelete = async (e: React.MouseEvent, statement: TransactionStatement) => {
    e.stopPropagation();
    
    if (!confirm(`"${statement.file_name || '이 거래명세서'}"를 삭제하시겠습니까?`)) {
      return;
    }

    try {
      const result = await transactionStatementService.deleteStatement(statement.id);
      
      if (result.success) {
        toast.success('삭제되었습니다.');
        loadStatements();
      } else {
        toast.error(result.error || '삭제에 실패했습니다.');
      }
    } catch (error) {
      toast.error('삭제 중 오류가 발생했습니다.');
    }
  };

  // 업로드 성공 후 처리 - 자동으로 OCR 시작
  const handleUploadSuccess = async (statementId: string, imageUrl: string) => {
    setIsUploadModalOpen(false);
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/d1bfd845-9c34-4c24-9ef7-fd981ce7dd8e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionStatementMain.tsx:handleUploadSuccess:entry',message:'upload success triggers extract',data:{statementId,hasImageUrl:Boolean(imageUrl)},timestamp:Date.now(),runId:'run1',hypothesisId:'H2'} )}).catch(()=>{});
    // #endregion
    
    // 1. 업로드 직후 바로 목록 갱신 (목록에 즉시 표시)
    await loadStatements();
    
    // 2. 처리중 표시를 위해 extractingIds에 추가
    setExtractingIds(prev => new Set(prev).add(statementId));
    
    // 3. OCR 추출 시작
    try {
      toast.loading('OCR 추출 중... (약 10~30초 소요)', { id: `extraction-${statementId}` });
      
      const result = await transactionStatementService.extractStatementData(statementId, imageUrl);
      
      if (result.success) {
        if (result.queued) {
          toast.info('처리 대기열에 등록되었습니다.', { id: `extraction-${statementId}` });
          loadStatements();
        } else {
          toast.success('OCR 추출이 완료되었습니다. 결과를 확인해주세요.', { id: `extraction-${statementId}` });
          loadStatements();
          
          // 추출 완료 후 바로 확인 모달 열기
          if (result.data) {
            setSelectedStatement(result.data);
            setIsConfirmModalOpen(true);
          }
        }
      } else {
        toast.error(result.error || 'OCR 추출에 실패했습니다.', { id: `extraction-${statementId}` });
        loadStatements();
      }
    } catch (error) {
      toast.error('OCR 추출 중 오류가 발생했습니다.', { id: `extraction-${statementId}` });
      loadStatements();
    } finally {
      // 추출 완료 - extractingIds에서 제거
      setExtractingIds(prev => {
        const next = new Set(prev);
        next.delete(statementId);
        return next;
      });
    }
  };

  // 확정 모달 닫기
  const handleConfirmModalClose = () => {
    setIsConfirmModalOpen(false);
    setSelectedStatement(null);
    loadStatements();
  };

  // 날짜 포맷
  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  };

  // 금액 포맷
  const formatAmount = (amount?: number) => {
    if (amount === undefined || amount === null) return '-';
    return amount.toLocaleString('ko-KR') + '원';
  };

  return (
    <div className="w-full">
      {/* Header - 발주요청 관리와 동일 */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">거래명세서 확인</h1>
            <p className="page-subtitle" style={{ marginTop: '-2px', marginBottom: '-4px' }}>
              Transaction Statement Verification
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            {/* 업로드 드롭다운 메뉴 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="!h-auto button-base bg-hansl-600 hover:bg-hansl-700 text-white">
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline ml-1">업로드</span>
                  <ChevronDown className="w-3 h-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem 
                  onClick={() => setIsUploadModalOpen(true)}
                  className="text-[12px] py-2 cursor-pointer"
                >
                  <FileCheck className="w-4 h-4 mr-2 text-hansl-600" />
                  거래명세서 업로드
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => setIsReceiptUploadModalOpen(true)}
                  className="text-[12px] py-2 cursor-pointer"
                >
                  <Package className="w-4 h-4 mr-2 text-orange-600" />
                  입고수량 업로드
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              onClick={loadStatements}
              disabled={loading}
              className="!h-auto button-base"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </div>

      {/* 필터 툴바 - 발주요청 관리와 동일한 스타일 */}
      <div className="mb-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* 검색 */}
          <div className="relative min-w-[140px] max-w-[200px]">
            <Search className="absolute left-1.5 top-1/2 transform -translate-y-1/2 w-2.5 h-2.5 text-gray-400" />
            <Input
              placeholder="거래처명, 파일명 검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="!h-auto !py-px !pr-1.5 !pl-5 !text-[11px] !min-h-[20px] business-radius-input border border-gray-300 bg-white text-gray-700"
            />
          </div>
          
          {/* 상태 필터 */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="!h-auto !py-[1px] !px-2 !text-[12px] !min-h-[22px] w-[100px] business-radius-input border border-gray-300 bg-white text-gray-700 [&>svg]:h-3 [&>svg]:w-3">
              <SelectValue placeholder="상태" />
            </SelectTrigger>
            <SelectContent className="min-w-[100px]">
              <SelectItem value="all" className="text-[12px] py-1.5">전체 상태</SelectItem>
              <SelectItem value="pending" className="text-[12px] py-1.5">대기중</SelectItem>
              <SelectItem value="queued" className="text-[12px] py-1.5">대기열</SelectItem>
              <SelectItem value="extracted" className="text-[12px] py-1.5">확인필요</SelectItem>
              <SelectItem value="confirmed" className="text-[12px] py-1.5">확정됨</SelectItem>
              <SelectItem value="rejected" className="text-[12px] py-1.5">거부됨</SelectItem>
              <SelectItem value="failed" className="text-[12px] py-1.5">실패</SelectItem>
            </SelectContent>
          </Select>
          
          {/* 날짜 필터 토글 */}
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
            className={`!h-auto button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 ${showFilters ? 'bg-hansl-50 border-hansl-300 text-hansl-700' : ''}`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1" />
            <span className="button-text">필터</span>
          </Button>
          
          {/* 건수 표시 */}
          <span className="badge-stats bg-gray-100 text-gray-600">
            총 {totalCount}건
          </span>
        </div>
        
        {/* 확장 필터 */}
        {showFilters && (
          <div className="mt-2 p-3 bg-gray-50 business-radius-card border border-gray-200">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-[12px] font-medium text-gray-500">업로드 날짜</label>
                <Input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="!h-auto !py-[2px] !px-2.5 !text-[12px] !min-h-[24px] w-[140px] business-radius-input border border-gray-300 bg-white text-gray-700"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("all");
                  setDateFilter("");
                }}
                className="!h-auto button-base border border-gray-300 bg-white text-blue-600 hover:bg-blue-50 hover:border-blue-300"
              >
                ↻ <span className="button-text text-blue-600">초기화</span>
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 목록 카드 */}
      <Card className="overflow-hidden border border-gray-200 business-radius-card">
        <CardContent className="p-0">
          {/* 서브 탭 */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab('default')}
              className={`flex items-center gap-2 px-4 py-2.5 text-[11px] font-medium transition-colors ${
                activeTab === 'default'
                  ? 'text-hansl-600 border-b-2 border-hansl-600 bg-hansl-50/50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <FileCheck className="w-3.5 h-3.5" />
              거래명세서
              <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${
                activeTab === 'default' ? 'bg-hansl-100 text-hansl-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {defaultCount}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('receipt')}
              className={`flex items-center gap-2 px-4 py-2.5 text-[11px] font-medium transition-colors ${
                activeTab === 'receipt'
                  ? 'text-orange-600 border-b-2 border-orange-600 bg-orange-50/50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              입고수량
              <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${
                activeTab === 'receipt' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {receiptCount}
              </span>
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-hansl-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-[11px] text-gray-500">로딩 중...</span>
            </div>
          ) : filteredStatements.length === 0 ? (
            <div className="text-center py-12">
              <FileCheck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <h3 className="text-[12px] font-medium text-gray-700 mb-1">
                {activeTab === 'default' ? '거래명세서가 없습니다' : '입고수량 데이터가 없습니다'}
              </h3>
              <p className="text-[11px] text-gray-500">
                {activeTab === 'default' 
                  ? '업로드된 거래명세서가 없거나 검색 조건에 맞는 결과가 없습니다.'
                  : '업로드된 입고수량 데이터가 없거나 검색 조건에 맞는 결과가 없습니다.'}
              </p>
            </div>
          ) : (
            <>
              {/* 데스크톱 테이블 뷰 */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full min-w-fit">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wider">상태</th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wider">업로드일</th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wider">명세서일</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">거래처명</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider">합계금액</th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wider">등록자</th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wider">확정자</th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wider">액션</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {filteredStatements.map((statement) => (
                      <tr
                        key={statement.id}
                        className="hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={(e) => handleViewStatement(statement, e)}
                      >
                        <td className="px-3 py-2.5 text-center">
                          {extractingIds.has(statement.id) 
                            ? renderStatusBadge('processing') 
                            : renderStatusBadge(statement.status, statement.extraction_error, statement.statement_mode)}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-center text-gray-600">
                          {formatDate(statement.uploaded_at)}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-center text-gray-600">
                          {statement.statement_date ? formatDate(statement.statement_date) : '-'}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] font-medium text-gray-900">
                          {statement.vendor_name || '-'}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] font-medium text-right text-gray-900">
                          {formatAmount(statement.grand_total)}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-center text-gray-600">
                          {isAppAdmin ? (
                            <div className="flex justify-center" data-uploader-control="true">
                              <Popover 
                                open={editingUploaderId === statement.id} 
                                onOpenChange={(open) => setEditingUploaderId(open ? statement.id : null)}
                              >
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    role="combobox"
                                    className="h-6 w-20 justify-between text-[10px] px-2 border-gray-200"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <span className="truncate">
                                      {statement.uploaded_by_name || '-'}
                                    </span>
                                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[180px] p-0" align="center" data-uploader-control="true" onClick={(e) => e.stopPropagation()}>
                                  <Command>
                                    <CommandInput placeholder="이름 검색..." className="h-8 text-xs" onKeyDown={(e) => e.stopPropagation()} />
                                    <CommandList>
                                      <CommandEmpty>검색 결과 없음</CommandEmpty>
                                      <CommandGroup className="max-h-[200px] overflow-auto">
                                        {employees.map((emp) => (
                                          <CommandItem
                                            key={emp.id}
                                            value={emp.name}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onClick={(e) => e.stopPropagation()}
                                            onSelect={() => {
                                              handleUploaderChange(statement.id, emp.id);
                                            }}
                                            className="text-[11px]"
                                          >
                                            <Check
                                              className={`mr-2 h-3 w-3 ${
                                                statement.uploaded_by === emp.id ? "opacity-100" : "opacity-0"
                                              }`}
                                            />
                                            {emp.name}
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                            </div>
                          ) : (
                            statement.uploaded_by_name || '-'
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-center text-gray-600">
                          {statement.confirmed_by_name || '-'}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                {statement.status === 'failed' && (
                              <Button
                                type="button"
                                onClick={(e) => handleStartExtraction(e, statement)}
                                className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                              >
                                {statement.status === 'failed' ? '재시도' : '추출 시작'}
                              </Button>
                            )}
                            <button
                              onClick={(e) => handleViewImage(e, statement.image_url)}
                              className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                              title="이미지 보기"
                            >
                              <ImageIcon className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleDelete(e, statement)}
                              className="p-1.5 rounded-md hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"
                              title="삭제"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 모바일 카드 뷰 */}
              <div className="md:hidden divide-y divide-gray-100">
                {filteredStatements.map((statement) => (
                  <div
                    key={statement.id}
                    className="p-3 hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={(e) => handleViewStatement(statement, e)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      {extractingIds.has(statement.id) 
                        ? renderStatusBadge('processing') 
                        : renderStatusBadge(statement.status, statement.extraction_error, statement.statement_mode)}
                      <span className="text-[10px] text-gray-400">
                        {formatDate(statement.uploaded_at)}
                      </span>
                    </div>
                    <div className="mb-2">
                      <p className="text-[11px] font-medium text-gray-900">
                        {statement.vendor_name || '거래처 미확인'}
                      </p>
                    </div>
                    {statement.grand_total && (
                      <p className="text-[12px] font-bold text-gray-900">
                        {formatAmount(statement.grand_total)}
                      </p>
                    )}
                    <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-gray-100">
                  {statement.status === 'failed' && (
                        <Button
                          type="button"
                          onClick={(e) => handleStartExtraction(e, statement)}
                          className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                        >
                          {statement.status === 'failed' ? '재시도' : '추출 시작'}
                        </Button>
                      )}
                      <button
                        onClick={(e) => handleViewImage(e, statement.image_url)}
                        className="button-base px-2 py-1 text-[10px] border border-gray-200 text-gray-600 hover:bg-gray-50"
                      >
                        <ImageIcon className="w-3 h-3 mr-1" />
                        보기
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 업로드 모달 */}
      <StatementUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={handleUploadSuccess}
      />

      {/* 입고수량 업로드 모달 */}
      <ReceiptQuantityUploadModal
        isOpen={isReceiptUploadModalOpen}
        onClose={() => setIsReceiptUploadModalOpen(false)}
        onSuccess={handleUploadSuccess}
      />

      {/* 확인/수정/확정 모달 */}
      {selectedStatement && (
        <StatementConfirmModal
          isOpen={isConfirmModalOpen}
          statement={selectedStatement}
          onClose={handleConfirmModalClose}
          onConfirm={handleConfirmModalClose}
        />
      )}

      {/* 이미지 뷰어 */}
      <StatementImageViewer
        isOpen={isImageViewerOpen}
        imageUrl={viewerImageUrl}
        onClose={() => {
          setIsImageViewerOpen(false);
          setViewerImageUrl("");
        }}
      />

      {/* 발주 목록 드롭다운 */}
      {purchaseDropdown.isOpen && purchaseDropdown.statement && (
        <>
          {/* 오버레이 */}
          <div 
            className="fixed inset-0 z-40" 
            onClick={handleClosePurchaseDropdown}
          />
          {/* 드롭다운 */}
          <div 
            className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[280px] max-w-[360px]"
            style={{
              top: purchaseDropdown.position.top + 4,
              left: purchaseDropdown.position.left
            }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-lg">
              <span className="text-[11px] font-semibold text-gray-700">
                연결된 발주 ({purchaseDropdown.statement.matched_purchases?.length || 0}건)
              </span>
              <button
                onClick={handleClosePurchaseDropdown}
                className="p-0.5 hover:bg-gray-200 rounded"
              >
                <X className="w-3.5 h-3.5 text-gray-500" />
              </button>
            </div>
            <div className="max-h-[300px] overflow-auto">
              {purchaseDropdown.statement.matched_purchases?.map((purchase, idx) => (
                <div
                  key={purchase.purchase_id}
                  onClick={() => handleSelectPurchase(purchase.purchase_id)}
                  className="flex items-center justify-between px-3 py-2.5 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0 transition-colors"
                >
                  <div className="flex-1">
                    <p className="text-[12px] font-medium text-gray-900">
                      {purchase.purchase_order_number || purchase.sales_order_number || `발주 #${purchase.purchase_id}`}
                    </p>
                    {purchase.sales_order_number && purchase.purchase_order_number && (
                      <p className="text-[10px] text-gray-500">
                        수주: {purchase.sales_order_number}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-blue-600">
                    <span className="text-[10px]">상세보기</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* 발주 상세 모달 */}
      {selectedPurchaseId && (
        <PurchaseDetailModal
          purchaseId={selectedPurchaseId}
          isOpen={isPurchaseModalOpen}
          onClose={() => {
            setIsPurchaseModalOpen(false);
            setSelectedPurchaseId(null);
          }}
          activeTab="done"
          forceShowStatementColumns={true}
        />
      )}
    </div>
  );
}
