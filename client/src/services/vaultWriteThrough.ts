import { and, eq, inArray } from 'drizzle-orm'
import { LOCAL_USER_ID } from '@/contexts/UserContext'
import { insights, topics } from '@/db/schema'
import { ensurePermission as ensureVaultPermission } from '@/services/obsidianSync'
import {
  STATUS_DIRS,
  generateInsightNote,
  generateObsidianNotes,
  stableHash,
  type InsightGenRow,
} from '@/services/obsidianExport'
import { loadVaultHandle as loadStoredVaultHandle } from '@/services/vaultHandle'
import {
  applyVaultBody,
  clearVaultSync,
  recordVaultSync,
  rejectInsight,
  reopenInsight,
  verifyInsight,
} from '@/services/insights'
import { createFsaVaultFs, type VaultFs } from '@/services/vaultFs'
import {
  assembleNote,
  classifyReconcile,
  classifyStatusReconcile,
  extractInsightBody,
  extractInsightBodyRaw,
  folderStatusFromPath,
  hashBody,
  normalizeBody,
  noteStatusForDb,
  parseNote,
  pickCanonicalLocation,
  type NoteStatus,
  type VaultNoteLocation,
} from '@/services/vaultReconcile'

type Db = any
type VaultWriteKind = 'verify' | 'edit' | 'reject' | 'pending'
type JournalAction = VaultWriteKind | 'reconcile'
type JournalOutcome =
  | 'written'
  | 'pulled'
  | 'recreated'
  | 'moved-rejected'
  | 'adopted'
  | 'conflict'
  | 'deferred:no-vault'
  | 'deferred:permission'
  | 'error'
  | 'materialized'
  | 'approved-from-vault'
  | 'rejected-from-vault'
  | 'dismissed'
  | 'duplicate-note'
  | 'attention'

export interface VaultConflict {
  insightId: string
  slug: string
  path: string
  appBody: string
  vaultBody: string
  baseBodyHash: string | null
  detectedAt: string
}

export interface ReconcileReport {
  created: number
  updated: number
  pulled: number
  recreated: number
  adopted: number
  conflicts: number
  movedRejected: number
  deferred: number
  materialized: number
  approvedFromVault: number
  rejectedFromVault: number
  pendingPulled: number
  dismissed: number
  attention: number
}

export type VaultAttentionKind = 'dismissed-in-vault' | 'backward-move' | 'duplicate-note'

export interface VaultAttentionItem {
  insightId: string
  slug: string
  kind: VaultAttentionKind
  detectedAt: string
  detail: {
    fromStatus?: NoteStatus
    dbStatus?: NoteStatus
    duplicatePaths?: string[]
    lastKnownPath?: string
  }
}

export interface VaultWriteThroughDeps {
  loadVaultHandle?: () => Promise<FileSystemDirectoryHandle | null>
  createVaultFs?: (handle: FileSystemDirectoryHandle) => VaultFs
  ensurePermission?: (handle: FileSystemDirectoryHandle) => Promise<boolean>
  now?: () => string
}

interface JournalEntry {
  ts: string
  action: JournalAction
  insightId: string
  slug: string | null
  path: string | null
  outcome: JournalOutcome
  hashBefore: string | null
  hashAfter: string | null
}

type VaultInsightRow = InsightGenRow & {
  verificationStatus: string | null
  privacyTier: string | null
  vaultContentHash: string | null
  vaultBodyHash: string | null
  vaultSyncedAt: string | null
}

const JOURNAL_KEY = 'memd.vault.journal'
const PENDING_KEY = 'memd.vault.pendingWrites'
const CONFLICTS_KEY = 'memd.vault.conflicts'
const ATTENTION_KEY = 'memd.vault.attention'
const JOURNAL_LIMIT = 500
const MATERIALIZE_BATCH_SIZE = 25
const STATUS_ORDER: NoteStatus[] = ['verified', 'rejected', 'pending']

const defaultDeps = {
  loadVaultHandle: loadStoredVaultHandle,
  createVaultFs: createFsaVaultFs,
  ensurePermission: ensureVaultPermission,
  now: () => new Date().toISOString(),
}

export function enqueueVaultWrite(
  db: Db,
  insightId: string,
  kind: VaultWriteKind,
  deps?: VaultWriteThroughDeps,
): void {
  void runVaultWriteThrough(db, insightId, kind, deps)
}

