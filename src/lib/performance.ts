/**
 * Performance monitoring utilities
 */

interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: PerformanceMetric[] = [];
  private marks: Map<string, number> = new Map();

  private constructor() {}

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  /**
   * Start timing
   */
  mark(name: string): void {
    if (typeof performance !== 'undefined') {
      this.marks.set(name, performance.now());
    } else {
      this.marks.set(name, Date.now());
    }
  }

  /**
   * End timing and record metric
   */
  measure(name: string, metadata?: Record<string, any>): number {
    const startTime = this.marks.get(name);
    if (!startTime) {
      return 0;
    }

    const currentTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const duration = currentTime - startTime;
    this.marks.delete(name);

    const metric: PerformanceMetric = {
      name,
      duration,
      timestamp: Date.now(),
      metadata
    };

    this.metrics.push(metric);

    // Keep only last 100 metrics
    if (this.metrics.length > 100) {
      this.metrics.shift();
    }

    // Log slow operations
    if (duration > 1000) {
    }

    return duration;
  }

  /**
   * Get metrics summary
   */
  getSummary(): Record<string, {
    count: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
  }> {
    const summary: Record<string, any> = {};

    this.metrics.forEach(metric => {
      if (!summary[metric.name]) {
        summary[metric.name] = {
          durations: [],
          count: 0
        };
      }
      summary[metric.name].durations.push(metric.duration);
      summary[metric.name].count++;
    });

    // Calculate statistics
    Object.keys(summary).forEach(key => {
      const durations = summary[key].durations;
      summary[key] = {
        count: summary[key].count,
        avgDuration: durations.reduce((a: number, b: number) => a + b, 0) / durations.length,
        minDuration: Math.min(...durations),
        maxDuration: Math.max(...durations)
      };
    });

    return summary;
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
    this.marks.clear();
  }

  /**
   * Send metrics to monitoring service
   */
  async reportMetrics(): Promise<void> {
    if (process.env.NODE_ENV !== 'production') {
      return;
    }

    const summary = this.getSummary();
    
    // Send to monitoring service (e.g., Google Analytics, Datadog, etc.)
    // Example: await fetch('/api/metrics', { method: 'POST', body: JSON.stringify(summary) });
    
    // Clear after reporting
    this.clear();
  }
}

export const performanceMonitor = PerformanceMonitor.getInstance();

/**
 * Performance decorator for async functions
 */
export function monitored(name?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const metricName = name || `${target.constructor.name}.${propertyKey}`;
    
    descriptor.value = async function (...args: any[]) {
      performanceMonitor.mark(metricName);
      
      try {
        const result = await originalMethod.apply(this, args);
        performanceMonitor.measure(metricName, { 
          success: true,
          args: args.length > 0 ? args[0] : undefined 
        });
        return result;
      } catch (error) {
        performanceMonitor.measure(metricName, { 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
        throw error;
      }
    };
    
    return descriptor;
  };
}

// Report metrics every 5 minutes (browser only)
if (typeof window !== 'undefined') {
  setInterval(() => {
    performanceMonitor.reportMetrics();
  }, 300000);
}