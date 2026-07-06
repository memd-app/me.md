import type { ObsidianExportResult } from '@/services/obsidianExport'
import { createFsaVaultFs } from '@/services/vaultFs'

export interface SyncSummary {
  created: number
  updated: number
  skipped: number
  folder: string
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

export async function pickVaultDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) return null

  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' })
  } catch (error) {
    if (isNamedDomError(error, 'AbortError')) return null
    throw error
  }
}

export async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const descriptor: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' }
  const existing = await handle.queryPermission(descriptor)
  if (existing === 'granted') return true
  const requested = await handle.requestPermission(descriptor)
  return requested === 'granted'
}

export async function syncNotesToVault(
  handle: FileSystemDirectoryHandle,
  result: ObsidianExportResult,
): Promise<SyncSummary> {
  if (!(await ensurePermission(handle))) {
    throw new Error('Permission to write to the vault was denied.')
  }

  const summary: SyncSummary = { created: 0, updated: 0, skipped: 0, folder: result.rootFolder }
  const fs = createFsaVaultFs(handle)

  // Sync is intentionally non-destructive: deleted app insights may leave orphan notes in the vault.
  for (const note of result.notes) {
    const existingContent = await fs.read(note.path)
    if (existingContent === note.content) {
      summary.skipped += 1
      continue
    }

    await fs.write(note.path, note.content)

    if (existingContent === null) {
      summary.created += 1
    } else {
      summary.updated += 1
    }
  }

  return summary
}

function isNamedDomError(error: unknown, name: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name: unknown }).name === name
}
