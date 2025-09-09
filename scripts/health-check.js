#!/usr/bin/env node

/**
 * 시스템 전체 점검 스크립트
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const checks = [];
const issues = [];

// 색상 코드
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

function log(message, type = 'info') {
  const typeColors = {
    success: colors.green,
    error: colors.red,
    warning: colors.yellow,
    info: colors.blue,
    debug: colors.gray
  };
  console.log(`${typeColors[type] || ''}${message}${colors.reset}`);
}

async function checkItem(name, fn) {
  try {
    log(`\nChecking: ${name}`, 'info');
    const result = await fn();
    checks.push({ name, status: 'pass', ...result });
    log(`✅ PASS${result.detail ? `: ${result.detail}` : ''}`, 'success');
  } catch (error) {
    const errorMsg = error.message || 'Unknown error';
    checks.push({ name, status: 'fail', error: errorMsg });
    issues.push({ name, error: errorMsg });
    log(`❌ FAIL: ${errorMsg}`, 'error');
  }
}

async function runHealthCheck() {
  log('\n🏥 시스템 전체 점검 시작\n', 'info');
  log('================================', 'info');

  // 1. 환경변수 점검
  await checkItem('환경변수 설정', async () => {
    const required = [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY'
    ];
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) throw new Error(`누락된 환경변수: ${missing.join(', ')}`);
    return { detail: '모든 필수 환경변수 설정됨' };
  });

  // 2. Node.js 버전
  await checkItem('Node.js 버전', async () => {
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0]);
    if (major < 18) throw new Error(`Node.js 18+ 필요 (현재: ${version})`);
    return { detail: `${version} (정상)` };
  });

  // 3. package.json 파일
  await checkItem('package.json', async () => {
    const packagePath = path.join(__dirname, '..', 'package.json');
    if (!fs.existsSync(packagePath)) throw new Error('package.json 파일 없음');
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return { detail: `v${pkg.version} - ${Object.keys(pkg.dependencies || {}).length}개 의존성` };
  });

  // 4. Next.js 설정
  await checkItem('Next.js 설정', async () => {
    const configPath = path.join(__dirname, '..', 'next.config.js');
    if (!fs.existsSync(configPath)) throw new Error('next.config.js 파일 없음');
    return { detail: 'next.config.js 확인됨' };
  });

  // 5. TypeScript 설정
  await checkItem('TypeScript 설정', async () => {
    const tsconfigPath = path.join(__dirname, '..', 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) throw new Error('tsconfig.json 파일 없음');
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
    if (!tsconfig.compilerOptions.strict) {
      return { detail: 'strict 모드 비활성화 (권장: 활성화)' };
    }
    return { detail: 'TypeScript strict 모드 활성화' };
  });

  // 6. 데이터베이스 연결
  await checkItem('Supabase 연결', async () => {
    if (!supabaseUrl || !supabaseKey) throw new Error('Supabase 자격 증명 누락');
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { error } = await supabase.from('employees').select('count').single();
    if (error) throw new Error(`데이터베이스 연결 실패: ${error.message}`);
    return { detail: 'Supabase 연결 성공' };
  });

  // 7. 필수 테이블 확인
  await checkItem('데이터베이스 테이블', async () => {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const tables = [
      'employees',
      'vendors',
      'purchase_requests',
      'purchase_request_items',
      'vendor_contacts'
    ];
    
    for (const table of tables) {
      const { error } = await supabase.from(table).select('*').limit(1);
      if (error && !error.message.includes('no rows')) {
        throw new Error(`${table} 테이블 접근 실패`);
      }
    }
    return { detail: `${tables.length}개 테이블 정상` };
  });

  // 8. 빌드 디렉토리
  await checkItem('빌드 디렉토리', async () => {
    const nextDir = path.join(__dirname, '..', '.next');
    if (!fs.existsSync(nextDir)) {
      return { detail: '.next 디렉토리 없음 (첫 실행 또는 clean 후)' };
    }
    const stats = fs.statSync(nextDir);
    const sizeMB = Math.round(stats.size / 1024 / 1024);
    return { detail: `.next 디렉토리 존재` };
  });

  // 9. public 디렉토리
  await checkItem('정적 파일', async () => {
    const publicDir = path.join(__dirname, '..', 'public');
    if (!fs.existsSync(publicDir)) {
      return { detail: 'public 디렉토리 없음' };
    }
    const files = fs.readdirSync(publicDir);
    return { detail: `${files.length}개 정적 파일` };
  });

  // 10. API 라우트 확인
  await checkItem('API 라우트', async () => {
    const apiDir = path.join(__dirname, '..', 'src', 'app', 'api');
    if (!fs.existsSync(apiDir)) throw new Error('API 디렉토리 없음');
    
    // API 라우트 카운트
    let routeCount = 0;
    function countRoutes(dir) {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          countRoutes(fullPath);
        } else if (item === 'route.ts' || item === 'route.js') {
          routeCount++;
        }
      }
    }
    countRoutes(apiDir);
    
    return { detail: `${routeCount}개 API 엔드포인트` };
  });

  // 11. 페이지 라우트 확인
  await checkItem('페이지 라우트', async () => {
    const pagesDir = path.join(__dirname, '..', 'src', 'app', '(protected)');
    if (!fs.existsSync(pagesDir)) throw new Error('Protected 페이지 디렉토리 없음');
    
    const pages = fs.readdirSync(pagesDir).filter(item => {
      const stat = fs.statSync(path.join(pagesDir, item));
      return stat.isDirectory();
    });
    
    return { detail: `${pages.join(', ')}` };
  });

  // 12. ESLint 설정
  await checkItem('ESLint 설정', async () => {
    const eslintPath = path.join(__dirname, '..', '.eslintrc.json');
    if (!fs.existsSync(eslintPath)) {
      return { detail: 'ESLint 설정 없음 (권장: 설정)' };
    }
    const eslintConfig = JSON.parse(fs.readFileSync(eslintPath, 'utf8'));
    const hasNoConsole = eslintConfig.rules && eslintConfig.rules['no-console'];
    return { detail: hasNoConsole ? 'no-console 규칙 활성화' : 'ESLint 설정됨' };
  });

  // 13. Git 상태
  await checkItem('Git 저장소', async () => {
    const gitDir = path.join(__dirname, '..', '.git');
    if (!fs.existsSync(gitDir)) {
      return { detail: 'Git 저장소 아님' };
    }
    return { detail: 'Git 저장소 초기화됨' };
  });

  // 14. 메모리 사용량
  await checkItem('메모리 상태', async () => {
    const used = process.memoryUsage();
    const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
    if (heapUsedMB > 500) {
      return { detail: `${heapUsedMB}MB / ${heapTotalMB}MB (높음)` };
    }
    return { detail: `${heapUsedMB}MB / ${heapTotalMB}MB` };
  });

  // 15. 포트 사용
  await checkItem('포트 3000', async () => {
    const { exec } = require('child_process');
    return new Promise((resolve, reject) => {
      exec('lsof -i :3000', (error, stdout) => {
        if (error) {
          reject(new Error('포트 3000 사용 중 아님'));
        } else {
          const lines = stdout.trim().split('\n');
          if (lines.length > 1) {
            resolve({ detail: '개발 서버 실행 중' });
          } else {
            reject(new Error('개발 서버 실행 안됨'));
          }
        }
      });
    });
  });

  // 결과 요약
  log('\n================================', 'info');
  log('📊 점검 결과 요약\n', 'info');
  
  const passed = checks.filter(c => c.status === 'pass').length;
  const failed = checks.filter(c => c.status === 'fail').length;
  const total = checks.length;
  
  log(`총 검사: ${total}개`, 'info');
  log(`✅ 정상: ${passed}개`, 'success');
  if (failed > 0) {
    log(`❌ 문제: ${failed}개`, 'error');
    log('\n발견된 문제:', 'error');
    issues.forEach(issue => {
      log(`  - ${issue.name}: ${issue.error}`, 'error');
    });
  }

  // 권장사항
  log('\n💡 권장사항:', 'info');
  
  // TypeScript strict 모드
  const tsCheck = checks.find(c => c.name === 'TypeScript 설정');
  if (tsCheck && tsCheck.detail && tsCheck.detail.includes('비활성화')) {
    log('  1. TypeScript strict 모드 활성화 권장', 'warning');
  }

  // ESLint 설정
  const eslintCheck = checks.find(c => c.name === 'ESLint 설정');
  if (eslintCheck && eslintCheck.detail && eslintCheck.detail.includes('없음')) {
    log('  2. ESLint 설정 추가 권장', 'warning');
  }

  // Git 설정
  const gitCheck = checks.find(c => c.name === 'Git 저장소');
  if (gitCheck && gitCheck.detail && gitCheck.detail.includes('아님')) {
    log('  3. Git 저장소 초기화 권장 (git init)', 'warning');
  }

  // 개발 서버
  const portCheck = checks.find(c => c.name === '포트 3000');
  if (portCheck && portCheck.status === 'fail') {
    log('  4. 개발 서버 시작 필요 (npm run dev)', 'warning');
  }

  // 전체 상태
  if (failed === 0) {
    log('\n🎉 시스템 상태: 모두 정상!', 'success');
  } else if (failed <= 2) {
    log('\n⚠️ 시스템 상태: 대체로 양호 (일부 개선 필요)', 'warning');
  } else {
    log('\n🚨 시스템 상태: 문제 해결 필요', 'error');
  }

  process.exit(failed > 5 ? 1 : 0);
}

// 실행
runHealthCheck().catch(error => {
  log(`\n치명적 오류: ${error.message}`, 'error');
  process.exit(1);
});