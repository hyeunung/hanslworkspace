/**
 * 거래명세서 확인 시스템 서비스
 * - 이미지 업로드
 * - OCR/LLM 추출 (Edge Function 호출)
 * - 발주 매칭
 * - 확정 및 반영
 * - 학습 데이터 저장
 */

import { createClient } from "@/lib/supabase/client";
import { logger } from "@/lib/logger";
import type {
  TransactionStatement,
  TransactionStatementStatus,
  TransactionStatementItem,
  TransactionStatementWithItems,
  TransactionStatementItemWithMatch,
  MatchCandidate,
  OCRCorrection,
  ConfirmStatementRequest,
  SaveCorrectionRequest
} from "@/types/transactionStatement";
import { normalizeOrderNumber } from "@/types/transactionStatement";
import { dateToISOString } from "@/utils/helpers";

class TransactionStatementService {
  private supabase;

  constructor() {
    this.supabase = createClient();
  }

  private async prepareOcrImage(file: File): Promise<File> {
    if (!file.type.startsWith('image/')) return file;

    const maxDimension = 2200;
    const quality = 0.85;

    try {
      // EXIF 회전 정보를 자동 적용하여 올바른 방향으로 변환
      const bitmap = await createImageBitmap(file);
      const maxDim = Math.max(bitmap.width, bitmap.height);
      const scale = maxDim > maxDimension ? maxDimension / maxDim : 1;
      const targetWidth = Math.round(bitmap.width * scale);
      const targetHeight = Math.round(bitmap.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality)
      );
      if (!blob) return file;

      return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
        type: 'image/jpeg'
      });
    } catch (_) {
      return file;
    }
  }

  /**
   * 거래명세서 이미지 업로드
   */
  async uploadStatement(
    file: File,
    uploaderName: string,
    actualReceiptDate?: Date,
    poScope?: 'single' | 'multi'
  ): Promise<{ success: boolean; data?: { statementId: string; imageUrl: string }; error?: string }> {
    try {
      const uploadFile = await this.prepareOcrImage(file);
      // 고유 파일명 생성
      const ext = uploadFile.name.split('.').pop()?.toLowerCase() || 'png';
      const uuid = crypto.randomUUID();
      const fileName = `${uuid}.${ext}`;
      const storagePath = `Transaction Statement/${fileName}`;

      // Storage에 업로드
      const { data: uploadData, error: uploadError } = await this.supabase
        .storage
        .from('receipt-images')
        .upload(storagePath, uploadFile, {
          contentType: uploadFile.type,
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
      console.log('[Upload] DB 레코드 생성 시도:', { imageUrl, fileName: file.name, userId: user?.id, uploaderName });
      
      const actualReceiptDateIso = actualReceiptDate ? dateToISOString(actualReceiptDate) : null;

      const { data: statement, error: dbError } = await this.supabase
        .from('transaction_statements')
        .insert({
          image_url: imageUrl,
          file_name: file.name,
          uploaded_by: user?.id,
          uploaded_by_name: uploaderName,
          status: 'queued',
          queued_at: new Date().toISOString(),
          po_scope: poScope,
          extracted_data: actualReceiptDateIso
            ? { actual_received_date: actualReceiptDateIso }
            : null
        })
        .select()
        .single();
      

      if (dbError) {
        console.error('[Upload] DB insert 실패:', dbError);
        throw new Error(`DB 저장 실패: ${dbError.message} (code: ${dbError.code})`);
      }
      
      console.log('[Upload] DB 레코드 생성 성공:', { statementId: statement.id });

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
   * 입고수량 업로드 (월말결제용 - 수량만 추출)
   * statement_mode: 'receipt'로 저장, 새 Edge Function 호출
   */
  async uploadReceiptQuantity(
    file: File,
    uploaderName: string,
    actualReceiptDate?: Date,
    poScope?: 'single' | 'multi'
  ): Promise<{ success: boolean; data?: { statementId: string; imageUrl: string }; error?: string }> {
    try {
      const uploadFile = await this.prepareOcrImage(file);
      // 고유 파일명 생성
      const ext = uploadFile.name.split('.').pop()?.toLowerCase() || 'png';
      const uuid = crypto.randomUUID();
      const fileName = `${uuid}.${ext}`;
      const storagePath = `Transaction Statement/${fileName}`;

      // Storage에 업로드
      const { data: uploadData, error: uploadError } = await this.supabase
        .storage
        .from('receipt-images')
        .upload(storagePath, uploadFile, {
          contentType: uploadFile.type,
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

      const actualReceiptDateIso = actualReceiptDate ? dateToISOString(actualReceiptDate) : null;

      // DB에 레코드 생성 (statement_mode: 'receipt')
      const { data: statement, error: dbError } = await this.supabase
        .from('transaction_statements')
        .insert({
          image_url: imageUrl,
          file_name: file.name,
          uploaded_by: user?.id,
          uploaded_by_name: uploaderName,
          status: 'queued',
          queued_at: new Date().toISOString(),
          statement_mode: 'receipt', // 입고수량 모드로 설정
          po_scope: poScope,
          extracted_data: actualReceiptDateIso
            ? { actual_received_date: actualReceiptDateIso }
            : null
        })
        .select()
        .single();

      if (dbError) {
        console.error('[Upload Receipt] DB insert 실패:', dbError);
        throw new Error(`DB 저장 실패: ${dbError.message} (code: ${dbError.code})`);
      }

      // 입고수량 전용 Edge Function 호출 트리거
      this.triggerReceiptQuantityExtraction(statement.id, imageUrl);

      return {
        success: true,
        data: {
          statementId: statement.id,
          imageUrl
        }
      };
    } catch (error) {
      console.error('Upload receipt quantity error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '업로드 중 오류가 발생했습니다.'
      };
    }
  }

  /**
   * 월말결제 거래명세서 업로드 (엑셀/PDF/이미지)
   */
  async uploadMonthlyStatement(
    file: File,
    uploaderName: string,
    actualReceiptDate?: Date,
    poScope?: 'single' | 'multi',
    fileType?: 'excel' | 'pdf' | 'image'
  ): Promise<{ success: boolean; data?: { statementId: string; fileUrl: string }; error?: string }> {
    try {
      // 이미지인 경우 전처리
      const uploadFile = fileType === 'image' ? await this.prepareOcrImage(file) : file;
      
      const ext = uploadFile.name.split('.').pop()?.toLowerCase() || 'bin';
      const uuid = crypto.randomUUID();
      const fileName = `${uuid}.${ext}`;
      const storagePath = `Transaction Statement/${fileName}`;

      const { data: uploadData, error: uploadError } = await this.supabase
        .storage
        .from('receipt-images')
        .upload(storagePath, uploadFile, {
          contentType: uploadFile.type || 'application/octet-stream',
          upsert: false
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: urlData } = this.supabase
        .storage
        .from('receipt-images')
        .getPublicUrl(storagePath);

      const fileUrl = urlData.publicUrl;
      const { data: { user } } = await this.supabase.auth.getUser();

      const actualReceiptDateIso = actualReceiptDate ? dateToISOString(actualReceiptDate) : null;

      const { data: statement, error: dbError } = await this.supabase
        .from('transaction_statements')
        .insert({
          image_url: fileUrl,
          file_name: file.name,
          uploaded_by: user?.id,
          uploaded_by_name: uploaderName,
          status: 'processing',
          processing_started_at: new Date().toISOString(),
          statement_mode: 'monthly',
          po_scope: poScope || null,
          extracted_data: {
            ...(actualReceiptDateIso ? { actual_received_date: actualReceiptDateIso } : {}),
            file_type: fileType || 'excel'
          }
        })
        .select()
        .single();

      if (dbError) {
        console.error('[Upload Monthly] DB insert 실패:', dbError);
        throw new Error(`DB 저장 실패: ${dbError.message} (code: ${dbError.code})`);
      }

      // 월말결제 전용 Edge Function 호출
      this.triggerMonthlyStatementParsing(statement.id, fileUrl, fileType || 'excel');

      return {
        success: true,
        data: {
          statementId: statement.id,
          fileUrl
        }
      };
    } catch (error) {
      console.error('Upload monthly statement error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '업로드 중 오류가 발생했습니다.'
      };
    }
  }

  /**
   * 월말결제 파싱 Edge Function 호출 (비동기)
   */
  private async triggerMonthlyStatementParsing(statementId: string, fileUrl: string, fileType: string) {
    try {
      await this.supabase.functions.invoke('parse-monthly-statement', {
        body: {
          statementId,
          fileUrl,
          fileType
        }
      });
    } catch (error) {
      console.warn('Failed to trigger monthly statement parsing:', error);
    }
  }

  /**
   * 입고수량 추출 Edge Function 호출 (비동기)
   */
  private async triggerReceiptQuantityExtraction(statementId: string, imageUrl: string) {
    try {
      await this.supabase.functions.invoke('ocr-receipt-quantity', {
        body: {
          statementId,
          imageUrl,
          mode: 'process_specific'
        }
      });
    } catch (error) {
      console.warn('Failed to trigger receipt quantity extraction:', error);
    }
  }

  /**
   * OCR/LLM 추출 실행 (Edge Function 호출)
   */
  async extractStatementData(
    statementId: string,
    imageUrl: string,
    resetBeforeExtract: boolean = false
  ): Promise<{ success: boolean; data?: TransactionStatementWithItems; error?: string; queued?: boolean; status?: TransactionStatementStatus }> {
    let invokeContextStatus: number | null = null;
    let invokeContextBody: string | null = null;
    try {
      console.log('[Service] Calling Edge Function with:', { statementId, imageUrl });

      const { data: sessionData } = await this.supabase.auth.getSession();
      const session = sessionData?.session;
      
      // Edge Function 호출
      const { data, error } = await this.supabase.functions.invoke('ocr-transaction-statement', {
        body: {
          statementId,
          imageUrl,
          reset_before_extract: resetBeforeExtract,
          mode: 'process_specific'
        }
      });
      if (error) {
        const context = (error as any)?.context;
        invokeContextStatus = context?.status ?? null;
        try {
          if (context?.clone) {
            const text = await context.clone().text();
            invokeContextBody = text ? text.slice(0, 800) : null;
          } else if (context?.text) {
            const text = await context.text();
            invokeContextBody = text ? text.slice(0, 800) : null;
          }
        } catch (_) {
          invokeContextBody = null;
        }
      }

      console.log('[Service] Edge Function response:', { data, error });

      if (error) throw error;

      if (data?.queued) {
        return { success: true, queued: true, status: 'queued' };
      }

      if (!data?.success) {
        throw new Error(data.error || 'OCR 추출 실패');
      }

      // 거래처명 확인 로그
      console.log('[Service] 거래처 매칭 결과:', { 
        vendor_name: data.vendor_name, 
        vendor_match_source: data.vendor_match_source 
      });

      // 추출된 데이터 조회
      const result = await this.getStatementWithItems(statementId);
      return result;
    } catch (error) {
      console.error('[Service] Extract statement error:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'OCR 추출 중 오류가 발생했습니다.';
      let resolvedErrorMessage = errorMessage;
      if (invokeContextBody) {
        try {
          const parsed = JSON.parse(invokeContextBody);
          resolvedErrorMessage = parsed?.error || invokeContextBody;
        } catch (_) {
          resolvedErrorMessage = invokeContextBody;
        }
      }

      try {
        const { data: updateData, error: updateError } = await this.supabase
          .from('transaction_statements')
          .update({
            status: 'failed',
            extraction_error: resolvedErrorMessage,
            last_error_at: new Date().toISOString(),
            processing_finished_at: new Date().toISOString()
          })
          .eq('id', statementId)
          .in('status', ['pending', 'queued', 'processing'])
          .is('extraction_error', null)
          .select('id, status, extraction_error');
      } catch (_) {
        // ignore update errors
      }
      return {
        success: false,
        error: resolvedErrorMessage
      };
    }
  }

  /**
   * OCR 대기열 처리 트리거
   */
  async kickQueue(): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase.functions.invoke('ocr-transaction-statement', {
        body: { mode: 'process_next' }
      });
      if (error) throw error;
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '큐 처리를 시작하지 못했습니다.'
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
      // items에서 매칭된 purchase_id들도 함께 조회
      let query = this.supabase
        .from('transaction_statements')
        .select(`
          *,
          items:transaction_statement_items(matched_purchase_id)
        `, { count: 'exact' })
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

      // 고유한 purchase_id들 추출
      const allPurchaseIds = new Set<number>();
      (data || []).forEach((statement: any) => {
        statement.items?.forEach((item: any) => {
          if (item.matched_purchase_id) {
            allPurchaseIds.add(item.matched_purchase_id);
          }
        });
      });

      // 발주 정보 조회 (발주번호, 수주번호)
      const purchaseInfoMap = new Map<number, { purchase_order_number: string; sales_order_number?: string }>();
      if (allPurchaseIds.size > 0) {
        const { data: purchases } = await this.supabase
          .from('purchase_requests')
          .select('id, purchase_order_number, sales_order_number')
          .in('id', Array.from(allPurchaseIds));
        
        purchases?.forEach((p: any) => {
          purchaseInfoMap.set(p.id, {
            purchase_order_number: p.purchase_order_number,
            sales_order_number: p.sales_order_number
          });
        });
      }

      // 각 거래명세서에 매칭된 발주 목록 추가
      const statementsWithPurchases = (data || []).map((statement: any) => {
        const purchaseIds = new Set<number>();
        statement.items?.forEach((item: any) => {
          if (item.matched_purchase_id) {
            purchaseIds.add(item.matched_purchase_id);
          }
        });

        const matchedPurchases = Array.from(purchaseIds).map(purchaseId => {
          const info = purchaseInfoMap.get(purchaseId);
          return {
            purchase_id: purchaseId,
            purchase_order_number: info?.purchase_order_number || '',
            sales_order_number: info?.sales_order_number
          };
        });

        const { items, ...rest } = statement;
        return {
          ...rest,
          matched_purchase_id: matchedPurchases[0]?.purchase_id || null, // 호환성 유지
          matched_purchases: matchedPurchases
        };
      });

      return { success: true, data: statementsWithPurchases, count: count || 0 };
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

      // 품목별 매칭 후보 조회 (캐시 활용 - DB에 저장된 후보가 있으면 재사용)
      const statementVendorName = statement.vendor_name || '';
      
      // 매칭된 purchase_id 일괄 조회 (N+1 방지)
      const purchaseIds = [...new Set((items || []).map((i: any) => i.matched_purchase_id).filter(Boolean))];
      const itemIds = [...new Set((items || []).map((i: any) => i.matched_item_id).filter(Boolean))];
      
      const purchaseMap = new Map<number, any>();
      const itemMap = new Map<number, any>();
      
      if (purchaseIds.length > 0) {
        const { data: purchases } = await this.supabase
          .from('purchase_requests')
          .select('id, purchase_order_number, sales_order_number, vendor:vendors(vendor_name)')
          .in('id', purchaseIds);
        (purchases || []).forEach((p: any) => purchaseMap.set(p.id, p));
      }
      
      if (itemIds.length > 0) {
        const { data: purchaseItems } = await this.supabase
          .from('purchase_request_items')
          .select('id, item_name, specification, quantity, unit_price_value, amount_value, received_quantity')
          .in('id', itemIds);
        (purchaseItems || []).forEach((i: any) => itemMap.set(i.id, i));
      }

      const itemsWithMatch: TransactionStatementItemWithMatch[] = await Promise.all(
        (items || []).map(async (item: TransactionStatementItem) => {
          // 캐시된 후보가 있으면 사용, 없으면 계산 후 캐시
          let matchCandidates: MatchCandidate[];
          const cachedCandidates = (item as any).match_candidates_data;
          
          if (cachedCandidates && Array.isArray(cachedCandidates) && cachedCandidates.length > 0) {
            matchCandidates = cachedCandidates;
          } else {
            matchCandidates = await this.findMatchCandidates(item, statementVendorName);
            // 캐시에 저장 (비동기, 에러 무시)
            if (matchCandidates.length > 0) {
              this.supabase
                .from('transaction_statement_items')
                .update({ match_candidates_data: matchCandidates })
                .eq('id', item.id)
                .then(() => {});
            }
          }
          
          // 매칭된 발주/품목 정보 (일괄 조회 결과에서 가져오기)
          let matchedPurchase = undefined;
          let matchedItem = undefined;
          
          if (item.matched_purchase_id) {
            const purchase = purchaseMap.get(item.matched_purchase_id);
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
            const purchaseItem = itemMap.get(item.matched_item_id);
            if (purchaseItem) {
              matchedItem = {
                id: purchaseItem.id,
                item_name: purchaseItem.item_name,
                specification: purchaseItem.specification,
                quantity: purchaseItem.quantity,
                unit_price_value: purchaseItem.unit_price_value,
                amount_value: purchaseItem.amount_value,
                received_quantity: purchaseItem.received_quantity
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
      const rawNumber = item.extracted_po_number || '';
      const normalizedNumber = rawNumber ? normalizeOrderNumber(rawNumber) : '';
      
      // 부분 발주번호 패턴 체크 (F20251212 또는 HS251212 - 뒷부분 없이 날짜만)
      const partialPOMatch = rawNumber.toUpperCase().match(/^(F)(\d{8})$/);
      const partialSOMatch = rawNumber.toUpperCase().match(/^(HS)(\d{6})$/);
      const isPartialNumber = !!(partialPOMatch || partialSOMatch);
      const datePrefix = partialPOMatch ? `F${partialPOMatch[2]}` : (partialSOMatch ? `HS${partialSOMatch[2]}` : '');

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
            if (vendorSimilarity < 50) {
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
              
              // 품목명 OR 규격 유사도 추가 점수
              if (item.extracted_item_name) {
                const itemMatch = this.calculateItemMatchScore(
                  item.extracted_item_name, 
                  purchaseItem.item_name, 
                  purchaseItem.specification
                );
                score += itemMatch.score * 0.3; // 최대 +30점
                if (itemMatch.score >= 80) {
                  matchReasons.push(itemMatch.matchedField === 'specification' ? '규격 일치' : '품목명 일치');
                }
              }
              
              // 수량 비교: 같으면 보너스, 다르면 약간 낮은 점수
              if (item.extracted_quantity && purchaseItem.quantity) {
                if (item.extracted_quantity === purchaseItem.quantity) {
                  score += 15;
                  matchReasons.push(`수량 일치 (${item.extracted_quantity})`);
                } else if (item.extracted_quantity <= purchaseItem.quantity) {
                  score += 5;
                  matchReasons.push(`수량 (요청:${purchaseItem.quantity}, 입고:${item.extracted_quantity})`);
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

      // 1.5. 부분 발주번호로 검색 (F20251212 또는 HS251212 - 뒤 숫자 없이 날짜만 적힌 경우)
      if (isPartialNumber && datePrefix && candidateMap.size === 0) {
        console.log(`📅 부분 발주번호 검색: "${datePrefix}%" (해당 날짜의 모든 발주)`);
        
        const { data: byDatePrefix } = await this.supabase
          .from('purchase_requests')
          .select(`
            id, 
            purchase_order_number, 
            sales_order_number,
            vendor:vendors(vendor_name),
            items:purchase_request_items(id, item_name, specification, quantity, unit_price_value)
          `)
          .or(`purchase_order_number.ilike.${datePrefix}%,sales_order_number.ilike.${datePrefix}%`)
          .limit(20);

        if (byDatePrefix) {
          for (const purchase of byDatePrefix) {
            const sysVendorName = purchase.vendor?.vendor_name || '';
            const vendorSimilarity = statementVendorName 
              ? this.calculateVendorSimilarity(statementVendorName, sysVendorName)
              : 100;
            
            // 거래처 유사도 70% 미만이면 스킵
            if (vendorSimilarity < 50) {
              continue;
            }

            for (const purchaseItem of purchase.items || []) {
              const key = `${purchase.id}-${purchaseItem.id}`;
              if (candidateMap.has(key)) continue;

              const matchReasons = [`날짜 일치 (${datePrefix})`];
              let score = 30; // 날짜 매칭 기본 점수
              
              // 거래처 일치 보너스
              if (vendorSimilarity >= 90) {
                score += 20;
                matchReasons.push('거래처 일치');
              } else if (vendorSimilarity >= 70) {
                score += 10;
                matchReasons.push('거래처 유사');
              }
              
              // 품목명 OR 규격 유사도 추가 점수
              if (item.extracted_item_name) {
                const itemMatch = this.calculateItemMatchScore(
                  item.extracted_item_name, 
                  purchaseItem.item_name, 
                  purchaseItem.specification
                );
                score += itemMatch.score * 0.4; // 최대 +40점
                if (itemMatch.score >= 80) {
                  matchReasons.push(itemMatch.matchedField === 'specification' ? '규격 일치' : '품목명 일치');
                } else if (itemMatch.score >= 50) {
                  matchReasons.push(itemMatch.matchedField === 'specification' ? '규격 유사' : '품목명 유사');
                }
              }
              
              // 수량 비교: 같으면 보너스, 다르면 약간 낮은 점수
              if (item.extracted_quantity && purchaseItem.quantity) {
                if (item.extracted_quantity === purchaseItem.quantity) {
                  score += 15;
                  matchReasons.push(`수량 일치 (${item.extracted_quantity})`);
                } else if (item.extracted_quantity <= purchaseItem.quantity) {
                  score += 5;
                  matchReasons.push(`수량 (요청:${purchaseItem.quantity}, 입고:${item.extracted_quantity})`);
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

      // 2. 품목명+수량으로 매칭 시도 (발주번호가 달라도 찾기) - item_name AND specification 모두 검색
      if (item.extracted_item_name) {
        const itemName = item.extracted_item_name.trim();
        
        // 검색어 후보군 생성 (긴 것부터 시도)
        const searchTermCandidates = [
          itemName,                                              // 전체
          itemName.substring(0, Math.min(itemName.length, 12)),  // 12글자
          itemName.substring(0, Math.min(itemName.length, 8)),   // 8글자
          itemName.split(/\[|]|\s|_|-/)[0]                        // 첫 단어 (특수문자 기준)
        ].filter(t => t && t.length >= 3);
        
        // 중복 제거
        const uniqueSearchTerms = [...new Set(searchTermCandidates)];
        console.log(`🔍 품목명 검색어 후보: ${uniqueSearchTerms.join(', ')}`);
        
        // 각 검색어로 검색 시도 (하나라도 찾으면 됨)
        for (const searchTerm of uniqueSearchTerms) {
          const { data: byNameOrSpec } = await this.supabase
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
            .or(`item_name.ilike.%${searchTerm}%,specification.ilike.%${searchTerm}%`)
            .limit(50);
          
          if (byNameOrSpec && byNameOrSpec.length > 0) {
            console.log(`✅ 검색어 "${searchTerm}"로 ${byNameOrSpec.length}개 품목 발견`);
            
            for (const purchaseItem of byNameOrSpec) {
              const key = `${purchaseItem.purchase?.id}-${purchaseItem.id}`;
              
              // 이미 번호 매칭으로 추가된 경우 스킵
              if (candidateMap.has(key)) continue;
              
              // 거래처 유사도 체크 - 거래처 다르면 후보에서 제외
              const sysVendorName = purchaseItem.purchase?.vendor?.vendor_name || '';
              const vendorSimilarity = statementVendorName 
                ? this.calculateVendorSimilarity(statementVendorName, sysVendorName)
                : 100; // 거래처 정보 없으면 통과
              
              console.log(`🔍 후보 검토: OCR거래처="${statementVendorName}" vs 시스템거래처="${sysVendorName}" → 유사도=${vendorSimilarity}%`);
              
              // 거래처 유사도 50% 미만이면 스킵 (더 관대하게 - 약간의 차이는 허용)
              if (vendorSimilarity < 50) {
                console.log(`❌ 거래처 유사도 ${vendorSimilarity}% < 50% 스킵`);
                continue;
              }
              
              const matchReasons: string[] = [];
              let score = 0;
              
              // 거래처 일치 보너스 (높은 점수)
              if (vendorSimilarity >= 90) {
                score += 20;
                matchReasons.push('거래처 일치');
              } else if (vendorSimilarity >= 70) {
                score += 10;
                matchReasons.push('거래처 유사');
              }
              
              // 품목명 OR 규격 유사도 점수 - 핵심 매칭 기준
              const itemMatch = this.calculateItemMatchScore(
                item.extracted_item_name, 
                purchaseItem.item_name, 
                purchaseItem.specification
              );
              if (itemMatch.score >= 40) { // 40% 이상이면 점수 부여 (더 엄격하게)
                score += itemMatch.score * 0.7; // 최대 70점 (가중치 증가)
                if (itemMatch.score >= 85) {
                  matchReasons.push(itemMatch.matchedField === 'specification' ? '규격 일치' : '품목명 일치');
                } else if (itemMatch.score >= 50) {
                  matchReasons.push(itemMatch.matchedField === 'specification' ? '규격 유사' : '품목명 유사');
                } else {
                  matchReasons.push('품목 부분일치');
                }
              }
              
              // 수량 비교: 같으면 보너스, 다르면 약간 낮은 점수 (완전 제외는 안함)
              if (item.extracted_quantity && purchaseItem.quantity) {
                if (item.extracted_quantity === purchaseItem.quantity) {
                  score += 15; // 수량 일치 보너스
                  matchReasons.push(`수량 일치 (${item.extracted_quantity})`);
                } else if (item.extracted_quantity <= purchaseItem.quantity) {
                  // 배송 수량이 요청보다 적은 경우 - 흔한 케이스이므로 작은 보너스
                  score += 5;
                  matchReasons.push(`수량 (요청:${purchaseItem.quantity}, 입고:${item.extracted_quantity})`);
                }
                // 수량이 요청보다 많으면 점수 0 (이상한 케이스)
              }
              
              // 발주번호가 다르면 표시 + OCR 오류 가능성 표시
              const sysPO = purchaseItem.purchase?.purchase_order_number || '';
              const sysSO = purchaseItem.purchase?.sales_order_number || '';
              if (normalizedNumber && sysPO !== normalizedNumber && sysSO !== normalizedNumber) {
                matchReasons.push(`⚠️ OCR 오류 가능: ${normalizedNumber} → ${sysPO || sysSO}`);
              }
              
              console.log(`📊 점수 계산: score=${score}점, 품목="${purchaseItem.item_name}", 규격="${purchaseItem.specification}", 발주="${purchaseItem.purchase?.purchase_order_number}"`);
              
              // 점수가 15점 이상이면 후보에 추가 (더 관대한 임계값 - 품목명만 유사해도 후보로)
              if (score >= 15) {
                console.log(`✅ 후보 추가! score=${score}점`);
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
            
            // 충분한 후보를 찾았으면 더 이상 검색 안함
            if (candidateMap.size >= 5) break;
          }
        }
      }

      // 3. 품목명 유사도 60% 이상인 고품질 후보가 없으면 거래처의 최근 발주에서 검색 (fallback)
      // 조건: 후보가 아예 없거나, 있더라도 점수가 낮으면(40점 미만) 추가 검색
      const hasHighQualityCandidate = Array.from(candidateMap.values()).some(c => c.score >= 40);
      const needsFallback = candidateMap.size === 0 || !hasHighQualityCandidate;
      
      if (needsFallback && statementVendorName) {
        console.log(`⚠️ 고품질 후보 없음 - 거래처 "${statementVendorName}"의 최근 발주에서 검색 시도 (현재 후보: ${candidateMap.size}개, 최고점: ${Math.max(...Array.from(candidateMap.values()).map(c => c.score), 0)}점)`);
        
        // 거래처명으로 vendor_id 찾기
        const { data: vendors } = await this.supabase
          .from('vendors')
          .select('id, vendor_name')
          .limit(100);

        if (vendors) {
          // 유사도 높은 거래처 찾기
          const matchedVendors = vendors.filter((v: { id: number; vendor_name: string }) => 
            this.calculateVendorSimilarity(statementVendorName, v.vendor_name) >= 70
          );

          if (matchedVendors.length > 0) {
            const vendorIds = matchedVendors.map((v: { id: number; vendor_name: string }) => v.id);
            
            // 해당 거래처의 최근 3개월 발주 조회
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
              .in('vendor_id', vendorIds)
              .gte('created_at', threeMonthsAgo.toISOString())
              .order('created_at', { ascending: false })
              .limit(30);

            if (recentPurchases) {
              for (const purchase of recentPurchases) {
                const sysVendorName = purchase.vendor?.vendor_name || '';
                
                for (const purchaseItem of purchase.items || []) {
                  const key = `${purchase.id}-${purchaseItem.id}`;
                  if (candidateMap.has(key)) continue;

                  const matchReasons: string[] = ['거래처 일치'];
                  let score = 20; // 거래처 일치 기본점
                  
                  // 품목명 OR 규격 유사도
                  if (item.extracted_item_name) {
                    const itemMatch = this.calculateItemMatchScore(
                      item.extracted_item_name, 
                      purchaseItem.item_name, 
                      purchaseItem.specification
                    );
                    if (itemMatch.score >= 40) { // 40% 이상
                      score += itemMatch.score * 0.5;
                      if (itemMatch.score >= 85) {
                        matchReasons.push(itemMatch.matchedField === 'specification' ? '규격 일치' : '품목명 일치');
                      } else if (itemMatch.score >= 50) {
                        matchReasons.push(itemMatch.matchedField === 'specification' ? '규격 유사' : '품목명 유사');
                      }
                    }
                  }
                  
                  // 수량 비교: 같으면 보너스, 다르면 약간 낮은 점수
                  if (item.extracted_quantity && purchaseItem.quantity) {
                    if (item.extracted_quantity === purchaseItem.quantity) {
                      score += 15;
                      matchReasons.push(`수량 일치 (${item.extracted_quantity})`);
                    } else if (item.extracted_quantity <= purchaseItem.quantity) {
                      score += 5;
                      matchReasons.push(`수량 (요청:${purchaseItem.quantity}, 입고:${item.extracted_quantity})`);
                    }
                  }
                  
                  // OCR 오류 가능성 표시
                  const sysPO = purchase.purchase_order_number || '';
                  const sysSO = purchase.sales_order_number || '';
                  if (normalizedNumber) {
                    matchReasons.push(`⚠️ OCR 오류 가능: ${normalizedNumber} → ${sysPO || sysSO}`);
                  }
                  
                  // 점수 15점 이상이면 후보에 추가 (더 관대하게)
                  if (score >= 15) {
                    candidateMap.set(key, {
                      purchase_id: purchase.id,
                      purchase_order_number: sysPO,
                      sales_order_number: sysSO,
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
          }
        }
      }

      // 점수순 정렬
      const candidates = Array.from(candidateMap.values());
      candidates.sort((a, b) => b.score - a.score);

      console.log(`🎯 findMatchCandidates 완료: OCR품목="${item.extracted_item_name}" → ${candidates.length}개 후보 발견`);
      if (candidates.length > 0) {
        console.log(`   최고점 후보: "${candidates[0].item_name}" (${candidates[0].purchase_order_number}) score=${candidates[0].score}`);
      }

      return candidates.slice(0, 15); // 상위 15개 반환
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
   * 품목 매칭 점수 계산 (품목명 OR 규격)
   * OCR 추출값을 시스템의 item_name 또는 specification과 비교
   * 둘 중 높은 점수 반환
   */
  private calculateItemMatchScore(
    ocrItemName: string,
    systemItemName: string,
    systemSpecification?: string
  ): { score: number; matchedField: 'item_name' | 'specification' | 'none' } {
    if (!ocrItemName) {
      return { score: 0, matchedField: 'none' };
    }

    // 품목명과 비교
    const itemNameScore = systemItemName 
      ? this.calculateNameSimilarity(ocrItemName, systemItemName) 
      : 0;
    
    // 규격과 비교
    const specScore = systemSpecification 
      ? this.calculateNameSimilarity(ocrItemName, systemSpecification) 
      : 0;

    // 둘 중 높은 점수 반환
    if (itemNameScore >= specScore) {
      return { 
        score: itemNameScore, 
        matchedField: itemNameScore > 0 ? 'item_name' : 'none' 
      };
    } else {
      return { 
        score: specScore, 
        matchedField: specScore > 0 ? 'specification' : 'none' 
      };
    }
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
   * 유사도 점수 계산 - 품목명/규격 교차 비교 지원
   */
  private calculateSimilarityScore(
    extractedItem: TransactionStatementItem,
    purchaseItem: any
  ): number {
    let score = 0;

    // 품목명 유사도 (최대 40점) - item_name과 specification 모두 비교 후 높은 점수 사용
    if (extractedItem.extracted_item_name) {
      const itemMatch = this.calculateItemMatchScore(
        extractedItem.extracted_item_name,
        purchaseItem.item_name || '',
        purchaseItem.specification || ''
      );
      score += itemMatch.score * 0.4; // 최대 40점
    }

    // OCR 추출 규격도 교차 비교 (최대 20점)
    if (extractedItem.extracted_specification) {
      const specMatch = this.calculateItemMatchScore(
        extractedItem.extracted_specification,
        purchaseItem.item_name || '',
        purchaseItem.specification || ''
      );
      score += specMatch.score * 0.2; // 최대 20점
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
   * 매칭 이유 생성 - 품목명/규격 교차 비교 지원
   */
  private getMatchReasons(
    extractedItem: TransactionStatementItem,
    purchaseItem: any,
    score: number
  ): string[] {
    const reasons: string[] = [];

    // 품목명 교차 비교 (item_name과 specification 모두 확인)
    if (extractedItem.extracted_item_name) {
      const itemMatch = this.calculateItemMatchScore(
        extractedItem.extracted_item_name,
        purchaseItem.item_name || '',
        purchaseItem.specification || ''
      );
      
      if (itemMatch.score >= 90) {
        reasons.push(itemMatch.matchedField === 'specification' ? '규격 완전 일치' : '품목명 완전 일치');
      } else if (itemMatch.score >= 70) {
        reasons.push(itemMatch.matchedField === 'specification' ? '규격 높은 유사도' : '품목명 높은 유사도');
      } else if (itemMatch.score >= 50) {
        reasons.push(itemMatch.matchedField === 'specification' ? '규격 부분 일치' : '품목명 부분 일치');
      }
    }

    // 수량 비교 표시
    if (extractedItem.extracted_quantity && purchaseItem.quantity) {
      if (extractedItem.extracted_quantity === purchaseItem.quantity) {
        reasons.push(`수량 일치 (${extractedItem.extracted_quantity})`);
      } else if (extractedItem.extracted_quantity <= purchaseItem.quantity) {
        reasons.push(`수량 (요청:${purchaseItem.quantity}, 입고:${extractedItem.extracted_quantity})`);
      }
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
  ): Promise<{ success: boolean; error?: string; finalized?: boolean; updatedStatement?: TransactionStatement }> {
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

        if (item.matched_item_id && request.accounting_received_date) {
          const { error: accountingError } = await this.supabase
            .from('purchase_request_items')
            .update({
              accounting_received_date: request.accounting_received_date
            })
            .eq('id', item.matched_item_id);

          if (accountingError) {
            logger.warn('Failed to update accounting received date:', accountingError);
          }
        }
      }

      // 2. 확정자(관리자) 확인 기록
      const confirmedAt = new Date().toISOString();
      const { data: updatedStatement, error: stmtError } = await this.supabase
        .from('transaction_statements')
        .update({
          manager_confirmed_at: confirmedAt,
          manager_confirmed_by: user?.id,
          manager_confirmed_by_name: confirmerName || null
        })
        .eq('id', request.statementId)
        .select('*')
        .single();

      if (stmtError) throw stmtError;

      // 3. 두 단계 완료 여부 확인 후 최종 반영
      const finalizeResult = await this.tryFinalizeStatement(request.statementId);
      if (!finalizeResult.success) {
        return { success: false, error: finalizeResult.error };
      }

      return {
        success: true,
        finalized: finalizeResult.finalized,
        updatedStatement: finalizeResult.updatedStatement || updatedStatement
      };
    } catch (error) {
      console.error('Confirm statement error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '확정 중 오류가 발생했습니다.'
      };
    }
  }

  /**
   * 수량일치 확인
   */
  async confirmQuantityMatch(
    request: ConfirmStatementRequest,
    confirmerName: string
  ): Promise<{ success: boolean; error?: string; finalized?: boolean; updatedStatement?: TransactionStatement }> {
    try {
      const { data: { user } } = await this.supabase.auth.getUser();
      const confirmedAt = new Date().toISOString();
      const { data: updatedStatement, error: stmtError } = await this.supabase
        .from('transaction_statements')
        .update({
          quantity_match_confirmed_at: confirmedAt,
          quantity_match_confirmed_by: user?.id,
          quantity_match_confirmed_by_name: confirmerName || null
        })
        .eq('id', request.statementId)
        .select('*')
        .single();

      if (stmtError) throw stmtError;

      // 수량일치 시점에 실입고 정보 즉시 반영
      if (request.actual_received_date) {
        const receiptByName = confirmerName || '알수없음';
        for (const item of request.items) {
          if (!item.matched_item_id || item.confirmed_quantity === undefined || item.confirmed_quantity === null) {
            continue;
          }

          const { data: existingItem } = await this.supabase
            .from('purchase_request_items')
            .select('receipt_history')
            .eq('id', item.matched_item_id)
            .single();

          const existingHistory = Array.isArray(existingItem?.receipt_history)
            ? (existingItem?.receipt_history as Array<{ seq: number; qty: number; date: string; by: string }>)
            : [];
          const nextSeq = existingHistory.length + 1;
          const updatedHistory = [
            ...existingHistory,
            {
              seq: nextSeq,
              qty: item.confirmed_quantity,
              date: request.actual_received_date,
              by: receiptByName
            }
          ];

          const { error: purchaseError } = await this.supabase
            .from('purchase_request_items')
            .update({
              actual_received_date: request.actual_received_date,
              received_quantity: item.confirmed_quantity,
              is_received: true,
              delivery_status: 'received',
              receipt_history: updatedHistory,
              received_at: new Date().toISOString()
            })
            .eq('id', item.matched_item_id);

          if (purchaseError) {
            logger.warn('Failed to update purchase item:', purchaseError);
          }
        }
      }

      const finalizeResult = await this.tryFinalizeStatement(request.statementId);
      if (!finalizeResult.success) {
        return { success: false, error: finalizeResult.error };
      }

      return {
        success: true,
        finalized: finalizeResult.finalized,
        updatedStatement: finalizeResult.updatedStatement || updatedStatement
      };
    } catch (error) {
      logger.error('Confirm quantity match error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '수량일치 확인 중 오류가 발생했습니다.'
      };
    }
  }

  /**
   * 확정/수량일치 모두 완료 시 최종 반영
   */
  private async tryFinalizeStatement(
    statementId: string
  ): Promise<{ success: boolean; finalized: boolean; error?: string; updatedStatement?: TransactionStatement }> {
    try {
      const { data: statement, error: stmtError } = await this.supabase
        .from('transaction_statements')
        .select('*')
        .eq('id', statementId)
        .single();

      if (stmtError) throw stmtError;

      if (statement.status === 'confirmed') {
        return { success: true, finalized: true, updatedStatement: statement };
      }

      const isManagerConfirmed = !!statement.manager_confirmed_at;
      const isQuantityMatched = !!statement.quantity_match_confirmed_at;

      if (!isManagerConfirmed || !isQuantityMatched) {
        return { success: true, finalized: false, updatedStatement: statement };
      }

      const { data: items, error: itemsError } = await this.supabase
        .from('transaction_statement_items')
        .select('*')
        .eq('statement_id', statementId)
        .order('line_number', { ascending: true });

      if (itemsError) throw itemsError;

      const actualReceivedDate = (statement.extracted_data as { actual_received_date?: string } | null)?.actual_received_date;
      const receiptByName = statement.quantity_match_confirmed_by_name
        || statement.manager_confirmed_by_name
        || '알수없음';

      for (const item of items || []) {
        const hasValidUnitPrice = item.confirmed_unit_price !== undefined && item.confirmed_unit_price !== null;
        const hasValidAmount = item.confirmed_amount !== undefined && item.confirmed_amount !== null;

        const updateData: {
          unit_price_value?: number;
          amount_value?: number;
          actual_received_date?: string;
          received_quantity?: number;
          is_received?: boolean;
          delivery_status?: string;
          receipt_history?: Array<{ seq: number; qty: number; date: string; by: string }>;
          received_at?: string;
        } = {};

        if (hasValidUnitPrice) {
          updateData.unit_price_value = item.confirmed_unit_price!;
        }
        if (hasValidAmount) {
          updateData.amount_value = item.confirmed_amount!;
        }

        if (
          actualReceivedDate &&
          item.matched_item_id &&
          item.confirmed_quantity !== undefined &&
          item.confirmed_quantity !== null
        ) {
          const { data: existingItem } = await this.supabase
            .from('purchase_request_items')
            .select('receipt_history')
            .eq('id', item.matched_item_id)
            .single();

          const existingHistory = Array.isArray(existingItem?.receipt_history)
            ? (existingItem?.receipt_history as Array<{ seq: number; qty: number; date: string; by: string }>)
            : [];
          const nextSeq = existingHistory.length + 1;
          const updatedHistory = [
            ...existingHistory,
            {
              seq: nextSeq,
              qty: item.confirmed_quantity,
              date: actualReceivedDate,
              by: receiptByName
            }
          ];

          updateData.actual_received_date = actualReceivedDate;
          updateData.received_quantity = item.confirmed_quantity;
          updateData.is_received = true;
          updateData.delivery_status = 'received';
          updateData.receipt_history = updatedHistory;
          updateData.received_at = new Date().toISOString();
        }

        if (item.matched_item_id && Object.keys(updateData).length > 0) {
          const { error: purchaseError } = await this.supabase
            .from('purchase_request_items')
            .update(updateData)
            .eq('id', item.matched_item_id);

          if (purchaseError) {
            logger.warn('Failed to update purchase item:', purchaseError);
          }
        }

        if (item.is_additional_item && item.matched_purchase_id && !item.matched_item_id) {
          const { error: insertError } = await this.supabase
            .from('purchase_request_items')
            .insert({
              purchase_request_id: item.matched_purchase_id,
              item_name: item.extracted_item_name || '추가 공정',
              specification: item.extracted_specification,
              quantity: item.confirmed_quantity || item.extracted_quantity || 1,
              unit_price_value: item.confirmed_unit_price || item.extracted_unit_price,
              amount_value: item.confirmed_amount || item.extracted_amount,
              remark: '거래명세서에서 추가됨'
            });

          if (insertError) {
            logger.warn('Failed to insert additional item:', insertError);
          }
        }
      }

      const confirmedAt = new Date().toISOString();
      const confirmedBy = statement.manager_confirmed_by || statement.quantity_match_confirmed_by || null;
      const confirmedByName = statement.manager_confirmed_by_name || statement.quantity_match_confirmed_by_name || null;

      const { data: finalizedStatement, error: finalizeError } = await this.supabase
        .from('transaction_statements')
        .update({
          status: 'confirmed',
          confirmed_at: confirmedAt,
          confirmed_by: confirmedBy,
          confirmed_by_name: confirmedByName
        })
        .eq('id', statementId)
        .select('*')
        .single();

      if (finalizeError) throw finalizeError;

      return { success: true, finalized: true, updatedStatement: finalizedStatement };
    } catch (error) {
      logger.error('Finalize statement error:', error);
      return {
        success: false,
        finalized: false,
        error: error instanceof Error ? error.message : '확정 처리 중 오류가 발생했습니다.'
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
            if (vendorSimilarity < 50) {
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
          if (vendorSimilarity < 50) {
            continue;
          }

          const setScore = this.calculateSetMatchScore(extractedItems, purchase.items || []);
          
          // 40점 이상만 후보에 추가 (더 엄격하게)
          if (setScore.score >= 40) {
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

        // 품목명 OR 규격 유사도 (핵심 매칭 기준)
        const itemMatch = this.calculateItemMatchScore(
          ocrItem.extracted_item_name || '',
          sysItem.item_name || '',
          sysItem.specification || ''
        );

        // 수량 비교: 같으면 보너스, 다르면 약간 낮은 점수
        let quantityBonus = 0;
        if (ocrItem.extracted_quantity && sysItem.quantity) {
          if (ocrItem.extracted_quantity === sysItem.quantity) {
            quantityBonus = 15; // 수량 일치 보너스
          } else if (ocrItem.extracted_quantity <= sysItem.quantity) {
            quantityBonus = 5; // 배송 수량이 요청보다 적은 경우 작은 보너스
          }
        }
        const totalScore = itemMatch.score + quantityBonus;

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
   * 특정 발주에 연결된 거래명세서 목록 조회 (품목 라인넘버 포함)
   */
  async getStatementsByPurchaseId(purchaseId: number): Promise<{
    success: boolean;
    data?: (TransactionStatement & { linked_line_numbers?: number[] })[];
    error?: string;
  }> {
    try {
      // 해당 발주에 매칭된 품목이 있는 거래명세서 조회 (라인넘버 포함)
      const { data: items } = await this.supabase
        .from('transaction_statement_items')
        .select('statement_id, line_number')
        .eq('matched_purchase_id', purchaseId);

      if (!items || items.length === 0) {
        return { success: true, data: [] };
      }

      // 거래명세서별 라인넘버 그룹핑
      const lineNumbersByStatement = new Map<string, number[]>();
      items.forEach((i: { statement_id: string; line_number: number }) => {
        const existing = lineNumbersByStatement.get(i.statement_id) || [];
        if (i.line_number && !existing.includes(i.line_number)) {
          existing.push(i.line_number);
        }
        lineNumbersByStatement.set(i.statement_id, existing);
      });

      const statementIds = [...lineNumbersByStatement.keys()];

      const { data: statements, error } = await this.supabase
        .from('transaction_statements')
        .select('*')
        .in('id', statementIds)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;

      // 라인넘버 병합
      const result = (statements || []).map((stmt: any) => ({
        ...stmt,
        linked_line_numbers: (lineNumbersByStatement.get(stmt.id) || []).sort((a: number, b: number) => a - b)
      }));

      return { success: true, data: result };
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

