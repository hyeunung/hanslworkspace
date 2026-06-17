-- 1. 통합 시스템 활동 로그 테이블 생성
CREATE TABLE IF NOT EXISTS public.system_activity_logs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  source TEXT NOT NULL CHECK (source IN ('frontend', 'backend', 'database')),
  category TEXT,          -- 예: 'auth', 'cad_drawings', 'purchase_requests', etc.
  action TEXT,            -- 예: 'insert', 'update', 'delete', 'login', 'export'
  actor_id UUID,          -- auth.users 참조 (세션 유저)
  actor_email TEXT,
  actor_name TEXT,
  target_table TEXT,      -- DB 변경시 대상 테이블명
  target_id TEXT,         -- DB 변경시 대상 행의 ID
  message TEXT NOT NULL,
  details JSONB           -- 변경사항 세부내용, 에러 스택, JSON Diff 등
);

-- 인덱스 추가로 검색 성능 최적화
CREATE INDEX IF NOT EXISTS idx_sys_logs_created_at ON public.system_activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sys_logs_level_source ON public.system_activity_logs(level, source);
CREATE INDEX IF NOT EXISTS idx_sys_logs_actor_email ON public.system_activity_logs(actor_email);
CREATE INDEX IF NOT EXISTS idx_sys_logs_target ON public.system_activity_logs(target_table, target_id);

-- 테이블 설명 추가
COMMENT ON TABLE public.system_activity_logs IS '시스템 통합 감사 로그 테이블 (프론트엔드, 백엔드, DB 변경사항 기록)';

-- 2. Row Level Security (RLS) 설정
ALTER TABLE public.system_activity_logs ENABLE ROW LEVEL SECURITY;

-- 2-1. 쓰기 정책: 로그인된 사용자 누구나 로그 저장 가능
DROP POLICY IF EXISTS insert_system_logs ON public.system_activity_logs;
CREATE POLICY insert_system_logs ON public.system_activity_logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- 2-2. 읽기 정책: superadmin 및 hr 역할만 로그 조회 가능
DROP POLICY IF EXISTS select_system_logs ON public.system_activity_logs;
CREATE POLICY select_system_logs ON public.system_activity_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.email = auth.email()
        AND ('superadmin' = ANY(COALESCE(e.roles, ARRAY[]::text[])) OR 'hr' = ANY(COALESCE(e.roles, ARRAY[]::text[])))
    )
  );

-- 3. 공용 DB 변경 캡처 트리거 함수 정의
CREATE OR REPLACE FUNCTION public.fn_log_db_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target_id TEXT;
  v_old_data JSONB := NULL;
  v_new_data JSONB := NULL;
  v_diff JSONB := '{}'::jsonb;
  v_actor_id UUID;
  v_actor_email TEXT;
  v_actor_name TEXT;
  v_message TEXT;
  v_details JSONB;
  v_key TEXT;
  v_val JSONB;
  v_has_id BOOLEAN;
