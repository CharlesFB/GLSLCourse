import {
  attribBuffer,
  begin,
  bindVao,
  uniforms,
  type GL,
  type Handle,
} from "@/lib/gl/program"
import { src } from "@/lib/glsl/text"
import type { Lesson } from "@/lib/lessons/types"
import {
  deleteAll,
  fullscreenVertex,
  glsl,
  hostFile,
  mountColoredTriangle,
  mountFullscreen,
} from "@/lib/lessons/runtime"

const attributeVertex = src`
  #version 300 es
  /// 每个顶点一份。location 和 CPU 的 vertexAttribPointer 对上。
  layout(location = 0) in vec2 aPosition;
  layout(location = 1) in vec3 aColor;
  out vec3 vColor;
  void main() {
    /// 这次 main 只看见一个顶点的 aColor。插值发生在光栅化，不发生在这里。
    vColor = aColor;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`

const attributeFragment = src`
  #version 300 es
  precision mediump float;
  in vec3 vColor;
  layout(location = 0) out vec4 fragColor;
  void main() {
    fragColor = vec4(vColor, 1.0);
  }
`

const attributeHost = src`
  const positions = new Float32Array([
    -0.72, -0.55,
    0.72, -0.55,
    0.0, 0.62,
  ])
  const colors = new Float32Array([
    0.93, 0.45, 0.32,
    0.95, 0.78, 0.40,
    0.38, 0.66, 0.55,
  ])

  /// ARRAY_BUFFER 里是原始字节。vertexAttribPointer 告诉 GPU 怎么把它们切成 vec2、vec3。
  function bind(name: string, size: number, data: Float32Array) {
    const buffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    const location = gl.getAttribLocation(program, name)
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
  }

  bind("aPosition", 2, positions)
  bind("aColor", 3, colors)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
`

const uniformFragment = src`
  #version 300 es
  precision mediump float;
  in vec2 vUv;
  /// 同一次 draw 里，每个顶点、每个片元读到的 uniform 都一样。着色器不能写它。
  uniform float uTime;
  uniform vec3 uTint;
  uniform float uRadius;
  layout(location = 0) out vec4 fragColor;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = length(p);
    /// uRadius 和 uTint 由 CPU 每帧算好再送进来。着色器只负责使用。
    float disc = smoothstep(uRadius, uRadius - 0.015, d);
    /// uTime 也是 uniform。时钟只有一份，所以整张图一起转。
    float sweep = 0.5 + 0.5 * sin(atan(p.y, p.x) + uTime);
    vec3 color = mix(vec3(0.08, 0.07, 0.055), uTint * (0.55 + 0.45 * sweep), disc);
    fragColor = vec4(color, 1.0);
  }
`

const uniformHost = src`
  const uTime = gl.getUniformLocation(program, "uTime")
  const uTint = gl.getUniformLocation(program, "uTint")
  const uRadius = gl.getUniformLocation(program, "uRadius")

  function frame(timeSeconds: number) {
    /// 颜色在 CPU 上决定。着色器看不到 Math.sin，只看到三个已经算完的 float。
    gl.uniform3f(
      uTint,
      0.55 + 0.4 * Math.sin(timeSeconds),
      0.42,
      0.32 + 0.25 * Math.cos(timeSeconds * 0.7),
    )
    gl.uniform1f(uRadius, 0.32 + 0.14 * Math.sin(timeSeconds * 0.8))
    gl.uniform1f(uTime, timeSeconds)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
`

