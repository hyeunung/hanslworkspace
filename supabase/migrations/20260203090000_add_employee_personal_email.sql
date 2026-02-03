-- Add personal email column to employees
alter table public.employees
  add column if not exists personal_email text;

comment on column public.employees.personal_email is '개인 이메일';

