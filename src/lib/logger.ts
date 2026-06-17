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
  
  private async persistLog(level: LogLevel, message: string, context?: LogContext) {
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      
      const { data: { session } } = await supabase.auth.getSession();
      const actor_id = session?.user?.id || null;
      const actor_email = session?.user?.email || null;
      
      let actor_name = '';
      if (typeof window !== 'undefined') {
        const userProfile = localStorage.getItem('user_profile');
        if (userProfile) {
          try {
            const parsed = JSON.parse(userProfile);
            actor_name = parsed.name || '';
          } catch {}
        }
      }

      const source = (context?.source as string) || 'frontend';
      const category = (context?.category as string) || 'system';
      const action = (context?.action as string) || level;
      const target_table = (context?.target_table as string) || null;
      const target_id = (context?.target_id as string) || null;
      
      const details: LogContext = {
        ...context,
        userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : undefined,
      };
      
      delete details.source;
      delete details.category;
      delete details.action;
      delete details.target_table;
      delete details.target_id;

      await supabase.from('system_activity_logs').insert({
        level,
        source,
        category,
        action,
        actor_id,
        actor_email,
        actor_name,
        target_table,
        target_id,
        message,
        details,
      });
    } catch (err) {
      console.error('Failed to persist log to database:', err);
    }
  }

  private log(level: LogLevel, message: string, context?: LogContext) {
    const timestamp = new Date().toISOString();
    
    // DB 로깅 비동기 실행 (에러/경고/정보 로그만)
    if (level !== 'debug') {
      this.persistLog(level, message, context);
    }

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
      // 프로덕션에서는 경고와 에러만 로깅
      switch (level) {
        case 'warn':
          console.warn(`⚠️ [${timestamp}] ${message}`, context || '');
          break;
        case 'error':
          console.error(`❌ [${timestamp}] ${message}`, context || '');
          break;
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