-- cad_drawings UPDATE 권한 부여 (검토대기 → 완료 전환을 위해 필요)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE polname = 'Authenticated users can update cad_drawings'
      AND tablename = 'cad_drawings'
  ) THEN
    CREATE POLICY "Authenticated users can update cad_drawings"
    ON cad_drawings
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);
  END IF;
END
$$;


