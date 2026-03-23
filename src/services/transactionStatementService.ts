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
  ExtractedData,
  OCRCorrection,
  ConfirmStatementRequest,
  SaveCorrectionRequest
} from "@/types/transactionStatement";
import { normalizeOrderNumber } from "@/types/transactionStatement";
import { dateToISOString } from "@/utils/helpers";

type StatementFileType = 'image' | 'excel' | 'pdf';

/** Supabase row from transaction_statements pre-fetch */
interface StatementPreRow {
  status: string | null;
  locked_by: string | null;
  next_retry_at: string | null;
  processing_started_at: string | null;
  file_name: string | null;
  extracted_data: ExtractedData | Record<string, unknown> | null;
}

/** Supabase query result shape for transaction_statement_items with match_candidates_data */
interface StatementItemRow {
  matched_purchase_id: number | null;
  matched_item_id: number | null;
  extracted_quantity: number | null;
  confirmed_quantity: number | null;
  extracted_amount: number | null;
  match_candidates_data: MatchCandidate[] | null;
}

/** Supabase query result for statement list (statement + nested items) */
interface StatementListRow extends Record<string, unknown> {
  id: string;
  status: string;
  all_quantities_matched?: boolean;
  all_amounts_matched?: boolean;
  grand_total?: number | string | null;
  items?: StatementItemRow[];
}

/** Supabase query result shape for purchase with vendor + items */
interface PurchaseWithItems {
  id: number;
  purchase_order_number: string;
  sales_order_number?: string;
  vendor?: { vendor_name: string } | null;
  items?: PurchaseItemRow[];
}

/** Supabase query result shape for purchase_request_items with parent purchase */
interface PurchaseItemRow {
  id: number;
  line_number?: number;
  item_name: string;
  specification?: string;
  quantity: number;
  received_quantity?: number;
  unit_price_value?: number;
  amount_value?: number;
}

/** Purchase item row with nested purchase info (from item-centric queries) */
interface PurchaseItemWithPurchase extends PurchaseItemRow {
  purchase?: {
    id: number;
    purchase_order_number: string;
    sales_order_number?: string;
    vendor?: { vendor_name: string } | null;
  } | null;
}

/** Supabase query result for purchase lookup (id + order numbers + vendor) */
interface PurchaseLookupRow {
  id: number;
  purchase_order_number: string;
  sales_order_number?: string;
  vendor?: { vendor_name: string } | null;
}

/** Item name search result type */
interface ItemNameSearchResult {
  data: PurchaseItemWithPurchase[] | null;
  searchTerm: string;
}

/** Edge function response shape */
interface EdgeFunctionResponse {
  success?: boolean;
  queued?: boolean;
  error?: string;
  vendor_name?: string;
  vendor_match_source?: string;
  debug_row_counts?: unknown;
  result?: { debug_row_counts?: unknown };
}

/** Edge function error with context */
interface EdgeFunctionError extends Error {
  context?: {
    status?: number;
    clone?: () => { text: () => Promise<string> };
    text?: () => Promise<string>;
  };
}

class TransactionStatementService {
  private supabase;
  private lastKickQueueAt = 0;

  constructor() {
    this.supabase = createClient();
  }

  private detectFileTypeFromTarget(target: string): StatementFileType | null {
    if (!target) return null;
    const normalized = target.toLowerCase();
    if (/\.(xlsx?|xlsm|xlsb)(?:\?|$)/.test(normalized)) return 'excel';
    if (/\.pdf(?:\?|$)/.test(normalized)) return 'pdf';
    if (/\.(png|jpe?g|gif|webp|bmp|tiff?)(?:\?|$)/.test(normalized)) return 'image';
    return null;
  }

  private resolveStatementFileType(
    explicitType: StatementFileType | undefined,
    fileName: string | null,
    imageUrl: string,
    extractedData: ExtractedData | Record<string, unknown> | null
  ): StatementFileType {
    if (explicitType) return explicitType;

    const hintedType = (extractedData as Record<string, unknown> | null)?.file_type;
    if (hintedType === 'excel' || hintedType === 'pdf' || hintedType === 'image') {
      return hintedType;
    }

    const fromFileName = this.detectFileTypeFromTarget(fileName || '');
    if (fromFileName) return fromFileName;

    const fromUrl = this.detectFileTypeFromTarget(imageUrl || '');
    if (fromUrl) return fromUrl;

    return 'image';
  }

  private getExtractorFunctionName(fileType: StatementFileType): 'ocr-transaction-statement' | 'parse-transaction-excel' | 'parse-transaction-pdf' {
    if (fileType === 'excel') return 'parse-transaction-excel';
    if (fileType === 'pdf') return 'parse-transaction-pdf';
    return 'ocr-transaction-statement';
  }

  private isRetryableEdgeInvokeFailure(error: unknown, invokeContextStatus: number | null): boolean {
    if ([502, 503, 504, 522, 524, 546].includes(invokeContextStatus ?? -1)) {
      return true;
    }

    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return (
      message.includes('failed to send a request to the edge function') ||
      message.includes('failed to fetch') ||
      message.includes('networkerror') ||
      message.includes('network request failed')
    );
  }

  private async queueStatementForRetry(statementId: string, resetBeforeExtract: boolean): Promise<void> {
    const queueTimestamp = new Date().toISOString();
    await this.supabase
      .from('transaction_statements')
      .update({
        status: 'queued',
        queued_at: queueTimestamp,
        next_retry_at: new Date(Date.now() + 30_000).toISOString(),
        extraction_error: null,
        locked_by: null,
        processing_started_at: null,
        processing_finished_at: null,
        reset_before_extract: resetBeforeExtract || undefined
      })
      .eq('id', statementId)
      .in('status', ['pending', 'queued', 'processing', 'failed']);
  }


