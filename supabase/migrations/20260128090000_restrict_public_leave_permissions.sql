-- Restrict "공가" leave visibility/approval to app_admin only
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'leave'
      AND policyname = 'leave_restrict_gongga_select'
  ) THEN
    CREATE POLICY leave_restrict_gongga_select
      ON public."leave"
      AS RESTRICTIVE
      FOR SELECT
      TO public
      USING (
        NOT (
          COALESCE(type, '') ILIKE '%공가%'
          OR COALESCE(reason, '') ILIKE '%공가%'
        )
        OR EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.email = auth.email()
            AND 'app_admin' = ANY(COALESCE(e.purchase_role, ARRAY[]::text[]))
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'leave'
      AND policyname = 'leave_restrict_gongga_update'
  ) THEN
    CREATE POLICY leave_restrict_gongga_update
      ON public."leave"
      AS RESTRICTIVE
      FOR UPDATE
      TO public
      USING (
        NOT (
          COALESCE(type, '') ILIKE '%공가%'
          OR COALESCE(reason, '') ILIKE '%공가%'
        )
        OR EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.email = auth.email()
            AND 'app_admin' = ANY(COALESCE(e.purchase_role, ARRAY[]::text[]))
        )
      )
      WITH CHECK (
        NOT (
          COALESCE(type, '') ILIKE '%공가%'
          OR COALESCE(reason, '') ILIKE '%공가%'
        )
        OR EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.email = auth.email()
            AND 'app_admin' = ANY(COALESCE(e.purchase_role, ARRAY[]::text[]))
        )
      );
  END IF;
END $$;
