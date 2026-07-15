-- RLS가 꺼져 있던 3개 테이블(ocr_digit_confusions, transaction_statement_code_counters,
-- transaction_statement_audit_logs)을 잠근다. 기존에는 anon/authenticated 롤이 REST API로
-- 직접 이 테이블에 쓰기/읽기가 가능했음(테이블 grant는 있으나 RLS 정책이 아예 없었음).
--
-- 방침:
--  1) 앱이 정상적으로 등록/교정/거부 액션을 할 때 내부적으로 이 테이블들에 쓰는 트리거·함수는
--     SECURITY DEFINER로 바꿔서, 테이블을 잠가도 그 경로는 그대로 동작한다.
--  2) 감사 로그(transaction_statement_audit_logs)는 actor_id/actor_name/actor_email을
--     클라이언트가 보낸 값을 그대로 믿지 않고, 서버(auth.uid()/auth.jwt())에서 직접 채우는
--     RPC(log_transaction_statement_audit)를 새로 만들어 클라이언트는 이 RPC만 호출하게 한다.
--  3) 세 테이블 모두 RLS를 켜고 anon/authenticated용 정책은 추가하지 않는다 — SECURITY DEFINER
--     경로(함수 소유자 권한으로 실행)만 통과되고, REST로 테이블에 직접 꽂는 시도는 막힌다.

-- ─────────────────────────────────────────────────────────────
-- 1) ocr_digit_confusions
-- ─────────────────────────────────────────────────────────────
create or replace function update_ocr_digit_confusions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  original_digits text;
  corrected_digits text;
  i int;
  from_char text;
  to_char text;
begin
  if new.field_type not in ('quantity', 'unit_price', 'amount', 'po_number') then
    return new;
  end if;

  original_digits := regexp_replace(coalesce(new.original_text, ''), '\D', '', 'g');
  corrected_digits := regexp_replace(coalesce(new.corrected_text, ''), '\D', '', 'g');

  if length(original_digits) = 0 or length(corrected_digits) = 0 then
    return new;
  end if;

  if length(original_digits) != length(corrected_digits) then
    return new;
  end if;

  for i in 1..length(original_digits) loop
    from_char := substr(original_digits, i, 1);
    to_char := substr(corrected_digits, i, 1);
    if from_char <> to_char then
      insert into ocr_digit_confusions(from_digit, to_digit, count, updated_at)
      values (from_char, to_char, 1, now())
      on conflict (from_digit, to_digit)
      do update set count = ocr_digit_confusions.count + 1,
                    updated_at = now();
    end if;
  end loop;

  return new;
end;
$$;

alter table ocr_digit_confusions enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 2) transaction_statement_code_counters
-- ─────────────────────────────────────────────────────────────
create or replace function generate_transaction_statement_code(p_uploaded_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := coalesce(p_uploaded_at, now())::date;
  v_seq integer;
begin
  insert into transaction_statement_code_counters (code_date, last_seq, updated_at)
  values (v_date, 1, now())
  on conflict (code_date)
  do update
    set last_seq = transaction_statement_code_counters.last_seq + 1,
        updated_at = now()
  returning last_seq into v_seq;

  return 'TS-' || to_char(v_date, 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');
end;
$$;

-- 트리거 래퍼도 SECURITY DEFINER로 — 안쪽에서 generate_transaction_statement_code()를 호출할 때
-- postgres 권한으로 실행되게 해서, 클라이언트 롤의 EXECUTE 권한 여부와 무관하게 항상 동작한다.
create or replace function set_transaction_statement_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.statement_code is null or btrim(new.statement_code) = '' then
    new.statement_code := generate_transaction_statement_code(new.uploaded_at);
  end if;
  return new;
end;
$$;

alter table transaction_statement_code_counters enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 3) transaction_statement_audit_logs
-- ─────────────────────────────────────────────────────────────

-- DB 안전망 트리거(상태 변경 자동 캡처)도 SECURITY DEFINER로 — actor 정보는 없는 행이라
-- 위조 우려는 없고, 테이블 잠금 후에도 정상 동작하도록만 바꾼다.
create or replace function log_transaction_statement_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_log_exists boolean;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  select exists(
    select 1 from transaction_statement_audit_logs
    where statement_id = new.id
      and new_status = new.status
      and created_at > now() - interval '2 seconds'
  ) into recent_log_exists;

  if recent_log_exists then
    return new;
  end if;

  insert into transaction_statement_audit_logs(
    statement_id, action, previous_status, new_status, reason, source
  ) values (
    new.id,
    case new.status
      when 'rejected' then 'rejected'
      when 'confirmed' then 'confirmed'
      when 'extracted' then 'extracted'
      when 'failed' then 'failed'
      when 'queued' then 'queued'
      else 'reset'
    end,
    old.status,
    new.status,
    case when new.status = 'rejected' then new.extraction_error else null end,
    'db_trigger_fallback'
  );

  return new;
end;
$$;

-- 클라이언트가 actor를 자칭해서 넣던 직접 INSERT를 대체하는 RPC.
-- actor_id/actor_name/actor_email은 요청 파라미터가 아니라 서버가 세션에서 직접 채운다.
create or replace function log_transaction_statement_audit(
  p_statement_id uuid,
  p_action text,
  p_previous_status text,
  p_new_status text,
  p_reason text default null,
  p_source text default 'web_reject_button'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_actor_email text := auth.jwt() ->> 'email';
begin
  -- employees.id는 auth 사용자 id와 별개의 자체 PK라 auth.uid()로 조인이 안 됨 — email로 매칭.
  if v_actor_email is not null then
    select name into v_actor_name from employees where email = v_actor_email;
  end if;

  insert into transaction_statement_audit_logs(
    statement_id, action, previous_status, new_status, reason,
    actor_id, actor_name, actor_email, source
  ) values (
    p_statement_id, p_action, p_previous_status, p_new_status, p_reason,
    v_actor_id, v_actor_name, v_actor_email, p_source
  );
end;
$$;

-- 내부 전용 함수/트리거 함수는 REST RPC로 직접 호출될 필요가 없으므로 실행 권한을 회수한다.
-- (트리거가 자동으로 fire되는 것은 함수 EXECUTE 권한과 무관 — 테이블 DML 권한만 있으면 됨)
revoke all on function update_ocr_digit_confusions() from public, anon, authenticated;
revoke all on function generate_transaction_statement_code(timestamptz) from public, anon, authenticated;
revoke all on function set_transaction_statement_code() from public, anon, authenticated;
revoke all on function log_transaction_statement_status_change() from public, anon, authenticated;

-- log_transaction_statement_audit는 거절 버튼이 RPC로 직접 호출해야 하므로 authenticated만 남긴다.
revoke all on function log_transaction_statement_audit(uuid, text, text, text, text, text) from public, anon;
grant execute on function log_transaction_statement_audit(uuid, text, text, text, text, text) to authenticated;

alter table transaction_statement_audit_logs enable row level security;
