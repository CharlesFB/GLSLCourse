import type { GL, Handle } from "@/lib/gl/program"

export type ShaderFile = {
  id: string
  label: string
  filename: string
  language: "glsl" | "ts"
  role: "vertex" | "fragment" | "host" | "extra"
  source: string
}

export type OverlayLabel = {
  left: string
  top: string
  text: string
}

export type Variant = {
  id: string
  label: string
  api: "webgl1" | "webgl2" | "read"
  files: ShaderFile[]
  context?: WebGLContextAttributes
  mount?: (gl: GL, program: WebGLProgram) => Handle
}

export type Lesson = {
  id: string
  chapter: string
  title: string
  summary: string
  prose: string[]
  figure: string
  overlay?: OverlayLabel[]
  api: "webgl1" | "webgl2" | "read"
  files: ShaderFile[]
  context?: WebGLContextAttributes
  mount?: (gl: GL, program: WebGLProgram) => Handle
  variants?: Variant[]
  diagram?: "workgroup" | "pipeline"
  closing?: string[]
}
