-- 활동 로그(system_activity_logs) 대상 테이블 확대
-- 기존 fn_log_db_change() 트리거 함수를 사용자 화면 테이블 전반에 부착한다.
-- 제외: 로그 테이블 자신(무한루프), 카운터/OCR/설정/알림 등 내부·잡음 테이블.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employees',
    'vendors','vendor_contacts',
    'attendance_records','leave','holidays',
    'business_trips','business_trip_expenses','business_trip_expense_receipts',
    'business_trip_allowances','business_trip_mileages','business_trip_tasks','trip_expense_places',
    'card_usages','card_usage_receipts',
    'shipping_companies','shipping_company_addresses','shipping_contacts','shipping_labels',
    'vehicle_requests',
    'ai_service_applications',
    'official_documents',
    'support_inquires','support_inquiry_messages',
    'delivery_orders','delivery_order_items'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_log_%I ON public.%I;', t, t);
      EXECUTE format(
        'CREATE TRIGGER trg_log_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_log_db_change();',
        t, t
      );
    END IF;
  END LOOP;
END $$;
