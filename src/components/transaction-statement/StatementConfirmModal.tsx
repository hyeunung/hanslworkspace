import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  XCircle,
  Image as ImageIcon,
  Loader2,
  ChevronDown,
  Check,
  ExternalLink,
  Search
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import transactionStatementService from "@/services/transactionStatementService";
import type { 
  TransactionStatement, 
  TransactionStatementWithItems,
  TransactionStatementItemWithMatch,
  ConfirmItemRequest,
  MatchCandidate,
  OCRFieldType
} from "@/types/transactionStatement";
import { normalizeOrderNumber } from "@/types/transactionStatement";
import StatementImageViewer from "./StatementImageViewer";
import PurchaseDetailModal from "@/components/purchase/PurchaseDetailModal";

interface StatementConfirmModalProps {
  isOpen: boolean;
  statement: TransactionStatement;
  onClose: () => void;
  onConfirm: () => void;
}

// 시스템 발주 품목 타입
interface SystemPurchaseItem {
  purchase_id: number;
  item_id: number;
  purchase_order_number: string;
  sales_order_number?: string;
  item_name: string;
  specification?: string;  // 규격 추가 - 교차 비교용
  quantity?: number;
  received_quantity?: number;
  unit_price?: number;
  amount?: number;
  vendor_name?: string;
}

// Levenshtein 거리 계산 함수
function levenshteinDistance(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().replace(/\s+/g, '');
  const s2 = str2.toLowerCase().replace(/\s+/g, '');
  
  if (s1 === s2) return 0;
  if (s1.length === 0) return s2.length;
  if (s2.length === 0) return s1.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[s1.length][s2.length];
}

// 단일 문자열 유사도 계산 (내부 헬퍼) - 더 엄격한 버전
function calculateStringSimilarity(ocrName: string, targetName: string): number {
  const ocr = ocrName?.toLowerCase().replace(/\s+/g, '') || '';
  const target = targetName?.toLowerCase().replace(/\s+/g, '') || '';
  
  if (!ocr || !target) return 0;
  
  // 완전 일치
  if (ocr === target) return 100;
  
  // 부분 포함 - 길이 비율 체크 (최소 50% 이상 겹쳐야 높은 점수)
  const minLen = Math.min(ocr.length, target.length);
  const maxLen = Math.max(ocr.length, target.length);
  const lengthRatio = minLen / maxLen;
  
  if (ocr.includes(target) || target.includes(ocr)) {
    // 길이 비율이 낮으면 점수 감소 (예: "A"가 "ABCDEFG"에 포함되면 낮은 점수)
    if (lengthRatio >= 0.7) return 90; // 70% 이상 겹침
    if (lengthRatio >= 0.5) return 70; // 50% 이상 겹침
    if (lengthRatio >= 0.3) return 50; // 30% 이상 겹침
    return 30; // 그 외 (너무 짧은 문자열이 포함된 경우)
  }
  
  // Levenshtein 거리 기반
  const distance = levenshteinDistance(ocr, target);
  const similarity = ((maxLen - distance) / maxLen) * 100;
  
  // 단어 일부 일치 체크 - 보너스 축소 (30 → 15)
  const ocrWords = ocrName?.split(/\s+/).filter(w => w.length >= 2) || [];
  const targetWords = targetName?.split(/\s+/).filter(w => w.length >= 2) || [];
  
  if (ocrWords.length === 0 || targetWords.length === 0) {
    return similarity;
  }
  
  const commonWords = ocrWords.filter(w => 
    targetWords.some(tw => {
      const wLower = w.toLowerCase();
      const twLower = tw.toLowerCase();
      // 최소 3글자 이상 일치해야 단어 일치로 인정
      return wLower === twLower || 
        (wLower.length >= 3 && twLower.includes(wLower)) || 
        (twLower.length >= 3 && wLower.includes(twLower));
    })
  );
  const wordMatchBonus = (commonWords.length / Math.max(ocrWords.length, targetWords.length)) * 15;
  
  return Math.min(100, similarity + wordMatchBonus);
}

// 품목명 유사도 점수 계산 - 품목명 우선, 규격은 보조
function calculateItemSimilarity(ocrName: string, systemItemName: string, systemSpec?: string): number {
  // 1. item_name과 비교 (기본)
  const itemNameScore = calculateStringSimilarity(ocrName, systemItemName);
  
  // 2. specification과도 비교 (있으면)
  const specScore = systemSpec ? calculateStringSimilarity(ocrName, systemSpec) : 0;
  
  // 3. 품목명이 어느 정도 일치하면 (30% 이상) 그 점수 사용
  if (itemNameScore >= 30) {
    return itemNameScore;
  }
  
  // 4. 품목명이 전혀 안 맞는데 (30% 미만) 규격만 일치하는 경우
  //    → 규격 일치는 보조 정보이므로 점수에 큰 패널티 부여
  if (specScore >= 60 && itemNameScore < 30) {
    // 규격이 일치해도 품목명이 전혀 다르면 최대 35%만 인정
    // (사용자가 "품목명이 다른데 왜 일치?"라고 혼란스러워함)
    return Math.min(35, specScore * 0.4);
  }
  
  // 5. 둘 다 낮으면 낮은 점수 반환
  return Math.max(itemNameScore, specScore * 0.3);
}

// 수량 일치 여부 확인 (정확히 일치하면 true)
function isQuantityMatched(ocrQuantity: number | undefined | null, systemQuantity: number | undefined | null): boolean {
  if (ocrQuantity === undefined || ocrQuantity === null) return false;
  if (systemQuantity === undefined || systemQuantity === null) return false;
  return ocrQuantity === systemQuantity;
}

// 수량 일치율 계산 (부분 입고 고려 - 10% 이내 오차 허용)
function getQuantityMatchLevel(ocrQuantity: number | undefined | null, systemQuantity: number | undefined | null): 'exact' | 'partial' | 'mismatch' {
  if (ocrQuantity === undefined || ocrQuantity === null) return 'mismatch';
  if (systemQuantity === undefined || systemQuantity === null) return 'mismatch';
  
  if (ocrQuantity === systemQuantity) return 'exact';
  
  // 부분 입고: OCR 수량이 시스템 수량보다 작거나 같으면 partial
  if (ocrQuantity <= systemQuantity) return 'partial';
  
  return 'mismatch';
}

/**
 * 거래명세서 확인/수정/확정 모달 - 3단 비교 레이아웃
 */
