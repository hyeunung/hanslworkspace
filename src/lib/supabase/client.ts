import { createBrowserClient } from '@supabase/ssr'

// 싱글톤 패턴으로 클라이언트 중복 생성 방지
let supabaseClient: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  // 이미 생성된 클라이언트가 있으면 재사용
  if (supabaseClient) {
    return supabaseClient
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    // Missing Supabase environment variables - will show error on screen
    
    // Provide a more helpful error message on the page
    if (typeof window !== 'undefined') {
      const root = document.getElementById('root')
      if (root) {
        root.innerHTML = `
          <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; background-color: #f9fafb;">
            <div style="max-width: 700px; text-align: center; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
              <h1 style="color: #ef4444; margin-bottom: 20px; font-size: 28px;">⚠️ 환경 변수 설정 필요</h1>
              <p style="color: #4b5563; margin-bottom: 30px; font-size: 18px;">
                Supabase 연결을 위한 환경 변수가 설정되지 않았습니다.
              </p>
              <div style="background: #fef3c7; padding: 25px; border-radius: 8px; text-align: left; margin-bottom: 30px; border: 1px solid #fcd34d;">
                <h3 style="margin-bottom: 15px; color: #92400e; font-size: 18px;">📋 설정 방법:</h3>
                <ol style="padding-left: 20px; color: #78350f; line-height: 1.8;">
                  <li style="margin-bottom: 10px;">프로젝트 루트에 <code style="background: #fff; padding: 2px 6px; border-radius: 4px; font-family: monospace;">.env</code> 파일을 생성하세요</li>
                  <li style="margin-bottom: 10px;">다음 내용을 추가하세요:
                    <pre style="background: #1f2937; color: #f3f4f6; padding: 15px; border-radius: 6px; margin-top: 10px; font-size: 14px;">VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here</pre>
                  </li>
                  <li style="margin-bottom: 10px;">Supabase 대시보드에서 실제 URL과 키를 복사하여 붙여넣으세요</li>
                  <li>개발 서버를 재시작하세요: <code style="background: #fff; padding: 2px 6px; border-radius: 4px; font-family: monospace;">npm run dev</code></li>
                </ol>
              </div>
              <div style="background: #dbeafe; padding: 20px; border-radius: 8px; border: 1px solid #93c5fd;">
                <p style="color: #1e3a8a; margin: 0; font-size: 14px;">
                  💡 <strong>참고:</strong> .env 파일은 git에 커밋되지 않습니다. 
                  팀원들과 별도로 공유하세요.
                </p>
              </div>
            </div>
          </div>
        `
      }
    }
    
    // Return a dummy client to prevent crashes
    supabaseClient = createBrowserClient('https://placeholder.supabase.co', 'placeholder-key')
    return supabaseClient
  }

  // 정상적인 클라이언트 생성 및 캐싱
  supabaseClient = createBrowserClient(supabaseUrl, supabaseAnonKey)
  return supabaseClient
}