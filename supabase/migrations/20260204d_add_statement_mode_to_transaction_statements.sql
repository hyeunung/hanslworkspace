-- 거래명세서 모드 구분 (기본/입고확인)

alter table transaction_statements
  add column if not exists statement_mode text default 'default';

update transaction_statements
  set statement_mode = 'default'
  where statement_mode is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'transaction_statements_statement_mode_check'
  ) then
    alter table transaction_statements
      add constraint transaction_statements_statement_mode_check
      check (statement_mode in ('default', 'receipt'));
  end if;
end $$;

create index if not exists idx_transaction_statements_statement_mode
  on transaction_statements(statement_mode);
