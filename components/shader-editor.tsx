"use client"

import { useEffect, useRef, type KeyboardEvent } from "react"
import { cn } from "cn"

export function ShaderEditor({
  value,
  onChange,
  filename,
  role,
  activeLine,
  notedLines,
}: {
  value: string
  onChange: (value: string) => void
  filename: string
  role: "vertex" | "fragment"
  activeLine: number | null
  notedLines: number[]
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const lines = value.split("\n")
  const noted = new Set(notedLines)

  useEffect(() => {
    if (activeLine == null || !scroller.current) return
    const row = scroller.current.querySelector(`[data-line="${activeLine}"]`)
    row?.scrollIntoView({ block: "nearest" })
  }, [activeLine])

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab") return
    event.preventDefault()
    const target = event.currentTarget
    const start = target.selectionStart
    const end = target.selectionEnd
    const next = `${value.slice(0, start)}  ${value.slice(end)}`
    onChange(next)
    requestAnimationFrame(() => {
      target.selectionStart = start + 2
      target.selectionEnd = start + 2
    })
  }

  return (
    <div
      ref={scroller}
      className="max-h-[560px] overflow-auto rounded-md border border-border bg-[#0e0d0b]"
    >
      <div className="flex min-w-max">
        <div className="sticky left-0 w-12 shrink-0 bg-[#0e0d0b] py-3 text-right font-mono text-[11px] leading-6 select-none">
          {lines.map((_, index) => {
            const number = index + 1
            const active = activeLine === number
            return (
              <div
                key={number}
                data-line={number}
                className={cn("pr-3", active ? "bg-primary/12 text-primary" : noted.has(number) ? "text-[#b7a48a]" : "text-[#6f675c]")}
              >
                {number}
              </div>
            )
          })}
        </div>
        <textarea
          data-shader-editor=""
          data-shader-role={role}
          aria-label={filename}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          rows={Math.max(lines.length, 1)}
          className="min-w-[36rem] flex-1 resize-none overflow-hidden bg-transparent py-3 pr-4 font-mono text-[12.5px] leading-6 text-[#f3efe4] outline-none"
        />
      </div>
    </div>
  )
}
