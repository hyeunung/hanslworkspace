import { useVersionCheck } from '@/hooks/useVersionCheck'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import { RefreshCw } from 'lucide-react'

const typeConfig: Record<string, { dot: string; badge: string; label: string }> = {
  feature:     { dot: 'bg-blue-500',  badge: 'bg-blue-50 text-blue-700 border-blue-200',  label: '신규' },
  improvement: { dot: 'bg-green-500', badge: 'bg-green-50 text-green-700 border-green-200', label: '개선' },
  fix:         { dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200', label: '수정' },
  maintenance: { dot: 'bg-gray-400',  badge: 'bg-gray-50 text-gray-600 border-gray-200',  label: '유지보수' },
}

export default function UpdateNotificationModal() {
  const { showModal, newVersion, changelog, needsReload, applyUpdate } = useVersionCheck()

  const isOpen = showModal
  const version = newVersion
  const changes = changelog
  const onApply = applyUpdate

  if (!isOpen || !version) return null

  return (
    <Dialog open={isOpen}>
      <DialogContent
        maxWidth="sm:max-w-[360px]"
        showCloseButton={false}
        className="p-0 gap-0 business-radius-modal overflow-hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="px-7 pt-6 pb-3 flex items-center gap-2">
          <span className="badge-stats bg-hansl-50 text-hansl-700 border border-hansl-200">
            v{version.version}
          </span>
          <span className="text-[10px] text-gray-400">
            {formatDate(version.buildTime)}
          </span>
        </div>

        {/* Title */}
        <div className="px-7 pb-4">
          <h3 className="text-[13px] font-semibold text-gray-900 tracking-tight">
            업데이트 안내
          </h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            새로운 변경사항이 적용되었습니다.
          </p>
        </div>

        {/* Divider */}
        <div className="mx-7 border-t border-gray-100" />

        {/* Changes */}
        <div className="px-7 py-4 max-h-[240px] overflow-y-auto">
          {changes.length > 0 ? (
            <div className="space-y-3">
              {changes.map((entry) => (
                <div key={entry.version}>
                  {changes.length > 1 && (
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      {entry.title}
                    </p>
                  )}
                  <div className="space-y-1.5">
                    {entry.changes.map((change, i) => {
                      const cfg = typeConfig[change.type] || typeConfig.maintenance
                      return (
                        <div key={i} className="flex items-start gap-2 group">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[5px] ${cfg.dot}`} />
                          <span className="text-[11px] text-gray-700 leading-relaxed flex-1">
                            {change.text}
                          </span>
                          <span className={`badge-stats border flex-shrink-0 ${cfg.badge}`}>
                            {cfg.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-gray-500">
              시스템이 업데이트되었습니다.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-7 py-4 bg-gray-50/80 border-t border-gray-100 flex items-center justify-end">
          <button
            onClick={onApply}
            className="button-base bg-hansl-600 hover:bg-hansl-700 text-white transition-colors flex items-center gap-1"
          >
            {needsReload ? (
              <>
                <RefreshCw className="w-3 h-3" />
                업데이트
              </>
            ) : (
              '확인'
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString)
    const m = d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' })
    const t = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' })
    return `${m} ${t}`
  } catch {
    return ''
  }
}
