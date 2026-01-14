// 공통 엔티티 타입
// - Supabase 기본 테이블 컬럼(id/created_at/updated_at)을 모델링
// - 일부 테이블은 updated_at이 없을 수 있어 optional로 둠

export interface BaseEntity {
  id: number
  created_at?: string
  updated_at?: string
}

