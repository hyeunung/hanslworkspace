import fs from 'fs/promises';
import path from 'path';

const BASE_PATH = './sample-data/24_25_SOCKET';
const OUTPUT_FILE = './scripts/complete-training-sets.json';

async function main() {
  console.log('🔍 데이터 세트 복구 시작...');
  const sets = [];
  
  const years = await fs.readdir(BASE_PATH);
  for (const year of years) {
    if (year.startsWith('.')) continue;
    const yearPath = path.join(BASE_PATH, year);
    
    try {
      const boards = await fs.readdir(yearPath);
      for (const board of boards) {
        if (board.startsWith('.')) continue;
        const boardPath = path.join(yearPath, board);
        
        // 폴더 확인
        const stat = await fs.stat(boardPath);
        if (!stat.isDirectory()) continue;

        const files = await fs.readdir(boardPath);
        
        let bomFile = null;
        let coordFile = null;
        let answerFile = null;

        for (const file of files) {
            if (file.startsWith('.')) continue;
            const lower = file.toLowerCase();
            
            // 정답지 찾기 (괄호 안에 숫자 있거나, 특정 키워드)
            // 예: ...(2408).xlsx, ...part.xlsx(BOM)
            if (lower.includes('part') || lower.includes('bom')) {
                if (!bomFile) bomFile = file;
            } else if (lower.includes('좌표') || lower.includes('pick') || lower.includes('location') || lower.endsWith('.txt')) {
                if (!coordFile) coordFile = file;
            } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
                // AI 생성 파일 제외
                if (!file.includes('AI_Generated')) {
                    answerFile = file;
                }
            }
        }

        // BOM 파일이 .txt일 수도 있음
        if (!bomFile) {
             // part나 bom이라는 이름이 없으면 xlsx 중 가장 긴 것을 BOM으로? 아니면 정답지로?
             // 정답지는 보통 수동으로 작업해서 '사본' 이나 날짜가 붙음.
             // 여기선 단순하게: 
             // 1. .txt는 좌표
             // 2. .xlsx 중 'part' 들어간 건 BOM
             // 3. 나머지 .xlsx는 정답지
        }

        if (bomFile && coordFile && answerFile) {
            sets.push({
                year: year,
                boardName: board,
                bom: bomFile,
                coordinate: coordFile,
                cleaned: answerFile
            });
            console.log(`✅ 발견: ${board}`);
        } else {
            // 정밀 탐색 (이름 규칙이 안 맞을 경우)
            // 일단 pass
            // console.log(`⚠️ 불완전: ${board} (BOM:${bomFile}, Coord:${coordFile}, Ans:${answerFile})`);
        }
      }
    } catch (e) {
      continue;
    }
  }

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(sets, null, 2));
  console.log(`\n🎉 복구 완료! 총 ${sets.length}개 세트 저장됨.`);
}

main();

