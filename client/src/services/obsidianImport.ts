import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import type * as schema from '@/db/schema'
import { importText, processImport } from './import'

type Db = SQLJsDatabase<typeof schema>

// Mirrors ROOT_FOLDER in obsidianExport.ts (not exported there; that file is frozen).
// A unit test asserts it matches generateObsidianNotes(db).rootFolder to prevent drift.
export const SYNC_ROOT_FOLDER = 'me.md'
export const MAX_NOTE_BYTES = 5 * 1024 * 1024
export const IMPORT_TEXT_CAP = 10_000

const PERMISSION_REVOKED_MESSAGE = 'Vault permission was revoked. Reconnect the vault and try again.'

export interface VaultNoteFile {
  path: string
  name: string
  size: number
  read: () => Promise<string>
}

export interface FolderGroup {
  folder: string
  files: VaultNoteFile[]
}

export interface ParsedNote {
  frontmatter: string | null
  body: string
}

export type NoteSkipReason = 'empty' | 'placeholder' | 'own-export' | 'too-large' | 'unreadable'

export interface NoteResult {
  path: string
  title: string
  status: 'imported' | 'skipped' | 'failed'
  skipReason?: NoteSkipReason
  error?: string
  truncated?: boolean
  importId?: string
  insights?: Array<{
    id: string
    content: string
    confidenceScore: number
    verificationStatus: string
    suggestedCategory: string
  }>
  topicCreated?: { id: string; title: string }
}

export interface ObsidianImportProgress {
  current: number
  total: number
  filename: string
}

export interface ObsidianImportOptions {
  onProgress: (p: ObsidianImportProgress) => void
  onNoteDone: (r: NoteResult) => void
  isCancelled: () => boolean
}

/** True if this directory segment must not be descended into. */
export function isSkippedDirectory(segmentName: string, isTopLevel: boolean): boolean {
  return segmentName.startsWith('.') || (isTopLevel && segmentName === SYNC_ROOT_FOLDER)
}

/** Pure filter used by both scanners and by tests: keeps vault-relative paths of importable notes. */
export function filterVaultPaths(relativePaths: string[]): string[] {
  return relativePaths.filter(isImportablePath)
}

export async function scanVaultDirectory(handle: FileSystemDirectoryHandle): Promise<VaultNoteFile[]> {
  const files: VaultNoteFile[] = []

  async function walk(directory: FileSystemDirectoryHandle, ancestors: string[]): Promise<void> {
    try {
      for await (const [entryName, child] of directory.entries()) {
        try {
          if (isDirectoryHandle(child)) {
            if (isSkippedDirectory(entryName, ancestors.length === 0)) continue
            await walk(child, [...ancestors, entryName])
            continue
          }

          const relativePath = [...ancestors, entryName].join('/')
          if (filterVaultPaths([relativePath]).length === 0) continue

          const file = await child.getFile()
          files.push({
            path: relativePath,
            name: basenameWithoutMarkdown(entryName),
            size: file.size,
            read: async () => (await child.getFile()).text(),
          })
        } catch (error) {
          if (isNamedDomError(error, 'NotFoundError')) continue
          throw error
        }
      }
    } catch (error) {
      if (isNamedDomError(error, 'NotFoundError')) return
      throw error
    }
  }

  try {
    await walk(handle, [])
  } catch (error) {
    if (isPermissionError(error)) throw new Error(PERMISSION_REVOKED_MESSAGE)
    throw error
  }

  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export function scanUploadedFiles(files: ArrayLike<File>): VaultNoteFile[] {
  return Array.from(files)
    .map((file) => {
      const browserRelativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
      const segments = browserRelativePath.split('/').filter(Boolean)
      const relativePath = segments.length > 1 ? segments.slice(1).join('/') : file.name

      if (filterVaultPaths([relativePath]).length === 0) return null

      return {
        path: relativePath,
        name: basenameWithoutMarkdown(relativePath),
        size: file.size,
        read: () => file.text(),
      } satisfies VaultNoteFile
    })
    .filter((file): file is VaultNoteFile => file !== null)
    .sort((a, b) => a.path.localeCompare(b.path))
}

export function groupByTopFolder(files: VaultNoteFile[]): FolderGroup[] {
  const grouped = new Map<string, VaultNoteFile[]>()

  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean)
    const folder = segments.length > 1 ? segments[0] : ''
    grouped.set(folder, [...(grouped.get(folder) ?? []), file])
  }

  return Array.from(grouped.entries())
    .sort(([folderA], [folderB]) => {
      if (folderA === '') return -1
      if (folderB === '') return 1
      return folderA.localeCompare(folderB)
    })
    .map(([folder, groupFiles]) => ({
      folder,
      files: [...groupFiles].sort((a, b) => a.path.localeCompare(b.path)),
    }))
}