function mountUniform(gl: GL, program: WebGLProgram): Handle {
  const vao = bindVao(gl)
  const u = uniforms(gl, program)
  return {
    draw(frame) {
      begin(gl, frame)
      gl.useProgram(program)
      if (vao && "bindVertexArray" in gl) (gl as WebGL2RenderingContext).bindVertexArray(vao)
      const t = frame.time
      u.f3("uTint", 0.55 + 0.4 * Math.sin(t), 0.42, 0.32 + 0.25 * Math.cos(t * 0.7))
      u.f1("uRadius", 0.32 + 0.14 * Math.sin(t * 0.8))
      u.frame(frame)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose() {
      if (vao && "deleteVertexArray" in gl) (gl as WebGL2RenderingContext).deleteVertexArray(vao)
    },
  }
}

const flatVertex = src`
  #version 300 es
  layout(location = 0) in vec2 aPosition;
  layout(location = 1) in vec3 aColor;
  /// 默认是 smooth：光栅化时按重心插值。
  out vec3 vSmooth;
  /// flat 不插值。整个三角形都使用激发顶点的值。WebGL 里激发顶点是三角形的最后一个顶点。
  flat out vec3 vFlat;
  out vec2 vPos;
  void main() {
    vSmooth = aColor;
    vFlat = aColor;
    vPos = aPosition;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`

const flatFragment = src`
  #version 300 es
  precision mediump float;
  in vec3 vSmooth;
  /// 限定符要和顶点着色器一致，否则链接失败。
  flat in vec3 vFlat;
  in vec2 vPos;
  layout(location = 0) out vec4 fragColor;
  void main() {
    /// 左半用插值色，右半用 flat。竖线只是分界，不是几何体的边。
    float right = step(0.0, vPos.x);
    vec3 color = mix(vSmooth, vFlat, right);
    float seam = smoothstep(0.015, 0.0, abs(vPos.x));
    color = mix(color, vec3(0.96, 0.93, 0.86), seam);
    fragColor = vec4(color, 1.0);
  }
`

const flatHost = src`
  /// 顶点顺序：左下珊瑚、右下金、顶端绿。flat 取最后一个，所以右半边是纯绿。
  const positions = new Float32Array([-0.85, -0.62, 0.85, -0.62, 0.0, 0.72])
  const colors = new Float32Array([
    0.91, 0.42, 0.30,
    0.95, 0.78, 0.38,
    0.36, 0.70, 0.55,
  ])
  // 绑定方式与「顶点属性」那一则相同。
  gl.drawArrays(gl.TRIANGLES, 0, 3)
`

const uboFragment = src`
  #version 300 es
  precision mediump float;
  in vec2 vUv;
  layout(location = 0) out vec4 fragColor;

  /// std140 规定每个成员在缓冲里的对齐。没有实例名时，tint、scale、time 直接用。
  /// 写成 uniform Frame { ... } frame; 之后就要写成 frame.tint。
  layout(std140) uniform Frame {
    vec4 tint;    // 偏移 0，占 16 字节
    vec2 scale;   // 偏移 16，vec2 按 8 字节对齐
    float time;   // 偏移 24
    float pad;    // 偏移 28，把这一块补齐到 32 字节
  };

  void main() {
    vec2 p = (vUv * 2.0 - 1.0) / max(scale, vec2(0.001));
    float d = abs(p.x) + abs(p.y);
    float diamond = smoothstep(0.015, 0.0, d - (0.62 + 0.08 * sin(time)));
    vec3 color = mix(vec3(0.08, 0.07, 0.055), tint.rgb, diamond);
    fragColor = vec4(color, 1.0);
  }
`

const uboHost = src`
  /// 块的绑定点是 CPU 和着色器约定的编号，这里用 0。
  const index = gl.getUniformBlockIndex(program, "Frame")
  gl.uniformBlockBinding(program, index, 0)

  const buffer = gl.createBuffer()!
  gl.bindBuffer(gl.UNIFORM_BUFFER, buffer)
  /// 32 字节 = 8 个 float，和 std140 的布局一致。少写一个 pad，time 的位置就会错。
  gl.bufferData(gl.UNIFORM_BUFFER, 32, gl.DYNAMIC_DRAW)
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, buffer)

  const data = new Float32Array(8)
  function frame(timeSeconds: number) {
    data[0] = 0.93
    data[1] = 0.55
    data[2] = 0.32
    data[3] = 1
    data[4] = 1
    data[5] = 1
    data[6] = timeSeconds
    data[7] = 0
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, data)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
`

function mountUbo(gl: GL, program: WebGLProgram): Handle {
  const gl2 = gl as WebGL2RenderingContext
  const vao = bindVao(gl)
  const index = gl2.getUniformBlockIndex(program, "Frame")
  gl2.uniformBlockBinding(program, index, 0)
  const buffer = gl2.createBuffer()
  if (!buffer) throw new Error("无法创建 uniform 缓冲。")
  gl2.bindBuffer(gl2.UNIFORM_BUFFER, buffer)
  gl2.bufferData(gl2.UNIFORM_BUFFER, 32, gl2.DYNAMIC_DRAW)
  gl2.bindBufferBase(gl2.UNIFORM_BUFFER, 0, buffer)
  const data = new Float32Array(8)
  return {
    draw(frame) {
      begin(gl, frame)
      gl.useProgram(program)
      gl2.bindVertexArray(vao)
      data[0] = 0.93
      data[1] = 0.55 + 0.2 * Math.sin(frame.time)
      data[2] = 0.32
      data[3] = 1
      data[4] = 1
      data[5] = 1
      data[6] = frame.time
      data[7] = 0
      gl2.bindBuffer(gl2.UNIFORM_BUFFER, buffer)
      gl2.bufferSubData(gl2.UNIFORM_BUFFER, 0, data)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose() {
      gl.deleteBuffer(buffer)
      gl2.deleteVertexArray(vao)
    },
  }
}

const fragcoordFragment = src`
  #version 300 es
  precision highp float;
  in vec2 vUv;
  uniform vec2 uResolution;
  layout(location = 0) out vec4 fragColor;

  void main() {
    /// 把画面切成左右两半，每半有自己的局部坐标，范围大约 -1 到 1。
    float left = step(vUv.x, 0.5);
    vec2 st = vec2(fract(vUv.x * 2.0), vUv.y);
    vec2 p = st * 2.0 - 1.0;
    /// 半幅的像素宽高比是整幅的一半。不乘它，圆会变成椭圆。
    float halfAspect = uResolution.x / max(uResolution.y, 1.0) * 0.5;
    float dLeft = length(p);
    float dRight = length(vec2(p.x * halfAspect, p.y));
    float d = mix(dRight, dLeft, left);
    float fill = smoothstep(0.012, 0.0, d - 0.55);

    vec3 paper = vec3(0.09, 0.08, 0.065);
    vec3 ink = mix(vec3(0.86, 0.46, 0.32), vec3(0.46, 0.70, 0.60), 1.0 - left);
    vec3 color = mix(paper, ink, fill);

    /// gl_FragCoord 的单位是像素。用它画网格，格子的大小不随坐标系的 -1..1 改变。
    vec2 m = mod(gl_FragCoord.xy, 28.0);
    float distToGrid = min(min(m.x, 28.0 - m.x), min(m.y, 28.0 - m.y));
    float grid = 1.0 - smoothstep(0.0, 1.15, distToGrid);
    color = mix(color, vec3(0.95, 0.90, 0.78), grid * 0.35);
    fragColor = vec4(color, 1.0);
  }
`

const pointVertex = src`
  #version 300 es
  /// 一个点一个顶点。xy 是位置，z 是每颗点自己的种子。
  layout(location = 0) in vec3 aPoint;
  uniform float uTime;
  out float vSeed;
  void main() {
    float seed = aPoint.z;
    vec2 pos = aPoint.xy;
    pos.y = fract(pos.y * 0.5 + 0.5 + uTime * (0.03 + 0.05 * fract(seed))) * 2.0 - 1.0;
    pos.x += 0.04 * sin(uTime * 0.8 + seed);
    gl_Position = vec4(pos, 0.0, 1.0);
    /// 点的大小用像素计。驱动会把它限制在实现允许的最大值里。
    gl_PointSize = 8.0 + 26.0 * fract(seed * 1.7);
    vSeed = seed;
  }
`

const pointFragment = src`
  #version 300 es
  precision mediump float;
  in float vSeed;
  layout(location = 0) out vec4 fragColor;
  void main() {
    /// gl_PointCoord 是点精灵内部的坐标，左上角是 (0, 0)，右下角是 (1, 1)。和 vUv 的 y 轴相反。
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = dot(p, p);
    /// 点永远是正方形的包围盒。圆以外的像素丢掉，否则会看到方块。
    if (r > 1.0) discard;
    float glow = exp(-r * 2.6);
    vec3 warm = mix(vec3(0.95, 0.48, 0.28), vec3(0.98, 0.90, 0.72), fract(vSeed));
    fragColor = vec4(warm * glow, 1.0);
  }
`

const pointHost = src`
  /// 每个点三个 float：x、y、种子。绘制模式是 POINTS，不是 TRIANGLES。
  const points = new Float32Array(80 * 3)
  gl.drawArrays(gl.POINTS, 0, 80)
`

function mountPoints(gl: GL, program: WebGLProgram): Handle {
  const vao = bindVao(gl)
  const data = new Float32Array(80 * 3)
  for (let i = 0; i < 80; i += 1) {
    const angle = (i / 80) * Math.PI * 2
    const radius = 0.12 + (i % 6) * 0.12
    data[i * 3] = Math.cos(angle) * radius * 1.15
    data[i * 3 + 1] = Math.sin(angle * 1.7) * 0.85
    data[i * 3 + 2] = i * 0.37 + 0.2
  }
  const buffer = attribBuffer(gl, program, "aPoint", 3, data)
  const u = uniforms(gl, program)
  return {
    draw(frame) {
      begin(gl, frame)
      gl.useProgram(program)
      if (vao && "bindVertexArray" in gl) (gl as WebGL2RenderingContext).bindVertexArray(vao)
      u.frame(frame)
      gl.drawArrays(gl.POINTS, 0, 80)
    },
    dispose() {
      gl.deleteBuffer(buffer)
      if (vao && "deleteVertexArray" in gl) (gl as WebGL2RenderingContext).deleteVertexArray(vao)
    },
  }
}

const instanceVertex = src`
  #version 300 es
  layout(location = 0) in vec2 aCorner;
  uniform float uTime;
  out vec3 vColor;
  void main() {
    /// 同一个方块画 64 次。gl_InstanceID 从 0 数到 63，aCorner 在每次实例里都会走一遍。
    int id = gl_InstanceID;
    int col = id - (id / 8) * 8;
    int row = id / 8;
    vec2 cell = vec2(float(col) - 3.5, float(row) - 3.5) * 0.22;
    float ang = uTime * 0.7 + float(id) * 0.18;
    float c = cos(ang);
    float s = sin(ang);
    /// mat2 也是列主序。mat2(c, s, -s, c) 的两列是 (c, s) 和 (-s, c)。
    mat2 spin = mat2(c, s, -s, c);
    vec2 p = spin * (aCorner * 0.055) + cell;
    gl_Position = vec4(p, 0.0, 1.0);
    float t = float(id) / 63.0;
    vColor = mix(vec3(0.93, 0.48, 0.30), vec3(0.42, 0.70, 0.60), t);
  }
`

const instanceFragment = src`
  #version 300 es
  precision mediump float;
  in vec3 vColor;
  layout(location = 0) out vec4 fragColor;
  void main() {
    fragColor = vec4(vColor, 1.0);
  }
`

const instanceHost = src`
  const corners = new Float32Array([
    -1, -1, 1, -1, 1, 1,
    -1, -1, 1, 1, -1, 1,
  ])
  /// 顶点缓冲里仍然只有 6 个角。实例数写在绘制调用里，不写进缓冲。
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 64)
`

function mountInstances(gl: GL, program: WebGLProgram): Handle {
  const gl2 = gl as WebGL2RenderingContext
  const vao = bindVao(gl)
  const corners = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1])
  const buffer = attribBuffer(gl, program, "aCorner", 2, corners)
  const u = uniforms(gl, program)
  return {
    draw(frame) {
      begin(gl, frame)
      gl.useProgram(program)
      gl2.bindVertexArray(vao)
      u.frame(frame)
      gl2.drawArraysInstanced(gl.TRIANGLES, 0, 6, 64)
    },
    dispose() {
      gl.deleteBuffer(buffer)
      gl2.deleteVertexArray(vao)
    },
  }
}

