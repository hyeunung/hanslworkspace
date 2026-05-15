// @ts-ignore - Deno runtime imports
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

interface ColumnClassifyRequest {
  rows: (string | number | null)[][];  // 상위 N행 데이터
  fileName?: string;                    // 파일명 (참고용)
}

interface ColumnClassifyResponse {
  headerRow: number;
  colMap: {
    item: number;
    ref: number;
    qty: number;
    part: number;
    comment: number;
    description: number;
    footprint: number;
  };
  confidence: number;
  reasoning?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }

    const { rows, fileName } = (await req.json()) as ColumnClassifyRequest;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      throw new Error("rows 데이터가 필요합니다.");
    }

    // 상위 30행만 사용 (충분한 샘플)
    const sampleRows = rows.slice(0, 30);

    const prompt = `You are a BOM (Bill of Materials) file structure analyzer for PCB/electronics manufacturing.

Given the following spreadsheet rows from a BOM file, determine:
1. Which row is the header row (0-indexed)
2. Which column index maps to each field

The target fields are:
- **item**: Line number / item number (sequential numbers like 1, 2, 3...). Set to -1 if not present.
- **ref**: Reference designators (e.g., R1, C2, U3, J1 or comma-separated lists like "R1,R2,R3" or "C12,C26,C34,..."). This is REQUIRED.
- **qty**: Quantity (numeric count of components). This is REQUIRED.
- **part**: Part name/value/comment (e.g., "0.1uF/16V/1005", "10k", "1N4148WS", "MAX3373"). This describes WHAT the component is.
- **comment**: Comment field (sometimes contains the part value instead of the "part" column). Set to -1 if not present.
- **description**: Description field (longer text describing the component). Set to -1 if not present.
- **footprint**: PCB footprint/package (e.g., "R1005", "C1608", "SOT-23", "SOIC-8", "QFP-48"). This describes the PHYSICAL PACKAGE. Set to -1 if not present.

IMPORTANT RULES:
- Look at the DATA patterns, not just header names. Headers can be misleading (e.g., "Comment" column might contain part values).
- A column with values like "R74,R76,R79,R97" or "C12,C26,C34" is ALWAYS the ref column.
- A column with values like "0.1uF/16V/1005", "10k/1005", "1N4148WS" is the part/value column.
- A column with values like "R1005", "C1608", "SOT-23" is the footprint column.
- A column with sequential integers (1, 2, 3...) is the item column.
- Skip empty rows, title rows, and separator rows (like "____") when finding the header.
- The header row is the row that best describes the data columns, even if the labels are non-standard.
- If no clear header row exists, set headerRow to the row just before the first data row (or -1 if data starts at row 0).

${fileName ? `File name: ${fileName}` : ""}

Spreadsheet data (row index: [cell values]):
${sampleRows.map((row, i) => `Row ${i}: ${JSON.stringify(row)}`).join("\n")}

Respond with ONLY valid JSON, no markdown or explanation:
{
  "headerRow": <number>,
  "colMap": {
    "item": <number or -1>,
    "ref": <number>,
    "qty": <number>,
    "part": <number>,
    "comment": <number or -1>,
    "description": <number or -1>,
    "footprint": <number or -1>
  },
  "confidence": <0.0-1.0>,
  "reasoning": "<brief one-line explanation>"
}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Anthropic API Error: ${errorData.error?.message || response.statusText}`);
    }

    const result = await response.json();
    const content = result.content?.[0]?.text || "";

    // JSON 파싱 (마크다운 코드블록 제거)
    const jsonStr = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed: ColumnClassifyResponse = JSON.parse(jsonStr);

    // 기본 검증: ref와 qty는 필수
    if (parsed.colMap.ref < 0 || parsed.colMap.qty < 0) {
      throw new Error("AI가 ref 또는 qty 컬럼을 찾지 못했습니다.");
    }

    // 후처리 검증: 헤더 row가 한 칸 어긋난 케이스 + part/description 컬럼 혼동 케이스 보정
    const HEADER_KEYWORDS = new Set([
      "description", "desc", "descriptions",
      "part", "part number", "part name", "part no", "part_no", "p/n", "pn", "part#",
      "qty", "quantity", "q'ty", "amount", "count",
      "ref", "ref des", "ref.des", "reference", "designator", "designators", "ref designator",
      "value", "comment", "footprint", "package", "fp",
      "item", "no.", "no", "line", "line no", "#", "manufacturer", "mfr", "supplier",
    ]);
    const isHeaderToken = (v: unknown) => {
      if (v === null || v === undefined) return false;
      const s = String(v).trim().toLowerCase();
      if (!s || s.length > 30) return false;
      return HEADER_KEYWORDS.has(s);
    };

    const totalRows = sampleRows.length;
    const startRow = Math.max(0, parsed.headerRow + 1);

    // 1) 헤더 row 보정: 데이터로 잡힌 첫 row가 헤더 키워드 비율이 높으면 한 칸 미뤘다고 판단
    if (startRow < totalRows) {
      const firstDataRow = sampleRows[startRow] ?? [];
      const cells = firstDataRow.filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
      if (cells.length >= 2) {
        const headerHits = cells.filter(isHeaderToken).length;
        if (headerHits / cells.length >= 0.5) {
          parsed.headerRow = startRow;
        }
      }
    }

    // 2) "부품번호다움(part-likeness)" 점수로 후보 컬럼들을 평가해서 가장 점수 높은 것을 part 로 재배정.
    //    사람이 부품번호를 시각적으로 알아보는 패턴을 코드로 구현:
    //    - 짧음 (5~30자), 공백 거의 없음, 영숫자 위주, 대문자 비율 높음,
    //    - 부품번호 특유의 구분자(-, _, /, +, .) 자주 등장
    //    - 영문 단어 사전 토큰(설명문)이면 감점
    const collectColumnValues = (colIdx: number): string[] => {
      if (colIdx < 0) return [];
      const out: string[] = [];
      for (let r = Math.max(0, parsed.headerRow + 1); r < totalRows; r++) {
        const cell = sampleRows[r]?.[colIdx];
        if (cell !== null && cell !== undefined) {
          const s = String(cell).trim();
          if (s) out.push(s);
        }
      }
      return out;
    };

    // 흔한 설명문 stop word (있으면 part가 아니라 description일 가능성 높음)
    const DESCRIPTION_HINT_WORDS = new Set([
      "the","a","an","of","for","with","and","or","to","in","on","by","is","as",
      "device","driver","controller","module","sensor","interface","amplifier",
      "regulator","converter","buck","boost","oscillator","crystal","resistor",
      "capacitor","inductor","transistor","diode","mosfet","gate","memory",
      "voltage","current","frequency","temperature","precision","low","high",
      "single","dual","quad","output","input","channel","green","rohs",
    ]);

    const scorePartLikeness = (values: string[]): number => {
      if (values.length < 3) return -Infinity;
      let score = 0;
      let totalChars = 0;
      let alnumChars = 0;
      let upperChars = 0;
      let alphaChars = 0;
      let spaceVals = 0;
      let descWordHits = 0;
      let tooLongCount = 0;
      let tooShortCount = 0;
      let hasPartSeparator = 0; // -, _, /, +, . 같은 부품번호 흔한 구분자

      for (const v of values) {
        if (/\s/.test(v)) spaceVals++;
        if (v.length > 35) tooLongCount++;
        if (v.length < 3) tooShortCount++;
        if (/[-_/+.]/.test(v)) hasPartSeparator++;

        for (const ch of v) {
          totalChars++;
          if (/[a-zA-Z0-9]/.test(ch)) alnumChars++;
          if (/[a-zA-Z]/.test(ch)) {
            alphaChars++;
            if (ch >= "A" && ch <= "Z") upperChars++;
          }
        }

        // 영문 토큰(설명문) 감지
        const words = v.toLowerCase().split(/[\s,;]+/).filter(Boolean);
        for (const w of words) {
          if (DESCRIPTION_HINT_WORDS.has(w)) descWordHits++;
        }
      }

      const n = values.length;
      const spaceRatio = spaceVals / n;
      const alnumRatio = totalChars ? alnumChars / totalChars : 0;
      const upperRatio = alphaChars ? upperChars / alphaChars : 0;
      const sepRatio = hasPartSeparator / n;
      const avgLen = totalChars / n;

      // 가점
      if (avgLen >= 5 && avgLen <= 25) score += 30;
      else if (avgLen <= 35) score += 10;
      score += alnumRatio * 30;        // 영숫자 비율 높을수록 가점
      score += upperRatio * 20;        // 대문자 비율 높을수록 가점
      score += sepRatio * 15;          // 구분자 자주 등장 가점

      // 감점
      score -= spaceRatio * 50;        // 공백 비율 높을수록 강한 감점 (설명문 특성)
      score -= (descWordHits / n) * 25; // 설명문 stop word 감점
      score -= (tooLongCount / n) * 30; // 35자 초과 행 비율
      score -= (tooShortCount / n) * 10;

      return score;
    };

    const candidates: { key: "part" | "comment" | "description"; idx: number }[] = [
      { key: "part", idx: parsed.colMap.part },
      { key: "comment", idx: parsed.colMap.comment },
      { key: "description", idx: parsed.colMap.description },
    ].filter((c) => c.idx >= 0);

    if (candidates.length >= 2) {
      const scored = candidates.map((c) => ({
        ...c,
        score: scorePartLikeness(collectColumnValues(c.idx)),
      }));
      // 가장 part-like 한 컬럼 찾기
      scored.sort((a, b) => b.score - a.score);
      const winner = scored[0];
      const currentPartIdx = parsed.colMap.part;

      // AI가 고른 part 가 winner 와 다르면 재배정
      if (winner.idx !== currentPartIdx && winner.score > -Infinity) {
        // winner 컬럼이 원래 어디에 매핑돼 있던가에 따라 swap 처리
        if (winner.key === "description") {
          parsed.colMap.description = currentPartIdx;
          parsed.colMap.part = winner.idx;
        } else if (winner.key === "comment") {
          parsed.colMap.comment = currentPartIdx;
          parsed.colMap.part = winner.idx;
        }
      }
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("bom-column-classifier error:", message);

    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
