/**
 * 영수증 인쇄완료 기능 실시간 모니터링 유틸리티
 * 
 * 개발 환경에서 사용자별 차이점을 실시간으로 추적하고 분석합니다.
 */

import { createClient } from '@/lib/supabase/client';

interface DebugSession {
  sessionId: string;
  userEmail: string;
  userName: string;
  userRole: string;
  browserInfo: {
    userAgent: string;
    platform: string;
    language: string;
    cookieEnabled: boolean;
  };
  startTime: string;
  events: DebugEvent[];
}

interface DebugEvent {
  timestamp: string;
  type: 'auth' | 'permission' | 'update' | 'error' | 'network' | 'ui';
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  data: any;
}

class ReceiptDebugMonitor {
  private session: DebugSession | null = null;
  private isMonitoring = false;
  private supabase = createClient();

  /**
   * 디버깅 세션 시작
   */
  async startSession(): Promise<DebugSession | null> {
    try {
      console.log('🔍 [DebugMonitor] 디버깅 세션 시작...');

      // 사용자 인증 정보 확인
      const { data: { user }, error: authError } = await this.supabase.auth.getUser();
      if (authError || !user) {
        console.error('❌ [DebugMonitor] 사용자 인증 실패:', authError);
        return null;
      }

      // 직원 정보 조회
      const { data: employee, error: empError } = await this.supabase
        .from('employees')
        .select('name, purchase_role')
        .eq('email', user.email)
        .single();

      if (empError) {
        console.error('❌ [DebugMonitor] 직원 정보 조회 실패:', empError);
        return null;
      }

      // 세션 생성
      this.session = {
        sessionId: `debug_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userEmail: user.email || '',
        userName: employee?.name || user.email || '',
        userRole: employee?.purchase_role || '',
        browserInfo: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language,
          cookieEnabled: navigator.cookieEnabled
        },
        startTime: new Date().toISOString(),
        events: []
      };

      this.isMonitoring = true;

      // 초기 이벤트 기록
      this.logEvent('auth', 'success', '디버깅 세션 시작', {
        userId: user.id,
        userEmail: user.email,
        userName: employee?.name,
        userRole: employee?.purchase_role
      });

      // 네트워크 모니터링 시작
      this.startNetworkMonitoring();

      // 권한 상태 모니터링 시작
      this.startPermissionMonitoring();

      console.log('✅ [DebugMonitor] 디버깅 세션 활성화:', this.session);
      return this.session;

    } catch (error) {
      console.error('💥 [DebugMonitor] 세션 시작 실패:', error);
      return null;
    }
  }

  /**
   * 이벤트 로깅
   */
  logEvent(type: DebugEvent['type'], level: DebugEvent['level'], message: string, data?: any): void {
    if (!this.isMonitoring || !this.session) return;

    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type,
      level,
      message,
      data: data || {}
    };

    this.session.events.push(event);

    // 콘솔 출력
    const emoji = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : level === 'success' ? '✅' : 'ℹ️';
    console.log(`${emoji} [DebugMonitor:${type}] ${message}`, data);

    // 이벤트 제한 (메모리 절약)
    if (this.session.events.length > 100) {
      this.session.events = this.session.events.slice(-50);
    }
  }

  /**
   * 네트워크 요청 모니터링
   */
  private startNetworkMonitoring(): void {
    const originalFetch = window.fetch;
    
    window.fetch = async (...args) => {
      const [url, options] = args;
      const isSupabaseRequest = url.toString().includes('supabase') || url.toString().includes('purchase_receipts');

      if (isSupabaseRequest) {
        const requestInfo = {
          url: url.toString(),
          method: options?.method || 'GET',
          headers: options?.headers,
          timestamp: new Date().toISOString()
        };

        this.logEvent('network', 'info', `네트워크 요청: ${requestInfo.method} ${requestInfo.url}`, requestInfo);
      }

      try {
        const response = await originalFetch.apply(window, args);

        if (isSupabaseRequest) {
          const responseInfo = {
            url: url.toString(),
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            timestamp: new Date().toISOString()
          };

          this.logEvent('network', response.ok ? 'success' : 'error', 
            `네트워크 응답: ${responseInfo.status} ${responseInfo.statusText}`, responseInfo);
        }

        return response;
      } catch (error) {
        if (isSupabaseRequest) {
          this.logEvent('network', 'error', '네트워크 요청 실패', { url: url.toString(), error });
        }
        throw error;
      }
    };
  }

  /**
   * 권한 상태 모니터링
   */
  private startPermissionMonitoring(): void {
    // 페이지 포커스 이벤트 모니터링
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.checkPermissionStatus();
      }
    });

    // 주기적 권한 체크 (5분마다)
    setInterval(() => {
      this.checkPermissionStatus();
    }, 5 * 60 * 1000);
  }

  /**
   * 현재 권한 상태 확인
   */
  private async checkPermissionStatus(): Promise<void> {
    try {
      const { data: { user }, error: authError } = await this.supabase.auth.getUser();
      
      if (authError || !user) {
        this.logEvent('permission', 'error', '사용자 인증 상태 확인 실패', { authError });
        return;
      }

      const { data: employee, error: empError } = await this.supabase
        .from('employees')
        .select('name, purchase_role')
        .eq('email', user.email)
        .single();

      if (empError) {
        this.logEvent('permission', 'error', '직원 정보 조회 실패', { empError });
        return;
      }

      const role = employee?.purchase_role || '';
      const hasPermission = role.includes('app_admin') || role.includes('hr') || role.includes('lead buyer');

      this.logEvent('permission', 'info', '권한 상태 확인', {
        userId: user.id,
        userEmail: user.email,
        userName: employee?.name,
        role,
        hasPermission
      });

      // 세션 정보 업데이트
      if (this.session) {
        this.session.userRole = role;
      }

    } catch (error) {
      this.logEvent('permission', 'error', '권한 상태 확인 중 오류 발생', { error });
    }
  }

  /**
   * 인쇄완료 시도 추적
   */
  trackPrintCompletion(receiptId: string, receiptName: string): void {
    this.logEvent('ui', 'info', '인쇄완료 시도 시작', { receiptId, receiptName });
  }

  /**
   * 업데이트 결과 추적
   */
  trackUpdateResult(receiptId: string, success: boolean, error?: any, executionTime?: number): void {
    this.logEvent('update', success ? 'success' : 'error', 
      success ? '인쇄완료 업데이트 성공' : '인쇄완료 업데이트 실패', {
        receiptId,
        success,
        error,
        executionTime
      });
  }

  /**
   * 현재 세션 정보 가져오기
   */
  getSession(): DebugSession | null {
    return this.session;
  }

  /**
   * 세션 이벤트 내보내기
   */
  exportSessionData(): string {
    if (!this.session) return '';

    return JSON.stringify({
      ...this.session,
      exportedAt: new Date().toISOString()
    }, null, 2);
  }

  /**
   * 디버깅 세션 종료
   */
  stopSession(): void {
    if (this.session) {
      this.logEvent('auth', 'info', '디버깅 세션 종료', {
        sessionDuration: Date.now() - new Date(this.session.startTime).getTime(),
        totalEvents: this.session.events.length
      });

      console.log('📊 [DebugMonitor] 세션 요약:', {
        sessionId: this.session.sessionId,
        duration: Date.now() - new Date(this.session.startTime).getTime(),
        totalEvents: this.session.events.length,
        userInfo: {
          email: this.session.userEmail,
          name: this.session.userName,
          role: this.session.userRole
        }
      });
    }

    this.isMonitoring = false;
    this.session = null;
  }

  /**
   * 사용자별 비교 리포트 생성
   */
  generateComparisonReport(): string {
    if (!this.session) return '세션이 활성화되지 않았습니다.';

    const authEvents = this.session.events.filter(e => e.type === 'auth');
    const permissionEvents = this.session.events.filter(e => e.type === 'permission');
    const updateEvents = this.session.events.filter(e => e.type === 'update');
    const errorEvents = this.session.events.filter(e => e.level === 'error');

    return `
# 영수증 인쇄완료 디버깅 리포트

## 세션 정보
- 세션 ID: ${this.session.sessionId}
- 사용자: ${this.session.userName} (${this.session.userEmail})
- 권한: ${this.session.userRole}
- 시작 시간: ${this.session.startTime}
- 브라우저: ${this.session.browserInfo.userAgent}

## 이벤트 통계
- 총 이벤트: ${this.session.events.length}
- 인증 이벤트: ${authEvents.length}
- 권한 이벤트: ${permissionEvents.length}
- 업데이트 이벤트: ${updateEvents.length}
- 오류 이벤트: ${errorEvents.length}

## 최근 오류
${errorEvents.slice(-5).map(e => `- ${e.timestamp}: ${e.message}`).join('\n')}

## 권한 체크 결과
${permissionEvents.slice(-3).map(e => `- ${e.timestamp}: ${JSON.stringify(e.data, null, 2)}`).join('\n')}

---
리포트 생성 시간: ${new Date().toISOString()}
    `.trim();
  }
}

// 싱글톤 인스턴스
const debugMonitor = new ReceiptDebugMonitor();

// 개발 환경에서만 글로벌 접근 허용
if (process.env.NODE_ENV === 'development') {
  (window as any).ReceiptDebugMonitor = debugMonitor;
}

export default debugMonitor;