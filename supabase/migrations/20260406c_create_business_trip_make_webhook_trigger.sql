DROP TRIGGER IF EXISTS "출장 자동 이메일 발송" ON public.business_trips;
DROP TRIGGER IF EXISTS business_trip_make_webhook_on_approved ON public.business_trips;

CREATE TRIGGER business_trip_make_webhook_on_approved
AFTER UPDATE ON public.business_trips
FOR EACH ROW
WHEN (
  OLD.approval_status IS DISTINCT FROM NEW.approval_status
  AND NEW.approval_status = 'approved'
)
EXECUTE FUNCTION supabase_functions.http_request(
  'https://hook.eu2.make.com/0z9d5mdd0ravyx6asdxi31sdawnwb659',
  'POST',
  '{"Content-type":"application/json"}',
  '{}',
  '5000'
);
