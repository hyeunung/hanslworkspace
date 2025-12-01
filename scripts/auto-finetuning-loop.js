import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

// 환경 변수 로드
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
if (!apiKey) {
  console.error('❌ 오류: API Key가 없습니다.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey });

const STATUS_FILE = './scripts/loop-status.json';
const RETRAINING_FILE = './scripts/retraining-dataset.jsonl';
const BOM_PROCESSOR_FILE = './src/utils/bom-processor.ts';
const BATCH_SCRIPT_FILE = './scripts/batch-process-and-compare-v3.js'; // V2로 변경

// 지연 함수
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runVerification() {
    console.log('\n🔍 [Step 1] 전수 검사 및 오답 수집 시작...');
    
    // 재학습 파일 초기화 (이번 턴의 오답만 수집하기 위해)
    if (fs.existsSync(RETRAINING_FILE)) {
        fs.unlinkSync(RETRAINING_FILE);
    }

    try {
        // 검사 스크립트를 spawn으로 실행하여 실시간 출력을 캡처 및 표시
        const { spawn } = await import('child_process');
        
        return new Promise((resolve, reject) => {
            // V3 스크립트 사용
            const child = spawn('node', ['scripts/batch-process-and-compare-v3.js']);
            
            child.stdout.on('data', (data) => {
                process.stdout.write(data); // 실시간 출력
            });

            child.stderr.on('data', (data) => {
                process.stderr.write(data);
            });

            child.on('close', (code) => {
                if (code !== 0) {
                    console.error(`검사 프로세스 종료 코드: ${code}`);
                }
                
                // 결과 파일 읽기
                if (fs.existsSync(STATUS_FILE)) {
                    const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
                    resolve(status);
                } else {
                    resolve({ success: 0, fail: 999 });
                }
            });
        });
    } catch (error) {
        console.error('❌ 검사 중 오류:', error.message);
        return { success: 0, fail: 999 };
    }
}

async function startFineTuning(currentModelId) {
    console.log('\n🧠 [Step 2] OpenAI 재학습 요청 시작...');
    
    if (!fs.existsSync(RETRAINING_FILE)) {
        console.log('⚠️ 학습할 데이터 파일이 없습니다.');
        return null;
    }

    // 파일 업로드
    console.log('   - 파일 업로드 중...');
    const fileStream = fs.createReadStream(RETRAINING_FILE);
    const file = await openai.files.create({
        file: fileStream,
        purpose: 'fine-tune',
    });
    
    // 학습 시작
    // 이전 라운드에서 생성된 모델(currentModelId)을 기반으로 추가 학습
    const baseModel = currentModelId || 'gpt-4o-mini-2024-07-18';
    console.log(`   - 학습 작업 생성 중 (Base Model: ${baseModel}, File ID: ${file.id})...`);
    
    const fineTune = await openai.fineTuning.jobs.create({
        training_file: file.id,
        model: baseModel, 
        hyperparameters: {
          n_epochs: 3
        }
    });

    console.log(`✅ 학습 요청 완료! (Job ID: ${fineTune.id})`);
    return fineTune.id;
}

async function waitForTraining(jobId) {
    console.log('\n⏳ [Step 3] 학습 완료 대기 중...');
    
    let lastStepLog = '';
    
    while (true) {
        try {
            const job = await openai.fineTuning.jobs.retrieve(jobId);
            
            if (job.status === 'succeeded') {
                console.log('\n🎉 학습 성공!');
                return job.fine_tuned_model;
            } else if (job.status === 'failed' || job.status === 'cancelled') {
                console.error(`\n❌ 학습 실패: ${job.error?.message || 'Unknown error'}`);
                return null;
            }

            // 진행 상황 표시
            const events = await openai.fineTuning.jobs.listEvents(jobId, { limit: 1 });
            if (events.data.length > 0) {
                const msg = events.data[0].message;
                if (msg !== lastStepLog) {
                    // 줄바꿈(\n)을 사용하여 확실하게 로그를 남김 (화면 멈춤 방지)
                    console.log(`   [${new Date().toLocaleTimeString()}] 상태: ${job.status} | 로그: ${msg}`);
                    lastStepLog = msg;
                }
            }
            
            await delay(10000); // 10초 대기
        } catch (e) {
            console.error('Polling Error:', e.message);
            await delay(10000);
        }
    }
}

function updateCodeFiles(newModelId) {
    console.log(`\n📝 [Step 4] 코드에 새 모델 ID 적용 (${newModelId})...`);
    
    const files = [BOM_PROCESSOR_FILE, BATCH_SCRIPT_FILE];
    
    files.forEach(filePath => {
        if (fs.existsSync(filePath)) {
            let content = fs.readFileSync(filePath, 'utf-8');
            // 기존 모델 ID 패턴 찾아서 교체 (ft:gpt-4o-mini... 패턴)
            const regex = /ft:gpt-4o-mini-[\w\-\:\.]+/g;
            
            if (content.match(regex)) {
                content = content.replace(regex, newModelId);
                fs.writeFileSync(filePath, content, 'utf-8');
                console.log(`   - ${path.basename(filePath)} 업데이트 완료`);
            } else {
                console.warn(`   ⚠️ ${path.basename(filePath)}에서 교체할 모델 ID를 찾지 못했습니다.`);
            }
        }
    });
}

async function main() {
    console.log('🚀 Auto-Iterative Fine-tuning Loop 시작');
    console.log('=======================================');
    
    let round = 1;
    // 초기 모델 ID 설정 (기본값 or 기존 파일에서 읽어오기)
    let currentModelId = 'gpt-4o-mini-2024-07-18'; 
    
    // [기존 코드에서 모델 ID 읽어오기 시도]
    try {
        if (fs.existsSync(BATCH_SCRIPT_FILE)) {
            const content = fs.readFileSync(BATCH_SCRIPT_FILE, 'utf-8');
            const match = content.match(/ft:gpt-4o-mini-[\w\-\:\.]+/);
            if (match) {
                currentModelId = match[0];
                console.log(`ℹ️ 기존 모델 ID 발견: ${currentModelId}`);
            }
        }
    } catch (e) {}

    while (true) {
        console.log(`\n🔄 [Round ${round}] 시작 (Current Model: ${currentModelId})`);
        
        // 1. 검사
        const status = await runVerification();
        
        // 이전 결과와 비교하여 진척도 분석
        if (fs.existsSync('./scripts/loop-status-prev.json')) {
            const prevStatus = JSON.parse(fs.readFileSync('./scripts/loop-status-prev.json', 'utf-8'));
            const diffSuccess = status.success - prevStatus.success;
            const diffFail = status.fail - prevStatus.fail;
            
            const signSuccess = diffSuccess > 0 ? '▲' : (diffSuccess < 0 ? '▼' : '-');
            const signFail = diffFail > 0 ? '▲' : (diffFail < 0 ? '▼' : '-');
            
            console.log(`\n📊 [결과 분석]`);
            console.log(`   - 성공: ${status.success}개 (${signSuccess} ${Math.abs(diffSuccess)})`);
            console.log(`   - 실패: ${status.fail}개 (${signFail} ${Math.abs(diffFail)})`);
            
            if (diffSuccess > 0) console.log(`   => 긍정적 신호! ${diffSuccess}개 더 맞췄습니다.`);
            else if (diffSuccess < 0) console.log(`   => 경고! ${Math.abs(diffSuccess)}개 까먹었습니다. (전체 복습 필요)`);
            else console.log(`   => 제자리걸음. (학습 정체 구간)`);
        } else {
            console.log(`   => 결과: 성공 ${status.success} / 실패 ${status.fail}`);
        }

        // 현재 상태를 '이전 상태'로 저장
        fs.writeFileSync('./scripts/loop-status-prev.json', JSON.stringify(status));
        
        // 2. 종료 조건 확인
        if (status.fail === 0) {
            console.log('\n🏆 축하합니다! 모든 케이스(113개) 검증에 성공했습니다!');
            console.log('프로그램을 종료합니다.');
            break;
        }
        
        console.log(`   => 아직 ${status.fail}개가 불일치합니다. 재학습을 진행합니다.`);
        
        // 3. 학습 시작
        const jobId = await startFineTuning(currentModelId);
        if (!jobId) {
            console.error('학습 시작 실패. 종료합니다.');
            break;
        }
        
        // 4. 대기
        const newModelId = await waitForTraining(jobId);
        if (!newModelId) {
            console.error('학습 실패로 인해 루프를 중단합니다.');
            break;
        }
        
        // 5. 적용
        updateCodeFiles(newModelId);
        currentModelId = newModelId; // [중요] 다음 라운드를 위해 모델 ID 업데이트
        
        console.log(`\n✨ Round ${round} 완료. 10초 후 다음 라운드 시작...`);
        await delay(10000);
        round++;
    }
}

main();

