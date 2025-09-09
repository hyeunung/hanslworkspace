import { useEffect, useRef } from 'react';
import { logger } from '@/lib/logger';

/**
 * Hook to monitor component render performance
 * Helps identify performance bottlenecks
 */
export function usePerformanceMonitor(componentName: string) {
  const renderCount = useRef(0);
  const renderStartTime = useRef<number>(0);

  useEffect(() => {
    renderCount.current += 1;
    const renderEndTime = performance.now();
    
    if (renderStartTime.current) {
      const renderTime = renderEndTime - renderStartTime.current;
      
      // Log slow renders (> 16ms which is one frame at 60fps)
      if (renderTime > 16) {
        logger.warn(`Slow render detected`, {
          component: componentName,
          renderTime: `${renderTime.toFixed(2)}ms`,
          renderCount: renderCount.current
        });
      }
    }
    
    // Set start time for next render
    renderStartTime.current = performance.now();
  });

  // Log excessive re-renders in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && renderCount.current > 10) {
      logger.warn(`Excessive re-renders detected`, {
        component: componentName,
        renderCount: renderCount.current
      });
    }
  }, [componentName]);
}