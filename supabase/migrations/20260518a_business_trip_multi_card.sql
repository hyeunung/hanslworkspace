-- 출장신청 시 법인카드를 여러 장 선택할 수 있도록 변경
-- requested_card_number: text -> text[] (복수 카드)
-- 출장 1건당 선택한 카드 수만큼 card_usages 레코드 자동 생성

-- 1) requested_card_number 컬럼을 배열 타입으로 변경 (기존 단일 값은 1개짜리 배열로 변환)
ALTER TABLE business_trips
  ALTER COLUMN requested_card_number DROP DEFAULT;

ALTER TABLE business_trips
  ALTER COLUMN requested_card_number TYPE text[]
  USING (
    CASE
      WHEN NULLIF(BTRIM(COALESCE(requested_card_number, '')), '') IS NULL THEN NULL
      ELSE ARRAY[requested_card_number]
    END
  );

COMMENT ON COLUMN business_trips.requested_card_number IS '요청 카드 목록 (예: {"출장용 5914","청송 0948"})';

-- 2) 출장 <-> 카드신청 동기화 트리거를 복수 카드 대응으로 재작성
CREATE OR REPLACE FUNCTION sync_business_trip_card_usage()
RETURNS TRIGGER AS $$
DECLARE
  v_card text;
  v_status text;
BEGIN
  v_status := CASE
    WHEN NEW.approval_status = 'approved' THEN 'approved'
    WHEN NEW.approval_status = 'rejected' THEN 'rejected'
    ELSE 'pending'
  END;

  IF TG_OP = 'INSERT' THEN
    IF NEW.requested_card_number IS NOT NULL THEN
      FOREACH v_card IN ARRAY NEW.requested_card_number LOOP
        IF NULLIF(BTRIM(COALESCE(v_card, '')), '') IS NOT NULL THEN
          INSERT INTO card_usages (
            requester_id,
            card_number,
            usage_category,
            usage_date_start,
            usage_date_end,
            description,
            approval_status,
            business_trip_id,
            auto_created_by_trip
          ) VALUES (
            NEW.requester_id,
            v_card,
            '출장',
            NEW.trip_start_date,
            NEW.trip_end_date,
            '[' || NEW.trip_code || '] ' || COALESCE(NEW.trip_purpose, ''),
            v_status,
            NEW.id,
            true
          );
        END IF;
      END LOOP;
    END IF;
    RETURN NEW;
  END IF;

  -- 일정/설명 변경을 자동 생성된 카드 요청에 반영
  UPDATE card_usages
     SET usage_date_start = NEW.trip_start_date,
         usage_date_end = NEW.trip_end_date,
         description = '[' || NEW.trip_code || '] ' || COALESCE(NEW.trip_purpose, '')
   WHERE business_trip_id = NEW.id
     AND auto_created_by_trip = true;

  -- 승인 상태 동기화
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    UPDATE card_usages
       SET approval_status = v_status,
           approved_by = CASE WHEN NEW.approval_status = 'approved' THEN NEW.approved_by ELSE NULL END,
           approved_at = CASE WHEN NEW.approval_status = 'approved' THEN COALESCE(NEW.approved_at, now()) ELSE NULL END,
           rejection_reason = CASE WHEN NEW.approval_status = 'rejected' THEN COALESCE(NEW.rejection_reason, '출장 승인 반려') ELSE NULL END
     WHERE business_trip_id = NEW.id
       AND auto_created_by_trip = true;
  END IF;

  -- 새로 추가된 카드는 card_usages 레코드를 추가 생성
  -- (카드 제거 시에는 정산/반납 이력 보존을 위해 자동 삭제하지 않음)
  IF NEW.requested_card_number IS NOT NULL THEN
    FOREACH v_card IN ARRAY NEW.requested_card_number LOOP
      IF NULLIF(BTRIM(COALESCE(v_card, '')), '') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM card_usages cu
           WHERE cu.business_trip_id = NEW.id
             AND cu.auto_created_by_trip = true
             AND cu.card_number = v_card
         ) THEN
        INSERT INTO card_usages (
          requester_id,
          card_number,
          usage_category,
          usage_date_start,
          usage_date_end,
          description,
          approval_status,
          business_trip_id,
          auto_created_by_trip
        ) VALUES (
          NEW.requester_id,
          v_card,
          '출장',
          NEW.trip_start_date,
          NEW.trip_end_date,
          '[' || NEW.trip_code || '] ' || COALESCE(NEW.trip_purpose, ''),
          v_status,
          NEW.id,
          true
        );
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
