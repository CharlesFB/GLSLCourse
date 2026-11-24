/** Dedent a template literal so shader sources can sit indented in TypeScript. */
export function src(strings: TemplateStringsArray, ...values: unknown[]): string {
  let raw = ""
  strings.forEach((part, index) => {
    raw += part
    if (index < values.length) raw += String(values[index])
  })
  raw = raw.replace(/^\r?\n/, "")
  const lines = raw.split("\n")
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop()
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^[ ]*/)?.[0].length ?? 0)
  const cut = indents.length > 0 ? Math.min(...indents) : 0
  return lines
    .map((line) => (line.startsWith(" ".repeat(cut)) ? line.slice(cut) : line))
    .join("\n")
}
