"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, Copy, RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CodeView } from "@/components/code-view"
import { MemoryEditor } from "@/components/memory-editor"
import { ShaderEditor } from "@/components/shader-editor"
import { Stage } from "@/components/stage"
import { parseAnnotated } from "@/lib/glsl/annotate"
import type { LiveEdits, MemoryCatalog } from "@/lib/gl/live"
import { chaptersOf, lessons } from "@/lib/lessons"
import type { ShaderFile } from "@/lib/lessons/types"
import { cn } from "cn"

export function Guide() {
  const [lessonId, setLessonId] = useState(lessons[0].id)
  const [variantByLesson, setVariantByLesson] = useState<Record<string, string>>({})
  const [fileByKey, setFileByKey] = useState<Record<string, string>>({})
  const [lineByKey, setLineByKey] = useState<Record<string, number>>({})
  const [query, setQuery] = useState("")
  const [copied, setCopied] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [editsByKey, setEditsByKey] = useState<Record<string, LiveEdits>>({})
  const [catalogByKey, setCatalogByKey] = useState<Record<string, MemoryCatalog>>({})
  const [compiled, setCompiled] = useState({ key: "", vertex: "", fragment: "" })
  const editsByKeyRef = useRef(editsByKey)
  useEffect(() => {
    editsByKeyRef.current = editsByKey
  }, [editsByKey])
  const lesson = lessons.find((item) => item.id === lessonId) ?? lessons[0]
  const variantId = variantByLesson[lesson.id] ?? lesson.variants?.[0]?.id ?? ""
  const variant = lesson.variants?.find((item) => item.id === variantId) ?? lesson.variants?.[0]
  const files = variant?.files ?? lesson.files
  const api = variant?.api ?? lesson.api
  const mount = variant?.mount ?? lesson.mount
  const context = variant?.context ?? lesson.context
  const viewKey = `${lesson.id}:${variant?.id ?? "main"}`
  const fileId = fileByKey[viewKey] ?? files[0]?.id ?? ""
  const activeFile = files.find((file) => file.id === fileId) ?? files[0]
  const parsed = parseAnnotated(activeFile?.source ?? "")
  const activeLine = lineByKey[`${viewKey}:${activeFile?.id ?? ""}`] ?? parsed.notes[0]?.line ?? null
  const vertexFile = files.find((file) => file.role === "vertex")
  const fragmentFile = files.find((file) => file.role === "fragment")
  const originalVertex = vertexFile ? parseAnnotated(vertexFile.source).code : ""
  const originalFragment = fragmentFile ? parseAnnotated(fragmentFile.source).code : ""
  const vertexLive = vertexFile ? (drafts[`${viewKey}:${vertexFile.id}`] ?? originalVertex) : ""
  const fragmentLive = fragmentFile ? (drafts[`${viewKey}:${fragmentFile.id}`] ?? originalFragment) : ""
  const stageVertex = compiled.key === viewKey ? compiled.vertex : vertexLive
  const stageFragment = compiled.key === viewKey ? compiled.fragment : fragmentLive
  const catalog = catalogByKey[viewKey]
  const edits = editsByKey[viewKey]
  const shaderDirty = files.some((file) => {
    const draft = drafts[`${viewKey}:${file.id}`]
    return draft != null && draft !== parseAnnotated(file.source).code
  })
  const memoryDirty = Boolean(
    edits && (Object.keys(edits.attributes).length > 0 || Object.keys(edits.uniforms).length > 0),
  )
  const canReset = shaderDirty || memoryDirty

  const onCatalog = useCallback((key: string, next: MemoryCatalog) => {
    setCatalogByKey((current) => {
      const previous = current[key]
      if (previous && JSON.stringify(previous) === JSON.stringify(next)) return current
      return { ...current, [key]: next }
    })
  }, [])

  useEffect(() => {
    const dirty = vertexLive !== originalVertex || fragmentLive !== originalFragment
    const timer = window.setTimeout(() => {
      setCompiled((current) => {
        if (current.key === viewKey && current.vertex === vertexLive && current.fragment === fragmentLive) return current
        return { key: viewKey, vertex: vertexLive, fragment: fragmentLive }
      })
    }, dirty ? 280 : 0)
    return () => window.clearTimeout(timer)
  }, [fragmentLive, originalFragment, originalVertex, vertexLive, viewKey])

  useEffect(() => {
    document.querySelector("main")?.scrollTo({ top: 0 })
  }, [lesson.id])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return
      const index = lessons.findIndex((item) => item.id === lesson.id)
      if (event.key === "ArrowRight" || event.key === "j") {
        setLessonId(lessons[Math.min(lessons.length - 1, index + 1)].id)
      }
      if (event.key === "ArrowLeft" || event.key === "k") {
        setLessonId(lessons[Math.max(0, index - 1)].id)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [lesson.id])

  const filtered = lessons.filter((item) => {
    const haystack = `${item.title} ${item.chapter} ${item.summary}`.toLowerCase()
    return haystack.includes(query.trim().toLowerCase())
  })
  const chapters = chaptersOf(filtered)
  const index = lessons.findIndex((item) => item.id === lesson.id)

  async function copySource() {
    if (!activeFile) return
    const text = editorText(activeFile, viewKey, drafts)
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  function resetView() {
    setDrafts((current) => {
      const next = { ...current }
      for (const file of files) delete next[`${viewKey}:${file.id}`]
      return next
    })
    setEditsByKey((current) => {
      if (!(viewKey in current)) return current
      const next = { ...current }
      delete next[viewKey]
      return next
    })
  }

  function writeEdits(recipe: (current: LiveEdits) => LiveEdits) {
    setEditsByKey((current) => {
      const nextEdits = recipe(current[viewKey] ?? { attributes: {}, uniforms: {} })
      const empty = Object.keys(nextEdits.attributes).length === 0 && Object.keys(nextEdits.uniforms).length === 0
      const next = { ...current }
      if (empty) delete next[viewKey]
      else next[viewKey] = nextEdits
      return next
    })
  }

  return (
    <div className="flex h-dvh bg-background text-foreground">
      <aside className="hidden w-[292px] shrink-0 flex-col border-r border-border md:flex">
        <div className="px-4 pt-5 pb-3">
          <p className="font-serif text-xl leading-7">着色器代码</p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">改着色器和顶点，画面会跟着更新。</p>
        </div>
        <div className="px-4 pb-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索语法或画面"
            aria-label="搜索课文"
            className="h-8 w-full rounded-md border border-input bg-card px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
          />
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <nav className="px-2 pb-6" aria-label="课文">
            {chapters.map((chapter) => (
              <div key={chapter.name} className="mb-3">
                <p className="px-2 py-1.5 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                  {chapter.name}
                </p>
                {chapter.lessons.map((item) => {
                  const number = lessons.findIndex((entry) => entry.id === item.id) + 1
                  const selected = item.id === lesson.id
                  return (
                      <Button
                      key={item.id}
                      variant="ghost"
                      data-lesson-id={item.id}
                      onClick={() => setLessonId(item.id)}
                      className={cn(
                        "h-auto w-full justify-start gap-2 px-2 py-1.5 text-left font-normal",
                        selected && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary",
                      )}
                    >
                      <span className="w-6 shrink-0 font-mono text-[11px] text-muted-foreground">
                        {String(number).padStart(2, "0")}
                      </span>
                      <span className="truncate">{item.title}</span>
                    </Button>
                  )
                })}
              </div>
            ))}
            {filtered.length === 0 ? <p className="px-2 text-sm text-muted-foreground">没有匹配的课文。</p> : null}
          </nav>
        </ScrollArea>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto" data-lesson={lesson.id}>
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-5 sm:px-6 sm:py-8">
          <label className="md:hidden">
            <span className="mb-1 block text-xs text-muted-foreground">课文</span>
            <select
              value={lesson.id}
              onChange={(event) => setLessonId(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
            >
              {lessons.map((item, itemIndex) => (
                <option key={item.id} value={item.id}>
                  {String(itemIndex + 1).padStart(2, "0")} {item.title}
                </option>
              ))}
            </select>
          </label>

          <header>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{lesson.chapter}</Badge>
              <span className="font-mono text-xs text-muted-foreground">
                {index + 1} / {lessons.length}
              </span>
              {api === "read" ? <Badge variant="secondary">只读源码</Badge> : null}
              {api === "webgl1" ? <Badge variant="secondary">WebGL 1</Badge> : null}
            </div>
            <h1 className="mt-3 font-serif text-3xl leading-tight sm:text-4xl">{lesson.title}</h1>
            <p className="mt-2 max-w-3xl text-base leading-7 text-muted-foreground">{lesson.summary}</p>
          </header>

          {lesson.variants ? (
            <div className="flex flex-wrap gap-2">
              {lesson.variants.map((item) => (
                <Button
                  key={item.id}
                  size="sm"
                  variant={item.id === (variant?.id ?? "") ? "default" : "outline"}
                  onClick={() => setVariantByLesson((current) => ({ ...current, [lesson.id]: item.id }))}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          ) : null}

          <Stage
            canvasKey={`${lesson.id}:${variant?.id ?? "main"}:${api}`}
            viewKey={viewKey}
            api={api}
            vertexSource={stageVertex}
            fragmentSource={stageFragment}
            mount={mount}
            context={context}
            overlay={lesson.overlay}
            caption={lesson.figure}
            diagram={lesson.diagram}
            editsByKeyRef={editsByKeyRef}
            onCatalog={onCatalog}
            onReset={resetView}
            canReset={canReset}
          />

          {api !== "read" && catalog ? (
            <MemoryEditor
              catalog={catalog}
              edits={edits}
              onAttribute={(id, values) =>
                writeEdits((current) => {
                  const attributes = { ...current.attributes }
                  if (values) attributes[id] = values
                  else delete attributes[id]
                  return { attributes, uniforms: current.uniforms }
                })
              }
              onUniform={(id, values) =>
                writeEdits((current) => {
                  const uniforms = { ...current.uniforms }
                  if (values) uniforms[id] = values
                  else delete uniforms[id]
                  return { attributes: current.attributes, uniforms }
                })
              }
            />
          ) : null}

          <div className="max-w-3xl space-y-4 text-[15px] leading-7">
            {lesson.prose.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>

          <Separator />

          {activeFile ? (
              <Tabs
                value={activeFile.id}
                onValueChange={(value) => setFileByKey((current) => ({ ...current, [viewKey]: String(value) }))}
              >
              <div className="flex flex-wrap items-end justify-between gap-3">
                <TabsList variant="line">
                  {files.map((file) => {
                    const draft = drafts[`${viewKey}:${file.id}`]
                    const dirty = draft != null && draft !== parseAnnotated(file.source).code
                    return (
                      <TabsTrigger key={file.id} value={file.id}>
                        {file.label}
                        {dirty ? <span className="text-primary">●</span> : null}
                      </TabsTrigger>
                    )
                  })}
                </TabsList>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={resetView} disabled={!canReset} data-reset="toolbar">
                    <RotateCcw />
                    重置
                  </Button>
                  <Button variant="outline" size="sm" onClick={copySource}>
                    {copied ? <Check /> : <Copy />}
                    {copied ? "已复制" : "复制这份源码"}
                  </Button>
                </div>
              </div>
              {files.map((file) => (
                <TabsContent key={file.id} value={file.id} className="mt-3">
                  <FilePane
                    source={file.source}
                    language={file.language}
                    filename={file.filename}
                    role={file.role}
                    editable={canEditShader(file, api)}
                    value={editorText(file, viewKey, drafts)}
                    activeLine={file.id === activeFile.id ? activeLine : null}
                    onLine={(line) => setLineByKey((current) => ({ ...current, [`${viewKey}:${file.id}`]: line }))}
                    onChange={(text) => {
                      const key = `${viewKey}:${file.id}`
                      const original = parseAnnotated(file.source).code
                      setDrafts((current) => {
                        const next = { ...current }
                        if (text === original) delete next[key]
                        else next[key] = text
                        return next
                      })
                    }}
                  />
                </TabsContent>
              ))}
            </Tabs>
          ) : null}

          {lesson.closing?.map((paragraph) => (
            <p key={paragraph} className="max-w-3xl text-[15px] leading-7 text-muted-foreground">
              {paragraph}
            </p>
          ))}

          <div className="flex justify-between gap-3 pb-8">
            <Button
              variant="outline"
              disabled={index === 0}
              onClick={() => setLessonId(lessons[index - 1].id)}
            >
              上一则
            </Button>
            <Button
              disabled={index === lessons.length - 1}
              onClick={() => setLessonId(lessons[index + 1].id)}
            >
              下一则
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}

function editorText(file: ShaderFile, viewKey: string, drafts: Record<string, string>) {
  return drafts[`${viewKey}:${file.id}`] ?? parseAnnotated(file.source).code
}

function canEditShader(file: ShaderFile, api: "webgl1" | "webgl2" | "read") {
  return api !== "read" && file.language === "glsl" && (file.role === "vertex" || file.role === "fragment")
}

function FilePane({
  source,
  language,
  filename,
  role,
  editable,
  value,
  activeLine,
  onLine,
  onChange,
}: {
  source: string
  language: "glsl" | "ts"
  filename: string
  role: ShaderFile["role"]
  editable: boolean
  value: string
  activeLine: number | null
  onLine: (line: number) => void
  onChange: (value: string) => void
}) {
  const parsed = useMemo(() => parseAnnotated(source), [source])
  const dirty = editable && value !== parsed.code
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <p className="mb-2 font-mono text-[11px] text-muted-foreground">{filename}</p>
        {dirty ? (
          <p className="mb-2 text-sm leading-6 text-muted-foreground">
            这份源码已改过。停手片刻后会重新编译，失败时可以重置回课文。
          </p>
        ) : null}
        {editable && (role === "vertex" || role === "fragment") ? (
          <ShaderEditor
            value={value}
            onChange={onChange}
            filename={filename}
            role={role}
            activeLine={activeLine}
            notedLines={parsed.notes.map((note) => note.line)}
          />
        ) : (
          <CodeView
            code={parsed.code}
            language={language}
            notes={parsed.notes}
            activeLine={activeLine}
            onLine={onLine}
          />
        )}
      </div>
      <aside className="space-y-2 lg:sticky lg:top-4">
        <p className="font-mono text-[11px] text-muted-foreground">逐行</p>
        {dirty ? <p className="text-sm leading-6 text-muted-foreground">旁注仍按课文原文的行号。重置后会对齐回来。</p> : null}
        {parsed.notes.length === 0 ? (
          <p className="text-sm leading-6 text-muted-foreground">这一份没有旁注，按源码本身读即可。</p>
        ) : (
          parsed.notes.map((note) => (
            <button
              key={note.line}
              type="button"
              onClick={() => onLine(note.line)}
              className={cn(
                "block w-full rounded-md border px-3 py-2 text-left",
                activeLine === note.line ? "border-primary/60 bg-primary/10" : "border-border bg-card",
              )}
            >
              <span className="font-mono text-[11px] text-primary">第 {note.line} 行</span>
              <span className="mt-1 block text-sm leading-6 whitespace-pre-wrap">{note.text}</span>
            </button>
          ))
        )}
      </aside>
    </div>
  )
}
