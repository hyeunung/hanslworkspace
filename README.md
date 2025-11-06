# HANSL Workspace - 구매/발주 관리 시스템

## 📋 개요

HANSL Workspace는 기업의 구매 요청부터 발주, 승인, 입고까지 전체 프로세스를 관리하는 통합 시스템입니다.

### 주요 기능
- 📝 구매 요청 생성 및 관리
- ✅ 다단계 승인 프로세스 (중간/최종 승인)
- 📊 Excel 발주서 생성 및 다운로드
- 📦 입고 관리 및 추적
- 👥 직원 및 거래처 관리

## 🚀 시작하기

### 필수 요구사항
- Node.js 18.0 이상
- npm 또는 yarn
- Supabase 계정

### 설치

1. **저장소 클론**
```bash
git clone [repository-url]
cd hanslworkspace
```

2. **환경 변수 설정**

로컬 개발을 위해 `.env` 파일을 생성하고 다음 변수들을 설정하세요:

```bash
# Supabase Configuration (필수)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

**Supabase 키 가져오기:**
1. [Supabase Dashboard](https://app.supabase.com) 로그인
2. 프로젝트 선택 → Settings → API
3. Project URL과 anon public key 복사

**배포 환경 설정:**
- **Vercel**: Dashboard → Settings → Environment Variables
- **Netlify**: Site Settings → Environment Variables

각 플랫폼에서 다음 환경 변수를 추가하세요:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

2. **의존성 설치**
```bash
npm install
```

3. **환경변수 설정**
`.env.local` 파일을 생성하고 다음 내용을 입력:
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

4. **개발 서버 실행**
```bash
npm run dev
```

http://localhost:3000 에서 앱에 접속할 수 있습니다.

## 📁 프로젝트 구조

```
hanslworkspace/
├── src/
│   ├── app/                  # Next.js App Router
│   │   ├── (protected)/      # 인증이 필요한 페이지
│   │   │   ├── dashboard/    # 대시보드
│   │   │   ├── purchase/     # 발주 관리
│   │   │   ├── approval/     # 승인 관리
│   │   │   ├── vendor/       # 거래처 관리
│   │   │   └── employee/     # 직원 관리
│   │   ├── api/              # API 엔드포인트
│   │   └── login/            # 로그인 페이지
│   ├── components/           # React 컴포넌트
│   │   ├── ui/              # UI 컴포넌트 (shadcn/ui)
│   │   ├── purchase/         # 발주 관련 컴포넌트
│   │   ├── approval/         # 승인 관련 컴포넌트
│   │   └── layout/           # 레이아웃 컴포넌트
│   ├── lib/                  # 라이브러리 및 유틸리티
│   │   └── supabase/         # Supabase 클라이언트
│   ├── services/             # 비즈니스 로직
│   ├── hooks/                # 커스텀 React 훅
│   ├── types/                # TypeScript 타입 정의
│   └── utils/                # 유틸리티 함수
├── scripts/                  # 유틸리티 스크립트
│   ├── test-purchase.js      # 발주 테스트
│   ├── test-excel.js         # Excel 테스트
│   └── health-check.js       # 시스템 점검
└── public/                   # 정적 파일
```

## 🔧 주요 기능 설명

### 1. 구매 요청 생성
- 요청자가 구매 요청서 작성
- 최대 100개 품목 동시 입력 가능
- 거래처 및 담당자 선택
- 납기일 및 프로젝트 정보 입력

### 2. 승인 프로세스
```
요청 생성 → 중간관리자 승인 → 최종관리자 승인 → Lead Buyer 처리
```
- 역할 기반 접근 제어
- 일괄 승인 기능
- 반려 시 사유 입력

### 3. Excel 발주서
- 표준 발주서 양식 자동 생성
- 회사 정보 및 거래처 정보 포함
- 품목별 상세 내역
- 자동 합계 계산

### 4. 입고 관리
- 부분 입고 지원
- 입고 수량 추적
- 입고 완료 자동 처리

## 📊 데이터베이스 스키마

### 주요 테이블
- `employees` - 직원 정보 및 권한
- `vendors` - 거래처 정보
- `vendor_contacts` - 거래처 담당자
- `purchase_requests` - 발주 요청
- `purchase_request_items` - 발주 품목
- `deliveries` - 입고 정보

## 🔐 권한 관리

### 사용자 역할
| 역할 | 권한 |
|------|------|
| 일반 직원 | 구매 요청 생성, 본인 요청 조회 |
| 중간관리자 | 중간 승인 권한 |
| 최종관리자 | 최종 승인 권한 |
| Lead Buyer | 발주 처리, Excel 다운로드 |
| Admin | 전체 시스템 관리 |

## 🧪 테스트

### 단위 테스트
```bash
# 발주 기능 테스트
node scripts/test-purchase.js

# Excel 다운로드 테스트
node scripts/test-excel.js

# 시스템 전체 점검
node scripts/health-check.js
```

### 개발 도구
```bash
# 코드 스타일 검사
npm run lint

# TypeScript 타입 체크
npx tsc --noEmit

# 프로덕션 빌드
npm run build
```

## 📝 API 문서

### 주요 API 엔드포인트

#### 직원 관리
- `GET /api/employee` - 직원 목록 조회
- `GET /api/employee/[id]` - 직원 상세 조회
- `POST /api/employee` - 직원 등록
- `PUT /api/employee/[id]` - 직원 정보 수정

#### 발주 관리
- `GET /api/purchase` - 발주 목록 조회
- `POST /api/purchase` - 발주 생성
- `POST /api/purchase/[id]/approve` - 발주 승인
- `GET /api/excel/download/[orderNumber]` - Excel 다운로드

#### 승인 관리
- `POST /api/approval` - 개별 승인 처리
- `POST /api/approval/batch` - 일괄 승인 처리

## 🚀 배포

### Vercel 배포
```bash
# Vercel CLI 설치
npm i -g vercel

# 배포
vercel
```

### Docker 배포
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY . .
RUN npm ci --only=production
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

## 🛠️ 환경 설정

### 개발 환경
- **Framework**: Next.js 15.5.0
- **Language**: TypeScript 5.9
- **Styling**: Tailwind CSS 3.4
- **UI Components**: shadcn/ui
- **Database**: Supabase (PostgreSQL)
- **State Management**: React Hook Form
- **Excel**: ExcelJS

### 프로덕션 최적화
- React Strict Mode 활성화
- SWC 미니파이어 사용
- 이미지 최적화
- Server Actions 활성화

## 🤝 기여하기

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 라이선스

이 프로젝트는 비공개 소프트웨어입니다. 무단 사용 및 배포를 금지합니다.

## 👥 팀

- **개발**: HANSL IT Team
- **기획**: HANSL Purchase Team
- **디자인**: HANSL UX Team

## 📞 지원

문제가 발생하거나 도움이 필요한 경우:
- 이메일: support@hansl.com

---

© 2025 HANSL. All rights reserved.