export async function runVaultWriteThrough(
  db: Db,
  insightId: string,
  kind: VaultWriteKind,
  deps?: VaultWriteThroughDeps,
): Promise<void> {
  const resolvedDeps = resolveDeps(deps)
  const row = getInsightRow(db, insightId)
  const target = row ? targetStatusForWrite(row) : null
  const generated = row && target ? generateInsightNote(row, target) : row ? generateInsightNote(row) : null
  const slug = generated?.slug ?? null
  const path = generated?.note.path ?? null
  const hashBefore = row?.vaultContentHash ?? null

  try {
    const handle = await resolvedDeps.loadVaultHandle()
    if (!handle) {
      appendJournal(makeJournalEntry(resolvedDeps, kind, insightId, slug, path, 'deferred:no-vault', hashBefore, null))
      return
    }

    const permission = await handle.queryPermission({ mode: 'readwrite' })
    if (permission !== 'granted') {
      addPendingVaultWrite(insightId)
      appendJournal(makeJournalEntry(resolvedDeps, kind, insightId, slug, path, 'deferred:permission', hashBefore, null))
      return
    }

    const fs = resolvedDeps.createVaultFs(handle)
    await writeCurrentInsightState(db, insightId, kind, fs, resolvedDeps)
  } catch {
    addPendingVaultWrite(insightId)
    appendJournal(makeJournalEntry(resolvedDeps, kind, insightId, slug, path, 'error', hashBefore, null))
  }
}

export function enqueueVaultPendingWrites(
  db: Db,
  insightIds: string[],
  deps?: VaultWriteThroughDeps,
): void {
  if (insightIds.length === 0) return
  void runVaultPendingWrites(db, insightIds, deps)
}

async function runVaultPendingWrites(
  db: Db,
  insightIds: string[],
  deps?: VaultWriteThroughDeps,
): Promise<void> {
  const resolvedDeps = resolveDeps(deps)

  try {
    const handle = await resolvedDeps.loadVaultHandle()
    if (!handle) {
      appendJournal(makeJournalEntry(resolvedDeps, 'pending', 'batch', null, null, 'deferred:no-vault', null, null))
      return
    }

    const permission = await handle.queryPermission({ mode: 'readwrite' })
    if (permission !== 'granted') {
      setPendingVaultWrites([...getPendingVaultWrites(), ...insightIds])
      appendJournal(makeJournalEntry(resolvedDeps, 'pending', 'batch', null, null, 'deferred:permission', null, null))
      return
    }

    const fs = resolvedDeps.createVaultFs(handle)
    for (const insightId of insightIds) {
      try {
        await writePendingNote(db, fs, insightId, resolvedDeps)
      } catch {
        addPendingVaultWrite(insightId)
        appendJournal(makeJournalEntry(resolvedDeps, 'pending', insightId, null, null, 'error', null, null))
      }
    }
  } catch {
    setPendingVaultWrites([...getPendingVaultWrites(), ...insightIds])
    appendJournal(makeJournalEntry(resolvedDeps, 'pending', 'batch', null, null, 'error', null, null))
  }
}

