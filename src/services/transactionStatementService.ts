/**
 * 거래명세서 확인 시스템 서비스
 * - 이미지 업로드
 * - OCR/LLM 추출 (Edge Function 호출)
 * - 발주 매칭
 * - 확정 및 반영
 * - 학습 데이터 저장
 */

import { createClient } from "@/lib/supabase/client";
import type {
  TransactionStatement,
  TransactionStatementItem,
  TransactionStatementWithItems,
  TransactionStatementItemWithMatch,
  MatchCandidate,
  OCRCorrection,
  ConfirmStatementRequest,
  SaveCorrectionRequest
} from "@/types/transactionStatement";
import { normalizeOrderNumber } from "@/types/transactionStatement";

class TransactionStatementService {
  private supabase;

  constructor() {
    this.supabase = createClient();
  }

  /**
   * 거래명세서 이미지 업로드
   */
  async uploadStatement(
    file: File,
    uploaderName: string
  ): Promise<{ success: boolean; data?: { statementId: string; imageUrl: string }; error?: string }> {
    try {
      // 고유 파일명 생성
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const uuid = crypto.randomUUID();
      const fileName = `${uuid}.${ext}`;
      const storagePath = `Transaction Statement/${fileName}`;

      // Storage에 업로드
      const { data: uploadData, error: uploadError } = await this.supabase
        .storage
        .from('receipt-images')
        .upload(storagePath, file, {
          contentType: file.type,
          upsert: false
        });

      if (uploadError) throw uploadError;

      // Public URL 가져오기
      const { data: urlData } = this.supabase
        .storage
        .from('receipt-images')
        .getPublicUrl(storagePath);

      const imageUrl = urlData.publicUrl;

      // 현재 사용자 정보
      const { data: { user } } = await this.supabase.auth.getUser();

      // DB에 레코드 생성
      const { data: statement, error: dbError } = await this.supabase
        .from('transaction_statements')
        .insert({
          image_url: imageUrl,
          file_name: file.name,
          uploaded_by: user?.id,
          uploaded_by_name: uploaderName,
          status: 'pending'
        })
        .select()
        .single();

      if (dbError) throw dbError;

      return {
        success: true,
        data: {
          statementId: statement.id,
          imageUrl
        }
      };
    } catch (error) {
      console.error('Upload statement error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '업로드 중 오류가 발생했습니다.'
      };
    }
  }

  /**
   * OCR/LLM 추출 실행 (Edge Function 호출)
   */
  async extractStatementData(
    statementId: string,
    imageUrl: string
  ): Promise<{ success: boolean; data?: TransactionStatementWithItems; error?: string }> {
    try {
      console.log('[Service] Calling Edge Function with:', { statementId, imageUrl });
      
      // Edge Function 호출
      const { data, error } = await this.supabase.functions.invoke('ocr-transaction-statement', {
        body: {
          statementId,
          imageUrl
        }
      });

      console.log('[Service] Edge Function response:', { data, error });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'OCR 추출 실패');
      }