BEGIN
  -- 1) 대상 행 ID 및 데이터 추출
  IF TG_OP = 'DELETE' THEN
    v_old_data := to_jsonb(OLD);
    -- id 컬럼이 있는지 확인하고 ID 세팅
    IF v_old_data ? 'id' THEN
      v_target_id := (v_old_data->>'id');
    ELSE
      v_target_id := 'unknown';
    END IF;
  ELSE
    v_new_data := to_jsonb(NEW);
    IF v_new_data ? 'id' THEN
      v_target_id := (v_new_data->>'id');
    ELSE
      v_target_id := 'unknown';
    END IF;

    IF TG_OP = 'UPDATE' THEN
      v_old_data := to_jsonb(OLD);
    END IF;
  END IF;

  -- 2) 작업자(Who) 정보 추출 (auth 세션에서 조회)
  v_actor_id := auth.uid();
  IF v_actor_id IS NOT NULL THEN
    -- JWT 클레임 등에서 이메일 우선 추출
    v_actor_email := auth.email();
    -- employees 테이블에서 이름 조회
    SELECT name INTO v_actor_name
    FROM public.employees
    WHERE id = v_actor_id::text OR email = v_actor_email;
  ELSE
    -- 외부 API 호출 등으로 세션이 없는 경우
    v_actor_email := 'system_db_trigger';
    v_actor_name := 'System Trigger';
  END IF;

  -- 3) 변경 사항 분석 및 요약 메시지 구성
  IF TG_OP = 'UPDATE' THEN
    -- 변경 필드(Diff) 분석
    FOR v_key, v_val IN SELECT * FROM jsonb_each(v_new_data) LOOP
      IF v_val IS DISTINCT FROM v_old_data->v_key THEN
        -- 빈번한 타임스탬프 업데이트(updated_at 등) 노이즈 제외
        IF v_key NOT IN ('updated_at', 'created_at', 'last_sign_in_at') THEN
          v_diff := jsonb_set(v_diff, ARRAY[v_key], jsonb_build_object('old', v_old_data->v_key, 'new', v_val));
        END IF;
      END IF;
    END LOOP;

    -- 변경된 필드가 없으면 로그 작성을 생략 (노이즈 방지)
    IF v_diff = '{}'::jsonb THEN
      RETURN NEW;
    END IF;

    v_message := format('[%s] 데이터 수정됨 (ID: %s, 변경필드: %s)', TG_TABLE_NAME, v_target_id, (SELECT string_agg(k, ', ') FROM jsonb_object_keys(v_diff) k));
  ELSIF TG_OP = 'INSERT' THEN
    v_message := format('[%s] 데이터 등록됨 (ID: %s)', TG_TABLE_NAME, v_target_id);
  ELSIF TG_OP = 'DELETE' THEN
    v_message := format('[%s] 데이터 삭제됨 (ID: %s)', TG_TABLE_NAME, v_target_id);
  END IF;

  -- 4) details JSONB 페이로드 구성
  v_details := jsonb_build_object(
    'op', TG_OP,
    'table', TG_TABLE_NAME,
    'id', v_target_id
  );

  IF TG_OP = 'UPDATE' THEN
    v_details := jsonb_set(v_details, '{changes}', v_diff);
  ELSIF TG_OP = 'INSERT' THEN
    v_details := jsonb_set(v_details, '{new_data}', v_new_data);
  ELSIF TG_OP = 'DELETE' THEN
    v_details := jsonb_set(v_details, '{old_data}', v_old_data);
  END IF;

  -- 5) 로그 기록 삽입
  INSERT INTO public.system_activity_logs (
    level, source, category, action, actor_id, actor_email, actor_name, target_table, target_id, message, details
  ) VALUES (
    'info',
    'database',
    TG_TABLE_NAME,
    LOWER(TG_OP),
    v_actor_id,
    v_actor_email,
    v_actor_name,
    TG_TABLE_NAME,
    v_target_id,
    v_message,
    v_details
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- 로깅 중 에러가 나더라도 본래 트랜잭션이 실패하지 않도록 보호
    RETURN COALESCE(NEW, OLD);
END;
$$;

-- 4. 핵심 8대 테이블에 감시 트리거 부착
-- 4-1. BOM/좌표 도메인
DROP TRIGGER IF EXISTS trg_log_cad_drawings ON public.cad_drawings;
CREATE TRIGGER trg_log_cad_drawings
  AFTER INSERT OR UPDATE OR DELETE ON public.cad_drawings
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_db_change();

DROP TRIGGER IF EXISTS trg_log_bom_items ON public.bom_items;
CREATE TRIGGER trg_log_bom_items
  AFTER INSERT OR UPDATE OR DELETE ON public.bom_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_db_change();

DROP TRIGGER IF EXISTS trg_log_part_placements ON public.part_placements;
CREATE TRIGGER trg_log_part_placements
  AFTER INSERT OR UPDATE OR DELETE ON public.part_placements
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_db_change();

-- 4-2. 거래명세서 도메인
DROP TRIGGER IF EXISTS trg_log_transaction_statements ON public.transaction_statements;
CREATE TRIGGER trg_log_transaction_statements
  AFTER INSERT OR UPDATE OR DELETE ON public.transaction_statements
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_db_change();

DROP TRIGGER IF EXISTS trg_log_transaction_statement_items ON public.transaction_statement_items;
CREATE TRIGGER trg_log_transaction_statement_items
  AFTER INSERT OR UPDATE OR DELETE ON public.transaction_statement_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_db_change();

-- 4-3. 발주/구매 도메인
DROP TRIGGER IF EXISTS trg_log_purchase_requests ON public.purchase_requests;
CREATE TRIGGER trg_log_purchase_requests
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_db_change();

DROP TRIGGER IF EXISTS trg_log_purchase_request_items ON public.purchase_request_items;
CREATE TRIGGER trg_log_purchase_request_items
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_request_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_db_change();

DROP TRIGGER IF EXISTS trg_log_purchase_receipts ON public.purchase_receipts;
CREATE TRIGGER trg_log_purchase_receipts
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_receipts
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_db_change();
