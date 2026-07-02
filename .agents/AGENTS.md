# HANSL Workspace Project Design Guidelines

When talking about, modifying, or creating UI components and styles in the HANSL Workspace application, ALWAYS adhere to the following project-scoped CSS design class rules defined in `src/globals.css`. Do NOT write ad-hoc inline styles or duplicate custom tailwind paddings/radii when these predefined classes can be used.

## 1. Border Radius Consistency (둥글기 규격)
Always use the standardized business border radius classes to maintain UI consistency across the entire app:
- Use `.business-radius`, `.business-radius-card`, `.business-radius-modal`, or `.business-radius-input` for standard elements (which map to `8px` or `rounded-lg`).
- Use `.business-radius-small` for small inline input elements (which maps to `6px` or `rounded-md`).
- Use `.business-radius-badge` for badges (which maps to `8px` with `!important` rounding).

## 2. Standardized Badges (공통 배지)
Always use the base badge class `.badge-base` and its color variants instead of building custom colored elements:
- `.badge-primary` (Blue)
- `.badge-success` (Green)
- `.badge-warning` (Orange)
- `.badge-danger` (Red)
- `.badge-secondary` (Gray)
- For statistics counts, tab badges, and small badges, use `.badge-stats` and its variants (e.g., `.badge-stats-primary`, `.badge-stats-secondary`, `.badge-stats-active`).

## 3. Standardized Buttons (공통 버튼)
Always use the base button class `.button-base` for consistent sizing, padding, and font metrics:
- **Approval Status Buttons**: Use `.button-waiting-active` (Default), `.button-approved` (Completed), `.button-rejected` (Rejected), `.button-waiting-inactive` (Disabled).
- **Action Buttons**: Use `.button-action-primary` (Blue), `.button-action-secondary` (Gray/White), `.button-action-danger` (Red/White).
- **Toggle State Buttons**: Use `.button-toggle-active` (Active filter), `.button-toggle-inactive` (Inactive filter), `.button-toggle-success` (Success filter).

## 4. Typography & Layout (텍스트 및 헤더 규격)
Always use the typography utility classes to keep headings and details aligned:
- Use `.page-title` for main page headers (19px semi-bold) and `.page-subtitle` for subheadings (12.3px muted).
- Use `.header-title` for table headers (12px bold, 0.01em tracking) and `.header-subtitle` for header subtext (10px gray, 0.02em tracking).
- Use `.section-title` for section divisions in forms/modals (11px semibold).

## 5. Compact Modal & Input Layout (컴팩트 모달 및 인풋 레이아웃 규격)
모달 창 내에서 여러 명의 담당자를 편집하거나 조밀한 그리드를 제공할 때는 다음의 컴팩트 레이아웃 규칙을 적용합니다:

### 1) 모달 너비 자동화 및 유동성 (Auto-fit Dialog Width)
* 모달의 가로폭을 고정 크기(`sm:max-w-2xl` 등)로 제한하지 않고, 표나 입력 폼의 내용에 맞춰 동적으로 확장/수축하도록 설정합니다.
* `<DialogContent>` 컴포넌트에 `maxWidth="none"`, `style={{ width: 'fit-content', maxWidth: '95vw' }}`를 명시하여 모달 프레임이 안쪽 콘텐츠 너비에 밀착(hug)하도록 구현합니다.
* 테이블(`<table>`)은 `w-full` 대신 **`w-auto`** (또는 `w-max`)를 주어 빈 공간이 비정상적으로 벌어지지 않도록 제어합니다.

### 2) 컴팩트 인풋 크기 일치 (`compact-inputs`)
* 입력 필드(input, select)의 높이는 지침 버튼 클래스(`.button-base`)의 렌더링 높이인 **`20px`**로 완벽하게 일치시킵니다.
* 모달 외곽인 `<DialogContent>`에 `.compact-modal`을 걸면 모달 가로폭이 `32rem(512px)`로 묶여 버리는 부작용이 생기므로, 너비 제약이 없는 **`.compact-inputs`** 클래스를 모달 내부 최상위 래퍼 `div`에 선언하여 하위 입력창들만 높이 `20px`로 일괄 적용받도록 합니다.
* 높이가 20px로 작아짐에 따라 글씨 폰트는 `11px`, 안쪽 상하 여백은 `padding-top/bottom: 1px !important`로 맞춰 글자 짤림을 방지합니다.

### 3) 가로폭 밀착 및 정렬 (Content-Fit Width & Align)
* 테이블 내부 인풋들은 가로폭(`width`)을 `w-full`로 통일하는 대신, 입력된 문자 길이에 맞추어 동적으로 픽셀(`px`) 계산되도록 스타일을 주입합니다. (예: `newContact.contact_name` 상태값의 글자 수에 비례하여 가로폭 실시간 재계산)
* 테이블 컬럼 간의 무의미한 여백을 방지하고 "삭제" 버튼 컬럼을 데이터 바로 옆에 붙이기 위해, 너비 우선권을 주지 않을 컬럼들(업체, 이름, 직함 등)의 `<th>` 헤더에 **`w-[1%]`** 클래스를 적용해 컬럼들이 인풋 너비에 밀착되도록 수축시키고, 나머지 잔여 공간을 이메일 등 긴 컬럼이 자연스럽게 흡수하도록 구성합니다.
* 텍스트 라벨이 있는 인풋 옆에 나란히 배치되는 추가/삭제 버튼 등은 부모 flex/grid 레이아웃 상에서 **`items-end`** 또는 **`self-end`** 정렬을 주어 버튼과 인풋의 바닥 라인이 일치하도록 수평 수평선을 맞춰줍니다.

