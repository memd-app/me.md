import { afterEach, describe, expect, it, vi } from 'vitest'
import { getStorageDurability } from '../storage'

describe('getStorageDurability', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns persistent when the browser grants durable storage', async () => {
    const persisted = vi.fn().mockResolvedValue(false)
    const persist = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('navigator', { storage: { persisted, persist } })

    await expect(getStorageDurability()).resolves.toBe('persistent')
    expect(persisted).toHaveBeenCalledOnce()
    expect(persist).toHaveBeenCalledOnce()
  })

  it('returns best-effort when the browser denies durable storage', async () => {
    const persisted = vi.fn().mockResolvedValue(false)
    const persist = vi.fn().mockResolvedValue(false)
    vi.stubGlobal('navigator', { storage: { persisted, persist } })

    await expect(getStorageDurability()).resolves.toBe('best-effort')
  })

  it('returns unknown when the storage persistence API is absent', async () => {
    vi.stubGlobal('navigator', {})

    await expect(getStorageDurability()).resolves.toBe('unknown')
  })
})
