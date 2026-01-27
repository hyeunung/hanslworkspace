-- 문의 삭제를 위한 RLS 정책 추가
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='support_inquires'
      AND policyname='delete_support_inquires'
  ) THEN
    CREATE POLICY delete_support_inquires
      ON public.support_inquires
      FOR DELETE
      TO public
      USING (
        (
          auth.uid() = user_id
          AND status = 'open'
          AND (resolution_note IS NULL OR resolution_note = '')
        )
        OR EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.email = auth.email()
            AND 'app_admin' = ANY(e.purchase_role)
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='support_inquiry_messages'
      AND policyname='delete_support_inquiry_messages'
  ) THEN
    CREATE POLICY delete_support_inquiry_messages
      ON public.support_inquiry_messages
      FOR DELETE
      TO public
      USING (
        EXISTS (
          SELECT 1 FROM public.support_inquires si
          WHERE si.id = inquiry_id
            AND si.user_email = auth.email()
        )
        OR EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.email = auth.email()
            AND 'app_admin' = ANY(e.purchase_role)
        )
      );
  END IF;
END $$;
