import type { GL } from "@/lib/gl/program"

const FRAME_UNIFORMS = new Set(["uTime", "uResolution", "uAspect", "uMouse", "uMouseDown"])

export type LiveEdits = {
  attributes: Record<string, number[]>
  uniforms: Record<string, number[]>
}

export const EMPTY_EDITS: LiveEdits = { attributes: {}, uniforms: {} }

export type MemoryAttribute = {
  id: string
  name: string
  size: number
  values: number[]
}

export type MemoryUniform = {
  id: string
  name: string
  label: string
  values: number[]
  integer: boolean
}

export type MemoryCatalog = {
  attributes: MemoryAttribute[]
  uniforms: MemoryUniform[]
}

type AttributeSlot = {
  id: string
  name: string
  size: number
  values: number[]
  buffer: WebGLBuffer
  gl: GL
}

type Write = {
  id: string
  name: string
  values: number[]
  integer: boolean
}

type UniformFns = {
  getUniformLocation: typeof WebGLRenderingContext.prototype.getUniformLocation
  uniform1f: typeof WebGLRenderingContext.prototype.uniform1f
  uniform2f: typeof WebGLRenderingContext.prototype.uniform2f
  uniform3f: typeof WebGLRenderingContext.prototype.uniform3f
  uniform4f: typeof WebGLRenderingContext.prototype.uniform4f
  uniform1i: typeof WebGLRenderingContext.prototype.uniform1i
  uniformMatrix4fv: typeof WebGLRenderingContext.prototype.uniformMatrix4fv
}

let active: LiveSession | null = null

export function setActiveSession(session: LiveSession | null) {
  active = session
}

export function registerAttribute(gl: GL, buffer: WebGLBuffer, name: string, size: number, data: Float32Array) {
  active?.addAttribute(gl, buffer, name, size, data)
}

function signature(values: number[]) {
  let text = ""
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) text += ","
    text += Math.round(values[index] * 10000) / 10000
  }
  return text
}

export class LiveSession {
  readonly attributes: AttributeSlot[] = []
  edits: LiveEdits = EMPTY_EDITS

  private readonly attributeCounts = new Map<string, number>()
  private readonly locations = new Map<WebGLUniformLocation, string>()
  private readonly applied = new Map<string, number[]>()
  private readonly prev = new Map<string, string>()
  private readonly animated = new Set<string>()
  private readonly everSeen = new Set<string>()
  private readonly published = new Map<string, MemoryUniform>()
  private readonly nameSeq = new Map<string, number>()
  private writes: Write[] = []
  private initWrites: Write[] = []
  private phase: "init" | "frame" = "init"
  private frameIndex = 0
  private announced = false
  private installed = false
  private original: UniformFns | null = null
  private context: GL | null = null

  addAttribute(gl: GL, buffer: WebGLBuffer, name: string, size: number, data: Float32Array) {
    const count = this.attributeCounts.get(name) ?? 0
    this.attributeCounts.set(name, count + 1)
    this.attributes.push({
      id: `${name}#${count}`,
      name,
      size,
      values: Array.from(data),
      buffer,
      gl,
    })
  }

  attach(gl: GL) {
    if (this.installed) return
    this.installed = true
    this.context = gl
    const original: UniformFns = {
      getUniformLocation: gl.getUniformLocation.bind(gl),
      uniform1f: gl.uniform1f.bind(gl),
      uniform2f: gl.uniform2f.bind(gl),
      uniform3f: gl.uniform3f.bind(gl),
      uniform4f: gl.uniform4f.bind(gl),
      uniform1i: gl.uniform1i.bind(gl),
      uniformMatrix4fv: gl.uniformMatrix4fv.bind(gl),
    }
    this.original = original

    gl.getUniformLocation = ((program: WebGLProgram, name: string) => {
      const location = original.getUniformLocation(program, name)
      if (location) this.locations.set(location, name)
      return location
    }) as typeof gl.getUniformLocation

    gl.uniform1f = ((location: WebGLUniformLocation | null, x: number) => {
      if (!location) return
      const [value] = this.resolve(location, [x], false)
      original.uniform1f(location, value)
    }) as typeof gl.uniform1f

    gl.uniform2f = ((location: WebGLUniformLocation | null, x: number, y: number) => {
      if (!location) return
      const [vx, vy] = this.resolve(location, [x, y], false)
      original.uniform2f(location, vx, vy)
    }) as typeof gl.uniform2f

    gl.uniform3f = ((location: WebGLUniformLocation | null, x: number, y: number, z: number) => {
      if (!location) return
      const [vx, vy, vz] = this.resolve(location, [x, y, z], false)
      original.uniform3f(location, vx, vy, vz)
    }) as typeof gl.uniform3f

    gl.uniform4f = ((location: WebGLUniformLocation | null, x: number, y: number, z: number, w: number) => {
      if (!location) return
      const [vx, vy, vz, vw] = this.resolve(location, [x, y, z, w], false)
      original.uniform4f(location, vx, vy, vz, vw)
    }) as typeof gl.uniform4f

    gl.uniform1i = ((location: WebGLUniformLocation | null, x: number) => {
      if (!location) return
      const [value] = this.resolve(location, [x], true)
      original.uniform1i(location, value)
    }) as typeof gl.uniform1i

    gl.uniformMatrix4fv = ((
      location: WebGLUniformLocation | null,
      transpose: boolean,
      data: ArrayLike<number>,
      srcOffset?: number,
      srcLength?: number,
    ) => {
      if (!location) return
      const start = srcOffset ?? 0
      const count = srcLength ?? data.length - start
      const values: number[] = []
      for (let index = 0; index < count && values.length < 16; index += 1) values.push(Number(data[start + index]))
      const next = this.resolve(location, values, false)
      original.uniformMatrix4fv(location, transpose, new Float32Array(next))
    }) as unknown as typeof gl.uniformMatrix4fv
  }

