-- 거래명세서: 등록자 본인은 수량일치 확정 전까지 삭제 가능
-- (기존 superadmin 삭제 정책은 유지, PERMISSIVE 정책이라 OR로 합쳐짐)
DROP POLICY IF EXISTS "Allow uploader to delete own unconfirmed transaction_statements" ON public.transaction_statements;

CREATE POLICY "Allow uploader to delete own unconfirmed transaction_statements"
  ON public.transaction_statements
  FOR DELETE
  TO authenticated
  USING (
    quantity_match_confirmed_at IS NULL
    AND (
      uploaded_by = auth.uid()
      OR lower(uploaded_by_email) = lower(auth.email())
    )
  );
