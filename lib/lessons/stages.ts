import { attribBuffer, begin, bindVao, uniforms, type GL, type Handle } from "@/lib/gl/program"
import { lookAt, multiply, perspective, rotateX, rotateY } from "@/lib/gl/math"
import { src } from "@/lib/glsl/text"
import type { Lesson } from "@/lib/lessons/types"
import { deleteAll, glsl, hostFile, mountColoredTriangle } from "@/lib/lessons/runtime"

const stagesVertex = src`
  #version 300 es
  /// 顶点着色器是图形管线里第一段可编程阶段。一次 drawArrays 提交几个顶点，main 就执行几次。
  layout(location = 0) in vec2 aPosition;
  layout(location = 1) in vec3 aColor;
  /// 这个 out 会穿过图元装配和光栅化，变成片段着色器里的 in。
  out vec3 vColor;
  void main() {
    vColor = aColor;
    /// 这里写出的是裁剪坐标 clip space。裁剪、除以 w、视口变换都发生在这行之后，由驱动完成。
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`

const stagesFragment = src`
  #version 300 es
  precision mediump float;
  in vec3 vColor;
  layout(location = 0) out vec4 fragColor;
  void main() {
    /// 每个被三角形盖住的片元执行一次。颜色写到输出之后，还要经过剪裁、模板、深度和混合，才会进帧缓冲。
    fragColor = vec4(vColor, 1.0);
  }
`

const stagesHost = src`
  /// 这一次 drawArrays 就是绘制调用。它把上面两个着色器连成的程序送进管线。
  gl.useProgram(program)
  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
`

const partsVertex = src`
  #version 300 es
  layout(location = 0) in vec2 aPosition;
  layout(location = 1) in vec3 aBary;
  uniform float uMode;
  uniform float uAspect;
  out vec3 vBary;
  out float vMode;
  void main() {
    /// x 再除以宽高比，三份三角形在像素上一样宽。列距 0.64，避免宽画面上互相叠住。
    vec2 p = vec2(aPosition.x * 0.46 / max(uAspect, 0.001), aPosition.y * 0.62);
    p.x += (uMode - 1.0) * 0.64;
    gl_PointSize = 36.0;
    gl_Position = vec4(p, 0.0, 1.0);
    vBary = aBary;
    vMode = uMode;
  }
`

const partsFragment = src`
  #version 300 es
  precision highp float;
  in vec3 vBary;
  in float vMode;
  layout(location = 0) out vec4 fragColor;

  vec3 baryColor(vec3 b) {
    return vec3(0.93, 0.45, 0.32) * b.x
      + vec3(0.95, 0.78, 0.40) * b.y
      + vec3(0.38, 0.66, 0.55) * b.z;
  }

  void main() {
    vec3 ink = baryColor(vBary);
    if (vMode < 0.5) {
      /// POINTS 的每个顶点变成一块方的点精灵。gl_PointCoord 是这块正方形内部的坐标。
      vec2 q = gl_PointCoord * 2.0 - 1.0;
      if (dot(q, q) > 0.85) discard;
      fragColor = vec4(ink, 1.0);
    } else if (vMode < 1.5) {
      /// 图元仍是一个三角形。离三条边远的片元丢掉，留下的就是这个图元的轮廓。
      float d = min(vBary.x, min(vBary.y, vBary.z));
      float aa = fwidth(d) * 2.4;
      float edge = 1.0 - smoothstep(aa * 0.35, aa, d);
      if (edge < 0.04) discard;
      fragColor = vec4(mix(vec3(0.08, 0.07, 0.055), vec3(0.96, 0.93, 0.86), edge), 1.0);
    } else {
      /// gl_FragCoord 是窗口像素。每 13 像素画一格，格就是光栅化产生的片元。
      vec2 cell = mod(gl_FragCoord.xy, 13.0);
      float gap = 1.0 - smoothstep(0.0, 1.35, min(cell.x, cell.y));
      vec3 color = mix(ink, ink * 0.28, gap);
      fragColor = vec4(color, 1.0);
    }
  }
`

const partsHost = src`
  /// 同一批顶点，三种图元。装配阶段按绘制模式把它们收成点、或者收成三角形。
  gl.uniform1f(uMode, 0)
  gl.drawArrays(gl.POINTS, 0, 3)

  gl.uniform1f(uMode, 1)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  gl.uniform1f(uMode, 2)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
`

const TRI_POS = new Float32Array([-0.72, -0.62, 0.72, -0.62, 0, 0.74])
const TRI_BARY = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])