      // 추출된 데이터 조회
      const result = await this.getStatementWithItems(statementId);
      return result;
    } catch (error) {
      console.error('[Service] Extract statement error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OCR 추출 중 오류가 발생했습니다.'
      };
    }
  }

  /**
   * 거래명세서 목록 조회
   */
  async getStatements(filters?: {
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ success: boolean; data?: TransactionStatement[]; count?: number; error?: string }> {
    try {
      let query = this.supabase
        .from('transaction_statements')
        .select('*', { count: 'exact' })
        .order('uploaded_at', { ascending: false });

      if (filters?.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      if (filters?.dateFrom) {
        query = query.gte('uploaded_at', filters.dateFrom);
      }

      if (filters?.dateTo) {
        query = query.lte('uploaded_at', filters.dateTo + 'T23:59:59');
      }

      if (filters?.search) {
        query = query.or(`vendor_name.ilike.%${filters.search}%,file_name.ilike.%${filters.search}%`);
      }

      if (filters?.limit) {
        query = query.limit(filters.limit);
      }

      if (filters?.offset) {
        query = query.range(filters.offset, filters.offset + (filters.limit || 20) - 1);
      }

      const { data, count, error } = await query;

      if (error) throw error;

      return { success: true, data: data || [], count: count || 0 };
    } catch (error) {
      console.error('Get statements error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '조회 중 오류가 발생했습니다.'
      };
    }
  }

  /**
   * 거래명세서 상세 조회 (품목 포함)
   */
  async getStatementWithItems(
    statementId: string
  ): Promise<{ success: boolean; data?: TransactionStatementWithItems; error?: string }> {
    try {
      // 거래명세서 조회
      const { data: statement, error: stmtError } = await this.supabase
        .from('transaction_statements')
        .select('*')
        .eq('id', statementId)
        .single();

      if (stmtError) throw stmtError;

      // 품목 조회
      const { data: items, error: itemsError } = await this.supabase
        .from('transaction_statement_items')
        .select('*')
        .eq('statement_id', statementId)
        .order('line_number', { ascending: true });

      if (itemsError) throw itemsError;

      // 품목별 매칭 후보 조회 (거래처명을 전달하여 필터링)
      const statementVendorName = statement.vendor_name || '';
      const itemsWithMatch: TransactionStatementItemWithMatch[] = await Promise.all(
        (items || []).map(async (item: TransactionStatementItem) => {
          const matchCandidates = await this.findMatchCandidates(item, statementVendorName);
          
          // 매칭된 발주/품목 정보
          let matchedPurchase = undefined;
          let matchedItem = undefined;
          
          if (item.matched_purchase_id) {
            const { data: purchase } = await this.supabase
              .from('purchase_requests')
              .select('id, purchase_order_number, sales_order_number, vendor:vendors(vendor_name)')
              .eq('id', item.matched_purchase_id)
              .single();
            
            if (purchase) {
              matchedPurchase = {
                id: purchase.id,
                purchase_order_number: purchase.purchase_order_number || '',
                sales_order_number: purchase.sales_order_number,
                vendor_name: purchase.vendor?.vendor_name
              };
            }
          }

          if (item.matched_item_id) {
            const { data: purchaseItem } = await this.supabase
              .from('purchase_request_items')
              .select('id, item_name, specification, quantity, unit_price_value')
              .eq('id', item.matched_item_id)
              .single();
            
            if (purchaseItem) {
              matchedItem = {
                id: purchaseItem.id,
                item_name: purchaseItem.item_name,
                specification: purchaseItem.specification,
                quantity: purchaseItem.quantity,
                unit_price_value: purchaseItem.unit_price_value
              };
            }
          }

          return {
            ...item,
            match_candidates: matchCandidates,
            matched_purchase: matchedPurchase,
            matched_item: matchedItem
          };
        })
      );

      return {
        success: true,
        data: {
          ...statement,
          items: itemsWithMatch
        }
      };
    } catch (error) {
      console.error('Get statement with items error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '조회 중 오류가 발생했습니다.'
      };
    }
  }

  /**
   * 발주 매칭 후보 찾기
   * - 다중 신호 매칭: 발주번호 + 품목명 + 수량을 모두 고려
   * - 발주번호가 달라도 품목명+수량이 맞으면 후보에 포함
   * - 거래처가 일치/유사해야만 후보에 포함 (필수 조건)
   */
  async findMatchCandidates(item: TransactionStatementItem, statementVendorName?: string): Promise<MatchCandidate[]> {
    const candidateMap = new Map<string, MatchCandidate>(); // 중복 방지용

    try {
      const normalizedNumber = item.extracted_po_number 
        ? normalizeOrderNumber(item.extracted_po_number) 
        : '';

      // 1. PO/SO 번호로 매칭 시도
      if (normalizedNumber) {
        const { data: byNumber } = await this.supabase
          .from('purchase_requests')
          .select(`
            id, 
            purchase_order_number, 
            sales_order_number,
            vendor:vendors(vendor_name),
            items:purchase_request_items(id, item_name, specification, quantity, unit_price_value)
          `)
          .or(`purchase_order_number.eq.${normalizedNumber},sales_order_number.eq.${normalizedNumber}`)
          .limit(10);

        if (byNumber) {
          for (const purchase of byNumber) {
            // 거래처 유사도 체크 (거래명세서의 거래처와 시스템 발주의 거래처 비교)
            const sysVendorName = purchase.vendor?.vendor_name || '';
            const vendorSimilarity = statementVendorName 
              ? this.calculateVendorSimilarity(statementVendorName, sysVendorName)
              : 100; // 거래처 정보 없으면 통과
            
            // 거래처 유사도 70% 미만이면 스킵 (거래처 다르면 후보 제외)
            if (vendorSimilarity < 70) {
              console.log(`❌ 거래처 불일치로 제외: "${statementVendorName}" vs "${sysVendorName}" (${vendorSimilarity}%)`);
              continue;
            }

            for (const purchaseItem of purchase.items || []) {
              const key = `${purchase.id}-${purchaseItem.id}`;
              const matchReasons = ['발주/수주번호 일치'];
              let score = 50; // 기본 번호 매칭 점수
              
              // 거래처 일치 보너스
              if (vendorSimilarity >= 90) {
                score += 10;
                matchReasons.push('거래처 일치');
              } else if (vendorSimilarity >= 70) {
                score += 5;
                matchReasons.push('거래처 유사');
              }
              
              // 품목명 유사도 추가 점수
              if (item.extracted_item_name && purchaseItem.item_name) {
                const nameScore = this.calculateNameSimilarity(item.extracted_item_name, purchaseItem.item_name);
                score += nameScore * 0.3; // 최대 +30점
                if (nameScore >= 80) matchReasons.push('품목명 일치');
              }
              
              // 수량 일치 추가 점수
              if (item.extracted_quantity && purchaseItem.quantity) {
                if (item.extracted_quantity === purchaseItem.quantity) {
                  score += 20;
                  matchReasons.push('수량 일치');
                }
              }
              
              candidateMap.set(key, {
                purchase_id: purchase.id,
                purchase_order_number: purchase.purchase_order_number || '',
                sales_order_number: purchase.sales_order_number,
                item_id: purchaseItem.id,
                item_name: purchaseItem.item_name,
                specification: purchaseItem.specification,
                quantity: purchaseItem.quantity,
                unit_price: purchaseItem.unit_price_value,
                vendor_name: sysVendorName,
                score,
                match_reasons: matchReasons
              });
            }
          }
        }
      }

      // 2. 품목명+수량으로 매칭 시도 (발주번호가 달라도 찾기)
      if (item.extracted_item_name) {
        const itemName = item.extracted_item_name;
        
        // 품목명 검색 (부분 일치)
        const searchTerm = itemName.length > 3 ? itemName.substring(0, Math.min(itemName.length, 10)) : itemName;
        
        const { data: byName } = await this.supabase
          .from('purchase_request_items')
          .select(`
            id, 
            item_name, 
            specification, 
            quantity, 
            unit_price_value,
            purchase:purchase_requests!inner(
              id, 
              purchase_order_number, 
              sales_order_number,
              vendor:vendors(vendor_name)
            )
          `)
          .ilike('item_name', `%${searchTerm}%`)
          .limit(30);

        if (byName) {
          for (const purchaseItem of byName) {
            const key = `${purchaseItem.purchase?.id}-${purchaseItem.id}`;
            
            // 이미 번호 매칭으로 추가된 경우 스킵
            if (candidateMap.has(key)) continue;
            
            // 거래처 유사도 체크 - 거래처 다르면 후보에서 제외
            const sysVendorName = purchaseItem.purchase?.vendor?.vendor_name || '';
            const vendorSimilarity = statementVendorName 
              ? this.calculateVendorSimilarity(statementVendorName, sysVendorName)
              : 100; // 거래처 정보 없으면 통과
            
            // 거래처 유사도 70% 미만이면 스킵 (거래처 다르면 후보 제외)
            if (vendorSimilarity < 70) {
              continue;
            }
            
            const matchReasons: string[] = [];
            let score = 0;
            
            // 거래처 일치 보너스
            if (vendorSimilarity >= 90) {
              score += 10;
              matchReasons.push('거래처 일치');
            } else if (vendorSimilarity >= 70) {
              score += 5;
              matchReasons.push('거래처 유사');
            }
            
            // 품목명 유사도 점수
            const nameScore = this.calculateNameSimilarity(item.extracted_item_name, purchaseItem.item_name);
            if (nameScore >= 50) {
              score += nameScore * 0.5; // 최대 50점
              if (nameScore >= 80) matchReasons.push('품목명 일치');
              else matchReasons.push('품목명 유사');
            }
            
            // 수량 일치 점수
            if (item.extracted_quantity && purchaseItem.quantity) {
              if (item.extracted_quantity === purchaseItem.quantity) {
                score += 30;
                matchReasons.push('수량 일치');
              }
            }
            
            // 발주번호가 다르면 표시
            const sysPO = purchaseItem.purchase?.purchase_order_number || '';
            const sysSO = purchaseItem.purchase?.sales_order_number || '';
            if (normalizedNumber && sysPO !== normalizedNumber && sysSO !== normalizedNumber) {
              matchReasons.push(`시스템 발주번호: ${sysPO || sysSO}`);
            }
            
            // 점수가 30점 이상이면 후보에 추가
            if (score >= 30) {
              candidateMap.set(key, {
                purchase_id: purchaseItem.purchase?.id,
                purchase_order_number: sysPO,
                sales_order_number: sysSO,
                item_id: purchaseItem.id,
                item_name: purchaseItem.item_name,
                specification: purchaseItem.specification,
                quantity: purchaseItem.quantity,
                unit_price: purchaseItem.unit_price_value,
                vendor_name: purchaseItem.purchase?.vendor?.vendor_name,
                score,
                match_reasons: matchReasons
              });
            }
          }
        }
      }

      // 점수순 정렬
      const candidates = Array.from(candidateMap.values());
      candidates.sort((a, b) => b.score - a.score);

      return candidates.slice(0, 10); // 상위 10개 반환
    } catch (error) {
      console.error('Find match candidates error:', error);
      return [];
    }
  }
  
  /**
   * 품목명 유사도 계산 (0-100)
   */
  private calculateNameSimilarity(name1: string, name2: string): number {
    const s1 = name1.toLowerCase().replace(/\s+/g, '');
    const s2 = name2.toLowerCase().replace(/\s+/g, '');
    
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 100;
    
    // 포함 관계
    if (s1.includes(s2) || s2.includes(s1)) {
      return 80;
    }
    
    // Levenshtein distance 기반 유사도
    const maxLen = Math.max(s1.length, s2.length);
    const distance = this.levenshteinDistance(s1, s2);
    const similarity = ((maxLen - distance) / maxLen) * 100;
    
    return Math.round(similarity);
  }

  /**
   * 거래처명 유사도 계산 (0-100)
   * - (주), 주식회사, ㈜ 등 제거 후 비교
   * - 공백, 특수문자 제거
   * - 영어 ↔ 한글 음역 지원
   */
  private calculateVendorSimilarity(vendor1: string, vendor2: string): number {
    if (!vendor1 || !vendor2) return 0;
    
    // 정규화: 회사 접두어/접미어 제거
    const normalize = (name: string) => {
      return name
        .toLowerCase()
        .replace(/\(주\)|주식회사|㈜|주\)|주|co\.|co,|ltd\.|ltd|inc\.|inc|corp\.|corp|company|컴퍼니/gi, '')
        .replace(/[^a-z0-9가-힣]/g, '') // 특수문자, 공백 제거
        .trim();
    };

    const n1 = normalize(vendor1);
    const n2 = normalize(vendor2);

    if (!n1 || !n2) return 0;
    if (n1 === n2) return 100;

    // 포함 관계
    if (n1.includes(n2) || n2.includes(n1)) {
      return 90;
    }

    // 영어 ↔ 한글 음역 매핑
    const translitMap: Record<string, string[]> = {
      'yg': ['와이지', 'yg'],
      '와이지': ['yg', '와이지'],
      'tech': ['테크', '텍', 'tech'],
      '테크': ['tech', '텍', '테크'],
      '텍': ['tech', '테크', '텍'],
      'high': ['하이', 'high'],
      '하이': ['high', '하이'],
      'korea': ['코리아', '한국', 'korea'],
      '코리아': ['korea', '한국', '코리아'],
      'electric': ['전기', '일렉트릭', 'electric'],
      '전기': ['electric', '일렉트릭', '전기'],
      'steel': ['스틸', '철강', 'steel'],
      '스틸': ['steel', '철강', '스틸'],
      'metal': ['메탈', '금속', 'metal'],
      '메탈': ['metal', '금속', '메탈'],
      'system': ['시스템', 'system'],
      '시스템': ['system', '시스템'],
      'soft': ['소프트', 'soft'],
      '소프트': ['soft', '소프트'],
      'net': ['넷', 'net'],
      '넷': ['net', '넷'],
      'global': ['글로벌', 'global'],
      '글로벌': ['global', '글로벌'],
      'trade': ['트레이드', '무역', 'trade'],
      '트레이드': ['trade', '무역', '트레이드'],
      'international': ['인터내셔널', 'international'],
      '인터내셔널': ['international', '인터내셔널'],
    };

    // 음역 치환 후 비교
    let n1Replaced = n1;
    let n2Replaced = n2;
    
    for (const [key, values] of Object.entries(translitMap)) {
      if (n1.includes(key)) {
        for (const val of values) {
          n1Replaced = n1Replaced.replace(key, val);
          if (n1Replaced === n2 || n2.includes(n1Replaced) || n1Replaced.includes(n2)) {
            return 85;
          }
        }
        n1Replaced = n1; // 리셋
      }
      if (n2.includes(key)) {
        for (const val of values) {
          n2Replaced = n2Replaced.replace(key, val);
          if (n1 === n2Replaced || n1.includes(n2Replaced) || n2Replaced.includes(n1)) {
            return 85;
          }
        }
        n2Replaced = n2; // 리셋
      }
    }

    // Levenshtein 거리 기반 유사도
    const maxLen = Math.max(n1.length, n2.length);
    const distance = this.levenshteinDistance(n1, n2);
    const similarity = ((maxLen - distance) / maxLen) * 100;

    return Math.round(similarity);
  }

  /**
   * 거래처 매칭 여부 확인 (70% 이상이면 동일 거래처로 간주)
   */
  isVendorMatch(vendor1: string, vendor2: string, threshold: number = 70): boolean {
    return this.calculateVendorSimilarity(vendor1, vendor2) >= threshold;
  }
  
  /**
   * Levenshtein 거리 계산
   */
  private levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]) + 1;
        }
      }
    }
    
    return dp[m][n];
  }

  /**
   * 유사도 점수 계산
   */
  private calculateSimilarityScore(
    extractedItem: TransactionStatementItem,
    purchaseItem: any
  ): number {
    let score = 0;

    // 품목명 유사도 (최대 40점)
    if (extractedItem.extracted_item_name && purchaseItem.item_name) {
      const extracted = extractedItem.extracted_item_name.toLowerCase();
      const purchase = purchaseItem.item_name.toLowerCase();
      
      if (extracted === purchase) {
        score += 40;
      } else if (extracted.includes(purchase) || purchase.includes(extracted)) {
        score += 30;
      } else {
        // 단어 매칭
        const extractedWords = extracted.split(/\s+/);
        const purchaseWords = purchase.split(/\s+/);
        const matchedWords = extractedWords.filter((w: string) => 
          purchaseWords.some((pw: string) => pw.includes(w) || w.includes(pw))
        );
        score += Math.min(matchedWords.length * 10, 25);
      }
    }

    // 규격 유사도 (최대 20점)
    if (extractedItem.extracted_specification && purchaseItem.specification) {
      const extracted = extractedItem.extracted_specification.toLowerCase();
      const purchase = purchaseItem.specification.toLowerCase();
      
      if (extracted === purchase) {
        score += 20;
      } else if (extracted.includes(purchase) || purchase.includes(extracted)) {
        score += 15;
      }
    }

    // 수량 근접도 (최대 20점)
    if (extractedItem.extracted_quantity && purchaseItem.quantity) {
      const diff = Math.abs(extractedItem.extracted_quantity - purchaseItem.quantity);
      if (diff === 0) {
        score += 20;
      } else if (diff <= purchaseItem.quantity * 0.1) {
        score += 15;
      } else if (diff <= purchaseItem.quantity * 0.2) {
        score += 10;
      }
    }

    // 단가 근접도 (최대 20점)
    if (extractedItem.extracted_unit_price && purchaseItem.unit_price_value) {
      const diff = Math.abs(extractedItem.extracted_unit_price - purchaseItem.unit_price_value);
      if (diff === 0) {
        score += 20;
      } else if (diff <= purchaseItem.unit_price_value * 0.05) {
        score += 15;
      } else if (diff <= purchaseItem.unit_price_value * 0.1) {
        score += 10;
      }
    }

    return score;
  }

  /**
   * 매칭 이유 생성
   */
  private getMatchReasons(
    extractedItem: TransactionStatementItem,
    purchaseItem: any,
    score: number
  ): string[] {
    const reasons: string[] = [];

    if (extractedItem.extracted_item_name && purchaseItem.item_name) {
      const extracted = extractedItem.extracted_item_name.toLowerCase();
      const purchase = purchaseItem.item_name.toLowerCase();
      
      if (extracted === purchase) {
        reasons.push('품목명 완전 일치');
      } else if (extracted.includes(purchase) || purchase.includes(extracted)) {
        reasons.push('품목명 부분 일치');
      }
    }

    if (extractedItem.extracted_quantity === purchaseItem.quantity) {
      reasons.push('수량 일치');
    }

    if (extractedItem.extracted_unit_price === purchaseItem.unit_price_value) {
      reasons.push('단가 일치');
    }

    if (score >= 70) {
      reasons.push('높은 유사도');
    } else if (score >= 50) {
      reasons.push('보통 유사도');
    }

    return reasons;
  }

  /**
   * 품목 매칭 업데이트
   */
  async updateItemMatch(
    itemId: string,
    matchedPurchaseId: number | null,
    matchedItemId: number | null,
    matchMethod: 'po_number' | 'item_similarity' | 'manual' = 'manual'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase
        .from('transaction_statement_items')
        .update({
          matched_purchase_id: matchedPurchaseId,
          matched_item_id: matchedItemId,
          match_method: matchMethod
        })
        .eq('id', itemId);

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Update item match error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '매칭 업데이트 중 오류가 발생했습니다.'
      };
    }
  }

  /**
   * 거래명세서 확정
   */
  async confirmStatement(
    request: ConfirmStatementRequest,
    confirmerName: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: { user } } = await this.supabase.auth.getUser();

      // 1. 품목별 확정 처리
      for (const item of request.items) {
        // 품목 확정 상태 업데이트
        const { error: itemError } = await this.supabase
          .from('transaction_statement_items')
          .update({
            is_confirmed: true,
            matched_purchase_id: item.matched_purchase_id,
            matched_item_id: item.matched_item_id,
            confirmed_quantity: item.confirmed_quantity,
            confirmed_unit_price: item.confirmed_unit_price,
            confirmed_amount: item.confirmed_amount,
            is_additional_item: item.is_additional_item || false,
            parent_item_id: item.parent_item_id
          })
          .eq('id', item.itemId);

        if (itemError) throw itemError;

        // 2. 발주 품목에 단가/금액 반영
        if (item.matched_item_id && item.confirmed_unit_price !== undefined) {
          const { error: purchaseError } = await this.supabase
            .from('purchase_request_items')
            .update({
              unit_price_value: item.confirmed_unit_price,
              amount_value: item.confirmed_amount
            })
            .eq('id', item.matched_item_id);

          if (purchaseError) {
            console.warn('Failed to update purchase item:', purchaseError);
          }
        }

        // 3. 추가 공정 처리 (새 품목 삽입)
        if (item.is_additional_item && item.matched_purchase_id && !item.matched_item_id) {
          const statementItem = await this.getStatementItem(item.itemId);
          if (statementItem) {
            const { error: insertError } = await this.supabase
              .from('purchase_request_items')
              .insert({
                purchase_request_id: item.matched_purchase_id,
                item_name: statementItem.extracted_item_name || '추가 공정',
                specification: statementItem.extracted_specification,
                quantity: item.confirmed_quantity || statementItem.extracted_quantity || 1,
                unit_price_value: item.confirmed_unit_price || statementItem.extracted_unit_price,
                amount_value: item.confirmed_amount || statementItem.extracted_amount,
                remark: '거래명세서에서 추가됨'
              });

            if (insertError) {
              console.warn('Failed to insert additional item:', insertError);
            }
          }
        }
      }

      // 4. 거래명세서 상태를 confirmed로 변경
      const { error: stmtError } = await this.supabase
        .from('transaction_statements')
        .update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
          confirmed_by: user?.id,
          confirmed_by_name: confirmerName
        })
        .eq('id', request.statementId);

      if (stmtError) throw stmtError;

      return { success: true };
    } catch (error) {
      console.error('Confirm statement error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '확정 중 오류가 발생했습니다.'
      };
    }
  }

  /**
   * 품목 단일 조회
   */
  private async getStatementItem(itemId: string): Promise<TransactionStatementItem | null> {
    const { data } = await this.supabase
      .from('transaction_statement_items')
      .select('*')
      .eq('id', itemId)
      .single();
    
    return data;
  }

  /**
   * 거래명세서 거부
   */
  async rejectStatement(statementId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase
        .from('transaction_statements')
        .update({ status: 'rejected' })
        .eq('id', statementId);

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Reject statement error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '거부 처리 중 오류가 발생했습니다.'
      };
    }
  }

  /**
   * 거래명세서 삭제
   */
  async deleteStatement(statementId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 이미지 URL 조회
      const { data: statement } = await this.supabase
        .from('transaction_statements')
        .select('image_url')
        .eq('id', statementId)
        .single();

      // DB 삭제 (cascade로 품목도 함께 삭제됨)
      const { error } = await this.supabase
        .from('transaction_statements')
        .delete()
        .eq('id', statementId);

      if (error) throw error;

      // Storage 파일 삭제 시도
      if (statement?.image_url) {
        try {
          const path = statement.image_url.split('/receipt-images/')[1];
          if (path) {
            await this.supabase.storage.from('receipt-images').remove([path]);
          }
        } catch (e) {
          console.warn('Failed to delete storage file:', e);
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Delete statement error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '삭제 중 오류가 발생했습니다.'
      };
    }
  }

  /**
   * 세트 매칭 - 거래명세서 전체 품목과 시스템 발주 전체 품목 비교
   * Case 1: 모든 품목이 같은 발주번호일 때 사용
   * 
   * 우선순위:
   * 1. OCR 추출 발주/수주번호로 먼저 검색 (가장 빠름)
   * 2. 해당 발주의 품목들과 세트 비교
   * 3. 매칭률 낮으면 전체 발주 스캔해서 세트 매칭
   */
  async findBestMatchingPurchaseOrderSet(
    extractedItems: TransactionStatementItem[],
    extractedPONumber?: string,
    statementVendorName?: string
  ): Promise<{
    success: boolean;
    data?: {
      bestMatch: {
        purchase_id: number;
        purchase_order_number: string;
        sales_order_number?: string;
        vendor_name?: string;
        matchScore: number;        // 0-100 세트 매칭 점수
        matchedItemCount: number;  // 매칭된 품목 수
        totalItemCount: number;    // 전체 품목 수
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
    };
    error?: string;
  }> {
    try {
      const normalizedNumber = extractedPONumber 
        ? normalizeOrderNumber(extractedPONumber) 
        : '';

      const purchaseScores: Array<{
        purchase_id: number;
        purchase_order_number: string;
        sales_order_number?: string;
        vendor_name?: string;
        matchScore: number;
        matchedItemCount: number;
        totalItemCount: number;
        items: any[];
        itemMatches: Array<{
          ocrItemId: string;
          systemItemId: number;
          systemItemName: string;
          similarity: number;
        }>;
      }> = [];

      // 1. OCR 추출 발주번호로 먼저 검색 (가장 빠름)
      if (normalizedNumber) {
        const { data: byNumber } = await this.supabase
          .from('purchase_requests')
          .select(`
            id, 
            purchase_order_number, 
            sales_order_number,
            vendor:vendors(vendor_name),
            items:purchase_request_items(id, item_name, specification, quantity, unit_price_value)
          `)
          .or(`purchase_order_number.eq.${normalizedNumber},sales_order_number.eq.${normalizedNumber}`)
          .limit(5);

        if (byNumber && byNumber.length > 0) {
          for (const purchase of byNumber) {
            // 거래처 유사도 체크
            const sysVendorName = purchase.vendor?.vendor_name || '';
            const vendorSimilarity = statementVendorName 
              ? this.calculateVendorSimilarity(statementVendorName, sysVendorName)
              : 100;
            
            // 거래처 유사도 70% 미만이면 스킵 (거래처 다르면 후보 제외)
            if (vendorSimilarity < 70) {
              console.log(`❌ 세트 매칭 - 거래처 불일치로 제외: "${statementVendorName}" vs "${sysVendorName}" (${vendorSimilarity}%)`);
              continue;
            }
            
            const setScore = this.calculateSetMatchScore(extractedItems, purchase.items || []);
            purchaseScores.push({
              purchase_id: purchase.id,
              purchase_order_number: purchase.purchase_order_number || '',
              sales_order_number: purchase.sales_order_number,
              vendor_name: sysVendorName,
              matchScore: setScore.score,
              matchedItemCount: setScore.matchedCount,
              totalItemCount: extractedItems.length,
              items: purchase.items || [],
              itemMatches: setScore.itemMatches
            });
          }
        }
      }

      // 2. 번호로 찾은 결과 중 최고 점수 확인
      const bestByNumber = purchaseScores.length > 0 
        ? purchaseScores.reduce((a, b) => a.matchScore > b.matchScore ? a : b)
        : null;

      // 3. 번호 매칭 점수가 80% 이상이면 바로 반환 (확신 있음)
      if (bestByNumber && bestByNumber.matchScore >= 80) {
        return {
          success: true,
          data: {
            bestMatch: {
              ...bestByNumber,
              confidence: 'high'
            },
            candidates: purchaseScores.map(p => ({
              purchase_id: p.purchase_id,
              purchase_order_number: p.purchase_order_number,
              sales_order_number: p.sales_order_number,
              vendor_name: p.vendor_name,
              matchScore: p.matchScore,
              matchedItemCount: p.matchedItemCount
            }))
          }
        };
      }

      // 4. 점수가 낮거나 번호로 못 찾았으면 → 품목명 기반 전체 스캔
      // 최근 3개월 발주 중에서 품목 개수가 비슷한 것들을 검색
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const { data: recentPurchases } = await this.supabase
        .from('purchase_requests')
        .select(`
          id, 
          purchase_order_number, 
          sales_order_number,
          vendor:vendors(vendor_name),
          items:purchase_request_items(id, item_name, specification, quantity, unit_price_value)
        `)
        .gte('created_at', threeMonthsAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(100);

      if (recentPurchases) {
        for (const purchase of recentPurchases) {
          // 이미 번호로 검색한 것은 스킵
          if (purchaseScores.some(p => p.purchase_id === purchase.id)) continue;

          // 거래처 유사도 체크 - 거래처 다르면 후보에서 제외
          const sysVendorName = purchase.vendor?.vendor_name || '';
          const vendorSimilarity = statementVendorName 
            ? this.calculateVendorSimilarity(statementVendorName, sysVendorName)
            : 100;
          
          // 거래처 유사도 70% 미만이면 스킵 (거래처 다르면 후보 제외)
          if (vendorSimilarity < 70) {
            continue;
          }

          const setScore = this.calculateSetMatchScore(extractedItems, purchase.items || []);
          
          // 30점 이상만 후보에 추가
          if (setScore.score >= 30) {
            purchaseScores.push({
              purchase_id: purchase.id,
              purchase_order_number: purchase.purchase_order_number || '',
              sales_order_number: purchase.sales_order_number,
              vendor_name: sysVendorName,
              matchScore: setScore.score,
              matchedItemCount: setScore.matchedCount,
              totalItemCount: extractedItems.length,
              items: purchase.items || [],
              itemMatches: setScore.itemMatches
            });
          }
        }
      }

      // 5. 점수순 정렬
      purchaseScores.sort((a, b) => b.matchScore - a.matchScore);

      const bestMatch = purchaseScores.length > 0 ? purchaseScores[0] : null;

      return {
        success: true,
        data: {
          bestMatch: bestMatch ? {
            ...bestMatch,
            confidence: bestMatch.matchScore >= 80 ? 'high' 
              : bestMatch.matchScore >= 50 ? 'medium' 
              : 'low'
          } : null,
          candidates: purchaseScores.slice(0, 10).map(p => ({
            purchase_id: p.purchase_id,
            purchase_order_number: p.purchase_order_number,
            sales_order_number: p.sales_order_number,
            vendor_name: p.vendor_name,
            matchScore: p.matchScore,
            matchedItemCount: p.matchedItemCount
          }))
        }
      };
    } catch (error) {
      console.error('Find best matching PO set error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '세트 매칭 중 오류가 발생했습니다.'
      };
    }
  }

  /**
   * 세트 매칭 점수 계산
   * 거래명세서 품목들과 시스템 발주 품목들을 1:1 매칭하여 점수 계산
   */
  private calculateSetMatchScore(
    ocrItems: TransactionStatementItem[],
    systemItems: any[]
  ): { 
    score: number; 
    matchedCount: number;
    itemMatches: Array<{
      ocrItemId: string;
      systemItemId: number;
      systemItemName: string;
      similarity: number;
    }>;
  } {
    if (ocrItems.length === 0 || systemItems.length === 0) {
      return { score: 0, matchedCount: 0, itemMatches: [] };
    }

    const itemMatches: Array<{
      ocrItemId: string;
      systemItemId: number;
      systemItemName: string;
      similarity: number;
    }> = [];

    // 각 OCR 품목에 대해 가장 유사한 시스템 품목 찾기
    const usedSystemItems = new Set<number>();
    let totalSimilarity = 0;

    for (const ocrItem of ocrItems) {
      let bestMatch: { id: number; name: string; similarity: number } | null = null;

      for (const sysItem of systemItems) {
        // 이미 매칭된 시스템 품목은 스킵
        if (usedSystemItems.has(sysItem.id)) continue;

        // 품목명 유사도 (최대 60점)
        const nameSimilarity = this.calculateNameSimilarity(
          ocrItem.extracted_item_name || '',
          sysItem.item_name || ''
        );

        // 수량 일치 보너스 (최대 40점)
        let quantityBonus = 0;
        if (ocrItem.extracted_quantity && sysItem.quantity) {
          if (ocrItem.extracted_quantity === sysItem.quantity) {
            quantityBonus = 40;
          } else {
            const diff = Math.abs(ocrItem.extracted_quantity - sysItem.quantity);
            const ratio = diff / Math.max(ocrItem.extracted_quantity, sysItem.quantity);
            if (ratio < 0.1) quantityBonus = 30;
            else if (ratio < 0.2) quantityBonus = 20;
          }
        }

        const totalScore = nameSimilarity * 0.6 + quantityBonus;

        if (!bestMatch || totalScore > bestMatch.similarity) {
          bestMatch = {
            id: sysItem.id,
            name: sysItem.item_name,
            similarity: totalScore
          };
        }
      }

      // 유사도 40점 이상이면 매칭으로 처리
      if (bestMatch && bestMatch.similarity >= 40) {
        usedSystemItems.add(bestMatch.id);
        totalSimilarity += bestMatch.similarity;
        itemMatches.push({
          ocrItemId: ocrItem.id,
          systemItemId: bestMatch.id,
          systemItemName: bestMatch.name,
          similarity: bestMatch.similarity
        });
      }
    }

    // 세트 매칭 점수 계산
    // - 매칭된 품목 비율 (50%)
    // - 평균 유사도 (50%)
    const matchRatio = itemMatches.length / ocrItems.length;
    const avgSimilarity = itemMatches.length > 0 
      ? totalSimilarity / itemMatches.length 
      : 0;
    
    const score = Math.round((matchRatio * 50) + (avgSimilarity * 0.5));

    return {
      score: Math.min(100, score),
      matchedCount: itemMatches.length,
      itemMatches
    };
  }

  /**
   * OCR 교정 데이터 저장
   */
  async saveCorrection(request: SaveCorrectionRequest): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: { user } } = await this.supabase.auth.getUser();
      
      // 교정 데이터 저장
      const { error } = await this.supabase
        .from('ocr_corrections')
        .insert({
          statement_id: request.statement_id,
          statement_item_id: request.statement_item_id,
          original_text: request.original_text,
          corrected_text: request.corrected_text,
          field_type: request.field_type,
          corrected_by: user?.id
        });

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Save correction error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '교정 데이터 저장 중 오류가 발생했습니다.'
      };
    }
  }

  /**
   * 특정 발주에 연결된 거래명세서 목록 조회
   */
  async getStatementsByPurchaseId(purchaseId: number): Promise<{
    success: boolean;
    data?: TransactionStatement[];
    error?: string;
  }> {
    try {
      // 해당 발주에 매칭된 품목이 있는 거래명세서 조회
      const { data: items } = await this.supabase
        .from('transaction_statement_items')
        .select('statement_id')
        .eq('matched_purchase_id', purchaseId);

      if (!items || items.length === 0) {
        return { success: true, data: [] };
      }

      const statementIds = [...new Set(items.map((i: { statement_id: string }) => i.statement_id))];

      const { data: statements, error } = await this.supabase
        .from('transaction_statements')
        .select('*')
        .in('id', statementIds)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;

      return { success: true, data: statements || [] };
    } catch (error) {
      console.error('Get statements by purchase error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '조회 중 오류가 발생했습니다.'
      };
    }
  }
}

export const transactionStatementService = new TransactionStatementService();
export default transactionStatementService;

