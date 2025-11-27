// Excel 다운로드 테스트 스크립트
import { generateCleanedBOMExcel } from './src/utils/excel-generator.js';

async function testExcelDownload() {
  console.log('Excel 다운로드 기능 테스트 시작...');
  
  const testBOMItems = [
    {
      lineNumber: 1,
      itemType: 'Capacitor',
      itemName: 'C0603-100nF',
      specification: 'Ceramic Capacitor 100nF 50V',
      setCount: 1,
      totalQuantity: 100,
      stockQuantity: 0,
      checkStatus: '발주필요',
      refList: 'C1,C2,C3,C4,C5',
      alternativeItem: '',
      remark: ''
    }
  ];
  
  const testCoordinates = [
    { refDes: 'C1', x: '10.5', y: '20.3', layer: 'TOP', rotation: '0' }
  ];
  
  try {
    const blob = await generateCleanedBOMExcel(testBOMItems, testCoordinates, 'TEST_BOARD');
    console.log('✅ 테스트 성공! Blob 생성됨:', {
      size: blob.size,
      type: blob.type
    });
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
  }
}

testExcelDownload();