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

function isNamedDomError(error: unknown, name: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name: unknown }).name === name
}
