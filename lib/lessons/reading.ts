import { attribBuffer, begin, bindVao, uniforms, type GL, type Handle } from "@/lib/gl/program"
import { RECT_CORNERS } from "@/lib/gl/mesh"
import { src } from "@/lib/glsl/text"
import type { Lesson } from "@/lib/lessons/types"
import { fullscreenVertex, glsl, hostFile, mountFullscreen } from "@/lib/lessons/runtime"

const minimalVertex = src`
  /// 版本声明必须是文件的第一个字符。前面不能有空行、注释，也不能有 UTF-8 BOM。300 es 表示 OpenGL ES 3.0 的着色语言。
  #version 300 es
  /// 三个顶点直接写在着色器里。const 是编译期常量，运行中改不了。
  const vec2 kPos[3] = vec2[](
    vec2(-0.72, -0.55),
    vec2(0.72, -0.55),
    vec2(0.0, 0.62)
  );
  const vec3 kColor[3] = vec3[](
    vec3(0.93, 0.45, 0.32),
    vec3(0.95, 0.78, 0.40),
    vec3(0.38, 0.66, 0.55)
  );
  /// out 是交给下一阶段的量。顶点着色器的 out，要和片段着色器里同名同类型的 in 接上。
  out vec3 vColor;
  /// 没有返回值。结果写进内置变量和 out 变量。
  void main() {
    /// gl_VertexID 是当前顶点的序号：0、1、2。一次 drawArrays(3) 会把 main 跑三遍。
    vColor = kColor[gl_VertexID];
    /// xy 是裁剪空间坐标，范围大约 -1 到 1，原点在画面中心，y 朝上。z 是深度，w 必须是 1 才会让 xy 保持原样（透视除法会除以 w）。
    gl_Position = vec4(kPos[gl_VertexID], 0.0, 1.0);
  }
`

const minimalFragment = src`
  /// 片段着色器同样以版本号开头。
  #version 300 es
  /// 片段着色器没有默认的 float 精度，这行不写就会编译失败。mediump 够做颜色；坐标范围很大时再改 highp。
  precision mediump float;
  /// 三个顶点的 vColor 到了这里已经按像素位置插过值，所以三角形内部是渐变。
  in vec3 vColor;
  /// 片段着色器的颜色写到你自己声明的输出。location = 0 是第一张颜色缓冲，也就是画布。
  layout(location = 0) out vec4 fragColor;
  void main() {
    /// vec4 是 RGBA，每个分量 0 到 1。alpha 为 1 表示不透明。
    fragColor = vec4(vColor, 1.0);
  }
`

const minimalHost = src`
  /// 着色器源码是普通字符串。VERTEX_SHADER 和 FRAGMENT_SHADER 要分开创建、分开编译。
  const vertex = gl.createShader(gl.VERTEX_SHADER)!
  gl.shaderSource(vertex, vertexSource)
  gl.compileShader(vertex)

  const fragment = gl.createShader(gl.FRAGMENT_SHADER)!
  gl.shaderSource(fragment, fragmentSource)
  gl.compileShader(fragment)

  /// 链接把两段程序合成一个 program。从这里起，GPU 才知道顶点输出该交给哪个片段输入。
  const program = gl.createProgram()!
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.useProgram(program)

  /// 三角形以外的颜色来自这里，不来自着色器。
  gl.clearColor(0.078, 0.071, 0.055, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)

  /// 没有缓冲。三个顶点全靠 gl_VertexID。
  gl.drawArrays(gl.TRIANGLES, 0, 3)
`