export async function reconcileVault(
  db: Db,
  handle: FileSystemDirectoryHandle,
  deps?: VaultWriteThroughDeps,
): Promise<ReconcileReport> {
  const resolvedDeps = resolveDeps(deps)
  if (!(await resolvedDeps.ensurePermission(handle))) {
    throw new Error('Permission to write to the vault was denied.')
  }

  const fs = resolvedDeps.createVaultFs(handle)
  const report = emptyReport()
  await drainPendingWrites(db, fs, resolvedDeps, report)

  const rows = getVaultManagedInsightRows(db)
  const rowById = new Map(rows.map(row => [row.id, row]))
  const locationsById = await scanVaultNotes(fs)
  const canonicalById = new Map<string, VaultNoteLocation>()
  const activeAttention = new Set<string>()
  const materializeRows: VaultInsightRow[] = []

  for (const [insightId, locations] of locationsById) {
    const row = rowById.get(insightId)
    if (!row) continue

    const picked = pickCanonicalLocation(locations, status => generateInsightNote(row, status).note.path)
    canonicalById.set(insightId, picked.winner)

    if (picked.losers.length > 0) {
      const generated = generateInsightNote(row, noteStatusForDb(row.verificationStatus) ?? picked.winner.folderStatus)
      const item = makeAttentionItem(row, generated.slug, 'duplicate-note', resolvedDeps, {
        duplicatePaths: picked.losers.map(location => location.path),
      })
      upsertVaultAttention(item)
      activeAttention.add(attentionKey(item))
      report.attention += picked.losers.length
      appendJournal(makeJournalEntry(
        resolvedDeps,
        'reconcile',
        row.id,
        generated.slug,
        picked.winner.path,
        'duplicate-note',
        row.vaultContentHash,
        null,
      ))
    }
  }

  for (const row of rows) {
    const dbStatus = noteStatusForDb(row.verificationStatus)
    if (!dbStatus) continue

    const location = canonicalById.get(row.id) ?? null
    const decision = classifyStatusReconcile({
      dbStatus,
      folderStatus: location?.folderStatus ?? null,
      everMaterialized: row.vaultSyncedAt !== null,
    })
    const generated = generateInsightNote(row, dbStatus)

    switch (decision.kind) {
      case 'noop':
        removeVaultConflict(row.id)
        break
      case 'materialize':
        materializeRows.push(row)
        break
      case 'dismissed': {
        const item = makeAttentionItem(row, generated.slug, 'dismissed-in-vault', resolvedDeps, {
          lastKnownPath: generated.note.path,
        })
        upsertVaultAttention(item)
        activeAttention.add(attentionKey(item))
        report.dismissed += 1
        appendJournal(makeJournalEntry(resolvedDeps, 'reconcile', row.id, generated.slug, generated.note.path, 'dismissed', row.vaultContentHash, null))
        break
      }
      case 'attention-backward': {
        const item = makeAttentionItem(row, generated.slug, 'backward-move', resolvedDeps, {
          fromStatus: location?.folderStatus ?? undefined,
          dbStatus,
        })
        upsertVaultAttention(item)
        activeAttention.add(attentionKey(item))
        report.attention += 1
        appendJournal(makeJournalEntry(resolvedDeps, 'reconcile', row.id, generated.slug, location?.path ?? null, 'attention', row.vaultContentHash, null))
        break
      }
      case 'apply-verify':
        if (location) {
          await applyVaultStatusTransition(db, fs, row, location, 'verified', report, resolvedDeps)
        }
        break
      case 'apply-reject':
        if (location) {
          await applyVaultStatusTransition(db, fs, row, location, 'rejected', report, resolvedDeps)
        }
        break
      case 'recreate': {
        const merged = assembleNote(row, row.content, 'verified')
        await writeInsightNote(db, fs, row.id, generated.note.path, merged.content, merged.contentHash, merged.bodyHash, resolvedDeps)
        report.recreated += 1
        appendJournal(makeJournalEntry(resolvedDeps, 'reconcile', row.id, generated.slug, generated.note.path, 'recreated', row.vaultContentHash, merged.contentHash))
        break
      }
      case 'in-place':
        if (location) {
          await applyInPlaceReconcile(db, fs, row, dbStatus, location, report, resolvedDeps)
        }
        break
    }
  }

  await materializePendingRows(db, fs, materializeRows, report, resolvedDeps)
  pruneVaultAttention(activeAttention)

  try {
    await writeSupportNotes(db, fs)
  } catch {
    appendJournal(makeJournalEntry(resolvedDeps, 'reconcile', 'support', null, null, 'error', null, null))
  }

  report.deferred = getPendingVaultWrites().length
  return report
}

export async function maybeAutoReconcile(
  db: Db,
  deps?: VaultWriteThroughDeps,
): Promise<ReconcileReport | { status: 'needs-reconnect' | 'no-vault' }> {
  const resolvedDeps = resolveDeps(deps)
  const handle = await resolvedDeps.loadVaultHandle()
  if (!handle) return { status: 'no-vault' }

  const permission = await handle.queryPermission({ mode: 'readwrite' })
  if (permission !== 'granted') return { status: 'needs-reconnect' }

  return reconcileVault(db, handle, deps)
}

export async function resolveVaultConflict(
  db: Db,
  handle: FileSystemDirectoryHandle,
  conflict: VaultConflict,
  choice: 'app' | 'vault',
  deps?: VaultWriteThroughDeps,
): Promise<void> {
  const resolvedDeps = resolveDeps(deps)
  if (!(await resolvedDeps.ensurePermission(handle))) {
    throw new Error('Permission to write to the vault was denied.')
  }

  const fs = resolvedDeps.createVaultFs(handle)
  const row = getInsightRow(db, conflict.insightId)
  if (!row) throw new Error('Insight not found')

  const body = choice === 'vault' ? conflict.vaultBody : row.content
  if (choice === 'vault') {
    applyVaultBody(db, conflict.insightId, body)
  }

  const currentRow = getInsightRow(db, conflict.insightId) ?? { ...row, content: body }
  const status = folderStatusFromPath(conflict.path) ?? noteStatusForDb(currentRow.verificationStatus) ?? 'verified'
  const merged = assembleNote(currentRow, body, status)
  await writeInsightNote(db, fs, conflict.insightId, conflict.path, merged.content, merged.contentHash, merged.bodyHash, resolvedDeps)
  removeVaultConflict(conflict.insightId)
}