function mountParts(gl: GL, program: WebGLProgram): Handle {
  const vao = bindVao(gl)
  const buffers = [
    attribBuffer(gl, program, "aPosition", 2, TRI_POS),
    attribBuffer(gl, program, "aBary", 3, TRI_BARY),
  ]
  const u = uniforms(gl, program)
  return {
    draw(frame) {
      begin(gl, frame)
      gl.useProgram(program)
      if (vao && "bindVertexArray" in gl) (gl as WebGL2RenderingContext).bindVertexArray(vao)
      u.frame(frame)
      u.f1("uMode", 0)
      gl.drawArrays(gl.POINTS, 0, 3)
      u.f1("uMode", 1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      u.f1("uMode", 2)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose() {
      deleteAll(gl, buffers, vao)
    },
  }
}

const divideVertex = src`
  #version 300 es
  /// aClip 是写进 gl_Position 的 xy，此时还没除以 w。aW 是这个顶点的 w。
  layout(location = 0) in vec2 aClip;
  layout(location = 1) in float aW;
  /// 左半是 -1，右半是 1。用来把同一组数放到画面两侧。
  layout(location = 2) in float aPanel;
  out float vPanel;
  void main() {
    /// 左边强制 w = 1，屏幕位置等于你写的 xy。右边保留真正的 w，固定功能会做 xyz / w。
    float w = aPanel < 0.0 ? 1.0 : aW;
    vec2 clip = aClip + vec2(aPanel * 0.52 * w, 0.0);
    gl_Position = vec4(clip, 0.0, w);
    vPanel = aPanel;
  }
`

const divideFragment = src`
  #version 300 es
  precision mediump float;
  in float vPanel;
  layout(location = 0) out vec4 fragColor;
  void main() {
    vec3 color = vPanel < 0.0 ? vec3(0.95, 0.78, 0.40) : vec3(0.93, 0.48, 0.32);
    fragColor = vec4(color, 1.0);
  }
`

const divideHost = src`
  /// 三个顶点的 w 分别是 1、1、2.6。左半把 w 改成 1，右半保留 2.6。
  /// 顶点着色器返回后，驱动做三件事：
  /// 1. 裁剪。某个分量超出 [-w, w] 时，图元被切开，切面上会出现新顶点。
  /// 2. 透视除法。ndc = clip.xyz / clip.w，范围大约 -1 到 1。
  /// 3. 视口变换。gl.viewport 把 NDC 映射到窗口像素，y 向上，原点在视口左下。
  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.drawArrays(gl.TRIANGLES, 0, 6)
`

const CLIP = new Float32Array([-0.36, -0.46, 0.36, -0.46, 0, 0.86, -0.36, -0.46, 0.36, -0.46, 0, 0.86])
const CLIP_W = new Float32Array([1, 1, 2.6, 1, 1, 2.6])
const CLIP_PANEL = new Float32Array([-1, -1, -1, 1, 1, 1])

function mountDivide(gl: GL, program: WebGLProgram): Handle {
  const vao = bindVao(gl)
  const buffers = [
    attribBuffer(gl, program, "aClip", 2, CLIP),
    attribBuffer(gl, program, "aW", 1, CLIP_W),
    attribBuffer(gl, program, "aPanel", 1, CLIP_PANEL),
  ]
  return {
    draw(frame) {
      begin(gl, frame)
      gl.useProgram(program)
      if (vao && "bindVertexArray" in gl) (gl as WebGL2RenderingContext).bindVertexArray(vao)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    },
    dispose() {
      deleteAll(gl, buffers, vao)
    },
  }
}

const rasterVertex = src`
  #version 300 es
  layout(location = 0) in vec2 aPosition;
  layout(location = 1) in vec3 aBary;
  out vec3 vBary;
  void main() {
    /// 三个顶点的重心坐标分别是 (1,0,0)、(0,1,0)、(0,0,1)。片元拿到的是插值后的结果。
    vBary = aBary;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`

const rasterFragment = src`
  #version 300 es
  precision highp float;
  in vec3 vBary;
  layout(location = 0) out vec4 fragColor;

  float lane(float t) {
    float f = fract(t * 5.0);
    return min(f, 1.0 - f);
  }

  void main() {
    /// 片元颜色 = 三个顶点色按重心坐标加权。三个权重之和是 1。
    vec3 color = vec3(0.93, 0.45, 0.32) * vBary.x
      + vec3(0.95, 0.78, 0.40) * vBary.y
      + vec3(0.38, 0.66, 0.55) * vBary.z;
    float d = min(lane(vBary.x), min(lane(vBary.y), lane(vBary.z)));
    float line = 1.0 - smoothstep(0.015, 0.045, d);
    color = mix(color, vec3(0.98, 0.96, 0.90), line);
    fragColor = vec4(color, 1.0);
  }
`

const rasterHost = src`
  /// 光栅化不在着色器里。驱动用三个顶点围出三角形，为里面的每个片元算重心坐标，再混合顶点着色器的 out。
  gl.drawArrays(gl.TRIANGLES, 0, 3)
`

const RASTER_POS = new Float32Array([-0.92, -0.78, 0.92, -0.78, 0, 0.82])

function mountRaster(gl: GL, program: WebGLProgram): Handle {
  const vao = bindVao(gl)
  const buffers = [
    attribBuffer(gl, program, "aPosition", 2, RASTER_POS),
    attribBuffer(gl, program, "aBary", 3, TRI_BARY),
  ]
  return {
    draw(frame) {
      begin(gl, frame)
      gl.useProgram(program)
      if (vao && "bindVertexArray" in gl) (gl as WebGL2RenderingContext).bindVertexArray(vao)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose() {
      deleteAll(gl, buffers, vao)
    },
  }
}

const facingVertex = src`
  #version 300 es
  layout(location = 0) in vec3 aPosition;
  uniform mat4 uMvp;
  out vec3 vObject;
  void main() {
    vObject = aPosition;
    /// MVP 的结果仍然是裁剪坐标。正面、背面要等变换进窗口坐标之后，看三角形的绕向。
    gl_Position = uMvp * vec4(aPosition, 1.0);
  }
`

const facingFragment = src`
  #version 300 es
  precision mediump float;
  in vec3 vObject;
  layout(location = 0) out vec4 fragColor;
  void main() {
    float band = smoothstep(-0.15, 0.15, vObject.x);
    vec3 frontFace = mix(vec3(0.93, 0.48, 0.30), vec3(0.96, 0.84, 0.50), band);
    vec3 backFace = mix(vec3(0.25, 0.52, 0.50), vec3(0.62, 0.84, 0.74), band);
    /// 窗口空间里逆时针的一面是正面。gl.frontFace(gl.CCW) 规定了这件事。
    fragColor = vec4(gl_FrontFacing ? frontFace : backFace, 1.0);
  }
`

const facingHost = src`
  gl.enable(gl.DEPTH_TEST)
  gl.enable(gl.CULL_FACE)
  gl.cullFace(gl.BACK)
  gl.frontFace(gl.CCW)

  /// 左半视口关掉剔除，卡片转到背面时着成绿色。
  gl.viewport(0, 0, width / 2, height)
  gl.disable(gl.CULL_FACE)
  gl.drawArrays(gl.TRIANGLES, 0, 6)

  /// 右半视口剔除背面。同一张卡片转到背面时整面消失。
  gl.viewport(width / 2, 0, width / 2, height)
  gl.enable(gl.CULL_FACE)
  gl.drawArrays(gl.TRIANGLES, 0, 6)
`

const CARD = new Float32Array([
  -0.62, -0.42, 0, 0.62, -0.42, 0, 0.62, 0.42, 0, -0.62, -0.42, 0, 0.62, 0.42, 0, -0.62, 0.42, 0,
])

function mountFacing(gl: GL, program: WebGLProgram): Handle {
  const vao = bindVao(gl)
  const buffer = attribBuffer(gl, program, "aPosition", 3, CARD)
  const u = uniforms(gl, program)
  gl.enable(gl.DEPTH_TEST)
  gl.cullFace(gl.BACK)
  gl.frontFace(gl.CCW)
  const drawHalf = (x: number, width: number, height: number, cull: boolean, time: number) => {
    gl.viewport(x, 0, width, height)
    gl.scissor(x, 0, width, height)
    if (cull) gl.enable(gl.CULL_FACE)
    else gl.disable(gl.CULL_FACE)
    const model = multiply(rotateY(time * 0.75), rotateX(0.42))
    const view = lookAt([0, 0.05, 2.35], [0, 0, 0], [0, 1, 0])
    const proj = perspective(Math.PI / 4, width / Math.max(height, 1), 0.1, 20)
    u.mat4("uMvp", multiply(proj, multiply(view, model)))
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }
  return {
    draw(frame) {
      gl.disable(gl.SCISSOR_TEST)
      gl.disable(gl.CULL_FACE)
      begin(gl, frame)
      gl.enable(gl.DEPTH_TEST)
      gl.enable(gl.SCISSOR_TEST)
      gl.useProgram(program)
      if (vao && "bindVertexArray" in gl) (gl as WebGL2RenderingContext).bindVertexArray(vao)
      const left = Math.floor(frame.width / 2)
      const right = frame.width - left
      drawHalf(0, left, frame.height, false, frame.time)
      drawHalf(left, right, frame.height, true, frame.time)
    },
    dispose() {
      gl.deleteBuffer(buffer)
      if (vao && "deleteVertexArray" in gl) (gl as WebGL2RenderingContext).deleteVertexArray(vao)
    },
  }
}

const quadVertex = src`
  #version 300 es
  layout(location = 0) in vec2 aCorner;
  uniform vec2 uCenter;
  uniform vec2 uScale;
  uniform float uDepth;
  void main() {
    vec2 p = aCorner * uScale + uCenter;
    /// z 越小越靠近近裁剪面。深度测试比较的是变换到窗口之后的深度，近处数值更小。
    gl_Position = vec4(p, uDepth, 1.0);
  }
`

const quadFragment = src`
  #version 300 es
  precision mediump float;
  uniform vec3 uColor;
  layout(location = 0) out vec4 fragColor;
  void main() {
    fragColor = vec4(uColor, 1.0);
  }
`

const depthHost = src`
  gl.enable(gl.DEPTH_TEST)
  gl.depthFunc(gl.LESS)
  /// 近处的珊瑚先画，远处的青绿后画。深度测试开着时，后画的远矩形盖不住先画的近矩形。
  drawRect(-0.55, 0.16, -0.45, coral)
  drawRect(-0.32, -0.14, 0.55, teal)

  /// 右边关掉测试。同样的顺序，后画的远矩形按绘制顺序盖住近矩形。
  gl.disable(gl.DEPTH_TEST)
  drawRect(0.32, 0.16, -0.45, coral)
  drawRect(0.55, -0.14, 0.55, teal)
`

const UNIT_QUAD = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1])
const CORAL: [number, number, number] = [0.91, 0.46, 0.32]
const TEAL: [number, number, number] = [0.36, 0.68, 0.58]

function mountDepth(gl: GL, program: WebGLProgram): Handle {
  const vao = bindVao(gl)
  const buffer = attribBuffer(gl, program, "aCorner", 2, UNIT_QUAD)
  const u = uniforms(gl, program)
  const drawRect = (cx: number, cy: number, z: number, color: [number, number, number]) => {
    u.f2("uCenter", cx, cy)
    u.f2("uScale", 0.24, 0.36)
    u.f1("uDepth", z)
    u.f3("uColor", color[0], color[1], color[2])
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }
  return {
    draw(frame) {
      begin(gl, frame)
      gl.useProgram(program)
      if (vao && "bindVertexArray" in gl) (gl as WebGL2RenderingContext).bindVertexArray(vao)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LESS)
      drawRect(-0.55, 0.16, -0.45, CORAL)
      drawRect(-0.32, -0.14, 0.55, TEAL)
      gl.disable(gl.DEPTH_TEST)
      drawRect(0.32, 0.16, -0.45, CORAL)
      drawRect(0.55, -0.14, 0.55, TEAL)
    },
    dispose() {
      gl.deleteBuffer(buffer)
      if (vao && "deleteVertexArray" in gl) (gl as WebGL2RenderingContext).deleteVertexArray(vao)
    },
  }
}

