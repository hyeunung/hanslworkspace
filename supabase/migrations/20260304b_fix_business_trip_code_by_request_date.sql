-- 출장코드는 출장일이 아닌 요청일(생성 시점) 기준으로 생성
CREATE OR REPLACE FUNCTION business_trips_before_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.trip_code IS NULL OR btrim(NEW.trip_code) = '' THEN
    NEW.trip_code := generate_business_trip_code();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
