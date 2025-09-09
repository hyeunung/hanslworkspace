/**
 * Centralized Error Handler
 */

import { ServiceError, ErrorCodes, ApiError } from '@/types/api';
import { PostgrestError } from '@supabase/supabase-js';

export class ErrorHandler {
  /**
   * Handle Supabase/Postgres errors
   */
  static handleDatabaseError(error: PostgrestError | Error): ServiceError {
    if ('code' in error) {
      // PostgreSQL error codes
      switch (error.code) {
        case '23505': // Unique violation
          return new ServiceError(
            '중복된 데이터가 존재합니다.',
            ErrorCodes.DUPLICATE_RESOURCE,
            error
          );
        case '23503': // Foreign key violation
          return new ServiceError(
            '참조하는 데이터가 존재하지 않습니다.',
            ErrorCodes.DB_CONSTRAINT_ERROR,
            error
          );
        case '23502': // Not null violation
          return new ServiceError(
            '필수 입력 항목이 누락되었습니다.',
            ErrorCodes.MISSING_REQUIRED_FIELD,
            error
          );
        case '42501': // Insufficient privileges
          return new ServiceError(
            '권한이 부족합니다.',
            ErrorCodes.INSUFFICIENT_PERMISSIONS,
            error
          );
        case 'PGRST116': // Not found
          return new ServiceError(
            '요청한 데이터를 찾을 수 없습니다.',
            ErrorCodes.RESOURCE_NOT_FOUND,
            error
          );
        default:
          return new ServiceError(
            error.message || '데이터베이스 오류가 발생했습니다.',
            ErrorCodes.DB_QUERY_ERROR,
            error
          );
      }
    }
    
    return new ServiceError(
      error.message || '알 수 없는 오류가 발생했습니다.',
      ErrorCodes.UNKNOWN_ERROR,
      error
    );
  }

  /**
   * Handle validation errors
   */
  static handleValidationError(field: string, message: string): ServiceError {
    return new ServiceError(
      message,
      ErrorCodes.VALIDATION_ERROR,
      { field }
    );
  }

  /**
   * Format error for API response
   */
  static formatApiError(error: ServiceError | Error): ApiError {
    if (error instanceof ServiceError) {
      return {
        code: error.code,
        message: error.message,
        details: error.details,
        timestamp: new Date().toISOString()
      };
    }

    return {
      code: ErrorCodes.UNKNOWN_ERROR,
      message: error.message || '알 수 없는 오류가 발생했습니다.',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Log error for monitoring
   */
  static logError(error: Error | ServiceError, context?: Record<string, any>): void {
    const errorInfo = {
      timestamp: new Date().toISOString(),
      message: error.message,
      stack: error.stack,
      ...(error instanceof ServiceError && {
        code: error.code,
        details: error.details
      }),
      context
    };

    // In production, send to monitoring service
    if (process.env.NODE_ENV === 'production') {
      // Send to Sentry, LogRocket, etc.
    } else {
    }
  }
}