  private async prepareOcrImage(file: File): Promise<File> {
    if (!file.type.startsWith('image/')) return file;

    const maxDimension = 2200;
    const quality = 0.85;

    try {
      // imageOrientation: 'from-image' 로 EXIF 회전을 브라우저가 자동 처리 (JPEG/PNG/WebP 모두 대응)
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
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
    poScope?: 'single' | 'multi',
    fileType: StatementFileType = 'image'
  ): Promise<{ success: boolean; data?: { statementId: string; imageUrl: string; fileType: StatementFileType }; error?: string }> {
    try {
      const uploadFile = fileType === 'image' ? await this.prepareOcrImage(file) : file;
      // 고유 파일명 생성
      const ext = uploadFile.name.split('.').pop()?.toLowerCase() || 'bin';
      const uuid = crypto.randomUUID();
      const fileName = `${uuid}.${ext}`;
      const storagePath = `Transaction Statement/${fileName}`;

      // Storage에 업로드
      const { data: uploadData, error: uploadError } = await this.supabase
        .storage
        .from('receipt-images')
        .upload(storagePath, uploadFile, {
          contentType: uploadFile.type || 'application/octet-stream',
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
      logger.debug('[Upload] DB 레코드 생성 시도:', { imageUrl, fileName: file.name, userId: user?.id, uploaderName });
      
      const actualReceiptDateIso = actualReceiptDate ? dateToISOString(actualReceiptDate) : null;
      const extractedData: Record<string, unknown> = { file_type: fileType };
      if (actualReceiptDateIso) {
        extractedData.actual_received_date = actualReceiptDateIso;
      }

      const { data: statement, error: dbError } = await this.supabase
        .from('transaction_statements')
        .insert({
          image_url: imageUrl,
          file_name: file.name,
          uploaded_by: user?.id,
          uploaded_by_name: uploaderName,
          uploaded_by_email: user?.email,
          status: 'queued',
          queued_at: new Date().toISOString(),
          po_scope: poScope,
          extracted_data: extractedData
        })
        .select()
        .single();
      

      if (dbError) {
        logger.error('[Upload] DB insert 실패:', dbError);
        throw new Error(`DB 저장 실패: ${dbError.message} (code: ${dbError.code})`);
      }
      
      logger.debug('[Upload] DB 레코드 생성 성공:', { statementId: statement.id });

      return {
        success: true,
        data: {
          statementId: statement.id,
          imageUrl,
          fileType
        }
      };
    } catch (error) {
      logger.error('Upload statement error:', error);
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
          uploaded_by_email: user?.email,
          status: 'queued',
          queued_at: new Date().toISOString(),
          statement_mode: 'receipt',
          po_scope: poScope,
          extracted_data: actualReceiptDateIso
            ? { actual_received_date: actualReceiptDateIso }
            : null
        })
        .select()
        .single();

      if (dbError) {
        logger.error('[Upload Receipt] DB insert 실패:', dbError);
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
      logger.error('Upload receipt quantity error:', error);
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
          uploaded_by_email: user?.email,
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
        logger.error('[Upload Monthly] DB insert 실패:', dbError);
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
      logger.error('Upload monthly statement error:', error);
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
      logger.warn('Failed to trigger monthly statement parsing:', { error });
    }
  }

  private async triggerReceiptQuantityExtraction(statementId: string, imageUrl: string) {
    try {
      await this.supabase.functions.invoke('ocr-transaction-statement', {
        body: {
          statementId,
          imageUrl,
          mode: 'process_specific',
          statement_mode: 'receipt'
        }
      });
    } catch (error) {
      logger.warn('Failed to trigger receipt quantity extraction:', { error });
    }
  }

  /**
   * OCR/LLM 추출 실행 (Edge Function 호출)
   */
  async extractStatementData(
    statementId: string,
    imageUrl: string,
    resetBeforeExtract: boolean = false,
    fileType?: StatementFileType
  ): Promise<{ success: boolean; data?: TransactionStatementWithItems; error?: string; queued?: boolean; status?: TransactionStatementStatus }> {
    const requestStartAt = Date.now();
    let invokeContextStatus: number | null = null;
    let invokeContextBody: string | null = null;
    let resolvedFileType: StatementFileType = fileType || 'image';
    try {
      logger.debug('[Service] Calling Edge Function with:', { statementId, imageUrl });

      const { data: sessionData } = await this.supabase.auth.getSession();
      const session = sessionData?.session;
      let preRowStatus: string | null = null;
      let preRowLocked: boolean | null = null;
      let preRowNextRetryAt: string | null = null;
      let preRowProcessingStartedAt: string | null = null;
      let preProcessingCount: number | null = null;
      let preRowFileName: string | null = null;
      let preRowExtractedData: ExtractedData | Record<string, unknown> | null = null;
      try {
        const { data: row } = await this.supabase
          .from('transaction_statements')
          .select('status, locked_by, next_retry_at, processing_started_at, file_name, extracted_data')
          .eq('id', statementId)
          .maybeSingle();
        const preRow = row as StatementPreRow | null;
        preRowStatus = preRow?.status ?? null;
        preRowLocked = Boolean(preRow?.locked_by);
        preRowNextRetryAt = preRow?.next_retry_at ?? null;
        preRowProcessingStartedAt = preRow?.processing_started_at ?? null;
        preRowFileName = preRow?.file_name ?? null;
        preRowExtractedData = preRow?.extracted_data ?? null;

        resolvedFileType = this.resolveStatementFileType(
          fileType,
          preRowFileName,
          imageUrl,
          preRowExtractedData
        );

        const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const { count } = await this.supabase
          .from('transaction_statements')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'processing')
          .not('processing_started_at', 'is', null)
          .gt('processing_started_at', cutoff);
        preProcessingCount = typeof count === 'number' ? count : null;
      } catch (_) {
        // ignore snapshot errors
      }
      const extractorFunctionName = this.getExtractorFunctionName(resolvedFileType);
      const invokeBody = resolvedFileType === 'image'
        ? {
            statementId,
            imageUrl,
            mode: 'process_specific',
            reset_before_extract: resetBeforeExtract
          }
        : {
            statementId,
            fileUrl: imageUrl,
            mode: 'process_specific',
            reset_before_extract: resetBeforeExtract
          };

      // Edge Function 호출 (파일 타입별 분기)
      const { data, error } = await this.supabase.functions.invoke(extractorFunctionName, {
        body: invokeBody
      });
      const edgeData = data as EdgeFunctionResponse | null;
      const edgeRowCounts =
        edgeData?.debug_row_counts ||
        edgeData?.result?.debug_row_counts ||
        null;
      if (error) {
        const context = (error as EdgeFunctionError)?.context;
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

      // 신규 파서 함수가 미배포된 환경에서는 기존 월말 파서로 자동 폴백
      if (
        error &&
        invokeContextStatus === 404 &&
        (resolvedFileType === 'excel' || resolvedFileType === 'pdf')
      ) {
        const { data: fallbackData, error: fallbackError } = await this.supabase.functions.invoke('parse-monthly-statement', {
          body: {
            statementId,
            fileUrl: imageUrl,
            fileType: resolvedFileType
          }
        });

        if (!fallbackError && fallbackData?.success) {
          const fallbackResult = await this.getStatementWithItems(statementId);
          if (fallbackResult.success) {
            return fallbackResult;
          }
        }
      }

      logger.debug('[Service] Edge Function response:', { data, error });

      if (error) throw error;

      if (data?.queued) {
        if (resolvedFileType === 'image') {
          void this.kickQueue().then(() => {
          }).catch(() => {});
        }
        return { success: true, queued: true, status: 'queued' };
      }

      if (!data?.success) {
        throw new Error(data.error || '데이터 추출 실패');
      }

      // 거래처명 확인 로그
      logger.debug('[Service] 거래처 매칭 결과:', {
        vendor_name: data.vendor_name,
        vendor_match_source: data.vendor_match_source
      });

      // 추출된 데이터 조회
      const result = await this.getStatementWithItems(statementId);
      return result;
    } catch (error) {
      logger.error('[Service] Extract statement error:', error);
      // 전송 실패/게이트웨이 오류/워크 리소스 제한은 failed 고정 대신 대기열로 재시도한다.
      const shouldRetryViaQueue =
        resolvedFileType === 'image' &&
        this.isRetryableEdgeInvokeFailure(error, invokeContextStatus);
      if (shouldRetryViaQueue) {
        try {
          await this.queueStatementForRetry(statementId, resetBeforeExtract);
        } catch (_) {}
        void this.kickQueue().catch(() => {});
        return { success: true, queued: true, status: 'queued' as TransactionStatementStatus };
      }

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
        await this.supabase
          .from('transaction_statements')
          .update({
            status: 'failed',
            extraction_error: resolvedErrorMessage,
            last_error_at: new Date().toISOString(),
            processing_finished_at: new Date().toISOString(),
            locked_by: null
          })
          .eq('id', statementId)
          .in('status', ['pending', 'queued', 'processing', 'failed']);
      } catch (_) {}
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
    const now = Date.now();
    const minIntervalMs = 8000;
    if (now - this.lastKickQueueAt < minIntervalMs) {
      return { success: true };
    }

    this.lastKickQueueAt = now;
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
      // items에서 매칭된 purchase_id + 캐시된 매칭후보 데이터도 함께 조회
      let query = this.supabase
        .from('transaction_statements')
        .select(`
          *,
          items:transaction_statement_items(matched_purchase_id,matched_item_id,extracted_quantity,confirmed_quantity,extracted_amount,match_candidates_data)
        `, { count: 'exact' })
        .order('statement_date', { ascending: false, nullsFirst: false })
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
        query = query.or(`statement_code.ilike.%${filters.search}%,vendor_name.ilike.%${filters.search}%,file_name.ilike.%${filters.search}%`);
      }

      if (filters?.limit) {
        query = query.limit(filters.limit);
      }

      if (filters?.offset) {
        query = query.range(filters.offset, filters.offset + (filters.limit || 20) - 1);
      }

      const { data, count, error } = await query;

      if (error) throw error;

      // 고유한 purchase_id들 추출 (items에서)
      const allPurchaseIds = new Set<number>();
      const typedData = (data || []) as StatementListRow[];
      typedData.forEach((statement: StatementListRow) => {
        statement.items?.forEach((item: StatementItemRow) => {
          if (item.matched_purchase_id) {
            allPurchaseIds.add(item.matched_purchase_id);
          }
          const candidates = item.match_candidates_data;
          if (Array.isArray(candidates) && candidates.length > 0) {
            const best = candidates.reduce((a: MatchCandidate, b: MatchCandidate) => ((b.score ?? 0) > (a.score ?? 0) ? b : a), candidates[0]);
            if (best?.purchase_id) allPurchaseIds.add(best.purchase_id);
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
        (purchases as Array<{ id: number; purchase_order_number: string; sales_order_number?: string }> || []).forEach((p) => {
          purchaseInfoMap.set(p.id, {
            purchase_order_number: p.purchase_order_number,
            sales_order_number: p.sales_order_number
          });
        });
      }

      // 각 거래명세서에 매칭된 발주 목록 + 수량 일치 플래그 추가
      const statementsWithPurchases = typedData.map((statement: StatementListRow) => {
        const stmtItems: StatementItemRow[] = statement.items || [];

        // purchase_id 수집 (matchedPurchases용)
        const purchaseIds = new Set<number>();
        stmtItems.forEach((item: StatementItemRow) => {
          if (item.matched_purchase_id) purchaseIds.add(item.matched_purchase_id);
          const candidates = item.match_candidates_data;
          if (Array.isArray(candidates) && candidates.length > 0) {
            const best = candidates.reduce((a: MatchCandidate, b: MatchCandidate) => ((b.score ?? 0) > (a.score ?? 0) ? b : a), candidates[0]);
            if (best?.purchase_id) purchaseIds.add(best.purchase_id);
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

        // 수량 일치: DB에 저장된 값을 우선 사용, 없으면 match_candidates_data 기반 계산
        let all_quantities_matched = statement.all_quantities_matched === true;
        const hasCandidates = stmtItems.some((i: StatementItemRow) => Array.isArray(i.match_candidates_data) && i.match_candidates_data.length > 0);

        if (!all_quantities_matched && stmtItems.length > 0 && (statement.status === 'extracted' || statement.status === 'confirmed')) {
          if (hasCandidates) {
            all_quantities_matched = stmtItems.every((item: StatementItemRow) => {
              const ocrRaw = item.confirmed_quantity ?? item.extracted_quantity;
              if (ocrRaw == null) return false;
              const ocrQty = Number(ocrRaw);
              if (!Number.isFinite(ocrQty)) return false;
              const candidates = item.match_candidates_data;
              if (!Array.isArray(candidates) || candidates.length === 0) return false;

              // 우선순위: 사용자가 선택한 매칭 -> 해당 발주 within best score -> 전체 best score
              let selected: MatchCandidate | null = null;
              if (item.matched_item_id) {
                selected = candidates.find((c: MatchCandidate) => c.item_id === item.matched_item_id) || null;
              }
              if (!selected && item.matched_purchase_id) {
                const inPurchase = candidates.filter((c: MatchCandidate) => c.purchase_id === item.matched_purchase_id);
                if (inPurchase.length > 0) {
                  selected = inPurchase.reduce((a: MatchCandidate, b: MatchCandidate) => ((b.score ?? 0) > (a.score ?? 0) ? b : a), inPurchase[0]);
                }
              }
              if (!selected) {
                selected = candidates.reduce((a: MatchCandidate, b: MatchCandidate) => ((b.score ?? 0) > (a.score ?? 0) ? b : a), candidates[0]);
              }

              const sysQty = Number(selected?.quantity);
              if (!Number.isFinite(sysQty)) return false;
              return sysQty === ocrQty;
            });
          }
        }

        // 금액 일치: DB에 저장된 값을 우선 사용, 없으면 match_candidates_data 기반 계산
        let all_amounts_matched = statement.all_amounts_matched === true;
        if (!all_amounts_matched && stmtItems.length > 0 && (statement.status === 'extracted' || statement.status === 'confirmed')) {
          if (hasCandidates) {
            const ocrGrandTotal = Math.round(Number(statement.grand_total ?? 0));
            if (ocrGrandTotal > 0) {
              let sysTotal = 0;
              let allHaveCandidates = true;
              for (const item of stmtItems) {
                const candidates = item.match_candidates_data;
                if (!Array.isArray(candidates) || candidates.length === 0) {
                  allHaveCandidates = false;
                  break;
                }
                // 동일한 후보 선택 로직
                let selected: MatchCandidate | null = null;
                if (item.matched_item_id) {
                  selected = candidates.find((c: MatchCandidate) => c.item_id === item.matched_item_id) || null;
                }
                if (!selected && item.matched_purchase_id) {
                  const inPurchase = candidates.filter((c: MatchCandidate) => c.purchase_id === item.matched_purchase_id);
                  if (inPurchase.length > 0) {
                    selected = inPurchase.reduce((a: MatchCandidate, b: MatchCandidate) => ((b.score ?? 0) > (a.score ?? 0) ? b : a), inPurchase[0]);
                  }
                }
                if (!selected) {
                  selected = candidates.reduce((a: MatchCandidate, b: MatchCandidate) => ((b.score ?? 0) > (a.score ?? 0) ? b : a), candidates[0]);
                }
                const sysAmount = Number(selected?.amount);
                if (!Number.isFinite(sysAmount)) { allHaveCandidates = false; break; }
                sysTotal += sysAmount;
              }
              if (allHaveCandidates) {
                all_amounts_matched = Math.round(sysTotal) === ocrGrandTotal;
              }
            }
          }
        }

        const { items, ...rest } = statement;
        return {
          ...rest,
          matched_purchase_id: matchedPurchases[0]?.purchase_id || null,
          matched_purchases: matchedPurchases,
          all_quantities_matched,
          all_amounts_matched
        };
      });

      return { success: true, data: statementsWithPurchases as unknown as TransactionStatement[], count: count || 0 };
    } catch (error) {
      logger.error('Get statements error:', error);
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
      const purchaseIds = [...new Set((items || []).map((i: TransactionStatementItem) => i.matched_purchase_id).filter(Boolean))] as number[];
      const itemIds = [...new Set((items || []).map((i: TransactionStatementItem) => i.matched_item_id).filter(Boolean))] as number[];

      const purchaseMap = new Map<number, PurchaseLookupRow>();
      const itemMap = new Map<number, PurchaseItemRow & { received_quantity?: number }>();
      
      if (purchaseIds.length > 0) {
        const { data: purchases } = await this.supabase
          .from('purchase_requests')
          .select('id, purchase_order_number, sales_order_number, vendor:vendors(vendor_name)')
          .in('id', purchaseIds);
        (purchases as PurchaseLookupRow[] || []).forEach((p: PurchaseLookupRow) => purchaseMap.set(p.id, p));
      }
      
      if (itemIds.length > 0) {
        const { data: purchaseItems } = await this.supabase
          .from('purchase_request_items')
          .select('id, line_number, item_name, specification, quantity, unit_price_value, amount_value, received_quantity')
          .in('id', itemIds);
        (purchaseItems as (PurchaseItemRow & { received_quantity?: number })[] || []).forEach((i) => itemMap.set(i.id, i));
      }

      const itemsWithMatch: TransactionStatementItemWithMatch[] = await Promise.all(
        (items || []).map(async (item: TransactionStatementItem) => {
          // 캐시된 후보가 있으면 사용, 없으면 계산 후 캐시
          let matchCandidates: MatchCandidate[];
          const cachedCandidates = (item as TransactionStatementItem & { match_candidates_data?: MatchCandidate[] }).match_candidates_data;

          if (Array.isArray(cachedCandidates) && cachedCandidates.length > 0) {
            matchCandidates = cachedCandidates;
          } else {
            matchCandidates = await this.findMatchCandidates(item, statementVendorName);
            // 캐시에 저장
            if (matchCandidates.length > 0) {
              await this.supabase
                .from('transaction_statement_items')
                .update({ match_candidates_data: matchCandidates })
                .eq('id', item.id);
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
                line_number: purchaseItem.line_number,
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

      // 수량일치 여부 계산: 각 OCR item의 best candidate 수량과 비교하여 DB에 저장
      if (statement.status === 'extracted' || statement.status === 'confirmed') {
        let allMatched = false;
        if (itemsWithMatch.length > 0) {
          allMatched = itemsWithMatch.every(item => {
            const ocrRaw = item.confirmed_quantity ?? item.extracted_quantity;
            if (ocrRaw == null) return false;
            const ocrQty = Number(ocrRaw);
            if (!Number.isFinite(ocrQty)) return false;
            // match_candidates에서 최고 점수 후보의 수량과 비교
            const candidates = item.match_candidates || [];
            if (candidates.length === 0) return false;
            const best = candidates.reduce((a, b) => ((b.score ?? 0) > (a.score ?? 0) ? b : a), candidates[0]);
            const sysQty = Number(best.quantity);
            if (!Number.isFinite(sysQty)) return false;
            return sysQty === ocrQty;
          });
        }
        if (allMatched !== (statement.all_quantities_matched ?? false)) {
          await this.supabase
            .from('transaction_statements')
            .update({ all_quantities_matched: allMatched })
            .eq('id', statementId);
        }

        // 금액일치 여부 계산: OCR 합계 vs 매칭 후보 금액 합산
        let allAmountsMatched = false;
        const ocrGrandTotal = Math.round(Number(statement.grand_total ?? 0));
        if (ocrGrandTotal > 0 && itemsWithMatch.length > 0) {
          let sysTotal = 0;
          let allHaveCandidates = true;
          for (const item of itemsWithMatch) {
            const candidates = item.match_candidates || [];
            if (candidates.length === 0) { allHaveCandidates = false; break; }
            const best = candidates.reduce((a, b) => ((b.score ?? 0) > (a.score ?? 0) ? b : a), candidates[0]);
            const sysAmount = Number(best.amount);
            if (!Number.isFinite(sysAmount)) { allHaveCandidates = false; break; }
            sysTotal += sysAmount;
          }
          if (allHaveCandidates) {
            allAmountsMatched = Math.round(sysTotal) === ocrGrandTotal;
          }
        }
        if (allAmountsMatched !== (statement.all_amounts_matched ?? false)) {
          await this.supabase
            .from('transaction_statements')
            .update({ all_amounts_matched: allAmountsMatched })
            .eq('id', statementId);
        }
      }

      return {
        success: true,
        data: {
          ...statement,
          items: itemsWithMatch
        }
      };
    } catch (error) {
      logger.error('Get statement with items error:', error);
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

      // ===== Phase 1: PO 번호 검색 + 품목명 검색 병렬 실행 =====
      const purchaseSelect = `
        id,
        purchase_order_number,
        sales_order_number,
        vendor:vendors(vendor_name),
        items:purchase_request_items(id, line_number, item_name, specification, quantity, received_quantity, unit_price_value, amount_value)
      `;

      // PO/SO 번호 검색 쿼리
      const poSearchPromise = normalizedNumber
        ? this.supabase
            .from('purchase_requests')
            .select(purchaseSelect)
            .or(`purchase_order_number.eq.${normalizedNumber},sales_order_number.eq.${normalizedNumber}`)
            .limit(10)
        : Promise.resolve({ data: null });

      // 부분 발주번호 검색 쿼리 (날짜만 있는 경우)
      const partialPoPromise = (isPartialNumber && datePrefix)
        ? this.supabase
            .from('purchase_requests')
            .select(purchaseSelect)
            .or(`purchase_order_number.ilike.${datePrefix}%,sales_order_number.ilike.${datePrefix}%`)
            .limit(20)
        : Promise.resolve({ data: null });

      // 품목명 검색 쿼리 (모든 검색어 동시 실행)
      let itemNameSearchResults: ItemNameSearchResult[] = [];
      if (item.extracted_item_name) {
        const itemName = item.extracted_item_name.trim();
        const searchTermCandidates = [
          itemName,
          itemName.substring(0, Math.min(itemName.length, 12)),
          itemName.substring(0, Math.min(itemName.length, 8)),
          itemName.split(/\[|]|\s|_|-/)[0]
        ].filter(t => t && t.length >= 3);
        const uniqueSearchTerms = [...new Set(searchTermCandidates)];

        const itemNamePromises = uniqueSearchTerms.map(searchTerm =>
          this.supabase
            .from('purchase_request_items')
            .select(`
              id, line_number, item_name, specification, quantity, received_quantity, unit_price_value, amount_value,
              purchase:purchase_requests!inner(id, purchase_order_number, sales_order_number, vendor:vendors(vendor_name))
            `)
            .or(`item_name.ilike.%${searchTerm}%,specification.ilike.%${searchTerm}%`)
            .limit(50)
            .then((result: { data: PurchaseItemWithPurchase[] | null }) => ({ data: result.data, searchTerm }))
        );

        // 모든 쿼리 동시 실행
        const [poResult, partialPoResult, ...nameResults] = await Promise.all([
          poSearchPromise,
          partialPoPromise,
          ...itemNamePromises
        ]);

        // 1. PO/SO 번호 결과 처리 (최우선)
        if (poResult.data) {
          this.processPurchaseResults(poResult.data, candidateMap, item, statementVendorName, normalizedNumber, 50, '발주/수주번호 일치', 0.3);
        }

        // 1.5. 부분 발주번호 결과 처리 (PO 매칭 없을 때만)
        if (candidateMap.size === 0 && partialPoResult.data) {
          this.processPurchaseResults(partialPoResult.data, candidateMap, item, statementVendorName, normalizedNumber, 30, `날짜 일치 (${datePrefix})`, 0.4);
        }

        // 2. 품목명 검색 결과 처리
        itemNameSearchResults = nameResults;
      } else {
        // 품목명 없으면 PO 검색만 실행
        const [poResult, partialPoResult] = await Promise.all([poSearchPromise, partialPoPromise]);

        if (poResult.data) {
          this.processPurchaseResults(poResult.data, candidateMap, item, statementVendorName, normalizedNumber, 50, '발주/수주번호 일치', 0.3);
        }
        if (candidateMap.size === 0 && partialPoResult.data) {
          this.processPurchaseResults(partialPoResult.data, candidateMap, item, statementVendorName, normalizedNumber, 30, `날짜 일치 (${datePrefix})`, 0.4);
        }
      }

      // 품목명 검색 결과 순서대로 처리 (중복 제거 및 early exit 유지)
      for (const { data: byNameOrSpec, searchTerm } of itemNameSearchResults) {
        if (byNameOrSpec && byNameOrSpec.length > 0) {
          for (const purchaseItem of byNameOrSpec) {
            const key = `${purchaseItem.purchase?.id}-${purchaseItem.id}`;
            if (candidateMap.has(key)) continue;

            const sysVendorName = purchaseItem.purchase?.vendor?.vendor_name || '';
            const vendorSimilarity = statementVendorName
              ? this.calculateVendorSimilarity(statementVendorName, sysVendorName)
              : 100;

            if (vendorSimilarity < 50) continue;

            const matchReasons: string[] = [];
            let score = 0;

            if (vendorSimilarity >= 90) { score += 20; matchReasons.push('거래처 일치'); }
            else if (vendorSimilarity >= 70) { score += 10; matchReasons.push('거래처 유사'); }

            const itemMatch = this.calculateItemMatchScore(
              item.extracted_item_name!,
              purchaseItem.item_name,
              purchaseItem.specification
            );
            if (itemMatch.score >= 40) {
              score += itemMatch.score * 0.7;
              if (itemMatch.score >= 85) matchReasons.push(itemMatch.matchedField === 'specification' ? '규격 일치' : '품목명 일치');
              else if (itemMatch.score >= 50) matchReasons.push(itemMatch.matchedField === 'specification' ? '규격 유사' : '품목명 유사');
              else matchReasons.push('품목 부분일치');
            }

            if (item.extracted_quantity && purchaseItem.quantity) {
              if (item.extracted_quantity === purchaseItem.quantity) { score += 15; matchReasons.push(`수량 일치 (${item.extracted_quantity})`); }
              else if (item.extracted_quantity <= purchaseItem.quantity) { score += 5; matchReasons.push(`수량 (요청:${purchaseItem.quantity}, 입고:${item.extracted_quantity})`); }
            }

            const sysPO = purchaseItem.purchase?.purchase_order_number || '';
            const sysSO = purchaseItem.purchase?.sales_order_number || '';
            if (normalizedNumber && sysPO !== normalizedNumber && sysSO !== normalizedNumber) {
              matchReasons.push(`⚠️ OCR 오류 가능: ${normalizedNumber} → ${sysPO || sysSO}`);
            }

            if (score >= 15 && purchaseItem.purchase?.id) {
              candidateMap.set(key, {
                purchase_id: purchaseItem.purchase.id,
                purchase_order_number: sysPO,
                sales_order_number: sysSO,
                item_id: purchaseItem.id,
                line_number: purchaseItem.line_number,
                item_name: purchaseItem.item_name,
                specification: purchaseItem.specification,
                quantity: purchaseItem.quantity,
                received_quantity: purchaseItem.received_quantity,
                unit_price: purchaseItem.unit_price_value,
                amount: purchaseItem.amount_value,
                vendor_name: purchaseItem.purchase?.vendor?.vendor_name,
                score,
                match_reasons: matchReasons
              });
            }
          }
          if (candidateMap.size >= 5) break;
        }
      }

      // 3. 품목명 유사도 60% 이상인 고품질 후보가 없으면 거래처의 최근 발주에서 검색 (fallback)
      // 조건: 후보가 아예 없거나, 있더라도 점수가 낮으면(40점 미만) 추가 검색
      const hasHighQualityCandidate = Array.from(candidateMap.values()).some(c => c.score >= 40);
      const needsFallback = candidateMap.size === 0 || !hasHighQualityCandidate;
      
      if (needsFallback && statementVendorName) {
        logger.debug(`⚠️ 고품질 후보 없음 - 거래처 "${statementVendorName}"의 최근 발주에서 검색 시도 (현재 후보: ${candidateMap.size}개, 최고점: ${Math.max(...Array.from(candidateMap.values()).map(c => c.score), 0)}점)`);
        
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
                items:purchase_request_items(id, line_number, item_name, specification, quantity, received_quantity, unit_price_value, amount_value)
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
                      line_number: purchaseItem.line_number,
                      item_name: purchaseItem.item_name,
                      specification: purchaseItem.specification,
                      quantity: purchaseItem.quantity,
                      received_quantity: purchaseItem.received_quantity,
                      unit_price: purchaseItem.unit_price_value,
                      amount: purchaseItem.amount_value,
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

      logger.debug(`🎯 findMatchCandidates 완료: OCR품목="${item.extracted_item_name}" → ${candidates.length}개 후보 발견`);
      if (candidates.length > 0) {
        logger.debug(`   최고점 후보: "${candidates[0].item_name}" (${candidates[0].purchase_order_number}) score=${candidates[0].score}`);
      }

      return candidates.slice(0, 15); // 상위 15개 반환
    } catch (error) {
      logger.error('Find match candidates error:', error);
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
   * 발주 검색 결과를 candidateMap에 처리하는 공통 헬퍼
   */
  private processPurchaseResults(
    purchases: PurchaseWithItems[],
    candidateMap: Map<string, MatchCandidate>,
    item: TransactionStatementItem,
    statementVendorName: string | undefined,
    normalizedNumber: string,
    baseScore: number,
    baseReason: string,
    itemNameWeight: number
  ) {
    for (const purchase of purchases) {
      const sysVendorName = purchase.vendor?.vendor_name || '';
      const vendorSimilarity = statementVendorName
        ? this.calculateVendorSimilarity(statementVendorName, sysVendorName)
        : 100;

      if (vendorSimilarity < 50) continue;

      for (const purchaseItem of purchase.items || []) {
        const key = `${purchase.id}-${purchaseItem.id}`;
        if (candidateMap.has(key)) continue;

        const matchReasons = [baseReason];
        let score = baseScore;

        if (vendorSimilarity >= 90) { score += 10; matchReasons.push('거래처 일치'); }
        else if (vendorSimilarity >= 70) { score += 5; matchReasons.push('거래처 유사'); }

        if (item.extracted_item_name) {
          const itemMatch = this.calculateItemMatchScore(item.extracted_item_name, purchaseItem.item_name, purchaseItem.specification);
          score += itemMatch.score * itemNameWeight;
          if (itemMatch.score >= 80) matchReasons.push(itemMatch.matchedField === 'specification' ? '규격 일치' : '품목명 일치');
          else if (itemMatch.score >= 50) matchReasons.push(itemMatch.matchedField === 'specification' ? '규격 유사' : '품목명 유사');
        }

        if (item.extracted_quantity && purchaseItem.quantity) {
          if (item.extracted_quantity === purchaseItem.quantity) { score += 15; matchReasons.push(`수량 일치 (${item.extracted_quantity})`); }
          else if (item.extracted_quantity <= purchaseItem.quantity) { score += 5; matchReasons.push(`수량 (요청:${purchaseItem.quantity}, 입고:${item.extracted_quantity})`); }
        }

        candidateMap.set(key, {
          purchase_id: purchase.id,
          purchase_order_number: purchase.purchase_order_number || '',
          sales_order_number: purchase.sales_order_number,
          item_id: purchaseItem.id,
          line_number: purchaseItem.line_number,
          item_name: purchaseItem.item_name,
          specification: purchaseItem.specification,
          quantity: purchaseItem.quantity,
          received_quantity: purchaseItem.received_quantity,
          unit_price: purchaseItem.unit_price_value,
          amount: purchaseItem.amount_value,
          vendor_name: sysVendorName,
          score,
          match_reasons: matchReasons
        });
      }
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
    if (!vendor1?.trim() || !vendor2?.trim()) return false;
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
    purchaseItem: PurchaseItemRow
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
    purchaseItem: PurchaseItemRow,
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
      logger.error('Update item match error:', error);
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

      // 1. 품목별 확정 처리 + 단가/금액/회계상입고일 즉시 시스템 반영 (병렬)
      const regularItems = request.items.filter(item => !(item.is_additional_item && item.matched_purchase_id && !item.matched_item_id));
      const additionalItems = request.items.filter(item => item.is_additional_item && item.matched_purchase_id && !item.matched_item_id);

      // 일반 품목: 확정 업데이트 + 발주 품목 반영을 병렬 처리
      const regularResults = await Promise.all(regularItems.map(async (item) => {
        const itemUpdateData: Record<string, unknown> = {
          is_confirmed: true,
          matched_purchase_id: item.matched_purchase_id,
          matched_item_id: item.matched_item_id,
          confirmed_quantity: item.confirmed_quantity,
          confirmed_unit_price: item.confirmed_unit_price,
          confirmed_amount: item.confirmed_amount,
          is_additional_item: item.is_additional_item || false,
          parent_item_id: item.parent_item_id
        };

        const { error: itemError } = await this.supabase
          .from('transaction_statement_items')
          .update(itemUpdateData)
          .eq('id', item.itemId);

        if (itemError) throw itemError;

        // 매칭된 발주 품목이 있으면 단가/금액/회계상입고일 즉시 반영
        if (item.matched_item_id) {
          const updateData: {
            unit_price_value?: number;
            amount_value?: number;
            accounting_received_date?: string;
            is_statement_received?: boolean;
            statement_received_date?: string;
            statement_received_by_name?: string | null;
          } = {};

          if (item.confirmed_unit_price !== undefined && item.confirmed_unit_price !== null) {
            updateData.unit_price_value = item.confirmed_unit_price;
          }
          if (item.confirmed_amount !== undefined && item.confirmed_amount !== null) {
            updateData.amount_value = item.confirmed_amount;
          }
          if (request.accounting_received_date) {
            updateData.accounting_received_date = request.accounting_received_date;
            updateData.is_statement_received = true;
            updateData.statement_received_date = request.accounting_received_date;
            updateData.statement_received_by_name = confirmerName || null;
          }

          if (Object.keys(updateData).length > 0) {
            const { error: purchaseError } = await this.supabase
              .from('purchase_request_items')
              .update(updateData)
              .eq('id', item.matched_item_id);

            if (purchaseError) {
              logger.warn('Failed to update purchase item (unit_price/amount/accounting_date)', { error: purchaseError });
            }
          }
        }
      }));

      // 추가 품목: 순차 처리 (getStatementItem 필요 + 실패 시 조기 반환)
      for (const item of additionalItems) {
        // 확정 상태 업데이트
        const { error: itemError } = await this.supabase
          .from('transaction_statement_items')
          .update({
            is_confirmed: true,
            matched_purchase_id: item.matched_purchase_id,
            matched_item_id: item.matched_item_id,
            confirmed_quantity: item.confirmed_quantity,
            confirmed_unit_price: item.confirmed_unit_price,
            confirmed_amount: item.confirmed_amount,
            is_additional_item: true,
            parent_item_id: item.parent_item_id
          })
          .eq('id', item.itemId);

        if (itemError) throw itemError;

        // 발주 품목으로 신규 등록
        const statementItem = await this.getStatementItem(item.itemId);
        const insertData: {
          purchase_request_id: number;
          item_name: string;
          specification: string | null | undefined;
          quantity: number;
          unit_price_value: number | undefined;
          amount_value: number | undefined;
          accounting_received_date: string | undefined;
          remark: string;
          is_statement_received?: boolean;
          statement_received_date?: string;
          statement_received_by_name?: string | null;
        } = {
          purchase_request_id: item.matched_purchase_id!,
          item_name: statementItem?.extracted_item_name || '추가 공정',
          specification: statementItem?.extracted_specification,
          quantity: item.confirmed_quantity || 1,
          unit_price_value: item.confirmed_unit_price,
          amount_value: item.confirmed_amount,
          accounting_received_date: request.accounting_received_date,
          remark: '거래명세서에서 추가됨'
        };

        if (request.accounting_received_date) {
          insertData.is_statement_received = true;
          insertData.statement_received_date = request.accounting_received_date;
          insertData.statement_received_by_name = confirmerName || null;
        }

        const { error: insertError } = await this.supabase
          .from('purchase_request_items')
          .insert(insertData);

        if (insertError) {
          logger.error('추가 품목 삽입 실패', insertError, {
            itemId: item.itemId,
            purchaseId: item.matched_purchase_id,
            itemName: insertData.item_name
          });
          return {
            success: false,
            error: `추가 품목 "${insertData.item_name}" 등록에 실패했습니다: ${insertError.message}`
          };
        }
      }

      // 2. 확정자(관리자) 확인 기록 + 합계금액 갱신
      const confirmedAt = new Date().toISOString();
      const updateData: Record<string, unknown> = {
        manager_confirmed_at: confirmedAt,
        manager_confirmed_by: user?.id,
        manager_confirmed_by_name: confirmerName || null,
        all_amounts_matched: true
      };
      if (request.confirmed_grand_total !== undefined) {
        updateData.grand_total = request.confirmed_grand_total;
        updateData.total_amount = request.confirmed_grand_total;
      }

      const { data: updatedStatement, error: stmtError } = await this.supabase
        .from('transaction_statements')
        .update(updateData)
        .eq('id', request.statementId)
        .select('*')
        .single();

      if (stmtError) throw stmtError;

      // 3. 두 단계 완료 여부 확인 후 상태 업데이트
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
      logger.error('Confirm statement error:', error);
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
      const qmUpdateData: Record<string, unknown> = {
        quantity_match_confirmed_at: confirmedAt,
        quantity_match_confirmed_by: user?.id,
        quantity_match_confirmed_by_name: confirmerName || null,
        all_quantities_matched: true
      };
      if (request.confirmed_grand_total !== undefined) {
        qmUpdateData.grand_total = request.confirmed_grand_total;
        qmUpdateData.total_amount = request.confirmed_grand_total;
      }
      const { data: updatedStatement, error: stmtError } = await this.supabase
        .from('transaction_statements')
        .update(qmUpdateData)
        .eq('id', request.statementId)
        .select('*')
        .single();

      if (stmtError) throw stmtError;

      // 수량일치 시 각 품목의 매칭 정보도 DB에 저장 (병렬)
      await Promise.all(request.items.map(async (item) => {
        const itemUpdate: Record<string, unknown> = {};
        if (item.matched_purchase_id !== undefined) itemUpdate.matched_purchase_id = item.matched_purchase_id ?? null;
        if (item.matched_item_id !== undefined) itemUpdate.matched_item_id = item.matched_item_id ?? null;
        if (item.confirmed_quantity !== undefined) itemUpdate.confirmed_quantity = item.confirmed_quantity;
        if (Object.keys(itemUpdate).length > 0) {
          await this.supabase
            .from('transaction_statement_items')
            .update(itemUpdate)
            .eq('id', item.itemId);
        }
      }));

      // 수량일치 시점에 실입고 정보 즉시 반영 (병렬)
      if (request.actual_received_date) {
        const receiptByName = confirmerName || '알수없음';
        const updatedPurchaseIds = new Set<number>();

        // 각 품목의 입고 처리를 병렬 실행
        const receiptItems = request.items.filter(
          item => item.matched_item_id && item.confirmed_quantity !== undefined && item.confirmed_quantity !== null
        );

        await Promise.all(receiptItems.map(async (item) => {
          const newReceivedQuantityRaw = Number(item.confirmed_quantity);
          const newReceivedQuantity = Number.isFinite(newReceivedQuantityRaw) ? newReceivedQuantityRaw : 0;
          if (newReceivedQuantity <= 0) {
            return;
          }

          const { data: existingItem } = await this.supabase
            .from('purchase_request_items')
            .select('receipt_history, purchase_request_id, quantity, received_quantity')
            .eq('id', item.matched_item_id!)
            .single();

          if (existingItem?.purchase_request_id) {
            updatedPurchaseIds.add(existingItem.purchase_request_id);
          }

          const requestedQuantityRaw = Number(existingItem?.quantity ?? 0);
          const requestedQuantity = Number.isFinite(requestedQuantityRaw) ? requestedQuantityRaw : 0;
          const totalReceivedQuantity = newReceivedQuantity;
          const isFullyReceived = totalReceivedQuantity >= requestedQuantity;
          const deliveryStatus: 'pending' | 'partial' | 'received' = totalReceivedQuantity === 0
            ? 'pending'
            : (isFullyReceived ? 'received' : 'partial');

          const existingHistory = Array.isArray(existingItem?.receipt_history)
            ? (existingItem?.receipt_history as Array<{ seq: number; qty: number; date: string; by: string }>)
            : [];
          const nextSeq = existingHistory.length + 1;
          const updatedHistory = [
            ...existingHistory,
            {
              seq: nextSeq,
              qty: newReceivedQuantity,
              date: request.actual_received_date!,
              by: receiptByName
            }
          ];

          const { error: purchaseError } = await this.supabase
            .from('purchase_request_items')
            .update({
              actual_received_date: request.actual_received_date,
              received_quantity: totalReceivedQuantity,
              is_received: isFullyReceived,
              delivery_status: deliveryStatus,
              receipt_history: updatedHistory,
              received_at: new Date().toISOString()
            })
            .eq('id', item.matched_item_id!);

          if (purchaseError) {
            logger.warn('Failed to update purchase item', { error: purchaseError });
          }
        }));

        // 품목 입고 후 발주서 헤더(purchase_requests)의 is_received 동기화 (병렬)
        await Promise.all([...updatedPurchaseIds].map(async (purchaseId) => {
          const { data: allItems } = await this.supabase
            .from('purchase_request_items')
            .select('is_received')
            .eq('purchase_request_id', purchaseId);

          const allReceived = allItems && allItems.length > 0 && allItems.every((i: { is_received: boolean | null }) => i.is_received === true);
          if (allReceived) {
            await this.supabase
              .from('purchase_requests')
              .update({
                is_received: true,
                received_at: new Date().toISOString()
              })
              .eq('id', purchaseId);
          }
        }));
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
   * 확정/수량일치 모두 완료 시 상태 칼럼만 업데이트 (시각적 표시용)
   * - 실제 데이터 반영은 각 단계(confirmStatement, confirmQuantityMatch)에서 즉시 처리
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

      const isQuantityMatched = statement.all_quantities_matched === true;
      const isAmountMatched = statement.all_amounts_matched === true;

      // 수량 + 금액 둘 다 일치해야 최종 확정
      if (!isQuantityMatched || !isAmountMatched) {
        return { success: true, finalized: false, updatedStatement: statement };
      }

      // 둘 다 완료 → 상태만 'confirmed'로 업데이트
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
      logger.error('Reject statement error:', error);
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
          logger.warn('Failed to delete storage file:', { error: e });
        }
      }

      return { success: true };
    } catch (error) {
      logger.error('Delete statement error:', error);
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
        items: PurchaseItemRow[];
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
            items:purchase_request_items(id, line_number, item_name, specification, quantity, received_quantity, unit_price_value)
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
              logger.debug(`❌ 세트 매칭 - 거래처 불일치로 제외: "${statementVendorName}" vs "${sysVendorName}" (${vendorSimilarity}%)`);
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
          items:purchase_request_items(id, line_number, item_name, specification, quantity, received_quantity, unit_price_value)
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
      logger.error('Find best matching PO set error:', error);
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
    systemItems: PurchaseItemRow[]
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

      if (request.field_type === 'item_name' && request.statement_id && request.original_text && request.corrected_text) {
        this.saveCharPatterns(request.statement_id, request.original_text, request.corrected_text).catch(() => {});
      }

      return { success: true };
    } catch (error) {
      logger.error('Save correction error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '교정 데이터 저장 중 오류가 발생했습니다.'
      };
    }
  }

  private async saveCharPatterns(statementId: string, original: string, corrected: string): Promise<void> {
    if (original.length !== corrected.length) return;

    const { data: stmt } = await this.supabase
      .from('transaction_statements')
      .select('vendor_name')
      .eq('id', statementId)
      .single();

    const vendorName = stmt?.vendor_name;
    if (!vendorName) return;

    const patterns: Array<{ wrong: string; correct: string }> = [];
    for (let i = 0; i < original.length; i++) {
      if (original[i] !== corrected[i]) {
        patterns.push({ wrong: original[i], correct: corrected[i] });
      }
    }

    if (patterns.length === 0) return;

    const unique = new Map<string, { wrong: string; correct: string }>();
    for (const p of patterns) {
      unique.set(`${p.wrong}→${p.correct}`, p);
    }

    for (const p of unique.values()) {
      const { data: existing } = await this.supabase
        .from('ocr_char_patterns')
        .select('id, occurrence_count')
        .eq('vendor_name', vendorName)
        .eq('wrong_char', p.wrong)
        .eq('correct_char', p.correct)
        .single();

      if (existing) {
        await this.supabase
          .from('ocr_char_patterns')
          .update({
            occurrence_count: (existing.occurrence_count || 1) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      } else {
        await this.supabase
          .from('ocr_char_patterns')
          .insert({
            vendor_name: vendorName,
            wrong_char: p.wrong,
            correct_char: p.correct,
          });
      }
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
      const result = (statements || []).map((stmt: TransactionStatement) => ({
        ...stmt,
        linked_line_numbers: (lineNumbersByStatement.get(stmt.id) || []).sort((a: number, b: number) => a - b)
      }));

      return { success: true, data: result };
    } catch (error) {
      logger.error('Get statements by purchase error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '조회 중 오류가 발생했습니다.'
      };
    }
  }

  /**
   * 부품명 별칭 매핑 저장 (확정 시 수동 매칭한 관계를 학습)
   * OCR 추출 부품명 → 시스템 품목명/규격 매핑을 item_name_aliases에 저장
   */
  async saveItemNameAliases(
    aliases: Array<{
      system_item_name: string;
      system_specification?: string;
      alias_name: string;
    }>
  ): Promise<void> {
    if (aliases.length === 0) return;

    const { data: { user } } = await this.supabase.auth.getUser();

    for (const alias of aliases) {
      const normalizedAlias = alias.alias_name.trim();
      const normalizedSystem = alias.system_item_name.trim();
      const normalizedSpec = alias.system_specification?.trim() || null;

      if (!normalizedAlias || !normalizedSystem) continue;
      if (normalizedAlias === normalizedSystem) continue;

      // 기존 매핑이 있으면 match_count 증가, 없으면 새로 생성
      let query = this.supabase
        .from('item_name_aliases')
        .select('id, match_count')
        .eq('system_item_name', normalizedSystem)
        .eq('alias_name', normalizedAlias);
      
      if (normalizedSpec) {
        query = query.eq('system_specification', normalizedSpec);
      } else {
        query = query.is('system_specification', null);
      }

      const { data: existing } = await query.limit(1);

      if (existing && existing.length > 0) {
        await this.supabase
          .from('item_name_aliases')
          .update({
            match_count: (existing[0].match_count || 1) + 1,
            last_used_at: new Date().toISOString()
          })
          .eq('id', existing[0].id);
      } else {
        await this.supabase
          .from('item_name_aliases')
          .insert({
            system_item_name: normalizedSystem,
            system_specification: normalizedSpec,
            alias_name: normalizedAlias,
            match_count: 1,
            created_by: user?.id,
            last_used_at: new Date().toISOString()
          });
      }
    }
  }

  /**
   * 부품명 별칭으로 시스템 품목 후보 조회
   * OCR 추출된 부품명(파트넘버)으로 과거 매핑된 시스템 품목명/규격을 찾는다
   */
  async findItemNameAliases(
    aliasNames: string[]
  ): Promise<Map<string, Array<{ system_item_name: string; system_specification: string | null; match_count: number }>>> {
    const result = new Map<string, Array<{ system_item_name: string; system_specification: string | null; match_count: number }>>();
    if (aliasNames.length === 0) return result;

    const uniqueNames = [...new Set(aliasNames.map(n => n.trim()).filter(Boolean))];
    if (uniqueNames.length === 0) return result;

    const { data, error } = await this.supabase
      .from('item_name_aliases')
      .select('system_item_name, system_specification, alias_name, match_count')
      .in('alias_name', uniqueNames)
      .order('match_count', { ascending: false });

    if (error || !data) return result;

    for (const row of data) {
      const key = row.alias_name;
      const existing = result.get(key) || [];
      existing.push({
        system_item_name: row.system_item_name,
        system_specification: row.system_specification,
        match_count: row.match_count
      });
      result.set(key, existing);
    }

    return result;
  }
}

export const transactionStatementService = new TransactionStatementService();
export default transactionStatementService;

