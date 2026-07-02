import XLSX from 'xlsx';
import fs from 'fs';

const workbook = XLSX.readFile('sample-data/LG생기원제작현황(2026).xlsx');

const TITLE_HIERARCHY = {
  '': 0,
  '연구원': 1,
  '사원': 1,
  '원': 1,
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

// Clean name and position
function cleanTitle(title) {
  if (!title) return '';
  title = title.replace(/님$/, '').trim();
  return title;
}

function getHighestTitle(title1, title2) {
  const t1 = cleanTitle(title1);
  const t2 = cleanTitle(title2);
  const rank1 = TITLE_HIERARCHY[t1] || 0;
  const rank2 = TITLE_HIERARCHY[t2] || 0;
  return rank1 >= rank2 ? t1 : t2;
}

// Split a PJT Manager string into multiple name-position objects
// e.g. "김용헌책임(김범수)", "서강원사원(김범수)", "LGPRI 강철책임 / 이티에스 김민철"
function parsePjtManager(str, defaultCompany = 'LGPRI') {
  if (!str || str.trim() === 'PJT 담당자' || str.trim() === '-') return [];
  
  str = str.replace(/님/g, '').trim();
  
  const results = [];
  
  // 1. Check for slashes or commas indicating multiple managers
  // e.g. "김지미책임/김선범책임", "장경섭책임 / 김민철선임", "박일곤책임,정하형선임"
  if (str.includes('/') || str.includes(',')) {
    const parts = str.split(/[\/,]/);
    for (const part of parts) {
      results.push(...parsePjtManager(part, defaultCompany));
    }
    return results;
  }
  
  // 2. Check for "Company-Name" format
  // e.g. "우리기술-조봉수", "QOT-임동석", "LGPRI 강철책임", "이티에스 김민철"
  let company = defaultCompany;
  let remaining = str.trim();
  
  // If it has a company prefix separated by hyphen
  if (remaining.includes('-')) {
    const parts = remaining.split('-');
    const potentialCompany = parts[0].trim();
    if (potentialCompany && isNaN(Number(potentialCompany))) {
      company = potentialCompany;
      remaining = parts.slice(1).join('-').trim();
    }
  }
  
  // Check for space-separated company prefix e.g. "전남대학교 황승민", "대광솔라 임재성"
  // but avoid splitting titles like "오원호 책임"
  const spaceParts = remaining.split(/\s+/);
  if (spaceParts.length >= 2) {
    const firstWord = spaceParts[0].trim();
    // If first word is a known company prefix
    const knownCompanies = ['우리기술', '전남대학교', '전남대', '론픽', '대구첨복재단', '하이젠RNM', '대광솔라', '경경북대학교', '경북대학교', '이티에스', '평화발레오', 'QOT', 'DGIST', '대구대'];
    if (knownCompanies.includes(firstWord) || firstWord === 'LGPRI' || firstWord === 'PRI') {
      if (firstWord === 'LGPRI' || firstWord === 'PRI') {
        company = 'LGPRI';
      } else {
        company = firstWord;
      }
      remaining = spaceParts.slice(1).join(' ').trim();
    }
  }
  
  // Normalize company names
  if (company === 'PRI' || company === 'LGPRI') company = 'LGPRI';
  if (company === '전남대') company = '전남대학교';
  
  // 3. Extract parenthetical parts
  // e.g. "서강원사원(김범수)" -> 서강원사원, 김범수
  // e.g. "김용헌책임(우리기술-조봉수)" -> 김용헌책임, 우리기술-조봉수
  const parenMatch = remaining.match(/^([^(]+)\(([^)]+)\)$/);
  if (parenMatch) {
    const mainPart = parenMatch[1].trim();
    const subPart = parenMatch[2].trim();
    
    results.push(...parsePjtManager(mainPart, company));
    // For subPart, if it contains a company prefix, parse it with that company, otherwise use the same company
    results.push(...parsePjtManager(subPart, company));
    return results;
  }
  
  // 4. Parse Name and Title from remaining string
  // Titles: 책임, 선임, 연구원, 사원, 대리, 과장, 차장, 부장, 주임, 실장, 수석, 파트장, 소장, 팀장, 대표, 박사, 매니저, 교수
  const titles = Object.keys(TITLE_HIERARCHY).filter(t => t !== '');
  // Sort titles by length descending to match longer titles first (e.g. 연구원 before 원)
  titles.sort((a, b) => b.length - a.length);
  
  let name = remaining;
  let title = '';
  
  for (const t of titles) {
    if (remaining.endsWith(t)) {
      title = t;
      name = remaining.slice(0, -t.length).trim();
      break;
    }
    // Also check space separated title e.g. "오원호 책임"
    if (remaining.includes(' ' + t)) {
      title = t;
      name = remaining.split(' ' + t)[0].trim();
      break;
    }
  }
  
  // Cleanup names
  name = name.replace(/y$/, '').replace(/S$/, '').trim(); // Remove suffixes like "y", "S" in "김현진y/조창현S"
  if (name.includes('요청')) name = name.split('요청')[0].trim();
  
  if (name && name.length >= 2 && name.length <= 6) {
    results.push({
      company,
      name,
      title
    });
  } else if (name && !title) {
    // If it's a company name itself without a contact name (e.g., "마이크로시스템", "아이티공간", "싸이버메틱", "풍산시스템", "스마트팜")
    results.push({
      company: name,
      name: '',
      title: ''
    });
  }
  
  return results;
}

// Main parser
const vendorsMap = new Map(); // company -> Map(name -> title)

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
      const parsedManagers = parsePjtManager(col6Val, defaultCompany);
      
      for (const pm of parsedManagers) {
        let company = pm.company;
        if (company === '기타업체') {
          // Fallback if company is not determined
          company = '기타';
        }
        
        if (!vendorsMap.has(company)) {
          vendorsMap.set(company, new Map());
        }
        
        const contactsMap = vendorsMap.get(company);
        
        if (pm.name) {
          if (contactsMap.has(pm.name)) {
            const existingTitle = contactsMap.get(pm.name);
            const resolvedTitle = getHighestTitle(existingTitle, pm.title);
            contactsMap.set(pm.name, resolvedTitle);
          } else {
            contactsMap.set(pm.name, pm.title);
          }
        }
      }
    }
  }
}

