import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // HANSL 표준(기준: 제작현황 메모 편집기) — 11px · rounded · focus 파랑 보더
        "flex w-full min-h-16",
        "rounded-md border border-gray-300 bg-white",
        "px-2.5 py-2 text-[11px] text-gray-800 leading-snug",
        "placeholder:text-gray-400",
        "transition-colors resize-y",
        "focus:border-hansl-500 focus:outline-none",
        "focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:bg-gray-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
