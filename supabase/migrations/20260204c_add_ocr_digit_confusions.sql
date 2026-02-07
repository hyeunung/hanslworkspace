-- 손글씨 숫자 오인식 누적 통계 (교정 기반 학습용)

create table if not exists ocr_digit_confusions (
  from_digit text not null,
  to_digit text not null,
  count integer not null default 0,
  updated_at timestamptz default now(),
  primary key (from_digit, to_digit)
);

comment on table ocr_digit_confusions is 'OCR 교정 기반 숫자 오인식 누적 통계';

-- 교정 데이터 삽입 시 숫자 오인식 통계 업데이트
create or replace function update_ocr_digit_confusions()
returns trigger
language plpgsql
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

drop trigger if exists trg_update_ocr_digit_confusions on ocr_corrections;
create trigger trg_update_ocr_digit_confusions
  after insert on ocr_corrections
  for each row
  execute function update_ocr_digit_confusions();

-- 기존 교정 데이터로 누적 통계 백필
with rows as (
  select
    regexp_replace(coalesce(original_text, ''), '\D', '', 'g') as original_digits,
    regexp_replace(coalesce(corrected_text, ''), '\D', '', 'g') as corrected_digits
  from ocr_corrections
  where field_type in ('quantity', 'unit_price', 'amount', 'po_number')
),
aligned as (
  select original_digits, corrected_digits
  from rows
  where length(original_digits) > 0
    and length(original_digits) = length(corrected_digits)
),
pairs as (
  select
    substr(original_digits, i, 1) as from_digit,
    substr(corrected_digits, i, 1) as to_digit
  from aligned,
       generate_series(1, length(original_digits)) as i
  where substr(original_digits, i, 1) <> substr(corrected_digits, i, 1)
)
insert into ocr_digit_confusions(from_digit, to_digit, count, updated_at)
select from_digit, to_digit, count(*) as count, now()
from pairs
group by from_digit, to_digit
on conflict (from_digit, to_digit)
do update set count = ocr_digit_confusions.count + excluded.count,
              updated_at = now();
