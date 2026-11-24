"use client"

import { useState } from "react"
import type { LiveEdits, MemoryAttribute, MemoryCatalog, MemoryUniform } from "@/lib/gl/live"

const VISIBLE_CAP = 80
const AXES = ["x", "y", "z", "w"]

export function formatNumber(value: number) {
  if (!Number.isFinite(value)) return ""
  return String(Math.round(value * 1e6) / 1e6)
}

export function nearly(left: number[], right: number[]) {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (Math.abs(left[index] - right[index]) > 1e-5) return false
  }
  return true
}

export function MemoryEditor({
  catalog,
  edits,
  onAttribute,
  onUniform,
}: {
  catalog: MemoryCatalog
  edits: LiveEdits | undefined
  onAttribute: (id: string, values: number[] | null) => void
  onUniform: (id: string, values: number[] | null) => void
}) {
  const hasRows = catalog.attributes.length > 0 || catalog.uniforms.length > 0
  return (
    <section data-memory-editor="" className="rounded-md border border-border bg-card">
      <div className="px-3 pt-3 pb-2">
        <h2 className="text-sm font-medium">顶点与 uniform</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {hasRows
            ? "这些数在绘制时写进 GPU。改一个，下一帧画面就用新的值。每帧都在变的时间、分辨率和鼠标不列在这里。"
            : "这一则的顶点写在着色器里，传给 GPU 的数每帧都在变。改下面的着色器，画面会重新编译。"}
        </p>
      </div>
      {hasRows ? (
        <div className="max-h-96 space-y-4 overflow-auto px-3 pb-3">
          {catalog.attributes.map((attribute) => (
            <AttributeBlock
              key={attribute.id}
              attribute={attribute}
              values={edits?.attributes[attribute.id] ?? attribute.values}
              onChange={(values) => onAttribute(attribute.id, values)}
            />
          ))}
          {catalog.uniforms.length > 0 ? (
            <div className="space-y-2">
              <p className="font-mono text-[11px] text-muted-foreground">uniform</p>
              {catalog.uniforms.map((uniform) => (
                <UniformRow
                  key={uniform.id}
                  uniform={uniform}
                  values={edits?.uniforms[uniform.id] ?? uniform.values}
                  onChange={(values) => onUniform(uniform.id, values)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function AttributeBlock({
  attribute,
  values,
  onChange,
}: {
  attribute: MemoryAttribute
  values: number[]
  onChange: (values: number[] | null) => void
}) {
  const size = Math.max(attribute.size, 1)
  const vertexCount = Math.floor(attribute.values.length / size)
  const shown = vertexCount <= VISIBLE_CAP ? vertexCount : 8
  const sameName = attribute.id.endsWith("#0") ? attribute.name : `${attribute.name} · 第 ${Number(attribute.id.split("#")[1]) + 1} 份`

  function commit(vertex: number, component: number, next: number) {
    const copy = values.slice()
    copy[vertex * size + component] = next
    onChange(nearly(copy, attribute.values) ? null : copy)
  }

  return (
    <div data-attribute={attribute.id} className="space-y-1.5">
      <p className="font-mono text-[11px] text-muted-foreground">
        {sameName}
        <span className="ml-2">
          {vertexCount} 个顶点
          {shown < vertexCount ? `，这里列出前 ${shown} 个，其余保持课文原值` : ""}
        </span>
      </p>
      <div
        className="grid items-center gap-x-2 gap-y-1"
        style={{ gridTemplateColumns: `2.25rem repeat(${size}, minmax(0, 5.5rem))` }}
      >
        <span />
        {AXES.slice(0, size).map((axis) => (
          <span key={axis} className="font-mono text-[11px] text-muted-foreground">
            {axis}
          </span>
        ))}
        {Array.from({ length: shown }, (_, vertex) => (
          <VertexRow
            key={vertex}
            vertex={vertex}
            size={size}
            values={values}
            onCommit={(component, next) => commit(vertex, component, next)}
          />
        ))}
      </div>
    </div>
  )
}

function VertexRow({
  vertex,
  size,
  values,
  onCommit,
}: {
  vertex: number
  size: number
  values: number[]
  onCommit: (component: number, value: number) => void
}) {
  return (
    <>
      <span className="font-mono text-[11px] text-muted-foreground">{vertex}</span>
      {Array.from({ length: size }, (_, component) => (
        <NumberField
          key={component}
          label={`顶点 ${vertex} ${AXES[component] ?? component}`}
          attributeComponent={`${vertex}:${component}`}
          value={values[vertex * size + component] ?? 0}
          onCommit={(next) => onCommit(component, next)}
        />
      ))}
    </>
  )
}

function UniformRow({
  uniform,
  values,
  onChange,
}: {
  uniform: MemoryUniform
  values: number[]
  onChange: (values: number[] | null) => void
}) {
  const wide = values.length > 4
  return (
    <div data-uniform={uniform.id} className="flex flex-wrap items-center gap-1.5">
      <span className="w-full font-mono text-[11px] text-foreground sm:w-44 sm:shrink-0">{uniform.label}</span>
      {values.map((value, index) => (
        <NumberField
          key={`${uniform.id}:${index}`}
          label={`${uniform.label} ${wide ? index : (AXES[index] ?? index)}`}
          uniformComponent={String(index)}
          value={value}
          onCommit={(next) => {
            const copy = values.slice()
            copy[index] = next
            onChange(nearly(copy, uniform.values) ? null : copy)
          }}
        />
      ))}
    </div>
  )
}

function NumberField({
  value,
  onCommit,
  label,
  attributeComponent,
  uniformComponent,
}: {
  value: number
  onCommit: (value: number) => void
  label: string
  attributeComponent?: string
  uniformComponent?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const parsed = draft == null || draft.trim() === "" ? null : Number(draft)
  if (parsed != null && Number.isFinite(parsed) && Math.abs(parsed - value) > 1e-5) setDraft(null)
  const text = draft == null || (parsed != null && Number.isFinite(parsed) && Math.abs(parsed - value) > 1e-5) ? formatNumber(value) : draft

  return (
    <input
      aria-label={label}
      data-vertex-component={attributeComponent}
      data-uniform-component={uniformComponent}
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={text}
      onFocus={() => setDraft(formatNumber(value))}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        const next = event.target.value
        setDraft(next)
        if (next.trim() === "") return
        const parsed = Number(next)
        if (Number.isFinite(parsed)) onCommit(parsed)
      }}
      className={`h-7 rounded-md border border-input bg-background px-1.5 font-mono text-xs outline-none focus-visible:border-ring ${attributeComponent ? "w-full" : "w-[4.75rem]"}`}
    />
  )
}
