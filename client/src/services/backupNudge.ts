export const BACKUP_NUDGE_DISMISSED_KEY = 'memd_backup_nudge_dismissed'
export const BACKUP_NUDGE_VERIFIED_THRESHOLD = 50

export function shouldShowBackupNudge(verifiedCount: number, hasVault: boolean, dismissed: boolean): boolean {
  return verifiedCount >= BACKUP_NUDGE_VERIFIED_THRESHOLD && !hasVault && !dismissed
}
