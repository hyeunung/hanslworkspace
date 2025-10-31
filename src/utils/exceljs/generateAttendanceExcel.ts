import ExcelJS from 'exceljs';

export interface AttendanceData {
  employeeName: string;
  employeeId: string;
  department: string;
  startDate: string;
  endDate: string;
  records: AttendanceRecord[];
}

export interface AttendanceRecord {
  date: string;
  dayOfWeek: string;
  employeeName: string;
  employeeId: string;
  department: string;
  position: string;
  workType: string;
  clockIn?: string;
  clockOut?: string;
  status: string;
  remarks?: string;
}

export async function generateAttendanceExcel(data: AttendanceData): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('출근현황표');

  // 엑셀 페이지 설정
  worksheet.pageSetup = {
    paperSize: 9, // A4
    orientation: 'portrait',
    margins: {
      left: 0.7,
      right: 0.7,
      top: 0.75,
      bottom: 0.75,
      header: 0.3,
      footer: 0.3,
    },
  };

  // 컬럼 너비 설정 (이미지에서 본 레이아웃에 맞춤)
  worksheet.columns = [
    { width: 12 }, // 날짜
    { width: 8 },  // 이름
    { width: 12 }, // 사번
    { width: 8 },  // 부서
    { width: 6 },  // 직급
    { width: 8 },  // 근무형태
    { width: 12 }, // 출근시간
    { width: 12 }, // 퇴근시간
    { width: 8 },  // 출퇴근상태
    { width: 8 },  // 근무상태
  ];

  // 제목 헤더 (1페이지 표시)
  const titleRow = worksheet.addRow(['1']);
  titleRow.height = 25;
  worksheet.mergeCells('A1:J1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = '1';
  titleCell.font = { name: '맑은 고딕', size: 14, bold: true };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // 공백 행
  worksheet.addRow([]);

  // 직원명과 조회기간 헤더
  const employeeRow = worksheet.addRow([`${data.employeeName} 내역 (21)`]);
  employeeRow.height = 20;
  worksheet.mergeCells('A3:J3');
  const employeeCell = worksheet.getCell('A3');
  employeeCell.font = { name: '맑은 고딕', size: 12, bold: true };
  employeeCell.alignment = { horizontal: 'left', vertical: 'middle' };

  const periodRow = worksheet.addRow([`조회기간: ${data.startDate} ~ ${data.endDate}`]);
  periodRow.height = 20;
  worksheet.mergeCells('A4:J4');
  const periodCell = worksheet.getCell('A4');
  periodCell.font = { name: '맑은 고딕', size: 10 };
  periodCell.alignment = { horizontal: 'left', vertical: 'middle' };

  // 테이블 헤더
  const headerRow = worksheet.addRow([
    '날짜',
    '이름', 
    '사번',
    '부서',
    '직급',
    '근무형태',
    '출근시간',
    '퇴근시간',
    '출퇴근상태',
    '근무상태'
  ]);
  
  headerRow.height = 25;
  
  // 헤더 스타일링
  headerRow.eachCell((cell, _colNumber) => {
    cell.font = { name: '맑은 고딕', size: 10, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
  });

  // 주말/공휴일 확인 함수
  const isWeekendOrHolidayFunc = (dateString: string): boolean => {
    const date = new Date(dateString.split('(')[0]); // 날짜 부분만 추출
    const dayOfWeek = date.getDay();
    
    // 주말 (토요일: 6, 일요일: 0)
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return true;
    }
    
    // 공휴일 (간단한 공휴일 목록 - 확장 가능)
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    
    // 기본 공휴일 (추가 필요시 확장)
    const holidays = [
      `${year}-01-01`, // 신정
      `${year}-03-01`, // 삼일절
      `${year}-05-05`, // 어린이날
      `${year}-06-06`, // 현충일
      `${year}-08-15`, // 광복절
      `${year}-10-03`, // 개천절
      `${year}-10-09`, // 한글날
      `${year}-12-25`, // 크리스마스
    ];
    
    const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    return holidays.includes(dateStr);
  };

  // 데이터 행 추가
  data.records.forEach(record => {
    // 연차/공휴일 판단을 위한 근무상태 결정
    let workStatus = record.remarks || '-';
    const isWeekendOrHoliday = isWeekendOrHolidayFunc(record.date);
    
    // 연차나 공휴일인 경우 근무상태에 표시
    if (record.remarks && record.remarks.includes('연차')) {
      workStatus = '연차';
    } else if (isWeekendOrHoliday) {
      const date = new Date(record.date.split('(')[0]);
      const dayOfWeek = date.getDay();
      
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        workStatus = '주말';
      } else {
        workStatus = '공휴일';
      }
    }

    const dataRow = worksheet.addRow([
      record.date,
      record.employeeName,
      record.employeeId,
      record.department,
      record.position,
      record.workType,
      record.clockIn || '-',
      record.clockOut || '-',
      record.status,
      workStatus
    ]);

    dataRow.height = 20;
    
    const isSpecialDay = isWeekendOrHoliday;
    const isLeaveDay = record.remarks && record.remarks.includes('연차');
    
    // 데이터 행 스타일링
    dataRow.eachCell((cell, colNumber) => {
      cell.font = { name: '맑은 고딕', size: 9 };
      cell.alignment = { 
        horizontal: colNumber === 1 ? 'center' : 'left', // 날짜는 가운데, 나머지는 왼쪽
        vertical: 'middle' 
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      
      // 출근시간과 퇴근시간은 가운데 정렬
      if (colNumber === 7 || colNumber === 8) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
      
      // 색상 우선순위: 연차 > 주말/공휴일 > 일반 상태
      if (isLeaveDay) {
        // 연차는 연녹색으로 표기
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE8F5E8' } // 연녹색
        };
      } else if (isSpecialDay) {
        // 주말/공휴일은 연붉은색으로 표기
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFE8E8' } // 연붉은색
        };
      }
    });
  });

  // 엑셀 파일을 Blob으로 변환
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { 
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
  });
}

// 요일 계산 함수
export function getDayOfWeek(dateString: string): string {
  const date = new Date(dateString);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return days[date.getDay()];
}

// 날짜 포맷팅 함수 (YYYY-MM-DD를 YYYY-MM-DD(요일)로 변환)
export function formatDateWithDay(dateString: string): string {
  const dayOfWeek = getDayOfWeek(dateString);
  return `${dateString}(${dayOfWeek})`;
}