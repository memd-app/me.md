import { describe, expect, it } from 'vitest'
import { shouldShowBackupNudge } from '../backupNudge'

describe('shouldShowBackupNudge', () => {
  it.each([
    { verifiedCount: 50, hasVault: false, dismissed: false, expected: true },
    { verifiedCount: 49, hasVault: false, dismissed: false, expected: false },
    { verifiedCount: 50, hasVault: true, dismissed: false, expected: false },
    { verifiedCount: 50, hasVault: false, dismissed: true, expected: false },
  ])(
    'returns $expected for $verifiedCount verified, vault=$hasVault, dismissed=$dismissed',
    ({ verifiedCount, hasVault, dismissed, expected }) => {
      expect(shouldShowBackupNudge(verifiedCount, hasVault, dismissed)).toBe(expected)
    }
  )
})
