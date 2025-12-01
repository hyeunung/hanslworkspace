import * as XLSX from 'xlsx';

interface ProcessedBOMResult {
  bomItems: any[];
  coordinates: any[];
}

export async function processBOMWithAI(
  bomFile: File,
  coordFile: File,
  productionQuantity: number
): Promise<ProcessedBOMResult> {
  const bomText = await readFileAsText(bomFile);
  const coordText = await readFileAsText(coordFile);
  
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY || import.meta.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OpenAI API Key가 설정되지 않았습니다. .env 파일을 확인해주세요.');
  }

  // Fine-tuned Model에 최적화된 간결한 프롬프트
  const prompt = `
Analyze the provided BOM and Coordinate data and generate a structured TSV (Tab-Separated Values) output based on the patterns you have learned.

### INPUT DATA
**BOM Content**:
${bomText.substring(0, 25000)}

**Coordinate Content**:
${coordText.substring(0, 25000)}

### OUTPUT FORMAT
Respond ONLY with the data rows (no header, no markdown). Columns are separated by TAB.
Columns: LineNumber | ItemType | ItemName | SetCount | TotalQuantity | Stock | Check | RefList | Alternative | Remark

Example Output:
1\tIC(SMD)\tU1\t1\t100\t\t□양호\tU1\t\t
2\t저항(1005)\tR100\t2\t200\t\t□양호\tR1, R2\t\t
3\tC/C(1005)\tC100\t1\t100\t\t\tC3\t\t미삽
`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-2024-07-18', // 2차 재학습 완료된 모델 (최신)
        messages: [
          { role: 'system', content: 'You are a helpful assistant that outputs TSV data only.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenAI API Error: ${errorData.error?.message || response.statusText}`);
    }

    const result = await response.json();
    const content = result.choices[0].message.content;
    
    try {
      // TSV 파싱
      const lines = content.split('\n');
      const bomItems = [];
      const coordinates = [];
      
      for (const line of lines) {
        const cols = line.split('\t');
        if (cols.length < 3) continue;

        // [좌표 파싱 로직 추가]
        let itemCoordinates = [];
        try {
             // 마지막 컬럼(인덱스 10)에 있는 JSON 문자열 파싱
             const coordStr = cols[10]?.trim();
             if (coordStr && (coordStr.startsWith('[') || coordStr.startsWith('{'))) {
                 itemCoordinates = JSON.parse(coordStr);
                 if (Array.isArray(itemCoordinates)) {
                     coordinates.push(...itemCoordinates);
                 }
             }
        } catch (e) {
             console.warn('Frontend Coordinate Parse Error:', e);
        }

        bomItems.push({
          lineNumber: cols[0]?.trim(),
          itemType: cols[1]?.trim(),
          itemName: cols[2]?.trim(),
          setCount: cols[3]?.trim(),
          totalQuantity: cols[4]?.trim(),
          // stock: cols[5], // 현재 UI에서 사용 안함
          // check: cols[6], // 현재 UI에서 사용 안함
          refList: cols[7]?.trim(),
          // alt: cols[8], // 현재 UI에서 사용 안함
          remark: cols[9]?.trim(),
          coordinates: itemCoordinates // [중요] 각 아이템에도 좌표 배열 할당
        });
      }
      
      // 후처리 및 데이터 보정 (Rule-based Correction)
      // 이 로직은 AI가 실수했을 때를 대비한 안전망으로 남겨둡니다.
      const correctedBomItems = bomItems.map((item: any) => {
          // 1. Ref 추출 (문자열)
          let refPrefix = '';
          if (item.refList && typeof item.refList === 'string') {
             refPrefix = item.refList.replace(/[0-9]/g, '').split(',')[0].trim().toUpperCase();
          }

          // 2. Item Type 보정
          let newItemType = item.itemType;
          const invalidTypes = ['저항', 'CAP', 'RES', 'IC', 'DIODE', 'TR']; 
          const looksLikePartName = /^[A-Z0-9]+-[A-Z0-9]+/.test(newItemType) || (newItemType && newItemType.length > 10 && newItemType.includes(' '));

          if (!newItemType || invalidTypes.includes(newItemType) || looksLikePartName) {
            if (looksLikePartName && (!item.itemName || item.itemName === '')) {
                item.itemName = newItemType;
            }

            if (refPrefix.startsWith('R')) newItemType = '저항(1005)';
            else if (refPrefix.startsWith('C')) newItemType = 'C/C(1005)';
            else if (refPrefix.startsWith('L') || refPrefix.startsWith('B') || refPrefix.startsWith('FB')) newItemType = 'BEAD(2012)';
            else if (refPrefix.startsWith('D') || refPrefix.startsWith('ZD')) newItemType = 'DIODE(SMD)';
            else if (refPrefix.startsWith('Q')) newItemType = 'TR(SMD)';
            else if (refPrefix.startsWith('U') || refPrefix.startsWith('IC')) newItemType = 'IC(SMD)';
            else if (refPrefix.startsWith('J') || refPrefix.startsWith('CN') || refPrefix.startsWith('P')) newItemType = 'CONNECTOR';
            else if (refPrefix.startsWith('Y') || refPrefix.startsWith('X') || refPrefix.startsWith('OSC')) newItemType = 'OSC(SMD)';
            else if (refPrefix.startsWith('TP')) newItemType = 'TEST POINT';
            else if (refPrefix.startsWith('SW')) newItemType = 'SWITCH';
            else if (refPrefix.startsWith('LED') || refPrefix.startsWith('DL')) newItemType = 'LED(1608)';
            
            if (item.itemType === '저항') newItemType = '저항(1005)';
          }
          
          // 3. Item Name 보정
          if (!item.itemName && item.specification) {
            item.itemName = item.specification;
          }

          return {
            ...item,
            itemType: newItemType || item.itemType
          };
      });

      return { bomItems: correctedBomItems, coordinates };

    } catch (e) {
      console.error('TSV Parse Error:', e);
      console.log('Raw Content:', content);
      throw new Error('AI 응답을 처리하는데 실패했습니다.');
    }
  } catch (error) {
    console.error('AI Processing Error:', error);
    throw error;
  }
}

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const data = e.target?.result;
      if (!data) {
        reject(new Error('파일을 읽을 수 없습니다.'));
        return;
      }

      // 엑셀 파일인 경우 XLSX 라이브러리로 텍스트 변환
      if (file.name.match(/\.(xlsx|xls)$/i)) {
        try {
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          // sheet_to_csv 대신 학습 데이터 생성 로직과 유사하게 탭 구분 텍스트 생성
          const rows: string[] = [];
          const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
          
          for (let R = range.s.r; R <= range.e.r; ++R) {
            const cells: string[] = [];
            // 10개 컬럼까지만 읽음 (학습 데이터와 동일하게)
            for (let C = range.s.c; C <= Math.min(range.e.c, 10); ++C) {
              const cell_address = { c: C, r: R };
              const cell_ref = XLSX.utils.encode_cell(cell_address);
              const cell = worksheet[cell_ref];
              
              if (cell && cell.v !== undefined) {
                // 특수문자나 공백 제거 로직 (선택 사항)
                cells.push(String(cell.v).trim());
              } else {
                cells.push('');
              }
            }
            // 빈 행 제외 로직
            if (cells.some(c => c !== '')) {
              rows.push(cells.join('\t'));
            }
          }
          
          resolve(rows.join('\n'));
        } catch (err) {
          console.warn('Excel parsing failed, fallback to text', err);
          // 바이너리를 텍스트로 읽으면 깨지므로 에러 처리
          reject(new Error('엑셀 파일 파싱에 실패했습니다.'));
        }
      } else {
        // 텍스트 파일 (CSV, TXT)
        const textDecoder = new TextDecoder('utf-8'); // 한글 깨짐 방지
        // FileReader가 readAsArrayBuffer로 읽었으므로 디코딩 필요
        if (data instanceof ArrayBuffer) {
            resolve(textDecoder.decode(data));
        } else {
            resolve(data as string);
        }
      }
    };

    reader.onerror = (e) => reject(e);

    if (file.name.match(/\.(xlsx|xls)$/i)) {
      reader.readAsArrayBuffer(file);
    } else {
      // 텍스트 파일도 인코딩 문제를 피하기 위해 ArrayBuffer로 읽어서 디코딩
      reader.readAsArrayBuffer(file);
    }
  });
}
