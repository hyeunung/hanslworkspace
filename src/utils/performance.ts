// 성능 모니터링 유틸리티
import { logger } from '@/lib/logger';

class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private measurements: Map<string, number> = new Map();
  private readonly SLOW_THRESHOLD = 1000; // 1초 이상이면 느림

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  // 측정 시작
  startMeasure(key: string): void {
    this.measurements.set(key, performance.now());
  }

  // 측정 종료 및 로깅
  endMeasure(key: string, context?: string): number {
    const startTime = this.measurements.get(key);
    if (!startTime) {
      logger.warn('성능 측정 시작 시간을 찾을 수 없습니다', { key });
      return 0;
    }

    const duration = performance.now() - startTime;
    this.measurements.delete(key);

    const isSlowAction = duration > this.SLOW_THRESHOLD;
    const logLevel = isSlowAction ? 'warn' : 'debug';
    
    logger[logLevel](`⚡ 성능 측정: ${key}`, {
      duration: `${duration.toFixed(2)}ms`,
      context,
      isSlow: isSlowAction,
      threshold: `${this.SLOW_THRESHOLD}ms`
    });

    return duration;
  }

  // 비동기 함수 성능 측정
  async measureAsync<T>(key: string, fn: () => Promise<T>, context?: string): Promise<T> {
    this.startMeasure(key);
    try {
      const result = await fn();
      this.endMeasure(key, context);
      return result;
    } catch (error) {
      this.endMeasure(key, `Error: ${context}`);
      throw error;
    }
  }

  // 동기 함수 성능 측정
  measureSync<T>(key: string, fn: () => T, context?: string): T {
    this.startMeasure(key);
    try {
      const result = fn();
      this.endMeasure(key, context);
      return result;
    } catch (error) {
      this.endMeasure(key, `Error: ${context}`);
      throw error;
    }
  }
}

// 전역 인스턴스 생성
export const performanceMonitor = PerformanceMonitor.getInstance();

// Hook for measuring component render times
export const useRenderPerformance = (componentName: string) => {
  const measureRender = () => {
    performanceMonitor.startMeasure(`render-${componentName}`);
    // Use requestAnimationFrame to measure after render completion
    requestAnimationFrame(() => {
      performanceMonitor.endMeasure(`render-${componentName}`, 'Component render');
    });
  };

  return { measureRender };
};

// 탭 전환 성능 측정 헬퍼
export const measureTabSwitch = async (tabName: string, switchFn: () => Promise<void> | void) => {
  return performanceMonitor.measureAsync(
    `tab-switch-${tabName}`,
    async () => {
      const result = switchFn();
      if (result instanceof Promise) {
        await result;
      }
    },
    `Tab switch to ${tabName}`
  );
};

// 모달 로딩 성능 측정 헬퍼
export const measureModalLoad = async (modalName: string, loadFn: () => Promise<void> | void) => {
  return performanceMonitor.measureAsync(
    `modal-load-${modalName}`,
    async () => {
      const result = loadFn();
      if (result instanceof Promise) {
        await result;
      }
    },
    `Modal load: ${modalName}`
  );
};