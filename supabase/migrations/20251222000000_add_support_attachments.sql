-- support_inquires 테이블에 attachments 컬럼 추가 (JSONB 배열로 이미지 URL들 저장)
ALTER TABLE support_inquires 
ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- 컬럼에 코멘트 추가
COMMENT ON COLUMN support_inquires.attachments IS '첨부 이미지 URL 배열 [{url: string, name: string, size: number, path: string}]';

-- Storage 버킷 생성 (support-attachments)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) 
VALUES (
  'support-attachments', 
  'support-attachments', 
  true,
  5242880,  -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage 정책 설정 (DO 블록으로 조건부 생성)
DO $$
BEGIN
    -- 인증된 사용자가 업로드 가능
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' 
        AND schemaname = 'storage'
        AND policyname = 'Authenticated users can upload support attachments'
    ) THEN
        CREATE POLICY "Authenticated users can upload support attachments"
        ON storage.objects FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'support-attachments');
    END IF;

    -- 모든 사용자가 읽기 가능 (public bucket)
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' 
        AND schemaname = 'storage'
        AND policyname = 'Anyone can view support attachments'
    ) THEN
        CREATE POLICY "Anyone can view support attachments"
        ON storage.objects FOR SELECT
        USING (bucket_id = 'support-attachments');
    END IF;

    -- 인증된 사용자가 자신의 파일 삭제 가능
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' 
        AND schemaname = 'storage'
        AND policyname = 'Authenticated users can delete support attachments'
    ) THEN
        CREATE POLICY "Authenticated users can delete support attachments"
        ON storage.objects FOR DELETE TO authenticated
        USING (bucket_id = 'support-attachments');
    END IF;
END
$$;





