import dotenv from 'dotenv';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

// 환경 변수 로드
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
const jobId = 'ftjob-i0RKsxqtMf8nuP9453pFBBli'; // 방금 생성된 Job ID

if (!apiKey) {
  console.error('❌ 오류: API Key가 없습니다.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey });

async function checkStatus() {
  try {
    console.log(`🔍 최근 Fine-tuning 작업 조회 중...`);
    
    // 최근 10개 작업 조회
    const list = await openai.fineTuning.jobs.list({ limit: 10 });
    
    if (list.data.length === 0) {
      console.log('❌ 생성된 Fine-tuning 작업이 없습니다.');
      return;
    }

    // 가장 최신 작업 가져오기
    const job = list.data[0];
    console.log(`\n👉 가장 최신 작업 (Job ID: ${job.id})`);

    console.log(`\n--------------------------------`);
    console.log(`Status: ${job.status.toUpperCase()}`); // validating_files, queued, running, succeeded, failed
    console.log(`Model: ${job.model}`);
    console.log(`Created At: ${new Date(job.created_at * 1000).toLocaleString()}`);
    
    if (job.finished_at) {
      console.log(`Finished At: ${new Date(job.finished_at * 1000).toLocaleString()}`);
    }

    // 이벤트 로그 조회 (실시간 진행 상황)
    console.log(`\n📋 진행 로그 (최신순):`);
    const events = await openai.fineTuning.jobs.listEvents(job.id, { limit: 10 }); // 넉넉하게 10개 조회
    
    let currentStep = 0;
    let totalStep = 0;
    let lastStepLog = '';

    events.data.forEach(event => {
        console.log(`[${new Date(event.created_at * 1000).toLocaleTimeString()}] ${event.message}`);
        
        // Step 정보 파싱 (예: "Step 10/100: training loss=0.123")
        if (!totalStep) {
            const match = event.message.match(/Step (\d+)\/(\d+)/);
            if (match) {
                currentStep = parseInt(match[1]);
                totalStep = parseInt(match[2]);
                lastStepLog = event.message;
            }
        }
    });

    // 퍼센트 계산 및 표시
    if (job.status === 'running' || job.status === 'queued' || job.status === 'validating_files') {
        console.log(`\n📊 [진행률 대시보드]`);
        if (totalStep > 0) {
            const percent = ((currentStep / totalStep) * 100).toFixed(1);
            const progressBarLength = 20;
            const filledLength = Math.round((progressBarLength * currentStep) / totalStep);
            const bar = '█'.repeat(filledLength) + '░'.repeat(progressBarLength - filledLength);
            
            console.log(`진행률: ${percent}% [${bar}]`);
            console.log(`단계  : Step ${currentStep} / ${totalStep}`);
            console.log(`상태  : ${lastStepLog}`);
        } else {
            console.log(`상태  : 준비 중... (Step 정보가 아직 나오지 않았습니다)`);
            if (job.status === 'validating_files') console.log('       현재 파일 유효성 검사 중입니다.');
            if (job.status === 'queued') console.log('       대기열에 등록되어 곧 시작됩니다.');
        }
    }

    if (job.status === 'succeeded') {
      console.log(`\n🎉 학습 완료!`);
      console.log(`✅ 생성된 모델 이름: ${job.fine_tuned_model}`);
      console.log(`\n👉 이제 이 모델 이름을 소스코드(src/utils/bom-processor.ts)에 적용하세요.`);
    } else if (job.status === 'failed') {
      console.log(`\n❌ 학습 실패. 오류 메시지를 확인하세요.`);
      console.log(job.error);
    } else {
      console.log(`\n⏳ 아직 진행 중입니다. 잠시 후 다시 확인해보세요.`);
    }
    console.log(`--------------------------------\n`);

  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkStatus();

