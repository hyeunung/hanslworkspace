/**
 * 영수증 관리 관련 유틸리티 함수들
 */


// 파일 타입 검증
export function isValidImageFile(file: File): boolean {
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];
  return validTypes.includes(file.type.toLowerCase());
}

// 파일 크기 검증 (기본 10MB)
export function isValidFileSize(file: File, maxSizeMB: number = 10): boolean {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  return file.size <= maxSizeBytes;
}

// 영수증 파일명 생성
export function generateReceiptFileName(extension: string = 'jpg'): string {
  const now = new Date();
  const year = now.getFullYear().toString().substring(2);
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  const hour = now.getHours().toString().padStart(2, '0');
  const minute = now.getMinutes().toString().padStart(2, '0');
  
  return `rec${year}${month}${day}${hour}${minute}.${extension}`;
}

// Supabase Storage URL에서 파일 경로 추출
export function extractStoragePathFromUrl(url: string, bucketName: string = 'receipt-images'): string | null {
  try {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/');
    const bucketIndex = pathSegments.indexOf(bucketName);
    
    if (bucketIndex === -1) return null;
    
    return pathSegments.slice(bucketIndex + 1).join('/');
  } catch {
    return null;
  }
}

// 검색어 하이라이트용 함수
export function highlightSearchTerm(text: string, searchTerm: string): string {
  if (!searchTerm) return text;
  
  const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

// 키보드 접근성을 위한 이벤트 핸들러
export function handleKeyboardActivation(
  event: React.KeyboardEvent,
  callback: () => void
): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    callback();
  }
}