const blendVertex = src`
  #version 300 es
  layout(location = 0) in vec2 aCorner;
  uniform vec2 uCenter;
  uniform float uRadius;
  uniform float uAspect;
  out vec2 vLocal;
  void main() {
    vLocal = aCorner;
    vec2 p = vec2(aCorner.x / max(uAspect, 0.001), aCorner.y) * uRadius + uCenter;
    gl_Position = vec4(p, 0.0, 1.0);
  }
`

const blendFragment = src`
  #version 300 es
  precision mediump float;
  in vec2 vLocal;
  uniform vec4 uColor;
  layout(location = 0) out vec4 fragColor;
  void main() {
    if (dot(vLocal, vLocal) > 1.0) discard;
    /// rgb 是直线 alpha，没有预先乘上 a。混合公式由 CPU 的 blendFunc 决定。
    fragColor = uColor;
  }
`

const blendHost = src`
  /// 标准透明：结果 = 源颜色 * 源 alpha + 帧缓冲里已有的颜色 * (1 - 源 alpha)
  gl.blendEquation(gl.FUNC_ADD)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  gl.disable(gl.BLEND)
  drawCircle(leftBack)
  drawCircle(leftFront)

  gl.enable(gl.BLEND)
  drawCircle(rightBack)
  drawCircle(rightFront)
`

