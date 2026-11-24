"use client"

import { useEffect, useMemo, useRef } from "react"
import { HighlightedLine } from "@/lib/glsl/highlight"
import type { LineNote } from "@/lib/glsl/annotate"
import { cn } from "cn"

export function CodeView({
  code,
  language,
  notes,
  activeLine,
  onLine,
}: {
  code: string
  language: "glsl" | "ts"
  notes: LineNote[]
  activeLine: number | null
  onLine: (line: number) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const noted = useMemo(() => new Set(notes.map((note) => note.line)), [notes])
  const lines = code.split("\n")

  useEffect(() => {
    if (activeLine == null || !scroller.current) return
    const row = scroller.current.querySelector(`[data-line="${activeLine}"]`)
    row?.scrollIntoView({ block: "nearest" })
  }, [activeLine])

  return (
    <div
      ref={scroller}
      className="max-h-[560px] overflow-auto rounded-md border border-border bg-[#0e0d0b]"
    >
      <div className="min-w-max py-3 font-mono text-[12.5px] leading-6">
        {lines.map((line, index) => {
          const number = index + 1
          const hasNote = noted.has(number)
          const active = activeLine === number
          return (
            <button
              key={number}
              type="button"
              data-line={number}
              onClick={() => hasNote && onLine(number)}
              className={cn(
                "grid w-full grid-cols-[3.25rem_1fr] px-2 text-left",
                hasNote ? "cursor-pointer" : "cursor-text",
                active ? "bg-primary/12" : hasNote ? "hover:bg-white/4" : "",
              )}
            >
              <span className={cn("pr-3 text-right text-[11px]", active ? "text-primary" : "text-[#6f675c]")}>
                {number}
              </span>
              <span className={cn("whitespace-pre pr-6", active && "shadow-[-2px_0_0_var(--primary)]")}>
                <HighlightedLine line={line.length > 0 ? line : " "} language={language} />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
