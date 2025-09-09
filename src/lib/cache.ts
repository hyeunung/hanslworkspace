/**
 * Simple in-memory cache implementation
 * For production, consider using Redis or similar
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class CacheManager {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private static instance: CacheManager;

  private constructor() {}

  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  /**
   * Set cache entry
   */
  set<T>(key: string, data: T, ttl: number = 300000): void { // Default 5 minutes
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  /**
   * Get cache entry
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) return null;
    
    // Check if cache expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data as T;
  }

  /**
   * Invalidate cache entry
   */
  invalidate(key: string | RegExp): void {
    if (typeof key === 'string') {
      this.cache.delete(key);
    } else {
      // Invalidate all keys matching pattern
      const keysToDelete: string[] = [];
      this.cache.forEach((_, k) => {
        if (key.test(k)) {
          keysToDelete.push(k);
        }
      });
      keysToDelete.forEach(k => this.cache.delete(k));
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Cleanup expired entries
   */
  cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];
    
    this.cache.forEach((entry, key) => {
      if (now - entry.timestamp > entry.ttl) {
        keysToDelete.push(key);
      }
    });
    
    keysToDelete.forEach(key => this.cache.delete(key));
  }
}

// Cleanup expired cache entries every minute (browser only)
if (typeof window !== 'undefined') {
  setInterval(() => {
    CacheManager.getInstance().cleanup();
  }, 60000);
}

export const cache = CacheManager.getInstance();

/**
 * Cache decorator for async functions
 */
export function cached(ttl: number = 300000) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const cacheKey = `${target.constructor.name}.${propertyKey}:${JSON.stringify(args)}`;
      
      // Check cache
      const cachedResult = cache.get(cacheKey);
      if (cachedResult !== null) {
        return cachedResult;
      }
      
      // Call original method
      const result = await originalMethod.apply(this, args);
      
      // Cache result
      if (result && result.success) {
        cache.set(cacheKey, result, ttl);
      }
      
      return result;
    };
    
    return descriptor;
  };
}