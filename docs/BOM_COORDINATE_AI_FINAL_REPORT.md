# 🎯 BOM/좌표 정리 AI 시스템 최종 개발 보고서

## 📊 1. 프로젝트 개요

### 목표
- **BOM 원본 + 좌표 파일** → **정리된 BOM 파일** 자동 생성 AI 시스템
- 기존 수동 작업(600~1000개 파일)을 자동화하여 시간 절약
- 학습 기반 시스템으로 CAD 프로그램 변경에도 자동 대응

### 학습 데이터 현황
```
2024년도: 126개 폴더
  └─ 완전한 세트: 59개

2025년도: 98개 폴더
  └─ 완전한 세트: 54개

─────────────────────────────
총: 224개 폴더
완전한 학습 세트: 113개 ✅
```

**파일 구성:**
- **Input 1**: BOM 원본 (`*part.BOM.xlsx`, `*part.bom`, `*.BOM.xlsx` 등)
- **Input 2**: 좌표 파일 (`*[좌표]*.txt`, `*좌표*.xls` 등)
- **Output**: 정리된 파일 (`*(2401).xlsx`, `*(2509).xlsx` 등)

---

## 🏗️ 2. 시스템 아키텍처

### 전체 흐름
```
[사용자] 
  ↓
[UI: BOM/좌표 정리 탭]
  ├─ 파일 업로드 (BOM + 좌표)
  ├─ 메타데이터 입력 (Artwork 담당자, 생산 담당자, 수량)
  └─ "생성하기" 버튼
      ↓
[Supabase Edge Function]
  ├─ 파일 파싱 (ExcelJS)
  ├─ 패턴 감지 (3종류 CAD 프로그램)
  ├─ AI 처리 (ChatGPT API)
  └─ 정리된 파일 생성
      ↓
[UI: 3패널 미리보기]
  ├─ 원본 BOM
  ├─ 원본 좌표
  └─ 생성된 파일 (편집 가능)
      ↓
[사용자 확인]
  └─ "최종 확인" 버튼
      ↓
[DB 저장 + Excel 다운로드]
```

---

## 💾 3. 데이터베이스 스키마

### 3.1 `cad_drawings` (보드 정보)
```sql
CREATE TABLE cad_drawings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_name TEXT NOT NULL UNIQUE,  -- 보드명 (H24-001_...)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```
**목적**: 보드명을 중앙 관리, 발주 시 보드 선택용

### 3.2 `bom_raw_files` (원본 파일)
```sql
CREATE TABLE bom_raw_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_drawing_id UUID REFERENCES cad_drawings(id),
  bom_file_url TEXT NOT NULL,  -- Supabase Storage URL
  coordinate_file_url TEXT NOT NULL,
  bom_file_name TEXT NOT NULL,
  coordinate_file_name TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,  -- 로그인 사용자 이메일
  uploaded_at TIMESTAMP DEFAULT NOW()
);
```
**목적**: 업로드된 원본 파일 메타데이터 저장

### 3.3 `bom_items` (정리된 BOM 항목)
```sql
CREATE TABLE bom_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_drawing_id UUID REFERENCES cad_drawings(id),
  line_number INTEGER NOT NULL,
  item_type TEXT,  -- 종류
  item_name TEXT NOT NULL,  -- 품명
  specification TEXT,  -- 규격
  set_count INTEGER NOT NULL,  -- SET 수량 (REF 개수)
  total_quantity INTEGER,  -- 전체 수량 (SET × 생산수량)
  stock_quantity INTEGER,  -- 재고
  check_status TEXT,  -- CHECK (□양호 □불량)
  ref_list TEXT[],  -- REF 배열
  alternative_item TEXT,  -- 대체가능품목
  remark TEXT,  -- 비고 (미삽 등)
  created_at TIMESTAMP DEFAULT NOW()
);
```
**목적**: 정리된 BOM 데이터를 DB에 저장, 발주 시 자동 불러오기용

### 3.4 `part_placements` (부품 좌표)
```sql
CREATE TABLE part_placements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_drawing_id UUID REFERENCES cad_drawings(id),
  ref TEXT NOT NULL,  -- REF 디자인명
  part_name TEXT NOT NULL,  -- 부품명
  part_type TEXT,  -- 부품 종류
  side TEXT NOT NULL,  -- TOP/BOTTOM
  x_coordinate NUMERIC NOT NULL,
  y_coordinate NUMERIC NOT NULL,
  angle NUMERIC,  -- 회전 각도
  created_at TIMESTAMP DEFAULT NOW()
);
```
**목적**: Pick&Place 좌표 데이터 저장

