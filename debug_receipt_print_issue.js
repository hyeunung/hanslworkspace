/**
 * 영수증 인쇄완료 기능 사용자별 차이점 디버깅 스크립트
 * 
 * 문제 상황:
 * - 정현웅: 인쇄완료 버튼 정상 작동 (백엔드 업데이트 됨)
 * - 이채령: 인쇄완료 버튼 눌러도 백엔드 업데이트 안됨
 * 
 * 이 스크립트는 브라우저 콘솔에서 실행하여 차이점을 분석합니다.
 */

// 디버깅 헬퍼 함수들
const ReceiptDebugger = {
  
  // 1. 현재 사용자 인증 정보 확인
  async checkAuthInfo() {
    console.log("=== 1. 사용자 인증 정보 확인 ===");
    
    try {
      const supabase = window.supabase || createClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError) {
        console.error("❌ Auth Error:", authError);
        return null;
      }
      
      console.log("✅ 사용자 인증 상태:", {
        id: user?.id,
        email: user?.email,
        created_at: user?.created_at,
        last_sign_in_at: user?.last_sign_in_at,
        app_metadata: user?.app_metadata,
        user_metadata: user?.user_metadata
      });
      
      return user;
    } catch (error) {
      console.error("❌ 인증 정보 확인 실패:", error);
      return null;
    }
  },
  
  // 2. 사용자 권한 정보 확인
  async checkUserPermissions(userEmail) {
    console.log("=== 2. 사용자 권한 정보 확인 ===");
    
    try {
      const supabase = window.supabase || createClient();
      const { data: employee, error } = await supabase
        .from('employees')
        .select('id, name, email, purchase_role, created_at, updated_at')
        .eq('email', userEmail)
        .single();
      
      if (error) {
        console.error("❌ Employee 조회 오류:", error);
        return null;
      }
      
      console.log("✅ 직원 정보:", employee);
      
      // 권한 계산
      const role = employee?.purchase_role || '';
      const isAppAdmin = role.includes('app_admin');
      const isHr = role.includes('hr');
      const isLeadBuyer = role.includes('lead buyer');
      const hasReceiptAccess = isAppAdmin || isHr || isLeadBuyer;
      
      console.log("✅ 권한 분석:", {
        purchase_role: role,
        isAppAdmin,
        isHr,
        isLeadBuyer,
        hasReceiptAccess,
        canPrint: hasReceiptAccess,
        canDelete: isAppAdmin
      });
      
      return employee;
    } catch (error) {
      console.error("❌ 권한 확인 실패:", error);
      return null;
    }
  },
  
  // 3. RLS 정책 테스트
  async testRLSPolicies(receiptId) {
    console.log("=== 3. RLS 정책 테스트 ===");
    
    try {
      const supabase = window.supabase || createClient();
      
      // SELECT 테스트
      console.log("🔍 SELECT 테스트...");
      const { data: selectData, error: selectError } = await supabase
        .from('purchase_receipts')
        .select('*')
        .eq('id', receiptId);
      
      if (selectError) {
        console.error("❌ SELECT 오류:", selectError);
      } else {
        console.log("✅ SELECT 성공:", selectData);
      }
      
      // UPDATE 테스트 (실제로 업데이트하지 않고 조건만 확인)
      console.log("🔍 UPDATE 권한 테스트...");
      const testUpdate = {
        is_printed: true,
        printed_at: new Date().toISOString(),
        printed_by: 'test-user-id',
        printed_by_name: 'Test User'
      };
      
      // 실제 업데이트 전에 조건 확인
      const { data: updateData, error: updateError } = await supabase
        .from('purchase_receipts')
        .update(testUpdate)
        .eq('id', receiptId)
        .select();
      
      if (updateError) {
        console.error("❌ UPDATE 오류:", updateError);
        
        // RLS 관련 오류인지 확인
        if (updateError.code === '42501' || updateError.message?.includes('policy')) {
          console.error("🚨 RLS 정책 위반 감지!");
        }
      } else {
        console.log("✅ UPDATE 성공:", updateData);
        
        // 테스트 업데이트 되돌리기
        await supabase
          .from('purchase_receipts')
          .update({
            is_printed: false,
            printed_at: null,
            printed_by: null,
            printed_by_name: null
          })
          .eq('id', receiptId);
        console.log("↩️ 테스트 업데이트 되돌림 완료");
      }
      
    } catch (error) {
      console.error("❌ RLS 테스트 실패:", error);
    }
  },
  
  // 4. 네트워크 요청 모니터링
  startNetworkMonitoring() {
    console.log("=== 4. 네트워크 요청 모니터링 시작 ===");
    
    // Fetch API 모니터링
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const [url, options] = args;
      
      if (url.includes('supabase') || url.includes('purchase_receipts')) {
        console.log("🌐 Network Request:", {
          url,
          method: options?.method || 'GET',
          headers: options?.headers,
          body: options?.body,
          timestamp: new Date().toISOString()
        });
      }
      
      const response = await originalFetch.apply(this, args);
      
      if (url.includes('supabase') || url.includes('purchase_receipts')) {
        console.log("📡 Network Response:", {
          url,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          timestamp: new Date().toISOString()
        });
        
        // 응답 복제해서 내용 확인
        const clonedResponse = response.clone();
        try {
          const responseText = await clonedResponse.text();
          if (responseText) {
            console.log("📄 Response Body:", responseText);
          }
        } catch (e) {
          console.log("📄 Response Body: (could not read)");
        }
      }
      
      return response;
    };
    
    console.log("✅ 네트워크 모니터링 활성화됨");
  },
  
  // 5. 브라우저 환경 정보 수집
  checkBrowserEnvironment() {
    console.log("=== 5. 브라우저 환경 정보 ===");
    
    const info = {
      userAgent: navigator.userAgent,
      cookieEnabled: navigator.cookieEnabled,
      localStorage: !!window.localStorage,
      sessionStorage: !!window.sessionStorage,
      online: navigator.onLine,
      language: navigator.language,
      platform: navigator.platform,
      url: window.location.href,
      timestamp: new Date().toISOString()
    };
    
    console.log("🌐 브라우저 환경:", info);
    
    // Local Storage 내용 확인
    console.log("💾 LocalStorage 내용:");
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.includes('supabase') || key?.includes('auth')) {
        console.log(`  ${key}:`, localStorage.getItem(key)?.substring(0, 100) + '...');
      }
    }
    
    // Session Storage 내용 확인
    console.log("🗂️ SessionStorage 내용:");
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.includes('supabase') || key?.includes('auth')) {
        console.log(`  ${key}:`, sessionStorage.getItem(key)?.substring(0, 100) + '...');
      }
    }
    
    return info;
  },
  
  // 6. 실제 인쇄완료 기능 테스트
  async testPrintCompletion(receiptId) {
    console.log("=== 6. 인쇄완료 기능 실제 테스트 ===");
    
    try {
      const supabase = window.supabase || createClient();
      
      // 현재 사용자 정보 가져오기
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error("❌ 사용자 정보 없음");
        return;
      }
      
      console.log("👤 현재 사용자:", user.email);
      
      // 사용자 이름 가져오기
      const { data: employee, error: empError } = await supabase
        .from('employees')
        .select('name')
        .eq('email', user.email)
        .single();
      
      if (empError) {
        console.error("❌ 직원 정보 조회 실패:", empError);
        return;
      }
      
      console.log("👤 직원 정보:", employee);
      
      // 업데이트 실행
      console.log("🔄 인쇄완료 업데이트 실행...");
      const updateData = {
        is_printed: true,
        printed_at: new Date().toISOString(),
        printed_by: user.id,
        printed_by_name: employee?.name || user.email
      };
      
      console.log("📝 업데이트 데이터:", updateData);
      
      const { data, error } = await supabase
        .from('purchase_receipts')
        .update(updateData)
        .eq('id', receiptId)
        .select();
      
      if (error) {
        console.error("❌ 업데이트 실패:", error);
        
        // 오류 상세 분석
        console.error("🔍 오류 분석:", {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint
        });
      } else {
        console.log("✅ 업데이트 성공:", data);
      }
      
    } catch (error) {
      console.error("❌ 테스트 실행 실패:", error);
    }
  },
  
  // 7. 전체 진단 실행
  async runFullDiagnosis(receiptId) {
    console.log("🔍 영수증 인쇄완료 기능 전체 진단 시작");
    console.log("📋 영수증 ID:", receiptId);
    console.log("⏰ 진단 시작 시간:", new Date().toISOString());
    console.log("=".repeat(60));
    
    // 네트워크 모니터링 시작
    this.startNetworkMonitoring();
    
    // 브라우저 환경 확인
    const browserInfo = this.checkBrowserEnvironment();
    
    // 사용자 인증 정보 확인
    const user = await this.checkAuthInfo();
    if (!user) return;
    
    // 사용자 권한 확인
    const employee = await this.checkUserPermissions(user.email);
    if (!employee) return;
    
    // RLS 정책 테스트
    if (receiptId) {
      await this.testRLSPolicies(receiptId);
    }
    
    console.log("=".repeat(60));
    console.log("🎯 진단 완료! 이제 인쇄완료 버튼을 클릭해보세요.");
    console.log("📊 네트워크 모니터링이 활성화되어 있습니다.");
    
    return {
      user,
      employee,
      browserInfo,
      timestamp: new Date().toISOString()
    };
  }
};

// 사용법 안내
console.log(`
🔧 영수증 인쇄완료 디버깅 스크립트 로드됨

📋 사용법:
1. 전체 진단 실행:
   ReceiptDebugger.runFullDiagnosis('영수증_ID')

2. 개별 테스트:
   ReceiptDebugger.checkAuthInfo()
   ReceiptDebugger.checkUserPermissions('user@email.com')
   ReceiptDebugger.testRLSPolicies('영수증_ID')
   ReceiptDebugger.checkBrowserEnvironment()
   ReceiptDebugger.startNetworkMonitoring()

3. 실제 인쇄완료 테스트:
   ReceiptDebugger.testPrintCompletion('영수증_ID')

⚠️  두 사용자(정현웅, 이채령)가 각각 이 스크립트를 실행하여
   결과를 비교해주세요.

🎯 사용 예시:
   ReceiptDebugger.runFullDiagnosis('receipt-id-here')
`);

// 전역에서 접근 가능하도록 설정
window.ReceiptDebugger = ReceiptDebugger;