export default function StatementConfirmModal({
  isOpen,
  statement,
  onClose,
  onConfirm,
}: StatementConfirmModalProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statementWithItems, setStatementWithItems] = useState<TransactionStatementWithItems | null>(null);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [confirmerName, setConfirmerName] = useState("");
  
  // 선택된 발주/수주번호 (Case 1: 전체 적용용)
  const [selectedPONumber, setSelectedPONumber] = useState<string>("");
  
  // 각 OCR 품목별 선택된 발주/수주번호 (Case 2: 개별 적용용)
  const [itemPONumbers, setItemPONumbers] = useState<Map<string, string>>(new Map());
  
  // 각 OCR 품목별 매칭된 시스템 품목
  const [itemMatches, setItemMatches] = useState<Map<string, SystemPurchaseItem | null>>(new Map());
  
  // 드롭다운 열림 상태
  const [openDropdowns, setOpenDropdowns] = useState<Set<string>>(new Set());
  
  // 드롭다운 위치 (fixed position용)
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  
  // 발주 상세 모달 상태
  const [isPurchaseDetailModalOpen, setIsPurchaseDetailModalOpen] = useState(false);
  const [selectedPurchaseIdForDetail, setSelectedPurchaseIdForDetail] = useState<number | null>(null);
  
  // OCR 품목 편집 상태 (학습용)
  // key: itemId, value: 수정된 값들
  interface EditedOCRItem {
    item_name?: string;
    quantity?: number;
    unit_price?: number;
    amount?: number;
    po_number?: string;
  }
  const [editedOCRItems, setEditedOCRItems] = useState<Map<string, EditedOCRItem>>(new Map());
  
  // 매칭 상세 정보 팝업
  const [matchDetailPopup, setMatchDetailPopup] = useState<{
    isOpen: boolean;
    ocrItemId: string;
    ocrItemName: string;
    systemItemName: string;
    systemSpec: string;
    similarity: number;
    status: 'high' | 'med' | 'low' | 'unmatched';
    reasons: string[];
  } | null>(null);
  
  // 통합 매칭 상세 팝업 (발주번호 전체 매칭 내역)
  const [isIntegratedMatchDetailOpen, setIsIntegratedMatchDetailOpen] = useState(false);
  
  // 거래처 인라인 검색 상태
  const [vendorInputValue, setVendorInputValue] = useState('');
  const [vendorSearchResults, setVendorSearchResults] = useState<Array<{ id: number; name: string; english_name?: string }>>([]);
  const [vendorSearchLoading, setVendorSearchLoading] = useState(false);
  const [vendorDropdownOpen, setVendorDropdownOpen] = useState(false);
  const [overrideVendorName, setOverrideVendorName] = useState<string | null>(null);
  type VendorSearchRow = { id: number; vendor_name: string; english_name?: string | null };
  const [poItemsMap, setPoItemsMap] = useState<Map<string, SystemPurchaseItem[]>>(new Map());
  const autoVendorSelectionRef = useRef(false);
  const systemCandidateLogKeyRef = useRef<string | null>(null);
  
  // 발주번호 인라인 검색 상태
  const [poSearchInputOpen, setPOSearchInputOpen] = useState(false);
  const [poSearchInput, setPOSearchInput] = useState('');
  const [poSearchResults, setPOSearchResults] = useState<Array<{ id: number; poNumber: string; soNumber?: string; vendorName?: string }>>([]);
  const [poSearchLoading, setPOSearchLoading] = useState(false);
  const [poDropdownOpen, setPODropdownOpen] = useState(false);
  const [manuallySelectedPO, setManuallySelectedPO] = useState(false); // 수동 선택 여부
  const keepPODropdownOpenRef = useRef(false);
  const [itemPOSearchInputs, setItemPOSearchInputs] = useState<Record<string, string>>({});
  const [itemPOSearchResults, setItemPOSearchResults] = useState<Record<string, Array<{ id: number; poNumber: string; soNumber?: string; vendorName?: string }>>>({});
  const [itemPOSearchLoading, setItemPOSearchLoading] = useState<Record<string, boolean>>({});
  const lastSelectedSystemItemRef = useRef<string | null>(null);
  const [statementDateInput, setStatementDateInput] = useState('');

  // OCR 발주/수주번호 페어 캐시 (실시간 입력용)
  const [poPairOverrides, setPoPairOverrides] = useState<Map<string, string | null>>(new Map());
  const pendingPairLookupsRef = useRef<Set<string>>(new Set());
  
  // 세트 매칭 결과 (Case 1용)
  const [setMatchResult, setSetMatchResult] = useState<{
    bestMatch: {
      purchase_id: number;
      purchase_order_number: string;
      sales_order_number?: string;
      vendor_name?: string;
      matchScore: number;
      matchedItemCount: number;
      totalItemCount: number;
      confidence: 'high' | 'medium' | 'low';
      itemMatches: Array<{
        ocrItemId: string;
        systemItemId: number;
        systemItemName: string;
        similarity: number;
      }>;
    } | null;
    candidates: Array<{
      purchase_id: number;
      purchase_order_number: string;
      sales_order_number?: string;
      vendor_name?: string;
      matchScore: number;
      matchedItemCount: number;
    }>;
  } | null>(null);
  
  const supabase = createClient();

  // 모든 품목의 발주/수주번호가 동일한지 확인
  const isSamePONumber = useMemo(() => {
    if (!statementWithItems?.items.length) return true;
    
    const poNumbers = statementWithItems.items
      .map(item => item.extracted_po_number ? normalizeOrderNumber(item.extracted_po_number) : null)
      .filter(Boolean);
    
    if (poNumbers.length === 0) return true;
    
    return poNumbers.every(po => po === poNumbers[0]);
  }, [statementWithItems]);

  // 공통 발주/수주번호 (Case 1용)
  const commonPONumber = useMemo(() => {
    if (!statementWithItems?.items.length) return null;
    
    const poNumber = statementWithItems.items.find(item => item.extracted_po_number)?.extracted_po_number;
    return poNumber ? normalizeOrderNumber(poNumber) : null;
  }, [statementWithItems]);

  // 거래처명 초기값 설정
  useEffect(() => {
    if (!statementWithItems) return;
    const initialVendor = statementWithItems.vendor_name || '';
    if (initialVendor && !vendorInputValue) {
      setVendorInputValue(initialVendor);
    }
    if (initialVendor && !autoVendorSelectionRef.current) {
      autoVendorSelectionRef.current = true;
      handleSelectVendor(initialVendor, { silent: true });
    }
  }, [statementWithItems, vendorInputValue]);

  const normalizeStatementDate = (value?: string | null) => {
    if (!value) return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return trimmed.slice(0, 10);
  };

  // 거래일 초기값 설정
  useEffect(() => {
    if (!statementWithItems) return;
    setStatementDateInput(normalizeStatementDate(statementWithItems.statement_date));
  }, [statementWithItems]);

  // 데이터 로드
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        const { data: employee } = await supabase
          .from('employees')
          .select('name')
          .eq('email', user.email)
          .single();
        
        if (employee?.name) {
          setConfirmerName(employee.name);
        }
      }

      const result = await transactionStatementService.getStatementWithItems(statement.id);
      
      if (result.success && result.data) {
        setStatementWithItems(result.data);
        
        // 초기 발주번호 설정 및 자동 매칭
        const initialPONumbers = new Map<string, string>();
        const initialMatches = new Map<string, SystemPurchaseItem | null>();
        
        result.data.items.forEach(item => {
          // 추출된 발주번호 설정 (시스템 형식으로 정규화)
          let poNumber = '';
          if (item.extracted_po_number) {
            poNumber = normalizeOrderNumber(item.extracted_po_number);
            initialPONumbers.set(item.id, poNumber);
          }
          
          // 기존 매칭 정보가 있으면 설정
          if (item.matched_purchase && item.matched_item_id) {
            initialMatches.set(item.id, {
              purchase_id: item.matched_purchase_id!,
              item_id: item.matched_item_id!,
              purchase_order_number: item.matched_purchase.purchase_order_number || '',
              sales_order_number: item.matched_purchase.sales_order_number,
              item_name: (item as any).matched_item_name || '',
              quantity: (item as any).matched_item_quantity,
              unit_price: (item as any).matched_item_unit_price,
              amount: (item as any).matched_item_amount,
              vendor_name: item.matched_purchase.vendor_name
            });
          } else {
            // 자동 매칭: 해당 발주번호의 후보 중에서 가장 유사한 품목 찾기
            let bestMatch: SystemPurchaseItem | null = null;
            let bestScore = -1;
            
            // 1. 해당 발주번호와 일치하는 후보 검색
            const matchingCandidates = item.match_candidates?.filter(c => 
              c.purchase_order_number === poNumber || c.sales_order_number === poNumber
            ) || [];
            
            for (const c of matchingCandidates) {
              const score = calculateItemSimilarity(item.extracted_item_name || '', c.item_name, c.specification);
              if (score > bestScore) {
                bestScore = score;
                bestMatch = {
                  purchase_id: c.purchase_id,
                  item_id: c.item_id,
                  purchase_order_number: c.purchase_order_number || '',
                  sales_order_number: c.sales_order_number,
                  item_name: c.item_name,
                  specification: c.specification,
                  quantity: c.quantity,
                  unit_price: c.unit_price,
                  amount: (c as any).amount,
                  vendor_name: c.vendor_name
                };
              }
            }
            
            // 2. 발주번호로 못 찾으면 모든 후보에서 최고 유사도로 검색 (fallback)
            if (!bestMatch && item.match_candidates && item.match_candidates.length > 0) {
              for (const c of item.match_candidates) {
                const score = calculateItemSimilarity(item.extracted_item_name || '', c.item_name, c.specification);
                if (score > bestScore && score >= 40) { // 최소 40점 이상 (더 엄격)
                  bestScore = score;
                  bestMatch = {
                    purchase_id: c.purchase_id,
                    item_id: c.item_id,
                    purchase_order_number: c.purchase_order_number || '',
                    sales_order_number: c.sales_order_number,
                    item_name: c.item_name,
                    specification: c.specification,
                    quantity: c.quantity,
                    unit_price: c.unit_price,
                    amount: (c as any).amount,
                    vendor_name: c.vendor_name
                  };
                }
              }
              
              // fallback으로 찾았으면 발주번호도 시스템 것으로 업데이트 (OCR 오류 수정)
              if (bestMatch) {
                const matchedPO = bestMatch.purchase_order_number || bestMatch.sales_order_number || '';
                if (matchedPO) {
                  initialPONumbers.set(item.id, matchedPO);
                }
              }
            }
            
            initialMatches.set(item.id, bestMatch);
          }
        });
        
        setItemPONumbers(initialPONumbers);
        setItemMatches(initialMatches);
        
        // Case 1: 공통 발주번호 설정
        const firstPO = result.data.items.find(i => i.extracted_po_number)?.extracted_po_number;
        if (firstPO) {
          setSelectedPONumber(normalizeOrderNumber(firstPO));
        }
        
        // 세트 매칭 실행 (Case 1: 모든 품목이 같은 발주번호일 때)
        // 발주번호가 동일한지 확인
        const poNumbers = result.data.items
          .map(item => item.extracted_po_number ? normalizeOrderNumber(item.extracted_po_number) : null)
          .filter(Boolean);
        const allSamePO = poNumbers.length === 0 || poNumbers.every(po => po === poNumbers[0]);
        
        if (allSamePO) {
          // 세트 매칭 호출 - 전체 품목 비교 (거래처 필터링 포함)
          const setMatchResponse = await transactionStatementService.findBestMatchingPurchaseOrderSet(
            result.data.items,
            firstPO,
            result.data.vendor_name // 거래처명 전달
          );
          
          if (setMatchResponse.success && setMatchResponse.data) {
            setSetMatchResult(setMatchResponse.data);
            
            // 세트 매칭 결과로 최적 발주번호 자동 선택
            if (setMatchResponse.data.bestMatch) {
              const bestPO = setMatchResponse.data.bestMatch.purchase_order_number || 
                            setMatchResponse.data.bestMatch.sales_order_number || '';
              setSelectedPONumber(bestPO);
              
              // 세트 매칭 결과로 품목들 자동 매칭
              const autoMatchedItems = new Map<string, SystemPurchaseItem | null>();
              
              setMatchResponse.data.bestMatch.itemMatches.forEach(match => {
                // 해당 시스템 품목 정보 찾기
                for (const item of result.data!.items) {
                  const candidate = item.match_candidates?.find(c => c.item_id === match.systemItemId);
                  if (candidate) {
                    autoMatchedItems.set(match.ocrItemId, {
                      purchase_id: candidate.purchase_id,
                      item_id: candidate.item_id,
                      purchase_order_number: candidate.purchase_order_number || '',
                      sales_order_number: candidate.sales_order_number,
                      item_name: candidate.item_name,
                      specification: candidate.specification,
                      quantity: candidate.quantity,
                      unit_price: candidate.unit_price,
                      amount: (candidate as any).amount,
                      vendor_name: candidate.vendor_name
                    });
                    break;
                  }
                }
              });
              
              // 기존 매칭에 세트 매칭 결과 병합 (세트 매칭 우선)
              const mergedMatches = new Map(initialMatches);
              autoMatchedItems.forEach((value, key) => {
                if (value) mergedMatches.set(key, value);
              });
              setItemMatches(mergedMatches);
              
              // 세트 매칭 성공 알림
              const confidence = setMatchResponse.data.bestMatch.confidence;
              const confText = confidence === 'high' ? '높음' : confidence === 'medium' ? '보통' : '낮음';
              toast.success(
                `세트 매칭 완료! ${setMatchResponse.data.bestMatch.matchedItemCount}/${result.data.items.length}개 품목 매칭 (신뢰도: ${confText})`
              );
            }
          }
        }
      } else {
        toast.error(result.error || '데이터를 불러오는데 실패했습니다.');
      }
    } catch (error) {
      toast.error('데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [statement.id, supabase]);

  useEffect(() => {
    if (isOpen && statement) {
      setManuallySelectedPO(false); // 모달 열릴 때 수동 선택 플래그 리셋
      loadData();
    }
  }, [isOpen, statement, loadData]);

  // 발주번호 변경 시 itemMatches 자동 동기화 + 매칭된 시스템 발주번호로 업데이트
  useEffect(() => {
    if (!statementWithItems || !isOpen) return;
    
    // 아직 초기 로드 중이면 스킵
    if (loading) return;
    
    const newMatches = new Map<string, SystemPurchaseItem | null>();
    const newPONumbers = new Map<string, string>(itemPONumbers);
    let hasMatchChanges = false;
    let hasPOChanges = false;
    
    statementWithItems.items.forEach(ocrItem => {
      const currentMatch = itemMatches.get(ocrItem.id);
      
      // 현재 적용해야 할 발주번호
      const poNumber = isSamePONumber 
        ? selectedPONumber 
        : (itemPONumbers.get(ocrItem.id) || (ocrItem.extracted_po_number ? normalizeOrderNumber(ocrItem.extracted_po_number) : ''));
      
      // 현재 매칭이 있고 발주번호가 일치하면 유지
      if (currentMatch && (currentMatch.purchase_order_number === poNumber || currentMatch.sales_order_number === poNumber)) {
        newMatches.set(ocrItem.id, currentMatch);
        return;
      }
      
      // 새로운 매칭 찾기
      let bestMatch: SystemPurchaseItem | null = null;
      let bestScore = -1;
      
      // 해당 발주번호 후보에서 검색
      const matchingCandidates = poNumber 
        ? ocrItem.match_candidates?.filter(c => 
            c.purchase_order_number === poNumber || c.sales_order_number === poNumber
          ) || []
        : [];
      
      for (const c of matchingCandidates) {
        const score = calculateItemSimilarity(ocrItem.extracted_item_name || '', c.item_name, c.specification);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            purchase_id: c.purchase_id,
            item_id: c.item_id,
            purchase_order_number: c.purchase_order_number || '',
            sales_order_number: c.sales_order_number,
            item_name: c.item_name,
            specification: c.specification,
            quantity: c.quantity,
            unit_price: c.unit_price,
            amount: (c as any).amount,
            vendor_name: c.vendor_name
          };
        }
      }
      
      // 못 찾으면 전체 후보에서 검색 (fallback)
      if (!bestMatch && ocrItem.match_candidates) {
        for (const c of ocrItem.match_candidates) {
          const score = calculateItemSimilarity(ocrItem.extracted_item_name || '', c.item_name, c.specification);
          if (score > bestScore && score >= 40) { // 최소 40점 이상
            bestScore = score;
            bestMatch = {
              purchase_id: c.purchase_id,
              item_id: c.item_id,
              purchase_order_number: c.purchase_order_number || '',
              sales_order_number: c.sales_order_number,
              item_name: c.item_name,
              specification: c.specification,
              quantity: c.quantity,
              unit_price: c.unit_price,
              amount: (c as any).amount,
              vendor_name: c.vendor_name
            };
          }
        }
      }
      
      newMatches.set(ocrItem.id, bestMatch);
      
      // 매칭된 시스템 품목의 발주번호로 표시 번호 업데이트 (OCR 오류 수정)
      if (bestMatch) {
        const matchedPO = bestMatch.purchase_order_number || bestMatch.sales_order_number || '';
        const currentDisplayPO = itemPONumbers.get(ocrItem.id) || '';
        
        // 현재 표시 번호와 다르면 시스템 번호로 업데이트
        if (matchedPO && matchedPO !== currentDisplayPO) {
          newPONumbers.set(ocrItem.id, matchedPO);
          hasPOChanges = true;
        }
      }
      
      // 변경 감지
      if (currentMatch !== bestMatch) {
        hasMatchChanges = true;
      }
    });
    
    // 변경이 있을 때만 상태 업데이트 (무한 루프 방지)
    if (hasMatchChanges) {
      setItemMatches(newMatches);
    }
    
    // 발주번호 표시도 시스템 것으로 업데이트
    if (hasPOChanges) {
      setItemPONumbers(newPONumbers);
    }
  }, [selectedPONumber, isSamePONumber, statementWithItems, isOpen, loading]);

  // 발주/수주번호 후보 목록 (세트 매칭 결과 + 기존 후보)
  // - 세트 매칭 결과가 있으면 점수 포함하여 정렬
  // - OCR에서 F로 시작하는 번호 추출 → 발주번호만 표시
  // - OCR에서 HS로 시작하는 번호 추출 → 수주번호만 표시
  // - OCR에서 번호 없음 → 발주번호 기본값
  const allPONumberCandidates = useMemo(() => {
    if (!statementWithItems) return [];
    
    // 첫 번째 OCR 추출 번호로 타입 결정 (F vs HS)
    const firstExtracted = statementWithItems.items.find(i => i.extracted_po_number)?.extracted_po_number || '';
    const normalizedFirst = firstExtracted ? normalizeOrderNumber(firstExtracted).toUpperCase() : '';
    const useSONumber = normalizedFirst.startsWith('HS');
    
    type CandidateMapValue = {
      poNumber: string;
      salesOrderNumber?: string;
      itemCount: number;
      items: MatchCandidate[];
      vendorName?: string;
      setMatchScore?: number; // 세트 매칭 점수 (정렬용, 발주번호 보너스 포함)
      displayScore?: number; // 표시용 점수 (실제 품목 유사도, 최대 100%)
      matchedItemCount?: number;
      purchaseId?: number; // 발주 상세 모달용
      quantityMatchedCount?: number; // 수량 일치 품목 수
      quantityMismatchedCount?: number; // 수량 불일치 품목 수
    };
    
    const candidateMap = new Map<string, CandidateMapValue>();
    
    // 1. 세트 매칭 결과가 있으면 먼저 추가 (점수 포함)
    if (setMatchResult?.candidates) {
      setMatchResult.candidates.forEach(candidate => {
        const key = useSONumber 
          ? (candidate.sales_order_number || candidate.purchase_order_number)
          : candidate.purchase_order_number;
        
        if (key) {
          candidateMap.set(key, {
            poNumber: candidate.purchase_order_number || '',
            salesOrderNumber: candidate.sales_order_number,
            itemCount: candidate.matchedItemCount,
            items: [] as MatchCandidate[],
            vendorName: candidate.vendor_name,
            setMatchScore: candidate.matchScore,
            matchedItemCount: candidate.matchedItemCount,
            purchaseId: candidate.purchase_id
          });
        }
      });
    }
    
    // 2. 기존 개별 매칭 후보도 추가 (세트 매칭에 없는 것만)
    statementWithItems.items.forEach(item => {
      item.match_candidates?.forEach(candidate => {
        const key = useSONumber 
          ? (candidate.sales_order_number || '') 
          : (candidate.purchase_order_number || '');
        
        if (key && !candidateMap.has(key)) {
          candidateMap.set(key, {
            poNumber: candidate.purchase_order_number || '',
            salesOrderNumber: candidate.sales_order_number,
            itemCount: 0,
            items: [] as MatchCandidate[],
            vendorName: candidate.vendor_name,
            purchaseId: candidate.purchase_id
          });
        }
        
        if (key && candidateMap.has(key)) {
          const existing = candidateMap.get(key)!;
          existing.items.push(candidate);
          if (!existing.setMatchScore) {
            existing.itemCount = existing.items.length;
          }
        }
      });
    });
    
    // 2.6. PO 아이템 맵 기반 후보 추가 (매칭 후보가 비어있어도 표시)
    if (poItemsMap.size > 0) {
      poItemsMap.forEach((items, key) => {
        const normalizedKey = normalizeOrderNumber(key);
        const isSO = normalizedKey.startsWith('HS');
        if (useSONumber && !isSO) return;
        if (!useSONumber && isSO) return;
        
        if (!candidateMap.has(normalizedKey)) {
          candidateMap.set(normalizedKey, {
            poNumber: isSO ? '' : normalizedKey,
            salesOrderNumber: isSO ? normalizedKey : undefined,
            itemCount: items.length,
            items: items.map((item): MatchCandidate => ({
              purchase_id: item.purchase_id,
              purchase_order_number: item.purchase_order_number || '',
              sales_order_number: item.sales_order_number,
              item_id: item.item_id,
              item_name: item.item_name,
              specification: item.specification,
              quantity: item.quantity ?? 0,
              unit_price: item.unit_price,
              vendor_name: item.vendor_name,
              score: 0,
              match_reasons: ['po_items_map']
            })),
            vendorName: items[0]?.vendor_name,
            purchaseId: items[0]?.purchase_id
          });
        }
      });
    }
    
    // 2.5. 세트 매칭 점수가 없는 후보들에 대해 개별 품목 유사도 평균 계산 + 수량 일치 여부
    candidateMap.forEach((candidate: CandidateMapValue, key) => {
      // 각 OCR 품목과 해당 발주의 품목 간 최대 유사도 계산 + 수량 일치 확인
      let totalScore = 0;
      let matchedCount = 0;
      let quantityMatchedCount = 0;
      let quantityMismatchedCount = 0;
      const normalizedKey = normalizeOrderNumber(key).toUpperCase();
      const extractedOrderNumbers = statementWithItems.items
        .map(item => {
          const value = getOCRItemValue(item, 'po_number') as string;
          return value ? normalizeOrderNumber(value).toUpperCase() : null;
        })
        .filter(Boolean) as string[];
      const hasOrderNumberMatch = extractedOrderNumbers.some(num => num === normalizedKey);
      
      const candidateItems = candidate.items as MatchCandidate[];
      
      statementWithItems.items.forEach(ocrItem => {
        // 해당 발주의 품목들 중 가장 유사한 것 찾기
        let bestScore = 0;
        let bestMatchItem: MatchCandidate | null = null;
        const ocrItemName = getOCRItemValue(ocrItem, 'item_name') as string;
        
        for (const sysItem of candidateItems) {
          const item: MatchCandidate = sysItem;
          const score = calculateItemSimilarity(
            ocrItemName || '', 
            item.item_name, 
            item.specification
          );
          if (score > bestScore) {
            bestScore = score;
            bestMatchItem = item;
          }
        }
        
        if (bestScore >= 40 && bestMatchItem !== null) {
          matchedCount++;
          
          // 수량 일치 여부 확인
          const ocrQtyRaw = getOCRItemValue(ocrItem, 'quantity');
          const ocrQty = typeof ocrQtyRaw === 'number'
            ? ocrQtyRaw
            : (ocrQtyRaw !== '' ? Number(ocrQtyRaw) : undefined);
          const matchItem: MatchCandidate = bestMatchItem as MatchCandidate;
          const sysQty: number = matchItem.quantity;
          if (ocrQty !== undefined && !Number.isNaN(ocrQty) && isQuantityMatched(ocrQty, sysQty)) {
            quantityMatchedCount++;
          } else {
            quantityMismatchedCount++;
          }
        }
        totalScore += bestScore;
      });
      
      // 평균 점수 계산 (수량 일치 보너스 포함)
      const baseScore = statementWithItems.items.length > 0 
        ? Math.round(totalScore / statementWithItems.items.length)
        : 0;
      
      // 수량 일치 보너스: 모든 매칭 품목의 수량이 일치하면 +10점
      const quantityBonus = (matchedCount > 0 && quantityMatchedCount === matchedCount) ? 10 : 0;
      
      // 실제 품목 유사도 점수 (최대 100%)
      const actualScore = Math.min(100, baseScore + quantityBonus);
      
      // 발주번호 일치는 가장 높은 우선순위 (정렬용 보너스)
      const orderNumberBonus = hasOrderNumberMatch ? 100 : 0;
      
      if (candidate.setMatchScore === undefined) {
        candidate.setMatchScore = actualScore + orderNumberBonus; // 정렬용
        candidate.displayScore = actualScore; // 표시용 (실제 유사도)
        candidate.matchedItemCount = matchedCount;
      } else if (hasOrderNumberMatch) {
        // 세트 매칭 결과가 있어도 발주번호 일치 보너스 추가
        candidate.setMatchScore = (candidate.setMatchScore ?? 0) + orderNumberBonus;
        // displayScore는 원래 값 유지 (없으면 setMatchScore 사용)
        if (candidate.displayScore === undefined) {
          candidate.displayScore = candidate.setMatchScore - orderNumberBonus;
        }
      }
      
      candidate.quantityMatchedCount = quantityMatchedCount;
      candidate.quantityMismatchedCount = quantityMismatchedCount;
      (candidate as any).hasOrderNumberMatch = hasOrderNumberMatch;
    });
    
    // 3. 정렬: 발주번호 일치 여부 먼저, 그 다음 점수순
    const result = Array.from(candidateMap.values());
    
    
    result.sort((a, b) => {
      // 먼저 발주번호 일치 여부로 정렬 (일치하는 것이 맨 위)
      const aHasMatch = (a as any).hasOrderNumberMatch ? 1 : 0;
      const bHasMatch = (b as any).hasOrderNumberMatch ? 1 : 0;
      if (aHasMatch !== bHasMatch) {
        return bHasMatch - aHasMatch;
      }
      
      // 그 다음 점수순
      const scoreA = a.setMatchScore ?? 0;
      const scoreB = b.setMatchScore ?? 0;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return b.itemCount - a.itemCount;
    });
    
    return result;
  }, [statementWithItems, setMatchResult, poItemsMap, editedOCRItems]);

  const getPairedOrderNumber = useCallback((value?: string | null): string | undefined => {
    if (!value) return undefined;
    const normalizedValue = normalizeOrderNumber(value);
    const candidate = allPONumberCandidates.find(
      c =>
        c.poNumber === normalizedValue ||
        c.salesOrderNumber === normalizedValue ||
        c.poNumber === value ||
        c.salesOrderNumber === value
    );
    if (candidate) {
      if (normalizedValue.startsWith('F')) return candidate.salesOrderNumber;
      if (normalizedValue.startsWith('HS')) return candidate.poNumber;
      return candidate.salesOrderNumber || candidate.poNumber;
    }
    const items = poItemsMap.get(normalizedValue) || poItemsMap.get(value) || [];
    if (items.length > 0) {
      const item = items[0];
      if (normalizedValue.startsWith('F')) return item.sales_order_number;
      if (normalizedValue.startsWith('HS')) return item.purchase_order_number || item.purchase_order_number;
      return item.sales_order_number || item.purchase_order_number;
    }
    return undefined;
  }, [allPONumberCandidates, poItemsMap]);

  const getPairedOrderNumberWithOverrides = (value?: string | null): string | undefined => {
    if (!value) return undefined;
    const normalized = normalizeOrderNumber(value);
    const override = poPairOverrides.get(normalized);
    if (override !== undefined) {
      return override || undefined;
    }
    return getPairedOrderNumber(value);
  };

  // 발주번호 일치하는 후보를 최우선 선택, 없으면 첫 번째 후보로 자동 변경
  // (단, 사용자가 수동으로 선택한 경우는 건너뜀)
  useEffect(() => {
    if (!allPONumberCandidates.length || !isSamePONumber) return;

    // 사용자가 수동으로 발주번호를 선택한 경우 자동 교정 건너뜀
    if (manuallySelectedPO) return;

    // 발주번호 일치하는 후보 찾기 (hasOrderNumberMatch가 true인 것)
    const matchingCandidate = allPONumberCandidates.find(
      c => (c as any).hasOrderNumberMatch === true
    );

    if (matchingCandidate) {
      const matchingPO = matchingCandidate.poNumber || matchingCandidate.salesOrderNumber || '';
      // 현재 선택된 것과 다르면 변경
      if (matchingPO && matchingPO !== selectedPONumber) {
        console.log(`[자동 선택] 발주번호 일치 후보 "${matchingPO}"로 자동 선택`);
        setSelectedPONumber(matchingPO);
        return;
      }
    }

    // 발주번호 일치 후보가 없으면, 현재 선택이 후보 목록에 있는지 확인
    const isInCandidates = allPONumberCandidates.some(
      c => c.poNumber === selectedPONumber || c.salesOrderNumber === selectedPONumber
    );

    // 후보 목록에 없으면 첫 번째 후보로 자동 변경
    if (!isInCandidates && allPONumberCandidates[0]) {
      const firstCandidate = allPONumberCandidates[0];
      const newPO = firstCandidate.poNumber || firstCandidate.salesOrderNumber || '';
      if (newPO) {
        console.log(`[자동 수정] OCR 발주번호 "${selectedPONumber}"가 DB에 없음 → 추천 발주 "${newPO}"로 변경`);
        setSelectedPONumber(newPO);
      }
    }
  }, [allPONumberCandidates, selectedPONumber, isSamePONumber, manuallySelectedPO]);

  // 특정 발주번호에 해당하는 시스템 품목들
  const getSystemItemsForPO = useCallback((poNumber: string): SystemPurchaseItem[] => {
    if (!statementWithItems || !poNumber) return [];
    const mappedItems = poItemsMap.get(poNumber) || [];
    if (mappedItems.length > 0) {
      const deduped = mappedItems.filter((item, index, self) => 
        index === self.findIndex(t => t.item_id === item.item_id)
      );
      return deduped;
    }
    
    const items: SystemPurchaseItem[] = [];
    
    statementWithItems.items.forEach(item => {
      item.match_candidates?.forEach(candidate => {
        if (candidate.purchase_order_number === poNumber || 
            candidate.sales_order_number === poNumber) {
          items.push({
            purchase_id: candidate.purchase_id,
            item_id: candidate.item_id,
            purchase_order_number: candidate.purchase_order_number || '',
            sales_order_number: candidate.sales_order_number,
            item_name: candidate.item_name,
            specification: candidate.specification,
            quantity: candidate.quantity,
            unit_price: candidate.unit_price,
            amount: (candidate as any).amount, // amount는 일부 후보에만 존재
            vendor_name: candidate.vendor_name
          });
        }
      });
    });
    
    // 중복 제거
    const deduped = items.filter((item, index, self) => 
      index === self.findIndex(t => t.item_id === item.item_id)
    );
    return deduped;
  }, [statementWithItems, poItemsMap]);

  // 특정 OCR 품목에 대한 발주번호 후보 목록 (시스템 데이터베이스에서 가져온 것만)
  // - OCR에서 F로 시작하는 번호 추출 → 발주번호(purchase_order_number)만 표시
  // - OCR에서 HS로 시작하는 번호 추출 → 수주번호(sales_order_number)만 표시
  // - OCR에서 번호 없음 → 발주번호(purchase_order_number) 기본값
  const getPOCandidatesForItem = useCallback((ocrItemId: string): string[] => {
    if (!statementWithItems) return [];
    
    const item = statementWithItems.items.find(i => i.id === ocrItemId);
    if (!item) return [];
    
    const poNumbers = new Set<string>();
    
    // OCR 추출 번호 정규화
    const extractedNumber = item.extracted_po_number 
      ? normalizeOrderNumber(item.extracted_po_number).toUpperCase() 
      : '';
    
    // 추출된 번호가 HS로 시작하면 수주번호, 그 외(F 또는 없음)는 발주번호
    const useSONumber = extractedNumber.startsWith('HS');
    
    // 매칭 후보들에서 적절한 번호만 추가
    item.match_candidates?.forEach(c => {
      if (useSONumber) {
        // 수주번호만 추가
        if (c.sales_order_number) poNumbers.add(c.sales_order_number);
      } else {
        // 발주번호만 추가 (기본값)
        if (c.purchase_order_number) poNumbers.add(c.purchase_order_number);
      }
    });
    
    return Array.from(poNumbers);
  }, [statementWithItems]);

  // OCR 품목 편집 함수
  const handleEditOCRItem = (itemId: string, field: keyof EditedOCRItem, value: string | number) => {
    setEditedOCRItems(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(itemId) || {};
      newMap.set(itemId, { ...existing, [field]: value });
      return newMap;
    });
  };

  // OCR 품목의 현재 값 가져오기 (수정된 값 우선)
  function getOCRItemValue(
    ocrItem: TransactionStatementItemWithMatch,
    field: 'item_name' | 'quantity' | 'unit_price' | 'amount' | 'po_number'
  ) {
    const edited = editedOCRItems.get(ocrItem.id);
    if (edited && edited[field] !== undefined) {
      return edited[field];
    }

    switch (field) {
      case 'item_name':
        return ocrItem.extracted_item_name || '';
      case 'quantity':
        return ocrItem.extracted_quantity ?? '';
      case 'unit_price':
        return ocrItem.extracted_unit_price ?? '';
      case 'amount':
        return ocrItem.extracted_amount ?? '';
      case 'po_number':
        return ocrItem.extracted_po_number ? normalizeOrderNumber(ocrItem.extracted_po_number) : '';
      default:
        return '';
    }
  }

  // 수정 여부 확인 (원본과 다른지)
  const isOCRItemEdited = (ocrItem: TransactionStatementItemWithMatch, field: 'item_name' | 'quantity' | 'unit_price' | 'amount' | 'po_number'): boolean => {
    const edited = editedOCRItems.get(ocrItem.id);
    if (!edited || edited[field] === undefined) return false;
    
    switch (field) {
      case 'item_name': return edited.item_name !== ocrItem.extracted_item_name;
      case 'quantity': return edited.quantity !== ocrItem.extracted_quantity;
      case 'unit_price': return edited.unit_price !== ocrItem.extracted_unit_price;
      case 'amount': return edited.amount !== ocrItem.extracted_amount;
      case 'po_number': {
        const original = ocrItem.extracted_po_number ? normalizeOrderNumber(ocrItem.extracted_po_number) : '';
        return edited.po_number !== original;
      }
      default: return false;
    }
  };

  // 학습 데이터 저장 (확정 시 호출)
  const saveOCRCorrections = async () => {
    if (!statementWithItems) return;
    
    const corrections: Array<{
      statement_id: string;
      statement_item_id: string;
      original_text: string;
      corrected_text: string;
      field_type: OCRFieldType;
    }> = [];
    
    statementWithItems.items.forEach(ocrItem => {
      const edited = editedOCRItems.get(ocrItem.id);
      if (!edited) return;
      
      // 각 필드별로 수정 사항 확인
      if (edited.item_name !== undefined && edited.item_name !== ocrItem.extracted_item_name) {
        corrections.push({
          statement_id: statementWithItems.id,
          statement_item_id: ocrItem.id,
          original_text: ocrItem.extracted_item_name || '',
          corrected_text: edited.item_name,
          field_type: 'item_name'
        });
      }
      
      if (edited.quantity !== undefined && edited.quantity !== ocrItem.extracted_quantity) {
        corrections.push({
          statement_id: statementWithItems.id,
          statement_item_id: ocrItem.id,
          original_text: String(ocrItem.extracted_quantity ?? ''),
          corrected_text: String(edited.quantity),
          field_type: 'quantity'
        });
      }
      
      if (edited.unit_price !== undefined && edited.unit_price !== ocrItem.extracted_unit_price) {
        corrections.push({
          statement_id: statementWithItems.id,
          statement_item_id: ocrItem.id,
          original_text: String(ocrItem.extracted_unit_price ?? ''),
          corrected_text: String(edited.unit_price),
          field_type: 'unit_price'
        });
      }
      
      if (edited.amount !== undefined && edited.amount !== ocrItem.extracted_amount) {
        corrections.push({
          statement_id: statementWithItems.id,
          statement_item_id: ocrItem.id,
          original_text: String(ocrItem.extracted_amount ?? ''),
          corrected_text: String(edited.amount),
          field_type: 'amount'
        });
      }
      
      if (edited.po_number !== undefined) {
        const original = ocrItem.extracted_po_number ? normalizeOrderNumber(ocrItem.extracted_po_number) : '';
        if (edited.po_number !== original) {
          corrections.push({
            statement_id: statementWithItems.id,
            statement_item_id: ocrItem.id,
            original_text: original,
            corrected_text: edited.po_number,
            field_type: 'po_number'
          });
        }
      }
    });
    
    // 학습 데이터 저장
    if (corrections.length > 0) {
      console.log(`📚 학습 데이터 저장: ${corrections.length}건의 수정사항`);
      for (const correction of corrections) {
        await transactionStatementService.saveCorrection(correction);
      }
      toast.success(`${corrections.length}건의 OCR 수정사항이 학습 데이터로 저장되었습니다.`);
    }
  };

  // 매칭 상태 계산 (item_name과 specification 교차 비교)
  // itemMatches에 없어도 현재 표시된 시스템 품목으로 fallback
  const getMatchStatus = (ocrItem: TransactionStatementItemWithMatch): 'high' | 'med' | 'low' | 'unmatched' => {
    // 1. 먼저 itemMatches에서 확인
    const matched = itemMatches.get(ocrItem.id);
    
    // 2. itemMatches에 없으면 현재 표시된 시스템 품목에서 찾기
    let effectiveMatch: SystemPurchaseItem | null = matched || null;
    let hasSystemItems = false;
    
    if (!effectiveMatch) {
      const poNumber = isSamePONumber 
        ? selectedPONumber 
        : (itemPONumbers.get(ocrItem.id) || (ocrItem.extracted_po_number ? normalizeOrderNumber(ocrItem.extracted_po_number) : ''));
      
      if (poNumber) {
        const systemItems = getSystemItemsForPO(poNumber);
        hasSystemItems = systemItems.length > 0;
        
        // 가장 유사한 품목 찾기
        let bestScore = 0;
        systemItems.forEach(sysItem => {
          const score = calculateItemSimilarity(ocrItem.extracted_item_name || '', sysItem.item_name, sysItem.specification);
          if (score > bestScore) {
            bestScore = score;
            effectiveMatch = sysItem;
          }
        });
      }
    }
    
    if (!effectiveMatch) return 'unmatched';
    
    const similarity = calculateItemSimilarity(ocrItem.extracted_item_name || '', effectiveMatch.item_name || '', effectiveMatch.specification);
    
    // 더 엄격한 임계값 적용
    if (similarity >= 85) return 'high';   // 높음: 85% 이상 (기존 80%)
    if (similarity >= 60) return 'med';    // 보통: 60% 이상 (기존 50%)
    if (similarity >= 40) return 'low';    // 낮음: 40% 이상 (기존 30%)
    
    // 40% 미만이면 매칭 안됨으로 표시 (기존: 시스템 품목 있으면 무조건 'low')
    return 'unmatched';
  };

  // 발주번호 선택 시 (Case 1: 전체 적용)
  const handleSelectGlobalPO = async (poNumber: string, vendorNameFromSearch?: string, soNumberFromSearch?: string) => {
    setSelectedPONumber(poNumber);

    // 검색에서 수주번호가 전달된 경우 페어 캐시에 저장
    if (soNumberFromSearch) {
      const normalizedPO = normalizeOrderNumber(poNumber);
      setPoPairOverrides(prev => {
        const next = new Map(prev);
        next.set(normalizedPO, soNumberFromSearch);
        return next;
      });
    }

    // 해당 발주번호의 시스템 품목들 가져오기
    // 1. allPONumberCandidates에서 해당 발주의 items와 purchaseId 찾기
    const poCandidate = allPONumberCandidates.find(
      c => c.poNumber === poNumber || c.salesOrderNumber === poNumber
    );

    // 2. items 배열을 SystemPurchaseItem 형태로 변환
    let systemItems: SystemPurchaseItem[] = [];
    let vendorName = vendorNameFromSearch || '';

    if (poCandidate && poCandidate.items.length > 0) {
      systemItems = poCandidate.items.map(item => ({
        purchase_id: item.purchase_id,
        item_id: item.item_id,
        purchase_order_number: item.purchase_order_number || '',
        sales_order_number: item.sales_order_number,
        item_name: item.item_name,
        specification: item.specification,
        quantity: item.quantity,
        unit_price: item.unit_price,
        amount: (item as any).amount,
        vendor_name: item.vendor_name
      }));

      // 중복 제거
      systemItems = systemItems.filter((item, index, self) =>
        index === self.findIndex(t => t.item_id === item.item_id)
      );

      // 거래처명 추출
      if (!vendorName && systemItems[0]?.vendor_name) {
        vendorName = systemItems[0].vendor_name;
      }
    }

    // 3. 없으면 기존 방식으로 fallback
    if (systemItems.length === 0) {
      systemItems = getSystemItemsForPO(poNumber);
      if (!vendorName && systemItems[0]?.vendor_name) {
        vendorName = systemItems[0].vendor_name;
      }
    }

    // 4. 여전히 없으면 DB에서 직접 조회 (검색에서 선택한 경우 포함)
    if (systemItems.length === 0) {
      try {
        // 발주번호로 purchase_request 먼저 찾기
        const { data: purchaseRequest } = await supabase
          .from('purchase_requests')
          .select(`
            id,
            purchase_order_number,
            sales_order_number,
            vendor:vendors(vendor_name)
          `)
          .or(`purchase_order_number.eq.${poNumber},sales_order_number.eq.${poNumber}`)
          .limit(1)
          .single();

        if (purchaseRequest) {
          // 거래처명 설정
          if (!vendorName && (purchaseRequest.vendor as any)?.vendor_name) {
            vendorName = (purchaseRequest.vendor as any).vendor_name;
          }

          // 수주번호/발주번호 페어 저장
          const normalizedPO = normalizeOrderNumber(poNumber);
          const pairedNumber = poNumber.startsWith('F')
            ? purchaseRequest.sales_order_number
            : purchaseRequest.purchase_order_number;
          if (pairedNumber) {
            setPoPairOverrides(prev => {
              const next = new Map(prev);
              next.set(normalizedPO, pairedNumber);
              return next;
            });
          }

          // 품목 조회
          const { data: purchaseItems } = await supabase
            .from('purchase_request_items')
            .select(`
              id,
              item_name,
              specification,
              quantity,
              received_quantity,
              unit_price_value,
              amount_value
            `)
            .eq('purchase_request_id', purchaseRequest.id);

          if (purchaseItems && purchaseItems.length > 0) {
            systemItems = purchaseItems.map((item: any) => ({
              purchase_id: purchaseRequest.id,
              item_id: item.id,
              purchase_order_number: purchaseRequest.purchase_order_number || '',
              sales_order_number: purchaseRequest.sales_order_number,
              item_name: item.item_name || '',
              specification: item.specification,
              quantity: item.quantity,
              received_quantity: item.received_quantity,
              unit_price: item.unit_price_value,
              amount: item.amount_value,
              vendor_name: vendorName
            }));
            console.log('[handleSelectGlobalPO] DB에서 품목 조회 성공:', systemItems.length);
          }
        }
      } catch (error) {
        console.error('[handleSelectGlobalPO] DB 조회 실패:', error);
      }
    }

    console.log('[handleSelectGlobalPO] poNumber:', poNumber, 'systemItems:', systemItems.length, 'vendor:', vendorName);

    // poItemsMap에 품목 추가 (UI에서 후보 표시용)
    if (systemItems.length > 0) {
      setPoItemsMap(prev => {
        const next = new Map(prev);
        next.set(poNumber, systemItems);
        // 수주번호로도 저장 (양방향 조회 가능하도록)
        const salesOrderNumber = systemItems[0]?.sales_order_number;
        if (salesOrderNumber && salesOrderNumber !== poNumber) {
          next.set(salesOrderNumber, systemItems);
        }
        return next;
      });
    }

    // 거래처명 업데이트
    if (vendorName) {
      setVendorInputValue(vendorName);
    }

    // 자동 매칭 수행
    if (statementWithItems) {
      const newMatches = new Map<string, SystemPurchaseItem | null>();

      statementWithItems.items.forEach(ocrItem => {
        // 가장 유사한 시스템 품목 찾기 (item_name과 specification 교차 비교)
        let bestMatch: SystemPurchaseItem | null = null;
        let bestScore = 0;

        systemItems.forEach(sysItem => {
          const score = calculateItemSimilarity(ocrItem.extracted_item_name || '', sysItem.item_name, sysItem.specification);
          if (score > bestScore && score >= 40) { // 최소 40점 이상
            bestScore = score;
            bestMatch = sysItem;
          }
        });

        newMatches.set(ocrItem.id, bestMatch);
      });

      setItemMatches(newMatches);
    }
  };

  // 거래처 인라인 검색 (debounce 처리용)
  const handleVendorSearch = async (searchValue: string) => {
    if (!searchValue.trim()) {
      setVendorSearchResults([]);
      setVendorDropdownOpen(false);
      return;
    }
    
    setVendorSearchLoading(true);
    setVendorDropdownOpen(true);
    
    try {
      const { data: vendors, error } = await supabase
        .from('vendors')
        .select('id, vendor_name')
        .ilike('vendor_name', `%${searchValue}%`)
        .limit(10);
      
      if (error) throw error;
      
      setVendorSearchResults((vendors || []).map((vendor: VendorSearchRow) => ({
        id: vendor.id,
        name: vendor.vendor_name
      })));
    } catch (err) {
      console.error('거래처 검색 오류:', err);
      setVendorSearchResults([]);
    } finally {
      setVendorSearchLoading(false);
    }
  };
  
  // 발주번호 인라인 검색
  const handlePOSearch = async (searchValue: string) => {
    if (!searchValue.trim()) {
      setPOSearchResults([]);
      setPODropdownOpen(false);
      return;
    }
    
    setPOSearchLoading(true);
    setPODropdownOpen(true);
    
    try {
      const normalized = normalizeOrderNumber(searchValue.trim());
      
      const { data: purchases, error } = await supabase
        .from('purchase_requests')
        .select(`
          id,
          purchase_order_number,
          sales_order_number,
          vendor:vendors(vendor_name)
        `)
        .or(`purchase_order_number.ilike.%${normalized}%,sales_order_number.ilike.%${normalized}%`)
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (error) throw error;
      
      setPOSearchResults((purchases || []).map((p: any) => ({
        id: p.id,
        poNumber: p.purchase_order_number || '',
        soNumber: p.sales_order_number,
        vendorName: p.vendor?.vendor_name
      })));
    } catch (err) {
      console.error('발주번호 검색 오류:', err);
      setPOSearchResults([]);
    } finally {
      setPOSearchLoading(false);
    }
  };

  // OCR 발주/수주번호 입력 시 실시간 페어 조회
  const lookupPairedOrderNumber = useCallback(async (rawValue: string) => {
    const trimmed = rawValue.trim();
    if (!trimmed) return;
    const normalized = normalizeOrderNumber(trimmed);
    if (!normalized) return;
    if (poPairOverrides.has(normalized)) return;
    if (pendingPairLookupsRef.current.has(normalized)) return;
    pendingPairLookupsRef.current.add(normalized);
    try {
      const { data, error } = await supabase
        .from('purchase_requests')
        .select('purchase_order_number,sales_order_number')
        .or(`purchase_order_number.eq.${normalized},sales_order_number.eq.${normalized}`)
        .limit(1);
      if (error) throw error;
      const match = data?.[0];
      const pairedNumber = match
        ? (normalized.startsWith('F')
            ? match.sales_order_number
            : normalized.startsWith('HS')
              ? match.purchase_order_number
              : (match.sales_order_number || match.purchase_order_number))
        : null;
      setPoPairOverrides(prev => {
        const next = new Map(prev);
        next.set(normalized, pairedNumber ?? null);
        return next;
      });
    } catch (err) {
      setPoPairOverrides(prev => {
        const next = new Map(prev);
        next.set(normalized, null);
        return next;
      });
    } finally {
      pendingPairLookupsRef.current.delete(normalized);
    }
  }, [poPairOverrides, supabase]);

  // OCR 발주번호 수정 시 시스템 발주품목에도 반영
  const handleOCRPONumberChange = useCallback(async (newValue: string) => {
    lookupPairedOrderNumber(newValue);
    
    // 전체 OCR 품목에 새 발주번호 적용
    if (statementWithItems) {
      statementWithItems.items.forEach(item => {
        handleEditOCRItem(item.id, 'po_number', newValue);
      });
    }
    
    // 시스템 발주품목에도 자동 반영
    const normalizedValue = normalizeOrderNumber(newValue);
    if (!normalizedValue) return;
    
    
    // 후보 목록에서 해당 발주번호 찾기
    const matchingCandidate = allPONumberCandidates.find(
      c => c.poNumber === normalizedValue || c.salesOrderNumber === normalizedValue
    );
    
    if (matchingCandidate) {
      const newPO = matchingCandidate.poNumber || matchingCandidate.salesOrderNumber || '';
      if (newPO && newPO !== selectedPONumber) {
        setSelectedPONumber(newPO);
      }
      if (matchingCandidate.vendorName) {
        setVendorInputValue(matchingCandidate.vendorName);
        setOverrideVendorName(matchingCandidate.vendorName);
      }
    } else {
      // 후보 목록에 없으면 DB에서 직접 조회하여 품목 로드
      setSelectedPONumber(normalizedValue);
      
      try {
        const { data: purchaseData } = await supabase
          .from('purchase_requests')
          .select(`
            id,
            purchase_order_number,
            sales_order_number,
            vendor:vendors(vendor_name),
            purchase_request_items (
              id,
              item_name,
              specification,
              quantity,
              received_quantity,
              unit_price_value,
              amount_value
            )
          `)
          .or(`purchase_order_number.eq.${normalizedValue},sales_order_number.eq.${normalizedValue}`)
          .limit(1);
        
        if (purchaseData && purchaseData.length > 0) {
          const purchase = purchaseData[0];
          const items = purchase.purchase_request_items || [];
          const vendorName = (purchase.vendor as { vendor_name?: string } | null)?.vendor_name || '';
          
          // poItemsMap에 추가
          const newItems = items.map((item: any) => ({
            purchase_id: purchase.id,
            item_id: item.id,
            purchase_order_number: purchase.purchase_order_number || '',
            sales_order_number: purchase.sales_order_number,
            item_name: item.item_name,
            specification: item.specification,
            quantity: item.quantity ?? 0,
            received_quantity: item.received_quantity,
            unit_price: item.unit_price_value,
            amount: item.amount_value,
            vendor_name: vendorName
          }));
          
          setPoItemsMap(prev => {
            const next = new Map(prev);
            next.set(normalizedValue, newItems);
            // 발주번호와 수주번호 모두로 접근 가능하도록
            if (purchase.purchase_order_number) {
              next.set(purchase.purchase_order_number, newItems);
            }
            if (purchase.sales_order_number) {
              next.set(purchase.sales_order_number, newItems);
            }
            return next;
          });

          if (vendorName) {
            setVendorInputValue(vendorName);
            setOverrideVendorName(vendorName);
          }
          
        }
      } catch (err) {
        console.error('발주 품목 조회 오류:', err);
      }
    }
  }, [statementWithItems, allPONumberCandidates, selectedPONumber, lookupPairedOrderNumber, handleEditOCRItem, supabase]);

  // 거래처 선택 시 - 발주 후보 재검색 및 매칭 재실행
  const handleSelectVendor = async (vendorName: string, options?: { silent?: boolean }) => {
    const shouldNotify = !options?.silent;
    setOverrideVendorName(vendorName);
    setVendorInputValue(vendorName);
    setVendorDropdownOpen(false);
    setVendorSearchResults([]);
    
    if (shouldNotify) {
      toast.success(`거래처가 "${vendorName}"(으)로 변경되었습니다. 발주 후보를 다시 검색합니다.`);
    }
    
    // 새 거래처로 발주 후보 재검색
    try {
      const { data: purchases, error } = await supabase
        .from('purchase_requests')
        .select(`
          id,
          purchase_order_number,
          sales_order_number,
          vendor:vendors!inner(vendor_name),
          items:purchase_request_items(
            id,
            item_name,
            specification,
            quantity,
            received_quantity,
            unit_price_value,
            amount_value
          )
        `)
        .eq('vendor.vendor_name', vendorName)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      
      if (!purchases || purchases.length === 0) {
        if (shouldNotify) {
          toast.error(`"${vendorName}" 거래처의 발주 내역이 없습니다.`);
        }
        return;
      }
      
      const itemsMap = new Map<string, SystemPurchaseItem[]>();
      let totalMapItems = 0;
      purchases.forEach((purchase: any) => {
        const mappedItems: SystemPurchaseItem[] = (purchase.items || []).map((item: any) => ({
          purchase_id: purchase.id,
          item_id: item.id,
          purchase_order_number: purchase.purchase_order_number || '',
          sales_order_number: purchase.sales_order_number,
          item_name: item.item_name || '',
          specification: item.specification,
          quantity: item.quantity,
          received_quantity: item.received_quantity,
          unit_price: item.unit_price_value,
          amount: item.amount_value,
          vendor_name: vendorName
        }));
        if (mappedItems.length === 0) return;
        totalMapItems += mappedItems.length;
        if (purchase.purchase_order_number) {
          itemsMap.set(purchase.purchase_order_number, mappedItems);
        }
        if (purchase.sales_order_number) {
          itemsMap.set(purchase.sales_order_number, mappedItems);
        }
      });
      setPoItemsMap(itemsMap);
      
      // 새 발주 후보로 재매칭
      const newCandidates = new Map<string, MatchCandidate[]>();
      const firstPO = purchases[0]?.purchase_order_number || purchases[0]?.sales_order_number || '';
      
      // 품목별 후보 업데이트
      if (statementWithItems) {
        statementWithItems.items.forEach((ocrItem, index) => {
          const candidates: MatchCandidate[] = [];
          let maxSimilarity = 0;
          let comparedCount = 0;
          
          purchases.forEach((purchase: any) => {
            (purchase.items || []).forEach((item: any) => {
              const similarity = calculateItemSimilarity(ocrItem.extracted_item_name || '', item.item_name, item.specification);
              comparedCount += 1;
              if (similarity > maxSimilarity) {
                maxSimilarity = similarity;
              }
              if (similarity >= 40) { // 최소 40점 이상
                candidates.push({
                  purchase_id: purchase.id,
                  item_id: item.id,
                  purchase_order_number: purchase.purchase_order_number || '',
                  sales_order_number: purchase.sales_order_number,
                  item_name: item.item_name || '',
                  specification: item.specification,
                  quantity: item.quantity,
                  unit_price: item.unit_price_value,
                  score: similarity,
                  match_reasons: ['거래처 매칭'],
                  vendor_name: vendorName
                });
              }
            });
          });
          
          if (index === 0) {
          }
          
          candidates.sort((a, b) => b.score - a.score);
          newCandidates.set(ocrItem.id, candidates.slice(0, 5));
        });
        
        // 첫 번째 발주로 자동 매칭
        setSelectedPONumber(firstPO);
        
        const newMatches = new Map<string, SystemPurchaseItem | null>();
        const systemItems: SystemPurchaseItem[] = (purchases[0]?.items || []).map((item: any) => ({
          purchase_id: purchases[0].id,
          item_id: item.id,
          purchase_order_number: purchases[0].purchase_order_number || '',
          sales_order_number: purchases[0].sales_order_number,
          item_name: item.item_name || '',
          specification: item.specification,
          quantity: item.quantity,
          unit_price: item.unit_price_value,
          amount: item.amount_value,
          vendor_name: vendorName
        }));
        
        statementWithItems.items.forEach(ocrItem => {
          let bestMatch: SystemPurchaseItem | null = null;
          let bestScore = 0;
          
          systemItems.forEach(sysItem => {
            const score = calculateItemSimilarity(ocrItem.extracted_item_name || '', sysItem.item_name, sysItem.specification);
            if (score > bestScore && score >= 30) {
              bestScore = score;
              bestMatch = sysItem;
            }
          });
          
          newMatches.set(ocrItem.id, bestMatch);
        });
        
        setItemMatches(newMatches);
        
        // 세트 매칭 결과 업데이트 (allPONumberCandidates 갱신용)
        setSetMatchResult({
          bestMatch: {
            purchase_id: purchases[0].id,
            purchase_order_number: purchases[0].purchase_order_number || '',
            sales_order_number: purchases[0].sales_order_number,
            vendor_name: vendorName,
            matchScore: 100,
            matchedItemCount: newMatches.size,
            totalItemCount: statementWithItems.items.length,
            confidence: 'high',
            itemMatches: []
          },
          candidates: purchases.map((p: any) => ({
            purchase_id: p.id,
            purchase_order_number: p.purchase_order_number || '',
            sales_order_number: p.sales_order_number,
            vendor_name: vendorName,
            matchScore: p.id === purchases[0].id ? 100 : 50,
            matchedItemCount: (p.items || []).length
          }))
        });
        
        if (shouldNotify) {
          toast.success(`${purchases.length}개 발주 후보를 찾았습니다. 자동 매칭 완료.`);
        }
      }
      
    } catch (err) {
      console.error('거래처 발주 검색 오류:', err);
      toast.error('발주 후보 검색 중 오류가 발생했습니다.');
    }
  };

  // 발주번호 선택 시 (Case 2: 개별 품목용)
  const handleSelectItemPO = (ocrItemId: string, poNumber: string) => {
    setItemPONumbers(prev => {
      const newMap = new Map(prev);
      newMap.set(ocrItemId, poNumber);
      return newMap;
    });
    
    const ocrItem = statementWithItems?.items.find(i => i.id === ocrItemId);
    
    if (ocrItem) {
      // 1. match_candidates에서 해당 발주번호 후보 찾기
      const matchingCandidates = ocrItem.match_candidates?.filter(c => 
        c.purchase_order_number === poNumber || c.sales_order_number === poNumber
      ) || [];
      
      let bestMatch: SystemPurchaseItem | null = null;
      let bestScore = -1;
      
      if (matchingCandidates.length > 0) {
        // match_candidates에서 가장 유사한 것 선택
        matchingCandidates.forEach(c => {
          const score = calculateItemSimilarity(ocrItem.extracted_item_name || '', c.item_name, c.specification);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = {
              purchase_id: c.purchase_id,
              item_id: c.item_id,
              purchase_order_number: c.purchase_order_number || '',
              sales_order_number: c.sales_order_number,
              item_name: c.item_name,
              specification: c.specification,
              quantity: c.quantity,
              unit_price: c.unit_price,
              amount: (c as any).amount,
              vendor_name: c.vendor_name
            };
          }
        });
      }
      
      // 2. match_candidates에서 못 찾으면 getSystemItemsForPO로 직접 검색
      if (!bestMatch) {
        const systemItems = getSystemItemsForPO(poNumber);
        systemItems.forEach(sysItem => {
          const score = calculateItemSimilarity(ocrItem.extracted_item_name || '', sysItem.item_name, sysItem.specification);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = sysItem;
          }
        });
      }
      
      // 타입 체크를 위해 final 변수 사용
      const finalMatch = bestMatch as SystemPurchaseItem | null;
      const matchedName = finalMatch?.item_name || '없음';
      console.log(`🔄 발주번호 선택: ${poNumber} → 매칭: ${matchedName} (점수: ${bestScore})`);
      
      setItemMatches(prev => {
        const newMap = new Map(prev);
        newMap.set(ocrItemId, bestMatch);
        return newMap;
      });
    }
    
    setOpenDropdowns(prev => {
      const newSet = new Set(prev);
      newSet.delete(`po-${ocrItemId}`);
      return newSet;
    });
  };

  const getPurchaseIdByNumber = useCallback((poNumber: string) => {
    const candidate = allPONumberCandidates.find(
      c => c.poNumber === poNumber || c.salesOrderNumber === poNumber
    );
    return candidate?.purchaseId || candidate?.items?.[0]?.purchase_id;
  }, [allPONumberCandidates]);

  const handleItemPOSearch = useCallback(async (ocrItemId: string, searchValue: string) => {
    setItemPOSearchInputs(prev => ({ ...prev, [ocrItemId]: searchValue }));

    if (!searchValue || searchValue.trim().length < 2) {
      setItemPOSearchResults(prev => ({ ...prev, [ocrItemId]: [] }));
      return;
    }

    setItemPOSearchLoading(prev => ({ ...prev, [ocrItemId]: true }));

    try {
      const { data, error } = await supabase
        .from('purchase_requests')
        .select(`
          id,
          purchase_order_number,
          sales_order_number,
          vendor:vendors(vendor_name)
        `)
        .or(`purchase_order_number.ilike.%${searchValue}%,sales_order_number.ilike.%${searchValue}%`)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      const results = (data || []).map((row: any) => ({
        id: row.id,
        poNumber: row.purchase_order_number || '',
        soNumber: row.sales_order_number || undefined,
        vendorName: row.vendor?.vendor_name
      }));
      setItemPOSearchResults(prev => ({ ...prev, [ocrItemId]: results }));
    } catch (err) {
      setItemPOSearchResults(prev => ({ ...prev, [ocrItemId]: [] }));
    } finally {
      setItemPOSearchLoading(prev => ({ ...prev, [ocrItemId]: false }));
    }
  }, [supabase]);

  // 시스템 품목 직접 선택
  const handleSelectSystemItem = (ocrItemId: string, systemItem: SystemPurchaseItem | null) => {
    lastSelectedSystemItemRef.current = ocrItemId;
    setItemMatches(prev => {
      const newMap = new Map(prev);
      newMap.set(ocrItemId, systemItem);
      return newMap;
    });
    
    setOpenDropdowns(prev => {
      const newSet = new Set(prev);
      newSet.delete(`item-${ocrItemId}`);
      return newSet;
    });
  };

  useEffect(() => {
    if (!lastSelectedSystemItemRef.current) return;
    const itemId = lastSelectedSystemItemRef.current;
    const matched = itemMatches.get(itemId);
  }, [itemMatches]);

  useEffect(() => {
    if (!statementWithItems || itemMatches.size === 0) return;

    let didUpdate = false;
    const nextMap = new Map(itemMatches);

    statementWithItems.items.forEach((ocrItem) => {
      const current = itemMatches.get(ocrItem.id);
      if (!current || current.received_quantity != null) return;

      const itemPO = isSamePONumber
        ? selectedPONumber
        : (itemPONumbers.get(ocrItem.id) || (ocrItem.extracted_po_number ? normalizeOrderNumber(ocrItem.extracted_po_number) : ''));
      const systemItems = itemPO ? getSystemItemsForPO(itemPO) : [];
      if (systemItems.length === 0) return;

      const enriched = systemItems.find((sys) => sys.item_id === current.item_id);
      if (enriched && enriched.received_quantity != null) {
        nextMap.set(ocrItem.id, { ...current, received_quantity: enriched.received_quantity });
        didUpdate = true;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/b22edbac-a44c-4882-a88d-47f6cafc7628',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'StatementConfirmModal.tsx:enrichReceivedQuantity',message:'enriched_received_quantity',data:{ocrItemId:ocrItem.id,itemId:current.item_id,receivedQuantity:enriched.received_quantity},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
        // #endregion
      }
    });

    if (didUpdate) {
      setItemMatches(nextMap);
    }
  }, [statementWithItems, itemMatches, isSamePONumber, selectedPONumber, itemPONumbers, getSystemItemsForPO]);

  // 확정
  const handleConfirm = async () => {
    if (!statementWithItems) return;

    try {
      setSaving(true);

      // 1. OCR 수정사항 학습 데이터로 저장
      await saveOCRCorrections();

      // 1.5 거래일 수정 반영
      const normalizedOriginalDate = normalizeStatementDate(statementWithItems.statement_date);
      const normalizedInputDate = normalizeStatementDate(statementDateInput);
      if (normalizedInputDate !== normalizedOriginalDate) {
        const { error: dateError } = await supabase
          .from('transaction_statements')
          .update({ statement_date: normalizedInputDate || null })
          .eq('id', statement.id);

        if (dateError) {
          throw new Error(dateError.message);
        }
      }

      // 2. 확정 데이터 생성 (수정된 값 우선 사용)
      const confirmItems: ConfirmItemRequest[] = statementWithItems.items.map(item => {
        const matched = itemMatches.get(item.id);
        const edited = editedOCRItems.get(item.id);
        
        // 수정된 값이 있으면 수정된 값 사용, 없으면 원본 사용
        const confirmedQuantity = edited?.quantity !== undefined 
          ? edited.quantity 
          : item.extracted_quantity;
        const confirmedUnitPrice = edited?.unit_price !== undefined 
          ? edited.unit_price 
          : item.extracted_unit_price;
        const confirmedAmount = edited?.amount !== undefined 
          ? edited.amount 
          : item.extracted_amount;
        
        
        return {
          itemId: item.id,
          matched_purchase_id: matched?.purchase_id,
          matched_item_id: matched?.item_id,
          confirmed_quantity: confirmedQuantity,
          confirmed_unit_price: confirmedUnitPrice,
          confirmed_amount: confirmedAmount
        };
      });

      const result = await transactionStatementService.confirmStatement(
        {
          statementId: statement.id,
          items: confirmItems
        },
        confirmerName
      );

      if (result.success) {
        toast.success('거래명세서가 확정되었습니다.');
        onConfirm();
      } else {
        toast.error(result.error || '확정에 실패했습니다.');
      }
    } catch (error) {
      toast.error('확정 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // 거부
  const handleReject = async () => {
    if (!confirm('이 거래명세서를 거부하시겠습니까?')) return;

    try {
      setSaving(true);
      
      const result = await transactionStatementService.rejectStatement(statement.id);
      
      if (result.success) {
        toast.success('거래명세서가 거부되었습니다.');
        onClose();
      } else {
        toast.error(result.error || '거부 처리에 실패했습니다.');
      }
    } catch (error) {
      toast.error('거부 처리 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const formatAmount = (amount?: number) => {
    if (amount === undefined || amount === null) return '-';
    return amount.toLocaleString('ko-KR');
  };

  const getSystemItemLabel = (item?: SystemPurchaseItem | null) => {
    if (!item) return '';
    const name = item.item_name?.trim();
    if (name) return name;
    const spec = item.specification?.trim();
    if (spec) return spec;
    return `품목 #${item.item_id}`;
  };

  const handleOpenOriginalImage = () => {
    const imageUrl = statementWithItems?.image_url || statement.image_url;
    if (!imageUrl) return;

    const width = 1000;
    const height = 800;
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
    window.open(imageUrl, 'transaction-statement-image', `width=${width},height=${height},left=${left},top=${top}`);
  };

  // 매칭 상세 정보 가져오기
  const getMatchDetails = (ocrItem: TransactionStatementItemWithMatch) => {
    const matched = itemMatches.get(ocrItem.id);
    let effectiveMatch: SystemPurchaseItem | null = matched || null;
    let hasSystemItems = false;
    
    if (!effectiveMatch) {
      const poNumber = isSamePONumber 
        ? selectedPONumber 
        : (itemPONumbers.get(ocrItem.id) || (ocrItem.extracted_po_number ? normalizeOrderNumber(ocrItem.extracted_po_number) : ''));
      
      if (poNumber) {
        const systemItems = getSystemItemsForPO(poNumber);
        hasSystemItems = systemItems.length > 0;
        
        let bestScore = 0;
        systemItems.forEach(sysItem => {
          const score = calculateItemSimilarity(ocrItem.extracted_item_name || '', sysItem.item_name, sysItem.specification);
          if (score > bestScore) {
            bestScore = score;
            effectiveMatch = sysItem;
          }
        });
      }
    }
    
    if (!effectiveMatch) {
      return {
        ocrItemName: ocrItem.extracted_item_name || '-',
        systemItemName: '-',
        systemSpec: '-',
        similarity: 0,
        status: 'unmatched' as const,
        reasons: ['시스템에서 매칭할 발주 품목을 찾지 못했습니다.']
      };
    }
    
    const similarity = calculateItemSimilarity(ocrItem.extracted_item_name || '', effectiveMatch.item_name || '', effectiveMatch.specification);
    
    // 더 엄격한 임계값 적용 (getMatchStatus와 동일)
    let status: 'high' | 'med' | 'low' | 'unmatched' = 'unmatched';
    if (similarity >= 85) status = 'high';       // 높음: 85% 이상
    else if (similarity >= 60) status = 'med';   // 보통: 60% 이상
    else if (similarity >= 40) status = 'low';   // 낮음: 40% 이상
    // 40% 미만이면 unmatched 유지
    
    const reasons: string[] = [];
    
    // 유사도 설명 (임계값에 맞게 조정)
    if (similarity >= 85) {
      reasons.push(`✅ 품목명/규격 유사도 ${similarity.toFixed(0)}% (높음)`);
    } else if (similarity >= 60) {
      reasons.push(`⚠️ 품목명/규격 유사도 ${similarity.toFixed(0)}% (보통)`);
    } else if (similarity >= 40) {
      reasons.push(`⚠️ 품목명/규격 유사도 ${similarity.toFixed(0)}% (낮음)`);
    } else {
      reasons.push(`❌ 품목명/규격 유사도 ${similarity.toFixed(0)}% (매우 낮음 - 불일치)`);
    }
    
    // 품목명 vs 규격 상세 비교 (유사도와 일관되게)
    const ocrName = (ocrItem.extracted_item_name || '').toLowerCase().replace(/\s+/g, '');
    const sysName = (effectiveMatch.item_name || '').toLowerCase().replace(/\s+/g, '');
    const sysSpec = (effectiveMatch.specification || '').toLowerCase().replace(/\s+/g, '');
    
    // 규격 일치 여부 먼저 확인
    const specMatch = sysSpec && (ocrName === sysSpec || ocrName.includes(sysSpec) || sysSpec.includes(ocrName));
    const nameMatch = ocrName === sysName || ocrName.includes(sysName) || sysName.includes(ocrName);
    
    if (similarity >= 85) {
      // 유사도 높으면 무엇이 일치했는지 설명
      if (nameMatch && specMatch) {
        reasons.push('✅ 품목명과 규격 모두 일치');
      } else if (specMatch) {
        reasons.push('✅ 규격으로 매칭됨');
      } else if (nameMatch) {
        reasons.push('✅ 품목명으로 매칭됨');
      } else {
        reasons.push('✅ 문자열 유사도로 매칭됨');
      }
    } else if (similarity >= 60) {
      if (specMatch) {
        reasons.push('⚠️ 규격 부분 일치');
      } else if (nameMatch) {
        reasons.push('⚠️ 품목명 부분 일치');
      } else {
        reasons.push('⚠️ 부분적으로 유사');
      }
    } else {
      // 유사도 낮은 경우 불일치 표시
      reasons.push('❌ 품목명/규격 불일치 - 다른 품목일 가능성 높음');
    }
    
    // 발주번호 설명
    reasons.push(`📦 발주번호: ${effectiveMatch.purchase_order_number || effectiveMatch.sales_order_number || '-'}`);
    
    // 시스템 품목 상세
    if (effectiveMatch.specification) {
      reasons.push(`📋 시스템 규격: ${effectiveMatch.specification}`);
    }
    
    return {
      ocrItemName: ocrItem.extracted_item_name || '-',
      systemItemName: effectiveMatch.item_name || '-',
      systemSpec: effectiveMatch.specification || '-',
      similarity,
      status,
      reasons
    };
  };
  
  // 매칭 상태 뱃지 클릭 핸들러
  const handleMatchStatusClick = (ocrItem: TransactionStatementItemWithMatch) => {
    const details = getMatchDetails(ocrItem);
    setMatchDetailPopup({
      isOpen: true,
      ocrItemId: ocrItem.id,
      ...details
    });
  };

  const renderMatchStatusBadge = (status: 'high' | 'med' | 'low' | 'unmatched', ocrItem?: TransactionStatementItemWithMatch) => {
    const onClick = ocrItem ? () => handleMatchStatusClick(ocrItem) : undefined;
    const clickableClass = ocrItem ? "cursor-pointer hover:opacity-80 transition-opacity" : "";
    
    switch (status) {
      case 'high':
        return <span className={`badge-stats bg-green-500 text-white ${clickableClass}`} onClick={onClick} title="클릭하여 상세 보기"><Check className="w-3 h-3" />높음</span>;
      case 'med':
        return <span className={`badge-stats bg-yellow-500 text-white ${clickableClass}`} onClick={onClick} title="클릭하여 상세 보기">보통</span>;
      case 'low':
        return <span className={`badge-stats bg-orange-500 text-white ${clickableClass}`} onClick={onClick} title="클릭하여 상세 보기">낮음</span>;
      case 'unmatched':
        return <span className={`badge-stats bg-gray-500 text-white ${clickableClass}`} onClick={onClick} title="클릭하여 상세 보기">미매칭</span>;
    }
  };

  const toggleDropdown = (key: string, event?: React.MouseEvent) => {
    if (key.startsWith('item-')) {
    }
    if (event && key === 'global-po') {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left
      });
    }
    
    setOpenDropdowns(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.clear(); // 다른 드롭다운 닫기
        newSet.add(key);
      }
      return newSet;
    });
  };

  if (!statement) return null;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent 
          className="max-w-[95vw] md:max-w-[1200px] max-h-[90vh] overflow-hidden flex flex-col business-radius-modal" 
          showCloseButton={false}
          onInteractOutside={(e) => {
            // 드롭다운이 열려있을 때는 외부 클릭으로 모달 닫기 방지
            if (openDropdowns.size > 0) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader className="border-b border-gray-100 pb-3 px-4">
            <DialogTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2 modal-title">
                <CheckCircle className="w-4 h-4 text-hansl-600" />
                거래명세서 확인 및 확정
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenOriginalImage}
                className="button-base h-7 text-[10px]"
              >
                <ImageIcon className="w-3.5 h-3.5 mr-1" />
                원본 보기
              </Button>
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-hansl-600" />
              <span className="ml-3 modal-subtitle">로딩 중...</span>
            </div>
          ) : statementWithItems ? (
            <div className="flex-1 overflow-hidden flex flex-col py-3 px-4">
              {/* 요약 정보 */}
              <div className="flex items-center gap-6 p-3 bg-gray-50 business-radius-card mb-4">
                <div className="relative">
                  <p className="modal-label">거래처</p>
                  <div className="relative">
                    <input
                      type="text"
                      value={vendorInputValue}
                      onChange={(e) => {
                        setVendorInputValue(e.target.value);
                        handleVendorSearch(e.target.value);
                      }}
                      onFocus={() => {
                        if (vendorSearchResults.length > 0) setVendorDropdownOpen(true);
                      }}
                      onBlur={() => {
                        // delay to allow click on dropdown
                        setTimeout(() => setVendorDropdownOpen(false), 200);
                      }}
                      placeholder="거래처 검색..."
                      className={`w-[120px] h-5 px-1.5 bg-white border business-radius focus:outline-none focus:ring-1 focus:ring-hansl-400 ${
                        overrideVendorName ? 'border-green-400 text-green-700' : 'border-gray-300 text-gray-900'
                      }`}
                      style={{ fontSize: '11px', fontWeight: 700 }}
                    />
                    {vendorSearchLoading && (
                      <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin text-gray-400" />
                    )}
                    {/* 인라인 드롭다운 */}
                    {vendorDropdownOpen && vendorSearchResults.length > 0 && (
                      <div className="absolute top-full left-0 mt-1 w-[200px] bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-[180px] overflow-y-auto">
                        {vendorSearchResults.map((vendor) => (
                          <button
                            key={vendor.id}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setVendorInputValue(vendor.name);
                              setVendorDropdownOpen(false);
                              handleSelectVendor(vendor.name);
                            }}
                            className="w-full px-2 py-1.5 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                          >
                            <div className="text-[10px] font-medium text-gray-900">{vendor.name}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <p className="modal-label">거래일</p>
                  <input
                    type="date"
                    value={statementDateInput}
                    onChange={(e) => setStatementDateInput(e.target.value)}
                    className="w-[120px] h-5 px-1.5 bg-white border border-gray-300 business-radius-input focus:outline-none focus:ring-1 focus:ring-hansl-400 text-gray-900"
                    style={{ fontSize: '11px', fontWeight: 600 }}
                  />
                </div>
                <div>
                  <p className="modal-label">합계금액</p>
                  <p className="modal-value-large">
                    {formatAmount(statementWithItems.grand_total)}원
                  </p>
                </div>
                <div>
                  <p className="modal-label">품목 수</p>
                  <p className="modal-value">{statementWithItems.items.length}건</p>
                </div>
              </div>

              {/* 3단 비교 테이블 */}
              <div className="flex-1 overflow-auto border border-gray-200 business-radius-card">
                <table className="modal-value table-auto min-w-full">
                  <thead className="bg-gray-100 sticky top-0 z-10">
                    <tr className="border-b border-gray-200">
                      {/* 좌측: 시스템 발주품목 헤더 */}
                      <th colSpan={isSamePONumber ? 4 : 5} className="border-r-2 border-gray-300 p-2 text-left w-[45%]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="modal-section-title text-gray-700">시스템 발주품목</span>
                          {isSamePONumber && allPONumberCandidates.length > 0 && (
                            <div className="relative flex items-center gap-1">
                              <button
                                onClick={(e) => toggleDropdown('global-po', e)}
                                className="inline-flex items-center gap-1 px-1.5 h-5 text-[10px] font-medium bg-white border border-gray-300 rounded-md hover:bg-gray-50 text-gray-700"
                              >
                                {(() => {
                                  if (!selectedPONumber) return '발주번호 선택';
                                  const candidate = allPONumberCandidates.find(c => c.poNumber === selectedPONumber || c.salesOrderNumber === selectedPONumber);
                                  if (candidate?.poNumber && candidate?.salesOrderNumber) {
                                    return <>{candidate.poNumber} <span className="text-gray-400">({candidate.salesOrderNumber})</span></>;
                                  }
                                  // 선택된 발주번호를 그대로 표시 (수동 검색으로 선택한 경우 포함)
                                  const pairedNumber = getPairedOrderNumber(selectedPONumber);
                                  if (pairedNumber) {
                                    return <>{selectedPONumber} <span className="text-gray-400">({pairedNumber})</span></>;
                                  }
                                  return selectedPONumber;
                                })()}
                                <ChevronDown className="w-3 h-3" />
                              </button>
                              {/* OCR 추출 발주번호와 다르면 경고 */}
                              {commonPONumber && selectedPONumber && commonPONumber !== selectedPONumber && (
                                <span className="text-[9px] text-orange-500" title="OCR 추출 발주번호와 다른 발주가 매칭됨">
                                  ⚠️
                                </span>
                              )}
                              {/* 수동 검색 - 인라인 input */}
                              <div className="relative flex items-center">
                                {poSearchInputOpen ? (
                                  <>
                                    <input
                                      type="text"
                                      value={poSearchInput}
                                      onChange={(e) => {
                                        setPOSearchInput(e.target.value);
                                        handlePOSearch(e.target.value);
                                      }}
                                      onBlur={() => {
                                        if (keepPODropdownOpenRef.current) {
                                          keepPODropdownOpenRef.current = false;
                                          return;
                                        }
                                        setTimeout(() => {
                                          setPOSearchInputOpen(false);
                                          setPODropdownOpen(false);
                                        }, 200);
                                      }}
                                      placeholder="F... 또는 HS..."
                                      className="w-[150px] h-5 px-1.5 bg-white border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-hansl-400"
                                      style={{ fontSize: '10px', fontWeight: 500 }}
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    {poSearchLoading && (
                                      <Loader2 className="absolute right-1 w-3 h-3 animate-spin text-gray-400" />
                                    )}
                                    {/* 인라인 드롭다운 */}
                                    {poDropdownOpen && poSearchResults.length > 0 && (
                                      <div className="absolute top-full left-0 mt-1 w-[280px] bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-[180px] overflow-y-auto">
                                        {poSearchResults.map((po) => (
                                          <div
                                            key={po.id}
                                            className="w-full px-2 py-1.5 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                                          >
                                            <button
                                              onMouseDown={(e) => e.preventDefault()}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                keepPODropdownOpenRef.current = false;
                                                // 검색어에 맞는 번호 선택: HS로 검색했으면 soNumber, F로 검색했으면 poNumber
                                                const searchUpper = poSearchInput.trim().toUpperCase();
                                                let selectedNumber: string;
                                                if (searchUpper.startsWith('HS') && po.soNumber) {
                                                  selectedNumber = po.soNumber;
                                                } else if (searchUpper.startsWith('F') && po.poNumber) {
                                                  selectedNumber = po.poNumber;
                                                } else {
                                                  selectedNumber = po.poNumber || po.soNumber || '';
                                                }
                                                setPOSearchInput('');
                                                setPOSearchInputOpen(false);
                                                setPODropdownOpen(false);
                                                // 수동 선택 플래그 설정 (자동 교정 방지)
                                                setManuallySelectedPO(true);
                                                // 발주번호 선택 및 품목 매칭 업데이트 (거래처명, 수주번호 포함)
                                                handleSelectGlobalPO(selectedNumber, po.vendorName, po.soNumber);
                                                toast.success(`${selectedNumber} 발주가 선택되었습니다`);
                                              }}
                                              className="w-full text-left"
                                            >
                                              <div className="flex items-center justify-between gap-2">
                                                <div className="text-[10px] font-medium text-gray-900">
                                                  {po.poNumber}
                                                  {po.soNumber && <span className="text-gray-400 ml-1">({po.soNumber})</span>}
                                                </div>
                                                <button
                                                  type="button"
                                                  onMouseDown={(e) => {
                                                    keepPODropdownOpenRef.current = true;
                                                    e.preventDefault();
                                                  }}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedPurchaseIdForDetail(po.id);
                                                    setIsPurchaseDetailModalOpen(true);
                                                  }}
                                                  className="text-[9px] font-medium text-blue-600 hover:text-blue-800"
                                                >
                                                  상세
                                                </button>
                                              </div>
                                            </button>
                                            {po.vendorName && (
                                              <div className="text-[9px] text-gray-500">{po.vendorName}</div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPOSearchInputOpen(true);
                                    }}
                                    className="inline-flex items-center gap-0.5 px-1 h-5 text-[9px] font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
                                    title="발주/수주번호 직접 검색"
                                  >
                                    <Search className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                              {/* 발주 상세보기 버튼 */}
                              {selectedPONumber && (() => {
                                const selectedCandidate = allPONumberCandidates.find(
                                  c => c.poNumber === selectedPONumber || c.salesOrderNumber === selectedPONumber
                                );
                                const purchaseId = selectedCandidate?.purchaseId || selectedCandidate?.items[0]?.purchase_id;
                                if (!purchaseId) return null;
                                return (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedPurchaseIdForDetail(purchaseId);
                                      setIsPurchaseDetailModalOpen(true);
                                    }}
                                    className="inline-flex items-center gap-0.5 px-1 h-5 text-[9px] font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                                    title="발주 상세 보기"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </button>
                                );
                              })()}
                              {/* 드롭다운은 fixed position으로 모달 바깥에 렌더링 */}
                            </div>
                          )}
                        </div>
                      </th>
                      
                      {/* 중앙: 매칭 상태 (빈 셀) */}
                      <th className="border-r-2 border-gray-300 p-2 text-center bg-blue-50/30 w-[10%]">
                      </th>
                      
                      {/* 우측: OCR 추출 품목 헤더 */}
                      <th colSpan={isSamePONumber ? 4 : 5} className="p-2 text-left w-[45%]">
                        <div className="flex items-center gap-2">
                          <span className="modal-section-title text-gray-700">
                            OCR 추출 품목
                          </span>
                          {isSamePONumber && commonPONumber && (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={(() => {
                                  // 편집된 값이 있으면 사용, 없으면 원본 사용
                                  const firstItem = statementWithItems?.items[0];
                                  if (firstItem) {
                                    return getOCRItemValue(firstItem, 'po_number') as string;
                                  }
                                  return commonPONumber;
                                })()}
                                onChange={(e) => handleOCRPONumberChange(e.target.value)}
                                className="px-1.5 h-5 bg-white border border-gray-300 text-gray-700 text-[10px] font-medium business-radius focus:outline-none focus:ring-1 focus:ring-gray-400"
                                style={{ fontSize: '11px', fontWeight: 500 }}
                                title="OCR 추출 발주번호 (수정 가능)"
                              />
                              {(() => {
                                // 현재 입력된 값 가져오기
                                const firstItem = statementWithItems?.items[0];
                                const currentValue = firstItem ? (getOCRItemValue(firstItem, 'po_number') as string) : commonPONumber;
                                const pairedNumber = getPairedOrderNumberWithOverrides(currentValue);
                                if (pairedNumber) {
                                  return <span className="text-gray-400 text-[10px] font-normal" style={{ fontSize: '11px' }}>{pairedNumber}</span>;
                                }
                                return null;
                              })()}
                            </div>
                          )}
                          {isSamePONumber && !commonPONumber && (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                placeholder="발주/수주번호 입력"
                                onChange={(e) => handleOCRPONumberChange(e.target.value)}
                                className="px-1.5 h-5 bg-white border border-gray-300 text-gray-700 text-[10px] font-medium business-radius focus:outline-none focus:ring-1 focus:ring-gray-400"
                                style={{ fontSize: '11px', fontWeight: 500 }}
                                title="발주번호 직접 입력"
                              />
                              {(() => {
                                const firstItem = statementWithItems?.items[0];
                                const currentValue = firstItem
                                  ? (getOCRItemValue(firstItem, 'po_number') as string)
                                  : '';
                                const pairedNumber = getPairedOrderNumberWithOverrides(currentValue);
                                if (!pairedNumber) return null;
                                return (
                                  <span className="text-gray-400 text-[10px] font-normal" style={{ fontSize: '11px' }}>
                                    {pairedNumber}
                                  </span>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </th>
                    </tr>
                    <tr className="modal-label">
                      {/* 좌측 컬럼 */}
                      {!isSamePONumber && (
                        <th className="p-1 text-left whitespace-nowrap modal-label">발주/수주번호</th>
                      )}
                      <th className="p-1 text-left modal-label">품목명</th>
                      <th className="p-1 text-right modal-label">수량</th>
                      <th className="p-1 text-right modal-label">단가</th>
                      <th className="border-r-2 border-gray-300 p-1 text-right modal-label">합계</th>
                      
                      {/* 중앙 */}
                      <th className="border-r-2 border-gray-300 p-1 text-center bg-blue-50/30">
                        <span className="text-gray-400 text-sm">⇄</span>
                      </th>
                      
                      {/* 우측 컬럼 */}
                      <th className="p-1 text-left whitespace-nowrap modal-label">품목명</th>
                      <th className="p-1 text-right whitespace-nowrap w-16 modal-label">수량</th>
                      <th className="p-1 text-right whitespace-nowrap w-20 modal-label">단가</th>
                      <th className="p-1 text-right whitespace-nowrap w-24 modal-label">합계</th>
                      {!isSamePONumber && (
                        <th className="p-1 text-left whitespace-nowrap modal-label">발주/수주번호</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {statementWithItems.items.map((ocrItem, rowIndex) => {
                      const matchedSystem = itemMatches.get(ocrItem.id);
                      const matchStatus = getMatchStatus(ocrItem);
                      // OCR 추출 번호를 시스템 형식으로 정규화 (예: _01 → _001, -1 → -01)
                      const normalizedExtractedPO = ocrItem.extracted_po_number 
                        ? normalizeOrderNumber(ocrItem.extracted_po_number) 
                        : undefined;
                      const itemPO = itemPONumbers.get(ocrItem.id) || normalizedExtractedPO;
                      const poCandidates = getPOCandidatesForItem(ocrItem.id);
                      const orderedPOs = Array.from(
                        new Set([itemPO, ...poCandidates].filter(Boolean) as string[])
                      );
                      const itemSearchValue = itemPOSearchInputs[ocrItem.id] || '';
                      const itemSearchResults = itemPOSearchResults[ocrItem.id] || [];
                      const itemSearchLoading = itemPOSearchLoading[ocrItem.id] || false;
                      const activePONumber = isSamePONumber ? selectedPONumber : (itemPO || '');
                      const systemCandidates = getSystemItemsForPO(activePONumber);
                      const fallbackCandidates = systemCandidates.length === 0 && activePONumber
                        ? (ocrItem.match_candidates || [])
                          .filter(candidate =>
                            candidate.purchase_order_number === activePONumber ||
                            candidate.sales_order_number === activePONumber
                          )
                          .map((candidate): SystemPurchaseItem => ({
                            purchase_id: candidate.purchase_id,
                            item_id: candidate.item_id,
                            purchase_order_number: candidate.purchase_order_number || '',
                            sales_order_number: candidate.sales_order_number,
                            item_name: candidate.item_name || '품목명 없음',
                            specification: candidate.specification,
                            quantity: candidate.quantity,
                            unit_price: candidate.unit_price,
                            amount: (candidate as any).amount,
                            vendor_name: candidate.vendor_name
                          }))
                        : [];
                      const displaySystemCandidates = systemCandidates.length > 0 ? systemCandidates : fallbackCandidates;
                      const scoredSystemCandidates = displaySystemCandidates
                        .map((candidate) => ({
                          candidate,
                          score: calculateItemSimilarity(ocrItem.extracted_item_name || '', candidate.item_name, candidate.specification)
                        }))
                        .sort((a, b) => b.score - a.score);
                      if (rowIndex === 0) {
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/b22edbac-a44c-4882-a88d-47f6cafc7628',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'StatementConfirmModal.tsx:systemCandidates:calc',message:'system_candidates_loaded',data:{activePONumber,systemCount:systemCandidates.length,fallbackCount:fallbackCandidates.length,sample:displaySystemCandidates.slice(0,3).map(c=>({id:c.item_id,name:c.item_name,qty:c.quantity,received:c.received_quantity}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
                        // #endregion
                      }
                      if (rowIndex === 0) {
                        const logKey = `${ocrItem.id}|${isSamePONumber ? 'same' : 'multi'}|${activePONumber}|${systemCandidates.length}`;
                        if (systemCandidateLogKeyRef.current !== logKey) {
                          systemCandidateLogKeyRef.current = logKey;
                          const firstCandidate = systemCandidates[0];
                          if (firstCandidate) {
                          }
                        }
                      }
                      
                      // 발주/수주 번호 일치 여부 계산 (첫 행에서만 사용)
                      const normalizedSelectedPONumber = selectedPONumber
                        ? normalizeOrderNumber(selectedPONumber)
                        : '';
                      const pairedOrderNumber = selectedPONumber
                        ? getPairedOrderNumber(selectedPONumber)
                        : undefined;
                      const normalizedPairedOrderNumber = pairedOrderNumber
                        ? normalizeOrderNumber(pairedOrderNumber)
                        : '';
                      const totalItemCount = statementWithItems.items.length;
                      const extractedOrderNumbers = statementWithItems.items
                        .map(item => getOCRItemValue(item, 'po_number') as string)
                        .filter(Boolean)
                        .map(value => normalizeOrderNumber(value));
                      const hasOrderNumberMatch =
                        !!normalizedSelectedPONumber &&
                        extractedOrderNumbers.some(
                          value =>
                            value === normalizedSelectedPONumber ||
                            (normalizedPairedOrderNumber && value === normalizedPairedOrderNumber)
                        );
                      const isFirstRow = rowIndex === 0;
                      
                      return (
                        <tr key={ocrItem.id} className="hover:bg-gray-50">
                          {/* Case 2: 발주번호 컬럼 */}
                          {!isSamePONumber && (
                            <td className="p-1 whitespace-nowrap">
                              <div className="relative">
                                <button
                                  onClick={() => toggleDropdown(`po-${ocrItem.id}`)}
                                  className="inline-flex items-center gap-1 px-1.5 h-5 text-[10px] font-medium bg-white border border-gray-300 business-radius hover:bg-gray-50 text-gray-700 whitespace-nowrap"
                                  style={{ fontSize: '11px' }}
                                >
                                  <span>{itemPO || '선택'}</span>
                                  <ChevronDown className="w-3 h-3 flex-shrink-0" />
                                </button>
                                {openDropdowns.has(`po-${ocrItem.id}`) && (
                                  <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-md shadow-lg w-[280px] max-h-[200px] overflow-auto">
                                    <div className="p-2 border-b border-gray-100">
                                      <div className="relative">
                                        <input
                                          type="text"
                                          value={itemSearchValue}
                                          onChange={(e) => handleItemPOSearch(ocrItem.id, e.target.value)}
                                          placeholder="발주/수주번호 검색..."
                                          className="w-full h-6 px-2 pr-6 text-[10px] bg-white border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-hansl-400"
                                        />
                                        {itemSearchLoading && (
                                          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin text-gray-400" />
                                        )}
                                      </div>
                                    </div>
                                    {itemSearchValue && itemSearchResults.length > 0 && (
                                      <div className="border-b border-gray-100">
                                        {itemSearchResults.map((po) => {
                                          const searchUpper = itemSearchValue.trim().toUpperCase();
                                          let selectedNumber: string;
                                          if (searchUpper.startsWith('HS') && po.soNumber) {
                                            selectedNumber = po.soNumber;
                                          } else if (searchUpper.startsWith('F') && po.poNumber) {
                                            selectedNumber = po.poNumber;
                                          } else {
                                            selectedNumber = po.poNumber || po.soNumber || '';
                                          }
                                          return (
                                            <div
                                              key={po.id}
                                              className="px-2 py-1.5 hover:bg-gray-50 cursor-pointer text-[11px]"
                                              onClick={() => handleSelectItemPO(ocrItem.id, selectedNumber)}
                                            >
                                              <div className="flex items-center justify-between gap-2">
                                                <div className="font-medium text-gray-900">
                                                  {po.poNumber}
                                                  {po.soNumber && <span className="text-gray-400 ml-1">({po.soNumber})</span>}
                                                </div>
                                                <button
                                                  type="button"
                                                  onMouseDown={(e) => e.preventDefault()}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedPurchaseIdForDetail(po.id);
                                                    setIsPurchaseDetailModalOpen(true);
                                                  }}
                                                  className="text-[9px] font-medium text-blue-600 hover:text-blue-800"
                                                >
                                                  상세
                                                </button>
                                              </div>
                                              {po.vendorName && (
                                                <div className="text-[9px] text-gray-500">{po.vendorName}</div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                    {orderedPOs.length > 0 && (
                                      <div>
                                        {orderedPOs.map((po, idx) => {
                                          const paired = getPairedOrderNumber(po);
                                          const purchaseId = getPurchaseIdByNumber(po);
                                          const isPreferred = po === itemPO;
                                          return (
                                            <div
                                              key={`${po}-${idx}`}
                                              onClick={() => handleSelectItemPO(ocrItem.id, po)}
                                              className={`px-2 py-1.5 hover:bg-gray-100 cursor-pointer text-[11px] font-medium ${isPreferred ? 'bg-gray-100 text-gray-900 font-semibold' : 'text-gray-700'}`}
                                              style={{ fontSize: '11px' }}
                                            >
                                              <div className="flex items-center justify-between gap-2">
                                                <div>
                                                  {po}
                                                  {paired && <span className="text-gray-400 ml-1">({paired})</span>}
                                                  {isPreferred && <span className="text-orange-500 ml-1">추천</span>}
                                                </div>
                                                {purchaseId && (
                                                  <button
                                                    type="button"
                                                    onMouseDown={(e) => e.preventDefault()}
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setSelectedPurchaseIdForDetail(purchaseId);
                                                      setIsPurchaseDetailModalOpen(true);
                                                    }}
                                                    className="text-[9px] font-medium text-blue-600 hover:text-blue-800"
                                                  >
                                                    상세
                                                  </button>
                                                )}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                          )}
                          
                          {/* 좌측: 시스템 품목 */}
                          <td className="p-1">
                            {displaySystemCandidates.length > 0 ? (
                              <div className="relative">
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => {
                                      toggleDropdown(`item-${ocrItem.id}`);
                                    }}
                                    className="inline-flex items-center gap-1 px-1.5 h-5 text-[10px] font-normal bg-white border border-gray-300 business-radius hover:bg-gray-50 text-gray-700 whitespace-nowrap"
                                    style={{ fontSize: '11px' }}
                                  >
                                    <span>{getSystemItemLabel(matchedSystem) || '선택'}</span>
                                    <ChevronDown className="w-3 h-3 flex-shrink-0" />
                                  </button>
                                  {matchedSystem && (
                                    <button
                                      onClick={() => handleSelectSystemItem(ocrItem.id, null)}
                                      className="text-gray-400 hover:text-red-500 flex-shrink-0"
                                      title="매칭 해제"
                                    >
                                      <XCircle className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                                {openDropdowns.has(`item-${ocrItem.id}`) && (
                                  <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-md shadow-lg w-[280px] max-h-[200px] overflow-auto">
                                    {scoredSystemCandidates.map(({ candidate, score }, cidx) => {
                                      return (
                                        <div
                                          key={cidx}
                                          onClick={() => {
                                            handleSelectSystemItem(ocrItem.id, candidate);
                                          }}
                                          className="px-2 py-1.5 hover:bg-gray-100 cursor-pointer"
                                        >
                                          <div className="flex items-center justify-between">
                                            <p className="text-[11px] font-normal text-gray-900" style={{ fontSize: '11px' }}>{getSystemItemLabel(candidate)}</p>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                              score >= 80 ? 'bg-green-100 text-green-700' :
                                              score >= 50 ? 'bg-yellow-100 text-yellow-700' :
                                              'bg-gray-100 text-gray-600'
                                            }`}>
                                              {Math.round(score)}%
                                            </span>
                                          </div>
                                          <p className="text-[10px] text-gray-500">
                                            요청/실제: {candidate.quantity ?? '-'} / {candidate.received_quantity ?? '-'}
                                          </p>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] text-gray-400" style={{ fontSize: '11px' }}>후보 없음</span>
                            )}
                          </td>
                          <td className="p-1 text-right">
                            <span className="text-[11px] text-gray-700" style={{ fontSize: '11px' }}>
                              {matchedSystem?.quantity ?? '-'} / {matchedSystem?.received_quantity ?? '-'}
                            </span>
                            {rowIndex === 0 && (
                              <>
                                {/* #region agent log */}
                                {(() => {
                                  fetch('http://127.0.0.1:7242/ingest/b22edbac-a44c-4882-a88d-47f6cafc7628',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'StatementConfirmModal.tsx:matchedSystem:render',message:'matched_system_render',data:{ocrItemId:ocrItem.id,matchedItemId:matchedSystem?.item_id ?? null,quantity:matchedSystem?.quantity ?? null,receivedQuantity:matchedSystem?.received_quantity ?? null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
                                  return null;
                                })()}
                                {/* #endregion */}
                              </>
                            )}
                          </td>
                          <td className="p-1 text-right">
                            <span className="text-[11px] text-gray-700" style={{ fontSize: '11px' }}>{matchedSystem ? formatAmount(matchedSystem.unit_price) : '-'}</span>
                          </td>
                          <td className="border-r-2 border-gray-300 p-1 text-right">
                            <span className="text-[11px] font-bold text-gray-900" style={{ fontSize: '11px', fontWeight: 700 }}>{matchedSystem ? formatAmount(matchedSystem.amount) : '-'}</span>
                          </td>
                          
                          {/* 중앙: 발주/수주 번호 일치 상태 (첫 행에만 rowSpan으로 세로 중앙 표시) */}
                          {isFirstRow && (
                            <td 
                              className="border-r-2 border-gray-300 px-2 py-1 text-center bg-blue-50/30 cursor-pointer hover:bg-blue-100/50 transition-colors"
                              rowSpan={totalItemCount}
                              style={{ verticalAlign: 'middle' }}
                              onClick={() => setIsIntegratedMatchDetailOpen(true)}
                              title="클릭하여 상세 내역 보기"
                            >
                              <div className="flex flex-col items-center justify-center">
                                <span className={`text-[11px] font-bold ${
                                  hasOrderNumberMatch ? 'text-green-600' : 'text-gray-500'
                                }`}>
                                  {hasOrderNumberMatch ? '발주/수주 번호 일치' : '발주/수주 번호 불일치'}
                                </span>
                                <span className="text-[8px] text-blue-500 underline mt-0.5">
                                  상세보기
                                </span>
                              </div>
                            </td>
                          )}
                          
                          {/* 우측: OCR 품목 (편집 가능) */}
                          <td className="p-1 whitespace-nowrap">
                            <input
                              type="text"
                              value={getOCRItemValue(ocrItem, 'item_name') as string}
                              onChange={(e) => handleEditOCRItem(ocrItem.id, 'item_name', e.target.value)}
                              className={`min-w-[180px] w-auto px-1 h-5 !text-[10px] !font-medium text-gray-900 border business-radius focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                isOCRItemEdited(ocrItem, 'item_name') 
                                  ? 'border-orange-400 bg-orange-50' 
                                  : 'border-gray-200 bg-white'
                              }`}
                              style={{ fontSize: '11px', fontWeight: 500, width: `${Math.max(180, (getOCRItemValue(ocrItem, 'item_name') as string).length * 8)}px` }}
                              title={isOCRItemEdited(ocrItem, 'item_name') ? `원본: ${ocrItem.extracted_item_name}` : undefined}
                            />
                          </td>
                          <td className="p-1 text-right w-16">
                            <input
                              type="number"
                              value={getOCRItemValue(ocrItem, 'quantity') as number}
                              onChange={(e) => handleEditOCRItem(ocrItem.id, 'quantity', e.target.value ? Number(e.target.value) : 0)}
                              className={`w-14 px-1 h-5 !text-[10px] !font-medium text-gray-900 text-right border business-radius focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                isOCRItemEdited(ocrItem, 'quantity') 
                                  ? 'border-orange-400 bg-orange-50' 
                                  : 'border-gray-200 bg-white'
                              }`}
                              style={{ fontSize: '11px', fontWeight: 500 }}
                              title={isOCRItemEdited(ocrItem, 'quantity') ? `원본: ${ocrItem.extracted_quantity}` : undefined}
                            />
                          </td>
                          <td className="p-1 text-right w-20">
                            <input
                              type="number"
                              value={getOCRItemValue(ocrItem, 'unit_price') as number}
                              onChange={(e) => handleEditOCRItem(ocrItem.id, 'unit_price', e.target.value ? Number(e.target.value) : 0)}
                              className={`w-16 px-1 h-5 !text-[10px] !font-medium text-gray-900 text-right border business-radius focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                isOCRItemEdited(ocrItem, 'unit_price') 
                                  ? 'border-orange-400 bg-orange-50' 
                                  : 'border-gray-200 bg-white'
                              }`}
                              style={{ fontSize: '11px', fontWeight: 500 }}
                              title={isOCRItemEdited(ocrItem, 'unit_price') ? `원본: ${ocrItem.extracted_unit_price}` : undefined}
                            />
                          </td>
                          <td className="p-1 text-right w-24">
                            <input
                              type="number"
                              value={getOCRItemValue(ocrItem, 'amount') as number}
                              onChange={(e) => handleEditOCRItem(ocrItem.id, 'amount', e.target.value ? Number(e.target.value) : 0)}
                              className={`w-20 px-1 h-5 !text-[10px] !font-bold text-gray-900 text-right border business-radius focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                isOCRItemEdited(ocrItem, 'amount') 
                                  ? 'border-orange-400 bg-orange-50' 
                                  : 'border-gray-200 bg-white'
                              }`}
                              style={{ fontSize: '11px', fontWeight: 700 }}
                              title={isOCRItemEdited(ocrItem, 'amount') ? `원본: ${ocrItem.extracted_amount}` : undefined}
                            />
                          </td>
                          
                          {/* Case 2: OCR 발주번호 표시 (편집 가능) */}
                          {!isSamePONumber && (
                            <td className="p-1 whitespace-nowrap">
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={getOCRItemValue(ocrItem, 'po_number') as string}
                                  onChange={(e) => {
                                    const newValue = e.target.value;
                                    lookupPairedOrderNumber(newValue);
                                    handleEditOCRItem(ocrItem.id, 'po_number', newValue);
                                  }}
                                  className={`px-1.5 h-5 text-[10px] font-medium bg-white border business-radius focus:outline-none focus:ring-1 focus:ring-gray-400 text-gray-700 ${
                                    isOCRItemEdited(ocrItem, 'po_number') 
                                      ? 'border-orange-400 bg-orange-50' 
                                      : 'border-gray-300'
                                  }`}
                                  style={{ fontSize: '11px', fontWeight: 500 }}
                                  title={isOCRItemEdited(ocrItem, 'po_number') ? `원본: ${ocrItem.extracted_po_number}` : undefined}
                                />
                                {(() => {
                                  const currentValue = getOCRItemValue(ocrItem, 'po_number') as string;
                                  const pairedNumber = getPairedOrderNumberWithOverrides(currentValue);
                                  if (!pairedNumber) return null;
                                  return (
                                    <span className="text-gray-400 text-[10px] font-normal" style={{ fontSize: '11px' }}>
                                      {pairedNumber}
                                    </span>
                                  );
                                })()}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    
                    {/* 합계 행 */}
                    <tr className="bg-gray-50 font-medium border-t border-gray-100">
                      <td colSpan={isSamePONumber ? 3 : 4} className="p-1 text-right text-gray-600">
                        시스템 합계
                      </td>
                      <td className="border-r-2 border-gray-300 p-1 text-right text-gray-900">
                        {formatAmount(
                          Array.from(itemMatches.values())
                            .filter(Boolean)
                            .reduce((sum, item) => sum + (item?.amount || 0), 0)
                        )}
                      </td>
                      <td className="border-r-2 border-gray-300 p-1 bg-blue-50/50"></td>
                      <td colSpan={isSamePONumber ? 3 : 4} className="p-1 text-right text-gray-600">
                        OCR 합계
                        {editedOCRItems.size > 0 && (
                          <span className="ml-1 text-[9px] text-orange-600">(수정됨)</span>
                        )}
                      </td>
                      <td className="p-1 text-right text-gray-900">
                        {formatAmount(
                          statementWithItems.items.reduce((sum, item) => {
                            const edited = editedOCRItems.get(item.id);
                            const amount = edited?.amount !== undefined ? edited.amount : (item.extracted_amount || 0);
                            return sum + amount;
                          }, 0)
                        )}
                      </td>
                      {!isSamePONumber && <td className="p-1"></td>}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="modal-subtitle">데이터를 불러올 수 없습니다.</p>
            </div>
          )}

          <DialogFooter className="border-t border-gray-100 pt-3 px-4 gap-2">
            <Button
              variant="outline"
              onClick={handleReject}
              disabled={saving}
              className="button-base h-8 text-[11px] text-red-500 border-red-200 hover:bg-red-50"
            >
              <XCircle className="w-3.5 h-3.5 mr-1" />
              거부
            </Button>
            <Button
              variant="outline"
              onClick={onClose}
              disabled={saving}
              className="button-base h-8 text-[11px]"
            >
              닫기
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={saving || !statementWithItems}
              className="button-base h-8 text-[11px] bg-hansl-600 hover:bg-hansl-700 text-white"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  처리 중...
                </>
              ) : (
                <>
                  <CheckCircle className="w-3.5 h-3.5 mr-1" />
                  확정
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 매칭 상세 정보 팝업 */}
      {matchDetailPopup && (
        <Dialog open={matchDetailPopup.isOpen} onOpenChange={() => setMatchDetailPopup(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-[14px] font-semibold text-gray-800">
                매칭 상세 정보
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4 py-2">
              {/* 매칭 상태 뱃지 */}
              <div className="flex items-center justify-center">
                {renderMatchStatusBadge(matchDetailPopup.status)}
                <span className="ml-2 text-[12px] text-gray-600">
                  유사도: {matchDetailPopup.similarity.toFixed(1)}%
                </span>
              </div>
              
              {/* 비교 테이블 */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="text-[11px] font-medium text-gray-500 w-20 shrink-0">OCR 품목:</span>
                  <span className="text-[11px] text-gray-800 break-all">{matchDetailPopup.ocrItemName}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[11px] font-medium text-gray-500 w-20 shrink-0">시스템 품목:</span>
                  <span className="text-[11px] text-gray-800 break-all">{matchDetailPopup.systemItemName}</span>
                </div>
                {matchDetailPopup.systemSpec && matchDetailPopup.systemSpec !== '-' && (
                  <div className="flex items-start gap-2">
                    <span className="text-[11px] font-medium text-gray-500 w-20 shrink-0">시스템 규격:</span>
                    <span className="text-[11px] text-gray-800 break-all">{matchDetailPopup.systemSpec}</span>
                  </div>
                )}
              </div>
              
              {/* 매칭 이유 */}
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-gray-600">매칭 판정 이유:</span>
                <ul className="space-y-1">
                  {matchDetailPopup.reasons.map((reason, idx) => (
                    <li key={idx} className="text-[11px] text-gray-700 pl-2">
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            
            <DialogFooter>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setMatchDetailPopup(null)}
                className="text-[11px]"
              >
                닫기
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 통합 매칭 상세 팝업 (발주번호 전체 매칭 내역) */}
      <Dialog open={isIntegratedMatchDetailOpen} onOpenChange={setIsIntegratedMatchDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[14px] font-semibold text-gray-800">
              매칭 상세 내역
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-2">
            {/* 통합 매칭률 표시 */}
            {(() => {
              const selectedCandidate = allPONumberCandidates.find(
                c => c.poNumber === selectedPONumber || c.salesOrderNumber === selectedPONumber
              );
              // 표시용 점수 사용 (실제 품목 유사도, 최대 100%)
              const totalMatchScore = Math.min(100, selectedCandidate?.displayScore ?? selectedCandidate?.setMatchScore ?? 0);
              const matchedCount = selectedCandidate?.matchedItemCount ?? 0;
              const totalCount = statementWithItems?.items.length ?? 0;
              const normalizedSelectedPONumber = selectedPONumber
                ? normalizeOrderNumber(selectedPONumber)
                : '';
              const pairedOrderNumber = selectedPONumber
                ? getPairedOrderNumber(selectedPONumber)
                : undefined;
              const normalizedPairedOrderNumber = pairedOrderNumber
                ? normalizeOrderNumber(pairedOrderNumber)
                : '';
              const extractedOrderNumbers = (statementWithItems?.items ?? [])
                .map(item => getOCRItemValue(item, 'po_number') as string)
                .filter(Boolean)
                .map(value => normalizeOrderNumber(value));
              const isOrderNumberMatched =
                !!normalizedSelectedPONumber &&
                extractedOrderNumbers.some(
                  value =>
                    value === normalizedSelectedPONumber ||
                    (normalizedPairedOrderNumber && value === normalizedPairedOrderNumber)
                );
              const matchedNameCount = (statementWithItems?.items ?? []).filter(ocrItem => {
                const matchedSystem = itemMatches.get(ocrItem.id);
                if (!matchedSystem) return false;
                const similarity = calculateItemSimilarity(
                  (getOCRItemValue(ocrItem, 'item_name') as string) || '',
                  matchedSystem.item_name,
                  matchedSystem.specification
                );
                return similarity >= 40; // 최소 40점 이상
              }).length;
              const quantityMatchedCount = (statementWithItems?.items ?? []).filter(ocrItem => {
                const matchedSystem = itemMatches.get(ocrItem.id);
                if (!matchedSystem) return false;
                const ocrQty = getOCRItemValue(ocrItem, 'quantity') as number | string;
                const normalizedQty = typeof ocrQty === 'number'
                  ? ocrQty
                  : (ocrQty !== '' ? Number(ocrQty) : undefined);
                return isQuantityMatched(normalizedQty, matchedSystem.quantity);
              }).length;
              const isItemNameAllMatched = totalCount > 0 && matchedNameCount === totalCount;
              const isQuantityAllMatched = totalCount > 0 && quantityMatchedCount === totalCount;
              
              return (
                <>
                  <div className="flex items-center justify-center gap-3 p-4 bg-gray-50 rounded-lg">
                    <span className={`text-3xl font-bold ${
                      totalMatchScore >= 80 ? 'text-green-600' :
                      totalMatchScore >= 50 ? 'text-yellow-600' :
                      'text-gray-500'
                    }`}>
                      {totalMatchScore}%
                    </span>
                    <div className="text-left">
                      <p className="text-[12px] font-medium text-gray-700">
                        발주번호: {selectedPONumber || '미선택'}
                      </p>
                      <p className="text-[11px] text-gray-500">
                        {matchedCount}/{totalCount}개 품목 매칭됨
                      </p>
                    </div>
                  </div>

                  {/* 매칭 체크 요약 */}
                  <div className="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-600">발주/수주번호 매칭</span>
                      <span className={`font-medium ${isOrderNumberMatched ? 'text-green-600' : 'text-red-600'}`}>
                        {isOrderNumberMatched ? '✅ 일치' : '❌ 불일치'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-600">품목명 매칭</span>
                      <span className={`font-medium ${isItemNameAllMatched ? 'text-green-600' : 'text-red-600'}`}>
                        {isItemNameAllMatched ? `✅ 모두 일치 (${matchedNameCount}/${totalCount})` : `❌ 불일치 (${matchedNameCount}/${totalCount})`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-600">수량 매칭</span>
                      <span className={`font-medium ${isQuantityAllMatched ? 'text-green-600' : 'text-red-600'}`}>
                        {isQuantityAllMatched ? `✅ 모두 일치 (${quantityMatchedCount}/${totalCount})` : `❌ 불일치 (${quantityMatchedCount}/${totalCount})`}
                      </span>
                    </div>
                  </div>

                  {/* 품목별 매칭 상세 */}
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-gray-600">품목별 매칭 상세:</p>
                    <div className="max-h-[250px] overflow-y-auto space-y-2">
                      {statementWithItems?.items.map((ocrItem) => {
                        const matchedSystem = itemMatches.get(ocrItem.id);
                        const similarity = matchedSystem 
                          ? calculateItemSimilarity(
                              (getOCRItemValue(ocrItem, 'item_name') as string) || '', 
                              matchedSystem.item_name, 
                              matchedSystem.specification
                            )
                          : 0;
                        const isMatched = similarity >= 40; // 최소 40점 이상
                        
                        // 수량 일치 여부
                        const ocrQtyRaw = getOCRItemValue(ocrItem, 'quantity') as number | string;
                        const ocrQty = typeof ocrQtyRaw === 'number'
                          ? ocrQtyRaw
                          : (ocrQtyRaw !== '' ? Number(ocrQtyRaw) : undefined);
                        const sysQty = matchedSystem?.quantity;
                        const qtyMatched = isQuantityMatched(ocrQty, sysQty);
                        const qtyLevel = getQuantityMatchLevel(ocrQty, sysQty);
                        
                        return (
                          <div 
                            key={ocrItem.id} 
                            className={`p-2 rounded-lg border ${
                              isMatched && qtyMatched ? 'bg-green-50 border-green-200' : 
                              isMatched ? 'bg-yellow-50 border-yellow-200' :
                              'bg-gray-50 border-gray-200'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-medium text-gray-800 truncate">
                                  {ocrItem.extracted_item_name || '-'}
                                </p>
                                <p className="text-[10px] text-gray-500">
                                  → {matchedSystem?.item_name || '미매칭'}
                                </p>
                              </div>
                              <span className={`text-[10px] px-2 py-0.5 rounded font-medium ml-2 ${
                                similarity >= 85 ? 'bg-green-100 text-green-700' :
                                similarity >= 60 ? 'bg-yellow-100 text-yellow-700' :
                                similarity >= 40 ? 'bg-orange-100 text-orange-700' :
                                'bg-red-100 text-red-600'
                              }`}>
                                {isMatched ? `${Math.round(similarity)}%` : '미매칭'}
                              </span>
                            </div>
                            {/* 수량 비교 */}
                            {isMatched && (
                              <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-gray-100">
                                <span className="text-[10px] text-gray-500">수량:</span>
                                <span className="text-[10px] font-medium text-gray-700">
                                  OCR {ocrQty ?? '-'}개
                                </span>
                                <span className="text-[10px] text-gray-400">vs</span>
                                <span className="text-[10px] font-medium text-gray-700">
                                  시스템 {sysQty ?? '-'}개
                                </span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                                  qtyMatched ? 'bg-green-100 text-green-700' :
                                  qtyLevel === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-red-100 text-red-700'
                                }`}>
                                  {qtyMatched ? '✅ 일치' : 
                                   qtyLevel === 'partial' ? '⚠️ 부분입고' : 
                                   '❌ 불일치'}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
          
          <DialogFooter>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setIsIntegratedMatchDetailOpen(false)}
              className="text-[11px]"
            >
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 이미지 뷰어 */}
      <StatementImageViewer
        isOpen={isImageViewerOpen}
        imageUrl={statement.image_url}
        onClose={() => setIsImageViewerOpen(false)}
      />

      {/* 발주번호 선택 드롭다운 (Portal로 document.body에 렌더링하여 Dialog 이벤트 차단 우회) */}
      {openDropdowns.has('global-po') && createPortal(
        <>
          {/* 오버레이 */}
          <div 
            className="fixed inset-0 z-[100]" 
            style={{ pointerEvents: 'auto' }}
            onClick={() => toggleDropdown('global-po')}
          />
          {/* 드롭다운 */}
          <div 
            className="fixed z-[101] bg-white border border-gray-200 rounded-lg shadow-xl min-w-[280px] max-h-[350px] overflow-y-auto"
            style={{
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              pointerEvents: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-gray-50 px-3 py-2 border-b border-gray-100 rounded-t-lg">
              <span className="text-[10px] font-semibold text-gray-600">발주번호 선택</span>
            </div>
            {/* allPONumberCandidates는 이미 발주번호 일치 → 점수순으로 정렬됨 */}
            {allPONumberCandidates.map((c, idx) => {
              const displayNumber = c.poNumber || c.salesOrderNumber || '';
              const isSelected = selectedPONumber === displayNumber;
              const isBestMatch = setMatchResult?.bestMatch?.purchase_order_number === c.poNumber ||
                                 setMatchResult?.bestMatch?.sales_order_number === c.salesOrderNumber;
              
              return (
                <div
                  key={idx}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectGlobalPO(displayNumber);
                    toggleDropdown('global-po');
                  }}
                  className={`p-2.5 cursor-pointer border-b border-gray-50 last:border-0 transition-colors ${
                    isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                  } ${isBestMatch ? 'ring-1 ring-inset ring-green-400' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] font-medium text-gray-900">
                      {c.poNumber || c.salesOrderNumber}
                      {c.poNumber && c.salesOrderNumber && (
                        <span className="text-gray-500 font-normal"> ({c.salesOrderNumber})</span>
                      )}
                    </p>
                    {(c.displayScore !== undefined || c.setMatchScore !== undefined) && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        (c.displayScore ?? c.setMatchScore ?? 0) >= 80 ? 'bg-green-100 text-green-700' :
                        (c.displayScore ?? c.setMatchScore ?? 0) >= 50 ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {Math.min(100, c.displayScore ?? c.setMatchScore ?? 0)}%
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    {c.matchedItemCount !== undefined 
                      ? `${c.matchedItemCount}/${statementWithItems?.items.length || 0}개 매칭`
                      : `${c.itemCount}개 품목`
                    } · {c.vendorName || '거래처 미상'}
                  </p>
                  {/* 수량 일치 정보 */}
                  {c.quantityMatchedCount !== undefined && c.matchedItemCount !== undefined && c.matchedItemCount > 0 && (
                    <p className={`text-[9px] mt-0.5 ${
                      c.quantityMismatchedCount === 0 ? 'text-green-600' : 'text-orange-600'
                    }`}>
                      {c.quantityMismatchedCount === 0 
                        ? `✅ 수량 모두 일치`
                        : `⚠️ 수량 ${c.quantityMismatchedCount}개 불일치`
                      }
                    </p>
                  )}
                  {isBestMatch && (
                    <p className="text-[9px] text-green-600 font-medium mt-0.5">
                      ✅ 세트 매칭 추천
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </>,
        document.body
      )}

      {/* 발주 상세 모달 */}
      {selectedPurchaseIdForDetail && (
        <PurchaseDetailModal
          purchaseId={selectedPurchaseIdForDetail}
          isOpen={isPurchaseDetailModalOpen}
          onClose={() => {
            setIsPurchaseDetailModalOpen(false);
            setSelectedPurchaseIdForDetail(null);
          }}
          activeTab="receipt"
        />
      )}
    </>
  );
}
