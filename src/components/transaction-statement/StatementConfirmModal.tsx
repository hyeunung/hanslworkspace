import { useState, useEffect, useCallback, useMemo } from "react";
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
  Wand2
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
  quantity?: number;
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

// 품목명 유사도 점수 계산
function calculateItemSimilarity(ocrName: string, systemName: string): number {
  const ocr = ocrName?.toLowerCase().replace(/\s+/g, '') || '';
  const sys = systemName?.toLowerCase().replace(/\s+/g, '') || '';
  
  if (!ocr || !sys) return 0;
  
  // 완전 일치
  if (ocr === sys) return 100;
  
  // 부분 포함
  if (ocr.includes(sys) || sys.includes(ocr)) return 80;
  
  // Levenshtein 거리 기반
  const distance = levenshteinDistance(ocr, sys);
  const maxLen = Math.max(ocr.length, sys.length);
  const similarity = ((maxLen - distance) / maxLen) * 100;
  
  // 단어 일부 일치 체크
  const ocrWords = ocrName?.split(/\s+/) || [];
  const sysWords = systemName?.split(/\s+/) || [];
  const commonWords = ocrWords.filter(w => 
    sysWords.some(sw => sw.toLowerCase().includes(w.toLowerCase()) || w.toLowerCase().includes(sw.toLowerCase()))
  );
  const wordMatchBonus = (commonWords.length / Math.max(ocrWords.length, sysWords.length)) * 30;
  
  return Math.min(100, similarity + wordMatchBonus);
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
            
            const matchingCandidates = item.match_candidates?.filter(c => 
              c.purchase_order_number === poNumber || c.sales_order_number === poNumber
            ) || [];
            
            // 매칭되는 후보가 1개면 무조건 선택
            if (matchingCandidates.length === 1) {
              const c = matchingCandidates[0];
              bestMatch = {
                purchase_id: c.purchase_id,
                item_id: c.item_id,
                purchase_order_number: c.purchase_order_number || '',
                sales_order_number: c.sales_order_number,
                item_name: c.item_name,
                quantity: c.quantity,
                unit_price: c.unit_price,
                amount: (c as any).amount,
                vendor_name: c.vendor_name
              };
            } else if (matchingCandidates.length > 1) {
              // 여러 개면 가장 유사한 것 선택
              matchingCandidates.forEach(c => {
                const score = calculateItemSimilarity(item.extracted_item_name || '', c.item_name);
                if (score > bestScore) {
                  bestScore = score;
                  bestMatch = {
                    purchase_id: c.purchase_id,
                    item_id: c.item_id,
                    purchase_order_number: c.purchase_order_number || '',
                    sales_order_number: c.sales_order_number,
                    item_name: c.item_name,
                    quantity: c.quantity,
                    unit_price: c.unit_price,
                    amount: (c as any).amount,
                    vendor_name: c.vendor_name
                  };
                }
              });
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
      loadData();
    }
  }, [isOpen, statement, loadData]);

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
    
    const candidateMap = new Map<string, { 
      poNumber: string; 
      salesOrderNumber?: string;
      itemCount: number; 
      items: MatchCandidate[];
      vendorName?: string;
      setMatchScore?: number; // 세트 매칭 점수
      matchedItemCount?: number;
    }>();
    
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
            items: [],
            vendorName: candidate.vendor_name,
            setMatchScore: candidate.matchScore,
            matchedItemCount: candidate.matchedItemCount
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
            items: [],
            vendorName: candidate.vendor_name
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
    
    // 3. 세트 매칭 점수순으로 정렬 (점수 있는 것 우선)
    const result = Array.from(candidateMap.values());
    result.sort((a, b) => {
      if (a.setMatchScore && b.setMatchScore) {
        return b.setMatchScore - a.setMatchScore;
      }
      if (a.setMatchScore) return -1;
      if (b.setMatchScore) return 1;
      return b.itemCount - a.itemCount;
    });
    
    return result;
  }, [statementWithItems, setMatchResult]);

  // 특정 발주번호에 해당하는 시스템 품목들
  const getSystemItemsForPO = useCallback((poNumber: string): SystemPurchaseItem[] => {
    if (!statementWithItems || !poNumber) return [];
    
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
            quantity: candidate.quantity,
            unit_price: candidate.unit_price,
            amount: (candidate as any).amount, // amount는 일부 후보에만 존재
            vendor_name: candidate.vendor_name
          });
        }
      });
    });
    
    // 중복 제거
    return items.filter((item, index, self) => 
      index === self.findIndex(t => t.item_id === item.item_id)
    );
  }, [statementWithItems]);

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
  const getOCRItemValue = (ocrItem: TransactionStatementItemWithMatch, field: 'item_name' | 'quantity' | 'unit_price' | 'amount' | 'po_number') => {
    const edited = editedOCRItems.get(ocrItem.id);
    if (edited && edited[field] !== undefined) {
      return edited[field];
    }
    
    switch (field) {
      case 'item_name': return ocrItem.extracted_item_name || '';
      case 'quantity': return ocrItem.extracted_quantity ?? '';
      case 'unit_price': return ocrItem.extracted_unit_price ?? '';
      case 'amount': return ocrItem.extracted_amount ?? '';
      case 'po_number': return ocrItem.extracted_po_number ? normalizeOrderNumber(ocrItem.extracted_po_number) : '';
      default: return '';
    }
  };

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

  // 매칭 상태 계산
  const getMatchStatus = (ocrItem: TransactionStatementItemWithMatch): 'high' | 'med' | 'low' | 'unmatched' => {
    const matched = itemMatches.get(ocrItem.id);
    if (!matched) return 'unmatched';
    
    const similarity = calculateItemSimilarity(ocrItem.extracted_item_name || '', matched.item_name || '');
    
    if (similarity >= 80) return 'high';
    if (similarity >= 50) return 'med';
    if (similarity >= 30) return 'low';
    return 'unmatched';
  };

  // 발주번호 선택 시 (Case 1: 전체 적용)
  const handleSelectGlobalPO = (poNumber: string) => {
    setSelectedPONumber(poNumber);
    
    // 해당 발주번호의 시스템 품목들 가져오기
    const systemItems = getSystemItemsForPO(poNumber);
    
    // 자동 매칭 수행
    if (statementWithItems) {
      const newMatches = new Map<string, SystemPurchaseItem | null>();
      
      statementWithItems.items.forEach(ocrItem => {
        // 가장 유사한 시스템 품목 찾기
        let bestMatch: SystemPurchaseItem | null = null;
        let bestScore = 0;
        
        systemItems.forEach(sysItem => {
          const score = calculateItemSimilarity(ocrItem.extracted_item_name || '', sysItem.item_name);
          if (score > bestScore && score >= 30) {
            bestScore = score;
            bestMatch = sysItem;
          }
        });
        
        newMatches.set(ocrItem.id, bestMatch);
      });
      
      setItemMatches(newMatches);
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
      // 해당 발주번호와 일치하는 후보들 필터링
      const matchingCandidates = ocrItem.match_candidates?.filter(c => 
        c.purchase_order_number === poNumber || c.sales_order_number === poNumber
      ) || [];
      
      let bestMatch: SystemPurchaseItem | null = null;
      
      if (matchingCandidates.length === 1) {
        // 후보가 1개면 무조건 선택
        const c = matchingCandidates[0];
        bestMatch = {
          purchase_id: c.purchase_id,
          item_id: c.item_id,
          purchase_order_number: c.purchase_order_number || '',
          sales_order_number: c.sales_order_number,
          item_name: c.item_name,
          quantity: c.quantity,
          unit_price: c.unit_price,
          amount: (c as any).amount,
          vendor_name: c.vendor_name
        };
      } else if (matchingCandidates.length > 1) {
        // 여러 개면 가장 유사한 것 선택
        let bestScore = -1;
        matchingCandidates.forEach(c => {
          const score = calculateItemSimilarity(ocrItem.extracted_item_name || '', c.item_name);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = {
              purchase_id: c.purchase_id,
              item_id: c.item_id,
              purchase_order_number: c.purchase_order_number || '',
              sales_order_number: c.sales_order_number,
              item_name: c.item_name,
              quantity: c.quantity,
              unit_price: c.unit_price,
              amount: (c as any).amount,
              vendor_name: c.vendor_name
            };
          }
        });
      }
      
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

  // 시스템 품목 직접 선택
  const handleSelectSystemItem = (ocrItemId: string, systemItem: SystemPurchaseItem | null) => {
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

  // 자동 매칭 (전체)
  const handleAutoMatch = () => {
    if (!statementWithItems) return;
    
    const newMatches = new Map<string, SystemPurchaseItem | null>();
    let matchedCount = 0;
    
    statementWithItems.items.forEach(ocrItem => {
      // 해당 품목의 발주번호로 필터링
      const poNumber = isSamePONumber ? selectedPONumber : (itemPONumbers.get(ocrItem.id) || ocrItem.extracted_po_number);
      
      if (!poNumber) {
        // 발주번호 없으면 모든 후보에서 검색
        let bestMatch: SystemPurchaseItem | null = null;
        let bestScore = -1;
        
        ocrItem.match_candidates?.forEach(candidate => {
          const score = calculateItemSimilarity(ocrItem.extracted_item_name || '', candidate.item_name);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = {
              purchase_id: candidate.purchase_id,
              item_id: candidate.item_id,
              purchase_order_number: candidate.purchase_order_number || '',
              sales_order_number: candidate.sales_order_number,
              item_name: candidate.item_name,
              quantity: candidate.quantity,
              unit_price: candidate.unit_price,
              amount: (candidate as any).amount,
              vendor_name: candidate.vendor_name
            };
          }
        });
        
        if (bestMatch) matchedCount++;
        newMatches.set(ocrItem.id, bestMatch);
        return;
      }
      
      // 해당 발주번호의 후보들 필터링
      const matchingCandidates = ocrItem.match_candidates?.filter(c => 
        c.purchase_order_number === poNumber || c.sales_order_number === poNumber
      ) || [];
      
      let bestMatch: SystemPurchaseItem | null = null;
      
      if (matchingCandidates.length === 1) {
        const c = matchingCandidates[0];
        bestMatch = {
          purchase_id: c.purchase_id,
          item_id: c.item_id,
          purchase_order_number: c.purchase_order_number || '',
          sales_order_number: c.sales_order_number,
          item_name: c.item_name,
          quantity: c.quantity,
          unit_price: c.unit_price,
          amount: (c as any).amount,
          vendor_name: c.vendor_name
        };
      } else if (matchingCandidates.length > 1) {
        let bestScore = -1;
        matchingCandidates.forEach(c => {
          const score = calculateItemSimilarity(ocrItem.extracted_item_name || '', c.item_name);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = {
              purchase_id: c.purchase_id,
              item_id: c.item_id,
              purchase_order_number: c.purchase_order_number || '',
              sales_order_number: c.sales_order_number,
              item_name: c.item_name,
              quantity: c.quantity,
              unit_price: c.unit_price,
              amount: (c as any).amount,
              vendor_name: c.vendor_name
            };
          }
        });
      }
      
      if (bestMatch) matchedCount++;
      newMatches.set(ocrItem.id, bestMatch);
    });
    
    setItemMatches(newMatches);
    toast.success(`자동 매칭 완료: ${matchedCount}/${statementWithItems.items.length}건`);
  };

  // 확정
  const handleConfirm = async () => {
    if (!statementWithItems) return;

    try {
      setSaving(true);

      // 1. OCR 수정사항 학습 데이터로 저장
      await saveOCRCorrections();

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

  const renderMatchStatusBadge = (status: 'high' | 'med' | 'low' | 'unmatched') => {
    const baseClass = "inline-flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium business-radius-badge whitespace-nowrap";
    switch (status) {
      case 'high':
        return <span className={`${baseClass} bg-green-100 text-green-700`}><Check className="w-3 h-3" />높음</span>;
      case 'med':
        return <span className={`${baseClass} bg-yellow-100 text-yellow-700`}>보통</span>;
      case 'low':
        return <span className={`${baseClass} bg-orange-100 text-orange-700`}>낮음</span>;
      case 'unmatched':
        return <span className={`${baseClass} bg-gray-100 text-gray-500`}>미매칭</span>;
    }
  };

  const toggleDropdown = (key: string) => {
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
        <DialogContent className="max-w-[95vw] md:max-w-[1200px] max-h-[90vh] overflow-hidden flex flex-col business-radius-modal" showCloseButton={false}>
          <DialogHeader className="border-b border-gray-100 pb-3">
            <DialogTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2 modal-title">
                <CheckCircle className="w-4 h-4 text-hansl-600" />
                거래명세서 확인 및 확정
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAutoMatch}
                  className="button-base h-7 text-[10px] border-blue-300 text-blue-600 hover:bg-blue-50"
                >
                  <Wand2 className="w-3.5 h-3.5 mr-1" />
                  자동 매칭
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsImageViewerOpen(true)}
                  className="button-base h-7 text-[10px]"
                >
                  <ImageIcon className="w-3.5 h-3.5 mr-1" />
                  원본 보기
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-hansl-600" />
              <span className="ml-3 modal-subtitle">로딩 중...</span>
            </div>
          ) : statementWithItems ? (
            <div className="flex-1 overflow-hidden flex flex-col py-3">
              {/* 요약 정보 */}
              <div className="flex items-center gap-6 p-3 bg-gray-50 business-radius-card mb-4">
                <div>
                  <p className="modal-label">거래처</p>
                  <p className="modal-value">{statementWithItems.vendor_name || '-'}</p>
                </div>
                <div>
                  <p className="modal-label">거래일</p>
                  <p className="modal-value">
                    {statementWithItems.statement_date 
                      ? new Date(statementWithItems.statement_date).toLocaleDateString('ko-KR')
                      : '-'
                    }
                  </p>
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
                    <tr>
                      {/* 좌측: 시스템 발주품목 헤더 */}
                      <th colSpan={isSamePONumber ? 4 : 5} className="border-b border-r-2 border-gray-300 p-2 text-left w-[45%]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="modal-section-title text-gray-700">📋 시스템 발주품목</span>
                          {/* 세트 매칭 신뢰도 표시 */}
                          {isSamePONumber && setMatchResult?.bestMatch && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                              setMatchResult.bestMatch.confidence === 'high' 
                                ? 'bg-green-100 text-green-700' 
                                : setMatchResult.bestMatch.confidence === 'medium'
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-red-100 text-red-700'
                            }`}>
                              세트 매칭 {setMatchResult.bestMatch.matchScore}%
                              ({setMatchResult.bestMatch.matchedItemCount}/{setMatchResult.bestMatch.totalItemCount})
                            </span>
                          )}
                          {isSamePONumber && allPONumberCandidates.length > 0 && (
                            <div className="relative">
                              <button
                                onClick={() => toggleDropdown('global-po')}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-white border border-blue-300 rounded-md hover:bg-blue-50 text-blue-700"
                              >
                                {selectedPONumber || '발주번호 선택'}
                                <ChevronDown className="w-3 h-3" />
                              </button>
                              {openDropdowns.has('global-po') && (
                                <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-md shadow-lg min-w-[240px] max-h-[250px] overflow-auto">
                                  {allPONumberCandidates.map((c, idx) => {
                                    const displayNumber = c.poNumber || c.salesOrderNumber || '';
                                    const isSelected = selectedPONumber === displayNumber;
                                    const isBestMatch = setMatchResult?.bestMatch?.purchase_order_number === c.poNumber ||
                                                       setMatchResult?.bestMatch?.sales_order_number === c.salesOrderNumber;
                                    
                                    return (
                                      <div
                                        key={idx}
                                        onClick={() => {
                                          handleSelectGlobalPO(displayNumber);
                                          toggleDropdown('global-po');
                                        }}
                                        className={`p-2 cursor-pointer border-b border-gray-100 last:border-0 ${
                                          isSelected ? 'bg-blue-50' : 'hover:bg-gray-100'
                                        } ${isBestMatch ? 'ring-1 ring-green-400' : ''}`}
                                      >
                                        <div className="flex items-center justify-between">
                                          <p className="modal-label text-gray-900">
                                            {displayNumber}
                                          </p>
                                          {c.setMatchScore !== undefined && (
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                                              c.setMatchScore >= 80 ? 'bg-green-100 text-green-700' :
                                              c.setMatchScore >= 50 ? 'bg-yellow-100 text-yellow-700' :
                                              'bg-gray-100 text-gray-600'
                                            }`}>
                                              {c.setMatchScore}%
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-[9px] text-gray-500">
                                          {c.matchedItemCount !== undefined 
                                            ? `${c.matchedItemCount}/${statementWithItems?.items.length || 0}개 매칭`
                                            : `${c.itemCount}개 품목`
                                          } · {c.vendorName || '거래처 미상'}
                                        </p>
                                        {isBestMatch && (
                                          <p className="text-[8px] text-green-600 font-medium mt-0.5">
                                            ✅ 세트 매칭 추천
                                          </p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </th>
                      
                      {/* 중앙: 매칭 후보 */}
                      <th className="border-b border-r-2 border-gray-300 p-2 text-center bg-blue-50 w-[10%]">
                        <span className="modal-label text-blue-700">매칭 후보</span>
                      </th>
                      
                      {/* 우측: OCR 추출 품목 헤더 */}
                      <th colSpan={isSamePONumber ? 4 : 5} className="border-b border-gray-200 p-2 text-left w-[45%]">
                        <span className="modal-section-title text-gray-700">
                          📄 OCR 추출 품목
                          {isSamePONumber && commonPONumber && (
                            <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-medium rounded">
                              {commonPONumber}
                            </span>
                          )}
                        </span>
                      </th>
                    </tr>
                    <tr className="modal-label">
                      {/* 좌측 컬럼 */}
                      {!isSamePONumber && (
                        <th className="border-b border-r border-gray-200 p-2 text-left min-w-[140px]">발주/수주번호</th>
                      )}
                      <th className="border-b border-r border-gray-200 p-2 text-left">품목명</th>
                      <th className="border-b border-r border-gray-200 p-2 text-right">수량</th>
                      <th className="border-b border-r border-gray-200 p-2 text-right">단가</th>
                      <th className="border-b border-r-2 border-gray-300 p-2 text-right">합계</th>
                      
                      {/* 중앙 */}
                      <th className="border-b border-r-2 border-gray-300 p-2 text-center bg-blue-50"></th>
                      
                      {/* 우측 컬럼 */}
                      <th className="border-b border-r border-gray-200 p-2 text-left">품목명</th>
                      <th className="border-b border-r border-gray-200 p-2 text-right">수량</th>
                      <th className="border-b border-r border-gray-200 p-2 text-right">단가</th>
                      <th className={`border-b border-gray-200 p-2 text-right ${!isSamePONumber ? 'border-r' : ''}`}>합계</th>
                      {!isSamePONumber && (
                        <th className="border-b border-gray-200 p-2 text-left min-w-[140px]">발주/수주번호</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {statementWithItems.items.map((ocrItem) => {
                      const matchedSystem = itemMatches.get(ocrItem.id);
                      const matchStatus = getMatchStatus(ocrItem);
                      // OCR 추출 번호를 시스템 형식으로 정규화 (예: _01 → _001, -1 → -01)
                      const normalizedExtractedPO = ocrItem.extracted_po_number 
                        ? normalizeOrderNumber(ocrItem.extracted_po_number) 
                        : undefined;
                      const itemPO = itemPONumbers.get(ocrItem.id) || normalizedExtractedPO;
                      const poCandidates = getPOCandidatesForItem(ocrItem.id);
                      const systemCandidates = getSystemItemsForPO(isSamePONumber ? selectedPONumber : (itemPO || ''));
                      
                      return (
                        <tr key={ocrItem.id} className="hover:bg-gray-50 border-b border-gray-100">
                          {/* Case 2: 발주번호 컬럼 */}
                          {!isSamePONumber && (
                            <td className="border-r border-gray-200 p-2">
                              <div className="relative">
                                <button
                                  onClick={() => toggleDropdown(`po-${ocrItem.id}`)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-medium bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 text-blue-700 whitespace-nowrap"
                                >
                                  <span>{itemPO || '선택'}</span>
                                  <ChevronDown className="w-2.5 h-2.5 flex-shrink-0" />
                                </button>
                                {openDropdowns.has(`po-${ocrItem.id}`) && poCandidates.length > 0 && (
                                  <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-md shadow-lg min-w-[180px] max-h-[150px] overflow-auto">
                                    {poCandidates.map((po, idx) => (
                                      <div
                                        key={idx}
                                        onClick={() => handleSelectItemPO(ocrItem.id, po)}
                                        className={`p-2 hover:bg-gray-100 cursor-pointer text-[10px] ${po === itemPO ? 'bg-blue-50' : ''}`}
                                      >
                                        {po}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                          )}
                          
                          {/* 좌측: 시스템 품목 */}
                          <td className="border-r border-gray-200 p-2">
                            {matchedSystem ? (
                              <div className="flex items-center gap-1 whitespace-nowrap">
                                <span className="text-gray-900">{matchedSystem.item_name}</span>
                                <button
                                  onClick={() => handleSelectSystemItem(ocrItem.id, null)}
                                  className="text-gray-400 hover:text-red-500 flex-shrink-0"
                                  title="매칭 해제"
                                >
                                  <XCircle className="w-3 h-3" />
                                </button>
                              </div>
                            ) : systemCandidates.length > 0 ? (
                              <div className="relative">
                                <button
                                  onClick={() => toggleDropdown(`item-${ocrItem.id}`)}
                                  className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-[10px]"
                                >
                                  <span>▼ 후보 선택</span>
                                  <span className="text-gray-400">({systemCandidates.length})</span>
                                </button>
                                
                                {openDropdowns.has(`item-${ocrItem.id}`) && (
                                  <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-md shadow-lg min-w-[280px] max-h-[200px] overflow-auto">
                                    {systemCandidates.map((candidate, cidx) => {
                                      const score = calculateItemSimilarity(ocrItem.extracted_item_name || '', candidate.item_name);
                                      return (
                                        <div
                                          key={cidx}
                                          onClick={() => handleSelectSystemItem(ocrItem.id, candidate)}
                                          className="p-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-0"
                                        >
                                          <div className="flex items-center justify-between">
                                            <p className="modal-label text-gray-900">{candidate.item_name}</p>
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                                              score >= 80 ? 'bg-green-100 text-green-700' :
                                              score >= 50 ? 'bg-yellow-100 text-yellow-700' :
                                              'bg-gray-100 text-gray-600'
                                            }`}>
                                              {Math.round(score)}%
                                            </span>
                                          </div>
                                          <p className="text-[9px] text-gray-500">
                                            {candidate.quantity ?? '-'}개 × {formatAmount(candidate.unit_price)} = {formatAmount(candidate.amount)}
                                          </p>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="modal-label text-gray-400">후보 없음</span>
                            )}
                          </td>
                          <td className="border-r border-gray-200 p-2 text-right text-gray-600">
                            {matchedSystem?.quantity ?? '-'}
                          </td>
                          <td className="border-r border-gray-200 p-2 text-right text-gray-600">
                            {matchedSystem ? formatAmount(matchedSystem.unit_price) : '-'}
                          </td>
                          <td className="border-r-2 border-gray-300 p-2 text-right font-medium text-gray-900">
                            {matchedSystem ? formatAmount(matchedSystem.amount) : '-'}
                          </td>
                          
                          {/* 중앙: 매칭 상태 */}
                          <td className="border-r-2 border-gray-300 p-2 text-center bg-blue-50/50">
                            {renderMatchStatusBadge(matchStatus)}
                          </td>
                          
                          {/* 우측: OCR 품목 (편집 가능) */}
                          <td className="border-r border-gray-200 p-1">
                            <input
                              type="text"
                              value={getOCRItemValue(ocrItem, 'item_name') as string}
                              onChange={(e) => handleEditOCRItem(ocrItem.id, 'item_name', e.target.value)}
                              className={`w-full px-1.5 py-0.5 text-[11px] border rounded focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                isOCRItemEdited(ocrItem, 'item_name') 
                                  ? 'border-orange-400 bg-orange-50' 
                                  : 'border-gray-200 bg-white'
                              }`}
                              title={isOCRItemEdited(ocrItem, 'item_name') ? `원본: ${ocrItem.extracted_item_name}` : undefined}
                            />
                          </td>
                          <td className="border-r border-gray-200 p-1">
                            <input
                              type="number"
                              value={getOCRItemValue(ocrItem, 'quantity') as number}
                              onChange={(e) => handleEditOCRItem(ocrItem.id, 'quantity', e.target.value ? Number(e.target.value) : 0)}
                              className={`w-16 px-1.5 py-0.5 text-[11px] text-right border rounded focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                isOCRItemEdited(ocrItem, 'quantity') 
                                  ? 'border-orange-400 bg-orange-50' 
                                  : 'border-gray-200 bg-white'
                              }`}
                              title={isOCRItemEdited(ocrItem, 'quantity') ? `원본: ${ocrItem.extracted_quantity}` : undefined}
                            />
                          </td>
                          <td className="border-r border-gray-200 p-1">
                            <input
                              type="number"
                              value={getOCRItemValue(ocrItem, 'unit_price') as number}
                              onChange={(e) => handleEditOCRItem(ocrItem.id, 'unit_price', e.target.value ? Number(e.target.value) : 0)}
                              className={`w-20 px-1.5 py-0.5 text-[11px] text-right border rounded focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                isOCRItemEdited(ocrItem, 'unit_price') 
                                  ? 'border-orange-400 bg-orange-50' 
                                  : 'border-gray-200 bg-white'
                              }`}
                              title={isOCRItemEdited(ocrItem, 'unit_price') ? `원본: ${ocrItem.extracted_unit_price}` : undefined}
                            />
                          </td>
                          <td className={`p-1 ${!isSamePONumber ? 'border-r border-gray-200' : ''}`}>
                            <input
                              type="number"
                              value={getOCRItemValue(ocrItem, 'amount') as number}
                              onChange={(e) => handleEditOCRItem(ocrItem.id, 'amount', e.target.value ? Number(e.target.value) : 0)}
                              className={`w-24 px-1.5 py-0.5 text-[11px] text-right font-medium border rounded focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                isOCRItemEdited(ocrItem, 'amount') 
                                  ? 'border-orange-400 bg-orange-50' 
                                  : 'border-gray-200 bg-white'
                              }`}
                              title={isOCRItemEdited(ocrItem, 'amount') ? `원본: ${ocrItem.extracted_amount}` : undefined}
                            />
                          </td>
                          
                          {/* Case 2: OCR 발주번호 표시 (편집 가능) */}
                          {!isSamePONumber && (
                            <td className="p-1">
                              <input
                                type="text"
                                value={getOCRItemValue(ocrItem, 'po_number') as string}
                                onChange={(e) => handleEditOCRItem(ocrItem.id, 'po_number', e.target.value)}
                                className={`w-full px-1.5 py-0.5 text-[10px] font-mono border rounded focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                  isOCRItemEdited(ocrItem, 'po_number') 
                                    ? 'border-orange-400 bg-orange-50' 
                                    : 'border-gray-200 bg-white'
                                }`}
                                title={isOCRItemEdited(ocrItem, 'po_number') ? `원본: ${ocrItem.extracted_po_number}` : undefined}
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    
                    {/* 합계 행 */}
                    <tr className="bg-gray-50 font-medium">
                      <td colSpan={isSamePONumber ? 3 : 4} className="border-t border-gray-200 p-2 text-right text-gray-600">
                        시스템 합계
                      </td>
                      <td className="border-r-2 border-t border-gray-300 p-2 text-right text-gray-900">
                        {formatAmount(
                          Array.from(itemMatches.values())
                            .filter(Boolean)
                            .reduce((sum, item) => sum + (item?.amount || 0), 0)
                        )}
                      </td>
                      <td className="border-r-2 border-t border-gray-300 p-2 bg-blue-50/50"></td>
                      <td colSpan={isSamePONumber ? 3 : 4} className="border-t border-gray-200 p-2 text-right text-gray-600">
                        OCR 합계
                        {editedOCRItems.size > 0 && (
                          <span className="ml-1 text-[9px] text-orange-600">(수정됨)</span>
                        )}
                      </td>
                      <td className="border-t border-gray-200 p-2 text-right text-gray-900">
                        {formatAmount(
                          statementWithItems.items.reduce((sum, item) => {
                            const edited = editedOCRItems.get(item.id);
                            const amount = edited?.amount !== undefined ? edited.amount : (item.extracted_amount || 0);
                            return sum + amount;
                          }, 0)
                        )}
                      </td>
                      {!isSamePONumber && <td className="border-t border-gray-200"></td>}
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

          <DialogFooter className="border-t border-gray-100 pt-3 gap-2">
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

      {/* 이미지 뷰어 */}
      <StatementImageViewer
        isOpen={isImageViewerOpen}
        imageUrl={statement.image_url}
        onClose={() => setIsImageViewerOpen(false)}
      />
    </>
  );
}
