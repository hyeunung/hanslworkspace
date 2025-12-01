import * as XLSX from 'xlsx';
import fs from 'fs/promises';
import path from 'path';

async function inspect() {
    const filePath = 'sample-data/24_25_SOCKET/2025/H25-093_LGIT_SAA_PDX_26Y_V1.0/H25-093_LGIT_SAA_PDX_26Y_V1.0(2507).xlsx';
    try {
        const buffer = await fs.readFile(filePath);
        const workbook = XLSX.read(buffer, { type: 'buffer' });

        console.log('Sheet Names:', workbook.SheetNames);

        for (const name of workbook.SheetNames) {
            console.log(`\n--- Sheet: ${name} ---`);
            const sheet = workbook.Sheets[name];
            // Read first 5 rows
            const json = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0, defval: '' });
            console.log(json.slice(0, 5));
        }
    } catch (e) {
        console.error(e);
    }
}

inspect();