const invocationsFragment = src`
  #version 300 es
  precision highp float;
  in vec2 vUv;
  uniform vec2 uResolution;
  uniform float uTime;
  layout(location = 0) out vec4 fragColor;

  void main() {
    /// gl_FragCoord 是这个片元在画布上的像素坐标，左下角大约是 (0.5, 0.5)。每个片元的值都不同。
    vec2 pixel = gl_FragCoord.xy;
    vec2 uv = pixel / max(uResolution, vec2(1.0));

    /// uTime 是 uniform：这一帧里，所有片元拿到的是同一个数。
    float band = 0.5 + 0.5 * sin(uv.y * 36.0 + uTime * 2.0);
    vec3 color = vec3(uv.x, 0.32 + 0.2 * uv.y, 0.85 - uv.x * 0.6);
    color *= 0.45 + 0.55 * band;

    /// 局部变量每次进入 main 都重新开始。没有“上一个像素留下的计数器”。
    float local = 0.0;
    local += uv.x;
    fragColor = vec4(color * (0.85 + 0.15 * local), 1.0);
  }
`

const invocationsHost = src`
  /// uniform 的位置在链接之后才能查。名字必须和着色器里的 uniform 一致。
  const uTime = gl.getUniformLocation(program, "uTime")
  const uResolution = gl.getUniformLocation(program, "uResolution")

  function frame(timeSeconds: number) {
    gl.useProgram(program)
    gl.uniform1f(uTime, timeSeconds)
    gl.uniform2f(uResolution, canvas.width, canvas.height)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
`

const typesFragment = src`
  #version 300 es
  /// highp 是这张图的默认精度。下面再单独声明低精度变量，用来展示限定符的写法。
  precision highp float;
  in vec2 vUv;
  layout(location = 0) out vec4 fragColor;

  vec3 quantize(vec3 color, float steps) {
    return floor(color * steps + 0.5) / steps;
  }

  void main() {
    /// 全局变量的初值必须是常量。vUv 要到 main 里才能读，所以这些声明写在函数内。
    /// 构造函数不会隐式扩类型。float、int、bool 之间必须写明转换。
    /// 下面这一行如果去掉注释，编译会失败：int 不能自动变成 float。
    /// float broken = 1;
    float shown = float(1);
    int count = int(shown);

    /// 一个标量会复制到每个分量。vec4(rgb, a) 是用一个 vec3 再补一个分量。
    vec3 gray = vec3(0.72);
    vec3 ink = vec3(0.93, 0.45, 0.32);
    vec4 swatch = vec4(ink, 1.0);

    /// 真实的精度限定符。桌面 GPU 常常把 lowp、mediump 都按 highp 实现，所以单靠它们往往看不出差别。
    lowp float lowSample = vUv.x;
    mediump float midSample = vUv.x;
    highp float highSample = vUv.x;

    float x = vUv.x;
    vec3 ramp = vec3(x, 0.25 + 0.35 * vUv.y, 1.0 - x);
    /// 用 swatch 的一个分量，避免构造出来的变量被编译器删掉。
    ramp.r *= 0.85 + 0.15 * swatch.a * gray.r * float(count);
    ramp.g += (lowSample - midSample) + (highSample - highSample);

    float band = floor(vUv.y * 3.0);
    vec3 color = ramp;
    if (band < 1.0) color = quantize(ramp, 8.0);
    else if (band < 2.0) color = quantize(ramp, 32.0);
    fragColor = vec4(color, 1.0);
  }
`

const typesHost = src`
  /// 精度限定符只出现在着色器源码里，CPU 侧没有对应的调用。
  gl.drawArrays(gl.TRIANGLES, 0, 3)
`

const swizzleFragment = src`
  #version 300 es
  precision mediump float;
  in vec2 vUv;
  layout(location = 0) out vec4 fragColor;

  void main() {
    /// vUv 是 vec2。分量可以用 .x .y，也可以用 .r .g，两套名字不能混在同一次重组里。
    vec2 uv = vUv;
    float band = floor(uv.y * 5.0);
    vec3 color;

    if (band < 1.0) {
      /// vec3(标量) 把一个 float 复制三份。和下面的 .xxx 是同一类结果。
      color = vec3(uv.x);
    } else if (band < 2.0) {
      /// .yyy 从 vec2 上取出 y，再复制成 vec3。vec2 没有 .z，写成 uv.z 会编译失败。
      color = uv.yyy;
    } else if (band < 3.0) {
      /// .yx 把两个分量对调，得到一个新的 vec2，再补上 0.35 变成 vec3。
      color = vec3(uv.yx, 0.35);
    } else if (band < 4.0) {
      color = vec3(uv.xy, 0.85);
    } else {
      /// 重组之后仍然是值，可以接着做运算。fract 取小数部分，所以画面上沿是重复的斜纹。
      vec2 shifted = fract(uv.xy * 4.0 + vec2(0.0, uv.x));
      color = vec3(shifted, 0.45);
    }

    fragColor = vec4(color, 1.0);
  }
`

