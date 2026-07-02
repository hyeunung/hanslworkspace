import XLSX from 'xlsx';
import fs from 'fs';

const workbook = XLSX.readFile('sample-data/LG생기원제작현황(2026).xlsx');

const TITLE_HIERARCHY = {
  '': 0,
  '연구원': 1,
  '사원': 1,
  '주임': 2,
  '대리': 2,
  '매니저': 2,
  '선임': 3,
  '과장': 4,
  '차장': 5,
  '책임': 6,
  '부장': 7,
  '실장': 8,
  '수석': 8,
  '파트장': 9,
  '소장': 9,
  '팀장': 9,
  '대표': 10,
  '박사': 10
};

const KNOWN_COMPANIES = [
  '우리기술', '전남대학교', '전남대', '론픽', '대구첨복재단', '첨복재단',
  '하이젠RNM', '대광솔라', '경북대학교', '이티에스', '평화발레오', 'QOT',
  'DGIST', '대구대', '마이콘', '마이크로시스템', '근로복지공단', '아이티공간',
  '싸이버메틱', '풍산시스템', 'MD', '한국기계연구원', '팸텍', '대광솔라'
];

const IGNORED_NAMES = new Set([
  '10개', '11개', '1개', '과제', '풍산', '스마트팜', '한슬스마트팜', '로봇Task', 'VH', '대구대',
  '경북대', '전남대', '대구첨복', '첨복재단', '이티에스', 'QOT', '우리기술', '론픽', '하이젠', 
  '마이콘', '마이크로시스템', '근로복지공단', '개요청', '1개요청', '선물', '서강원 1개'
]);

function cleanTitle(title) {
  if (!title) return '';
  return title.replace(/님$/, '').trim();
}

function getHighestTitle(title1, title2) {
  const t1 = cleanTitle(title1);
  const t2 = cleanTitle(title2);
  const r1 = TITLE_HIERARCHY[t1] || 0;
  const r2 = TITLE_HIERARCHY[t2] || 0;
  return r1 >= r2 ? t1 : t2;
}

// Extract parenthetical parts first to avoid splitting commas inside parentheses
function extractParentheses(str) {
  const parts = [];
  let remaining = str.trim();

  const regex = /\(([^)]+)\)/g;
  let match;
  let lastIndex = 0;
  const matches = [];

  while ((match = regex.exec(remaining)) !== null) {
    matches.push({
      start: match.index,
      end: regex.lastIndex,
      content: match[1].trim()
    });
  }

  if (matches.length === 0) {
    return [{ isParentheses: false, content: remaining }];
  }

  let prevEnd = 0;
  for (const m of matches) {
    const outerText = remaining.substring(prevEnd, m.start).trim();
    if (outerText) {
      parts.push({ isParentheses: false, content: outerText });
    }
    parts.push({ isParentheses: true, content: m.content });
    prevEnd = m.end;
  }
  const tailText = remaining.substring(prevEnd).trim();
  if (tailText) {
    parts.push({ isParentheses: false, content: tailText });
  }

  return parts;
}

// Function to split and parse a PJT manager cell value
function parseCell(val, defaultCompany) {
  if (!val) return [];
  val = String(val).trim();
  if (val === 'PJT 담당자' || val === '-' || val === '없음' || val === '선물') return [];

  // Extract parentheses first
  const parenParts = extractParentheses(val);
  const results = [];

  let currentCompany = defaultCompany;

  for (const part of parenParts) {
    // Split by newlines, slashes, commas, and pluses
    const splitParts = part.content.split(/[\r\n\/,&\+]+/).map(p => p.trim()).filter(Boolean);
    
    for (const sp of splitParts) {
      const parsedItems = parseItem(sp, currentCompany);
      if (parsedItems.length > 0) {
        if (!part.isParentheses) {
          currentCompany = parsedItems[0].company;
        }
        results.push(...parsedItems);
      }
    }
  }

  return results;
}

