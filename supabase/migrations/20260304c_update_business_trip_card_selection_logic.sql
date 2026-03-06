BEGIN;

ALTER TABLE business_trips
  ALTER COLUMN request_corporate_card SET DEFAULT false;

COMMENT ON COLUMN business_trips.request_corporate_card IS '출장카드 선택 여부(선택 시 true)';

UPDATE business_trips
SET request_corporate_card = false
WHERE request_corporate_card = true
  AND NULLIF(BTRIM(COALESCE(requested_card_number, '')), '') IS NULL;

CREATE OR REPLACE FUNCTION sync_business_trip_card_usage()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NULLIF(BTRIM(COALESCE(NEW.requested_card_number, '')), '') IS NOT NULL THEN
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
        NEW.requested_card_number,
        '출장',
        NEW.trip_start_date,
        NEW.trip_end_date,
        '[' || NEW.trip_code || '] ' || COALESCE(NEW.trip_purpose, ''),
        CASE
          WHEN NEW.approval_status = 'approved' THEN 'approved'
          WHEN NEW.approval_status = 'rejected' THEN 'rejected'
          ELSE 'pending'
        END,
        NEW.id,
        true
      );
    END IF;
    RETURN NEW;
  END IF;

  UPDATE card_usages
     SET usage_date_start = NEW.trip_start_date,
         usage_date_end = NEW.trip_end_date,
         card_number = COALESCE(NULLIF(BTRIM(COALESCE(NEW.requested_card_number, '')), ''), card_number),
         description = '[' || NEW.trip_code || '] ' || COALESCE(NEW.trip_purpose, '')
   WHERE business_trip_id = NEW.id
     AND auto_created_by_trip = true;

  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    UPDATE card_usages
       SET approval_status = CASE
         WHEN NEW.approval_status = 'approved' THEN 'approved'
         WHEN NEW.approval_status = 'rejected' THEN 'rejected'
         ELSE 'pending'
       END,
           approved_by = CASE WHEN NEW.approval_status = 'approved' THEN NEW.approved_by ELSE NULL END,
           approved_at = CASE WHEN NEW.approval_status = 'approved' THEN COALESCE(NEW.approved_at, now()) ELSE NULL END,
           rejection_reason = CASE WHEN NEW.approval_status = 'rejected' THEN COALESCE(NEW.rejection_reason, '출장 승인 반려') ELSE NULL END
     WHERE business_trip_id = NEW.id
       AND auto_created_by_trip = true;
  END IF;

  IF NULLIF(BTRIM(COALESCE(NEW.requested_card_number, '')), '') IS NOT NULL
     AND (
       NULLIF(BTRIM(COALESCE(OLD.requested_card_number, '')), '') IS NULL
       OR NEW.requested_card_number IS DISTINCT FROM OLD.requested_card_number
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
    )
    SELECT
      NEW.requester_id,
      NEW.requested_card_number,
      '출장',
      NEW.trip_start_date,
      NEW.trip_end_date,
      '[' || NEW.trip_code || '] ' || COALESCE(NEW.trip_purpose, ''),
      CASE
        WHEN NEW.approval_status = 'approved' THEN 'approved'
        WHEN NEW.approval_status = 'rejected' THEN 'rejected'
        ELSE 'pending'
      END,
      NEW.id,
      true
    WHERE NOT EXISTS (
      SELECT 1
      FROM card_usages cu
      WHERE cu.business_trip_id = NEW.id
        AND cu.auto_created_by_trip = true
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
