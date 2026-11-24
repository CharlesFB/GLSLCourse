import {
  attribBuffer,
  begin,
  bindVao,
  elementBuffer,
  uniforms,
  type Frame,
  type GL,
  type Handle,
} from "@/lib/gl/program"
import { src } from "@/lib/glsl/text"
import type { ShaderFile } from "@/lib/lessons/types"

export function glsl(
  role: "vertex" | "fragment",
  filename: string,
  label: string,
  source: string,
): ShaderFile {
  return { id: `${role}-${filename}`, label, filename, language: "glsl", role, source }
}

export function hostFile(source: string, filename = "draw.ts"): ShaderFile {
  return { id: `host-${filename}`, label: "CPU 侧", filename, language: "ts", role: "host", source }
}

export function extraFile(filename: string, label: string, source: string): ShaderFile {
  return { id: `extra-${filename}`, label, filename, language: "glsl", role: "extra", source }
}

export const fullscreenVertex = src`
  /// 这是铺满画面的样板顶点着色器。后面好几则都用它，要读的是片段着色器。
  /// gl_VertexID 是这次绘制里的顶点序号。三个顶点围成一个比屏幕更大的三角形，多出来的部分被裁掉，剩下的正好盖住整个视口。
  #version 300 es
  const vec2 kPos[3] = vec2[](
    vec2(-1.0, -1.0),
    vec2(3.0, -1.0),
    vec2(-1.0, 3.0)
  );
  /// 交给片段着色器的量。名字要和片段着色器里的 in 一致，类型也要一致。
  out vec2 vUv;
  void main() {
    vec2 p = kPos[gl_VertexID];
    /// 裁剪空间的 y 朝上，所以 vUv 的 (0, 0) 在画面左下。
    vUv = 0.5 * p + 0.5;
    /// gl_Position 是顶点着色器唯一必写的内置输出，xyzw 都在裁剪空间。
    gl_Position = vec4(p, 0.0, 1.0);
  }
`

export function mountFullscreen(gl: GL, program: WebGLProgram): Handle {
  const vao = bindVao(gl)
  const u = uniforms(gl, program)
  return {
    draw(frame: Frame) {
      begin(gl, frame)
      gl.useProgram(program)
      if (vao && "bindVertexArray" in gl) (gl as WebGL2RenderingContext).bindVertexArray(vao)
      u.frame(frame)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose() {
      if (vao && "deleteVertexArray" in gl) (gl as WebGL2RenderingContext).deleteVertexArray(vao)
    },
  }
}

const TRI_POS = new Float32Array([-0.72, -0.55, 0.72, -0.55, 0, 0.62])
const TRI_COLOR = new Float32Array([0.93, 0.45, 0.32, 0.95, 0.78, 0.4, 0.38, 0.66, 0.55])

export function mountColoredTriangle(gl: GL, program: WebGLProgram): Handle {
  const vao = bindVao(gl)
  const buffers = [
    attribBuffer(gl, program, "aPosition", 2, TRI_POS),
    attribBuffer(gl, program, "aColor", 3, TRI_COLOR),
  ]
  return {
    draw(frame) {
      begin(gl, frame)
      gl.useProgram(program)
      if (vao && "bindVertexArray" in gl) (gl as WebGL2RenderingContext).bindVertexArray(vao)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose() {
      buffers.forEach((buffer) => gl.deleteBuffer(buffer))
      if (vao && "deleteVertexArray" in gl) (gl as WebGL2RenderingContext).deleteVertexArray(vao)
    },
  }
}

export function deleteAll(gl: GL, buffers: WebGLBuffer[], vao: WebGLVertexArrayObject | null) {
  buffers.forEach((buffer) => gl.deleteBuffer(buffer))
  if (vao && "deleteVertexArray" in gl) (gl as WebGL2RenderingContext).deleteVertexArray(vao)
}

export { attribBuffer, begin, bindVao, elementBuffer, uniforms }