export function stripFrontmatter(raw: string): ParsedNote {
  const firstLineEnd = raw.indexOf('\n')
  const firstLine = firstLineEnd === -1 ? raw : raw.slice(0, firstLineEnd)
  const afterFirstLine = firstLineEnd === -1 ? raw.length : firstLineEnd + 1

  if (normalizeFenceLine(firstLine) !== '---') {
    return { frontmatter: null, body: raw }
  }

  let cursor = afterFirstLine
  while (cursor < raw.length) {
    const lineEnd = raw.indexOf('\n', cursor)
    const currentLineEnd = lineEnd === -1 ? raw.length : lineEnd
    const nextCursor = lineEnd === -1 ? raw.length : lineEnd + 1
    const line = normalizeFenceLine(raw.slice(cursor, currentLineEnd))

    if (line === '---' || line === '...') {
      return {
        frontmatter: trimOneTrailingLineEnding(raw.slice(afterFirstLine, cursor)),
        body: raw.slice(nextCursor),
      }
    }

    cursor = nextCursor
  }

  return { frontmatter: null, body: raw }
}

export function isOwnExport(frontmatter: string | null): boolean {
  if (!frontmatter) return false
  return frontmatter
    .split(/\r?\n/)
    .some((line) => /^source:\s*(?:"me\.md"|me\.md)\s*$/.test(line.trim()))
}

