export type LineNote = {
  line: number
  text: string
}

/**
 * Teaching notes are lines that start with `///`. They are removed before the
 * source is compiled or shown, and attached to the next real line.
 */
export function parseAnnotated(source: string): { code: string; notes: LineNote[] } {
  const codeLines: string[] = []
  const notes: LineNote[] = []
  let pending: string[] = []

  for (const line of source.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.startsWith("///")) {
      pending.push(trimmed.slice(3).trim())
      continue
    }
    if (pending.length > 0) {
      notes.push({ line: codeLines.length + 1, text: pending.join("\n") })
      pending = []
    }
    codeLines.push(line)
  }

  if (pending.length > 0 && codeLines.length > 0) {
    const line = codeLines.length
    const existing = notes.find((note) => note.line === line)
    const text = pending.join("\n")
    if (existing) existing.text = `${existing.text}\n${text}`
    else notes.push({ line, text })
  }

  return { code: codeLines.join("\n"), notes }
}
