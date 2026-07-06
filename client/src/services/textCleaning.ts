// Markdown-aware text cleaning shared by extraction (LLM + rule-based),
// import summaries, titles, and template fallbacks. Keep this the ONLY place
// that knows how to strip markdown so every surface behaves the same.

const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u200D]/gu

/** Strip a leading YAML frontmatter block (--- ... --- or ---) if present. */
export function stripFrontmatter(raw: string): string {
  if (!/^\uFEFF?---\r?\n/.test(raw)) return raw
  const end = raw.search(/\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/)
  if (end === -1) return raw
  const after = raw.indexOf('\n', end + 1)
  return after === -1 ? '' : raw.slice(after + 1)
}

/**
 * Clean a single line/fragment of markdown down to human prose.
 * Order matters: unwrap links before stripping brackets, strip fences before inline code.
 */
export function cleanText(input: string): string {
  let s = input
  s = s.replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
  s = s.replace(/`([^`]*)`/g, '$1') // inline code -> contents
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images -> drop
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) -> text
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // [[target|alias]] -> alias
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1') // [[WikiLink]] -> WikiLink
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '') // ATX headings
  s = s.replace(/^\s{0,3}>+\s?/gm, '') // blockquotes
  s = s.replace(/^\s{0,3}([-*+]|\d+[.)])\s+/gm, '') // list markers
  s = s.replace(/^\s*\[[ xX/-]\]\s+/gm, '') // task checkboxes [ ] [x] [/]
  s = s.replace(/\|/g, ' ') // table pipes
  s = s.replace(/^[\s:|-]*$/gm, '') // table separator / rule rows
  s = s.replace(/(\*\*|__|\*|_|~~)(.*?)\1/g, '$2') // bold/italic/strike -> contents
  s = s.replace(/<[^>]+>/g, ' ') // stray HTML
  s = s.replace(EMOJI_RE, '') // emoji
  s = s.replace(
    /&(amp|lt|gt|quot|#39|nbsp);/g,
    m => ({
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&nbsp;': ' ',
    } as Record<string, string>)[m] ?? ' ',
  )
  s = s.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim()
  return s
}

/**
 * Produce a clean, single-line title from arbitrary text (filename, heading, or fragment).
 * Never returns markdown syntax; falls back to a quiet default. Sentence case preserved
 * from the source.
 */
export function cleanTitle(input: string, fallback = 'Untitled note'): string {
  const first = cleanText(stripFrontmatter(input)).split('\n').map(l => l.trim()).find(Boolean) ?? ''
  const trimmed = first.replace(/[|`*_~#>]+/g, '').replace(/\s+/g, ' ').trim()
  if (!trimmed) return fallback
  return trimmed.length > 120 ? trimmed.slice(0, 117).trimEnd() + '…' : trimmed
}

/**
 * A fragment worth surfacing as an insight/quote: a declarative clause with a subject and a
 * verb, not a heading, table row, task, bare link, code, or a question.
 */
export function isDeclarativeStatement(raw: string): boolean {
  const s = cleanText(raw).trim()
  if (s.length < 25 || s.length > 500) return false
  if (/[|`]/.test(raw)) return false // was a table/code row
  if (/^\s*[-*_]{3,}\s*$/.test(raw)) return false // horizontal rule
  if (/^#{1,6}\s/.test(raw)) return false // heading
  if (/^\s*[-*+]\s+\[[ xX/-]\]/.test(raw) || /^\s*\[[ xX/-]\]/.test(raw)) return false // task line
  if (/^https?:\/\/\S+$/.test(s)) return false // bare URL
  if (/\?\s*$/.test(s)) return false // question, not a statement
  if (!/[a-z]{3,}/i.test(s)) return false // must contain real words
  const words = s.split(/\s+/)
  if (words.length < 4) return false // needs subject + predicate room
  return true
}

/** Extract the first top-level JSON value from an LLM response, tolerant of fences/prose. */
export function extractJson<T = unknown>(raw: string): T | null {
  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.search(/[\[{]/)
  if (start === -1) return null
  const open = s[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close && --depth === 0) {
      try {
        return JSON.parse(s.slice(start, i + 1)) as T
      } catch {
        return null
      }
    }
  }
  return null
}
