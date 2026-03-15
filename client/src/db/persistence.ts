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
  const blob = new Blob([new Uint8Array(data)], { type: 'application/x-sqlite3' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadForMCP(): void {
  downloadDatabase('memd.db')
}

export async function readDatabaseFile(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Import a database file: read bytes and write directly to IndexedDB.
 * The caller should reload the page afterward to reinitialize from the new data.
 */
export async function importDatabaseFile(file: File): Promise<void> {
  const bytes = await readDatabaseFile(file)
  // Write directly to IndexedDB using the same store/key as the database module
  const DB_KEY = 'memd_database'
  const DB_STORE = 'memd_store'

  const idb = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_STORE, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(DB_STORE, 'readwrite')
    const store = tx.objectStore(DB_STORE)
    store.put(bytes, DB_KEY)
    tx.oncomplete = () => { idb.close(); resolve() }
    tx.onerror = () => { idb.close(); reject(tx.error) }
  })
}
