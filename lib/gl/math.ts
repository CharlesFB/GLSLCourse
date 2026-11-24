export function identity(): Float32Array {
  const m = new Float32Array(16)
  m[0] = 1
  m[5] = 1
  m[10] = 1
  m[15] = 1
  return m
}

/** Column-major product a * b. */
export function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16)
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3]
    }
  }
  return out
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2)
  const m = new Float32Array(16)
  m[0] = f / aspect
  m[5] = f
  m[10] = (far + near) / (near - far)
  m[11] = -1
  m[14] = (2 * far * near) / (near - far)
  return m
}

function sub(a: number[], b: number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function norm(a: number[]): number[] {
  const length = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / length, a[1] / length, a[2] / length]
}

export function lookAt(eye: number[], target: number[], up: number[]): Float32Array {
  const z = norm(sub(eye, target))
  const x = norm(cross(up, z))
  const y = cross(z, x)
  const m = identity()
  m[0] = x[0]
  m[1] = y[0]
  m[2] = z[0]
  m[4] = x[1]
  m[5] = y[1]
  m[6] = z[1]
  m[8] = x[2]
  m[9] = y[2]
  m[10] = z[2]
  m[12] = -dot(x, eye)
  m[13] = -dot(y, eye)
  m[14] = -dot(z, eye)
  return m
}

export function rotateX(angle: number): Float32Array {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const m = identity()
  m[5] = c
  m[6] = s
  m[9] = -s
  m[10] = c
  return m
}

export function rotateY(angle: number): Float32Array {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const m = identity()
  m[0] = c
  m[2] = -s
  m[8] = s
  m[10] = c
  return m
}

export function translate(x: number, y: number, z: number): Float32Array {
  const m = identity()
  m[12] = x
  m[13] = y
  m[14] = z
  return m
}

export function scale(x: number, y: number, z: number): Float32Array {
  const m = identity()
  m[0] = x
  m[5] = y
  m[10] = z
  return m
}

export function transformPoint(m: Float32Array, x: number, y: number, z: number, w = 1): number[] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ]
}