### 3.5 `bom_processing_logs` (처리 로그)
```sql
CREATE TABLE bom_processing_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_drawing_id UUID REFERENCES cad_drawings(id),
  bom_raw_file_id UUID REFERENCES bom_raw_files(id),
  artwork_manager TEXT NOT NULL,  -- Artwork 담당자
  production_manager TEXT,  -- 생산 담당자 (employees 테이블 참조)
  production_quantity INTEGER,  -- 생산 수량
  processing_status TEXT NOT NULL,  -- processing, completed, failed
  ai_model_used TEXT,  -- 사용된 AI 모델 (gpt-4o-mini 등)
  tokens_used INTEGER,  -- 사용된 토큰 수
  processing_time_ms INTEGER,  -- 처리 시간
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);
```
**목적**: AI 처리 이력 추적, 비용 관리, 오류 디버깅

### 3.6 `ai_learning_records` (학습 데이터)
```sql
CREATE TABLE ai_learning_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_drawing_id UUID REFERENCES cad_drawings(id),
  raw_bom_data JSONB NOT NULL,  -- 원본 BOM 데이터
  raw_coordinate_data JSONB NOT NULL,  -- 원본 좌표 데이터
  processed_bom_data JSONB NOT NULL,  -- 정리된 BOM 데이터
  processed_coordinate_data JSONB NOT NULL,  -- 정리된 좌표 데이터
  cad_program_type TEXT,  -- CAD 프로그램 종류 (P-CAD, Altium 등)
  user_corrections JSONB,  -- 사용자 수정 사항
  created_at TIMESTAMP DEFAULT NOW()
);
```
**목적**: 학습 데이터 누적, 향후 파인튜닝용

### 3.7 `bom_pattern_library` (패턴 라이브러리)
```sql
CREATE TABLE bom_pattern_library (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_program_type TEXT NOT NULL,  -- CAD 프로그램 종류
  pattern_name TEXT NOT NULL,  -- 패턴 이름
  header_row_index INTEGER,  -- 헤더 행 위치
  data_start_row_index INTEGER,  -- 데이터 시작 행
  column_mapping JSONB NOT NULL,  -- 컬럼 매핑 정보
  sample_file_url TEXT,  -- 샘플 파일 URL
  accuracy_score NUMERIC,  -- 정확도 점수
  usage_count INTEGER DEFAULT 0,  -- 사용 횟수
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```
**목적**: 룰 기반 파서 패턴 저장, 3종류 CAD 프로그램 패턴 관리

---

## 🎨 4. UI/UX 설계

### 4.1 메뉴 추가
**위치**: 기존 메뉴에 "BOM/좌표 정리" 탭 추가

### 4.2 파일 업로드 화면
```
┌─────────────────────────────────────────┐
│ BOM/좌표 정리                           │
├─────────────────────────────────────────┤
│                                         │
│ [BOM 파일 업로드]  [좌표 파일 업로드]   │
│                                         │
│ Artwork 담당자: [자동 입력 - 로그인]   │
│ 생산 담당자: [드롭다운 - employees]    │
│ 수량: [입력 필드]                       │
│                                         │
│ [생성하기]                              │
│                                         │
└─────────────────────────────────────────┘
```

### 4.3 3패널 미리보기 화면
```
┌──────────────┬──────────────┬──────────────┐
│ 원본 BOM     │ 원본 좌표    │ 생성된 파일  │
├──────────────┼──────────────┼──────────────┤
│              │              │              │
│ [테이블]     │ [테이블]     │ [편집 가능]  │
│              │              │              │
│              │              │ [행 추가/삭제]│
│              │              │ [자동 계산]  │
│              │              │              │
└──────────────┴──────────────┴──────────────┘
│                    [최종 확인]            │
└───────────────────────────────────────────┘
```

### 4.4 발주 요청 연동
**위치**: "새 발주요청" 탭
```
발주 기본 정보
├─ 발주서 종류: [드롭다운]
├─ 보드명: [검색 가능 드롭다운] ← 새로 추가
└─ ...

품목 목록
└─ [보드명 선택 시 자동으로 품목 채워짐]
    ├─ 품목명 (bom_items.item_name)
    ├─ 종류 (bom_items.item_type)
    ├─ 규격 (bom_items.specification)
    ├─ SET 수량 (bom_items.set_count)
    └─ 수량 (자동 계산: SET × 생산수량)
```

---

## 🤖 5. AI 처리 로직

### 5.1 패턴 감지 (3단계)
1. **룰 기반 파서** (빠름, 정확)
   - `bom_pattern_library`에서 패턴 매칭
   - 3종류 CAD 프로그램 패턴 적용
   - 매칭 성공 시 즉시 처리

2. **AI 기반 파서** (유연함)
   - 룰 기반 실패 시 ChatGPT API 호출
   - 원본 데이터 → 정리된 데이터 변환
   - GPT-4o-mini 사용 (비용 절감)

3. **학습 데이터 누적**
   - 처리 결과를 `ai_learning_records`에 저장
   - 사용자 수정 사항도 저장
   - 향후 파인튜닝 데이터로 활용

