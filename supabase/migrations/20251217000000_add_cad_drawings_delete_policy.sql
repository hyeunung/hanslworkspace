-- cad_drawings 삭제 권한 부여 (기존에 없을 경우만 생성)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE polname = 'Authenticated users can delete cad_drawings'
      AND tablename = 'cad_drawings'
  ) THEN
    CREATE POLICY "Authenticated users can delete cad_drawings"
    ON cad_drawings
    FOR DELETE
    TO authenticated
    USING (true);
  END IF;
END
$$;






