import {
  attribBuffer,
  begin,
  bindVao,
  elementBuffer,
  uniforms,
  type GL,
  type Handle,
} from "@/lib/gl/program"
import { lookAt, multiply, perspective, rotateX, rotateY } from "@/lib/gl/math"
import { makeCube, makeGrid, makeSphere } from "@/lib/gl/mesh"
import { src } from "@/lib/glsl/text"
import type { Lesson } from "@/lib/lessons/types"
import {
  fullscreenVertex,
  glsl,
  hostFile,
  mountColoredTriangle,
  mountFullscreen,
} from "@/lib/lessons/runtime"

const sdfFragment = src`
  #version 300 es
  precision highp float;
  in vec2 vUv;
  uniform vec2 uResolution;
  uniform vec2 uMouse;
  layout(location = 0) out vec4 fragColor;

  /// 距离场：返回值是点到边界的有符号距离。里面为负，外面为正。
  float sdCircle(vec2 p, float r) {
    return length(p) - r;
  }

  float sdBox(vec2 p, vec2 b) {
    vec2 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  }

  void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = (vUv * 2.0 - 1.0) * vec2(aspect, 1.0);
    vec2 m = (uMouse * 2.0 - 1.0) * vec2(aspect, 1.0);

    float circle = sdCircle(p - m, 0.28);
    float box = sdBox(p - vec2(0.48, -0.08), vec2(0.32, 0.24)) - 0.06;
    float hole = sdCircle(p - vec2(0.48, -0.08), 0.14);
    /// min 是并，max(a, -b) 是从 a 里挖掉 b。
    float shape = min(circle, max(box, -hole));

    float aa = fwidth(shape);
    float fill = smoothstep(aa, -aa, shape);
    float stroke = (1.0 - fill) * (1.0 - smoothstep(0.012, 0.012 + aa, abs(shape)));

    vec3 color = mix(vec3(0.09, 0.08, 0.06), vec3(0.93, 0.58, 0.30), fill);
    color = mix(color, vec3(0.96, 0.92, 0.84), stroke);
    fragColor = vec4(color, 1.0);
  }
`

const aaFragment = src`
  #version 300 es
  precision highp float;
  in vec2 vUv;
  uniform vec2 uResolution;
  layout(location = 0) out vec4 fragColor;

  void main() {
    float col = floor(vUv.x * 3.0);
    vec2 st = vec2(fract(vUv.x * 3.0), vUv.y);
    vec2 p = st * 2.0 - 1.0;
    float aspect = (uResolution.x / 3.0) / max(uResolution.y, 1.0);
    p.x *= aspect;
    /// 斜线的距离。三列用三种方式把“距离小于 0”变成颜色。
    float d = abs(p.y - p.x * 0.35);

    float edge;
    if (col < 1.0) {
      /// step 的边界落在像素中间时，这条线会有锯齿。
      edge = step(d, 0.004);
    } else if (col < 2.0) {
      /// 固定的 0.03 是 UV 单位，分辨率一变，线的像素宽度就变。
      edge = 1.0 - smoothstep(0.0, 0.03, d);
    } else {
      /// fwidth(d) 约等于相邻像素之间 d 的变化。用它做宽度，线大约始终是 1 像素。
      float w = fwidth(d);
      edge = 1.0 - smoothstep(0.0, w, d);
    }

    vec3 color = mix(vec3(0.09, 0.08, 0.065), vec3(0.95, 0.86, 0.62), edge);
    fragColor = vec4(color, 1.0);
  }
`

const patternFragment = src`
  #version 300 es
  precision highp float;
  in vec2 vUv;
  uniform float uTime;
  uniform vec2 uResolution;
  layout(location = 0) out vec4 fragColor;

  void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 uv = (vUv * 2.0 - 1.0) * vec2(aspect, 1.0);
    vec2 cell = floor(vUv * 2.0);
    vec2 st = fract(vUv * 2.0);
    vec2 p = (st * 2.0 - 1.0) * vec2(aspect * 0.5, 1.0);
    float id = cell.x + cell.y * 2.0;
    vec3 color = vec3(0.10, 0.09, 0.07);

    if (id < 0.5) {
      /// 棋盘：两个方向的格子编号之和的奇偶。
      vec2 g = floor(p * 6.0);
      float checker = mod(g.x + g.y, 2.0);
      color = mix(vec3(0.18, 0.15, 0.12), vec3(0.93, 0.72, 0.40), checker);
    } else if (id < 1.5) {
      float stripes = smoothstep(0.45, 0.55, fract(p.y * 7.0 + sin(p.x * 5.0 + uTime)));
      color = mix(vec3(0.16, 0.22, 0.28), vec3(0.92, 0.55, 0.34), stripes);
    } else if (id < 2.5) {
      /// atan(y, x) 是从 x 轴量起的角度，length 是半径。极坐标里的花瓣就是半径跟着角度变。
      float ang = atan(p.y, p.x);
      float radius = 0.22 + 0.12 * sin(ang * 6.0 + uTime);
      float petal = smoothstep(0.02, 0.0, abs(length(p) - radius));
      color = mix(color, vec3(0.95, 0.62, 0.55), petal);
    } else {
      vec2 bp = p * vec2(5.0, 8.0);
      /// 奇数行错开半块，就是砖。
      if (mod(floor(bp.y), 2.0) > 0.5) bp.x += 0.5;
      vec2 f = fract(bp);
      float mortar = step(f.x, 0.06) + step(f.y, 0.08);
      color = mix(vec3(0.62, 0.34, 0.26), vec3(0.16, 0.12, 0.10), clamp(mortar, 0.0, 1.0));
    }

    fragColor = vec4(color, 1.0);
  }
`

