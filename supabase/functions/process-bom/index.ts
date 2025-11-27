import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://deno.land/x/sheetjs@v0.18.3/xlsx.mjs'

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
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')

    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY is not set in environment variables')
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const requestData: ProcessBOMRequest = await req.json()

    console.log(`Processing BOM for board: ${requestData.boardName}`)

    // 1. DB에 보드 정보 확인/생성
    let cadDrawingId: string;
    const { data: existingBoard } = await supabase
      .from('cad_drawings')
      .select('id')
      .eq('board_name', requestData.boardName)
      .single();
      
    if (existingBoard) {
      cadDrawingId = existingBoard.id;
    } else {
      const { data: newBoard, error: boardError } = await supabase
        .from('cad_drawings')
        .insert({ board_name: requestData.boardName })
        .select('id')
        .single();
        
      if (boardError) throw boardError;
      cadDrawingId = newBoard.id;
    }

    // 2. 파일 다운로드 및 텍스트 변환
    const bomBuffer = await downloadFileContent(requestData.bomFileUrl);
    const coordBuffer = await downloadFileContent(requestData.coordinateFileUrl);

    const bomText = await convertExcelToText(bomBuffer);
    const coordText = await convertExcelToText(coordBuffer); // 좌표 파일도 엑셀일 수 있음 (TXT면 그대로 사용)

    // 3. AI 처리 (ChatGPT API 호출)
    const processedData = await processWithAI(bomText, coordText, openaiApiKey, requestData.productionQuantity);

    // 4. 결과 DB 저장
    // 4-1. BOM Items 저장
    if (processedData.bomItems && processedData.bomItems.length > 0) {
      const bomItemsToInsert = processedData.bomItems.map((item: any) => ({
        cad_drawing_id: cadDrawingId,
        line_number: item.lineNumber || 0,
        item_type: item.itemType,
        item_name: item.itemName,
        specification: item.specification,
        set_count: item.setCount,
        total_quantity: item.totalQuantity,
        ref_list: item.refList,
        remark: item.remark,
        check_status: item.checkStatus || '□양호'
      }));
      
      // 기존 데이터 삭제 후 삽입 (재처리 시 중복 방지)
      await supabase.from('bom_items').delete().eq('cad_drawing_id', cadDrawingId);
      const { error: bomError } = await supabase.from('bom_items').insert(bomItemsToInsert);
      if (bomError) console.error('BOM Insert Error:', bomError);
    }

    // 4-2. 좌표 데이터 저장
    if (processedData.coordinates && processedData.coordinates.length > 0) {
      const coordsToInsert = processedData.coordinates.map((coord: any) => ({
        cad_drawing_id: cadDrawingId,
        ref: coord.ref,
        part_name: coord.partName,
        part_type: coord.partType,
        side: coord.side,
        x_coordinate: coord.x,
        y_coordinate: coord.y,
        angle: coord.angle
      }));

      await supabase.from('part_placements').delete().eq('cad_drawing_id', cadDrawingId);
      const { error: coordError } = await supabase.from('part_placements').insert(coordsToInsert);
      if (coordError) console.error('Coordinate Insert Error:', coordError);
    }

    // 5. 로그 및 학습 데이터 저장
    await supabase.from('bom_processing_logs').insert({
      cad_drawing_id: cadDrawingId,
      artwork_manager: requestData.artworkManager,
      production_manager: requestData.productionManager,
      production_quantity: requestData.productionQuantity,
      processing_status: 'completed',
      ai_model_used: 'gpt-4o-mini',
      processing_time_ms: 0 // TODO: 시간 측정
    });

    // 학습용 데이터 저장 (AI가 잘했는지 못했는지 나중에 판단하기 위해 원본과 결과를 저장)
    await supabase.from('ai_learning_records').insert({
      cad_drawing_id: cadDrawingId,
      raw_bom_data: { content: bomText.substring(0, 5000) }, // 용량 제한 고려
      raw_coordinate_data: { content: coordText.substring(0, 5000) },
      processed_bom_data: processedData.bomItems,
      processed_coordinate_data: processedData.coordinates,
      cad_program_type: 'unknown' // 나중에 AI가 판단하게 할 수 있음
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        cadDrawingId,
        processedData
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Error processing BOM:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function downloadFileContent(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download file: ${response.statusText}`);
  return await response.arrayBuffer();
}

async function convertExcelToText(buffer: ArrayBuffer): Promise<string> {
  try {
    // 텍스트 파일인지 먼저 확인 (매직 넘버 체크 등은 생략하고 간단히)
    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(buffer);
    // 엑셀 파일은 바이너리라 텍스트로 읽으면 깨짐. 앞부분에 PK... (Zip 헤더)가 있으면 엑셀로 간주
    if (text.startsWith('PK')) {
      const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      return XLSX.utils.sheet_to_csv(firstSheet);
    }
    return text; // 이미 텍스트 파일이면 그대로 반환
  } catch (e) {
    console.warn('Excel conversion failed, treating as text', e);
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(buffer);
  }
}

async function processWithAI(bomText: string, coordText: string, apiKey: string, productionQuantity: number): Promise<any> {
  const prompt = `
You are a BOM(Bill of Materials) processing expert.
Analyze the provided raw BOM data and Coordinate data to create a structured JSON output.

RULES:
1. Group items by 'Part Name' (Value/Comment).
2. Collect 'Ref' (Designator) for each group into a list (e.g., ["R1", "R2"]).
3. 'setCount' is the number of Refs in the group.
4. 'totalQuantity' = setCount * ${productionQuantity}.
5. If Part Name contains "_OPEN" or "DNM", set 'remark' to "미삽" (Not Mounted).
6. Extract X, Y coordinates from the Coordinate data matching the Refs.

INPUT BOM:
${bomText.substring(0, 10000)} 

INPUT COORDINATE:
${coordText.substring(0, 10000)}

OUTPUT JSON FORMAT:
{
  "bomItems": [
    {
      "lineNumber": 1,
      "itemType": "SMD",
      "itemName": "10k",
      "specification": "0603",
      "setCount": 2,
      "totalQuantity": 200,
      "refList": ["R1", "R2"],
      "remark": "",
      "checkStatus": "□양호"
    }
  ],
  "coordinates": [
    {
      "ref": "R1",
      "partName": "10k",
      "x": 10.5,
      "y": 20.3,
      "side": "TOP",
      "angle": 90
    }
  ]
}
Respond ONLY with the JSON string.
`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that outputs JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    })
  });

  const result = await response.json();
  if (result.error) throw new Error(result.error.message);
  
  return JSON.parse(result.choices[0].message.content);
}