export async function resolveVaultAttention(
  db: Db,
  handle: FileSystemDirectoryHandle,
  item: VaultAttentionItem,
  choice: string,
  deps?: VaultWriteThroughDeps,
): Promise<void> {
  const resolvedDeps = resolveDeps(deps)
  if (!(await resolvedDeps.ensurePermission(handle))) {
    throw new Error('Permission to write to the vault was denied.')
  }

  const fs = resolvedDeps.createVaultFs(handle)
  const row = getInsightRow(db, item.insightId)
  if (!row) {
    removeVaultAttention(item)
    return
  }

  if (item.kind === 'dismissed-in-vault') {
    if (choice === 'confirm-reject') {
      rejectInsight(db, item.insightId, 'Dismissed in vault')
      clearVaultSync(db, item.insightId)
      appendJournal(makeJournalEntry(resolvedDeps, 'reconcile', item.insightId, item.slug, item.detail.lastKnownPath ?? null, 'rejected-from-vault', row.vaultContentHash, null))
    } else if (choice === 're-materialize') {
      await writePendingNote(db, fs, item.insightId, resolvedDeps)
    }
    removeVaultAttention(item)
    return
  }

  if (item.kind === 'backward-move') {
    const fromStatus = item.detail.fromStatus
    const dbStatus = noteStatusForDb(row.verificationStatus)
    if (choice === 'keep-current' && dbStatus) {
      await moveNoteToStatus(db, row, dbStatus, fs, resolvedDeps, 'reconcile')
    } else if (choice === 'apply-move' && fromStatus) {
      if (fromStatus === 'verified') {
        verifyInsight(db, item.insightId)
      } else if (fromStatus === 'pending') {
        reopenInsight(db, item.insightId)
      } else {
        rejectInsight(db, item.insightId, 'Rejected in vault')
      }
      const current = getInsightRow(db, item.insightId)
      if (current) await moveNoteToStatus(db, current, fromStatus, fs, resolvedDeps, 'reconcile')
    }
    removeVaultAttention(item)
    return
  }

  if (item.kind === 'duplicate-note' && choice === 'dismiss') {
    removeVaultAttention(item)
  }
}

export function getVaultJournal(): JournalEntry[] {
  return storageGet(JOURNAL_KEY)
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as JournalEntry)
}

export function getPendingVaultWrites(): string[] {
  return readJson<string[]>(PENDING_KEY, [])
}

export function setPendingVaultWrites(ids: string[]): void {
  storageSet(PENDING_KEY, JSON.stringify(Array.from(new Set(ids))))
}

export function getVaultConflicts(): VaultConflict[] {
  return readJson<VaultConflict[]>(CONFLICTS_KEY, [])
}

export function setVaultConflicts(conflicts: VaultConflict[]): void {
  storageSet(CONFLICTS_KEY, JSON.stringify(conflicts))
}

export function getVaultAttention(): VaultAttentionItem[] {
  return readJson<VaultAttentionItem[]>(ATTENTION_KEY, [])
}

export function setVaultAttention(items: VaultAttentionItem[]): void {
  storageSet(ATTENTION_KEY, JSON.stringify(items))
}

export function clearVaultStateForTests(): void {
  storageRemove(JOURNAL_KEY)
  storageRemove(PENDING_KEY)
  storageRemove(CONFLICTS_KEY)
  storageRemove(ATTENTION_KEY)
}

async function writeCurrentInsightState(
  db: Db,
  insightId: string,
  kind: JournalAction,
  fs: VaultFs,
  deps: Required<VaultWriteThroughDeps>,
): Promise<void> {
  const row = getInsightRow(db, insightId)
  if (!row) return

  const target = targetStatusForWrite(row)
  if (!target) return

  await moveNoteToStatus(db, row, target, fs, deps, kind)
}

function targetStatusForWrite(row: VaultInsightRow): NoteStatus | null {
  if (row.privacyTier === 'never_export') return 'rejected'
  return noteStatusForDb(row.verificationStatus)
}