const builtinsFragment = src`
  #version 300 es
  precision highp float;
  in vec2 vUv;
  layout(location = 0) out vec4 fragColor;

  /// 这些函数按分量作用在向量上，也接受标量。它们没有状态，同样的输入永远得到同样的输出。
  float curve(int id, float x) {
    if (id == 0) return sin(x * 6.2831853) * 0.38 + 0.5;
    if (id == 1) return 0.18 + 0.64 * step(0.55, x);
    if (id == 2) return smoothstep(0.15, 0.85, x);
    if (id == 3) return mix(0.18, 0.86, x);
    if (id == 4) return clamp(x * 1.6 - 0.3, 0.12, 0.88);
    if (id == 5) return fract(x * 3.0);
    if (id == 6) return abs(x * 2.0 - 1.0);
    if (id == 7) return mod(x * 2.0, 0.5) * 2.0;
    if (id == 8) return floor(x * 4.0) / 4.0;
    if (id == 9) return ceil(x * 4.0) / 4.0;
    if (id == 10) return min(x, 0.65);
    return max(x, 0.28);
  }

  void main() {
    vec2 g = vUv * vec2(4.0, 3.0);
    ivec2 cell = ivec2(floor(g));
    vec2 st = fract(g);
    int id = cell.x + cell.y * 4;
    float y = curve(id, st.x);
    /// fwidth 是相邻像素上这个值的变化量，用来让曲线在任何分辨率下都大约一样细。
    float w = fwidth(st.y) * 1.6;
    float line = smoothstep(y - w, y, st.y) - smoothstep(y, y + w, st.y);
    vec3 color = mix(vec3(0.09, 0.08, 0.065), vec3(0.93, 0.72, 0.38), clamp(line, 0.0, 1.0));
    float axis = smoothstep(0.01, 0.0, abs(st.y - 0.5));
    color = mix(color, vec3(0.45, 0.40, 0.32), axis * 0.45);
    float edge = min(min(st.x, 1.0 - st.x), min(st.y, 1.0 - st.y));
    if (edge < 0.02) color = vec3(0.20, 0.18, 0.15);
    fragColor = vec4(color, 1.0);
  }
`

const organizeFragment = src`
  #version 300 es
  precision highp float;
  in vec2 vUv;
  uniform float uTime;
  uniform vec2 uResolution;
  layout(location = 0) out vec4 fragColor;

  /// #define 在编译前做文本替换。它不是变量，没有类型。
  #define PI 3.14159265
  /// const 有类型，编译期就定死，着色器运行时不能改。
  const float HORIZON = -0.28;

  /// 结构体把相关的数据收成一个名字。字段顺序就是构造函数的参数顺序。
  struct Light {
    vec2 pos;
    vec3 color;
    float radius;
  };

  vec3 skyColor(float y) {
    vec3 top = vec3(0.13, 0.16, 0.30);
    vec3 horizon = vec3(0.95, 0.52, 0.30);
    return mix(horizon, top, smoothstep(-0.05, 0.9, y));
  }

  /// 函数按值传递。没有指针，也没有引用。
  vec3 disc(vec2 p, Light lamp) {
    float d = length(p - lamp.pos);
    float core = smoothstep(lamp.radius, lamp.radius * 0.15, d);
    float halo = smoothstep(lamp.radius * 4.0, lamp.radius, d);
    return lamp.color * (core + halo * 0.4);
  }

  void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = (vUv * 2.0 - 1.0) * vec2(aspect, 1.0);

    /// 数组的大小写在类型旁边。这里用下标赋值，演示数组，而不是必须这么写。
    float ridge[2];
    ridge[0] = 0.08;
    ridge[1] = 0.03;
    float curve = HORIZON
      + ridge[0] * sin(p.x * 2.2 + 0.4)
      + ridge[1] * sin(p.x * PI * 2.0 + uTime * 0.15);

    Light sun = Light(vec2(0.35, 0.18), vec3(0.99, 0.72, 0.38), 0.16);
    Light moon = Light(vec2(-0.62, 0.48), vec3(0.62, 0.74, 0.95), 0.07);

    vec3 color = skyColor(p.y) + disc(p, sun) + disc(p, moon);

    if (p.y < curve) {
      /// switch 的条件必须是整数。ES 3.00 才有 switch，1.00 里没有。
      int layer = p.y < curve - 0.22 ? 1 : 0;
      switch (layer) {
        case 0:
          color = vec3(0.33, 0.20, 0.16);
          break;
        case 1:
          color = vec3(0.10, 0.09, 0.08);
          break;
        default:
          color = vec3(0.0);
          break;
      }
    }

    fragColor = vec4(color, 1.0);
  }
`

