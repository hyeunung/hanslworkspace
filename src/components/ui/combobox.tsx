"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export interface ComboboxOption {
  value: string
  label: string
  /** 3줄 구조 표시용 (지정 시 label 대신 아래 값들을 줄바꿈 렌더) */
  primary?: string     // 1줄: 상호
  secondary?: string   // 2줄: 이름 직함 (비고)
  tertiary?: string    // 3줄: 전화번호 등
}

interface ComboboxProps {
  options: ComboboxOption[]
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "선택...",
  searchPlaceholder = "검색...",
  emptyText = "결과가 없습니다.",
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const selected = options.find((option) => option.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            // Select 트리거와 동일한 스타일
            "flex w-full items-center justify-between gap-2",
            "rounded-professional border border-gray-300 bg-white",
            "px-2.5 h-7 text-[11px] text-gray-800",
            "whitespace-nowrap transition-all duration-200",
            "hover:border-gray-400",
            "focus:border-hansl-500 focus:ring-2 focus:ring-hansl-500/20",
            "focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-40 disabled:bg-gray-50",
            className
          )}
        >
          <span
            className={cn(
              "truncate text-left flex-1",
              selected ? "text-gray-800" : "text-gray-400"
            )}
          >
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-8 text-[11px]" />
          <CommandEmpty className="py-4 text-center text-[11px] text-gray-400">
            {emptyText}
          </CommandEmpty>
          <CommandGroup className="max-h-[280px] overflow-auto">
            {options.map((option) => {
              const hasStructured = !!option.primary
              return (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => {
                    onValueChange(option.value === value ? "" : option.value)
                    setOpen(false)
                  }}
                  className={cn(
                    "text-[11px]",
                    hasStructured ? "py-2 items-start" : "py-1.5"
                  )}
                >
                  <Check
                    className={cn(
                      "mr-2 h-3.5 w-3.5 shrink-0",
                      hasStructured ? "mt-0.5" : "",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {hasStructured ? (
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div className="text-[12px] font-semibold text-gray-900 truncate">
                        {option.primary}
                      </div>
                      {option.secondary && (
                        <div className="text-[11px] text-gray-600 truncate">
                          {option.secondary}
                        </div>
                      )}
                      {option.tertiary && (
                        <div className="text-[10px] text-gray-400 truncate font-mono">
                          {option.tertiary}
                        </div>
                      )}
                    </div>
                  ) : (
                    option.label
                  )}
                </CommandItem>
              )
            })}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  )
}