const noiseFragment = src`
  #version 300 es
  precision highp float;
  in vec2 vUv;
  uniform float uTime;
  layout(location = 0) out vec4 fragColor;

  /// 同一个坐标永远得到同一个数。这不是随机数发生器，没有种子状态。
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amplitude * valueNoise(p);
      p = p * 2.02 + 13.1;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    float band = floor(vUv.y * 3.0);
    vec2 p = vUv * vec2(6.0, 2.4) + vec2(uTime * 0.15, 0.0);
    float n = hash(floor(vUv * vec2(48.0, 16.0)));
    if (band > 0.5 && band < 1.5) n = valueNoise(p);
    else if (band >= 1.5) n = fbm(p * 0.85);

    vec3 low = vec3(0.08, 0.10, 0.16);
    vec3 high = vec3(0.95, 0.72, 0.42);
    fragColor = vec4(mix(low, high, clamp(n, 0.0, 1.0)), 1.0);
  }
`

const textureFragment = src`
  #version 300 es
  precision highp float;
  in vec2 vUv;
  /// sampler2D 是纹理单元的句柄，不是像素数组。过滤和包裹在 CPU 上设置。
  uniform sampler2D uRepeat;
  uniform sampler2D uClamp;
  uniform sampler2D uMirror;
  uniform sampler2D uFetch;
  layout(location = 0) out vec4 fragColor;

  void main() {
    vec2 cell = floor(vUv * 2.0);
    vec2 st = fract(vUv * 2.0);
    /// 采样坐标故意超出 0 到 1，包裹模式才会显出来。
    vec2 uv = (st - 0.5) * 2.4 + 0.5;
    int id = int(cell.x + cell.y * 2.0);

    if (id == 0) {
      fragColor = texture(uRepeat, uv);
    } else if (id == 1) {
      fragColor = texture(uClamp, uv);
    } else if (id == 2) {
      fragColor = texture(uMirror, uv);
    } else {
      /// texelFetch 用整数像素坐标，不走过滤，也不走包裹。lod 是 mip 级别。
      ivec2 size = textureSize(uFetch, 0);
      ivec2 texel = ivec2(st * vec2(size));
      texel = clamp(texel, ivec2(0), size - 1);
      fragColor = texelFetch(uFetch, texel, 0);
    }
  }
`

const textureHost = src`
  function upload(unit: number, wrap: number, filter: number) {
    gl.activeTexture(gl.TEXTURE0 + unit)
    const texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  }

  upload(0, gl.REPEAT, gl.LINEAR)
  upload(1, gl.CLAMP_TO_EDGE, gl.NEAREST)
  upload(2, gl.MIRRORED_REPEAT, gl.LINEAR)
  upload(3, gl.CLAMP_TO_EDGE, gl.NEAREST)
  gl.uniform1i(gl.getUniformLocation(program, "uRepeat"), 0)
  gl.uniform1i(gl.getUniformLocation(program, "uClamp"), 1)
  gl.uniform1i(gl.getUniformLocation(program, "uMirror"), 2)
  gl.uniform1i(gl.getUniformLocation(program, "uFetch"), 3)
`

function makeMark(size: number) {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const border = x < 3 || y < 3 || x >= size - 3 || y >= size - 3
      const band = Math.abs(x - y) < 3
      const i = (y * size + x) * 4
      const color = border ? [226, 162, 74, 255] : band ? [125, 186, 164, 255] : [42, 36, 28, 255]
      data[i] = color[0]
      data[i + 1] = color[1]
      data[i + 2] = color[2]
      data[i + 3] = color[3]
    }
  }
  return data
}

function mountTexture(gl: GL, program: WebGLProgram): Handle {
  const gl2 = gl as WebGL2RenderingContext
  const vao = bindVao(gl)
  const size = 64
  const pixels = makeMark(size)
  const textures: WebGLTexture[] = []
  const setups: { wrap: number; filter: number; name: string }[] = [
    { wrap: gl.REPEAT, filter: gl.LINEAR, name: "uRepeat" },
    { wrap: gl.CLAMP_TO_EDGE, filter: gl.NEAREST, name: "uClamp" },
    { wrap: gl.MIRRORED_REPEAT, filter: gl.LINEAR, name: "uMirror" },
    { wrap: gl.CLAMP_TO_EDGE, filter: gl.NEAREST, name: "uFetch" },
  ]
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  setups.forEach((setup, unit) => {
    const texture = gl.createTexture()
    if (!texture) return
    textures.push(texture)
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, setup.wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, setup.wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, setup.filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, setup.filter)
    gl.uniform1i(gl.getUniformLocation(program, setup.name), unit)
  })
  return {
    draw(frame) {
      begin(gl, frame)
      gl.useProgram(program)
      gl2.bindVertexArray(vao)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose() {
      textures.forEach((texture) => gl.deleteTexture(texture))
      gl2.deleteVertexArray(vao)
    },
  }
}

