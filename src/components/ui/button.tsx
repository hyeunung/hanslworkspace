import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// HANSL 표준(기준: 제작현황 툴바 버튼) — 높이 h-8 · px-3 · 12px/500 · rounded-lg(business radius)
// primary는 hansl-500/600 토큰. 여기 값을 바꾸면 공용 Button 쓰는 모든 화면이 일괄 반영된다.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap business-radius-button text-xs font-medium leading-tight transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-hansl-500/20 focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "bg-hansl-500 text-white hover:bg-hansl-600",
        destructive:
          "bg-red-500 text-white hover:bg-red-600",
        outline:
          "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
        secondary:
          "bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100",
        ghost:
          "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
        link: "text-hansl-500 underline-offset-4 hover:text-hansl-600 hover:underline",
        professional:
          "bg-hansl-500 text-white hover:bg-hansl-600",
      },
      size: {
        // default = 제작현황 툴바 버튼 실측(패딩 2×10px, 높이 auto ≈21px)
        default: "px-[10px] py-[2px]",
        sm: "px-2 py-[1px] text-[11px] gap-1 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-8 px-3",
        xl: "h-9 px-4 text-[13px]",
        icon: "size-7",
        "icon-sm": "size-[22px]",
        "icon-lg": "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
