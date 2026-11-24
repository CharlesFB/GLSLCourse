import { registerAttribute } from "@/lib/gl/live"

export type GL = WebGLRenderingContext | WebGL2RenderingContext

export type Frame = {
  time: number
  width: number
  height: number
  aspect: number
  mouseX: number
  mouseY: number
  mouseDown: number
}

export type Handle = {
  draw: (frame: Frame) => void
  dispose: () => void
}

export function compile(
  gl: GL,
  vertexSource: string,
  fragmentSource: string,
): { program: WebGLProgram | null; log: string } {
  const vertex = gl.createShader(gl.VERTEX_SHADER)
  const fragment = gl.createShader(gl.FRAGMENT_SHADER)
  if (!vertex || !fragment) return { program: null, log: "无法创建 shader 对象。" }

  gl.shaderSource(vertex, vertexSource)
  gl.compileShader(vertex)
  gl.shaderSource(fragment, fragmentSource)
  gl.compileShader(fragment)

  const program = gl.createProgram()
  if (!program) return { program: null, log: "无法创建 program。" }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)

  const logs = [
    gl.getShaderParameter(vertex, gl.COMPILE_STATUS) ? "" : `顶点着色器\n${gl.getShaderInfoLog(vertex) ?? ""}`,
    gl.getShaderParameter(fragment, gl.COMPILE_STATUS)
      ? ""
      : `片段着色器\n${gl.getShaderInfoLog(fragment) ?? ""}`,
    gl.getProgramParameter(program, gl.LINK_STATUS) ? "" : `链接\n${gl.getProgramInfoLog(program) ?? ""}`,
  ].filter((line) => line.trim().length > 0)

  gl.deleteShader(vertex)
  gl.deleteShader(fragment)

  if (logs.length > 0) {
    gl.deleteProgram(program)
    return { program: null, log: logs.join("\n\n") }
  }
  return { program, log: "" }
}

export function begin(
  gl: GL,
  frame: Frame,
  color: [number, number, number, number] = [0.078, 0.071, 0.055, 1],
) {
  gl.viewport(0, 0, frame.width, frame.height)
  gl.clearColor(color[0], color[1], color[2], color[3])
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
}

export function bindVao(gl: GL): WebGLVertexArrayObject | null {
  if (!("createVertexArray" in gl)) return null
  const gl2 = gl as WebGL2RenderingContext
  const vao = gl2.createVertexArray()
  gl2.bindVertexArray(vao)
  return vao
}

export function attribBuffer(gl: GL, program: WebGLProgram, name: string, size: number, data: Float32Array) {
  const buffer = gl.createBuffer()
  if (!buffer) throw new Error("无法创建缓冲。")
  const copy = new Float32Array(data)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, copy, gl.DYNAMIC_DRAW)
  const location = gl.getAttribLocation(program, name)
  if (location >= 0) {
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
  }
  registerAttribute(gl, buffer, name, size, copy)
  return buffer
}

export function elementBuffer(gl: GL, data: Uint16Array) {
  const buffer = gl.createBuffer()
  if (!buffer) throw new Error("无法创建索引缓冲。")
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW)
  return buffer
}

export function uniforms(gl: GL, program: WebGLProgram) {
  const cache = new Map<string, WebGLUniformLocation | null>()
  const loc = (name: string) => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name))
    return cache.get(name) ?? null
  }
  return {
    loc,
    f1(name: string, value: number) {
      const location = loc(name)
      if (location) gl.uniform1f(location, value)
    },
    f2(name: string, x: number, y: number) {
      const location = loc(name)
      if (location) gl.uniform2f(location, x, y)
    },
    f3(name: string, x: number, y: number, z: number) {
      const location = loc(name)
      if (location) gl.uniform3f(location, x, y, z)
    },
    i1(name: string, value: number) {
      const location = loc(name)
      if (location) gl.uniform1i(location, value)
    },
    mat4(name: string, matrix: Float32Array) {
      const location = loc(name)
      if (location) gl.uniformMatrix4fv(location, false, matrix)
    },
    frame(frame: Frame) {
      this.f1("uTime", frame.time)
      this.f2("uResolution", frame.width, frame.height)
      this.f1("uAspect", frame.aspect)
      this.f2("uMouse", frame.mouseX, frame.mouseY)
      this.f1("uMouseDown", frame.mouseDown)
    },
  }
}