const flatPositions = new Float32Array([-0.85, -0.62, 0.85, -0.62, 0, 0.72])
const flatColors = new Float32Array([0.91, 0.42, 0.3, 0.95, 0.78, 0.38, 0.36, 0.7, 0.55])

function mountFlat(gl: GL, program: WebGLProgram): Handle {
  const vao = bindVao(gl)
  const buffers = [
    attribBuffer(gl, program, "aPosition", 2, flatPositions),
    attribBuffer(gl, program, "aColor", 3, flatColors),
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

export const pipelineLessons: Lesson[] = [
  {
    id: "attributes",
    chapter: "数据怎么进来",
    title: "顶点属性来自缓冲",
    summary: "in 变量每个顶点一份。画面和第一则相同，坐标和颜色改由 CPU 送进缓冲。",
    figure: "还是那个三角形。差别只在 aPosition、aColor 不再写死在着色器里。",
    prose: [
      "顶点属性是着色器的 in，在 ES 2.0 里叫 attribute。一次 main 只看见一个顶点。把同一份数据送给每个顶点的做法不走这里，那是 uniform。",
      "CPU 把 float 数组放进 ARRAY_BUFFER，再用 vertexAttribPointer 说明：从当前缓冲的某个偏移开始，每几个 float 组成一个属性，类型是 FLOAT。layout(location = 0) 让着色器里的位置和这个属性槽绑定。不写 location 时，用 getAttribLocation 按变量名查询。",
      "属性的插值不是顶点着色器做的。顶点着色器把 out 写出去，光栅器在三角形内部按重心坐标混合，片段着色器的 in 拿到的是混合后的值。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "attributes.vert", "顶点着色器", attributeVertex),
      glsl("fragment", "attributes.frag", "片段着色器", attributeFragment),
      hostFile(attributeHost),
    ],
    mount: mountColoredTriangle,
  },
  {
    id: "uniforms",
    chapter: "数据怎么进来",
    title: "uniform 在一次绘制里不变",
    summary: "时间、颜色、半径由 CPU 写入。所有顶点、所有像素读到同一份。",
    figure: "圆的颜色和半径在 CPU 上变，扇形的转动用的是着色器里的 uTime。",
    prose: [
      "uniform 在一次绘制调用期间是常数。顶点和片段都能读，谁都不能写。它适合矩阵、时间、屏幕分辨率、一盏灯的颜色，不适合“每个顶点不同”的位置。",
      "CPU 用 getUniformLocation 按名字拿到位置，再按类型调用 uniform1f、uniform3f、uniformMatrix4fv。名字写错时位置是 null，WebGL 会悄悄忽略这次写入，画面停在旧值或驱动的默认值上，所以要查链接日志，也要核对拼写。",
      "动画有两种放法。一种是 CPU 把算好的颜色、半径传进来，着色器只使用。另一种是 CPU 只传时间，着色器自己做 sin。两种都是 uniform，差别是计算发生在哪一侧。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "fullscreen.vert", "顶点着色器", fullscreenVertex),
      glsl("fragment", "uniform.frag", "片段着色器", uniformFragment),
      hostFile(uniformHost),
    ],
    mount: mountUniform,
  },
  {
    id: "interpolate",
    chapter: "数据怎么进来",
    title: "smooth 与 flat",
    summary: "默认插值。加上 flat 之后，整个三角形都取最后一个顶点的值。",
    figure: "左半是三个顶点颜色的渐变，右半是纯绿。绿色来自顶点顺序里的最后一个。",
    prose: [
      "顶点着色器的 out 默认带 smooth，片段里拿到的是三角形三个顶点的插值。限定符写在顶点的 out 和片段的 in 两边，名字、类型、限定符都要一致，否则链接失败。",
      "flat 关闭插值。一个三角形里所有片元拿到同一个值，这个值来自激发顶点。WebGL 沿用 OpenGL 的约定，激发顶点是图元的最后一个顶点。这里最后一个顶点是顶端的绿色，所以右半边是纯绿，不是三个颜色的混合，也不是“离谁近用谁”。",
      "ES 3.00 还有 centroid，用来在多重采样时把采样点拉回图元内部。没有桌面 GLSL 里的 noperspective，透视校正插值是默认行为，不能关掉。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "flat.vert", "顶点着色器", flatVertex),
      glsl("fragment", "flat.frag", "片段着色器", flatFragment),
      hostFile(flatHost),
    ],
    mount: mountFlat,
  },
  {
    id: "ubo",
    chapter: "数据怎么进来",
    title: "统一缓冲块与 std140",
    summary: "一组 uniform 可以放进一块缓冲。内存布局按 std140 对齐，不能按 C 结构体来猜。",
    figure: "菱形的颜色和脉动来自一块 32 字节的 uniform 缓冲，不是一个个 uniform 调用。",
    prose: [
      "uniform 一多，逐个 uniform1f 又慢又容易写错名字。ES 3.0 可以把它们收进 uniform 块，CPU 上传一整块字节。WebGL 2 对应这件事的 API 是 UNIFORM_BUFFER。",
      "std140 是布局规则，不是“紧凑排列”。标量按 4 字节对齐，vec2 按 8 字节，vec3 和 vec4 按 16 字节。vec3 后面如果直接跟一个 float，float 可以坐进 vec3 余下的 4 字节；如果跟的是另一个 vec3，第二个 vec3 必须从下一个 16 字节边界开始。数组的每个元素都按 16 字节对齐，所以 float 数组不是紧挨着的 4 字节。",
      "这一块是 vec4、vec2、float、float，一共 32 字节。CPU 侧的 Float32Array(8) 必须按这个顺序填。少一个 pad，time 就会读到别的字节，动画会错，而且编译不会报错。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "fullscreen.vert", "顶点着色器", fullscreenVertex),
      glsl("fragment", "ubo.frag", "片段着色器", uboFragment),
      hostFile(uboHost),
    ],
    mount: mountUbo,
  },
  {
    id: "fragcoord",
    chapter: "数据怎么进来",
    title: "片元坐标与宽高比",
    summary: "gl_FragCoord 是像素坐标。把 -1 到 1 的坐标当成圆来画之前，要乘上宽高比。",
    figure: "左边的圆按局部坐标的长度来画，在宽屏上被拉扁。右边乘过半幅的宽高比。细网格来自像素坐标。",
    overlay: [
      { left: "8%", top: "8%", text: "未校正" },
      { left: "58%", top: "8%", text: "乘过宽高比" },
    ],
    prose: [
      "插值得到的 vUv 是 0 到 1，跟分辨率无关。gl_FragCoord.xy 是窗口像素，左下角为原点，像素中心落在 .5。画“每隔 28 像素一条线”必须用它，用 vUv 的话，线的粗细会跟着画布尺寸变。",
      "length(p) 在 p 的 x、y 都是 -1 到 1 时，只有画布是正方形才是几何上的圆。宽屏上 x 的 1 代表更多像素，圆会被拉宽。校正方法是把 x 乘上宽高比，让两个轴都表示同样的像素距离。",
      "gl_FragCoord.z 是窗口深度，gl_FragCoord.w 是 1/w。需要把片元投回观察空间时才会用到它们。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "fullscreen.vert", "顶点着色器", fullscreenVertex),
      glsl("fragment", "fragcoord.frag", "片段着色器", fragcoordFragment),
      hostFile(src`
        gl.uniform2f(gl.getUniformLocation(program, "uResolution"), canvas.width, canvas.height)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      `),
    ],
    mount: mountFullscreen,
  },
  {
    id: "points",
    chapter: "数据怎么进来",
    title: "点精灵与 gl_PointCoord",
    summary: "POINTS 模式下，一个顶点变成一个正方形。正方形内部的坐标是 gl_PointCoord。",
    figure: "每颗光点是一个顶点。方块的四角被 discard 掉，所以看起来是圆。",
    prose: [
      "gl.POINTS 时，顶点着色器要写 gl_PointSize，单位是像素。片段着色器会在这个正方形里跑，gl_PointCoord 从左上角的 (0, 0) 到右下角的 (1, 1)。注意 y 朝下，和 gl_FragCoord、也和这份阅读课里的 vUv 相反。",
      "点没有三角形那种插值面积，只有一块方的包围盒。要画圆，就在方块里算到中心的距离，外面的片元 discard。discard 的片元不会写颜色，也不会写深度。",
      "点的大小有实现限制，太大的 gl_PointSize 会被截断。粒子很多时，这是最省顶点的做法；需要旋转的矩形、要被场景遮挡的复杂形状，还是用三角形或实例化。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "points.vert", "顶点着色器", pointVertex),
      glsl("fragment", "points.frag", "片段着色器", pointFragment),
      hostFile(pointHost),
    ],
    mount: mountPoints,
  },
  {
    id: "instances",
    chapter: "数据怎么进来",
    title: "实例化",
    summary: "一份顶点缓冲画很多份。gl_InstanceID 区分每一份，不必把坐标复制 64 遍。",
    figure: "缓冲里只有一个方块的 6 个角。64 个位置和角度都由 gl_InstanceID 算出来。",
    prose: [
      "drawArraysInstanced(mode, first, count, instanceCount) 把同一批顶点画 instanceCount 次。每次顶点着色器除了看见原来的 in，还看见一个递增的 gl_InstanceID。",
      "这一则没有实例属性，位置完全由编号算出来。需要每份不同的外部数据时，再加一个 in，并在 CPU 上调用 vertexAttribDivisor(location, 1)，表示这个属性每实例前进一次，而不是每顶点前进一次。",
      "mat2 的构造和 mat3 一样是列主序。旋转矩阵写成 mat2(c, -s, s, c) 会得到转置，方块的转向就会反。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "instances.vert", "顶点着色器", instanceVertex),
      glsl("fragment", "instances.frag", "片段着色器", instanceFragment),
      hostFile(instanceHost),
    ],
    mount: mountInstances,
  },
]