async function moveNoteToStatus(
  db: Db,
  initialRow: VaultInsightRow,
  target: NoteStatus,
  fs: VaultFs,
  deps: Required<VaultWriteThroughDeps>,
  action: JournalAction,
): Promise<void> {
  let row = initialRow
  const targetNote = generateInsightNote(row, target)
  const targetPath = targetNote.note.path
  const found = await findInsightNote(fs, row, target)
  let resolvedBody = row.content

  if (found?.content) {
    const diskBodyRaw = extractInsightBodyRaw(found.content)
    if (
      hashBody(diskBodyRaw) !== row.vaultBodyHash
      && normalizeBody(diskBodyRaw) !== normalizeBody(row.content)
    ) {
      applyVaultBody(db, row.id, extractInsightBody(found.content))
      row = getInsightRow(db, row.id) ?? { ...row, content: extractInsightBody(found.content) }
    }
    resolvedBody = diskBodyRaw
  }

  if (found && found.path !== targetPath) {
    await fs.move(found.path, targetPath)
  }

  if (target === 'rejected' && !found) {
    clearVaultSync(db, row.id)
    await writeSupportNotes(db, fs)
    appendJournal(makeJournalEntry(deps, action, row.id, targetNote.slug, targetPath, 'moved-rejected', row.vaultContentHash, null))
    return
  }

  const currentRow = getInsightRow(db, row.id) ?? row
  const assembled = assembleNote(currentRow, resolvedBody, target)
  await fs.write(targetPath, assembled.content)

  if (target === 'rejected') {
    clearVaultSync(db, row.id)
  } else {
    recordVaultSync(db, row.id, {
      contentHash: assembled.contentHash,
      bodyHash: assembled.bodyHash,
      syncedAt: deps.now(),
    })
  }

  if (target === 'verified' || target === 'rejected') {
    await writeSupportNotes(db, fs)
  }

  appendJournal(makeJournalEntry(
    deps,
    action,
    row.id,
    targetNote.slug,
    targetPath,
    target === 'rejected' ? 'moved-rejected' : 'written',
    row.vaultContentHash,
    target === 'rejected' ? null : assembled.contentHash,
  ))
}

async function applyInPlaceReconcile(
  db: Db,
  fs: VaultFs,
  row: VaultInsightRow,
  dbStatus: NoteStatus,
  location: VaultNoteLocation,
  report: ReconcileReport,
  deps: Required<VaultWriteThroughDeps>,
): Promise<void> {
  const generated = generateInsightNote(row, dbStatus)

  if (dbStatus === 'rejected') {
    const restamped = assembleNote(row, extractInsightBodyRaw(location.content), 'rejected')
    if (restamped.content !== location.content.replace(/\r\n?/g, '\n')) {
      await fs.write(location.path, restamped.content)
      report.updated += 1
      appendJournal(makeJournalEntry(deps, 'reconcile', row.id, generated.slug, location.path, 'written', row.vaultContentHash, null))
    }
    removeVaultConflict(row.id)
    return
  }

  const merged = assembleNote(row, row.content, dbStatus)
  const decision = classifyReconcile({
    dbBody: row.content,
    diskContent: location.content,
    baseBodyHash: row.vaultBodyHash,
    dbContentHash: merged.contentHash,
    lastContentHash: row.vaultContentHash,
  })

  switch (decision) {
    case 'noop':
      removeVaultConflict(row.id)
      break
    case 'adopt':
      recordVaultSync(db, row.id, {
        contentHash: stableHash(location.content),
        bodyHash: hashBody(extractInsightBody(location.content)),
        syncedAt: deps.now(),
      })
      report.adopted += 1
      appendJournal(makeJournalEntry(deps, 'reconcile', row.id, generated.slug, location.path, 'adopted', row.vaultContentHash, stableHash(location.content)))
      break
    case 'metadata': {
      const restamped = assembleNote(row, extractInsightBodyRaw(location.content), dbStatus)
      await writeInsightNote(db, fs, row.id, location.path, restamped.content, restamped.contentHash, restamped.bodyHash, deps)
      report.updated += 1
      appendJournal(makeJournalEntry(deps, 'reconcile', row.id, generated.slug, location.path, 'written', row.vaultContentHash, restamped.contentHash))
      break
    }
    case 'app-wins':
      await writeInsightNote(db, fs, row.id, location.path, merged.content, merged.contentHash, merged.bodyHash, deps)
      report.updated += 1
      appendJournal(makeJournalEntry(deps, 'reconcile', row.id, generated.slug, location.path, 'written', row.vaultContentHash, merged.contentHash))
      break
    case 'recreate':
      await writeInsightNote(db, fs, row.id, generated.note.path, merged.content, merged.contentHash, merged.bodyHash, deps)
      report.recreated += 1
      appendJournal(makeJournalEntry(deps, 'reconcile', row.id, generated.slug, generated.note.path, 'recreated', row.vaultContentHash, merged.contentHash))
      break
    case 'vault-wins': {
      const vaultBody = extractInsightBody(location.content)
      applyVaultBody(db, row.id, vaultBody)
      const currentRow = getInsightRow(db, row.id) ?? { ...row, content: vaultBody }
      const restamped = assembleNote(currentRow, vaultBody, dbStatus)
      await writeInsightNote(db, fs, row.id, location.path, restamped.content, restamped.contentHash, restamped.bodyHash, deps)
      if (dbStatus === 'pending') report.pendingPulled += 1
      else report.pulled += 1
      appendJournal(makeJournalEntry(deps, 'reconcile', row.id, generated.slug, location.path, 'pulled', row.vaultContentHash, restamped.contentHash))
      break
    }
    case 'conflict':
      upsertVaultConflict({
        insightId: row.id,
        slug: generated.slug,
        path: location.path,
        appBody: normalizeBody(row.content),
        vaultBody: extractInsightBody(location.content),
        baseBodyHash: row.vaultBodyHash,
        detectedAt: deps.now(),
      })
      report.conflicts += 1
      appendJournal(makeJournalEntry(deps, 'reconcile', row.id, generated.slug, location.path, 'conflict', row.vaultContentHash, null))
      break
  }
}

