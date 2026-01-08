-- 1) 문의 메시지 로그 테이블 + RLS + Realtime

CREATE TABLE IF NOT EXISTS public.support_inquiry_messages (
  id BIGSERIAL PRIMARY KEY,
  inquiry_id BIGINT NOT NULL REFERENCES public.support_inquires(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('user','admin','system')),
  sender_email TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_inquiry_messages_inquiry_id_created_at
  ON public.support_inquiry_messages(inquiry_id, created_at);

ALTER TABLE public.support_inquiry_messages ENABLE ROW LEVEL SECURITY;

-- SELECT: 본인 문의 or app_admin
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='support_inquiry_messages'
      AND policyname='select_support_inquiry_messages'
  ) THEN
    CREATE POLICY select_support_inquiry_messages
      ON public.support_inquiry_messages
      FOR SELECT
      TO public
      USING (
        auth.email() = (SELECT si.user_email FROM public.support_inquires si WHERE si.id = inquiry_id)
        OR EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.email = auth.email()
            AND 'app_admin' = ANY(e.purchase_role)
        )
      );
  END IF;
END $$;

-- INSERT (user): 본인 문의에만, resolved/closed면 불가
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='support_inquiry_messages'
      AND policyname='insert_support_inquiry_messages_user'
  ) THEN
    CREATE POLICY insert_support_inquiry_messages_user
      ON public.support_inquiry_messages
      FOR INSERT
      TO public
      WITH CHECK (
        sender_role = 'user'
        AND sender_email = auth.email()
        AND auth.email() = (SELECT si.user_email FROM public.support_inquires si WHERE si.id = inquiry_id)
        AND (SELECT si.status FROM public.support_inquires si WHERE si.id = inquiry_id) NOT IN ('resolved','closed')
      );
  END IF;
END $$;

-- INSERT (admin): app_admin만, resolved/closed면 불가
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='support_inquiry_messages'
      AND policyname='insert_support_inquiry_messages_admin'
  ) THEN
    CREATE POLICY insert_support_inquiry_messages_admin
      ON public.support_inquiry_messages
      FOR INSERT
      TO public
      WITH CHECK (
        sender_role = 'admin'
        AND sender_email = auth.email()
        AND EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.email = auth.email()
            AND 'app_admin' = ANY(e.purchase_role)
        )
        AND (SELECT si.status FROM public.support_inquires si WHERE si.id = inquiry_id) NOT IN ('resolved','closed')
      );
  END IF;
END $$;

-- Realtime publication 등록(존재 시에만)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'support_inquiry_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.support_inquiry_messages;
    END IF;
  END IF;
END $$;


