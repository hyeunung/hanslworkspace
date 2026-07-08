-- production_pcbs에 배송완료(납품) 알림 대상 칼럼이 누락되어 있었음.
-- production_cables.delivery_notify_teams는 존재하는데 production_pcbs만 빠져 있어,
-- PCB 행에서 배송완료(delivery_completed) 저장 시 PGRST204(칼럼 없음)로 매번 실패했음.
-- 다른 완료 이벤트 알림 칼럼(artwork_notify_teams 등)과 동일한 패턴으로 추가.

ALTER TABLE production_pcbs
  ADD COLUMN IF NOT EXISTS delivery_notify_teams jsonb NOT NULL DEFAULT '[]'::jsonb;
