-- 택배 주소록 수정 요청(shipping_edit) 문의를 업체등록/수정 요청과 동일하게
-- lead buyer가 조회/수정/삭제할 수 있도록 CHECK 제약과 RLS 정책 범위를 확장한다.

alter table public.support_inquires
  drop constraint support_inquiries_inquiry_type_check;

alter table public.support_inquires
  add constraint support_inquiries_inquiry_type_check
  check (inquiry_type = ANY (ARRAY[
    'bug'::text, 'modify'::text, 'delete'::text, 'other'::text,
    'annual_leave'::text, 'attendance'::text, 'delivery_date_change'::text,
    'quantity_change'::text, 'price_change'::text, 'item_add'::text,
    'new_vendor'::text, 'vendor_edit'::text, 'shipping_edit'::text
  ]));

drop policy if exists select_new_vendor_lead_buyer on public.support_inquires;
create policy select_new_vendor_lead_buyer
on public.support_inquires
for select
using (
  inquiry_type in ('new_vendor', 'vendor_edit', 'shipping_edit')
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
  inquiry_type in ('new_vendor', 'vendor_edit', 'shipping_edit')
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
  inquiry_type in ('new_vendor', 'vendor_edit', 'shipping_edit')
  and exists (
    select 1 from employees e
    where e.email = auth.email() and 'lead buyer' = any(e.roles)
  )
);