### 5.2 ChatGPT 프롬프트 템플릿
```
다음은 CAD에서 추출된 BOM 및 Pick&Place 좌표 데이터이다.
이 데이터를 기반으로 아래 규칙에 따라 "정리된 BOM"과 "좌표 테이블"을 JSON 형태로 출력하라.

[정리 규칙]
1) 동일 품명(part_name)을 가진 항목들을 그룹핑한다.
2) 그룹마다 REF 리스트를 모아 정렬한다.
3) REF의 개수 = SET 값.
4) 전체 수량 = SET × 생산수량(production_count).
5) 품명에 "_OPEN" 또는 미실장 패턴 존재 시 비고에 "미삽" 표시.
6) 결과는 아래 스키마로 출력:
   - BOM: 번호, 종류, 품명, SET, 수량, 재고(null), CHECK("□양호 □불량"), REF, 대체가능품목(null), 비고
   - 좌표: ref, part_name, type, side, x, y, angle
7) JSON으로만 응답하라.

[입력 데이터]
${raw_bom_data}
${raw_coordinate_data}
```

---

## 📋 6. 개발 단계별 계획

### Phase 0: 사전 학습 데이터 준비 ✅
- [x] 113개 완전한 세트 식별
- [x] 파일명 패턴 분석
- [ ] BOM/좌표 파일 내용 분석 스크립트 작성
- [ ] 학습 데이터셋 생성 (JSONL 형식)

### Phase 1: DB 스키마 구축
- [ ] Supabase 마이그레이션 파일 작성
- [ ] 테이블 생성 (7개 테이블)
- [ ] RLS (Row Level Security) 정책 설정
- [ ] 인덱스 생성 (성능 최적화)

### Phase 2: 파일 업로드 & 파싱
- [ ] Supabase Storage 버킷 생성
- [ ] 파일 업로드 UI 컴포넌트
- [ ] ExcelJS를 이용한 BOM 파싱
- [ ] 좌표 파일 파싱 (TXT/XLSX)
- [ ] 패턴 감지 로직 (3종류 CAD)

### Phase 3: AI 처리 엔진
- [ ] Supabase Edge Function 생성
- [ ] ChatGPT API 연동
- [ ] 프롬프트 템플릿 구현
- [ ] 응답 파싱 및 검증
- [ ] 오류 처리 및 재시도 로직

### Phase 4: 정리된 파일 생성
- [ ] ExcelJS로 정리된 파일 생성
- [ ] 템플릿 양식 적용 (`CM_NUCLEO_V5.00 후.xlsx` 참고)
- [ ] BOM 시트 생성
- [ ] TOP/BOTTOM 좌표 시트 생성
- [ ] 수식 자동 계산

### Phase 5: UI 구현
- [ ] "BOM/좌표 정리" 탭 생성
- [ ] 파일 업로드 화면
- [ ] 3패널 미리보기 화면
- [ ] 인라인 편집 기능
- [ ] 행 추가/삭제 기능
- [ ] 자동 계산 로직

### Phase 6: 발주 요청 연동
- [ ] "보드명" 드롭다운 추가
- [ ] 보드 선택 시 품목 자동 채우기
- [ ] SET 수량 표시
- [ ] 수량 자동 계산

### Phase 7: 학습 시스템
- [ ] 처리 결과 DB 저장
- [ ] 사용자 수정 사항 추적
- [ ] 학습 데이터 누적
- [ ] 패턴 라이브러리 업데이트

---

## 🔧 7. 기술 스택

### 프론트엔드
- **React 18** + **TypeScript**
- **React Hook Form** (폼 관리)
- **ExcelJS** (Excel 파일 처리)
- **shadcn/ui** (UI 컴포넌트)
- **ReactSelect** (검색 가능 드롭다운)

### 백엔드
- **Supabase** (PostgreSQL, Storage, Edge Functions)
- **ChatGPT API** (GPT-4o-mini)
- **ExcelJS** (서버사이드 Excel 처리)

### 학습
- **113개 완전한 세트** (학습 데이터)
- **JSONL 형식** (ChatGPT 파인튜닝용)

---

## 📈 8. 예상 효과

### 시간 절약
- **기존**: 1개 파일당 30분~1시간 (수동 작업)
- **자동화 후**: 1개 파일당 5분 (확인만)
- **절약**: 25~55분/파일

### 정확도 향상
- **기존**: 사람 실수 가능
- **자동화 후**: 일관된 형식, 오류 감소

### 확장성
- **학습 시스템**: 새로운 CAD 프로그램에도 자동 대응
- **패턴 누적**: 사용할수록 정확도 향상

---

## 🚀 9. 다음 단계

1. **즉시 시작**: Phase 1 (DB 스키마 구축)
2. **병렬 작업**: Phase 0 (학습 데이터 준비) + Phase 2 (파일 파싱)
3. **우선순위**: UI 구현 → AI 엔진 → 발주 연동

---

## ✅ 최종 확인 사항

- [x] 학습 데이터: 113개 완전한 세트 확보
- [x] 파일 패턴 분석 완료
- [x] 시스템 아키텍처 설계 완료
- [x] DB 스키마 설계 완료
- [x] UI/UX 설계 완료
- [ ] 개발 시작 준비 완료

---

**작성일**: 2025-01-XX  
**버전**: 1.0  
**상태**: 개발 준비 완료 ✅