const matrixVertex = src`
  #version 300 es
  /// layout(location = 0) 把这个输入钉在 0 号属性上，CPU 用同一个编号往里送数据。
  layout(location = 0) in vec2 aPosition;
  uniform float uTime;
  out vec2 vLocal;

  void main() {
    float c = cos(uTime);
    float s = sin(uTime);
    /// mat3(...) 按列填充，不是按你眼睛看到的行。第一列是 (c, s, 0)，第二列是 (-s, c, 0)。
    /// 作用在列向量上时，这才是“逆时针转 uTime 弧度”。写成 mat3(c, -s, 0, s, c, 0, ...) 就会转反。
    mat3 spin = mat3(
      vec3(c, s, 0.0),
      vec3(-s, c, 0.0),
      vec3(0.0, 0.0, 1.0)
    );
    /// 平移写在最后一列。二维点要补一个 1，平移才会加上去；补 0 的是方向，平移对它无效。
    mat3 move = mat3(
      vec3(1.0, 0.0, 0.0),
      vec3(0.0, 1.0, 0.0),
      vec3(0.28 * sin(uTime * 0.7), 0.0, 1.0)
    );
    vec2 sized = aPosition * vec2(0.34, 0.22);
    /// 矩阵从右往左作用：先 spin，再 move。
    vec3 p = move * spin * vec3(sized, 1.0);
    vLocal = aPosition * 0.5 + 0.5;
    gl_Position = vec4(p.xy, 0.0, 1.0);
  }
`

const matrixFragment = src`
  #version 300 es
  precision mediump float;
  in vec2 vLocal;
  layout(location = 0) out vec4 fragColor;
  void main() {
    vec3 color = mix(vec3(0.93, 0.55, 0.28), vec3(0.96, 0.86, 0.55), vLocal.x);
    fragColor = vec4(color, 1.0);
  }
`

const matrixHost = src`
  /// 矩形的六个顶点在 CPU 上。着色器里的 aPosition 每次 main 拿到其中一个。
  const corners = new Float32Array([
    -1, -1, 1, -1, 1, 1,
    -1, -1, 1, 1, -1, 1,
  ])
  const buffer = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW)
  const location = gl.getAttribLocation(program, "aPosition")
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)

  const uTime = gl.getUniformLocation(program, "uTime")
  function frame(timeSeconds: number) {
    gl.uniform1f(uTime, timeSeconds)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }
`

function mountMatrix(gl: GL, program: WebGLProgram): Handle {
  const vao = bindVao(gl)
  const buffer = attribBuffer(gl, program, "aPosition", 2, RECT_CORNERS)
  const u = uniforms(gl, program)
  return {
    draw(frame) {
      begin(gl, frame)
      gl.useProgram(program)
      if (vao && "bindVertexArray" in gl) (gl as WebGL2RenderingContext).bindVertexArray(vao)
      u.frame(frame)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    },
    dispose() {
      gl.deleteBuffer(buffer)
      if (vao && "deleteVertexArray" in gl) (gl as WebGL2RenderingContext).deleteVertexArray(vao)
    },
  }
}

