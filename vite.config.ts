import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '')

  return {
  plugins: [react()],
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
    port: 3000,
    open: true,
    middlewareMode: false,
    cors: true,
    hmr: {
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