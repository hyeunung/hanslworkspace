-- 기존업체 수정 요청(vendor_edit) 문의 유형을 support_inquires.inquiry_type CHECK 제약에 추가

alter table public.support_inquires
  drop constraint support_inquiries_inquiry_type_check;

alter table public.support_inquires
  add constraint support_inquiries_inquiry_type_check
  check (inquiry_type = ANY (ARRAY[
    'bug'::text, 'modify'::text, 'delete'::text, 'other'::text,
    'annual_leave'::text, 'attendance'::text, 'delivery_date_change'::text,
    'quantity_change'::text, 'price_change'::text, 'item_add'::text,
    'new_vendor'::text, 'vendor_edit'::text
  ]));
