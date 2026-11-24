"use client"

import { useEffect, useRef, useState, type RefObject } from "react"
import { parseAnnotated } from "@/lib/glsl/annotate"
import { EMPTY_EDITS, LiveSession, setActiveSession, type LiveEdits, type MemoryCatalog } from "@/lib/gl/live"
import { compile, type Frame, type GL, type Handle } from "@/lib/gl/program"
import type { OverlayLabel } from "@/lib/lessons/types"

export function Stage({
  canvasKey,
  viewKey,
  api,
  vertexSource,
  fragmentSource,
  mount,
  context,
  overlay,
  caption,
  diagram,
  editsByKeyRef,
  onCatalog,
  onReset,
  canReset,
}: {
  canvasKey: string
  viewKey: string
  api: "webgl1" | "webgl2" | "read"
  vertexSource: string
  fragmentSource: string
  mount?: (gl: GL, program: WebGLProgram) => Handle
  context?: WebGLContextAttributes
  overlay?: OverlayLabel[]
  caption: string
  diagram?: "workgroup" | "pipeline"
  editsByKeyRef: RefObject<Record<string, LiveEdits>>
  onCatalog: (key: string, catalog: MemoryCatalog) => void
  onReset: () => void
  canReset: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mouse = useRef({ x: 0.5, y: 0.5, down: 0 })
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<"pending" | "ok" | "error" | "read">("pending")

  useEffect(() => {
    mouse.current = { x: 0.5, y: 0.5, down: 0 }
    if (api === "read") {
      queueMicrotask(() => {
        setStatus("read")
        setError(null)
      })
      return
    }
    const host = hostRef.current
    const reportKey = viewKey
    if (!host || !vertexSource || !fragmentSource || !mount) {
      queueMicrotask(() => {
        setStatus("error")
        setError("这一则缺少顶点着色器或片段着色器。")
      })
      return
    }

    const canvas = document.createElement("canvas")
    canvas.className = "absolute top-0 left-0 block h-full w-full touch-none"
    canvas.setAttribute("aria-label", "着色器画出的画面")
    host.appendChild(canvas)

    const attributes: WebGLContextAttributes = {
      alpha: false,
      antialias: true,
      depth: true,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      ...context,
    }
    const gl = (
      api === "webgl2" ? canvas.getContext("webgl2", attributes) : canvas.getContext("webgl", attributes)
    ) as GL | null
    if (!gl) {
      queueMicrotask(() => {
        setStatus("error")
        setError("这个环境没有提供 WebGL。")
      })
      canvas.remove()
      return
    }

    const compiled = compile(gl, parseAnnotated(vertexSource).code, parseAnnotated(fragmentSource).code)
    if (!compiled.program) {
      const log = compiled.log
      queueMicrotask(() => {
        setStatus("error")
        setError(log)
      })
      gl.getExtension("WEBGL_lose_context")?.loseContext()
      canvas.remove()
      return
    }

    queueMicrotask(() => {
      setError(null)
      setStatus("ok")
    })
    const session = new LiveSession()
    session.attach(gl)
    session.edits = editsByKeyRef.current[reportKey] ?? EMPTY_EDITS
    gl.useProgram(compiled.program)
    setActiveSession(session)
    let handle: Handle
    try {
      handle = mount(gl, compiled.program)
    } catch (caught) {
      setActiveSession(null)
      session.detach()
      const message = caught instanceof Error ? caught.message : "画面初始化失败。"
      queueMicrotask(() => {
        setStatus("error")
        setError(message)
      })
      gl.getExtension("WEBGL_lose_context")?.loseContext()
      canvas.remove()
      return
    }
    setActiveSession(null)
    let frameId = 0
    let alive = true
    const started = performance.now()

    const updatePointer = (event: PointerEvent, down: number) => {
      const rect = canvas.getBoundingClientRect()
      mouse.current = {
        x: Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(rect.width, 1))),
        y: Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / Math.max(rect.height, 1))),
        down,
      }
    }
    const onDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId)
      updatePointer(event, 1)
    }
    const onMove = (event: PointerEvent) => updatePointer(event, event.buttons ? 1 : 0)
    const onUp = (event: PointerEvent) => updatePointer(event, 0)
    canvas.addEventListener("pointerdown", onDown)
    canvas.addEventListener("pointermove", onMove)
    canvas.addEventListener("pointerup", onUp)
    canvas.addEventListener("pointerleave", onUp)

    const loop = (now: number) => {
      if (!alive) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      const height = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      if (canvas.clientWidth >= 2) {
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
        }
        const frame: Frame = {
          time: (now - started) / 1000,
          width,
          height,
          aspect: width / Math.max(height, 1),
          mouseX: mouse.current.x,
          mouseY: mouse.current.y,
          mouseDown: mouse.current.down,
        }
        session.edits = editsByKeyRef.current[reportKey] ?? EMPTY_EDITS
        session.beginFrame()
        handle.draw(frame)
        const catalog = session.endFrame()
        if (catalog) onCatalog(reportKey, catalog)
      }
      frameId = requestAnimationFrame(loop)
    }
    frameId = requestAnimationFrame(loop)

    return () => {
      alive = false
      cancelAnimationFrame(frameId)
      canvas.removeEventListener("pointerdown", onDown)
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerup", onUp)
      canvas.removeEventListener("pointerleave", onUp)
      session.detach()
      handle.dispose()
      gl.deleteProgram(compiled.program)
      gl.getExtension("WEBGL_lose_context")?.loseContext()
      canvas.remove()
    }
  }, [api, canvasKey, context, editsByKeyRef, fragmentSource, mount, onCatalog, vertexSource, viewKey])

  return (
    <figure className="m-0">
      <div
        className={
          context?.alpha
            ? "checker relative overflow-hidden rounded-md border border-border"
            : "relative overflow-hidden rounded-md border border-border bg-[#14120e]"
        }
      >
        {diagram === "pipeline" ? <PipelineMap /> : null}
        {api === "read" && diagram === "workgroup" ? (
          <Workgroup />
        ) : (
          <div ref={hostRef} data-gl-status={status} className="stage-frame">
            {error ? (
              <div
                data-gl-error=""
                className="absolute inset-0 z-10 flex flex-col gap-3 overflow-auto bg-[#2a1612]/95 p-4"
              >
                {canReset ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm leading-6 text-[#ffd0c4]">
                      编译没有通过。源码还留着，改到能通过，或者重置回这一则原来的着色器和参数。
                    </p>
                    <button
                      type="button"
                      data-reset="error"
                      onClick={onReset}
                      className="shrink-0 rounded-md bg-[#f3efe4] px-2.5 py-1 text-xs font-medium text-[#2a1612]"
                    >
                      重置
                    </button>
                  </div>
                ) : null}
                <pre className="font-mono text-xs leading-5 whitespace-pre-wrap text-[#ffd0c4]">{error}</pre>
              </div>
            ) : null}
          </div>
        )}
        {overlay?.map((label) => (
          <span
            key={`${label.left}-${label.top}-${label.text}`}
            className="pointer-events-none absolute rounded-sm bg-[#14120e]/80 px-1.5 py-0.5 font-mono text-[11px] text-[#f3efe4]"
            style={{ left: label.left, top: label.top }}
          >
            {label.text}
          </span>
        ))}
      </div>
      <figcaption className="mt-2 text-sm leading-6 text-muted-foreground">{caption}</figcaption>
    </figure>
  )
}

