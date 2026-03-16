-- ai_service_applications 테이블을 supabase_realtime publication에 등록
-- 신청서 관리 배지 실시간 업데이트를 위해 필요

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ai_service_applications'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_service_applications;
    END IF;
  END IF;
END $$;

-- REPLICA IDENTITY FULL 설정: UPDATE/DELETE 이벤트에서 old 레코드 전체를 받기 위해 필요
ALTER TABLE ai_service_applications REPLICA IDENTITY FULL;