// Generate reports
let mdReport = `# Excel Data Parsing Report: LGPRI & Other Vendors/Contacts

We scanned all monthly sheets in \`LG생기원제작현황(2026).xlsx\` starting from **January 2025 to June 2026**.
Below is the summary of vendors and contacts we parsed, resolving job promotions to the highest title.

## 1. Primary Vendor: LGPRI
The following contacts were identified from the main LGPRI tables, with resolved highest job titles:

| No. | Contact Name (성함) | Position/Title (직함) |
| :--- | :--- | :--- |
`;

let lgPriIdx = 1;
const lgPriContacts = Array.from(vendorsMap.get('LGPRI') || []).sort((a,b) => a[0].localeCompare(b[0], 'ko'));
lgPriContacts.forEach(([name, title]) => {
  mdReport += `| ${lgPriIdx++} | **${name}** | ${title || '-'} |\n`;
});

mdReport += `
## 2. Other Vendors & Contacts (기타 제작현황)
The following external companies and their contacts were extracted from the "기타 제작 현황" sections:

`;

const otherCompanies = Array.from(vendorsMap.keys()).filter(c => c !== 'LGPRI' && c !== '기타').sort((a,b) => a.localeCompare(b, 'ko'));
otherCompanies.forEach(company => {
  mdReport += `### **${company}**
| Contact Name (성함) | Position/Title (직함) |
| :--- | :--- |
`;
  const contacts = Array.from(vendorsMap.get(company)).sort((a,b) => a[0].localeCompare(b[0], 'ko'));
  contacts.forEach(([name, title]) => {
    mdReport += `| **${name || '-'}** | ${title || '-'} |\n`;
  });
  mdReport += '\n';
});

if (vendorsMap.has('기타')) {
  mdReport += `### **Unclassified/Other Company Contacts**
| Contact Name (성함) | Position/Title (직함) |
| :--- | :--- |
`;
  const contacts = Array.from(vendorsMap.get('기타')).sort((a,b) => a[0].localeCompare(b[0], 'ko'));
  contacts.forEach(([name, title]) => {
    mdReport += `| **${name}** | ${title || '-'} |\n`;
  });
  mdReport += '\n';
}

fs.writeFileSync('scripts/parsed-vendors-report.md', mdReport);
console.log('Markdown report written to scripts/parsed-vendors-report.md');

// Also save structured JSON of all vendors and contacts for execution phase
const jsonOutput = {};
vendorsMap.forEach((contactsMap, companyName) => {
  jsonOutput[companyName] = Array.from(contactsMap.entries()).map(([name, title]) => ({ name, title }));
});
fs.writeFileSync('scripts/parsed-vendors.json', JSON.stringify(jsonOutput, null, 2));
console.log('Structured JSON data written to scripts/parsed-vendors.json');
