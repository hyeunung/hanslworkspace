import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full",
          "rounded-professional",
          "border border-gray-300",
          "bg-white",
          "px-3.5 py-2",
          "text-[14px] text-gray-800",
          "placeholder:text-gray-400",
          "transition-all duration-200",
          "hover:border-gray-400",
          "focus:border-hansl-500 focus:ring-2 focus:ring-hansl-500/20",
          "focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-40 disabled:bg-gray-50",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
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