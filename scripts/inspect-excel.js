import XLSX from 'xlsx';
import fs from 'fs';

const workbook = XLSX.readFile('sample-data/LG생기원제작현황(2026).xlsx');

const allCol6 = new Set();
const allCol7 = new Set();
const gitaRows = [];

for (const name of workbook.SheetNames) {
  if (!name.match(/^(25|26)년\d{2}월작업현황$/)) {
    continue;
  }
  
  const sheet = workbook.Sheets[name];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 'A1:AZ1500' });
  
  let currentTableType = ''; // 'LGPRI', 'GITA', or ''
  
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (!row || row.length === 0) continue;
    
    const val0 = row[0] !== undefined ? String(row[0]).trim() : '';
    
    // Check for table headers
    if (val0 === 'NO.' || val0 === 'No.' || val0 === 'NO') {
      const nextRow = data[r+1] || [];
      const sub6 = nextRow[6] !== undefined ? String(nextRow[6]).trim() : '';
      if (sub6.includes('LG') || sub6.includes('LGPRI')) {
        currentTableType = 'LGPRI';
      } else if (sub6.includes('업체')) {
        currentTableType = 'GITA';
      } else {
        // Default to LGPRI if not specified
        currentTableType = 'LGPRI';
      }
      r++; // skip subheader row
      continue;
    }
    
    // Skip if it looks like a title row or notes row
    if (val0.includes('기타') && val0.includes('현황')) {
      currentTableType = 'GITA';
      continue;
    }
    
    // If it's a data row
    const num0 = Number(val0);
    if (!isNaN(num0) && num0 > 0) {
      const col6Val = row[6] !== undefined ? String(row[6]).trim() : '';
      const col7Val = row[7] !== undefined ? String(row[7]).trim() : '';
      
      if (currentTableType === 'LGPRI') {
        if (col6Val) allCol6.add(col6Val);
      } else if (currentTableType === 'GITA') {
        if (col6Val) gitaRows.push({ sheet: name, row: r, val: col6Val });
      }
      if (col7Val) allCol7.add(col7Val);
    }
  }
}

let out = '';
out += '=== LGPRI COLUMN VALUES ===\n';
out += Array.from(allCol6).sort().join('\n') + '\n\n';

out += '=== HANSL COLUMN VALUES ===\n';
out += Array.from(allCol7).sort().join('\n') + '\n\n';

out += '=== GITA COLUMN VALUES (COMPANY-NAME) ===\n';
gitaRows.forEach(gr => {
  out += `${gr.sheet} R${gr.row}: ${gr.val}\n`;
});

fs.writeFileSync('scripts/all-unique-values.txt', out);
console.log('Successfully written unique values to scripts/all-unique-values.txt');
