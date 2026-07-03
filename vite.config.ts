import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { versionPlugin } from './scripts/version-plugin'

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '')

  // 프리뷰 하네스가 PORT 환경변수로 포트를 지정하면 그 값을 사용(HMR은 기본값에 위임),
  // 아니면 기존 로컬 개발 설정(포트 3000, HMR 24678)을 유지
  const assignedPort = process.env.PORT ? Number(process.env.PORT) : undefined
  const devPort = assignedPort ?? 3000

  return {
  plugins: [react(), versionPlugin()],
    define: {
      // Expose OPENAI_API_KEY to the client
      'process.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY),
      'import.meta.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY)
    },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: devPort,
    strictPort: !!assignedPort,
    open: !assignedPort,
    middlewareMode: false,
    cors: true,
    // 프리뷰(PORT 지정) 모드에서는 HMR을 기본 포트에 위임해 24678 충돌을 피함
    hmr: assignedPort ? true : {
      port: 24678,
      clientPort: 24678
    },
    fs: {
      strict: false
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
  },
  preview: {
    port: 3000,
    open: true
  },
  }
})
// Force config reload to update __APP_VERSION__ to 0.7.1