export function isPlaceholderNote(body: string): boolean {
  const meaningfulText = body
    .split(/\r?\n/)
    .filter((line) => !isMarkdownHeading(line) && !isHorizontalRule(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (meaningfulText.length < 80) return true

  const nonEmptyLines = body.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (nonEmptyLines.length === 0) return true

  const placeholderLines = nonEmptyLines.filter(isTemplatePlaceholderLine).length
  return placeholderLines / nonEmptyLines.length > 0.5
}

export function isLikelyBinary(text: string): boolean {
  if (text.length === 0) return false
  const replacementChars = Array.from(text).filter((char) => char === '\uFFFD').length
  return replacementChars / Array.from(text).length > 0.1
}

export function assignTitles(files: VaultNoteFile[]): Map<string, string> {
  const basenameCounts = new Map<string, number>()
  for (const file of files) {
    basenameCounts.set(file.name, (basenameCounts.get(file.name) ?? 0) + 1)
  }

  return new Map(files.map((file) => [
    file.path,
    (basenameCounts.get(file.name) ?? 0) > 1 ? file.path.replace(/\.md$/i, '') : file.name,
  ]))
}

export async function runObsidianImport(
  db: Db,
  files: VaultNoteFile[],
  opts: ObsidianImportOptions,
): Promise<NoteResult[]> {
  const results: NoteResult[] = []
  const titles = assignTitles(files)
  let consecutivePermissionFailures = 0

  const record = (result: NoteResult) => {
    results.push(result)
    opts.onNoteDone(result)
  }

  for (let index = 0; index < files.length; index += 1) {
    if (opts.isCancelled()) break

    const file = files[index]
    const title = titles.get(file.path) ?? file.name
    opts.onProgress({ current: index + 1, total: files.length, filename: file.path })

    if (file.size > MAX_NOTE_BYTES) {
      consecutivePermissionFailures = 0
      record({ path: file.path, title, status: 'skipped', skipReason: 'too-large' })
      continue
    }

    let raw: string
    try {
      raw = await file.read()
      consecutivePermissionFailures = 0
    } catch (error) {
      const message = getErrorMessage(error, 'Could not read note')
      record({ path: file.path, title, status: 'failed', skipReason: 'unreadable', error: message })

      if (isNamedDomError(error, 'NotAllowedError')) {
        consecutivePermissionFailures += 1
        if (consecutivePermissionFailures >= 3) {
          record({
            path: 'Vault permission',
            title: 'Vault permission revoked',
            status: 'failed',
            skipReason: 'unreadable',
            error: PERMISSION_REVOKED_MESSAGE,
          })
          break
        }
      } else {
        consecutivePermissionFailures = 0
      }
      continue
    }

    if (isLikelyBinary(raw)) {
      record({ path: file.path, title, status: 'skipped', skipReason: 'unreadable' })
      continue
    }

    const { frontmatter, body } = stripFrontmatter(raw)

    if (isOwnExport(frontmatter)) {
      record({ path: file.path, title, status: 'skipped', skipReason: 'own-export' })
      continue
    }

    if (body.trim() === '') {
      record({ path: file.path, title, status: 'skipped', skipReason: 'empty' })
      continue
    }

    if (isPlaceholderNote(body)) {
      record({ path: file.path, title, status: 'skipped', skipReason: 'placeholder' })
      continue
    }

    try {
      const { id } = importText(db, body, title)
      const processed = await processImport(db, id)
      record({
        path: file.path,
        title,
        status: 'imported',
        importId: id,
        insights: processed.insights || [],
        topicCreated: processed.topicCreated ?? undefined,
        truncated: body.length > IMPORT_TEXT_CAP,
      })
    } catch (error) {
      record({
        path: file.path,
        title,
        status: 'failed',
        error: getErrorMessage(error, 'Failed to import note'),
      })
    }
  }

  return results
}

function isImportablePath(path: string): boolean {
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0) return false

  const fileName = segments[segments.length - 1]
  if (!/\.md$/i.test(fileName) || fileName.startsWith('.')) return false

  return segments
    .slice(0, -1)
    .every((segment, index) => !isSkippedDirectory(segment, index === 0))
}

function basenameWithoutMarkdown(pathOrName: string): string {
  const basename = pathOrName.split('/').filter(Boolean).pop() ?? pathOrName
  return basename.replace(/\.md$/i, '')
}

function normalizeFenceLine(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

function trimOneTrailingLineEnding(value: string): string {
  if (value.endsWith('\r\n')) return value.slice(0, -2)
  if (value.endsWith('\n')) return value.slice(0, -1)
  return value
}

function isMarkdownHeading(line: string): boolean {
  return /^\s{0,3}#{1,6}(?:\s|$)/.test(line)
}

function isHorizontalRule(line: string): boolean {
  return /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)
}

function isTemplatePlaceholderLine(line: string): boolean {
  const content = line.trim().replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, '').trim()
  return /^(?:(?:\{\{[^{}]*\}\}|<%[\s\S]*?%>)\s*)+$/.test(content)
}

function isDirectoryHandle(
  handle: FileSystemDirectoryHandle | FileSystemFileHandle,
): handle is FileSystemDirectoryHandle {
  return 'entries' in handle
}

function isPermissionError(error: unknown): boolean {
  return isNamedDomError(error, 'NotAllowedError') || isNamedDomError(error, 'SecurityError')
}

function isNamedDomError(error: unknown, name: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name: unknown }).name === name
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
