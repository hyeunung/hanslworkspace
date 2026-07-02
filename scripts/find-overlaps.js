import XLSX from 'xlsx';

const workbook = XLSX.readFile('sample-data/LG생기원제작현황(2026).xlsx');

const TITLE_HIERARCHY = {
  '': 0, '연구원': 1, '사원': 1, '주임': 2, '대리': 2, '매니저': 2,
  '선임': 3, '과장': 4, '차장': 5, '책임': 6, '부장': 7, '실장': 8,
  '수석': 8, '파트장': 9, '소장': 9, '팀장': 9, '대표': 10, '박사': 10
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

function extractParentheses(str) {
  const parts = [];
  let remaining = str.trim();

  const regex = /\(([^)]+)\)/g;
  let match;
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

function parseCell(val, defaultCompany) {
  if (!val) return [];
  val = String(val).trim();
  if (val === 'PJT 담당자' || val === '-' || val === '없음' || val === '선물') return [];

  const parenParts = extractParentheses(val);
  const results = [];
  let currentCompany = defaultCompany;

  for (const part of parenParts) {
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
  item = item.replace(/님$/, '').trim();

  let company = defaultCompany;
  let remaining = item;

  if (remaining.includes('-')) {
    const dashParts = remaining.split('-');
    const potCompany = dashParts[0].trim();
    if (potCompany && isNaN(Number(potCompany))) {
      company = potCompany;
      remaining = dashParts.slice(1).join('-').trim();
    }
  } else {
    for (const c of KNOWN_COMPANIES) {
      if (remaining.startsWith(c)) {
        company = c;
        remaining = remaining.substring(c.length).trim();
        break;
      }
    }
  }

  if (company === 'PRI' || company === 'LGPRI') company = 'LGPRI';
  if (company === '전남대') company = '전남대학교';
  if (company === '대구대') company = '대구대학교';
  if (company === '첨복재단') company = '대구첨복재단';
  if (company === '대구첨복') company = '대구첨복재단';
  if (company === '경북대') company = '경북대학교';

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
    if (remaining.includes(' ' + t)) {
      title = t;
      name = remaining.split(' ' + t)[0].trim();
      break;
    }
  }

  name = name.replace(/y$/, '').replace(/S$/, '').trim();
  if (name.includes('요청')) name = name.split('요청')[0].trim();
  
  if (IGNORED_NAMES.has(name) || name === '개요청' || name === '') return [];
  if (name === '') return [{ company, name: '', title: '' }];
  if (name && KNOWN_COMPANIES.includes(name)) return [{ company: name, name: '', title: '' }];

  if (name.startsWith('마곡 ')) name = name.replace('마곡 ', '');

  if (name && name.length >= 2 && name.length <= 6) {
    return [{ company, name, title }];
  }
  return [];
}

const allOccurrences = []; // array of { company, name, title, sheet, row, val }

for (const name of workbook.SheetNames) {
  if (!name.match(/^(25|26)년\d{2}월작업현황$/)) continue;
  
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
        if (item.name) {
          allOccurrences.push({
            company: item.company === '기타업체' ? '기타' : item.company,
            name: item.name,
            title: item.title,
            sheet: name,
            row: r,
            rawVal: col6Val
          });
        }
      }
    }
  }
}

// 1. Group by name to find people who are mapped to different companies
const nameToCompanies = new Map();
allOccurrences.forEach(occ => {
  if (!nameToCompanies.has(occ.name)) {
    nameToCompanies.set(occ.name, new Set());
  }
  nameToCompanies.get(occ.name).add(occ.company);
});

console.log('=== NAMES ASSOCIATED WITH MULTIPLE COMPANIES ===');
let hasMultiCompanyOverlaps = false;
nameToCompanies.forEach((companies, name) => {
  if (companies.size > 1) {
    hasMultiCompanyOverlaps = true;
    console.log(`- ${name}: Associated with companies:`, Array.from(companies));
    // Print occurrences
    const occs = allOccurrences.filter(o => o.name === name);
    occs.forEach(o => {
      console.log(`  * ${o.sheet} R${o.row}: "${o.rawVal}" -> Company: ${o.company}, Title: ${o.title}`);
    });
  }
});
if (!hasMultiCompanyOverlaps) {
  console.log('No names associated with multiple companies found.');
}

// 2. Find people who had different ranks/titles within the same company
const nameToTitles = new Map();
allOccurrences.forEach(occ => {
  const key = `${occ.company}:${occ.name}`;
  if (!nameToTitles.has(key)) {
    nameToTitles.set(key, new Set());
  }
  if (occ.title) {
    nameToTitles.get(key).add(occ.title);
  }
});

console.log('\n=== SAME PERSON WITH DIFFERENT RANKS/TITLES OVER TIME ===');
let hasTitleOverlaps = false;
nameToTitles.forEach((titles, key) => {
  if (titles.size > 1) {
    hasTitleOverlaps = true;
    const [company, name] = key.split(':');
    console.log(`- [${company}] ${name}: Had ranks:`, Array.from(titles));
    // Print occurrences
    const occs = allOccurrences.filter(o => o.name === name && o.company === company);
    occs.forEach(o => {
      console.log(`  * ${o.sheet} R${o.row}: "${o.rawVal}" -> Rank: ${o.title || '(none)'}`);
    });
  }
});
if (!hasTitleOverlaps) {
  console.log('No title variation overlaps found.');
}
