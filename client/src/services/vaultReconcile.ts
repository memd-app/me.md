import { STATUS_DIRS, generateInsightNote, stableHash, type InsightGenRow } from '@/services/obsidianExport'

export type NoteStatus = 'pending' | 'verified' | 'rejected'

export interface ParsedNote {
  frontmatter: Array<[string, string]>
  body: string
  hasFrontmatter: boolean
}

export type ReconcileDecision =
  | 'noop'
  | 'app-wins'
  | 'vault-wins'
  | 'conflict'
  | 'recreate'
  | 'adopt'
  | 'metadata'

export interface ClassifyInput {
  dbBody: string
  diskContent: string | null
  baseBodyHash: string | null
  dbContentHash: string
  lastContentHash: string | null
}

export interface MergedNote {
  content: string
  body: string
  contentHash: string
  bodyHash: string
}

export interface VaultNoteLocation {
  path: string
  folderStatus: NoteStatus
  content: string
}

export type StatusReconcileDecision =
  | { kind: 'in-place' }
  | { kind: 'apply-verify' }
  | { kind: 'apply-reject' }
  | { kind: 'materialize' }
  | { kind: 'recreate' }
  | { kind: 'dismissed' }
  | { kind: 'attention-backward' }
  | { kind: 'noop' }

export interface StatusClassifyInput {
  dbStatus: NoteStatus
  folderStatus: NoteStatus | null
  everMaterialized: boolean
}

const STATUS_PRIORITY: Record<NoteStatus, number> = {
  verified: 3,
  rejected: 2,
  pending: 1,
}

export function noteStatusForDb(verificationStatus: string | null): NoteStatus | null {
  switch (verificationStatus) {
    case 'unverified':
      return 'pending'
    case 'verified':
    case 're_verification_pending':
      return 'verified'
    case 'rejected':
      return 'rejected'
    default:
      return null
  }
}

export function folderStatusFromPath(path: string): NoteStatus | null {
  for (const [status, dir] of Object.entries(STATUS_DIRS) as Array<[NoteStatus, string]>) {
    if (path.startsWith(`${dir}/`)) return status
  }
  return null
}

export function pickCanonicalLocation(
  locations: VaultNoteLocation[],
  expectedSlugPath: (status: NoteStatus) => string,
): { winner: VaultNoteLocation; losers: VaultNoteLocation[] } {
  if (locations.length === 0) {
    throw new Error('Cannot choose a canonical note from an empty location set.')
  }

  const sorted = [...locations].sort((a, b) => {
    const priorityDiff = STATUS_PRIORITY[b.folderStatus] - STATUS_PRIORITY[a.folderStatus]
    if (priorityDiff !== 0) return priorityDiff

    const aExpected = a.path === expectedSlugPath(a.folderStatus)
    const bExpected = b.path === expectedSlugPath(b.folderStatus)
    if (aExpected !== bExpected) return aExpected ? -1 : 1

    return a.path.localeCompare(b.path)
  })

  return { winner: sorted[0], losers: sorted.slice(1) }
}

export function classifyStatusReconcile(input: StatusClassifyInput): StatusReconcileDecision {
  if (input.dbStatus === 'pending') {
    if (input.folderStatus === 'pending') return { kind: 'in-place' }
    if (input.folderStatus === 'verified') return { kind: 'apply-verify' }
    if (input.folderStatus === 'rejected') return { kind: 'apply-reject' }
    return input.everMaterialized ? { kind: 'dismissed' } : { kind: 'materialize' }
  }

  if (input.dbStatus === 'verified') {
    if (input.folderStatus === 'verified') return { kind: 'in-place' }
    if (input.folderStatus === 'rejected') return { kind: 'apply-reject' }
    if (input.folderStatus === 'pending') return { kind: 'attention-backward' }
    return { kind: 'recreate' }
  }

  if (input.folderStatus === 'rejected') return { kind: 'in-place' }
  if (input.folderStatus === 'pending' || input.folderStatus === 'verified') return { kind: 'attention-backward' }
  return { kind: 'noop' }
}

