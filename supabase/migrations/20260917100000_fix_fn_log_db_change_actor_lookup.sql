-- fn_log_db_change: 로그인 사용자 변경이 기록되지 않던 버그 수정
-- 원인: employees.id(uuid) = v_actor_id::text 비교로 42883(uuid = text) 오류가 나고,
--       EXCEPTION WHEN OTHERS가 이를 삼켜 로그 INSERT 자체가 생략됨.
--       → 2026-06-17 트리거 도입 이후 웹(authenticated)에서 한 변경은 단 한 건도 기록되지 않았음.
-- 수정: 이메일 우선 매칭(+uuid 직접 비교), 예외는 WARNING으로 노출하고 최소 정보로 로그 재시도.
CREATE OR REPLACE FUNCTION public.fn_log_db_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
BEGIN
  -- 1) 대상 행 ID 및 데이터 추출
  IF TG_OP = 'DELETE' THEN
    v_old_data := to_jsonb(OLD);
    v_target_id := COALESCE(v_old_data->>'id', 'unknown');
  ELSE
    v_new_data := to_jsonb(NEW);
    v_target_id := COALESCE(v_new_data->>'id', 'unknown');
    IF TG_OP = 'UPDATE' THEN
      v_old_data := to_jsonb(OLD);
    END IF;
  END IF;

  -- 2) 작업자(Who) 정보 추출
  BEGIN
    v_actor_id := auth.uid();
    v_actor_email := auth.email();
  EXCEPTION WHEN OTHERS THEN
    v_actor_id := NULL;
    v_actor_email := NULL;
  END;

  IF v_actor_id IS NOT NULL OR v_actor_email IS NOT NULL THEN
    -- employees.id는 auth.users.id와 다를 수 있으므로 이메일 우선, uuid 직접 비교는 보조
    SELECT e.name INTO v_actor_name
    FROM public.employees e
    WHERE (v_actor_email IS NOT NULL AND lower(e.email) = lower(v_actor_email))
       OR (v_actor_id IS NOT NULL AND e.id = v_actor_id)
    ORDER BY (lower(e.email) = lower(v_actor_email)) DESC NULLS LAST
    LIMIT 1;
    IF v_actor_name IS NULL THEN
      v_actor_name := COALESCE(v_actor_email, v_actor_id::text);
    END IF;
  ELSE
    v_actor_email := 'system_db_trigger';
    v_actor_name := 'System Trigger';
  END IF;

  -- 3) 변경 사항 분석 및 요약 메시지 구성
  IF TG_OP = 'UPDATE' THEN
    FOR v_key, v_val IN SELECT * FROM jsonb_each(v_new_data) LOOP
      IF v_val IS DISTINCT FROM v_old_data->v_key THEN
        IF v_key NOT IN ('updated_at', 'created_at', 'last_sign_in_at') THEN
          v_diff := jsonb_set(v_diff, ARRAY[v_key], jsonb_build_object('old', v_old_data->v_key, 'new', v_val));
        END IF;
      END IF;
    END LOOP;

    IF v_diff = '{}'::jsonb THEN
      RETURN NEW;
    END IF;

    v_message := format('[%s] 데이터 수정됨 (ID: %s, 변경필드: %s)', TG_TABLE_NAME, v_target_id,
                        (SELECT string_agg(k, ', ') FROM jsonb_object_keys(v_diff) k));
  ELSIF TG_OP = 'INSERT' THEN
    v_message := format('[%s] 데이터 등록됨 (ID: %s)', TG_TABLE_NAME, v_target_id);
  ELSIF TG_OP = 'DELETE' THEN
    v_message := format('[%s] 데이터 삭제됨 (ID: %s)', TG_TABLE_NAME, v_target_id);
  END IF;

  -- 4) details JSONB 페이로드 구성
  v_details := jsonb_build_object('op', TG_OP, 'table', TG_TABLE_NAME, 'id', v_target_id);
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
    'info', 'database', TG_TABLE_NAME, LOWER(TG_OP),
    v_actor_id, v_actor_email, v_actor_name, TG_TABLE_NAME, v_target_id, v_message, v_details
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- 본래 트랜잭션은 보호하되, 조용히 삼키지 않고 WARNING + 최소 정보 로그를 남긴다
    RAISE WARNING 'fn_log_db_change failed on %.% (%): % [%]', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP, SQLERRM, SQLSTATE;
    BEGIN
      INSERT INTO public.system_activity_logs (
        level, source, category, action, actor_id, actor_email, actor_name, target_table, target_id, message, details
      ) VALUES (
        'error', 'database', TG_TABLE_NAME, LOWER(TG_OP),
        v_actor_id, COALESCE(v_actor_email, 'unknown'), COALESCE(v_actor_name, 'unknown'),
        TG_TABLE_NAME, COALESCE(v_target_id, 'unknown'),
        format('[%s] 변경 로그 기록 실패 (ID: %s): %s', TG_TABLE_NAME, COALESCE(v_target_id, 'unknown'), SQLERRM),
        jsonb_build_object('op', TG_OP, 'table', TG_TABLE_NAME, 'id', v_target_id, 'sqlstate', SQLSTATE, 'error', SQLERRM)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_log_db_change fallback insert failed: %', SQLERRM;
    END;
    RETURN COALESCE(NEW, OLD);
END;
$function$;
