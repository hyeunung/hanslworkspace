import fs from 'fs';
import path from 'path';

const BASE_PATH = './sample-data/24_25_SOCKET';
const OUTPUT_FILE = './scripts/complete-training-sets.json';

const sets = [];
const years = fs.readdirSync(BASE_PATH);

years.forEach(year => {
    if (year.startsWith('.')) return;
    const yearPath = path.join(BASE_PATH, year);
    if (!fs.statSync(yearPath).isDirectory()) return;

    const boards = fs.readdirSync(yearPath);
    boards.forEach(board => {
        if (board.startsWith('.')) return;
        const boardPath = path.join(yearPath, board);
        if (!fs.statSync(boardPath).isDirectory()) return;

        const files = fs.readdirSync(boardPath);
        let bom = null, coord = null, cleaned = null;

        files.forEach(file => {
            if (file.startsWith('.')) return;
            const lower = file.toLowerCase();
            if (lower.includes('part') || lower.includes('bom')) bom = file;
            else if (lower.includes('좌표') || lower.includes('pick') || lower.endsWith('.txt')) coord = file;
            else if ((lower.endsWith('.xlsx') || lower.endsWith('.xls')) && !file.includes('AI_Generated')) cleaned = file;
        });

        if (bom && coord && cleaned) {
            sets.push({ year, boardName: board, bom, coordinate: coord, cleaned });
        }
    });
});

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(sets, null, 2));
console.log(`Recovered ${sets.length} sets.`);

