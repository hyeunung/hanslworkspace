-- business_trips, card_usages, vehicle_requests 테이블을 supabase_realtime publication에 등록
-- RequestListMain 탭 배지 실시간 업데이트를 위해 필요

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    -- business_trips
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'business_trips'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.business_trips;
    END IF;

    -- card_usages
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'card_usages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.card_usages;
    END IF;

    -- vehicle_requests
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'vehicle_requests'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_requests;
    END IF;
  END IF;
END $$;

-- REPLICA IDENTITY FULL 설정: UPDATE/DELETE 이벤트에서 old 레코드 전체를 받기 위해 필요
ALTER TABLE business_trips REPLICA IDENTITY FULL;
ALTER TABLE card_usages REPLICA IDENTITY FULL;
ALTER TABLE vehicle_requests REPLICA IDENTITY FULL;
