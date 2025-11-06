# 환경변수 설정 가이드

## 🔐 보안 원칙

1. **절대 실제 키를 Git에 커밋하지 마세요**
2. **Service Role Key는 서버 사이드에서만 사용하세요**
3. **Production과 Development 환경변수를 분리하세요**
4. **정기적으로 토큰을 갱신하세요**

## 📋 필수 환경변수

### 1. Supabase 설정

```bash
# Public (클라이언트 사이드 OK)
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Private (서버 사이드만)
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

**취득 방법:**
1. [Supabase Dashboard](https://app.supabase.com) 로그인
2. 프로젝트 선택
3. Settings → API
4. URL과 키 복사

## 🚀 빠른 시작

### 1단계: 환경변수 파일 생성

```bash
# .env.example을 복사하여 .env.local 생성
cp .env.example .env.local
```

### 2단계: 실제 값 입력

`.env.local` 파일을 열고 실제 값으로 교체:

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://qvhbigvdfyvhoegkhvef.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=실제_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=실제_SERVICE_KEY
```

### 3단계: 환경변수 확인

```bash
# 개발 서버 실행
npm run dev

# 환경변수가 로드되었는지 확인
console.log(process.env.NEXT_PUBLIC_SUPABASE_URL)
```

## 🔒 보안 체크리스트

- [ ] `.env.local` 파일이 `.gitignore`에 포함되어 있는가?
- [ ] Service Role Key를 클라이언트 코드에서 사용하지 않는가?
- [ ] Production 환경변수가 별도로 관리되고 있는가?
- [ ] 팀원들과 안전하게 환경변수를 공유하고 있는가?

## 🛠️ 환경별 설정

### Development (로컬)
```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=로컬_또는_개발_URL
```

### Staging
```bash
# .env.staging
NEXT_PUBLIC_SUPABASE_URL=스테이징_URL
```

### Production
```bash
# Vercel, AWS, Azure 등의 환경변수 관리 서비스 사용
# 절대 파일로 관리하지 않음
```

## 📦 배포 시 환경변수 설정

### Vercel
1. 프로젝트 Settings → Environment Variables
2. 각 환경변수 추가
3. Production/Preview/Development 환경 선택

### Docker
```dockerfile
# Dockerfile
ARG NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
```

### GitHub Actions
```yaml
# .github/workflows/deploy.yml
env:
  NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
```

## ⚠️ 문제 해결

### 환경변수가 undefined로 나올 때
1. `.env.local` 파일이 프로젝트 루트에 있는지 확인
2. 변수명이 정확한지 확인 (대소문자 구분)
3. 서버 재시작 (`npm run dev`)
4. `NEXT_PUBLIC_` 접두사 확인 (클라이언트 사이드용)

## 📚 참고 자료

- [Next.js 환경변수 문서](https://nextjs.org/docs/basic-features/environment-variables)
- [Supabase 환경변수 가이드](https://supabase.com/docs/guides/functions/secrets)