const PIPELINE_STEPS: { name: string; kind: "cpu" | "prog" | "fixed" | "out"; hint: string }[] = [
  { name: "绘制调用", kind: "cpu", hint: "CPU 调用 drawArrays 或 drawElements" },
  { name: "顶点着色器", kind: "prog", hint: "每个顶点执行一次，写出裁剪坐标 gl_Position" },
  { name: "图元装配", kind: "fixed", hint: "把顶点收成点、线或三角形" },
  { name: "裁剪", kind: "fixed", hint: "切掉裁剪体 -w 到 w 之外的部分" },
  { name: "透视除法", kind: "fixed", hint: "xyz 除以 w，得到 NDC" },
  { name: "视口", kind: "fixed", hint: "NDC 映射到窗口像素" },
  { name: "光栅化", kind: "fixed", hint: "生成片元，并按重心坐标插值" },
  { name: "片段着色器", kind: "prog", hint: "每个片元执行一次，写出颜色" },
  { name: "片元测试", kind: "fixed", hint: "剪裁、模板、深度，然后混合" },
  { name: "帧缓冲", kind: "out", hint: "颜色、深度和模板写入画布" },
]

function PipelineMap() {
  return (
    <div className="border-b border-border bg-[#1a1713] px-3 py-3" data-pipeline="">
      <ol className="flex list-none flex-wrap items-center gap-1.5 p-0">
        {PIPELINE_STEPS.map((step, index) => (
          <li key={step.name} className="flex items-center gap-1.5">
            {index > 0 ? (
              <span aria-hidden className="text-[11px] text-[#8a8172]">
                →
              </span>
            ) : null}
            <span
              title={step.hint}
              className={
                step.kind === "prog"
                  ? "rounded-sm border border-primary/50 bg-primary/15 px-1.5 py-1 font-mono text-[11px] text-primary"
                  : step.kind === "fixed"
                    ? "rounded-sm bg-secondary px-1.5 py-1 font-mono text-[11px] text-muted-foreground"
                    : "rounded-sm border border-border px-1.5 py-1 font-mono text-[11px] text-foreground"
              }
            >
              {step.name}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
        暖色是 GLSL 写的可编程阶段。其余阶段用 gl 状态配置，源码里没有对应的 main。
      </p>
    </div>
  )
}

function Workgroup() {
  return (
    <div className="flex aspect-[16/10] items-center justify-center bg-[#14120e] p-6" data-gl-status="read">
      <div className="grid grid-cols-8 gap-1.5">
        {Array.from({ length: 64 }, (_, index) => (
          <div
            key={index}
            className={
              index === 19
                ? "size-5 rounded-[3px] bg-primary sm:size-6"
                : "size-5 rounded-[3px] bg-[#2c2820] sm:size-6"
            }
          />
        ))}
      </div>
    </div>
  )
}
