import XLSX from 'xlsx';

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

  if (name === '') {
    return [{ company, name: '', title: '' }];
  }

  if (name && KNOWN_COMPANIES.includes(name)) {
    return [{ company: name, name: '', title: '' }];
  }

  if (name && name.length >= 2 && name.length <= 6) {
    return [{ company, name, title }];
  }

  return [];
}

function parseCell(val, defaultCompany) {
  const parenParts = extractParentheses(val);
  const results = [];
  let currentCompany = defaultCompany;

  for (const part of parenParts) {
    const splitParts = part.content.split(/[\r\n\/,&\+]+/).map(p => p.trim()).filter(Boolean);
    for (const sp of splitParts) {
      const parsedItems = parseItem(sp, currentCompany);
      console.log(`sp: "${sp}", currentCompany: "${currentCompany}", parsed:`, parsedItems);
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

console.log('Testing "대구대(남흥우)":');
const res = parseCell("대구대(남흥우)", "기타업체");
console.log('Result:', res);