const cubeVertex = src`
  #version 300 es
  layout(location = 0) in vec3 aPosition;
  layout(location = 1) in vec3 aNormal;
  uniform mat4 uMvp;
  uniform mat4 uModel;
  out vec3 vNormal;
  void main() {
    /// 只有旋转时，法线乘模型矩阵的左上 3×3 就可以。有非均匀缩放时要改乘逆转置。
    vNormal = mat3(uModel) * aNormal;
    /// uMvp 是投影 × 视图 × 模型，在 CPU 上乘好再传进来。
    gl_Position = uMvp * vec4(aPosition, 1.0);
  }
`

const cubeFragment = src`
  #version 300 es
  precision mediump float;
  in vec3 vNormal;
  layout(location = 0) out vec4 fragColor;
  void main() {
    /// 法线从 -1..1 挪到 0..1，只是为了能当成颜色看见。这还不是光照。
    vec3 n = normalize(vNormal) * 0.5 + 0.5;
    fragColor = vec4(n, 1.0);
  }
`

const cubeHost = src`
  /// uniformMatrix4fv 的第二个参数 false 表示不转置。内存已经是列主序。
  gl.uniformMatrix4fv(uMvp, false, mvp)
  gl.uniformMatrix4fv(uModel, false, model)
  gl.enable(gl.DEPTH_TEST)
  gl.drawArrays(gl.TRIANGLES, 0, 36)
`

function mountCube(gl: GL, program: WebGLProgram): Handle {
  const vao = bindVao(gl)
  const cube = makeCube()
  const buffers = [
    attribBuffer(gl, program, "aPosition", 3, cube.positions),
    attribBuffer(gl, program, "aNormal", 3, cube.normals),
  ]
  const u = uniforms(gl, program)
  gl.enable(gl.DEPTH_TEST)
  return {
    draw(frame) {
      begin(gl, frame)
      gl.useProgram(program)
      if (vao && "bindVertexArray" in gl) (gl as WebGL2RenderingContext).bindVertexArray(vao)
      const model = multiply(rotateY(frame.time * 0.55), rotateX(0.45))
      const view = lookAt([3.2, 2.35, 3.9], [0, 0, 0], [0, 1, 0])
      const proj = perspective(Math.PI / 4, frame.aspect, 0.1, 30)
      u.mat4("uModel", model)
      u.mat4("uMvp", multiply(proj, multiply(view, model)))
      gl.drawArrays(gl.TRIANGLES, 0, 36)
    },
    dispose() {
      buffers.forEach((buffer) => gl.deleteBuffer(buffer))
      if (vao && "deleteVertexArray" in gl) (gl as WebGL2RenderingContext).deleteVertexArray(vao)
    },
  }
}

const lightVertex = src`
  #version 300 es
  layout(location = 0) in vec3 aPosition;
  layout(location = 1) in vec3 aNormal;
  uniform mat4 uMvp;
  uniform mat4 uModel;
  out vec3 vNormal;
  out vec3 vWorld;
  void main() {
    vec4 world = uModel * vec4(aPosition, 1.0);
    vWorld = world.xyz;
    vNormal = mat3(uModel) * aNormal;
    gl_Position = uMvp * vec4(aPosition, 1.0);
  }
`

const lightFragment = src`
  #version 300 es
  precision highp float;
  in vec3 vNormal;
  in vec3 vWorld;
  uniform vec3 uCamera;
  uniform vec2 uResolution;
  layout(location = 0) out vec4 fragColor;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 L = normalize(vec3(0.55, 0.85, 0.45));
    vec3 V = normalize(uCamera - vWorld);
    /// 半程向量。Blinn-Phong 用它和法线的夹角代替反射向量和视线的夹角。
    vec3 H = normalize(L + V);
    float diff = max(dot(N, L), 0.0);
    float spec = pow(max(dot(N, H), 0.0), 48.0);
    vec3 base = vec3(0.74, 0.36, 0.28);
    vec3 ambient = base * 0.16;
    vec3 phong = ambient + base * diff + spec * vec3(1.0, 0.96, 0.88);

    /// 卡通：把连续的漫反射收成三档，再用 1 - N·V 做一圈边缘光。
    float bands = floor(diff * 3.0) / 3.0;
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 toon = ambient + base * bands + rim * vec3(0.98, 0.84, 0.58);

    float right = step(uResolution.x * 0.5, gl_FragCoord.x);
    vec3 color = mix(phong, toon, right);
    float seam = 1.0 - smoothstep(0.0, 1.5, abs(gl_FragCoord.x - uResolution.x * 0.5));
    color = mix(color, vec3(0.96, 0.93, 0.86), seam);
    fragColor = vec4(color, 1.0);
  }
`

