-- bom_items, bom_raw_files, ai_learning_records에 DELETE/UPDATE RLS 정책 추가
-- 원인: DELETE 정책 누락으로 최종 확정 시 기존 bom_items가 삭제되지 않아 중복 insert 발생
DO $$
BEGIN
  -- bom_items: DELETE
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bom_items' AND policyname = 'Authenticated users can delete bom_items'
  ) THEN
    CREATE POLICY "Authenticated users can delete bom_items" ON bom_items FOR DELETE TO authenticated USING (true);
  END IF;

  -- bom_items: UPDATE
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bom_items' AND policyname = 'Authenticated users can update bom_items'
  ) THEN
    CREATE POLICY "Authenticated users can update bom_items" ON bom_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;

  -- bom_raw_files: DELETE
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bom_raw_files' AND policyname = 'Authenticated users can delete bom_raw_files'
  ) THEN
    CREATE POLICY "Authenticated users can delete bom_raw_files" ON bom_raw_files FOR DELETE TO authenticated USING (true);
  END IF;

  -- bom_raw_files: UPDATE
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bom_raw_files' AND policyname = 'Authenticated users can update bom_raw_files'
  ) THEN
    CREATE POLICY "Authenticated users can update bom_raw_files" ON bom_raw_files FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;

  -- ai_learning_records: DELETE
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ai_learning_records' AND policyname = 'Authenticated users can delete ai_learning_records'
  ) THEN
    CREATE POLICY "Authenticated users can delete ai_learning_records" ON ai_learning_records FOR DELETE TO authenticated USING (true);
  END IF;

  -- ai_learning_records: UPDATE
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ai_learning_records' AND policyname = 'Authenticated users can update ai_learning_records'
  ) THEN
    CREATE POLICY "Authenticated users can update ai_learning_records" ON ai_learning_records FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END
$$;
