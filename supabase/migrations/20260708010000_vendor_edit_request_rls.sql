-- 기존업체 수정 요청(vendor_edit) 문의도 lead buyer가 업체등록 요청과 동일하게
-- 조회/수정/삭제할 수 있도록 기존 new_vendor 전용 정책 범위를 확장한다.

drop policy if exists select_new_vendor_lead_buyer on public.support_inquires;
create policy select_new_vendor_lead_buyer
on public.support_inquires
for select
using (
  inquiry_type in ('new_vendor', 'vendor_edit')
  and exists (
    select 1 from employees e
    where e.email = auth.email() and 'lead buyer' = any(e.roles)
  )
);

drop policy if exists update_new_vendor_lead_buyer on public.support_inquires;
create policy update_new_vendor_lead_buyer
on public.support_inquires
for update
using (
  inquiry_type in ('new_vendor', 'vendor_edit')
  and exists (
    select 1 from employees e
    where e.email = auth.email() and 'lead buyer' = any(e.roles)
  )
);

drop policy if exists delete_new_vendor_lead_buyer on public.support_inquires;
create policy delete_new_vendor_lead_buyer
on public.support_inquires
for delete
using (
  inquiry_type in ('new_vendor', 'vendor_edit')
  and exists (
    select 1 from employees e
    where e.email = auth.email() and 'lead buyer' = any(e.roles)
  )
);