function mountLitMesh(gl: GL, program: WebGLProgram): Handle {
  const vao = bindVao(gl)
  const sphere = makeSphere(36, 48)
  const buffers = [
    attribBuffer(gl, program, "aPosition", 3, sphere.positions),
    attribBuffer(gl, program, "aNormal", 3, sphere.normals),
  ]
  const index = elementBuffer(gl, sphere.indices)
  const u = uniforms(gl, program)
  gl.enable(gl.DEPTH_TEST)
  const camera = [1.8, 1.15, 2.7]
  return {
    draw(frame) {
      begin(gl, frame)
      gl.useProgram(program)
      if (vao && "bindVertexArray" in gl) (gl as WebGL2RenderingContext).bindVertexArray(vao)
      const model = rotateY(frame.time * 0.35)
      const view = lookAt(camera, [0, 0, 0], [0, 1, 0])
      const proj = perspective(Math.PI / 4, frame.aspect, 0.1, 30)
      u.mat4("uModel", model)
      u.mat4("uMvp", multiply(proj, multiply(view, model)))
      u.f3("uCamera", camera[0], camera[1], camera[2])
      u.f2("uResolution", frame.width, frame.height)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index)
      gl.drawElements(gl.TRIANGLES, sphere.indices.length, gl.UNSIGNED_SHORT, 0)
    },
    dispose() {
      buffers.forEach((buffer) => gl.deleteBuffer(buffer))
      gl.deleteBuffer(index)
      if (vao && "deleteVertexArray" in gl) (gl as WebGL2RenderingContext).deleteVertexArray(vao)
    },
  }
}

const waveVertex = src`
  #version 300 es
  layout(location = 0) in vec2 aXZ;
  uniform mat4 uMvp;
  uniform mat4 uModel;
  uniform float uTime;
  out vec3 vNormal;
  out float vHeight;

  void main() {
    float x = aXZ.x;
    float z = aXZ.y;
    float freq = 3.4;
    float amp = 0.16;
    /// 顶点着色器可以改位置。高度是 x、z 和时间的函数。
    float y = amp * sin(x * freq + uTime) * cos(z * freq - uTime * 0.8);
    /// 法线用高度函数的偏导，不靠相邻顶点去叉乘。
    float dyx = amp * freq * cos(x * freq + uTime) * cos(z * freq - uTime * 0.8);
    float dyz = amp * (-freq) * sin(x * freq + uTime) * sin(z * freq - uTime * 0.8);
    vec3 tangentX = vec3(1.0, dyx, 0.0);
    vec3 tangentZ = vec3(0.0, dyz, 1.0);
    vec3 normal = normalize(cross(tangentZ, tangentX));
    vNormal = mat3(uModel) * normal;
    vHeight = y;
    /// uMvp 已经包含模型矩阵，这里用位移之后的局部坐标。
    gl_Position = uMvp * vec4(x, y, z, 1.0);
  }
`

const waveFragment = src`
  #version 300 es
  precision highp float;
  in vec3 vNormal;
  in float vHeight;
  layout(location = 0) out vec4 fragColor;
  void main() {
    vec3 N = normalize(vNormal);
    vec3 L = normalize(vec3(0.3, 1.0, 0.4));
    float diff = max(dot(N, L), 0.0);
    vec3 deep = vec3(0.10, 0.18, 0.28);
    vec3 crest = vec3(0.86, 0.78, 0.58);
    vec3 base = mix(deep, crest, smoothstep(-0.05, 0.14, vHeight));
    fragColor = vec4(base * (0.22 + 0.78 * diff), 1.0);
  }
`

function mountWave(gl: GL, program: WebGLProgram): Handle {
  const vao = bindVao(gl)
  const grid = makeGrid(72)
  const buffer = attribBuffer(gl, program, "aXZ", 2, grid.positions)
  const index = elementBuffer(gl, grid.indices)
  const u = uniforms(gl, program)
  gl.enable(gl.DEPTH_TEST)
  return {
    draw(frame) {
      begin(gl, frame)
      gl.useProgram(program)
      if (vao && "bindVertexArray" in gl) (gl as WebGL2RenderingContext).bindVertexArray(vao)
      const model = rotateX(-0.15)
      const view = lookAt([0.85, 1.55, 2.15], [0, 0, 0], [0, 1, 0])
      const proj = perspective(Math.PI / 4, frame.aspect, 0.1, 30)
      u.mat4("uModel", model)
      u.mat4("uMvp", multiply(proj, multiply(view, model)))
      u.frame(frame)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index)
      gl.drawElements(gl.TRIANGLES, grid.indices.length, gl.UNSIGNED_SHORT, 0)
    },
    dispose() {
      gl.deleteBuffer(buffer)
      gl.deleteBuffer(index)
      if (vao && "deleteVertexArray" in gl) (gl as WebGL2RenderingContext).deleteVertexArray(vao)
    },
  }
}

const discardFragment = src`
  #version 300 es
  precision mediump float;
  in vec2 vUv;
  uniform vec2 uResolution;
  layout(location = 0) out vec4 fragColor;

  void main() {
    float left = step(vUv.x, 0.5);
    vec2 st = vec2(fract(vUv.x * 2.0), vUv.y);
    vec2 p = st * 2.0 - 1.0;
    p.x *= uResolution.x / max(uResolution.y, 1.0) * 0.5;
    float d = length(p);

    if (left > 0.5) {
      /// discard 丢掉这个片元。它不会写颜色，画布上该像素保持清屏时的透明。
      if (d > 0.46) discard;
      fragColor = vec4(0.91, 0.46, 0.30, 1.0);
    } else {
      /// 右边不丢弃，只把 alpha 写成 0 到 1。合成由画布完成，不是又画了一次。
      float alpha = smoothstep(0.62, 0.12, d);
      fragColor = vec4(0.42, 0.72, 0.62, alpha);
    }
  }
`

