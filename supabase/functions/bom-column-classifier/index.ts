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
        model: "claude-sonnet-4-20250514",
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
