/**
 * Logger utility for consistent logging across the application
 * Provides structured logging with different levels
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development';
  
  private log(level: LogLevel, message: string, context?: LogContext) {
    // In production, we could send logs to a service like Sentry or LogRocket
    // For now, we'll use console methods appropriately
    
    const timestamp = new Date().toISOString();
    const logData = {
      timestamp,
      level,
      message,
      ...context
    };

    if (this.isDevelopment) {
      switch (level) {
        case 'debug':
          break;
        case 'info':
          break;
        case 'warn':
          break;
        case 'error':
          break;
      }
    } else {
      // In production, only log warnings and errors
      if (level === 'warn' || level === 'error') {
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