export function makeSphere(stacks = 32, slices = 48): {
  positions: Float32Array
  normals: Float32Array
  indices: Uint16Array
} {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []

  for (let y = 0; y <= stacks; y += 1) {
    const phi = (y / stacks) * Math.PI
    for (let x = 0; x <= slices; x += 1) {
      const theta = (x / slices) * Math.PI * 2
      const nx = Math.sin(phi) * Math.cos(theta)
      const ny = Math.cos(phi)
      const nz = Math.sin(phi) * Math.sin(theta)
      positions.push(nx, ny, nz)
      normals.push(nx, ny, nz)
    }
  }

  const stride = slices + 1
  for (let y = 0; y < stacks; y += 1) {
    for (let x = 0; x < slices; x += 1) {
      const i = y * stride + x
      indices.push(i, i + stride, i + 1, i + 1, i + stride, i + stride + 1)
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  }
}

export function makeCube(): { positions: Float32Array; normals: Float32Array } {
  const faces: { n: number[]; v: number[][] }[] = [
    {
      n: [0, 0, 1],
      v: [
        [-1, -1, 1],
        [1, -1, 1],
        [1, 1, 1],
        [-1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1],
      ],
    },
    {
      n: [0, 0, -1],
      v: [
        [1, -1, -1],
        [-1, -1, -1],
        [-1, 1, -1],
        [1, -1, -1],
        [-1, 1, -1],
        [1, 1, -1],
      ],
    },
    {
      n: [0, 1, 0],
      v: [
        [-1, 1, 1],
        [1, 1, 1],
        [1, 1, -1],
        [-1, 1, 1],
        [1, 1, -1],
        [-1, 1, -1],
      ],
    },
    {
      n: [0, -1, 0],
      v: [
        [-1, -1, -1],
        [1, -1, -1],
        [1, -1, 1],
        [-1, -1, -1],
        [1, -1, 1],
        [-1, -1, 1],
      ],
    },
    {
      n: [1, 0, 0],
      v: [
        [1, -1, 1],
        [1, -1, -1],
        [1, 1, -1],
        [1, -1, 1],
        [1, 1, -1],
        [1, 1, 1],
      ],
    },
    {
      n: [-1, 0, 0],
      v: [
        [-1, -1, -1],
        [-1, -1, 1],
        [-1, 1, 1],
        [-1, -1, -1],
        [-1, 1, 1],
        [-1, 1, -1],
      ],
    },
  ]

  const positions: number[] = []
  const normals: number[] = []
  for (const face of faces) {
    for (const vertex of face.v) {
      positions.push(vertex[0], vertex[1], vertex[2])
      normals.push(face.n[0], face.n[1], face.n[2])
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals) }
}

export function makeGrid(segments: number): { positions: Float32Array; indices: Uint16Array } {
  const positions = new Float32Array((segments + 1) * (segments + 1) * 2)
  let write = 0
  for (let z = 0; z <= segments; z += 1) {
    for (let x = 0; x <= segments; x += 1) {
      positions[write++] = (x / segments) * 2 - 1
      positions[write++] = (z / segments) * 2 - 1
    }
  }

  const indices = new Uint16Array(segments * segments * 6)
  const stride = segments + 1
  let t = 0
  for (let z = 0; z < segments; z += 1) {
    for (let x = 0; x < segments; x += 1) {
      const i = z * stride + x
      indices[t++] = i
      indices[t++] = i + stride
      indices[t++] = i + 1
      indices[t++] = i + 1
      indices[t++] = i + stride
      indices[t++] = i + stride + 1
    }
  }
  return { positions, indices }
}

export const RECT_CORNERS = new Float32Array([
  -1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1,
])
