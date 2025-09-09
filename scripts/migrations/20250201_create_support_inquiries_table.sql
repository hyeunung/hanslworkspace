-- support_inquiries 테이블 생성
create table if not exists public.support_inquiries (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid,
  user_email text,
  user_name text,
  inquiry_type text not null check (inquiry_type in ('bug','modify','delete','other')),
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  handled_by text,
  resolution_note text
);

-- 업데이트 트리거
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_support_inquiries_updated_at on public.support_inquiries;
create trigger trg_support_inquiries_updated_at
before update on public.support_inquiries
for each row execute function public.set_updated_at();

-- RLS 설정
alter table public.support_inquiries enable row level security;

-- 인증된 사용자는 생성(insert) 가능
drop policy if exists support_inquiries_insert on public.support_inquiries;
create policy support_inquiries_insert on public.support_inquiries
for insert to authenticated
with check (true);

-- 본인 작성글 조회 허용, 관리자(app_admin) 전체 조회 허용
drop policy if exists support_inquiries_select on public.support_inquiries;
create policy support_inquiries_select on public.support_inquiries
for select using (
  auth.role() = 'authenticated' and (
    user_id = auth.uid() or
    exists (
      select 1 from public.employees e
      where e.id = auth.uid()
        and (
          e.purchase_role ilike '%app_admin%'
        )
    )
  )
);

-- 관리자만 상태 업데이트 가능
drop policy if exists support_inquiries_update on public.support_inquiries;
create policy support_inquiries_update on public.support_inquiries
for update using (
  exists (
    select 1 from public.employees e
    where e.id = auth.uid()
      and e.purchase_role ilike '%app_admin%'
  )
);


