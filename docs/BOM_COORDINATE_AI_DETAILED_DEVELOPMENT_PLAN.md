# 🛠️ BOM/좌표 정리 AI 시스템 상세 개발 계획서

## 📋 목차
1. [프로젝트 구조](#1-프로젝트-구조)
2. [Phase별 상세 작업](#2-phase별-상세-작업)
3. [파일 구조 및 코드 예시](#3-파일-구조-및-코드-예시)
4. [API 엔드포인트 설계](#4-api-엔드포인트-설계)
5. [데이터베이스 마이그레이션](#5-데이터베이스-마이그레이션)
6. [구현 순서 및 일정](#6-구현-순서-및-일정)

---

## 1. 프로젝트 구조

### 1.1 전체 디렉토리 구조
```
hanslworkspace/
├── src/
│   ├── components/
│   │   ├── bom-coordinate/          ← 새로 생성
│   │   │   ├── BomCoordinateMain.tsx
│   │   │   ├── BomUploadSection.tsx
│   │   │   ├── BomPreviewPanel.tsx
│   │   │   ├── CoordinatePreviewPanel.tsx
│   │   │   ├── GeneratedPreviewPanel.tsx
│   │   │   └── BomMetadataForm.tsx
│   │   └── purchase/
│   │       └── PurchaseNewMain.tsx  ← 수정 (보드명 드롭다운 추가)
│   ├── utils/
│   │   ├── bom-parser.ts            ← 새로 생성
│   │   ├── coordinate-parser.ts     ← 새로 생성
│   │   └── excel-generator.ts      ← 새로 생성
│   └── types/
│       └── bom.ts                   ← 새로 생성
├── supabase/
│   ├── functions/
│   │   └── process-bom/            ← 새로 생성
│   │       ├── index.ts
│   │       └── deno.json
│   └── migrations/
│       └── YYYYMMDD_bom_tables.sql ← 새로 생성
└── scripts/
    ├── analyze-bom-files.js         ← 수정 (학습 데이터 분석)
    └── generate-training-data.js    ← 수정
```

---

## 2. Phase별 상세 작업

### Phase 0: 사전 학습 데이터 준비 ✅ (진행 중)

#### 작업 1: BOM 파일 내용 분석 스크립트
**파일**: `scripts/analyze-bom-content.js`

```javascript
// 목적: 113개 세트의 BOM/좌표 파일 내용 분석
// 출력: 각 파일의 구조, 헤더 위치, 데이터 형식

import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';

async function analyzeBOMContent() {
  const trainingSets = JSON.parse(
    await fs.readFile('./scripts/complete-training-sets.json', 'utf-8')
  );
  
  const analysisResults = [];
  
  for (const set of trainingSets) {
    const bomPath = path.join('./sample-data/24_25_SOCKET', set.year, set.boardName, set.bom);
    const coordPath = path.join('./sample-data/24_25_SOCKET', set.year, set.boardName, set.coordinate);
    const cleanedPath = path.join('./sample-data/24_25_SOCKET', set.year, set.boardName, set.cleaned);
    
    // BOM 파일 분석
    const bomAnalysis = await analyzeExcelFile(bomPath);
    // 좌표 파일 분석
    const coordAnalysis = await analyzeCoordinateFile(coordPath);
    // 정리된 파일 분석 (정답)
    const cleanedAnalysis = await analyzeExcelFile(cleanedPath);
    
    analysisResults.push({
      boardName: set.boardName,
      bom: bomAnalysis,
      coordinate: coordAnalysis,
      cleaned: cleanedAnalysis
    });
  }
  
  await fs.writeFile(
    './scripts/bom-analysis-results.json',
    JSON.stringify(analysisResults, null, 2)
  );
}
```

#### 작업 2: 패턴 분류
- **3종류 CAD 프로그램 패턴 식별**
- 각 패턴별 헤더 위치, 컬럼 매핑 추출
- `bom_pattern_library` 테이블에 저장할 데이터 준비

---

### Phase 1: 데이터베이스 스키마 구축

#### 작업 1: Supabase 마이그레이션 파일 생성
**파일**: `supabase/migrations/20250101_bom_tables.sql`

```sql
-- 1. cad_drawings 테이블
CREATE TABLE IF NOT EXISTS cad_drawings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_cad_drawings_board_name ON cad_drawings(board_name);

-- 2. bom_raw_files 테이블
CREATE TABLE IF NOT EXISTS bom_raw_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_drawing_id UUID REFERENCES cad_drawings(id) ON DELETE CASCADE,
  bom_file_url TEXT NOT NULL,
  coordinate_file_url TEXT NOT NULL,
  bom_file_name TEXT NOT NULL,
  coordinate_file_name TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_bom_raw_files_cad_drawing ON bom_raw_files(cad_drawing_id);

-- 3. bom_items 테이블
CREATE TABLE IF NOT EXISTS bom_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_drawing_id UUID REFERENCES cad_drawings(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  item_type TEXT,
  item_name TEXT NOT NULL,
  specification TEXT,
  set_count INTEGER NOT NULL,
  total_quantity INTEGER,
  stock_quantity INTEGER,
  check_status TEXT,
  ref_list TEXT[],
  alternative_item TEXT,
  remark TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_bom_items_cad_drawing ON bom_items(cad_drawing_id);
CREATE INDEX idx_bom_items_item_name ON bom_items(item_name);

-- 4. part_placements 테이블
CREATE TABLE IF NOT EXISTS part_placements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_drawing_id UUID REFERENCES cad_drawings(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  part_name TEXT NOT NULL,
  part_type TEXT,
  side TEXT NOT NULL CHECK (side IN ('TOP', 'BOTTOM')),
  x_coordinate NUMERIC NOT NULL,
  y_coordinate NUMERIC NOT NULL,
  angle NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_part_placements_cad_drawing ON part_placements(cad_drawing_id);
CREATE INDEX idx_part_placements_ref ON part_placements(ref);

-- 5. bom_processing_logs 테이블
CREATE TABLE IF NOT EXISTS bom_processing_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_drawing_id UUID REFERENCES cad_drawings(id) ON DELETE SET NULL,
  bom_raw_file_id UUID REFERENCES bom_raw_files(id) ON DELETE SET NULL,
  artwork_manager TEXT NOT NULL,
  production_manager TEXT,
  production_quantity INTEGER,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('processing', 'completed', 'failed')),
  ai_model_used TEXT,
  tokens_used INTEGER,
  processing_time_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_bom_processing_logs_status ON bom_processing_logs(processing_status);
CREATE INDEX idx_bom_processing_logs_created ON bom_processing_logs(created_at);

-- 6. ai_learning_records 테이블
CREATE TABLE IF NOT EXISTS ai_learning_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_drawing_id UUID REFERENCES cad_drawings(id) ON DELETE SET NULL,
  raw_bom_data JSONB NOT NULL,
  raw_coordinate_data JSONB NOT NULL,
  processed_bom_data JSONB NOT NULL,
  processed_coordinate_data JSONB NOT NULL,
  cad_program_type TEXT,
  user_corrections JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ai_learning_records_cad_type ON ai_learning_records(cad_program_type);

-- 7. bom_pattern_library 테이블
CREATE TABLE IF NOT EXISTS bom_pattern_library (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cad_program_type TEXT NOT NULL,
  pattern_name TEXT NOT NULL,
  header_row_index INTEGER,
  data_start_row_index INTEGER,
  column_mapping JSONB NOT NULL,
  sample_file_url TEXT,
  accuracy_score NUMERIC,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_bom_pattern_library_type ON bom_pattern_library(cad_program_type);

-- RLS (Row Level Security) 정책
ALTER TABLE cad_drawings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_raw_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_processing_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_learning_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_pattern_library ENABLE ROW LEVEL SECURITY;

-- 모든 사용자가 읽기 가능
CREATE POLICY "Anyone can read cad_drawings" ON cad_drawings FOR SELECT USING (true);
CREATE POLICY "Anyone can read bom_items" ON bom_items FOR SELECT USING (true);
CREATE POLICY "Anyone can read part_placements" ON part_placements FOR SELECT USING (true);

-- 인증된 사용자만 쓰기 가능
CREATE POLICY "Authenticated users can insert cad_drawings" ON cad_drawings FOR INSERT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert bom_items" ON bom_items FOR INSERT TO authenticated USING (true);
```

#### 작업 2: Supabase Storage 버킷 생성
```sql
-- Supabase Dashboard에서 수동 생성 또는 SQL 실행
INSERT INTO storage.buckets (id, name, public) 
VALUES ('bom-files', 'bom-files', false);

-- 버킷 정책 설정
CREATE POLICY "Users can upload BOM files" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'bom-files');
```

---

### Phase 2: 파일 업로드 & 파싱

#### 작업 1: BOM 파서 유틸리티
**파일**: `src/utils/bom-parser.ts`

```typescript
import ExcelJS from 'exceljs';

export interface BOMRawData {
  headers: string[];
  rows: Record<string, any>[];
  sheetName: string;
}

export interface BOMPattern {
  cadProgramType: string;
  headerRowIndex: number;
  dataStartRowIndex: number;
  columnMapping: {
    partName: string;
    ref: string;
    quantity?: string;
    type?: string;
    // ... 기타 필드
  };
}

/**
 * BOM 파일 파싱 (룰 기반)
 */
export async function parseBOMFile(
  file: File | ArrayBuffer,
  pattern?: BOMPattern
): Promise<BOMRawData> {
  const workbook = new ExcelJS.Workbook();
  
  if (file instanceof File) {
    const buffer = await file.arrayBuffer();
    await workbook.xlsx.load(buffer);
  } else {
    await workbook.xlsx.load(file);
  }
  
  const sheet = workbook.worksheets[0];
  const data: BOMRawData = {
    headers: [],
    rows: [],
    sheetName: sheet.name
  };
  
  // 패턴이 있으면 룰 기반 파싱
  if (pattern) {
    return parseWithPattern(sheet, pattern);
  }
  
  // 패턴이 없으면 자동 감지
  return autoDetectAndParse(sheet);
}

/**
 * 패턴 기반 파싱
 */
function parseWithPattern(sheet: ExcelJS.Worksheet, pattern: BOMPattern): BOMRawData {
  // 헤더 읽기
  const headerRow = sheet.getRow(pattern.headerRowIndex);
  const headers = headerRow.values as string[];
  
  // 데이터 읽기
  const rows: Record<string, any>[] = [];
  for (let i = pattern.dataStartRowIndex; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    if (isEmptyRow(row)) break;
    
    const rowData: Record<string, any> = {};
    Object.entries(pattern.columnMapping).forEach(([key, colName]) => {
      const colIndex = headers.indexOf(colName);
      if (colIndex >= 0) {
        rowData[key] = row.getCell(colIndex).value;
      }
    });
    rows.push(rowData);
  }
  
  return { headers, rows, sheetName: sheet.name };
}

/**
 * 자동 감지 및 파싱
 */
function autoDetectAndParse(sheet: ExcelJS.Worksheet): BOMRawData {
  // 헤더 행 찾기 (일반적으로 1-5행 중)
  let headerRowIndex = 1;
  for (let i = 1; i <= 5; i++) {
    const row = sheet.getRow(i);
    if (containsBOMHeaders(row)) {
      headerRowIndex = i;
      break;
    }
  }
  
  // 나머지 파싱 로직...
  return { headers: [], rows: [], sheetName: sheet.name };
}
```

#### 작업 2: 좌표 파서 유틸리티
**파일**: `src/utils/coordinate-parser.ts`

```typescript
export interface CoordinateRawData {
  ref: string;
  partName: string;
  x: number;
  y: number;
  angle?: number;
  side: 'TOP' | 'BOTTOM';
}

/**
 * 좌표 파일 파싱 (TXT/XLSX)
 */
export async function parseCoordinateFile(
  file: File | ArrayBuffer
): Promise<CoordinateRawData[]> {
  const fileName = file instanceof File ? file.name : '';
  
  if (fileName.endsWith('.txt')) {
    return parseTxtCoordinate(file);
  } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    return parseExcelCoordinate(file);
  }
  
  throw new Error('Unsupported coordinate file format');
}

/**
 * TXT 좌표 파일 파싱
 */
async function parseTxtCoordinate(file: File | ArrayBuffer): Promise<CoordinateRawData[]> {
  let text: string;
  
  if (file instanceof File) {
    text = await file.text();
  } else {
    const decoder = new TextDecoder('utf-8');
    text = decoder.decode(file);
  }
  
  const lines = text.split('\n');
  const coordinates: CoordinateRawData[] = [];
  
  // TXT 형식 파싱 로직 (파일마다 다를 수 있음)
  for (const line of lines) {
    if (line.trim() === '') continue;
    
    // 패턴 예시: "REF123, C1, 100.5, 200.3, 90, TOP"
    const parts = line.split(',').map(s => s.trim());
    if (parts.length >= 4) {
      coordinates.push({
        ref: parts[0],
        partName: parts[1],
        x: parseFloat(parts[2]),
        y: parseFloat(parts[3]),
        angle: parts[4] ? parseFloat(parts[4]) : undefined,
        side: parts[5] === 'BOTTOM' ? 'BOTTOM' : 'TOP'
      });
    }
  }
  
  return coordinates;
}
```

#### 작업 3: 파일 업로드 컴포넌트
**파일**: `src/components/bom-coordinate/BomUploadSection.tsx`

```typescript
import { useState, useCallback } from 'react';
import { createClient } from '@/utils/supabase';
import { toast } from 'sonner';

export default function BomUploadSection({
  onUploadComplete
}: {
  onUploadComplete: (bomFileUrl: string, coordFileUrl: string) => void;
}) {
  const [bomFile, setBomFile] = useState<File | null>(null);
  const [coordFile, setCoordFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  
  const supabase = createClient();
  
  const handleBomFileSelect = useCallback((file: File) => {
    if (!file.name.match(/\.(xlsx|xls|bom)$/i)) {
      toast.error('BOM 파일은 Excel 또는 BOM 형식이어야 합니다.');
      return;
    }
    setBomFile(file);
  }, []);
  
  const handleCoordFileSelect = useCallback((file: File) => {
    if (!file.name.match(/\.(xlsx|xls|txt)$/i)) {
      toast.error('좌표 파일은 Excel 또는 TXT 형식이어야 합니다.');
      return;
    }
    setCoordFile(file);
  }, []);
  
  const handleUpload = useCallback(async () => {
    if (!bomFile || !coordFile) {
      toast.error('BOM 파일과 좌표 파일을 모두 선택해주세요.');
      return;
    }
    
    try {
      setUploading(true);
      
      // 현재 사용자 정보
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요합니다.');
      
      // 파일명 생성
      const timestamp = Date.now();
      const bomFileName = `bom_${timestamp}_${bomFile.name}`;
      const coordFileName = `coord_${timestamp}_${coordFile.name}`;
      
      // Supabase Storage에 업로드
      const [bomResult, coordResult] = await Promise.all([
        supabase.storage
          .from('bom-files')
          .upload(`raw/${bomFileName}`, bomFile),
        supabase.storage
          .from('bom-files')
          .upload(`raw/${coordFileName}`, coordFile)
      ]);
      
      if (bomResult.error) throw bomResult.error;
      if (coordResult.error) throw coordResult.error;
      
      // Public URL 생성
      const { data: { publicUrl: bomUrl } } = supabase.storage
        .from('bom-files')
        .getPublicUrl(`raw/${bomFileName}`);
      
      const { data: { publicUrl: coordUrl } } = supabase.storage
        .from('bom-files')
        .getPublicUrl(`raw/${coordFileName}`);
      
      onUploadComplete(bomUrl, coordUrl);
      toast.success('파일 업로드 완료');
      
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('파일 업로드 실패');
    } finally {
      setUploading(false);
    }
  }, [bomFile, coordFile, supabase, onUploadComplete]);
  
  return (
    <div className="space-y-4">
      {/* BOM 파일 업로드 */}
      <div>
        <label>BOM 파일</label>
        <input
          type="file"
          accept=".xlsx,.xls,.bom"
          onChange={(e) => e.target.files?.[0] && handleBomFileSelect(e.target.files[0])}
        />
        {bomFile && <p>선택됨: {bomFile.name}</p>}
      </div>
      
      {/* 좌표 파일 업로드 */}
      <div>
        <label>좌표 파일</label>
        <input
          type="file"
          accept=".xlsx,.xls,.txt"
          onChange={(e) => e.target.files?.[0] && handleCoordFileSelect(e.target.files[0])}
        />
        {coordFile && <p>선택됨: {coordFile.name}</p>}
      </div>
      
      <button
        onClick={handleUpload}
        disabled={uploading || !bomFile || !coordFile}
      >
        {uploading ? '업로드 중...' : '업로드'}
      </button>
    </div>
  );
}
```

---

### Phase 3: AI 처리 엔진

#### 작업 1: Supabase Edge Function 생성
**파일**: `supabase/functions/process-bom/index.ts`

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ProcessBOMRequest {
  bomFileUrl: string;
  coordinateFileUrl: string;
  boardName: string;
  artworkManager: string;
  productionManager?: string;
  productionQuantity: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const requestData: ProcessBOMRequest = await req.json()
    
    const startTime = Date.now()
    
    // 1. 파일 다운로드 및 파싱
    const bomData = await downloadAndParseBOM(requestData.bomFileUrl)
    const coordData = await downloadAndParseCoordinate(requestData.coordinateFileUrl)
    
    // 2. 패턴 감지 (룰 기반 시도)
    const pattern = await detectPattern(bomData, supabase)
    
    let processedData;
    if (pattern) {
      // 룰 기반 처리
      processedData = await processWithRule(bomData, coordData, pattern)
    } else {
      // AI 기반 처리
      processedData = await processWithAI(bomData, coordData, openaiApiKey)
    }
    
    // 3. DB 저장
    const cadDrawingId = await saveToDatabase(
      requestData,
      processedData,
      supabase
    )
    
    // 4. 처리 로그 저장
    const processingTime = Date.now() - startTime
    await supabase.from('bom_processing_logs').insert({
      cad_drawing_id: cadDrawingId,
      artwork_manager: requestData.artworkManager,
      production_manager: requestData.productionManager,
      production_quantity: requestData.productionQuantity,
      processing_status: 'completed',
      ai_model_used: pattern ? 'rule-based' : 'gpt-4o-mini',
      processing_time_ms: processingTime
    })
    
    return new Response(
      JSON.stringify({ 
        success: true,
        cadDrawingId,
        processedData
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

/**
 * AI 기반 처리
 */
async function processWithAI(
  bomData: any,
  coordData: any,
  apiKey: string
): Promise<any> {
  const prompt = `다음은 CAD에서 추출된 BOM 및 Pick&Place 좌표 데이터이다.
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
BOM: ${JSON.stringify(bomData)}
좌표: ${JSON.stringify(coordData)}`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a BOM data processing expert.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    })
  })
  
  const result = await response.json()
  return JSON.parse(result.choices[0].message.content)
}
```

#### 작업 2: 프론트엔드에서 Edge Function 호출
**파일**: `src/components/bom-coordinate/BomCoordinateMain.tsx`

```typescript
const handleProcess = async () => {
  try {
    setProcessing(true)
    
    const { data, error } = await supabase.functions.invoke('process-bom', {
      body: {
        bomFileUrl: bomFileUrl,
        coordinateFileUrl: coordFileUrl,
        boardName: boardName,
        artworkManager: userEmail,
        productionManager: selectedProductionManager,
        productionQuantity: productionQuantity
      }
    })
    
    if (error) throw error
    
    setProcessedData(data.processedData)
    setCadDrawingId(data.cadDrawingId)
    toast.success('처리 완료')
    
  } catch (error) {
    console.error('Processing error:', error)
    toast.error('처리 실패')
  } finally {
    setProcessing(false)
  }
}
```

---

### Phase 4: 정리된 파일 생성

#### 작업 1: Excel 생성 유틸리티
**파일**: `src/utils/excel-generator.ts`

```typescript
import ExcelJS from 'exceljs';
import { BOMItem, CoordinateItem } from '@/types/bom';

/**
 * 정리된 BOM Excel 파일 생성
 */
export async function generateBOMExcel(
  bomItems: BOMItem[],
  coordinates: CoordinateItem[],
  templatePath?: string
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  
  // 템플릿이 있으면 로드, 없으면 새로 생성
  if (templatePath) {
    await workbook.xlsx.readFile(templatePath);
  } else {
    // 기본 템플릿 생성
    createDefaultTemplate(workbook);
  }
  
  // BOM 시트
  const bomSheet = workbook.getWorksheet('BOM') || workbook.addWorksheet('BOM');
  writeBOMSheet(bomSheet, bomItems);
  
  // TOP 좌표 시트
  const topSheet = workbook.getWorksheet('TOP') || workbook.addWorksheet('TOP');
  writeCoordinateSheet(topSheet, coordinates.filter(c => c.side === 'TOP'));
  
  // BOTTOM 좌표 시트
  const bottomSheet = workbook.getWorksheet('BOTTOM') || workbook.addWorksheet('BOTTOM');
  writeCoordinateSheet(bottomSheet, coordinates.filter(c => c.side === 'BOTTOM'));
  
  return workbook;
}

/**
 * BOM 시트 작성
 */
function writeBOMSheet(sheet: ExcelJS.Worksheet, items: BOMItem[]) {
  // 헤더 행
  sheet.getRow(1).values = [
    '번호', '종류', '품명', 'SET', '수량', '재고', 'CHECK', 'REF', '대체가능품목', '비고'
  ];
  
  // 데이터 행
  items.forEach((item, index) => {
    const row = sheet.getRow(index + 2);
    row.values = [
      item.lineNumber,
      item.itemType,
      item.itemName,
      item.setCount,
      item.totalQuantity,
      item.stockQuantity || '',
      item.checkStatus || '□양호',
      item.refList.join(', '),
      item.alternativeItem || '',
      item.remark || ''
    ];
  });
  
  // 스타일 적용
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach(column => {
    column.width = 15;
  });
}
```

---

### Phase 5: UI 구현

#### 작업 1: 메인 컴포넌트
**파일**: `src/components/bom-coordinate/BomCoordinateMain.tsx`

```typescript
import { useState } from 'react';
import BomUploadSection from './BomUploadSection';
import BomMetadataForm from './BomMetadataForm';
import BomPreviewPanel from './BomPreviewPanel';
import CoordinatePreviewPanel from './CoordinatePreviewPanel';
import GeneratedPreviewPanel from './GeneratedPreviewPanel';

export default function BomCoordinateMain() {
  const [step, setStep] = useState<'upload' | 'process' | 'preview'>('upload');
  const [bomFileUrl, setBomFileUrl] = useState<string>('');
  const [coordFileUrl, setCoordFileUrl] = useState<string>('');
  const [processedData, setProcessedData] = useState<any>(null);
  
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">BOM/좌표 정리</h1>
      
      {step === 'upload' && (
        <div className="space-y-6">
          <BomUploadSection
            onUploadComplete={(bom, coord) => {
              setBomFileUrl(bom);
              setCoordFileUrl(coord);
              setStep('process');
            }}
          />
        </div>
      )}
      
      {step === 'process' && (
        <BomMetadataForm
          onProcess={(metadata) => {
            // AI 처리 호출
            handleProcess(metadata);
            setStep('preview');
          }}
        />
      )}
      
      {step === 'preview' && processedData && (
        <div className="grid grid-cols-3 gap-4">
          <BomPreviewPanel data={processedData.originalBOM} />
          <CoordinatePreviewPanel data={processedData.originalCoordinate} />
          <GeneratedPreviewPanel
            data={processedData.processed}
            onEdit={handleEdit}
            onConfirm={handleConfirm}
          />
        </div>
      )}
    </div>
  );
}
```

#### 작업 2: 네비게이션에 메뉴 추가
**파일**: `src/components/layout/Navigation.tsx`

```typescript
// menuItems 배열에 추가
{
  label: 'BOM/좌표 정리',
  href: '/bom-coordinate',
  icon: Package,  // 또는 적절한 아이콘
  roles: ['all']
}
```

#### 작업 3: 라우트 추가
**파일**: `src/components/layout/AppRoutes.tsx`

```typescript
const BomCoordinateMain = lazy(() => import('@/components/bom-coordinate/BomCoordinateMain'))

// Routes에 추가
<Route path="/bom-coordinate" element={<BomCoordinateMain />} />
```

---

### Phase 6: 발주 요청 연동

#### 작업 1: 보드명 드롭다운 추가
**파일**: `src/components/purchase/PurchaseNewMain.tsx`

```typescript
import ReactSelect from 'react-select';
import { useState, useEffect } from 'react';

// 컴포넌트 내부
const [selectedBoard, setSelectedBoard] = useState<{ value: string; label: string } | null>(null);
const [boardOptions, setBoardOptions] = useState<Array<{ value: string; label: string }>>([]);

// 보드 목록 로드
useEffect(() => {
  const loadBoards = async () => {
    const { data } = await supabase
      .from('cad_drawings')
      .select('id, board_name')
      .order('board_name');
    
    if (data) {
      setBoardOptions(
        data.map(b => ({ value: b.id, label: b.board_name }))
      );
    }
  };
  loadBoards();
}, []);

// 보드 선택 시 품목 자동 채우기
const handleBoardSelect = async (selected: any) => {
  setSelectedBoard(selected);
  
  if (selected) {
    const { data: items } = await supabase
      .from('bom_items')
      .select('*')
      .eq('cad_drawing_id', selected.value)
      .order('line_number');
    
    if (items) {
      // purchase_request_items에 추가
      items.forEach(item => {
        append({
          line_number: items.length + 1,
          item_name: item.item_name,
          specification: item.specification,
          quantity: item.set_count * productionQuantity, // 생산수량은 별도 입력 필요
          // ... 기타 필드
        });
      });
    }
  }
};

// JSX에 추가
<div className="form-group">
  <label>보드명</label>
  <ReactSelect
    options={boardOptions}
    value={selectedBoard}
    onChange={handleBoardSelect}
    placeholder="보드명 검색..."
    isSearchable
  />
</div>
```

---

## 3. 파일 구조 및 코드 예시

### 3.1 타입 정의
**파일**: `src/types/bom.ts`

```typescript
export interface BOMItem {
  lineNumber: number;
  itemType?: string;
  itemName: string;
  specification?: string;
  setCount: number;
  totalQuantity: number;
  stockQuantity?: number;
  checkStatus?: string;
  refList: string[];
  alternativeItem?: string;
  remark?: string;
}

export interface CoordinateItem {
  ref: string;
  partName: string;
  partType?: string;
  side: 'TOP' | 'BOTTOM';
  x: number;
  y: number;
  angle?: number;
}

export interface ProcessedBOMData {
  bomItems: BOMItem[];
  coordinates: CoordinateItem[];
}
```

---

## 4. API 엔드포인트 설계

### 4.1 Supabase Edge Functions

| 함수명 | 경로 | 메서드 | 설명 |
|--------|------|--------|------|
| `process-bom` | `/functions/v1/process-bom` | POST | BOM/좌표 파일 처리 |

**Request Body:**
```json
{
  "bomFileUrl": "https://...",
  "coordinateFileUrl": "https://...",
  "boardName": "H24-001_...",
  "artworkManager": "user@example.com",
  "productionManager": "employee_id",
  "productionQuantity": 100
}
```

**Response:**
```json
{
  "success": true,
  "cadDrawingId": "uuid",
  "processedData": {
    "bomItems": [...],
    "coordinates": [...]
  }
}
```

---

## 5. 데이터베이스 마이그레이션

### 5.1 마이그레이션 실행 순서
1. Supabase Dashboard → SQL Editor 접속
2. `supabase/migrations/20250101_bom_tables.sql` 내용 복사
3. 실행
4. Storage 버킷 생성 (`bom-files`)
5. RLS 정책 확인

---

## 6. 구현 순서 및 일정

### Week 1: 기반 구축
- [ ] Day 1-2: DB 스키마 구축 (Phase 1)
- [ ] Day 3-4: 파일 파싱 유틸리티 (Phase 2)
- [ ] Day 5: 파일 업로드 컴포넌트 (Phase 2)

### Week 2: AI 엔진
- [ ] Day 1-2: Edge Function 개발 (Phase 3)
  - ⚠️ **API 키는 Day 3부터 필요하지만, 미리 준비 권장**
- [ ] Day 3: ChatGPT API 연동 (Phase 3) 🔑 **API 키 필수**
- [ ] Day 4-5: 패턴 감지 로직 (Phase 3)

### Week 3: 파일 생성 & UI
- [ ] Day 1-2: Excel 생성 유틸리티 (Phase 4)
- [ ] Day 3-4: 메인 UI 컴포넌트 (Phase 5)
- [ ] Day 5: 미리보기 패널 (Phase 5)

### Week 4: 연동 & 테스트
- [ ] Day 1-2: 발주 요청 연동 (Phase 6)
- [ ] Day 3-4: 통합 테스트
- [ ] Day 5: 버그 수정 및 최적화

---

## 7. 주요 고려사항

### 7.1 성능
- **파일 크기 제한**: BOM 파일 10MB, 좌표 파일 5MB
- **처리 시간**: Edge Function 타임아웃 60초 고려
- **배치 처리**: 대용량 파일은 청크 단위 처리

### 7.2 비용 관리
- **ChatGPT API**: GPT-4o-mini 사용 (비용 절감)
- **토큰 캐싱**: 동일 패턴 재사용 시 캐싱
- **사용량 모니터링**: `bom_processing_logs`로 추적

### 7.3 오류 처리
- **파일 형식 오류**: 명확한 에러 메시지
- **AI 처리 실패**: 재시도 로직 (최대 3회)
- **부분 실패**: 가능한 부분만 처리 후 사용자에게 알림

---

## 8. 테스트 계획

### 8.1 단위 테스트
- BOM 파서 테스트 (다양한 형식)
- 좌표 파서 테스트 (TXT/XLSX)
- Excel 생성 테스트

### 8.2 통합 테스트
- 파일 업로드 → AI 처리 → DB 저장 → Excel 다운로드 플로우
- 발주 요청 연동 테스트

### 8.3 사용자 테스트
- 실제 113개 세트 중 10개 샘플로 테스트
- 정확도 검증

---

## 9. 학습 시스템 구조 (Learning System)

### 9.1 학습 프로세스

```
┌─────────────────────────────────────────────────────────────┐
│                    학습형 AI 시스템 흐름                      │
└─────────────────────────────────────────────────────────────┘

1. 초기 학습 (Phase 0)
   └─ 113개 세트 분석 → 패턴 라이브러리 구축
   
2. 실시간 학습 (운영 중)
   └─ 새 파일 처리 → 사용자 수정 → 학습 데이터 저장
   
3. 주기적 재학습 (주간)
   └─ 누적 데이터 분석 → 패턴 업데이트 → 정확도 향상
```

### 9.2 학습 데이터 수집

#### 9.2.1 자동 수집
**파일**: `supabase/functions/process-bom/index.ts`

```typescript
// 처리 완료 후 학습 데이터 저장
async function saveLearningData(
  cadDrawingId: string,
  rawBOM: any,
  rawCoord: any,
  processedBOM: any,
  processedCoord: any,
  cadProgramType: string,
  supabase: any
) {
  await supabase.from('ai_learning_records').insert({
    cad_drawing_id: cadDrawingId,
    raw_bom_data: rawBOM,
    raw_coordinate_data: rawCoord,
    processed_bom_data: processedBOM,
    processed_coordinate_data: processedCoord,
    cad_program_type: cadProgramType
  });
}
```

#### 9.2.2 사용자 수정 반영
**파일**: `src/components/bom-coordinate/GeneratedPreviewPanel.tsx`

```typescript
const handleUserEdit = async (editedData: any) => {
  // 사용자가 수정한 내용을 학습 데이터로 저장
  await supabase.from('ai_learning_records').update({
    user_corrections: editedData,
    updated_at: new Date().toISOString()
  }).eq('cad_drawing_id', cadDrawingId);
  
  // 패턴 정확도 점수 업데이트
  await updatePatternAccuracy(cadProgramType);
};
```

### 9.3 패턴 진화 메커니즘

#### 9.3.1 패턴 감지 우선순위
1. **기존 패턴 매칭** (룰 기반) → 빠르고 정확
2. **유사 패턴 발견** → 기존 패턴 수정
3. **새 패턴 발견** → AI 처리 후 패턴 라이브러리에 추가

#### 9.3.2 정확도 점수 시스템
```typescript
// 패턴 정확도 계산
function calculateAccuracy(
  patternId: string,
  totalUses: number,
  successCount: number,
  userCorrections: number
): number {
  const successRate = successCount / totalUses;
  const correctionPenalty = userCorrections / totalUses;
  return (successRate - correctionPenalty * 0.5) * 100;
}

// 정확도가 90% 이상이면 룰 기반으로 전환
if (accuracy >= 90) {
  await supabase.from('bom_pattern_library').update({
    accuracy_score: accuracy,
    usage_count: totalUses
  }).eq('id', patternId);
}
```

### 9.4 주기적 재학습

#### 9.4.1 주간 분석 스크립트
**파일**: `scripts/weekly-learning-analysis.js`

```javascript
import { createClient } from '@supabase/supabase-js';

async function weeklyLearningAnalysis() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  // 지난 주 학습 데이터 수집
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  
  const { data: learningRecords } = await supabase
    .from('ai_learning_records')
    .select('*')
    .gte('created_at', lastWeek.toISOString());
  
  // 패턴 분석
  const patterns = analyzePatterns(learningRecords);
  
  // 패턴 라이브러리 업데이트
  for (const pattern of patterns) {
    await updatePatternLibrary(pattern, supabase);
  }
  
  // 정확도가 낮은 패턴 재학습
  const lowAccuracyPatterns = await supabase
    .from('bom_pattern_library')
    .select('*')
    .lt('accuracy_score', 80);
  
  if (lowAccuracyPatterns.data) {
    await retrainPatterns(lowAccuracyPatterns.data);
  }
}
```

### 9.5 학습 데이터 활용

#### 9.5.1 파인튜닝 데이터 생성
**파일**: `scripts/generate-finetuning-data.js`

```javascript
// 주기적으로 파인튜닝용 JSONL 생성
async function generateFinetuningData() {
  const { data: records } = await supabase
    .from('ai_learning_records')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1000); // 최근 1000개만 사용
  
  const trainingData = records.map(record => ({
    messages: [
      {
        role: 'system',
        content: 'You are a BOM data processing expert.'
      },
      {
        role: 'user',
        content: `Process this BOM data:\n${JSON.stringify(record.raw_bom_data)}`
      },
      {
        role: 'assistant',
        content: JSON.stringify(record.processed_bom_data)
      }
    ]
  }));
  
  // JSONL 형식으로 저장
  const jsonl = trainingData
    .map(data => JSON.stringify(data))
    .join('\n');
  
  await fs.writeFile('./training-data/finetuning.jsonl', jsonl);
}
```

---

## 10. ChatGPT API 키 설정

### 10.1 API 키 발급 방법

> **중요**: 코드에는 **API 키만** 필요합니다. 계정 ID/비밀번호는 코드에 넣을 필요 없습니다.

1. **OpenAI 계정 생성** (웹사이트에서 한 번만)
   - https://platform.openai.com 접속
   - 계정 생성 또는 로그인
   - **이 단계는 API 키 발급을 위한 것일 뿐, 코드에는 사용하지 않습니다**

2. **API 키 생성**
   - Dashboard → API Keys → Create new secret key
   - 키 복사 (한 번만 표시됨!)
   - **이 키만 코드에 사용합니다**

3. **사용량 확인**
   - Usage → Billing 설정
   - 월 사용량 제한 설정 권장

**요약:**
- ✅ **필요한 것**: API 키 (`sk-...`로 시작하는 문자열)
- ❌ **불필요한 것**: 계정 ID, 비밀번호, 로그인 정보

### 10.2 환경변수 설정

#### 10.2.1 로컬 개발 환경
**파일**: `.env.local` (프로젝트 루트)

```bash
# Supabase (기존)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# ChatGPT API (새로 추가)
OPENAI_API_KEY=sk-...your-api-key...
```

#### 10.2.2 Supabase Edge Function 환경변수
**Supabase Dashboard에서 설정:**

1. **Settings → Edge Functions → Secrets**
2. **새 Secret 추가:**
   - Name: `OPENAI_API_KEY`
   - Value: `sk-...your-api-key...`

또는 Supabase CLI 사용:
```bash
supabase secrets set OPENAI_API_KEY=sk-...your-api-key...
```

### 10.3 API 키 보안

#### 10.3.1 절대 하지 말아야 할 것
- ❌ 클라이언트 코드에 API 키 노출
- ❌ Git에 API 키 커밋
- ❌ 공개 저장소에 업로드

#### 10.3.2 올바른 사용
- ✅ Edge Function에서만 사용 (서버 사이드)
- ✅ 환경변수로 관리
- ✅ `.gitignore`에 `.env.local` 포함 확인

### 10.4 비용 관리

#### 10.4.1 GPT-4o-mini 사용
```typescript
// Edge Function에서
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',  // 비용 절감 모델
    messages: [...],
    temperature: 0.3,  // 일관성 향상
    max_tokens: 4000  // 토큰 제한
  })
});
```

#### 10.4.2 비용 절감 전략
1. **캐싱**: 동일 패턴 재사용 시 캐싱
2. **토큰 최적화**: 불필요한 데이터 제거
3. **배치 처리**: 여러 파일 한 번에 처리
4. **룰 기반 우선**: 패턴 매칭 시 AI 호출 안 함

#### 10.4.3 사용량 모니터링
```typescript
// 처리 로그에 토큰 사용량 저장
await supabase.from('bom_processing_logs').insert({
  // ...
  tokens_used: response.usage.total_tokens,
  ai_model_used: 'gpt-4o-mini'
});

