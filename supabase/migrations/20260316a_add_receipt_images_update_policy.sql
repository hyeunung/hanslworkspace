-- receipt-images 버킷에 UPDATE 정책 추가
-- 클라이언트에서 회전 저장 시 upsert: true 가 동작하려면 UPDATE 권한 필요
CREATE POLICY "receipt_images_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'receipt-images')
  WITH CHECK (bucket_id = 'receipt-images');
