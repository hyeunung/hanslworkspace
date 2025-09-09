import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none transition-all duration-150 overflow-hidden uppercase tracking-wider",
  {
    variants: {
      variant: {
        default:
          "bg-hansl-100 text-hansl-700 border border-hansl-200/50",
        secondary:
          "bg-gray-100 text-gray-700 border border-gray-200/50",
        success:
          "bg-green-100 text-green-700 border border-green-200/50",
        warning:
          "bg-amber-100 text-amber-700 border border-amber-200/50",
        destructive:
          "bg-red-100 text-red-700 border border-red-200/50",
        info:
          "bg-blue-100 text-blue-700 border border-blue-200/50",
        outline:
          "border border-gray-300 text-gray-600 bg-white",
        pending:
          "bg-yellow-50 text-yellow-700 border border-yellow-200/50",
        approved:
          "bg-green-50 text-green-700 border border-green-200/50",
        rejected:
          "bg-red-50 text-red-700 border border-red-200/50",
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