const discardHost = src`
  /// 画布上下文要带 alpha: true，并且 premultipliedAlpha: false，页面上的棋盘才会从透明处透出来。
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: false,
  })!
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
`

const es300Vertex = src`
  /// ES 3.00。attribute 改叫 in，varying 改叫 out。
  #version 300 es
  layout(location = 0) in vec2 aPosition;
  layout(location = 1) in vec3 aColor;
  out vec3 vColor;
  void main() {
    vColor = aColor;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`

const es300Fragment = src`
  /// 不再有 gl_FragColor。颜色写进自己声明的 out。
  #version 300 es
  precision mediump float;
  in vec3 vColor;
  layout(location = 0) out vec4 fragColor;
  void main() {
    fragColor = vec4(vColor, 1.0);
  }
`

const es100Vertex = src`
  /// ES 1.00，对应 OpenGL ES 2.0 / WebGL 1。版本号仍然必须是第一行。
  #version 100
  attribute vec2 aPosition;
  attribute vec3 aColor;
  /// varying 是顶点到片段的通道。顶点里赋值，片段里同名声明后直接读。
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`

const es100Fragment = src`
  #version 100
  precision mediump float;
  varying vec3 vColor;
  void main() {
    /// 1.00 的片段颜色只能写进这个内置变量。
    gl_FragColor = vec4(vColor, 1.0);
  }
`

const versionHost300 = src`
  /// 3.00 可以用 layout(location)，也可以仍然按名字查询。
  const location = gl.getAttribLocation(program, "aPosition")
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
`

const versionHost100 = src`
  /// 1.00 没有 layout(location)，属性位置一定按名字查。
  const location = gl.getAttribLocation(program, "aPosition")
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
`

const computeSource = src`
  /// 计算着色器从 OpenGL ES 3.1 开始才有。WebGL 2 只到 ES 3.0，这段不能在本页的画布里编译。
  #version 310 es
  /// 一个工作组里有多少次调用。这里是 8×8×1。
  layout(local_size_x = 8, local_size_y = 8, local_size_z = 1) in;
  /// 可写的图像。binding 指向 CPU 绑定的那张纹理。
  layout(rgba8, binding = 0) uniform writeonly highp image2D uOut;
  uniform float uTime;

  void main() {
    /// 全局编号 = 工作组编号 × 工作组尺寸 + 组内编号。
    ivec2 pixel = ivec2(gl_GlobalInvocationID.xy);
    ivec2 size = imageSize(uOut);
    if (pixel.x >= size.x || pixel.y >= size.y) return;

    vec2 uv = (vec2(pixel) + 0.5) / vec2(size);
    vec3 color = 0.5 + 0.5 * cos(uTime + uv.xyx * 6.28318 + vec3(0.0, 2.0, 4.0));
    imageStore(uOut, pixel, vec4(color, 1.0));
  }
`

const computeHost = src`
  /// 这些调用属于 ES 3.1，不是 WebGL 2。
  gl.dispatchCompute(groupX, groupY, 1)
  gl.memoryBarrier(gl.SHADER_IMAGE_ACCESS_BARRIER_BIT)
  /// 屏障之后，别的着色器才能看见 imageStore 写进去的像素。
`