async function applyVaultStatusTransition(
  db: Db,
  fs: VaultFs,
  initialRow: VaultInsightRow,
  location: VaultNoteLocation,
  target: 'verified' | 'rejected',
  report: ReconcileReport,
  deps: Required<VaultWriteThroughDeps>,
): Promise<void> {
  let row = initialRow
  const diskBodyRaw = extractInsightBodyRaw(location.content)
  const diskBody = extractInsightBody(location.content)
  if (
    hashBody(diskBodyRaw) !== row.vaultBodyHash
    && normalizeBody(diskBodyRaw) !== normalizeBody(row.content)
  ) {
    applyVaultBody(db, row.id, diskBody)
    row = getInsightRow(db, row.id) ?? { ...row, content: diskBody }
  }

  if (target === 'verified') {
    verifyInsight(db, row.id)
  } else {
    rejectInsight(db, row.id, 'Rejected in vault')
  }

  const currentRow = getInsightRow(db, row.id) ?? row
  const restamped = assembleNote(currentRow, diskBodyRaw, target)
  await fs.write(location.path, restamped.content)

  if (target === 'verified') {
    recordVaultSync(db, row.id, {
      contentHash: restamped.contentHash,
      bodyHash: restamped.bodyHash,
      syncedAt: deps.now(),
    })
    report.approvedFromVault += 1
    appendJournal(makeJournalEntry(deps, 'reconcile', row.id, generateInsightNote(currentRow, target).slug, location.path, 'approved-from-vault', row.vaultContentHash, restamped.contentHash))
  } else {
    clearVaultSync(db, row.id)
    report.rejectedFromVault += 1
    appendJournal(makeJournalEntry(deps, 'reconcile', row.id, generateInsightNote(currentRow, target).slug, location.path, 'rejected-from-vault', row.vaultContentHash, null))
  }

  await writeSupportNotes(db, fs)
  removeVaultConflict(row.id)
}

