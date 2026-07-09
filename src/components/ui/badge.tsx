import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// HANSL 표준(기준: 제작현황 카운트 배지 badge-stats) — rounded-lg · px-1.5 py-0.5 · 10px
// default는 제작현황 'N건' 배지(bg-blue-50/text-blue-700/border-blue-200)와 동일.
const badgeVariants = cva(
  "inline-flex items-center justify-center business-radius-badge px-1.5 py-0.5 text-[10px] font-medium leading-tight w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-0.5 [&>svg]:pointer-events-none transition-colors overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "bg-blue-50 text-blue-700 border border-blue-200 font-bold",
        secondary:
          "bg-gray-100 text-gray-600 border border-gray-200",
        success:
          "bg-green-50 text-green-700 border border-green-200",
        warning:
          "bg-amber-50 text-amber-700 border border-amber-200",
        destructive:
          "bg-red-50 text-red-700 border border-red-200",
        info:
          "bg-blue-50 text-blue-700 border border-blue-200",
        outline:
          "border border-gray-300 text-gray-600 bg-white",
        pending:
          "bg-yellow-50 text-yellow-700 border border-yellow-200",
        approved:
          "bg-green-50 text-green-700 border border-green-200",
        rejected:
          "bg-red-50 text-red-700 border border-red-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
