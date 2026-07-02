import ExcelJS from 'exceljs';

async function main() {
  const file = './sample-data/LG생기원제작현황(2026).xlsx';
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  
  // Let's inspect the 26년06월작업현황 sheet
  const sheet = workbook.getWorksheet('26년06월작업현황');
  if (!sheet) {
    console.log('Sheet 26년06월작업현황 not found');
    return;
  }
  
  console.log(`Analyzing sheet "${sheet.name}" with ${sheet.rowCount} rows`);
  
  // Find rows that look like headers or section titles
  for (let r = 1; r <= Math.min(200, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    const firstCellVal = row.getCell(1).value;
    
    // Check if the row is a section title or a new header
    let rowText = [];
    row.eachCell({ includeEmpty: true }, cell => {
      let val = cell.value;
      if (val && typeof val === 'object' && val.richText) {
        val = val.richText.map(rt => rt.text).join('');
      }
      rowText.push(val ?? '');
    });
    
    // If the first cell has text and it spans multiple columns (merged) or contains keywords
    const nonBlank = rowText.filter(t => t !== '');
    if (nonBlank.length > 0) {
      const isSectionHeader = nonBlank.length === 1 || nonBlank.some(t => {
        const s = String(t);
        return s.includes('제작 현황') || s.includes('제작현황') || s.includes('케이블') || s.includes('케이스');
      });
      const hasNo = nonBlank.some(t => String(t).includes('NO.'));
      
      if (isSectionHeader || hasNo || r < 30) {
        console.log(`Row ${r}:`, nonBlank.slice(0, 10));
      }
    }
  }
}

main().catch(console.error);
