-- Add meal-related metadata columns to purchase_receipts
alter table public.purchase_receipts
  add column participants text,
  add column card_last_digits text,
  add column dining_date date,
  add column expense_amount numeric;

