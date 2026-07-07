export type StorageDurability = 'persistent' | 'best-effort' | 'unknown'

export async function getStorageDurability(): Promise<StorageDurability> {
  try {
    const storage = globalThis.navigator?.storage
    if (typeof storage?.persisted !== 'function' || typeof storage.persist !== 'function') {
      return 'unknown'
    }

    if (await storage.persisted()) {
      return 'persistent'
    }

    return (await storage.persist()) ? 'persistent' : 'best-effort'
  } catch {
    return 'unknown'
  }
}