async function materializePendingRows(
  db: Db,
  fs: VaultFs,
  rows: VaultInsightRow[],
  report: ReconcileReport,
  deps: Required<VaultWriteThroughDeps>,
): Promise<void> {
  for (let index = 0; index < rows.length; index += MATERIALIZE_BATCH_SIZE) {
    const batch = rows.slice(index, index + MATERIALIZE_BATCH_SIZE)
    for (const row of batch) {
      try {
        const wrote = await writePendingNote(db, fs, row.id, deps)
        if (wrote) report.materialized += 1
      } catch {
        addPendingVaultWrite(row.id)
        appendJournal(makeJournalEntry(deps, 'reconcile', row.id, generateInsightNote(row, 'pending').slug, generateInsightNote(row, 'pending').note.path, 'error', row.vaultContentHash, null))
      }
    }
    if (index + MATERIALIZE_BATCH_SIZE < rows.length) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
}

async function writePendingNote(
  db: Db,
  fs: VaultFs,
  insightId: string,
  deps: Required<VaultWriteThroughDeps>,
): Promise<boolean> {
  const row = getInsightRow(db, insightId)
  if (!row || row.verificationStatus !== 'unverified' || row.privacyTier !== 'exportable') {
    return false
  }

  const generated = generateInsightNote(row, 'pending')
  await fs.write(generated.note.path, generated.note.content)
  recordVaultSync(db, insightId, {
    contentHash: generated.note.hash,
    bodyHash: hashBody(row.content),
    syncedAt: deps.now(),
  })
  appendJournal(makeJournalEntry(deps, 'pending', insightId, generated.slug, generated.note.path, 'materialized', row.vaultContentHash, generated.note.hash))
  return true
}

async function writeInsightNote(
  db: Db,
  fs: VaultFs,
  insightId: string,
  path: string,
  content: string,
  contentHash: string,
  bodyHash: string,
  deps: Required<VaultWriteThroughDeps>,
): Promise<void> {
  await fs.write(path, content)
  recordVaultSync(db, insightId, {
    contentHash,
    bodyHash,
    syncedAt: deps.now(),
  })
}

async function writeSupportNotes(db: Db, fs: VaultFs): Promise<void> {
  const result = generateObsidianNotes(db)
  const supportNotes = result.notes.filter(note => !Object.values(STATUS_DIRS).some(dir => note.path.startsWith(`${dir}/`)))
  for (const note of supportNotes) {
    await fs.write(note.path, note.content)
  }
}

async function drainPendingWrites(
  db: Db,
  fs: VaultFs,
  deps: Required<VaultWriteThroughDeps>,
  report?: ReconcileReport,
): Promise<void> {
  const pending = getPendingVaultWrites()
  const stillPending: string[] = []

  for (const insightId of pending) {
    try {
      const before = getInsightRow(db, insightId)
      await writeCurrentInsightState(db, insightId, 'reconcile', fs, deps)
      const after = getInsightRow(db, insightId)
      if (
        report
        && before?.verificationStatus === 'unverified'
        && before.privacyTier === 'exportable'
        && before.vaultSyncedAt === null
        && after?.vaultSyncedAt !== null
      ) {
        report.materialized += 1
      }
    } catch {
      stillPending.push(insightId)
      appendJournal(makeJournalEntry(deps, 'reconcile', insightId, null, null, 'error', null, null))
    }
  }

  setPendingVaultWrites(stillPending)
}

async function scanVaultNotes(fs: VaultFs): Promise<Map<string, VaultNoteLocation[]>> {
  const byId = new Map<string, VaultNoteLocation[]>()

  for (const [status, dir] of Object.entries(STATUS_DIRS) as Array<[NoteStatus, string]>) {
    const names = await fs.list(dir)
    for (const name of names) {
      if (!name.endsWith('.md')) continue
      const path = `${dir}/${name}`
      const content = await fs.read(path)
      if (content === null) continue
      const id = frontmatterId(content)
      if (!id) continue
      const folderStatus = folderStatusFromPath(path)
      if (!folderStatus || folderStatus !== status) continue
      byId.set(id, [...(byId.get(id) ?? []), { path, folderStatus, content }])
    }
  }

  return byId
}

async function findInsightNote(
  fs: VaultFs,
  row: VaultInsightRow,
  target: NoteStatus,
): Promise<VaultNoteLocation | null> {
  const statuses = [target, ...STATUS_ORDER.filter(status => status !== target)]
  for (const status of statuses) {
    const expectedPath = generateInsightNote(row, status).note.path
    const content = await fs.read(expectedPath)
    if (content !== null && frontmatterId(content) === row.id) {
      return { path: expectedPath, folderStatus: status, content }
    }
  }

  const locations: VaultNoteLocation[] = []
  for (const [status, dir] of Object.entries(STATUS_DIRS) as Array<[NoteStatus, string]>) {
    const names = await fs.list(dir)
    for (const name of names) {
      if (!name.endsWith('.md')) continue
      const path = `${dir}/${name}`
      const content = await fs.read(path)
      if (content !== null && frontmatterId(content) === row.id) {
        locations.push({ path, folderStatus: status, content })
      }
    }
  }

  if (locations.length === 0) return null
  return pickCanonicalLocation(locations, status => generateInsightNote(row, status).note.path).winner
}

function getInsightRow(db: Db, insightId: string): VaultInsightRow | null {
  return db.select({
    id: insights.id,
    content: insights.content,
    confidenceScore: insights.confidenceScore,
    verifiedAt: insights.verifiedAt,
    updatedAt: insights.updatedAt,
    topicId: insights.topicId,
    topicTitle: topics.title,
    verificationStatus: insights.verificationStatus,
    privacyTier: insights.privacyTier,
    vaultContentHash: insights.vaultContentHash,
    vaultBodyHash: insights.vaultBodyHash,
    vaultSyncedAt: insights.vaultSyncedAt,
  }).from(insights)
    .leftJoin(topics, eq(insights.topicId, topics.id))
    .where(and(eq(insights.id, insightId), eq(insights.userId, LOCAL_USER_ID)))
    .get() ?? null
}

function getVaultManagedInsightRows(db: Db): VaultInsightRow[] {
  return db.select({
    id: insights.id,
    content: insights.content,
    confidenceScore: insights.confidenceScore,
    verifiedAt: insights.verifiedAt,
    updatedAt: insights.updatedAt,
    topicId: insights.topicId,
    topicTitle: topics.title,
    verificationStatus: insights.verificationStatus,
    privacyTier: insights.privacyTier,
    vaultContentHash: insights.vaultContentHash,
    vaultBodyHash: insights.vaultBodyHash,
    vaultSyncedAt: insights.vaultSyncedAt,
  }).from(insights)
    .leftJoin(topics, eq(insights.topicId, topics.id))
    .where(and(
      eq(insights.userId, LOCAL_USER_ID),
      eq(insights.privacyTier, 'exportable'),
      inArray(insights.verificationStatus, ['unverified', 'verified', 're_verification_pending', 'rejected']),
    ))
    .all()
}

function frontmatterId(content: string): string | null {
  const parsed = parseNote(content)
  const id = parsed.frontmatter.find(([key]) => key === 'id')?.[1]
  if (!id) return null
  return id.replace(/^"(.*)"$/, '$1')
}

function emptyReport(): ReconcileReport {
  return {
    created: 0,
    updated: 0,
    pulled: 0,
    recreated: 0,
    adopted: 0,
    conflicts: 0,
    movedRejected: 0,
    deferred: 0,
    materialized: 0,
    approvedFromVault: 0,
    rejectedFromVault: 0,
    pendingPulled: 0,
    dismissed: 0,
    attention: 0,
  }
}

function addPendingVaultWrite(insightId: string): void {
  setPendingVaultWrites([...getPendingVaultWrites(), insightId])
}

function upsertVaultConflict(conflict: VaultConflict): void {
  setVaultConflicts([
    ...getVaultConflicts().filter(item => item.insightId !== conflict.insightId),
    conflict,
  ])
}

function removeVaultConflict(insightId: string): void {
  setVaultConflicts(getVaultConflicts().filter(conflict => conflict.insightId !== insightId))
}

function makeAttentionItem(
  row: VaultInsightRow,
  slug: string,
  kind: VaultAttentionKind,
  deps: Required<VaultWriteThroughDeps>,
  detail: VaultAttentionItem['detail'],
): VaultAttentionItem {
  return {
    insightId: row.id,
    slug,
    kind,
    detectedAt: deps.now(),
    detail,
  }
}

function upsertVaultAttention(item: VaultAttentionItem): void {
  setVaultAttention([
    ...getVaultAttention().filter(existing => attentionKey(existing) !== attentionKey(item)),
    item,
  ])
}

function removeVaultAttention(item: VaultAttentionItem): void {
  setVaultAttention(getVaultAttention().filter(existing => attentionKey(existing) !== attentionKey(item)))
}

function pruneVaultAttention(activeKeys: Set<string>): void {
  setVaultAttention(getVaultAttention().filter(item => activeKeys.has(attentionKey(item))))
}

function attentionKey(item: Pick<VaultAttentionItem, 'insightId' | 'kind'>): string {
  return `${item.insightId}:${item.kind}`
}

function appendJournal(entry: JournalEntry): void {
  const entries = [...getVaultJournal(), entry].slice(-JOURNAL_LIMIT)
  storageSet(JOURNAL_KEY, entries.map(item => JSON.stringify(item)).join('\n'))
}

function makeJournalEntry(
  deps: Required<VaultWriteThroughDeps>,
  action: JournalAction,
  insightId: string,
  slug: string | null,
  path: string | null,
  outcome: JournalOutcome,
  hashBefore: string | null,
  hashAfter: string | null,
): JournalEntry {
  return {
    ts: deps.now(),
    action,
    insightId,
    slug,
    path,
    outcome,
    hashBefore,
    hashAfter,
  }
}

function resolveDeps(deps?: VaultWriteThroughDeps): Required<VaultWriteThroughDeps> {
  return {
    loadVaultHandle: deps?.loadVaultHandle ?? defaultDeps.loadVaultHandle,
    createVaultFs: deps?.createVaultFs ?? defaultDeps.createVaultFs,
    ensurePermission: deps?.ensurePermission ?? defaultDeps.ensurePermission,
    now: deps?.now ?? defaultDeps.now,
  }
}

function readJson<T>(key: string, fallback: T): T {
  const raw = storageGet(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function storageGet(key: string): string {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(key) ?? ''
}

function storageSet(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(key, value)
}

function storageRemove(key: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(key)
}
