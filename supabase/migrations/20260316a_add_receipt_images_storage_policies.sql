-- receipt-images 버킷 정책 보강
-- 회전 저장은 storage.objects 업로드(upsert: true)를 사용하므로 UPDATE 권한이 필요하다.

INSERT INTO storage.buckets (id, name, public)
VALUES ('receipt-images', 'receipt-images', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'receipt_images_upload'
  ) THEN
    CREATE POLICY "receipt_images_upload" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'receipt-images');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'receipt_images_select'
  ) THEN
    CREATE POLICY "receipt_images_select" ON storage.objects
      FOR SELECT
      USING (bucket_id = 'receipt-images');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'receipt_images_update'
  ) THEN
    CREATE POLICY "receipt_images_update" ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'receipt-images')
      WITH CHECK (bucket_id = 'receipt-images');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'receipt_images_delete'
  ) THEN
    CREATE POLICY "receipt_images_delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'receipt-images');
  END IF;
END $$;

