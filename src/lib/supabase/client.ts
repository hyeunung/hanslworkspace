import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    // Missing Supabase environment variables - will show error on screen
    
    // Provide a more helpful error message on the page
    if (typeof window !== 'undefined') {
      const root = document.getElementById('root')
      if (root) {
        root.innerHTML = `
          <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
            <div style="max-width: 600px; text-align: center;">
              <h1 style="color: #ef4444; margin-bottom: 20px;">환경 변수 설정 필요</h1>
              <p style="color: #6b7280; margin-bottom: 30px;">
                Supabase 연결을 위한 환경 변수가 설정되지 않았습니다.
              </p>
              <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: left;">
                <h3 style="margin-bottom: 10px;">필요한 환경 변수:</h3>
                <ul style="list-style: none; padding: 0;">
                  <li style="margin-bottom: 5px;">• VITE_SUPABASE_URL</li>
                  <li>• VITE_SUPABASE_ANON_KEY</li>
                </ul>
              </div>
              <p style="color: #6b7280; margin-top: 20px; font-size: 14px;">
                Vercel 또는 Netlify 대시보드에서 환경 변수를 설정해주세요.
              </p>
            </div>
          </div>
        `
      }
    }
    
    // Return a dummy client to prevent crashes
    return createBrowserClient('https://placeholder.supabase.co', 'placeholder-key')
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}