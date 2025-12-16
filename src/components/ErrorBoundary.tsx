
import React, { Component, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';

function isChunkLoadError(error?: Error) {
  const msg = error?.message ?? '';
  return /Loading chunk|ChunkLoadError|dynamically imported module|Failed to fetch dynamically imported module|importing a module script failed|Expected a JavaScript-or-Wasm module script/i.test(
    msg
  );
}

function reloadOnceForChunkError() {
  try {
    const key = 'hansl:chunk-reload-ts';
    const last = Number(sessionStorage.getItem(key) || '0');
    const now = Date.now();
    // 무한 리로드 방지: 60초 내에는 한 번만 자동 새로고침
    if (!Number.isFinite(last) || now - last > 60_000) {
      sessionStorage.setItem(key, String(now));
      window.location.reload();
    }
  } catch {
    // sessionStorage 접근 실패(프라이빗 모드 등) 시 조용히 무시
  }
}

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('ErrorBoundary caught an error', error, {
      componentStack: errorInfo.componentStack,
      errorBoundary: true
    });

    // 배포 직후/캐시 꼬임 등으로 청크 로드에 실패하면 자동으로 1회 새로고침
    if (isChunkLoadError(error)) {
      logger.warn('Detected chunk load error; attempting single reload', { message: error.message });
      reloadOnceForChunkError();
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const chunkError = isChunkLoadError(this.state.error);

      return (
        <div className="min-h-[400px] flex items-center justify-center p-6">
          <div className="text-center max-w-md">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">문제가 발생했습니다</h2>
            <p className="text-gray-600 mb-4">
              {chunkError
                ? '앱 업데이트로 인해 필요한 파일을 불러오지 못했습니다. 페이지를 새로고침하면 해결됩니다.'
                : '예기치 않은 오류가 발생했습니다. 페이지를 새로고침하거나 다시 시도해주세요.'}
            </p>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="text-left mb-4 p-3 bg-gray-100 rounded text-sm">
                <summary className="cursor-pointer font-medium">오류 상세 정보</summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs">
                  {this.state.error.message}
                  {this.state.error.stack}
                </pre>
              </details>
            )}
            <div className="flex gap-2 justify-center">
              {chunkError ? (
                <>
                  <Button onClick={() => window.location.reload()}>페이지 새로고침</Button>
                  <Button variant="outline" onClick={this.handleReset}>다시 시도</Button>
                </>
              ) : (
                <>
                  <Button onClick={this.handleReset}>다시 시도</Button>
                  <Button variant="outline" onClick={() => window.location.reload()}>
                    페이지 새로고침
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;