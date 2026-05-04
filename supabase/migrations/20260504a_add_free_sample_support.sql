-- 무상샘플 거래명세서 / 발주 지원
-- transaction_statements / purchase_requests 에 is_free_sample 컬럼 추가
-- 거래명세서 코드(TS-...) 와 발주번호 모두 무상샘플인 경우 _S suffix

alter table transaction_statements
  add column if not exists is_free_sample boolean not null default false;

alter table purchase_requests
  add column if not exists is_free_sample boolean not null default false;

-- 거래명세서 코드 생성 트리거: is_free_sample=true 면 끝에 _S suffix 추가
create or replace function set_transaction_statement_code()
returns trigger
language plpgsql
as $$
begin
  if new.statement_code is null or btrim(new.statement_code) = '' then
    new.statement_code := generate_transaction_statement_code(new.uploaded_at);
    if coalesce(new.is_free_sample, false) then
      new.statement_code := new.statement_code || '_S';
    end if;
  end if;
  return new;
end;
$$;

-- 기존 unique 인덱스는 그대로 유지 (TS-...코드 또는 TS-..._S 코드 모두 유니크)

-- 무상샘플 발주 조회 인덱스 (목록 필터링 용도)
create index if not exists idx_purchase_requests_is_free_sample
  on purchase_requests (is_free_sample)
  where is_free_sample = true;

create index if not exists idx_transaction_statements_is_free_sample
  on transaction_statements (is_free_sample)
  where is_free_sample = true;