function parseItem(item, defaultCompany) {
  item = item.trim();
  if (!item) return [];

  // Remove honorific '님'
  item = item.replace(/님$/, '').trim();

  // Try to determine company
  let company = defaultCompany;
  let remaining = item;

  // Check for company with hyphen
  if (remaining.includes('-')) {
    const dashParts = remaining.split('-');
    const potCompany = dashParts[0].trim();
    if (potCompany && isNaN(Number(potCompany))) {
      company = potCompany;
      remaining = dashParts.slice(1).join('-').trim();
    }
  } else {
    // Check for space separated known company
    for (const c of KNOWN_COMPANIES) {
      if (remaining.startsWith(c)) {
        company = c;
        remaining = remaining.substring(c.length).trim();
        break;
      }
    }
  }

  // Normalize company names
  if (company === 'PRI' || company === 'LGPRI') company = 'LGPRI';
  if (company === '전남대') company = '전남대학교';
  if (company === '대구대') company = '대구대학교';
  if (company === '첨복재단') company = '대구첨복재단';
  if (company === '대구첨복') company = '대구첨복재단';
  if (company === '경북대') company = '경북대학교';

  // Parse Name and Title
  const titles = Object.keys(TITLE_HIERARCHY).filter(t => t !== '');
  titles.sort((a, b) => b.length - a.length);

  let name = remaining;
  let title = '';

  for (const t of titles) {
    if (remaining.endsWith(t)) {
      title = t;
      name = remaining.slice(0, -t.length).trim();
      break;
    }
    // E.g. "오원호 책임"
    if (remaining.includes(' ' + t)) {
      title = t;
      name = remaining.split(' ' + t)[0].trim();
      break;
    }
  }

  // Clean name
  name = name.replace(/y$/, '').replace(/S$/, '').trim(); // remove y, S suffixes
  if (name.includes('요청')) name = name.split('요청')[0].trim();
  
  if (IGNORED_NAMES.has(name) || name === '개요청') return [];

  // If name is empty, it means the whole string was a company prefix
  if (name === '') {
    return [{ company, name: '', title: '' }];
  }

  // If name is actually a company without a person (e.g. "마이크로시스템", "아이티공간")
  if (name && KNOWN_COMPANIES.includes(name)) {
    return [{ company: name, name: '', title: '' }];
  }

  // Location/Tag cleaning
  if (name.startsWith('마곡 ')) {
    name = name.replace('마곡 ', '');
  }

  if (name && name.length >= 2 && name.length <= 6) {
    return [{ company, name, title }];
  }

  return [];
}

const rawVendorsMap = new Map();

for (const name of workbook.SheetNames) {
  if (!name.match(/^(25|26)년\d{2}월작업현황$/)) {
    continue;
  }
  
  const sheet = workbook.Sheets[name];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 'A1:AZ1500' });
  
  let currentTableType = '';
  
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (!row || row.length === 0) continue;
    
    const val0 = row[0] !== undefined ? String(row[0]).trim() : '';
    
    if (val0 === 'NO.' || val0 === 'No.' || val0 === 'NO') {
      const nextRow = data[r+1] || [];
      const sub6 = nextRow[6] !== undefined ? String(nextRow[6]).trim() : '';
      if (sub6.includes('LG') || sub6.includes('LGPRI')) {
        currentTableType = 'LGPRI';
      } else if (sub6.includes('업체')) {
        currentTableType = 'GITA';
      } else {
        currentTableType = 'LGPRI';
      }
      r++;
      continue;
    }
    
    if (val0.includes('기타') && val0.includes('현황')) {
      currentTableType = 'GITA';
      continue;
    }
    
    const num0 = Number(val0);
    if (!isNaN(num0) && num0 > 0) {
      const col6Val = row[6] !== undefined ? String(row[6]).trim() : '';
      const defaultCompany = currentTableType === 'GITA' ? '기타업체' : 'LGPRI';
      
      const parsed = parseCell(col6Val, defaultCompany);
      
      for (const item of parsed) {
        let companyName = item.company;
        if (companyName === '기타업체') companyName = '기타';
        
        if (!rawVendorsMap.has(companyName)) {
          rawVendorsMap.set(companyName, new Map());
        }
        
        const contactsMap = rawVendorsMap.get(companyName);
        
        if (item.name) {
          if (contactsMap.has(item.name)) {
            const existingTitle = contactsMap.get(item.name);
            const resolvedTitle = getHighestTitle(existingTitle, item.title);
            contactsMap.set(item.name, resolvedTitle);
          } else {
            contactsMap.set(item.name, item.title);
          }
        }
      }
    }
  }
}

