import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Package, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import BomUploadSection from './BomUploadSection';
import BomMetadataForm, { BomMetadata } from './BomMetadataForm';
import GeneratedPreviewPanel from './GeneratedPreviewPanel';
import CoordinatePreviewPanel from './CoordinatePreviewPanel';
import { BOMItem } from '@/utils/excel-generator';

export default function BomCoordinateMain() {
  const [step, setStep] = useState<'upload' | 'metadata' | 'processing' | 'preview'>('upload');
  
  // 업로드된 파일 정보
  const [fileInfo, setFileInfo] = useState<{
    bomUrl: string;
    coordUrl: string;
    bomName: string;
    coordName: string;
  } | null>(null);

  // 입력된 메타데이터
  const [metadata, setMetadata] = useState<BomMetadata | null>(null);
  
  // AI 처리 결과 데이터
  const [processedResult, setProcessedResult] = useState<any>(null);

  const supabase = createClient();


  // 1. 파일 업로드 완료 핸들러
  const handleUploadComplete = useCallback((bomUrl: string, coordUrl: string, bomName: string, coordName: string) => {
    setFileInfo({
      bomUrl,
      coordUrl,
      bomName,
      coordName
    });
    setStep('metadata');
  }, []);

  // 2. 메타데이터 입력 완료 및 AI 처리 시작 핸들러
  const handleProcessStart = useCallback(async (data: BomMetadata) => {
    if (!fileInfo) return;
    
    setMetadata(data);
    setStep('processing');
    
    try {
      // Edge Function이 없으므로 임시로 더미 데이터로 처리
      // TODO: 실제 Edge Function 구현 필요
      console.log('Processing BOM data locally...');
      
      // 2초 후 더미 결과 생성
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const dummyResult = {
        cadDrawingId: `cad_${Date.now()}`,
        processedData: {
          bomItems: [
            {
              lineNumber: 1,
              itemType: 'Capacitor',
              itemName: 'C0603-100nF',
              specification: 'Ceramic Capacitor 100nF 50V',
              setCount: 1,
              totalQuantity: data.productionQuantity * 10,
              stockQuantity: 0,
              checkStatus: '발주필요',
              refList: 'C1,C2,C3,C4,C5,C6,C7,C8,C9,C10',
              alternativeItem: '',
              remark: ''
            },
            {
              lineNumber: 2,
              itemType: 'Resistor',
              itemName: 'R0603-10K',
              specification: 'SMD Resistor 10K 1%',
              setCount: 1,
              totalQuantity: data.productionQuantity * 15,
              stockQuantity: 100,
              checkStatus: '재고충분',
              refList: 'R1,R2,R3,R4,R5,R6,R7,R8,R9,R10,R11,R12,R13,R14,R15',
              alternativeItem: 'R0603-10K-5%',
              remark: '5% 공차도 사용 가능'
            },
            {
              lineNumber: 3,
              itemType: 'IC',
              itemName: 'STM32F103',
              specification: 'Microcontroller STM32F103',
              setCount: 1,
              totalQuantity: data.productionQuantity * 1,
              stockQuantity: 5,
              checkStatus: '발주필요',
              refList: 'U1',
              alternativeItem: '',
              remark: 'Main MCU'
            },
            {
              lineNumber: 4,
              itemType: 'LED',
              itemName: 'LED0603-RED',
              specification: 'Red LED 0603',
              setCount: 1,
              totalQuantity: data.productionQuantity * 5,
              stockQuantity: 200,
              checkStatus: '재고충분',
              refList: 'LED1,LED2,LED3,LED4,LED5',
              alternativeItem: 'LED0603-ORANGE',
              remark: 'Indicator'
            },
            {
              lineNumber: 5,
              itemType: 'Connector',
              itemName: 'CONN-USB-C',
              specification: 'USB Type-C Connector',
              setCount: 1,
              totalQuantity: data.productionQuantity * 1,
              stockQuantity: 0,
              checkStatus: '발주필요',
              refList: 'J1',
              alternativeItem: '',
              remark: 'Power Input'
            }
          ],
          coordinates: [
            { refDes: 'C1', x: '10.5', y: '20.3', layer: 'TOP', rotation: '0' },
            { refDes: 'C2', x: '15.2', y: '20.3', layer: 'TOP', rotation: '0' },
            { refDes: 'R1', x: '10.5', y: '25.5', layer: 'TOP', rotation: '90' },
            { refDes: 'R2', x: '15.2', y: '25.5', layer: 'TOP', rotation: '90' },
            { refDes: 'U1', x: '30.0', y: '30.0', layer: 'TOP', rotation: '0' },
            { refDes: 'LED1', x: '40.5', y: '10.2', layer: 'TOP', rotation: '180' },
            { refDes: 'J1', x: '50.0', y: '50.0', layer: 'TOP', rotation: '0' }
          ]
        }
      };
      
      setProcessedResult(dummyResult);
      toast.success('BOM 분석 및 정리가 완료되었습니다. (테스트 데이터)');
      setStep('preview');

    } catch (error: any) {
      console.error('Processing error:', error);
      toast.error(`처리 중 오류가 발생했습니다: ${error.message}`);
      setStep('metadata'); // 실패 시 다시 입력 단계로
    }
  }, [fileInfo, supabase]);

  // 3. 데이터 수정 저장 핸들러 (개선됨: 삭제 후 입력)
  const handleSaveBOM = async (items: BOMItem[]) => {
    if (!processedResult?.cadDrawingId) return;

    try {
      // 1. 기존 아이템 삭제 (중복 방지)
      const { error: deleteError } = await supabase
        .from('bom_items')
        .delete()
        .eq('cad_drawing_id', processedResult.cadDrawingId);

      if (deleteError) throw deleteError;

      // 2. 수정된 아이템 삽입
      const { error: insertError } = await supabase
        .from('bom_items')
        .insert(
          items.map(item => ({
            cad_drawing_id: processedResult.cadDrawingId,
            line_number: item.lineNumber,
            item_type: item.itemType,
            item_name: item.itemName,
            specification: item.specification,
            set_count: item.setCount,
            total_quantity: item.totalQuantity,
            stock_quantity: item.stockQuantity,
            check_status: item.checkStatus,
            ref_list: item.refList,
            alternative_item: item.alternativeItem,
            remark: item.remark
          }))
        );

      if (insertError) throw insertError;
      
      // 3. 상태 업데이트 (UI 반영)
      setProcessedResult((prev: any) => ({
        ...prev,
        processedData: {
          ...prev.processedData,
          bomItems: items
        }
      }));

      toast.success('수정사항이 저장되었습니다.');

    } catch (error) {
      console.error('Save error:', error);
      toast.error('저장에 실패했습니다.');
    }
  };

  // 뒤로 가기
  const handleBack = () => {
    if (step === 'metadata') setStep('upload');
    if (step === 'preview') {
      if (confirm('이전 단계로 돌아가면 현재 분석 결과가 초기화될 수 있습니다. 계속하시겠습니까?')) {
        setStep('metadata');
        setProcessedResult(null);
      }
    }
  };

  return (
    <div className="w-full">
      {/* Header - 다른 탭과 동일한 스타일 */}
      <div className="mb-4">
        <div>
          <h1 className="page-title">BOM/좌표 정리</h1>
          <p className="page-subtitle" style={{marginTop:'-2px',marginBottom:'-4px'}}>BOM & Coordinate Management</p>
        </div>
      </div>

      {/* 단계 표시기 (Stepper) */}
      {step !== 'preview' && (
        <Card className="mb-4">
          <CardContent className="py-6">
            <div className="flex items-center justify-between max-w-2xl mx-auto relative">
              <div className="absolute left-0 top-1/2 w-full h-0.5 bg-gray-200 -z-10" />
            
            {['파일 업로드', '정보 입력', 'AI 분석 및 검토'].map((label, index) => {
              const currentStepIndex = ['upload', 'metadata', 'processing', 'preview'].indexOf(step);
              const displayIndex = step === 'processing' ? 1 : currentStepIndex;
              
              const isActive = index <= displayIndex;
              const isCurrent = index === displayIndex;
              
              return (
                <div key={label} className="flex flex-col items-center gap-2 bg-white px-2">
                  <div className={`
                    w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors
                    ${isActive ? 'bg-primary text-white' : 'bg-gray-100 text-gray-400'}
                    ${isCurrent ? 'ring-4 ring-primary/20' : ''}
                  `}>
                    {index + 1}
                  </div>
                  <span className={`text-xs font-medium ${isActive ? 'text-gray-900' : 'text-gray-400'}`}>
                    {label}
                  </span>
                </div>
              );
            })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 뒤로가기 버튼 */}
      {step !== 'upload' && step !== 'processing' && step !== 'preview' && (
        <Button 
          onClick={handleBack}
          className="button-base border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          이전 단계
        </Button>
      )}

      {/* 메인 컨텐츠 영역 */}
      <div>
        {step === 'upload' && (
          <div className="max-w-4xl mx-auto">
            <BomUploadSection onUploadComplete={handleUploadComplete} />
          </div>
        )}

        {step === 'metadata' && fileInfo && (
          <div className="max-w-2xl mx-auto">
            <BomMetadataForm 
              onProcess={handleProcessStart}
              bomFileName={fileInfo.bomName}
              coordFileName={fileInfo.coordName}
            />
          </div>
        )}

        {step === 'processing' && (
          <Card>
            <CardContent className="py-20">
              <div className="flex flex-col items-center justify-center">
                <Loader2 className="w-10 h-10 text-hansl-600 animate-spin mb-4" />
                <h3 className="header-title">AI가 BOM을 분석하고 있습니다</h3>
                <p className="page-subtitle mt-2">잠시만 기다려주세요... (약 30초 ~ 1분 소요)</p>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 'preview' && processedResult && (
          <div className="space-y-4 animate-in fade-in duration-500">
            {/* 결과 요약 헤더 */}
            <Card className="border-green-200 bg-green-50">
              <CardContent className="p-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-lg business-radius flex items-center justify-center">
                      <Package className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <h3 className="header-title text-green-900">분석 완료</h3>
                      <p className="page-subtitle text-green-700">
                        보드명: {metadata?.boardName} / 생산수량: {metadata?.productionQuantity} SET
                      </p>
                    </div>
                  </div>
                  <Button 
                    onClick={handleBack} 
                    className="button-base border border-green-200 bg-white text-green-700 hover:bg-green-100"
                  >
                    처음부터 다시 하기
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* 3-Panel Layout (좌: BOM, 우: 좌표) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* BOM 패널 (2/3 차지) */}
              <div className="lg:col-span-2">
                <GeneratedPreviewPanel 
                  bomItems={processedResult.processedData?.bomItems || []}
                  coordinates={processedResult.processedData?.coordinates || []}
                  boardName={metadata?.boardName || 'Board'}
                  onSave={handleSaveBOM}
                />
              </div>

              {/* 좌표 패널 (1/3 차지) */}
              <div className="lg:col-span-1">
                <CoordinatePreviewPanel 
                  coordinates={processedResult.processedData?.coordinates || []}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