export const pictureLessons: Lesson[] = [
  {
    id: "sdf",
    chapter: "画面怎么写出来",
    title: "有向距离场",
    summary: "不用顶点描边，直接在片段里算点到形状的距离。并是 min，挖空是 max(a, -b)。",
    figure: "拖动画布，圆会跟着指针走。方块被挖了一个洞，再和圆取并。",
    prose: [
      "距离场函数返回一个 float：边界上是 0，内部为负，外部为正。填充就是“距离小于 0”。这样圆、矩形、圆角都是几行函数，布尔运算是 min 和 max，不需要准备轮廓顶点。",
      "sdBox 先把点折到第一象限，再分成角外和边内两种情况。圆角不是另一种形状，而是把矩形的距离再减去圆角半径。",
      "把鼠标移到画面上，uMouse 是 0 到 1 的指针位置，圆的圆心跟着它。这和 uniform 那一则是同一条路：CPU 每帧写入，所有片元读到同一个圆心。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "fullscreen.vert", "顶点着色器", fullscreenVertex),
      glsl("fragment", "sdf.frag", "片段着色器", sdfFragment),
      hostFile(src`
        gl.uniform2f(uResolution, canvas.width, canvas.height)
        gl.uniform2f(uMouse, pointerX, pointerY)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      `),
    ],
    mount: mountFullscreen,
  },
  {
    id: "aa",
    chapter: "画面怎么写出来",
    title: "导数与抗锯齿",
    summary: "dFdx、dFdy、fwidth 看的是相邻片元里同一个表达式差多少。",
    figure: "左：step 的硬边。中：固定宽度，线偏粗。右：fwidth，大约一像素。",
    overlay: [
      { left: "6%", top: "8%", text: "step" },
      { left: "39%", top: "8%", text: "固定宽度" },
      { left: "70%", top: "8%", text: "fwidth" },
    ],
    prose: [
      "片段着色器不能直接读相邻像素，但可以问“我这个值相对左右、上下片元变化多快”。dFdx 是横向偏导，dFdy 是纵向偏导，fwidth(x) 是 abs(dFdx(x)) + abs(dFdy(x))。硬件用 2×2 的片元块来算，所以在分支里对它们要求很严：一个块里的四个片元要走同一条路，导数才可靠。",
      "step 把距离切成 0 和 1，斜线就会阶梯状。smoothstep 的过渡带如果写成常数 0.03，那是坐标单位，画布一放大，带子就占很多像素。用 fwidth 当带子的宽度，过渡大约始终盖住一个像素。",
      "这也是距离场抗锯齿的写法：smoothstep(fwidth(d), -fwidth(d), d)。上一则的圆和方块就是这样收的边。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "fullscreen.vert", "顶点着色器", fullscreenVertex),
      glsl("fragment", "aa.frag", "片段着色器", aaFragment),
      hostFile(src`
        gl.uniform2f(gl.getUniformLocation(program, "uResolution"), canvas.width, canvas.height)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      `),
    ],
    mount: mountFullscreen,
  },
  {
    id: "patterns",
    chapter: "画面怎么写出来",
    title: "用坐标做图案",
    summary: "棋盘、条纹、极坐标花瓣、砖墙。都是 fract、floor、mod、atan 的组合。",
    figure: "四格从左下起：棋盘、弯条纹、花瓣、错缝的砖。",
    overlay: [
      { left: "8%", top: "6%", text: "花瓣" },
      { left: "58%", top: "6%", text: "砖" },
      { left: "8%", top: "56%", text: "棋盘" },
      { left: "58%", top: "56%", text: "条纹" },
    ],
    prose: [
      "fract(x) 是 x 的小数部分，floor(x) 是整数部分。把坐标乘上格子数再 fract，就得到每一格内部重复的 0 到 1。棋盘看的是整数部分之和的奇偶。",
      "条纹是某一根轴上的 fract。给它加上 sin(另一根轴)，条纹就弯了。砖墙多一步：奇数行的 x 加 0.5，再取 fract，灰缝用 step 留出来。",
      "花瓣用极坐标。atan(y, x) 得到角度，length 得到半径，让半径等于一个角度的正弦，再拿实际半径去减它，绝对值很小的地方就是瓣的轮廓。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "fullscreen.vert", "顶点着色器", fullscreenVertex),
      glsl("fragment", "patterns.frag", "片段着色器", patternFragment),
      hostFile(src`
        gl.uniform1f(gl.getUniformLocation(program, "uTime"), timeSeconds)
        gl.uniform2f(gl.getUniformLocation(program, "uResolution"), canvas.width, canvas.height)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      `),
    ],
    mount: mountFullscreen,
  },
  {
    id: "noise",
    chapter: "画面怎么写出来",
    title: "哈希与分形噪声",
    summary: "没有随机函数。哈希把坐标变成稳定的数，再在格子之间插值。",
    figure: "自下而上：哈希格子、价值噪声、五层叠加的 fbm。",
    overlay: [
      { left: "4%", top: "8%", text: "fbm，五层越来越细" },
      { left: "4%", top: "40%", text: "价值噪声，格子之间平滑" },
      { left: "4%", top: "72%", text: "哈希，一格一个数" },
    ],
    prose: [
      "GLSL ES 没有 random()。常见做法是写一个 hash(vec2)，把坐标搅乱后取小数。同一个坐标永远得到同一个值，所以动画要靠往坐标里加时间，而不是换一个随机种子。",
      "价值噪声把平面分成格子，四角各取一个哈希，再用 smoothstep 形状的权重插值。看起来连续，是因为插值，不是因为哈希本身连续。",
      "fbm 把噪声以两倍频率、一半振幅叠五次。循环次数是常数 5，驱动可以展开它。层数如果改成 uniform，有的实现会拒绝编译。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "fullscreen.vert", "顶点着色器", fullscreenVertex),
      glsl("fragment", "noise.frag", "片段着色器", noiseFragment),
      hostFile(src`
        gl.uniform1f(gl.getUniformLocation(program, "uTime"), timeSeconds)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      `),
    ],
    mount: mountFullscreen,
  },
  {
    id: "texture",
    chapter: "画面怎么写出来",
    title: "纹理采样",
    summary: "sampler2D 只是一个单元号。包裹、过滤、mip 都在 CPU 上，不在着色器语法里。",
    figure: "同一张带边框的小图。左下重复，右下夹紧且最近邻，左上镜像重复，右上 texelFetch。",
    overlay: [
      { left: "4%", top: "6%", text: "镜像重复 LINEAR" },
      { left: "54%", top: "6%", text: "texelFetch，按像素取" },
      { left: "4%", top: "56%", text: "重复 LINEAR" },
      { left: "54%", top: "56%", text: "夹紧 NEAREST" },
    ],
    prose: [
      "ES 3.00 的采样函数是 texture(sampler, uv)。ES 1.00 里要写成 texture2D。返回值是 vec4 颜色。uv 的 (0, 0) 在纹理的第一行，这份例子没有开 UNPACK_FLIP_Y_WEBGL，所以缓冲的第 0 行在采样坐标的 v = 0，也就是画面下方。",
      "超出 0 到 1 时怎么取，由 TEXTURE_WRAP_S 和 TEXTURE_WRAP_T 决定：REPEAT、CLAMP_TO_EDGE、MIRRORED_REPEAT。放大缩小用 NEAREST 或 LINEAR。这些是采样器状态，写在 gl.texParameteri 里。着色器改不了它们。",
      "texelFetch(sampler, ivec2, lod) 按整数像素读取，没有过滤，也没有包裹。textureSize 返回某一级 mip 的宽高。需要“第几个纹素”而不是“0 到 1 的坐标”时用它。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "fullscreen.vert", "顶点着色器", fullscreenVertex),
      glsl("fragment", "texture.frag", "片段着色器", textureFragment),
      hostFile(textureHost),
    ],
    mount: mountTexture,
  },
  {
    id: "cube",
    chapter: "画面怎么写出来",
    title: "立方体与 MVP",
    summary: "模型、视图、投影三张矩阵乘在一起，再乘顶点。法线先用模型矩阵的 3×3。",
    figure: "六个面的颜色是法线，不是纹理。旋转写在模型矩阵里。",
    prose: [
      "三维顶点通常在模型空间。模型矩阵把它放到世界里，视图矩阵换成摄像机看的方向，投影矩阵做透视。三者乘成 uMvp 之后，顶点着色器只写一句 gl_Position = uMvp * vec4(position, 1.0)。",
      "矩阵在 CPU 和 GPU 上都是列主序。uniformMatrix4fv 的 transpose 参数传 false。投影乘视图再乘模型，写成 multiply(proj, multiply(view, model))，对应着色器里从右往左乘顶点。",
      "法线不能直接乘带平移的 mat4。只有旋转时，取模型矩阵左上角的 mat3 就够。出现非均匀缩放时，要用这段 3×3 的逆转置，否则光照会歪。这一则只旋转，所以用了短的那种。颜色是法线本身，用来确认六个面的朝向，还没有灯。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "cube.vert", "顶点着色器", cubeVertex),
      glsl("fragment", "cube.frag", "片段着色器", cubeFragment),
      hostFile(cubeHost),
    ],
    mount: mountCube,
  },
  {
    id: "light",
    chapter: "画面怎么写出来",
    title: "Blinn-Phong 与卡通",
    summary: "漫反射是法线和光线的点积。高光用半程向量。左半是连续光照，右半是分档加边缘光。",
    figure: "同一颗球。左边光滑高光，右边三档明暗加一圈菲涅尔边缘。",
    overlay: [
      { left: "8%", top: "8%", text: "Blinn-Phong" },
      { left: "58%", top: "8%", text: "分档与边缘光" },
    ],
    prose: [
      "漫反射看法线 N 和光线 L 的夹角：max(dot(N, L), 0.0)。背面点积为负，截成 0，就不再接受这盏灯。环境项是一个常数，用来托住暗部，它不是真实的间接光。",
      "Blinn-Phong 的高光不直接求反射向量，而是用法线和半程向量 H = normalize(L + V) 的点积，再 pow 一个较大的指数。指数越大，高光越集中。V 是从片元指向摄像机的方向，所以顶点着色器把世界坐标传了出来。",
      "卡通着色用同一份 dot。floor(diff * 3.0) / 3.0 把连续亮度收成三档。边缘光是 pow(1.0 - max(dot(N, V), 0.0), 3.0)，视线擦过表面时变亮。右半边只是把这两步写进了颜色，几何体没有变。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "light.vert", "顶点着色器", lightVertex),
      glsl("fragment", "light.frag", "片段着色器", lightFragment),
      hostFile(src`
        gl.enable(gl.DEPTH_TEST)
        gl.uniformMatrix4fv(uMvp, false, mvp)
        gl.uniformMatrix4fv(uModel, false, model)
        gl.uniform3f(uCamera, eyeX, eyeY, eyeZ)
        gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0)
      `),
    ],
    mount: mountLitMesh,
  },
  {
    id: "wave",
    chapter: "画面怎么写出来",
    title: "在顶点着色器里改形状",
    summary: "网格的 y 由 sin 和 cos 算出来。法线是这个函数的偏导，不是模型里存好的。",
    figure: "一块会动的网格。亮的地方朝向上方的灯，不是贴上去的颜色。",
    prose: [
      "位移写在顶点着色器里：读入平面上的 xz，算出 y，再送进 MVP。片段着色器看不到“原来的邻居顶点”，所以法线要在顶点阶段一起算好传出去。",
      "高度 y = A sin(fx + t) cos(gz - t) 时，对 x、z 求偏导就是切线的 y 分量。两条切线叉乘，得到朝上的法线。用相邻顶点硬叉，在格子粗的时候会折出棱。",
      "这一则的顶点缓冲只有 xz。y 从来没有从 CPU 上传过，它只存在于着色器的局部变量里。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "wave.vert", "顶点着色器", waveVertex),
      glsl("fragment", "wave.frag", "片段着色器", waveFragment),
      hostFile(src`
        /// 缓冲里每个顶点两个 float：x 和 z。
        gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0)
      `),
    ],
    mount: mountWave,
  },
  {
    id: "discard",
    chapter: "画面怎么写出来",
    title: "discard 与透明度",
    summary: "discard 丢掉片元。alpha 则是写进颜色，让画布后面的内容透出来。",
    figure: "棋盘不是着色器画的。左边圆外被丢掉，右边用 alpha 渐隐，棋盘从透明处露出来。",
    overlay: [
      { left: "8%", top: "8%", text: "discard" },
      { left: "58%", top: "8%", text: "alpha" },
    ],
    prose: [
      "discard 让这个片元立即结束，颜色和深度都不写。它适合剪掉点精灵的四角、剪掉花草的透明纹素。它不能排序，也不产生半透明，边缘是硬的。",
      "半透明是把 fragColor.a 写成 0 到 1。像素最后能不能透出网页，还取决于画布上下文：alpha 要打开。premultipliedAlpha 为 false 时，着色器写出的是普通的（颜色，alpha），不用自己把 rgb 乘上 alpha。",
      "图上的棋盘是 CSS 画在画布后面的。清屏颜色的 alpha 是 0，所以没被圆盖住的地方能看见它。这不是 gl.blend 和另一个三角形合成的结果。",
    ],
    api: "webgl2",
    context: { alpha: true, premultipliedAlpha: false, antialias: true },
    files: [
      glsl("vertex", "fullscreen.vert", "顶点着色器", fullscreenVertex),
      glsl("fragment", "discard.frag", "片段着色器", discardFragment),
      hostFile(discardHost),
    ],
    mount(gl, program) {
      const vao = bindVao(gl)
      const u = uniforms(gl, program)
      return {
        draw(frame) {
          gl.viewport(0, 0, frame.width, frame.height)
          gl.clearColor(0, 0, 0, 0)
          gl.clear(gl.COLOR_BUFFER_BIT)
          gl.useProgram(program)
          if (vao && "bindVertexArray" in gl) (gl as WebGL2RenderingContext).bindVertexArray(vao)
          u.frame(frame)
          gl.drawArrays(gl.TRIANGLES, 0, 3)
        },
        dispose() {
          if (vao && "deleteVertexArray" in gl) (gl as WebGL2RenderingContext).deleteVertexArray(vao)
        },
      }
    },
  },
  {
    id: "versions",
    chapter: "两代写法",
    title: "1.00 与 3.00",
    summary: "同一张三角形。ES 2.0 用 attribute、varying、gl_FragColor；ES 3.0 用 in、out 和自己的颜色输出。",
    figure: "切换上面的版本。画面应该一样，变的是关键字。",
    prose: [
      "OpenGL ES 2.0 的着色语言是 GLSL ES 1.00，源码以 #version 100 开头，也是 WebGL 1 使用的语言。ES 3.0 对应 #version 300 es，WebGL 2 使用它。两份语言不能在同一次编译里混用关键字。",
      "名字的对应是：attribute 变成 in；顶点着色器的 varying 变成 out，片段着色器的 varying 变成 in；gl_FragColor 取消，改成 layout(location = 0) out vec4。纹理函数从 texture2D、textureCube 收成 texture。",
      "1.00 没有 uniform 块、没有实例 ID、没有 flat、没有整数纹理，也没有 gl_VertexID。要在老设备上跑，就得把数据放进 attribute，用 varying 把颜色送过光栅化。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "modern.vert", "顶点着色器", es300Vertex),
      glsl("fragment", "modern.frag", "片段着色器", es300Fragment),
      hostFile(versionHost300),
    ],
    mount: mountColoredTriangle,
    variants: [
      {
        id: "300",
        label: "GLSL ES 3.00",
        api: "webgl2",
        files: [
          glsl("vertex", "modern.vert", "顶点着色器", es300Vertex),
          glsl("fragment", "modern.frag", "片段着色器", es300Fragment),
          hostFile(versionHost300),
        ],
        mount: mountColoredTriangle,
      },
      {
        id: "100",
        label: "GLSL ES 1.00",
        api: "webgl1",
        files: [
          glsl("vertex", "legacy.vert", "顶点着色器", es100Vertex),
          glsl("fragment", "legacy.frag", "片段着色器", es100Fragment),
          hostFile(versionHost100),
        ],
        mount: mountColoredTriangle,
      },
    ],
  },
  {
    id: "compute",
    chapter: "两代写法",
    title: "计算着色器只存在于 3.1",
    summary: "没有顶点，也没有片元。一组线程往图像或缓冲里写。WebGL 2 编译不了它。",
    figure: "格子是一个 8×8 的工作组。亮着的那一格是其中一次调用，它只知道自己的编号。",
    diagram: "workgroup",
    prose: [
      "从 OpenGL ES 3.1 起，着色语言是 GLSL ES 3.10，多了一种计算着色器。它的 main 不是为某个顶点或像素跑的，而是为一次调度里的每个调用跑一次。layout(local_size_x = 8, local_size_y = 8) 声明一个工作组有 64 次调用。CPU 再决定派多少个工作组。",
      "调用之间不共享局部变量。要互相看见结果，就写到 image2D 或着色器存储块里，然后用 memoryBarrier 告诉后来的绘制：那些写已经能读了。gl_GlobalInvocationID 是全局编号，等于工作组编号乘工作组尺寸，再加上组内编号。",
      "浏览器里的 WebGL 2 停在 ES 3.0，没有 dispatchCompute，也没有 310 es。所以这一则只有源码，没有画面。几何着色器和细分着色器更晚，在 ES 3.2，移动设备上更少用到。",
    ],
    api: "read",
    files: [
      {
        id: "compute-main",
        label: "计算着色器",
        filename: "fill.comp",
        language: "glsl",
        role: "extra",
        source: computeSource,
      },
      hostFile(computeHost, "dispatch.ts"),
    ],
  },
]
