/**
 * 환경 변수 관련 유틸리티
 */

export const isDevelopment = import.meta.env.DEV || import.meta.env.NODE_ENV === 'development';
export const isProduction = import.meta.env.PROD || import.meta.env.NODE_ENV === 'production';

/**
 * 개발환경에서만 console.log 실행
 */
export const devLog = (...args: any[]) => {
  if (isDevelopment) {
    console.log(...args);
  }
};

/**
 * 개발환경에서만 console.error 실행 (중요한 에러는 항상 로깅)
 */
export const devError = (...args: any[]) => {
  if (isDevelopment) {
    console.error(...args);
  }
};

/**
 * 개발환경에서만 console.warn 실행
 */
export const devWarn = (...args: any[]) => {
  if (isDevelopment) {
    console.warn(...args);
  }
};