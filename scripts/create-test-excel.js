import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createTestBOMExcel() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('BOM');

  // 헤더 추가
  worksheet.addRow(['Line', 'Type', 'Part Number', 'Description', 'Quantity', 'Set Count', 'Remark']);
  
  // 데이터 추가
  worksheet.addRow([1, 'Capacitor', 'C0603-100nF', 'Ceramic Capacitor 100nF 50V', 10, 1, '']);
  worksheet.addRow([2, 'Resistor', 'R0603-10K', 'SMD Resistor 10K 1%', 15, 1, '']);
  worksheet.addRow([3, 'IC', 'STM32F103', 'Microcontroller STM32F103', 1, 1, 'Main MCU']);
  worksheet.addRow([4, 'LED', 'LED0603-RED', 'Red LED 0603', 5, 1, 'Indicator']);
  worksheet.addRow([5, 'Connector', 'CONN-USB-C', 'USB Type-C Connector', 1, 1, 'Power Input']);

  // 파일 저장
  const filePath = path.join(__dirname, '../test-files/test-bom.xlsx');
  await workbook.xlsx.writeFile(filePath);
  console.log('Created test BOM Excel file:', filePath);
}

async function createTestCoordinateExcel() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Coordinates');

  // 헤더 추가
  worksheet.addRow(['RefDes', 'X', 'Y', 'Layer', 'Rotation']);
  
  // 데이터 추가
  worksheet.addRow(['C1', 10.5, 20.3, 'TOP', 0]);
  worksheet.addRow(['C2', 15.2, 20.3, 'TOP', 0]);
  worksheet.addRow(['R1', 10.5, 25.5, 'TOP', 90]);
  worksheet.addRow(['R2', 15.2, 25.5, 'TOP', 90]);
  worksheet.addRow(['U1', 30.0, 30.0, 'TOP', 0]);
  worksheet.addRow(['LED1', 40.5, 10.2, 'TOP', 180]);
  worksheet.addRow(['J1', 50.0, 50.0, 'TOP', 0]);

  // 파일 저장
  const filePath = path.join(__dirname, '../test-files/test-coordinate.xlsx');
  await workbook.xlsx.writeFile(filePath);
  console.log('Created test Coordinate Excel file:', filePath);
}

// 실행
Promise.all([createTestBOMExcel(), createTestCoordinateExcel()])
  .then(() => console.log('All test files created successfully!'))
  .catch(console.error);