import { toast as sonnerToast } from "sonner";

// Sonner의 toast를 기반으로 한 커스텀 훅
export const useToast = () => {
  return {
    toast: ({
      title,
      description,
      variant = "default",
      ...options
    }: {
      title?: string;
      description?: string;
      variant?: "default" | "destructive";
    } & Record<string, any>) => {
      if (variant === "destructive") {
        sonnerToast.error(title || description, {
          description: title ? description : undefined,
          ...options
        });
      } else {
        sonnerToast.success(title || description, {
          description: title ? description : undefined,
          ...options
        });
      }
    }
  };
};

export { sonnerToast as toast };