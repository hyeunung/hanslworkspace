/**
 * 영수증 관리 관련 유틸리티 함수들
 */

// 파일 크기를 읽기 쉬운 형태로 변환
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// 날짜를 한국어 형식으로 포맷
export function formatDate(dateStr?: string): string {
  if (!dateStr) return '-';
  
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '-';
    
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return '-';
  }
}

// 상대적 시간 표시 (예: "2시간 전", "3일 전")
export function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return '-';
  
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffMinutes < 60) {
      return diffMinutes < 1 ? '방금 전' : `${diffMinutes}분 전`;
    } else if (diffHours < 24) {
      return `${diffHours}시간 전`;
    } else if (diffDays < 7) {
      return `${diffDays}일 전`;
    } else {
      return formatDate(dateStr);
    }
  } catch {
    return '-';
  }
}

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