// 주간 리포트 생성
async function generateWeeklyReport() {
  const { data } = await supabase
    .from('bom_processing_logs')
    .select('tokens_used, created_at')
    .gte('created_at', lastWeek);
  
  const totalTokens = data.reduce((sum, log) => sum + (log.tokens_used || 0), 0);
  const estimatedCost = (totalTokens / 1000) * 0.00015; // GPT-4o-mini 가격
  
  console.log(`주간 토큰 사용량: ${totalTokens}`);
  console.log(`예상 비용: $${estimatedCost.toFixed(4)}`);
}
```

---

## 11. 학습 시스템 시각화

### 11.1 학습 데이터 흐름도

```
[새 BOM 파일 업로드]
        ↓
[패턴 감지]
        ↓
    ┌───┴───┐
    │       │
[기존 패턴] [새 패턴]
    │       │
[룰 기반] [AI 처리]
    │       │
    └───┬───┘
        ↓
[처리 결과]
        ↓
[사용자 검토]
        ↓
[수정 있음?]
    ┌───┴───┐
   예      아니오
    │       │
[학습 데이터 저장] [완료]
    │
[패턴 정확도 업데이트]
    │
[정확도 90% 이상?]
    │
   예 → [룰 기반 전환]
```

### 11.2 진화 과정 예시

**Week 1:**
- 113개 세트로 초기 학습
- 3개 CAD 프로그램 패턴 식별
- 정확도: 70%

**Week 2-4:**
- 새 파일 50개 처리
- 사용자 수정 10건 반영
- 정확도: 85%

**Week 5-8:**
- 누적 데이터 200개
- 패턴 라이브러리 업데이트
- 정확도: 92% → 룰 기반 전환

**Week 9+:**
- 지속적 학습
- 새 패턴 자동 감지
- 정확도: 95%+

---

**작성일**: 2025-01-XX  
**버전**: 2.1  
**상태**: 학습 시스템 및 API 키 설정 가이드 추가 완료 ✅


