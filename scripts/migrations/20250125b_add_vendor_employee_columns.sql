-- 업체 관리 기능을 위한 vendors 테이블 컬럼 추가
-- 2025-01-25 업체 및 직원 관리 기능 구현

-- vendors 테이블에 추가 컬럼들 추가 (존재하지 않는 경우에만)
DO $$
BEGIN
    -- business_number 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vendors' AND column_name = 'business_number') THEN
        ALTER TABLE vendors ADD COLUMN business_number VARCHAR(20) UNIQUE;
        CREATE INDEX IF NOT EXISTS idx_vendors_business_number ON vendors(business_number);
    END IF;

    -- representative 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vendors' AND column_name = 'representative') THEN
        ALTER TABLE vendors ADD COLUMN representative VARCHAR(100);
    END IF;

    -- contact_phone 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vendors' AND column_name = 'contact_phone') THEN
        ALTER TABLE vendors ADD COLUMN contact_phone VARCHAR(20);
    END IF;

    -- address 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vendors' AND column_name = 'address') THEN
        ALTER TABLE vendors ADD COLUMN address TEXT;
    END IF;

    -- email 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vendors' AND column_name = 'email') THEN
        ALTER TABLE vendors ADD COLUMN email VARCHAR(255);
    END IF;

    -- is_active 컬럼 추가 (기본값: true)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vendors' AND column_name = 'is_active') THEN
        ALTER TABLE vendors ADD COLUMN is_active BOOLEAN DEFAULT true NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_vendors_is_active ON vendors(is_active);
    END IF;
END $$;

-- employees 테이블에 추가 컬럼들 추가 (존재하지 않는 경우에만)
DO $$
BEGIN
    -- is_active 컬럼 추가 (기본값: true)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'employees' AND column_name = 'is_active') THEN
        ALTER TABLE employees ADD COLUMN is_active BOOLEAN DEFAULT true NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_employees_is_active ON employees(is_active);
    END IF;

    -- purchase_role 컬럼이 배열이 아닌 단일 값인지 확인하고 필요시 수정
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'employees' AND column_name = 'purchase_role' 
               AND data_type = 'ARRAY') THEN
        -- 배열 타입이면 텍스트로 변경
        ALTER TABLE employees ALTER COLUMN purchase_role TYPE TEXT USING purchase_role[1];
    END IF;

    -- purchase_role에 인덱스 추가
    CREATE INDEX IF NOT EXISTS idx_employees_purchase_role ON employees(purchase_role);
    
    -- email에 인덱스 추가 (로그인 성능 향상)
    CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);
END $$;

-- 업체명에 인덱스 추가 (검색 성능 향상)
CREATE INDEX IF NOT EXISTS idx_vendors_vendor_name ON vendors(vendor_name);

-- 직원 이름에 인덱스 추가 (검색 성능 향상)
CREATE INDEX IF NOT EXISTS idx_employees_name ON employees(name);

-- 부서, 직급에 인덱스 추가 (필터링 성능 향상)
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
CREATE INDEX IF NOT EXISTS idx_employees_position ON employees(position);

-- 코멘트 추가
COMMENT ON COLUMN vendors.business_number IS '사업자등록번호';
COMMENT ON COLUMN vendors.representative IS '대표자명';
COMMENT ON COLUMN vendors.contact_phone IS '연락처';
COMMENT ON COLUMN vendors.address IS '주소';
COMMENT ON COLUMN vendors.email IS '이메일';
COMMENT ON COLUMN vendors.is_active IS '활성 상태';

COMMENT ON COLUMN employees.is_active IS '활성 상태';
COMMENT ON COLUMN employees.purchase_role IS '구매 권한 (app_admin, ceo, final_approver, middle_manager, lead buyer, buyer)';

-- RLS(Row Level Security) 정책 확인 및 추가
-- vendors 테이블에 대한 정책
DO $$
BEGIN
    -- vendors 테이블 RLS 활성화
    ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
    
    -- 정책이 존재하지 않으면 추가
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendors' AND policyname = 'vendors_policy') THEN
        CREATE POLICY vendors_policy ON vendors
        FOR ALL USING (true);  -- 모든 인증된 사용자가 접근 가능
    END IF;
    
    -- employees 테이블 RLS 활성화 (이미 있을 수 있음)
    ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
    
    -- employees 정책이 존재하지 않으면 추가
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'employees' AND policyname = 'employees_policy') THEN
        CREATE POLICY employees_policy ON employees
        FOR ALL USING (true);  -- 모든 인증된 사용자가 접근 가능
    END IF;
END $$;