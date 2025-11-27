-- Supabase Storage Bucket 생성을 위한 SQL
-- 이 스크립트는 Supabase Dashboard에서 직접 실행해야 합니다.
-- SQL Editor에서는 직접 버킷을 생성할 수 없으므로,
-- Dashboard > Storage에서 수동으로 생성하거나 Supabase CLI를 사용하세요.

-- 버킷 정책 설정 (버킷이 이미 생성되어 있다고 가정)
-- 인증된 사용자만 업로드/다운로드 가능하도록 설정

-- 업로드 정책 (인증된 사용자만)
CREATE POLICY "Authenticated users can upload bom files" 
ON storage.objects 
FOR INSERT 
TO authenticated 
WITH CHECK (bucket_id = 'bom-files');

-- 읽기 정책 (인증된 사용자만)
CREATE POLICY "Authenticated users can read bom files" 
ON storage.objects 
FOR SELECT 
TO authenticated 
USING (bucket_id = 'bom-files');

-- 삭제 정책 (파일 소유자만)
CREATE POLICY "Users can delete their own bom files" 
ON storage.objects 
FOR DELETE 
TO authenticated 
USING (bucket_id = 'bom-files' AND auth.uid() = owner);

-- 업데이트 정책 (파일 소유자만)
CREATE POLICY "Users can update their own bom files" 
ON storage.objects 
FOR UPDATE 
TO authenticated 
USING (bucket_id = 'bom-files' AND auth.uid() = owner);