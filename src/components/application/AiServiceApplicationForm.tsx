import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createClient } from "@/lib/supabase/client";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { ko } from "date-fns/locale";

const CURRENT_USAGE_OPTIONS = [
  { value: "free_version", label: "무료 버전 사용 중" },
  { value: "paid_personal", label: "유료(개인) 사용 중" },
  { value: "not_used", label: "미사용" },
];

const AI_SERVICE_NOTICE = `• 신청 전 해당 AI 서비스의 이용약관 및 보안 정책을 확인해 주세요.
• 업무 활용 목적에 한해 지원하며, 개인 용도는 제외됩니다.
• 승인 후 사용 내역은 정기적으로 검토될 수 있습니다.`;

interface CurrentUser {
  id: string;
  name: string | null;
  department: string | null;
}

export default function AiServiceApplicationForm() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formServiceName, setFormServiceName] = useState("");
  const [formPlanName, setFormPlanName] = useState("");
  const [formMonthlyCost, setFormMonthlyCost] = useState("");
  const [formUsagePurpose, setFormUsagePurpose] = useState("");
  const [formUsageExample, setFormUsageExample] = useState("");
  const [formCurrentUsage, setFormCurrentUsage] = useState<
    "free_version" | "paid_personal" | "not_used"
  >("not_used");
  const [formCurrentModel, setFormCurrentModel] = useState("");
  const [formCurrentCost, setFormCurrentCost] = useState("");
  const [identityVerified, setIdentityVerified] = useState(false);
  const navigate = useNavigate();

  const loadCurrentUser = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        setCurrentUser(null);
        return;
      }
      const { data, error } = await supabase
        .from("employees")
        .select("id, name, department")
        .eq("email", user.email)
        .single();
      if (error) throw error;
      setCurrentUser(data as CurrentUser);
    } catch (err) {
      logger.error("현재 사용자 조회 실패", err);
      setCurrentUser(null);
    } finally {
      setLoadingUser(false);
    }
  }, []);

  useEffect(() => {
    loadCurrentUser();
  }, [loadCurrentUser]);

  const requesterName = currentUser?.name ?? "";
  const requesterDepartment = currentUser?.department ?? "";
  const applicationDate = format(new Date(), "yyyy-MM-dd", { locale: ko });

  const paidPersonalFieldsOk =
    formCurrentUsage !== "paid_personal" ||
    (formCurrentModel.trim() && formCurrentCost.trim());

  const allFieldsFilled =
    !loadingUser &&
    requesterName.trim() &&
    requesterDepartment.trim() &&
    formServiceName.trim() &&
    formPlanName.trim() &&
    formMonthlyCost.trim() &&
    formUsagePurpose.trim() &&
    formUsageExample.trim() &&
    formCurrentUsage &&
    paidPersonalFieldsOk;

  const identityButtonDisabled = !allFieldsFilled;
  const submitDisabled = submitting || !allFieldsFilled || !identityVerified;

  const handleIdentityVerify = () => {
    if (identityButtonDisabled) return;
    setIdentityVerified(true);
    toast.success("본인확인이 완료되었습니다.");
  };

  const handleFieldChange = (setter: (v: string) => void, value: string) => {
    setIdentityVerified(false);
    setter(value);
  };

  const handleSubmit = async () => {
    if (submitDisabled) return;
    if (!requesterName.trim() || !requesterDepartment.trim()) {
      toast.error("이름, 부서 정보를 불러올 수 없습니다. 다시 로그인해 주세요.");
      return;
    }

    try {
      setSubmitting(true);
      const supabase = createClient();
      const { error } = await supabase.from("ai_service_applications").insert({
        requester_id: currentUser?.id ?? null,
        requester_name: requesterName.trim(),
        requester_department: requesterDepartment.trim(),
        application_date: applicationDate,
        service_name: formServiceName.trim(),
        plan_name: formPlanName.trim(),
        monthly_cost: formMonthlyCost.trim(),
        usage_purpose: formUsagePurpose.trim(),
        usage_example: formUsageExample.trim(),
        current_usage_status: formCurrentUsage,
        current_model: formCurrentUsage === "paid_personal" ? formCurrentModel.trim() || null : null,
        current_cost: formCurrentUsage === "paid_personal" ? formCurrentCost.trim() || null : null,
      });
      if (error) throw error;
      toast.success("신청서가 제출되었습니다.");
      navigate("/application?tab=history");
      setFormServiceName("");
      setFormPlanName("");
      setFormMonthlyCost("");
      setFormUsagePurpose("");
      setFormUsageExample("");
      setFormCurrentUsage("not_used");
      setFormCurrentModel("");
      setFormCurrentCost("");
      setIdentityVerified(false);
    } catch (err) {
      logger.error("업무용 AI 신청서 제출 실패", err);
      toast.error("신청서 제출에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full max-w-none mx-0 px-3 sm:px-4 lg:px-5 pb-6">
        <div className="mb-4">
          <Link
            to="/application"
            className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-hansl-600 mb-2"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            신청서 목록
          </Link>
          <h1 className="page-title text-gray-900">업무용 AI 서비스 사용 지원 신청서</h1>
          <p className="page-subtitle text-gray-600 mt-1" style={{ marginTop: "-2px", marginBottom: "-4px" }}>
            AI Service Usage Support Application
          </p>
        </div>

        <div className="doc-form">
          <div className="doc-form-header">
            <h1>업무용 AI 서비스 사용 지원 신청서</h1>
            <div className="doc-subtitle">AI Service Usage Support Application</div>
          </div>

          <div className="doc-form-body">
            {/* 신청자 정보 - 로그인 사용자로 자동 입력 */}
            <div className="doc-form-row">
              <div className="doc-form-cell">
                <div className="doc-form-cell-label doc-form-cell-label-title">이름</div>
                <div className="doc-form-static">{loadingUser ? "로딩 중..." : requesterName || "— (직원 정보 없음)"}</div>
              </div>
              <div className="doc-form-cell">
                <div className="doc-form-cell-label doc-form-cell-label-title">부서</div>
                <div className="doc-form-static">{loadingUser ? "로딩 중..." : requesterDepartment || "— (직원 정보 없음)"}</div>
              </div>
              <div className="doc-form-cell">
                <div className="doc-form-cell-label doc-form-cell-label-title">신청일</div>
                <div className="doc-form-static">{applicationDate}</div>
              </div>
            </div>

            {/* 사용 예정 서비스 */}
            <div className="doc-form-row">
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">서비스명 <span className="required">*</span></div>
                <Input
                  value={formServiceName}
                  onChange={(e) => handleFieldChange(setFormServiceName, e.target.value)}
                  placeholder="예: ChatGPT Plus, Claude Pro, Midjourney 등"
                  className="doc-form-input"
                />
              </div>
            </div>
            <div className="doc-form-row">
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">요금제 (Plan) <span className="required">*</span></div>
                <Input
                  value={formPlanName}
                  onChange={(e) => handleFieldChange(setFormPlanName, e.target.value)}
                  placeholder="예: Team Plan, Pro Plan"
                  className="doc-form-input"
                />
              </div>
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">월 예상 비용 <span className="required">*</span></div>
                <Input
                  value={formMonthlyCost}
                  onChange={(e) => handleFieldChange(setFormMonthlyCost, e.target.value)}
                  placeholder="예: $20, 30,000원"
                  className="doc-form-input"
                />
              </div>
            </div>

            {/* 사용 목적 */}
            <div className="doc-form-row">
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">사용 목적 (업무 활용 용도) <span className="required">*</span></div>
                <textarea
                  value={formUsagePurpose}
                  onChange={(e) => handleFieldChange(setFormUsagePurpose, e.target.value)}
                  placeholder="해당 AI 서비스를 어떤 업무에 구체적으로 활용할 계획인지 작성해주세요.작성 예시: 마케팅 카피라이팅 초안 작성, 코드 리팩토링 및 버그 탐색, 회의록 요약 등"
                  className="doc-form-textarea"
                  rows={3}
                />
              </div>
            </div>

            {/* 활용 예정/실제 사례 */}
            <div className="doc-form-row">
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">활용 예정/실제 사례 <span className="required">*</span></div>
                <textarea
                  value={formUsageExample}
                  onChange={(e) => handleFieldChange(setFormUsageExample, e.target.value)}
                  placeholder="실제 업무 프로세스에 어떻게 적용할 것인지, 혹은 현재 테스트 중인 사례가 있다면 작성해주세요."
                  className="doc-form-textarea"
                  rows={3}
                />
              </div>
            </div>

            {/* 현재 사용 여부 */}
            <div className="doc-form-row">
              <div className="doc-form-cell">
                <div className="doc-form-cell-label">현재 사용 여부 <span className="required">*</span></div>
                <div className="flex flex-wrap gap-4 pt-1">
                  {CURRENT_USAGE_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex items-center gap-1.5 cursor-pointer text-[11px] text-gray-700"
                    >
                      <input
                        type="radio"
                        name="current_usage"
                        value={opt.value}
                        checked={formCurrentUsage === opt.value}
                        onChange={() => {
                          setIdentityVerified(false);
                          setFormCurrentUsage(opt.value as typeof formCurrentUsage);
                          if (opt.value !== "paid_personal") {
                            setFormCurrentModel("");
                            setFormCurrentCost("");
                          }
                        }}
                        className="w-3.5 h-3.5 text-hansl-600 border-gray-300 focus:ring-hansl-500"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* 유료(개인) 사용 중 선택 시: 모델·비용 입력 */}
            {formCurrentUsage === "paid_personal" && (
              <div className="doc-form-row doc-form-row-always-border">
                <div className="doc-form-cell">
                  <div className="doc-form-cell-label">사용 중인 모델 <span className="required">*</span></div>
                  <Input
                    value={formCurrentModel}
                    onChange={(e) => handleFieldChange(setFormCurrentModel, e.target.value)}
                    placeholder="예: GPT-4o, Claude 3.5 Sonnet"
                    className="doc-form-input"
                  />
                </div>
                <div className="doc-form-cell">
                  <div className="doc-form-cell-label">현재 월 비용 <span className="required">*</span></div>
                  <Input
                    value={formCurrentCost}
                    onChange={(e) => handleFieldChange(setFormCurrentCost, e.target.value)}
                    placeholder="예: $20, 30,000원"
                    className="doc-form-input"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="doc-form-notice">
            <pre className="whitespace-pre-wrap font-sans leading-relaxed">{AI_SERVICE_NOTICE}</pre>
          </div>

          <div className="doc-form-footer flex flex-col sm:flex-row gap-3 justify-end items-stretch sm:items-center">
            <Button
              type="button"
              onClick={handleIdentityVerify}
              disabled={identityButtonDisabled}
              className={cn(
                "button-base",
                identityVerified
                  ? "bg-green-500 hover:bg-green-600 text-white"
                  : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              )}
            >
              {identityVerified ? "본인확인 완료 ✓" : "본인확인 완료"}
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitDisabled}
              className="button-base bg-hansl-600 hover:bg-hansl-700 text-white"
            >
              {submitting ? "제출 중..." : "신청서 제출하기"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