  detach() {
    const gl = this.context
    const original = this.original
    if (!gl || !original || !this.installed) return
    gl.getUniformLocation = original.getUniformLocation
    gl.uniform1f = original.uniform1f
    gl.uniform2f = original.uniform2f
    gl.uniform3f = original.uniform3f
    gl.uniform4f = original.uniform4f
    gl.uniform1i = original.uniform1i
    gl.uniformMatrix4fv = original.uniformMatrix4fv
    this.installed = false
  }

  beginFrame() {
    this.phase = "frame"
    this.nameSeq.clear()
    this.writes = []
    this.uploadAttributes()
  }

  endFrame(): MemoryCatalog | null {
    const changed = this.observe()
    this.frameIndex += 1
    const initChanged = this.frameIndex >= 2 ? this.publishInit() : false
    this.writes = []
    this.nameSeq.clear()
    const ready = this.frameIndex >= 2 || this.attributes.length > 0
    if (!ready) return null
    if (!this.announced || changed || initChanged) {
      this.announced = true
      return this.snapshot()
    }
    return null
  }

  private resolve(location: WebGLUniformLocation, values: number[], integer: boolean) {
    const name = this.locations.get(location)
    if (!name || FRAME_UNIFORMS.has(name)) return values
    const index = this.nameSeq.get(name) ?? 0
    this.nameSeq.set(name, index + 1)
    const id = `${name}#${index}`
    const record: Write = { id, name, values: values.slice(), integer }
    if (this.phase === "frame") this.writes.push(record)
    else this.initWrites.push(record)
    const override = this.edits.uniforms[id]
    if (override && override.length === values.length && override.every((item) => Number.isFinite(item))) return override
    return values
  }

  private observe() {
    let changed = false
    for (const write of this.writes) {
      this.everSeen.add(write.id)
      if (this.animated.has(write.id)) continue
      const next = signature(write.values)
      const previous = this.prev.get(write.id)
      if (previous == null) {
        this.prev.set(write.id, next)
        continue
      }
      if (previous !== next) {
        this.animated.add(write.id)
        if (this.published.delete(write.id)) changed = true
        continue
      }
      if (!this.published.has(write.id)) {
        this.published.set(write.id, {
          id: write.id,
          name: write.name,
          label: write.name,
          values: write.values.slice(),
          integer: write.integer,
        })
        changed = true
      }
    }
    return changed
  }

  private publishInit() {
    let changed = false
    for (const write of this.initWrites) {
      if (this.everSeen.has(write.id) || this.animated.has(write.id) || this.published.has(write.id)) continue
      this.published.set(write.id, {
        id: write.id,
        name: write.name,
        label: write.name,
        values: write.values.slice(),
        integer: write.integer,
      })
      changed = true
    }
    return changed
  }

  private uploadAttributes() {
    for (const attribute of this.attributes) {
      const edit = this.edits.attributes[attribute.id]
      const desired = edit && edit.length === attribute.values.length ? edit : attribute.values
      if (this.applied.get(attribute.id) === desired) continue
      if (!edit && !this.applied.has(attribute.id)) {
        this.applied.set(attribute.id, attribute.values)
        continue
      }
      this.applied.set(attribute.id, desired)
      attribute.gl.bindBuffer(attribute.gl.ARRAY_BUFFER, attribute.buffer)
      attribute.gl.bufferSubData(attribute.gl.ARRAY_BUFFER, 0, new Float32Array(desired))
    }
  }

  private snapshot(): MemoryCatalog {
    const uniforms = [...this.published.values()]
    const counts = new Map<string, number>()
    for (const uniform of uniforms) counts.set(uniform.name, (counts.get(uniform.name) ?? 0) + 1)
    const seen = new Map<string, number>()
    return {
      attributes: this.attributes.map((attribute) => ({
        id: attribute.id,
        name: attribute.name,
        size: attribute.size,
        values: attribute.values.slice(),
      })),
      uniforms: uniforms.map((uniform) => {
        const index = seen.get(uniform.name) ?? 0
        seen.set(uniform.name, index + 1)
        const total = counts.get(uniform.name) ?? 1
        return {
          ...uniform,
          label: total > 1 ? `${uniform.name} · 第 ${index + 1} 次` : uniform.name,
          values: uniform.values.slice(),
        }
      }),
    }
  }
}
