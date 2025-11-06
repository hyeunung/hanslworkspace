# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure Overview

This workspace contains three main projects:

1. **hansl/** - Flutter mobile app for attendance management (Korean company HANSL)
2. **hanslwebapp/** - Next.js web application for purchase management system
3. **servers-main/** - Model Context Protocol (MCP) servers collection

## Common Development Commands

### Flutter App (hansl/)
```bash
cd hansl
flutter pub get                    # Install dependencies
flutter run                       # Run on connected device/emulator
flutter build apk --release       # Build release APK
flutter test                      # Run tests
```

### Next.js Web App (hanslwebapp/)
```bash
cd hanslwebapp
npm install                       # Install dependencies
npm run dev                       # Start development server (localhost:3000)
npm run build                     # Build for production
npm run start                     # Start production server
npm run lint                      # Run ESLint
```

### MCP Servers (servers-main/)
```bash
cd servers-main
npm install                       # Install dependencies for all workspaces
npm run build                     # Build all servers
npm run watch                     # Watch mode for all servers
```

## Architecture Overview

### HANSL Flutter App Architecture
- **MVC + Provider Pattern**: Uses Provider for state management
- **Services Layer**: Handles external APIs (Supabase, Firebase)
- **Key Integrations**: 
  - Supabase (backend database)
  - Firebase (push notifications)
  - Location services for attendance tracking
- **Multi-platform**: Android, iOS, Web, Windows, macOS support

### HANSL Web App Architecture
- **Next.js 15 with App Router**: Modern React framework
- **Shadcn/ui Components**: Radix UI-based component library
- **Supabase Integration**: Database and authentication
- **Excel Generation**: ExcelJS for purchase order documents

### Key Data Flow
1. **Flutter App**: Employee attendance tracking → Supabase
2. **Web App**: Purchase requests/approvals → Supabase
3. **Supabase Functions**: Handle business logic and integrations

## Typography System (MANDATORY USAGE)

### Standardized CSS Classes
**IMPORTANT**: ALL new components MUST use these standardized text classes instead of inline Tailwind text styling.

#### Dashboard Card Typography
- `.card-title` - Main card titles (font-medium, 11px, truncated)
- `.card-subtitle` - Secondary info (10px, gray-600, truncated)
- `.card-description` - Item descriptions (10px, gray-500, truncated) 
- `.card-amount` - Monetary amounts (10px, font-semibold, truncated)
- `.card-date` - Dates and timestamps (10px, gray-500, truncated)
- `.card-status` - Status indicators (10px, font-medium, truncated)

#### Modal Typography (Consistent with Cards)
- `.modal-title` - Main modal titles (14px, font-bold, truncated)
- `.modal-subtitle` - Secondary modal info (11px, font-medium, truncated)
- `.modal-section-title` - Section headers (12px, font-bold, truncated)
- `.modal-label` - Field labels (10px, font-semibold, gray-500, truncated)
- `.modal-value` - Field values (11px, font-bold, truncated)
- `.modal-value-large` - Large values/totals (12px, font-bold, truncated)

#### General Typography (Consistent Sizing)
- `.badge-text` - Badge content (xs/12px, font-medium, truncated)
- `.button-text` - Button content (xs/12px, font-medium, gray-700, truncated)
- `.button-text-primary` - Primary button content (xs/12px, font-medium, white, truncated)
- `.button-text-secondary` - Secondary button content (xs/12px, font-medium, gray-600, truncated)
- `.section-title` - Section headers (11px, font-semibold, truncated)
- `.stats-title` - Statistics titles (xs/12px, uppercase, tracking-wide)
- `.stats-value` - Statistics values (3xl, font-bold) - *Only large stats*
- `.header-title` - Main headers (12px, font-bold, truncated)
- `.link-text` - Link text (10px, truncated)

#### Standardized Button System (MANDATORY FOR ALL BUTTONS)
**CRITICAL**: ALL buttons in the application MUST use the `.button-base` class from globals.css

### Core Button Class (MANDATORY)
**ALL buttons must use the `.button-base` class:**
```tsx
// ✅ CORRECT - Always use button-base class
<Button className="button-base bg-blue-500 text-white">저장</Button>
<Button className="button-base border border-gray-300 text-gray-600 bg-white">취소</Button>

// ❌ WRONG - Never use custom sizing
<Button className="px-4 py-2 text-sm">저장</Button>
<Button className="h-8 px-3 text-xs">취소</Button>
```

### Button-Base Specifications
The `.button-base` class provides standardized sizing:
- **padding**: 2px 10px !important
- **font-size**: 12px !important  
- **font-weight**: 500 !important
- **border-radius**: business-radius-badge (8px)
- **height**: auto !important
- **line-height**: leading-tight
- **white-space**: nowrap !important

### Standard Button Types

#### 1. Action Buttons (Primary Actions)
```tsx
// Primary actions (save, submit, confirm)
<Button className="button-base bg-blue-500 hover:bg-blue-600 text-white">저장</Button>
<Button className="button-base bg-green-500 hover:bg-green-600 text-white">승인</Button>
<Button className="button-base bg-hansl-600 hover:bg-hansl-700 text-white">발주요청</Button>
```

#### 2. Secondary Buttons (Cancel, Delete)
```tsx
// Cancel and secondary actions
<Button className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">취소</Button>
<Button className="button-base border border-red-200 bg-white text-red-600 hover:bg-red-50">삭제</Button>
```

#### 3. Approval Workflow Buttons (3-State System)
**Based on 1차 승인대기 button as default active waiting state**

**3-State Button System:**
1. **대기중 (Active Waiting)** - User can take action
   - **Style**: `button-base border border-gray-300 text-gray-600 bg-white`
   - **Usage**: When user can actually perform the approval action

2. **완료 (Completed)** - Action already finished
   - **Style**: `button-base bg-green-500 text-white` (approved)
   - **Style**: `button-base bg-red-500 text-white` (rejected)
   - **Usage**: When approval/rejection is already completed

3. **비활성화 (Inactive/Disabled)** - Waiting but not ready
   - **Style**: `button-base border border-gray-300 text-gray-400 bg-white`
   - **Difference**: Uses `text-gray-400` (lighter) instead of `text-gray-600`
   - **Usage**: When waiting but prerequisites not met (e.g., 최종승인 waiting for 1차승인)

### Usage Examples
```tsx
// ✅ CORRECT - All buttons use button-base
<Button className="button-base bg-blue-500 hover:bg-blue-600 text-white">
  <Save className="w-4 h-4 mr-2" />
  저장
</Button>

<Button className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
  취소
</Button>

<Button className="button-base bg-green-500 text-white" disabled={!canApprove}>
  승인
</Button>

// ❌ WRONG - Custom sizing, missing button-base
<Button className="px-4 py-2 text-sm bg-blue-500 text-white">저장</Button>
<Button className="h-8 px-3 text-xs border">취소</Button>
```

**Mandatory Usage Rules:**
- **ALL buttons MUST use `.button-base` class** - No exceptions
- **NO custom padding, font-size, or height** - button-base handles all sizing
- **Consistent sizing across entire application** - 12px font, 2px-10px padding
- **Apply color/background styling AFTER button-base** - `button-base bg-blue-500 text-white`
- **Icons remain standard size** - Use `w-4 h-4` for button icons

#### Standardized Badge System (Button-Consistent Sizing)
**Same dimensions as buttons (px-2.5 py-0.5, business-radius-badge) for visual consistency**

**Badge Base Structure:**
```tsx
// Use this base class for all badges
const badgeBaseClass = 'inline-flex items-center gap-1 business-radius-badge px-2.5 py-0.5 badge-text leading-tight'
```

**Standard Badge Classes:**
- `.badge-base` - Base badge class (same size as buttons)
- `.badge-primary` - Blue background (구매요청 등)
- `.badge-success` - Green background (발주 등)  
- `.badge-warning` - Yellow background (승인대기 등)
- `.badge-danger` - Red background (반려 등)
- `.badge-secondary` - Gray background (현장결제 등)

**Key Features:**
- **Same height as buttons**: Consistent `px-2.5 py-0.5` padding
- **Same border radius**: `business-radius-badge` 
- **Same text size**: `badge-text` (12px, font-medium)
- **Visual harmony**: Badges and buttons have identical dimensions

#### Statistics Badge System (Tab Buttons & Counters)
**Smaller badges for tab buttons, statistics counters, and compact UI elements**

**Statistics Badge Base Structure:**
```tsx
// Use this base class for all statistics badges
const badgeStatsClass = 'inline-flex items-center gap-0.5 business-radius-badge px-1.5 py-0.5 text-[10px] font-medium leading-tight'
```

**Statistics Badge Classes:**
- `.badge-stats` - Base statistics badge class (10px text, compact padding)
- `.badge-stats-primary` - Blue statistics badge (bg-blue-50 text-blue-700)
- `.badge-stats-secondary` - Gray statistics badge (bg-gray-100 text-gray-600)
- `.badge-stats-active` - Active tab badge (bg-hansl-50 text-hansl-700)

**Usage Guidelines:**
- **Tab Buttons**: Use `badge-stats-active` for active tab, `badge-stats-secondary` for inactive
- **Statistics Counters**: Use `badge-stats-primary` for important counts
- **Compact Areas**: Use when standard badges are too large for the context
- **Text Size**: 10px font-medium for minimal visual weight

**Key Features:**
- **Compact size**: `px-1.5 py-0.5` padding (smaller than standard badges)
- **10px text**: Smaller than standard `badge-text` (12px)
- **Same border radius**: `business-radius-badge` for consistency
- **Minimal visual weight**: Perfect for tab counters and statistics

#### Page Title & Subtitle System (hanslwebapp Standard)
- `.page-title` - Main page titles (19px, font-semibold, text-foreground)
- `.page-subtitle` - Page subtitles (12.3px, font-normal, text-muted-foreground)

**Key Features**:
- All classes include `truncate` for single-line display
- **Consistent small typography scale** (10px-14px) across cards and modals
- Professional color palette with subtle differences
- Optimized for business applications with compact, readable text
- **No large text** - everything stays similar size for uniformity

## Important Development Rules (from .cursor/rules)

### Problem-Solving Process
1. **Problem Analysis**: Understand current state and issues
2. **Root Cause Reporting**: Explain why problems occurred
3. **Solution Proposal**: Present possible solutions
4. **User Confirmation**: Get approval before implementing
5. **Code Implementation**: Apply changes after approval

### Database Migrations
- **Location**: `hanslwebapp/scripts/migrations/`
- **Naming**: `YYYYMMDD[a-z]_description.sql`
- **Process**: Always use migration files, never direct DB changes
- **Purpose**: Version control, tracking, rollback capability

### Logging Guidelines (MANDATORY)
**NEVER use `console.log`, `console.error`, etc. directly in code!**

#### Use the Logger System
```typescript
import { logger } from '@/lib/logger';

// ✅ CORRECT - Use logger methods
logger.debug('디버그 메시지', { context: 'additional data' });
logger.info('정보성 메시지', { userId: '123' });
logger.warn('경고 메시지', { reason: 'potential issue' });
logger.error('에러 메시지', error, { context: 'error context' });

// ❌ WRONG - Never use console directly
console.log('디버그 메시지');  // DON'T DO THIS
console.error('에러:', error);  // DON'T DO THIS
```

#### Logger Benefits
- **Environment Aware**: Automatically shows/hides logs based on development/production
- **Structured Logging**: Consistent timestamp and context formatting
- **Production Ready**: Errors automatically formatted for external services
- **Auto-Removal**: `console.*` statements automatically removed in production builds
- **Debugging**: Rich context data with timestamps and emojis in development

#### Quick Reference
- `logger.debug()` - Development debugging (hidden in production)
- `logger.info()` - General information (hidden in production)  
- `logger.warn()` - Warnings (shown in production)
- `logger.error()` - Errors (shown in production with full context)

## Key File Locations

### Flutter App Configuration
- `pubspec.yaml` - Dependencies and app configuration
- `lib/main.dart` - App entry point with providers setup
- `lib/theme/` - Design system (colors, fonts, themes)
- `lib/services/` - External API integrations
- `assets/` - Images, icons, fonts

### Web App Configuration  
- `package.json` - Dependencies and scripts
- `src/app/` - Next.js app router pages
- `src/components/` - React components organized by feature
- `supabase/` - Database functions and migrations
- `scripts/migrations/` - SQL migration files

### Database Schema
- **Employees**: User management with roles
- **Purchase Requests**: Multi-step approval workflow
- **Attendance**: Location-tracked time management

## Testing and Quality
- Flutter: Uses `flutter_test` for widget and unit testing
- Next.js: ESLint configuration for code quality
- No specific test runner configured for web app

## Deployment Notes
- Flutter: APK building configured, Play Store ready
- Web App: Vercel-ready Next.js configuration
- Supabase: Edge functions for serverless backend logic
- Both apps share the same Supabase instance for data consistency

## Design System & Typography Guidelines

### Dashboard Card Typography System
When creating new dashboard cards or similar UI components, use these standardized CSS classes defined in `src/globals.css`:

#### Text Size Classes
- **`card-title`**: PO번호, 제목 등 (11px, font-medium, text-gray-900)
- **`card-subtitle`**: 업체명, 부제목 등 (10px, text-gray-600)
- **`card-description`**: 품목 설명, 일반 설명 등 (10px, text-gray-500)
- **`card-amount`**: 금액 표시 (10px, font-semibold, text-gray-900)
- **`card-amount-large`**: 큰 금액 표시 (10px, font-bold, text-gray-900)
- **`card-date`**: 날짜 표시 (10px, text-gray-500)
- **`card-status`**: 상태 표시 (10px, font-medium)

#### Usage Examples
```jsx
// ✅ Good - Use standardized classes
<span className="card-title">{item.purchase_order_number}</span>
<div className="card-subtitle">{item.vendor_name}</div>
<div className="card-description">{item.item_name}</div>
<div className="card-amount">₩{amount.toLocaleString()}</div>
<div className="card-date">{date.toLocaleDateString('ko-KR')}</div>

// ❌ Bad - Avoid inline text size styles
<span className="text-sm font-bold text-gray-900">{item.title}</span>
<div className="text-xs text-gray-600">{item.subtitle}</div>
```

#### Design Principles
- **Consistency**: All dashboard cards use the same text hierarchy
- **Readability**: Letter-spacing optimized for Korean/English mixed content
- **Professional**: Maintains business application aesthetics
- **Maintainability**: Central CSS management for easy updates

### UI Component Border Radius System (MANDATORY)
**IMPORTANT**: ALL new components MUST use the standardized border radius for business-like consistency.

#### Standard Border Radius Classes
- `.business-radius` - Standard business radius (rounded-lg, 8px)
- `.business-radius-small` - Small elements (rounded-md, 6px) 
- `.business-radius-card` - Cards and containers (rounded-lg, 8px)
- `.business-radius-button` - Buttons and interactive elements (rounded-lg, 8px)
- `.business-radius-modal` - Modals and overlays (rounded-lg, 8px)
- `.business-radius-input` - Form inputs and fields (rounded-lg, 8px)
- `.business-radius-badge` - Badges and status indicators (rounded-lg, 8px)

#### Usage Guidelines
```tsx
// ✅ CORRECT - Use business radius classes
<div className="business-radius-card bg-white p-4">...</div>
<Button className="business-radius-button">확인</Button>
<Badge className="business-radius-badge">발주</Badge>
<Input className="business-radius-input" />

// ❌ WRONG - Avoid inconsistent radius values
<div className="rounded-xl bg-white p-4">...</div>  // Don't use xl
<div className="rounded-2xl bg-white p-4">...</div>  // Don't use 2xl
<div className="rounded-3xl bg-white p-4">...</div>  // Don't use 3xl
```

#### Business Design Principles
- **Consistency**: All UI elements use rounded-lg (8px) for professional business appearance
- **Clean & Professional**: Avoid overly rounded elements that look consumer-facing
- **Business-Like Feel**: Maintains enterprise application aesthetics
- **Maintainability**: Central radius system for easy global updates

### Additional Design Guidelines
- Use Apple-inspired design principles: clean, minimal, professional
- Use subtle shadows and hover states for interactivity
- Maintain consistent spacing with Tailwind's spacing scale
- Follow existing color scheme for consistency

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.