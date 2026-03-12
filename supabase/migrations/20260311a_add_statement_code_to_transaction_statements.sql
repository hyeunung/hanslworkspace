-- 거래명세서 코드 자동 생성
-- 형식: TS-YYYYMMDD-#### (일자별 순번)

alter table transaction_statements
  add column if not exists statement_code text;

create table if not exists transaction_statement_code_counters (
  code_date date primary key,
  last_seq integer not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function generate_transaction_statement_code(p_uploaded_at timestamptz default now())
returns text
language plpgsql
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

create or replace function set_transaction_statement_code()
returns trigger
language plpgsql
as $$
begin
  if new.statement_code is null or btrim(new.statement_code) = '' then
    new.statement_code := generate_transaction_statement_code(new.uploaded_at);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_transaction_statement_code on transaction_statements;
create trigger trg_set_transaction_statement_code
  before insert on transaction_statements
  for each row
  execute function set_transaction_statement_code();

with ranked as (
  select
    id,
    uploaded_at::date as code_date,
    row_number() over (
      partition by uploaded_at::date
      order by uploaded_at asc, id asc
    ) as seq
  from transaction_statements
)
update transaction_statements ts
set statement_code = 'TS-' || to_char(r.code_date, 'YYYYMMDD') || '-' || lpad(r.seq::text, 4, '0')
from ranked r
where ts.id = r.id
  and (ts.statement_code is null or btrim(ts.statement_code) = '');

insert into transaction_statement_code_counters (code_date, last_seq, updated_at)
select
  uploaded_at::date as code_date,
  max(substring(statement_code from '(\d{4})$')::integer) as last_seq,
  now()
from transaction_statements
where statement_code ~ '^TS-[0-9]{8}-[0-9]{4}$'
group by uploaded_at::date
on conflict (code_date)
do update
  set last_seq = greatest(transaction_statement_code_counters.last_seq, excluded.last_seq),
      updated_at = now();

alter table transaction_statements
  alter column statement_code set not null;

create unique index if not exists idx_transaction_statements_statement_code
  on transaction_statements (statement_code);

