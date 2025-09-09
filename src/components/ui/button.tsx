import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-hansl-500/20 focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "bg-hansl-500 text-white shadow-sm hover:bg-hansl-600",
        destructive:
          "bg-red-500 text-white shadow-sm hover:bg-red-600",
        outline:
          "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:text-gray-900",
        secondary:
          "bg-gray-100 text-gray-700 hover:bg-gray-200",
        ghost:
          "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
        link: "text-hansl-500 underline-offset-4 hover:text-hansl-600 hover:underline",
        professional:
          "bg-hansl-500 text-white shadow-sm hover:bg-hansl-600",
      },
      size: {
        default: "h-9 px-4 py-2 text-[13px]",
        sm: "h-8 px-3 py-1.5 text-xs gap-1.5",
        lg: "h-11 px-6 py-2.5 text-[14px]",
        xl: "h-12 px-8 py-3 text-base",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-11",
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