const hostDraw = src`
  gl.useProgram(program)
  gl.uniform1f(gl.getUniformLocation(program, "uTime"), timeSeconds)
  gl.uniform2f(gl.getUniformLocation(program, "uResolution"), canvas.width, canvas.height)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
`

export const readingLessons: Lesson[] = [
  {
    id: "minimal",
    chapter: "源码长什么样",
    title: "一份最小的着色器",
    summary: "两段类 C 的文本。顶点着色器写位置，片段着色器写颜色，main 不返回值。",
    figure: "三个顶点的颜色在三角形内部被插值。三角形以外的深色来自清屏，不是着色器画的。",
    prose: [
      "着色器代码是交给 GPU 的文本，不是 C，也不是 JavaScript。OpenGL ES 使用的这一门叫 GLSL ES。它长得像 C：有类型、有函数、有分号、有大括号。差别在于入口是 void main()，结果不 return，而是写进指定的变量。",
      "能画出东西的程序至少有两份源码。顶点着色器对每个顶点跑一遍，负责它落在屏幕的哪里。片段着色器对每个片元（可以先理解成像素）跑一遍，负责它是什么颜色。两份分开编译，再链接成一个 program。链接的时候，顶点着色器的 out 和片段着色器里同名的 in 会接上。",
      "这一对源码把三角形的三个角直接写在着色器里。坐标在裁剪空间：x、y 大约从 -1 到 1，原点在画面中心，y 朝上。w 写成 1，后面的透视除法不会把 xy 再缩放。片段着色器拿到的 vColor 已经不是某一个顶点的颜色，而是按位置插值之后的结果，所以内部是渐变。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "triangle.vert", "顶点着色器", minimalVertex),
      glsl("fragment", "triangle.frag", "片段着色器", minimalFragment),
      hostFile(minimalHost),
    ],
    mount: mountFullscreen,
    closing: [
      "工程里的顶点很少写死在着色器里，下一组例子会改成从缓冲读取。先记住这份文件的骨架：版本号、精度、输入输出、main，以及写进 gl_Position 和 fragColor 的那两行。",
    ],
  },
  {
    id: "invocations",
    chapter: "源码长什么样",
    title: "main 会跑很多次",
    summary: "同一份 main，顶点阶段跑若干次，片段阶段对每个像素再跑一次。它们互相看不见局部变量。",
    figure: "颜色来自每个像素自己的坐标。横条一起移动，是因为所有像素共用同一个 uTime。",
    prose: [
      "着色器不是“每帧调用一次”的普通函数。drawArrays 画三个顶点，顶点着色器的 main 就运行三次，每次的 gl_VertexID 不同。光栅化之后，落在三角形里的每个像素再运行一次片段着色器的 main。一张 800×500 的画布，片段 main 一帧就要跑四十万次，而且是并行的。",
      "所以源码里没有“当前像素的邻居”这种可以直接读的变量，也没有能在像素之间累加的静态计数器。一次 main 里的局部变量，下一次进入 main 时重新开始。像素之间能共享的，是这一次绘制开始前 CPU 传进来的 uniform，以及纹理、缓冲这类显式资源。",
      "下面这张图用这个规则来画：每个像素用自己的 gl_FragCoord 决定底色，所以从左到右会变；uTime 对所有像素相同，所以条纹是一起动的，而不是每个像素各走各的时钟。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "fullscreen.vert", "顶点着色器", fullscreenVertex),
      glsl("fragment", "invocations.frag", "片段着色器", invocationsFragment),
      hostFile(invocationsHost),
    ],
    mount: mountFullscreen,
  },
  {
    id: "types",
    chapter: "语法",
    title: "类型、精度与字面量",
    summary: "float 和 int 不会自动互转。向量用构造函数拼起来。精度限定符是移动 GPU 上才真正生效的开关。",
    figure: "自下而上：大约 8 级、32 级、不量化。这是在模拟低精度，不是 lowp 关键字本身的运行结果。",
    overlay: [
      { left: "4%", top: "8%", text: "不量化，当作 highp" },
      { left: "4%", top: "40%", text: "约 32 级，接近 mediump 能保住的层次" },
      { left: "4%", top: "72%", text: "约 8 级，lowp 常见的色带" },
    ],
    prose: [
      "标量类型是 float、int、uint、bool。最常用的复合类型是 vec2、vec3、vec4 和 mat2、mat3、mat4。分量是 float 的向量和矩阵，是这门语言的日常。",
      "字面量的类型很严。1 是 int，1.0 是 float，两者不能直接运算，也不能靠赋值偷偷转换。float x = 1 会编译失败，要写成 float(1)。vec3(0.72) 把一个标量复制到三个分量；vec4(rgb, 1.0) 用一个 vec3 再补一个 alpha。没有 C++ 那种列表初始化。",
      "精度限定符 lowp、mediump、highp 写在变量或默认精度上。片段着色器必须有一句 precision ... float，否则连 vec3 的声明都不合法。桌面显卡实现 WebGL 时，经常把三种精度都做成 highp，所以关键字本身可能看不出差别。图上的色带是用 floor 量化出来的，用来表示低精度在手机上长什么样。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "fullscreen.vert", "顶点着色器", fullscreenVertex),
      glsl("fragment", "types.frag", "片段着色器", typesFragment),
      hostFile(typesHost),
    ],
    mount: mountFullscreen,
  },
  {
    id: "swizzle",
    chapter: "语法",
    title: "分量重组",
    summary: "用 .xyzw 或 .rgba 把向量拆开、对调、复制。这是着色器里最密的一种写法。",
    figure: "五条带自下而上，对应代码里的五种重组。",
    overlay: [
      { left: "4%", top: "6%", text: "fract(uv.xy * 4.0) 重组之后继续运算" },
      { left: "4%", top: "26%", text: "vec3(uv.xy, 0.85) 两个分量再补一个" },
      { left: "4%", top: "46%", text: "uv.yx 对调" },
      { left: "4%", top: "66%", text: "uv.yyy 只取 y，复制三次" },
      { left: "4%", top: "86%", text: "vec3(uv.x) 一个标量复制三份" },
    ],
    prose: [
      "向量的分量有三套名字：xyzw 表示坐标，rgba 表示颜色，stpq 表示纹理坐标。它们指向同一块数据，uv.x 和 uv.r 是同一个 float。一次重组里不能混用两套名字，uv.xg 是非法的。",
      "重组可以变长。vec2 写成 .yyy 得到 vec3；写成 .yx 得到对调后的 vec2。也可以当作左值，但左值里不能重复同一个分量，color.xx = vec2(1.0) 不合法，因为 x 被写了两次。",
      "vec2 只有 x 和 y。向它要 .z 会编译失败。需要第三个分量时，用构造函数补：vec3(uv, 0.0) 或 vec3(uv.xy, 0.35)。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "fullscreen.vert", "顶点着色器", fullscreenVertex),
      glsl("fragment", "swizzle.frag", "片段着色器", swizzleFragment),
      hostFile(hostDraw),
    ],
    mount: mountFullscreen,
  },
  {
    id: "builtins",
    chapter: "语法",
    title: "内置函数",
    summary: "sin、mix、smoothstep、clamp、fract 这些函数是着色器的日常词汇，没有状态。",
    figure: "十二格从左到右、从下到上：sin、step、smoothstep、mix、clamp、fract、abs、mod、floor、ceil、min、max。",
    overlay: [
      { left: "3%", top: "4%", text: "floor" },
      { left: "28%", top: "4%", text: "ceil" },
      { left: "53%", top: "4%", text: "min" },
      { left: "78%", top: "4%", text: "max" },
      { left: "3%", top: "37%", text: "clamp" },
      { left: "28%", top: "37%", text: "fract" },
      { left: "53%", top: "37%", text: "abs" },
      { left: "78%", top: "37%", text: "mod" },
      { left: "3%", top: "70%", text: "sin" },
      { left: "28%", top: "70%", text: "step" },
      { left: "53%", top: "70%", text: "smoothstep" },
      { left: "78%", top: "70%", text: "mix" },
    ],
    prose: [
      "标准库不大，但很密。三角函数、指数、取整、比较，以及专门为图形准备的 mix、step、smoothstep、dot、cross、normalize、reflect。它们对向量通常按分量计算：sin(vec2(a, b)) 等于 vec2(sin(a), sin(b))。",
      "mix(a, b, t) 是线性插值。step(edge, x) 在 x 小于 edge 时为 0，否则为 1，边缘是硬的。smoothstep(edge0, edge1, x) 在两个边界之间平滑地从 0 走到 1。画圆、画线、做过渡，大多是这几个函数。",
      "图里每一格是同一个绘图方式：横轴是格内的 x，纵轴是函数值。length、dot、normalize 放在后面的距离场和光照里，因为它们需要向量，不适合画成一条曲线。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "fullscreen.vert", "顶点着色器", fullscreenVertex),
      glsl("fragment", "builtins.frag", "片段着色器", builtinsFragment),
      hostFile(hostDraw),
    ],
    mount: mountFullscreen,
  },
  {
    id: "organize",
    chapter: "语法",
    title: "函数、结构体、数组与宏",
    summary: "用函数和 struct 把一段日落分成天空、光源和山。switch 只接受整数。",
    figure: "太阳和月亮是同一个 disc 函数配不同的 Light。山的两层颜色走 switch。",
    prose: [
      "函数和 C 一样，要先声明再调用，返回值写在名字前面。参数按值传递，没有指针和引用。想“返回多个值”，通常改成 out 参数，或者返回一个结构体。",
      "struct 按字段顺序构造：Light(pos, color, radius)。数组把长度写在变量名旁边，float ridge[2]，再用下标赋值。ES 3.00 的循环可以是普通的 for，但次数最好是编译期看得见的常数，老驱动对“直到 uniform 为止”的循环并不友好。",
      "#define 是编译前的文本替换，没有类型。const 有类型，也是编译期常量。uniform 看起来也是常量，但它由 CPU 在绘制前写入，所以时间、分辨率这种每帧会变的数用 uniform，圆周率用 const 或宏。switch 从 ES 3.00 开始才有，条件必须是整数。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "fullscreen.vert", "顶点着色器", fullscreenVertex),
      glsl("fragment", "organize.frag", "片段着色器", organizeFragment),
      hostFile(hostDraw),
    ],
    mount: mountFullscreen,
  },
  {
    id: "matrix",
    chapter: "语法",
    title: "矩阵按列书写",
    summary: "mat3 的构造函数吃的是列，不是你排版时看到的行。点要补 1，方向补 0。",
    figure: "矩形先旋转，再平移。颜色取自旋转前的局部坐标，所以花纹跟着矩形走。",
    prose: [
      "GLSL 的矩阵是列主序，和 OpenGL 传 uniform 时的内存顺序一致。mat3(a, b, c, d, e, f, g, h, i) 的第一列是 (a, b, c)，不是第一行。把旋转矩阵按数学课本的行抄进去，方向会反。",
      "二维点写成 vec3(x, y, 1.0) 才能吃到平移；方向写成 vec3(x, y, 0.0)，平移对它不起作用。矩阵乘法从右往左作用在列向量上：move * spin * p 是先旋转，后平移。",
      "这一则的顶点来自缓冲，着色器负责变换。下一章专门讲缓冲和 uniform 的声明长什么样。",
    ],
    api: "webgl2",
    files: [
      glsl("vertex", "matrix.vert", "顶点着色器", matrixVertex),
      glsl("fragment", "matrix.frag", "片段着色器", matrixFragment),
      hostFile(matrixHost),
    ],
    mount: mountMatrix,
  },
]
