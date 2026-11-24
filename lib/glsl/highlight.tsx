import type { ReactNode } from "react"

type Token = { text: string; kind: string }

const GLSL_KEYWORDS = new Set(
  `in out inout uniform const layout void if else for while do switch case default break continue return discard struct true false lowp mediump highp precision invariant flat smooth centroid`.split(
    " ",
  ),
)

const GLSL_TYPES = new Set(
  `float int bool uint vec2 vec3 vec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 bvec2 bvec3 bvec4 mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 sampler2D samplerCube sampler2DArray isampler2D usampler2D image2D`.split(
    " ",
  ),
)

const GLSL_BUILTINS = new Set(
  `sin cos tan asin acos atan atan2 pow exp log exp2 log2 sqrt inversesqrt abs sign floor ceil round trunc fract mod min max clamp mix step smoothstep length distance dot cross normalize faceforward reflect refract matrixCompMult lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not texture textureLod texelFetch textureSize dFdx dFdy fwidth radians degrees transpose inverse determinant imageStore imageSize`.split(
    " ",
  ),
)

const TS_KEYWORDS = new Set(
  `const let var function return if else for while new class export import from type interface void number string boolean null undefined true false of in`.split(
    " ",
  ),
)

function tokenize(line: string, language: "glsl" | "ts"): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < line.length) {
    const char = line[index]

    if (char === "/" && line[index + 1] === "/") {
      tokens.push({ text: line.slice(index), kind: "comment" })
      break
    }

    if (char === "#" && tokens.every((token) => token.kind === "ws")) {
      tokens.push({ text: line.slice(index), kind: "preproc" })
      break
    }

    if (char === '"' || char === "'" || char === "`") {
      let end = index + 1
      while (end < line.length && line[end] !== char) {
        if (line[end] === "\\") end += 1
        end += 1
      }
      if (end < line.length) end += 1
      tokens.push({ text: line.slice(index, end), kind: "string" })
      index = end
      continue
    }

    if (/\s/.test(char)) {
      let end = index + 1
      while (end < line.length && /\s/.test(line[end])) end += 1
      tokens.push({ text: line.slice(index, end), kind: "ws" })
      index = end
      continue
    }

    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(line[index + 1] ?? ""))) {
      let end = index + 1
      while (end < line.length && /[0-9._]/.test(line[end])) end += 1
      tokens.push({ text: line.slice(index, end), kind: "number" })
      index = end
      continue
    }

    if (/[A-Za-z_]/.test(char)) {
      let end = index + 1
      while (end < line.length && /[A-Za-z0-9_]/.test(line[end])) end += 1
      const word = line.slice(index, end)
      let kind = "ident"
      if (language === "glsl") {
        if (GLSL_KEYWORDS.has(word)) kind = "keyword"
        else if (GLSL_TYPES.has(word)) kind = "type"
        else if (word.startsWith("gl_") || GLSL_BUILTINS.has(word)) kind = "builtin"
      } else if (TS_KEYWORDS.has(word) || word.startsWith("gl")) {
        kind = word.startsWith("gl") && !TS_KEYWORDS.has(word) ? "builtin" : "keyword"
      }
      tokens.push({ text: word, kind })
      index = end
      continue
    }

    tokens.push({ text: char, kind: "punct" })
    index += 1
  }

  return tokens
}

export function HighlightedLine({
  line,
  language,
}: {
  line: string
  language: "glsl" | "ts"
}) {
  const tokens = tokenize(line, language)
  const nodes: ReactNode[] = []
  tokens.forEach((token, index) => {
    nodes.push(
      <span key={index} className={token.kind === "ws" ? undefined : `tok-${token.kind}`}>
        {token.text}
      </span>,
    )
  })
  if (nodes.length === 0) nodes.push(<span key="empty"> </span>)
  return <>{nodes}</>
}