function mountBlend(gl: GL, program: WebGLProgram): Handle {
  const vao = bindVao(gl)
  const buffer = attribBuffer(gl, program, "aCorner", 2, UNIT_QUAD)
  const u = uniforms(gl, program)
  const drawCircle = (cx: number, cy: number, color: [number, number, number, number], frameAspect: number) => {
    u.f2("uCenter", cx, cy)
    u.f1("uRadius", 0.34)
    u.f1("uAspect", frameAspect)
    const location = u.loc("uColor")
    if (location) gl.uniform4f(location, color[0], color[1], color[2], color[3])
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }
  return {
    draw(frame) {
      begin(gl, frame)
      gl.useProgram(program)
      if (vao && "bindVertexArray" in gl) (gl as WebGL2RenderingContext).bindVertexArray(vao)
      gl.disable(gl.BLEND)
      const back: [number, number, number, number] = [0.91, 0.45, 0.3, 0.78]
      const front: [number, number, number, number] = [0.32, 0.66, 0.58, 0.72]
      drawCircle(-0.58, 0.16, back, frame.aspect)
      drawCircle(-0.36, -0.12, front, frame.aspect)
      gl.enable(gl.BLEND)
      gl.blendEquation(gl.FUNC_ADD)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      drawCircle(0.36, 0.16, back, frame.aspect)
      drawCircle(0.58, -0.12, front, frame.aspect)
    },
    dispose() {
      gl.deleteBuffer(buffer)
      if (vao && "deleteVertexArray" in gl) (gl as WebGL2RenderingContext).deleteVertexArray(vao)
    },
  }
}

