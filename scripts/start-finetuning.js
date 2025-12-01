import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';

// 환경 변수 로드 (.env.local 우선)
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;

if (!apiKey) {
  console.error('❌ 오류: .env.local 파일에 OPENAI_API_KEY가 없습니다.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey });

async function main() {
  try {
    console.log('🚀 OpenAI 파인튜닝 시작 (재학습)...');
    console.log('1. 재학습 데이터 파일 업로드 중 (scripts/retraining-dataset.jsonl)...');

    const fileStream = fs.createReadStream('scripts/retraining-dataset.jsonl');
    
    const file = await openai.files.create({
      file: fileStream,
      purpose: 'fine-tune',
    });

    console.log(`✅ 파일 업로드 완료! ID: ${file.id}`);
    console.log('2. 학습 작업(Fine-tuning Job) 생성 중...');

    const fineTune = await openai.fineTuning.jobs.create({
      training_file: file.id,
      model: 'gpt-4o-mini-2024-07-18', // 최신 모델 사용 (비용 효율적)
      hyperparameters: {
        n_epochs: 3 // 데이터셋을 3번 반복 학습
      }
    });

    console.log(`\n🎉 학습이 시작되었습니다!`);
    console.log(`Job ID: ${fineTune.id}`);
    console.log(`Model: ${fineTune.model}`);
    console.log(`Status: ${fineTune.status}`);
    console.log('\n⏳ 학습에는 데이터 양에 따라 30분 ~ 수 시간이 소요될 수 있습니다.');
    console.log('학습이 완료되면 이메일로 알림이 옵니다.');

    // 자동화 스크립트를 위해 Job 정보 저장
    await fs.promises.writeFile('scripts/latest-job.json', JSON.stringify({
      id: fineTune.id,
      model: fineTune.model,
      status: fineTune.status,
      created_at: fineTune.created_at
    }, null, 2));
    
  } catch (error) {
    console.error('\n❌ 오류 발생:', error.message);
    if (error.message.includes('quota')) {
        console.error('=> 결제 정보나 크레딧 잔액을 확인해주세요.');
    }
  }
}

main();


