/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// version-plugin에서 주입하는 전역 상수
declare const __APP_VERSION__: string
declare const __APP_BUILD_ID__: string
declare const __APP_BUILD_TIME__: string