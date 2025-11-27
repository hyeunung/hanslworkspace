import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface BomMetadataFormProps {
  onProcess: (metadata: BomMetadata) => void;
  bomFileName: string;
  coordFileName: string;
}

export interface BomMetadata {
  boardName: string; // 파일명에서 자동 추출 또는 수동 입력
  artworkManager: string; // 현재 로그인한 사용자 (자동)
  productionManager: string; // 선택
  productionQuantity: number; // 입력
}

export default function BomMetadataForm({ onProcess, bomFileName, coordFileName }: BomMetadataFormProps) {
  const [boardName, setBoardName] = useState('');
  const [productionQuantity, setProductionQuantity] = useState<number>(100); // 기본값
  const [productionManager, setProductionManager] = useState('');
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [currentUser, setCurrentUser] = useState<{ email: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(true);

  const supabase = createClient();

  // 초기 데이터 로드 (직원 목록, 현재 사용자)
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoadingEmployees(true);
        
        // 직원 목록 로드 (status 컬럼이 없으므로 모든 직원 로드)
        const { data: empData, error: empError } = await supabase
          .from('employees')
          .select('id, name')
          .order('name');
        
        if (empError) {
          console.error('Error loading employees:', empError);
          toast.error('직원 목록을 불러오는데 실패했습니다.');
        } else {
          setEmployees(empData || []);
        }

        // 현재 사용자 정보 로드
        const { data: { user } } = await supabase.auth.getUser();
        if (user && user.email) {
          // 이메일로 직원 정보 찾기
          const { data: userData, error: userError } = await supabase
            .from('employees')
            .select('name')
            .eq('email', user.email)
            .single();
          
          if (userError) {
            console.error('Error loading current user:', userError);
          }
          
          setCurrentUser({
            email: user.email,
            name: userData?.name || user.email.split('@')[0]
          });
        }
      } catch (error) {
        console.error('Error in loadData:', error);
        toast.error('데이터를 불러오는데 실패했습니다.');
      } finally {
        setLoadingEmployees(false);
      }
    };

    loadData();
  }, [supabase]);

  // 파일명에서 보드 이름 추측 (단순한 휴리스틱)
  useEffect(() => {
    if (bomFileName) {
      // 확장자 제거
      let name = bomFileName.replace(/\.(xlsx|xls|bom)$/i, '');
      // 타임스탬프 제거 (업로드 시 붙은 경우)
      name = name.replace(/^\d+_bom_/, '');
      setBoardName(name);
    }
  }, [bomFileName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!boardName.trim()) {
      toast.error('보드 이름을 입력해주세요.');
      return;
    }

    if (productionQuantity <= 0) {
      toast.error('생산 수량은 1개 이상이어야 합니다.');
      return;
    }

    if (!currentUser) {
      toast.error('로그인 정보가 없습니다.');
      return;
    }

    setLoading(true);
    
    // 1초 정도 딜레이를 줘서 처리 중임을 인지시킴 (실제 처리는 상위 컴포넌트에서)
    setTimeout(() => {
      onProcess({
        boardName,
        artworkManager: currentUser.name, // 이메일 대신 이름 사용
        productionManager,
        productionQuantity
      });
      setLoading(false);
    }, 500);
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>BOM 정보 입력</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 파일 정보 (읽기 전용) */}
          <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg text-sm">
            <div>
              <span className="text-gray-500 block mb-1">BOM 파일</span>
              <span className="font-medium truncate block" title={bomFileName}>{bomFileName}</span>
            </div>
            <div>
              <span className="text-gray-500 block mb-1">좌표 파일</span>
              <span className="font-medium truncate block" title={coordFileName}>{coordFileName}</span>
            </div>
          </div>

          {/* 보드 이름 */}
          <div className="space-y-2">
            <Label htmlFor="boardName">보드 이름 (Board Name)</Label>
            <Input
              id="boardName"
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              placeholder="예: H24-001_MAIN_V1.0"
              required
            />
            <p className="text-xs text-gray-500">
              이 이름으로 발주 시스템에 등록됩니다. 중복되지 않는 고유한 이름을 입력해주세요.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Artwork 담당자 (자동) */}
            <div className="space-y-2">
              <Label>Artwork 담당자</Label>
              <Input
                value={currentUser?.name || '로딩 중...'}
                disabled
                className="bg-gray-100"
              />
            </div>

            {/* 생산 담당자 (선택) */}
            <div className="space-y-2">
              <Label htmlFor="productionManager">생산 담당자</Label>
              <Select 
                value={productionManager} 
                onValueChange={setProductionManager}
                disabled={loadingEmployees}
              >
                <SelectTrigger>
                  <SelectValue placeholder={
                    loadingEmployees 
                      ? "직원 목록 로딩 중..." 
                      : employees.length === 0 
                        ? "등록된 직원 없음" 
                        : "담당자 선택 (선택사항)"
                  } />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">선택 안 함</SelectItem>
                  {employees.length > 0 ? (
                    employees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.name}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="no-employees" disabled>
                      등록된 직원이 없습니다
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 생산 수량 */}
          <div className="space-y-2">
            <Label htmlFor="productionQuantity">생산 수량</Label>
            <div className="flex items-center gap-2">
              <Input
                id="productionQuantity"
                type="number"
                min="1"
                value={productionQuantity}
                onChange={(e) => setProductionQuantity(parseInt(e.target.value) || 0)}
                className="w-32"
                required
              />
              <span className="text-gray-500">SET</span>
            </div>
            <p className="text-xs text-gray-500">
              총 소요량은 <strong>[부품 SET 수량 × 생산 수량]</strong>으로 자동 계산됩니다.
            </p>
          </div>

          <div className="pt-4 border-t">
            <Button 
              type="submit" 
              className="button-base bg-hansl-600 hover:bg-hansl-700 text-white w-full disabled:opacity-50 disabled:cursor-not-allowed" 
              disabled={loading}
            >
              {loading ? '처리 준비 중...' : 'BOM 정리 및 생성하기'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}


