/**
 * Vite 플러그인: 빌드 시 version.json 자동 생성
 * - package.json 버전 + 빌드 타임스탬프로 고유 빌드 ID 생성
 * - public/version.json에 현재 빌드 정보 기록
 */
import { Plugin } from 'vite'
import fs from 'fs'
import path from 'path'

interface VersionInfo {
  version: string
  buildId: string
  buildTime: string
}

export function versionPlugin(): Plugin {
  let versionInfo: VersionInfo

  return {
    name: 'version-plugin',

    config(_, { command }) {
      const pkg = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8')
      )
      const buildTime = new Date().toISOString()
      const buildId = `${pkg.version}-${Date.now()}`

      versionInfo = {
        version: pkg.version,
        buildId,
        buildTime,
      }

      return {
        define: {
          '__APP_VERSION__': JSON.stringify(pkg.version),
          '__APP_BUILD_ID__': JSON.stringify(buildId),
          '__APP_BUILD_TIME__': JSON.stringify(buildTime),
        },
      }
    },

    configureServer() {
      // dev 서버 시작 시 public/version.json 생성 (HMR 재시작마다 갱신)
      const publicDir = path.resolve(process.cwd(), 'public')
      fs.writeFileSync(
        path.join(publicDir, 'version.json'),
        JSON.stringify(versionInfo, null, 2)
      )
    },

    writeBundle() {
      // 빌드 완료 후 dist/version.json 생성
      const outDir = path.resolve(process.cwd(), 'dist')
      fs.writeFileSync(
        path.join(outDir, 'version.json'),
        JSON.stringify(versionInfo, null, 2)
      )
    },
  }
}