const stencilVertex = src`
  #version 300 es
  layout(location = 0) in vec2 aPosition;
  uniform float uTime;
  uniform float uAspect;
  uniform int uPass;
  void main() {
    if (uPass == 0) {
      /// x 除以宽高比，圆在窗口里才是圆，不是被画布拉宽的椭圆。
      vec2 p = vec2(aPosition.x / max(uAspect, 0.001), aPosition.y) * 0.40;
      p += vec2(sin(uTime * 0.65) * 0.28 / max(uAspect, 0.001), cos(uTime * 0.5) * 0.28);
      gl_Position = vec4(p, 0.0, 1.0);
    } else {
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  }
`

const stencilFragment = src`
  #version 300 es
  precision mediump float;
  layout(location = 0) out vec4 fragColor;
  void main() {
    /// 模板测试发生在着色器之后。这里只提供通过测试时要写的颜色。
    float stripe = step(0.5, fract(gl_FragCoord.x / 16.0));
    vec3 color = mix(vec3(0.90, 0.48, 0.30), vec3(0.40, 0.70, 0.60), stripe);
    fragColor = vec4(color, 1.0);
  }
`

const stencilHost = src`
  gl.enable(gl.STENCIL_TEST)
  gl.clearStencil(0)
  gl.clear(gl.STENCIL_BUFFER_BIT)

  /// 第一遍只写模板。colorMask 关掉，所以圆本身不出现在颜色里。通过的像素模板值改成 1。
  gl.colorMask(false, false, false, false)
  gl.stencilFunc(gl.ALWAYS, 1, 0xff)
  gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE)
  gl.uniform1i(uPass, 0)
  gl.drawArrays(gl.TRIANGLE_FAN, 0, circleCount)

  /// 第二遍画整屏条纹。模板值等于 1 的像素才允许写入颜色。
  gl.colorMask(true, true, true, true)
  gl.stencilFunc(gl.EQUAL, 1, 0xff)
  gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
  gl.uniform1i(uPass, 1)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
`

function circleFan(segments: number): Float32Array {
  const data = new Float32Array((segments + 2) * 2)
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    data[(i + 1) * 2] = Math.cos(angle)
    data[(i + 1) * 2 + 1] = Math.sin(angle)
  }
  return data
}

const BIG_TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3])

