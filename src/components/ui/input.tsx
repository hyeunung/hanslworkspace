import * as React from "react"
import { cn } from "@/lib/utils"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // HANSL 표준(기준: 제작현황 폼 input) — hansl-form-input: h-8 · rounded-md · text-xs
          "hansl-form-input flex px-2.5",
          "text-gray-800 placeholder:text-gray-400",
          "transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-40 disabled:bg-gray-50",
          "file:border-0 file:bg-transparent file:text-xs file:font-medium",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }