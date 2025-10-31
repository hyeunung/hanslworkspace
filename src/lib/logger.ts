/**
 * Logger utility for consistent logging across the application
 * Provides structured logging with different levels
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private isDevelopment = import.meta.env.DEV || import.meta.env.NODE_ENV === 'development';
  
  private log(level: LogLevel, message: string, context?: LogContext) {
    const timestamp = new Date().toISOString();
    const logData = {
      timestamp,
      level,
      message,
      ...context
    };

    if (this.isDevelopment) {
      // 개발환경에서는 모든 로그 출력
      switch (level) {
        case 'debug':
          console.debug(`🔍 [${timestamp}] ${message}`, context || '');
          break;
        case 'info':
          console.info(`ℹ️ [${timestamp}] ${message}`, context || '');
          break;
        case 'warn':
          console.warn(`⚠️ [${timestamp}] ${message}`, context || '');
          break;
        case 'error':
          console.error(`❌ [${timestamp}] ${message}`, context || '');
          break;
      }
    } else {
      // 프로덕션에서는 경고와 에러만 로깅 (실제로는 외부 서비스로 전송)
      if (level === 'warn' || level === 'error') {
        // TODO: Send to external logging service (Sentry, LogRocket, etc.)
        console[level](`[${level.toUpperCase()}] ${message}`, logData);
      }
    }
  }

  debug(message: string, context?: LogContext) {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext) {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext) {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error | unknown, context?: LogContext) {
    const errorContext: LogContext = { ...context };
    
    if (error instanceof Error) {
      errorContext.errorName = error.name;
      errorContext.errorMessage = error.message;
      errorContext.errorStack = error.stack;
    } else if (error) {
      errorContext.error = error;
    }
    
    this.log('error', message, errorContext);
  }
}

export const logger = new Logger();