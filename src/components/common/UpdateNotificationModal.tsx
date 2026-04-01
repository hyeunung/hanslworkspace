import { useVersionCheck } from '@/hooks/useVersionCheck'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog'
import { Sparkles, ArrowUpCircle, Bug, Wrench, RefreshCw } from 'lucide-react'

const changeTypeConfig: Record<string, { icon: typeof Sparkles; label: string; color: string }> = {
  feature: { icon: Sparkles, label: '새 기능', color: 'text-blue-600 bg-blue-50' },
  improvement: { icon: ArrowUpCircle, label: '개선', color: 'text-green-600 bg-green-50' },
  fix: { icon: Bug, label: '버그 수정', color: 'text-amber-600 bg-amber-50' },
  maintenance: { icon: Wrench, label: '유지보수', color: 'text-gray-600 bg-gray-50' },
}

/**
 * 새 버전 배포 시 업데이트 알림 모달
 * - 변경사항을 타입별 아이콘으로 표시
 * - "나중에" / "지금 업데이트" 버튼
 */
export default function UpdateNotificationModal() {
  const { showModal, newVersion, changelog, dismissUpdate, applyUpdate } = useVersionCheck()

  if (!showModal || !newVersion) return null

  return (
    <Dialog open={showModal} onOpenChange={(open) => !open && dismissUpdate()}>
      <DialogContent maxWidth="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-hansl-50 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-hansl-600" />
            </div>
            <div>
              <DialogTitle>새 업데이트가 있습니다</DialogTitle>
              <DialogDescription>
                v{newVersion.version} &middot; {formatBuildTime(newVersion.buildTime)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <DialogBody>
          {changelog.length > 0 ? (
            <div className="space-y-4">
              {changelog.map((entry) => (
                <div key={entry.version}>
                  {changelog.length > 1 && (
                    <h4 className="text-sm font-medium text-gray-700 mb-2">
                      {entry.title}
                    </h4>
                  )}
                  <ul className="space-y-2">
                    {entry.changes.map((change, i) => {
                      const config = changeTypeConfig[change.type] || changeTypeConfig.maintenance
                      const Icon = config.icon
                      return (
                        <li key={i} className="flex items-start gap-2.5">
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0 mt-0.5 ${config.color}`}>
                            <Icon className="w-3.5 h-3.5" />
                          </span>
                          <span className="text-sm text-gray-700 leading-relaxed">
                            {change.text}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              시스템이 업데이트되었습니다. 새로고침하여 최신 버전을 사용하세요.
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          <button
            onClick={dismissUpdate}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
          >
            나중에
          </button>
          <button
            onClick={applyUpdate}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-hansl-600 hover:bg-hansl-700 rounded-lg transition-colors shadow-sm"
          >
            <RefreshCw className="w-4 h-4" />
            지금 업데이트
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatBuildTime(isoString: string): string {
  try {
    const date = new Date(isoString)
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Seoul',
    })
  } catch {
    return ''
  }
}
