import { saveDatabase, exportDbBytes } from './database'

let saveTimer: ReturnType<typeof setTimeout> | null = null
const SAVE_DEBOUNCE_MS = 500

export function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await saveDatabase()
    } catch (err) {
      console.error('[me.md] Failed to persist database to IndexedDB:', err)
    }
  }, SAVE_DEBOUNCE_MS)
}

export async function saveNow(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await saveDatabase()
}

export function downloadDatabase(filename = 'memd-backup.db'): void {
  const data = exportDbBytes()
  const blob = new Blob([data], { type: 'application/x-sqlite3' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function readDatabaseFile(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}
