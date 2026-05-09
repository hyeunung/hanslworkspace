DROP TRIGGER IF EXISTS "연차 자동 이메일 발송" ON public.leave;

CREATE TRIGGER "연차 자동 이메일 발송"
AFTER UPDATE ON public.leave
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  AND OLD.status = 'pending'
  AND NEW.status IN ('approved', 'rejected')
)
EXECUTE FUNCTION supabase_functions.http_request(
  'https://hook.eu2.make.com/mvoe8crlaqih04eumi17a8ttnhecqfq7',
  'POST',
  '{"Content-type":"application/json"}',
  '{}',
  '5000'
);