export function parseNote(content: string): ParsedNote {
  const normalized = content.replace(/\r\n?/g, '\n')
  if (!normalized.startsWith('---\n')) {
    return { frontmatter: [], body: normalized, hasFrontmatter: false }
  }

  const closeIndex = normalized.indexOf('\n---\n', 4)
  if (closeIndex < 0) {
    return { frontmatter: [], body: normalized, hasFrontmatter: false }
  }

  const frontmatterText = normalized.slice(4, closeIndex)
  const frontmatter = frontmatterText
    .split('\n')
    .map((line): [string, string] | null => {
      const separator = line.indexOf(':')
      if (separator <= 0) return null
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
    })
    .filter((entry): entry is [string, string] => entry !== null)

  return {
    frontmatter,
    body: normalized.slice(closeIndex + '\n---\n'.length).replace(/^\n/, ''),
    hasFrontmatter: true,
  }
}

export function extractInsightBody(content: string): string {
  return normalizeBody(extractInsightBodyRaw(content))
}

export function extractInsightBodyRaw(content: string): string {
  const lines = parseNote(content).body.replace(/\r\n?/g, '\n').split('\n')

  while (lines.length > 0 && isIgnorableTrailingLine(lines[lines.length - 1])) {
    lines.pop()
  }

  if (lines.length > 0 && /^Topic:\s*\[\[[^\]]+\]\]\s*$/.test(lines[lines.length - 1].trim())) {
    lines.pop()
  }

  while (lines.length > 0 && isIgnorableTrailingLine(lines[lines.length - 1])) {
    lines.pop()
  }

  return lines.join('\n')
}

export function normalizeBody(body: string): string {
  return body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()
}

export function hashBody(body: string): string {
  return stableHash(normalizeBody(body))
}

export function classifyReconcile(input: ClassifyInput): ReconcileDecision {
  if (input.diskContent === null) return 'recreate'

  const diskBody = extractInsightBody(input.diskContent)
  const diskHash = hashBody(diskBody)
  const dbHash = hashBody(input.dbBody)
  const baseBodyHash = input.baseBodyHash

  if (baseBodyHash === null) {
    return diskHash === dbHash ? 'adopt' : 'vault-wins'
  }

  const diskChanged = diskHash !== baseBodyHash
  const dbChanged = dbHash !== baseBodyHash

  if (!diskChanged && !dbChanged) {
    return input.dbContentHash === input.lastContentHash ? 'noop' : 'metadata'
  }
  if (diskChanged && !dbChanged) return 'vault-wins'
  if (!diskChanged && dbChanged) return 'app-wins'
  return 'conflict'
}

export function assembleNote(row: InsightGenRow, resolvedBody: string, status: NoteStatus = 'verified'): MergedNote {
  const generated = generateInsightNote(row, status).note.content.replace(/\r\n?/g, '\n')
  const frontmatter = getFrontmatterBlock(generated)
  const trailer = getMachineTrailer(generated)
  const body = trimOuterBlankLines(resolvedBody.replace(/\r\n?/g, '\n'))
  const content = [
    frontmatter,
    '',
    body,
    '',
    trailer,
    '',
  ].join('\n')

  return {
    content,
    body,
    contentHash: stableHash(content),
    bodyHash: hashBody(body),
  }
}

function getFrontmatterBlock(content: string): string {
  const closeIndex = content.indexOf('\n---\n', 4)
  if (!content.startsWith('---\n') || closeIndex < 0) {
    throw new Error('Generated insight note is missing frontmatter.')
  }
  return content.slice(0, closeIndex + '\n---'.length)
}

function getMachineTrailer(content: string): string {
  const trailer = parseNote(content).body
    .split('\n')
    .map(line => line.trim())
    .find(line => /^Topic:\s*\[\[[^\]]+\]\]$/.test(line))

  if (!trailer) throw new Error('Generated insight note is missing the topic trailer.')
  return trailer
}

function isIgnorableTrailingLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === '' || trimmed === '[[Me - Index]]'
}

function trimOuterBlankLines(body: string): string {
  const lines = body.split('\n')
  while (lines.length > 0 && lines[0].trim() === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.join('\n')
}
