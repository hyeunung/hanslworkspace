import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-professional",
        "bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200",
        "background-size-200 bg-[length:200%_100%]",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }