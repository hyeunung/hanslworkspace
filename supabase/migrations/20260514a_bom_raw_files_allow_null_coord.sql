-- BOM-only 업로드 케이스(좌표 파일 미업로드) 지원
ALTER TABLE public.bom_raw_files
  ALTER COLUMN coordinate_file_url DROP NOT NULL,
  ALTER COLUMN coordinate_file_name DROP NOT NULL;