function mountStencil(gl: GL, program: WebGLProgram): Handle {
  const gl2 = gl as WebGL2RenderingContext
  const circle = circleFan(64)
  const circleVao = gl2.createVertexArray()
  gl2.bindVertexArray(circleVao)
  const circleBuffer = attribBuffer(gl, program, "aPosition", 2, circle)
  const fullVao = gl2.createVertexArray()
  gl2.bindVertexArray(fullVao)
  const fullBuffer = attribBuffer(gl, program, "aPosition", 2, BIG_TRIANGLE)
  const u = uniforms(gl, program)
  return {
    draw(frame) {
      gl.colorMask(true, true, true, true)
      gl.disable(gl.STENCIL_TEST)
      begin(gl, frame)
      gl.clearStencil(0)
      gl.clear(gl.STENCIL_BUFFER_BIT)
      gl.useProgram(program)
      u.frame(frame)
      gl.enable(gl.STENCIL_TEST)
      gl.stencilMask(0xff)
      gl.colorMask(false, false, false, false)
      gl.stencilFunc(gl.ALWAYS, 1, 0xff)
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE)
      gl2.bindVertexArray(circleVao)
      u.i1("uPass", 0)
      gl.drawArrays(gl.TRIANGLE_FAN, 0, 66)
      gl.colorMask(true, true, true, true)
      gl.stencilFunc(gl.EQUAL, 1, 0xff)
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
      gl2.bindVertexArray(fullVao)
      u.i1("uPass", 1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose() {
      gl.deleteBuffer(circleBuffer)
      gl.deleteBuffer(fullBuffer)
      gl2.deleteVertexArray(circleVao)
      gl2.deleteVertexArray(fullVao)
    },
  }
}

export const stageLessons: Lesson[] = [
  {
    id: "pipeline-stages",
    chapter: "渲染管线",
    title: "一次绘制要经过的阶段",
    summary: "绘制调用进入顶点着色器，固定功能完成装配、裁剪、除法和光栅化，片段着色器之后才写入帧缓冲。",
    figure: "这只三角形是整条管线跑完的结果。暖色阶段是 GLSL，其余阶段由驱动完成。",
    diagram: "pipeline",
    prose: [
      "绘制调用是 CPU 上的 gl.drawArrays 或 gl.drawElements。它把已经链接好的程序、顶点数据和当时的固定功能状态一起提交。程序由顶点着色器和片段着色器链接而成。在 OpenGL ES 2.0 和 3.0 里，图形管线中可编程的就是这两段。",
      "顶点着色器每个顶点执行一次，把 gl_Position 写成裁剪坐标。接着是固定功能：图元装配把顶点收成点、线或三角形；裁剪切掉裁剪体外的部分；透视除法用 xyz 除以 w，得到大约落在 -1 到 1 的归一化设备坐标，简称 NDC；视口变换再把 NDC 映射成窗口像素。光栅化确定三角形盖住哪些片元，并插值顶点着色器的 out。",
      "片段着色器每个片元执行一次，把颜色写到 location 0。片元着色器返回之后还有剪裁测试、模板测试、深度测试和混合。通过的结果写入帧缓冲。画布这块默认帧缓冲至少有颜色缓冲，需要时再加上深度缓冲和模板缓冲。ES 3.1 的计算着色器不走这条图形管线。几何着色器和曲面细分不属于 OpenGL ES。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "stages.vert", "顶点着色器", stagesVertex),
      glsl("fragment", "stages.frag", "片段着色器", stagesFragment),
      hostFile(stagesHost),
    ],
    mount: mountColoredTriangle,
  },
  {
    id: "primitive-parts",
    chapter: "渲染管线",
    title: "顶点、图元、片元",
    summary: "顶点是着色器的一次调用，图元是点线面，片元是光栅化交给片段着色器的像素候选。",
    figure: "同一组顶点。左边是三个顶点，中间是三角形的边，右边是片元格子。",
    overlay: [
      { left: "6%", top: "8%", text: "顶点" },
      { left: "40%", top: "8%", text: "图元" },
      { left: "72%", top: "8%", text: "片元" },
    ],
    prose: [
      "顶点是顶点着色器的一次执行，带着位置和随顶点变化的属性。图元是装配之后的几何：POINTS、LINES、TRIANGLES，以及带状的 LINE_STRIP、TRIANGLE_STRIP。三个顶点按绘制模式才能成为一个三角形，顶点自己还没有面积。",
      "片元是光栅化在图元内部生成的记录，带有窗口坐标、插值后的数据和一个覆盖率。它是像素的候选，还要经过后面的测试才写进帧缓冲。多重采样时，一个像素边上可以有多个采样；片段着色器通常仍按片元运行，采样用来决定这个片元覆盖了像素的多少。",
      "左边用 gl.POINTS，一个顶点一块点精灵。中间仍用 gl.TRIANGLES，离边远的片元被 discard，所以看见的是图元的三条边。右边把窗口像素画成格子，格子只出现在三角形内部，那就是这个图元产生的片元。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "parts.vert", "顶点着色器", partsVertex),
      glsl("fragment", "parts.frag", "片段着色器", partsFragment),
      hostFile(partsHost),
    ],
    mount: mountParts,
  },
  {
    id: "clip-divide",
    chapter: "渲染管线",
    title: "裁剪、透视除法、视口",
    summary: "gl_Position 在裁剪空间。驱动用 w 做裁剪和除法，再用视口把 NDC 变成像素。",
    figure: "两边是同一组 xy。左边把 w 当成 1，右边顶点 w 为 2.6，除法之后顶部靠近中心。",
    overlay: [
      { left: "8%", top: "8%", text: "w = 1" },
      { left: "58%", top: "8%", text: "xyz / w" },
    ],
    prose: [
      "裁剪坐标是一个四维向量，顶点着色器把它写进 gl_Position。裁剪体是 -w ≤ x,y,z ≤ w。某个顶点越界时，图元和六个面求交，交点成为新的顶点。这些新顶点不在你的缓冲里，插值量会在切面上重新计算。",
      "透视除法把通过裁剪的坐标变成 NDC：用 x、y、z 分别除以 w。w 为 1 时位置不变。w 更大时，顶点被拉向原点。投影矩阵靠这个把远处压小。NDC 的 z 也会被映射进深度缓冲，近处对应更小的窗口深度。",
      "视口变换是 gl.viewport(x, y, width, height)。NDC 的 x = -1 落在视口左边缘，y = -1 落在下边缘，y 朝上。得到的就是窗口坐标，片段着色器里的 gl_FragCoord.xy 用像素表示它，像素中心在 .5。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "divide.vert", "顶点着色器", divideVertex),
      glsl("fragment", "divide.frag", "片段着色器", divideFragment),
      hostFile(divideHost),
    ],
    mount: mountDivide,
  },
  {
    id: "raster",
    chapter: "渲染管线",
    title: "光栅化与重心坐标",
    summary: "三角形内部每个片元拿到一组重心坐标。顶点着色器的 out 按这组权重混合。",
    figure: "三角的三个角是纯色。内部的颜色和白线都是重心坐标插出来的。",
    prose: [
      "光栅化遍历图元覆盖的像素，为每个片元计算重心坐标。三个顶点分别是 (1,0,0)、(0,1,0)、(0,0,1)，内部任意一点的三个分量都大于 0，并且加起来等于 1。边上有一个分量为 0。",
      "顶点着色器写出的 out，到了片段着色器就是按这组权重混合后的 in。默认是 smooth，并且是透视校正的：先把值除以 w 再插值，片元里再乘回来。三个顶点的 w 都是 1 时，校正结果和屏幕上的直线插值相同。w 不同时，屏幕正中的片元拿到的不是 0.5。ES 3.00 可以写 flat 关掉插值，没有桌面 GLSL 的 noperspective。",
      "这张图把重心坐标直接当成三个顶点色的权重。白线是某个权重跨过 0.2 的整数倍。ES 1.00 里这些跨阶段的变量叫 varying；ES 3.00 在顶点着色器写 out，在片段着色器写同名的 in。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "raster.vert", "顶点着色器", rasterVertex),
      glsl("fragment", "raster.frag", "片段着色器", rasterFragment),
      hostFile(rasterHost),
    ],
    mount: mountRaster,
  },
  {
    id: "front-face",
    chapter: "渲染管线",
    title: "绕组、正面与背面剔除",
    summary: "窗口空间里逆时针的一面是正面。剔除背面后，卡片转到背面就不再产生片元。",
    figure: "同一张卡片在转。左边保留背面，着成绿色。右边开启背面剔除，背面不画。",
    overlay: [
      { left: "8%", top: "8%", text: "不剔除" },
      { left: "58%", top: "8%", text: "剔除背面" },
    ],
    prose: [
      "绕组是三角形三个顶点在窗口坐标里的绕行方向。gl.frontFace(gl.CCW) 把逆时针定成正面，这是默认值。顺时针的一面就是背面。判断发生在视口变换之后，所以模型转了 180 度，原来的正面会变成背面。",
      "gl.enable(gl.CULL_FACE) 和 gl.cullFace(gl.BACK) 让背面在光栅化之前丢掉。被丢掉的面不产生片元，片段着色器不会为它运行。左右两半用了两个视口：gl.viewport 决定 NDC 画到哪一块像素，gl.scissor 把绘制限制在同一块矩形里，避免左半边的卡片写进右半边。",
      "片段着色器可以用 gl_FrontFacing 分辨当前片元来自哪一面。它是布尔值，背面时为 false。正面和背面都要画的时候关掉剔除，用它换颜色；实心物体通常剔除背面，省掉朝内的那一半。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "facing.vert", "顶点着色器", facingVertex),
      glsl("fragment", "facing.frag", "片段着色器", facingFragment),
      hostFile(facingHost),
    ],
    mount: mountFacing,
  },
  {
    id: "depth-test",
    chapter: "渲染管线",
    title: "深度测试",
    summary: "深度缓冲记住每个像素离相机有多近。后画的更远的片元通不过 GL_LESS，写不进颜色。",
    figure: "近的珊瑚先画，远的青绿后画。左边开着深度测试，右边关掉，后画的盖住先画的。",
    overlay: [
      { left: "8%", top: "8%", text: "深度测试" },
      { left: "58%", top: "8%", text: "按绘制顺序" },
    ],
    prose: [
      "深度缓冲和颜色缓冲一样大，每个像素存一个窗口深度。透视除法之后，NDC 的 z 被映射到 0 到 1，近裁剪面对应更小的值。gl.enable(gl.DEPTH_TEST) 之后，默认的 gl.depthFunc(gl.LESS) 只让比缓冲里更近的片元通过，并通过时用 gl.depthMask 更新缓冲。",
      "图上两块矩形的 gl_Position.z 一个是 -0.45，一个是 0.55，w 都是 1。珊瑚更近。它先画，青绿后画。左边测试开着，重叠处留下珊瑚。右边测试关掉，后写的颜色直接替换，重叠处变成青绿。",
      "片元着色器若执行 discard，或者写入 gl_FragDepth，驱动就不能在着色器之前提前做深度测试。普通的不透明物体保持深度可写、函数用 LESS，近处的大物体先画，可以让后面被挡住的片元少跑片段着色器。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "depth.vert", "顶点着色器", quadVertex),
      glsl("fragment", "depth.frag", "片段着色器", quadFragment),
      hostFile(depthHost),
    ],
    mount: mountDepth,
  },
  {
    id: "blend-test",
    chapter: "渲染管线",
    title: "混合",
    summary: "混合在深度测试之后，把片元颜色和帧缓冲里已经有的颜色按公式合成。",
    figure: "两圆都带 alpha。左边混合关掉，后画的圆替换重叠处。右边用源 alpha 与背景合成。",
    overlay: [
      { left: "8%", top: "8%", text: "关闭混合" },
      { left: "58%", top: "8%", text: "SRC_ALPHA" },
    ],
    prose: [
      "混合是片元操作的后一步。通过模板和深度的颜色不会直接替换帧缓冲，而是按公式和已有颜色合成。gl.blendEquation(gl.FUNC_ADD) 加上 gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA) 时，结果等于源颜色乘源 alpha，再加上帧缓冲颜色乘 1 减源 alpha。",
      "这两个圆的 alpha 大约是 0.75，rgb 是直线存储的，没有预先乘上 alpha。这一则的画布上下文把 premultipliedAlpha 设为 false，浏览器按同样的约定读取画布。先画珊瑚，再画青绿。",
      "左边没有 gl.enable(gl.BLEND)，后一个圆的 rgb 直接写进重叠的像素。右边开了混合，重叠处是两种颜色按 alpha 合成的结果。半透明物体一般还要按从远到近排序，因为混合之后往往不再写入深度，后画的远物体会错误地叠在近物体上面。",
    ],
    api: "webgl2",
    context: { premultipliedAlpha: false, alpha: false },
    files: [
      glsl("vertex", "blend.vert", "顶点着色器", blendVertex),
      glsl("fragment", "blend.frag", "片段着色器", blendFragment),
      hostFile(blendHost),
    ],
    mount: mountBlend,
  },
  {
    id: "stencil-test",
    chapter: "渲染管线",
    title: "模板测试",
    summary: "模板缓冲是每个像素一个整数。先用几何体写入这个整数，再规定什么值才允许写颜色。",
    figure: "圆只写进模板，不写颜色。条纹只出现在模板值等于 1 的像素里，圆在画面上移动。",
    prose: [
      "模板缓冲和颜色、深度并列，是帧缓冲的另一块附件。每个像素一个整数。测试在片段着色器之后、深度测试之前。gl.stencilFunc(func, ref, mask) 比较缓冲值和 ref，gl.stencilOp 决定测试失败、深度失败、两者都通过时怎么改这个整数。",
      "第一遍把颜色掩码关掉，圆的片元不写颜色，stencilOp 在通过时用 REPLACE 把模板写成 1。第二遍画满屏条纹，stencilFunc 用 EQUAL，只有模板已经是 1 的像素才写颜色。圆的位置来自 uTime，所以窗口在动，条纹纹素本身不动。",
      "创建画布时要向 WebGL 要模板缓冲，这一则的上下文带 stencil: true。discard 的片元不会更新模板。模板适合镜子范围、轮廓和门户：先用形状占领一块像素，后面的绘制被限制在这块像素里。",
    ],
    api: "webgl2",
    context: { stencil: true, antialias: false, depth: false, alpha: false },
    files: [
      glsl("vertex", "stencil.vert", "顶点着色器", stencilVertex),
      glsl("fragment", "stencil.frag", "片段着色器", stencilFragment),
      hostFile(stencilHost),
    ],
    mount: mountStencil,
  },
]
