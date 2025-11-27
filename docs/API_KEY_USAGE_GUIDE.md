# 🔑 ChatGPT API 키 사용 시점 가이드

## 📅 개발 단계별 API 키 필요 여부

### ✅ API 키 **불필요**한 단계

#### Phase 1: DB 스키마 구축 (Week 1, Day 1-2)
- **작업**: Supabase 마이그레이션 SQL 작성 및 실행
- **API 키 필요**: ❌ 불필요
- **이유**: 데이터베이스 테이블 생성만 하면 됨

#### Phase 2: 파일 파싱 (Week 1, Day 3-5)
- **작업**: BOM/좌표 파일 읽기, 파싱 로직 개발
- **API 키 필요**: ❌ 불필요
- **이유**: 파일 읽기/파싱만 하면 됨 (ExcelJS 사용)

---

### 🔑 API 키 **필요**한 단계

#### Phase 3: AI 엔진 개발 (Week 2, Day 1-5)
- **작업**: Edge Function 개발 및 ChatGPT API 연동
- **API 키 필요**: ✅ **필요**
- **시점**: 
  - Day 1-2: Edge Function 기본 구조 작성 (API 키는 나중에)
  - **Day 3**: ChatGPT API 연동 테스트 시작 → **이때부터 API 키 필요**

---

## 🛠️ API 키 설정 방법 (단계별)

### Step 1: API 키 발급 (개발 시작 전 미리 준비)

```bash
# 1. OpenAI 웹사이트 접속
https://platform.openai.com

# 2. 로그인 후 API Keys 메뉴
# 3. "Create new secret key" 클릭
# 4. 키 복사 (sk-...로 시작)
```

### Step 2: 로컬 개발 환경 설정 (Week 2, Day 3 전에)

**파일**: `.env.local` (프로젝트 루트)

```bash
# 기존 Supabase 설정
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# ChatGPT API 키 추가 (Week 2부터 사용)
OPENAI_API_KEY=sk-...your-api-key...
```

### Step 3: Edge Function에서 사용 (Week 2, Day 3)

**파일**: `supabase/functions/process-bom/index.ts`

```typescript
serve(async (req) => {
  // API 키는 여기서 사용
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!
  
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not set')
  }
  
  // ChatGPT API 호출
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      // ...
    }
  })
})
```

### Step 4: Supabase Secrets 설정 (배포 전)

**로컬 테스트용 (선택사항):**
```bash
# Supabase CLI 사용
supabase secrets set OPENAI_API_KEY=sk-...your-api-key...
```

**또는 Supabase Dashboard:**
1. Settings → Edge Functions → Secrets
2. `OPENAI_API_KEY` 추가
3. 값 입력: `sk-...your-api-key...`

---

## 📋 개발 순서 (API 키 관점)

### Week 1: API 키 불필요
```
Day 1-2: DB 스키마 구축
  └─ API 키 불필요 ✅

Day 3-4: 파일 파싱 유틸리티
  └─ API 키 불필요 ✅

Day 5: 파일 업로드 컴포넌트
  └─ API 키 불필요 ✅
```

### Week 2: API 키 필요 (Day 3부터)
```
Day 1-2: Edge Function 기본 구조
  └─ API 키는 아직 사용 안 함
  └─ 하지만 미리 준비해두면 좋음

Day 3: ChatGPT API 연동 ⭐
  └─ API 키 필수! 🔑
  └─ .env.local에 설정
  └─ Edge Function에서 테스트

Day 4-5: 패턴 감지 로직
  └─ API 키 계속 사용
```

### Week 3-4: API 키 계속 사용
```
Week 3: 파일 생성 & UI
  └─ 실제 AI 처리 테스트 필요
  └─ API 키 사용

Week 4: 통합 테스트
  └─ 전체 플로우 테스트
  └─ API 키 사용
```

---

## 🧪 로컬 테스트 방법

### 방법 1: Supabase CLI로 로컬 테스트

```bash
# 1. Supabase CLI 설치 (없으면)
npm install -g supabase

# 2. 로컬 환경변수 설정
export OPENAI_API_KEY=sk-...your-api-key...

# 3. Edge Function 로컬 실행
supabase functions serve process-bom --env-file .env.local
```

### 방법 2: Supabase Dashboard에서 직접 테스트

1. Edge Function 배포
2. Supabase Secrets에 API 키 설정
3. Dashboard → Edge Functions → process-bom → Invoke
4. 테스트 데이터로 호출

---

## ⚠️ 주의사항

### 1. API 키는 절대 Git에 커밋하지 마세요
```bash
# .gitignore 확인
.env.local
.env
*.env
```

### 2. 로컬과 프로덕션 분리
```bash
# 로컬: .env.local
OPENAI_API_KEY=sk-...dev-key...

# 프로덕션: Supabase Secrets
OPENAI_API_KEY=sk-...prod-key...
```

### 3. 비용 모니터링
- 개발 중에는 GPT-4o-mini 사용 (저렴)
- 사용량 제한 설정 권장
- OpenAI Dashboard에서 사용량 확인

---

## 📊 실제 사용 시점 요약

| 단계 | 작업 | API 키 필요? | 비고 |
|------|------|------------|------|
| Phase 1 | DB 스키마 | ❌ | 테이블 생성만 |
| Phase 2 | 파일 파싱 | ❌ | ExcelJS 사용 |
| **Phase 3** | **AI 엔진** | **✅** | **Week 2, Day 3부터** |
| Phase 4 | Excel 생성 | ❌ | 파일 생성만 |
| Phase 5 | UI 구현 | ❌ | 프론트엔드만 |
| Phase 6 | 발주 연동 | ❌ | DB 조회만 |

---

## 🚀 빠른 시작 체크리스트

### Week 1 시작 전
- [ ] OpenAI 계정 생성
- [ ] API 키 발급 (미리 준비)
- [ ] `.env.local` 파일 생성

### Week 2, Day 3 시작 전
- [ ] `.env.local`에 `OPENAI_API_KEY` 추가
- [ ] Supabase Secrets에 API 키 설정 (배포용)
- [ ] API 키 테스트 (간단한 호출)

### 배포 전
- [ ] Supabase Secrets 확인
- [ ] API 키 보안 확인
- [ ] 비용 제한 설정

---

**결론**: API 키는 **Week 2, Day 3 (ChatGPT API 연동)**부터 필요합니다. 하지만 미리 준비해두면 좋습니다! 🔑