// Post-processing to deduplicate LGPRI contacts from other companies
const lgPriContactsMap = rawVendorsMap.get('LGPRI') || new Map();

// If someone is in LGPRI, we remove them from '기타' or other companies
rawVendorsMap.forEach((contactsMap, companyName) => {
  if (companyName === 'LGPRI') return;
  
  contactsMap.forEach((title, name) => {
    if (lgPriContactsMap.has(name)) {
      const lgPriTitle = lgPriContactsMap.get(name);
      lgPriContactsMap.set(name, getHighestTitle(lgPriTitle, title));
      contactsMap.delete(name);
    }
  });
});

// Remove HANSL employees if they are in '기타'
const HANSL_EMPLOYEES = new Set(['강영은', '곽병현', '김경태', '김윤회', '김은정', '김희승', '나유성', '백현덕', '윤은호', '이재형', '이정화', '이종근', '이한빈', '임소연', '조근일', '하치복']);
rawVendorsMap.forEach((contactsMap, companyName) => {
  contactsMap.forEach((title, name) => {
    if (HANSL_EMPLOYEES.has(name)) {
      contactsMap.delete(name);
    }
  });
});

// Remove empty companies
rawVendorsMap.forEach((contactsMap, companyName) => {
  if (contactsMap.size === 0 && companyName !== 'LGPRI') {
    rawVendorsMap.delete(companyName);
  }
});

// Generate the output JSON and Markdown
const jsonOutput = {};
rawVendorsMap.forEach((contactsMap, companyName) => {
  jsonOutput[companyName] = Array.from(contactsMap.entries()).map(([name, title]) => ({ name, title }));
});

fs.writeFileSync('scripts/parsed-vendors-refined.json', JSON.stringify(jsonOutput, null, 2));

// Generate Markdown Report
let report = `# 제작현황 엑셀 분석 결과 보고서 (25년 1월 ~ 26년 6월)

LGPRI 및 기타 제작현황 테이블에서 추출한 업체별 담당자 및 직함 정제 결과입니다.
승진 등으로 동일 인물의 직함이 변동된 경우 **가장 높은 직함**으로 병합 및 정제하였습니다.

## 1. LGPRI 업체 담당자 목록
LGPRI(LG생기원) 테이블의 PJT 담당자 열에서 추출한 총 **${jsonOutput['LGPRI']?.length || 0}명**의 담당자입니다.

| 번호 | 성함 | 최종 직함 (가장 높은 직함) |
| :--- | :--- | :--- |
`;

let idx = 1;
jsonOutput['LGPRI'].sort((a,b) => a.name.localeCompare(b.name, 'ko')).forEach(contact => {
  report += `| ${idx++} | **${contact.name}** | ${contact.title || '-'} |\n`;
});

report += `
## 2. 기타 업체 및 담당자 목록
"기타 제작 현황" 테이블에서 추출한 외부 협력업체 및 담당자 목록입니다.

`;

const otherComps = Object.keys(jsonOutput).filter(c => c !== 'LGPRI' && c !== '기타').sort((a,b) => a.localeCompare(b, 'ko'));
otherComps.forEach(company => {
  report += `### **${company}**
| 성함 | 직함 |
| :--- | :--- |
`;
  jsonOutput[company].sort((a,b) => a.name.localeCompare(b.name, 'ko')).forEach(contact => {
    report += `| **${contact.name || '-'}** | ${contact.title || '-'} |\n`;
  });
  report += '\n';
});

if (jsonOutput['기타'] && jsonOutput['기타'].length > 0) {
  report += `### **미분류/기타 담당자**
| 성함 | 직함 |
| :--- | :--- |
`;
  jsonOutput['기타'].sort((a,b) => a.name.localeCompare(b.name, 'ko')).forEach(contact => {
    report += `| **${contact.name}** | ${contact.title || '-'} |\n`;
  });
  report += '\n';
}

fs.writeFileSync('scripts/parsed-vendors-report-refined.md', report);
console.log('Refined report written to scripts/parsed-vendors-report-refined.md');
