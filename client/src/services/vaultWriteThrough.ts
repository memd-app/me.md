import { and, eq } from 'drizzle-orm'
import { LOCAL_USER_ID } from '@/contexts/UserContext'
import { insights, topics } from '@/db/schema'
import { ensurePermission as ensureVaultPermission } from '@/services/obsidianSync'
import {
  generateInsightNote,
  generateNotesForInsight,
  generateObsidianNotes,
  stableHash,
  type InsightGenRow,
} from '@/services/obsidianExport'
import { loadVaultHandle as loadStoredVaultHandle } from '@/services/vaultHandle'
import { applyVaultBody, clearVaultSync, recordVaultSync } from '@/services/insights'
import { createFsaVaultFs, type VaultFs } from '@/services/vaultFs'
import {
  assembleNote,
  classifyReconcile,
  extractInsightBody,
  extractInsightBodyRaw,
  hashBody,
  normalizeBody,
  parseNote,
} from '@/services/vaultReconcile'

type Db = any
type VaultWriteKind = 'verify' | 'edit' | 'reject'
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
const JOURNAL_LIMIT = 500
const INSIGHTS_DIR = 'me.md/Insights'

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
  const slug = row ? generateInsightNote(row).slug : null
  const path = row ? generateInsightNote(row).note.path : null
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
  await drainPendingWrites(db, fs, resolvedDeps)

  const rows = getExportableInsightRows(db)
  for (const row of rows) {
    const generated = generateInsightNote(row)
    const disk = await readInsightDiskContent(fs, generated.note.path, row.id)
    const merged = assembleNote(row, row.content)
    const decision = classifyReconcile({
      dbBody: row.content,
      diskContent: disk.content,
      baseBodyHash: row.vaultBodyHash,
      dbContentHash: merged.contentHash,
      lastContentHash: row.vaultContentHash,
    })

    switch (decision) {
      case 'noop':
        break
      case 'adopt':
        if (disk.content !== null) {
          recordVaultSync(db, row.id, {
            contentHash: stableHash(disk.content),
            bodyHash: hashBody(extractInsightBody(disk.content)),
            syncedAt: resolvedDeps.now(),
          })
          report.adopted += 1
          appendJournal(makeJournalEntry(
            resolvedDeps,
            'reconcile',
            row.id,
            generated.slug,
            disk.path,
            'adopted',
            row.vaultContentHash,
            stableHash(disk.content),
          ))
        }
        break
      case 'metadata': {
        const rawBody = disk.content === null ? row.content : extractInsightBodyRaw(disk.content)
        const restamped = assembleNote(row, rawBody)
        await writeInsightNote(db, fs, row.id, generated.note.path, restamped.content, restamped.contentHash, restamped.bodyHash, resolvedDeps)
        report.updated += 1
        appendJournal(makeJournalEntry(resolvedDeps, 'reconcile', row.id, generated.slug, generated.note.path, 'written', row.vaultContentHash, restamped.contentHash))
        break
      }
      case 'app-wins':
        await writeInsightNote(db, fs, row.id, generated.note.path, merged.content, merged.contentHash, merged.bodyHash, resolvedDeps)
        report.updated += 1
        appendJournal(makeJournalEntry(resolvedDeps, 'reconcile', row.id, generated.slug, generated.note.path, 'written', row.vaultContentHash, merged.contentHash))
        break
      case 'recreate':
        await writeInsightNote(db, fs, row.id, generated.note.path, merged.content, merged.contentHash, merged.bodyHash, resolvedDeps)
        report.recreated += 1
        appendJournal(makeJournalEntry(resolvedDeps, 'reconcile', row.id, generated.slug, generated.note.path, 'recreated', row.vaultContentHash, merged.contentHash))
        break
      case 'vault-wins': {
        if (disk.content === null) break
        const vaultBody = extractInsightBody(disk.content)
        applyVaultBody(db, row.id, vaultBody)
        const pulledRow = { ...row, content: vaultBody }
        const restamped = assembleNote(pulledRow, vaultBody)
        await writeInsightNote(db, fs, row.id, generated.note.path, restamped.content, restamped.contentHash, restamped.bodyHash, resolvedDeps)
        report.pulled += 1
        appendJournal(makeJournalEntry(resolvedDeps, 'reconcile', row.id, generated.slug, generated.note.path, 'pulled', row.vaultContentHash, restamped.contentHash))
        break
      }
      case 'conflict': {
        if (disk.content === null) break
        const conflict: VaultConflict = {
          insightId: row.id,
          slug: generated.slug,
          path: generated.note.path,
          appBody: normalizeBody(row.content),
          vaultBody: extractInsightBody(disk.content),
          baseBodyHash: row.vaultBodyHash,
          detectedAt: resolvedDeps.now(),
        }
        upsertVaultConflict(conflict)
        report.conflicts += 1
        appendJournal(makeJournalEntry(resolvedDeps, 'reconcile', row.id, generated.slug, generated.note.path, 'conflict', row.vaultContentHash, null))
        break
      }
    }
  }

  await writeSupportNotes(db, fs)
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

  const currentRow = choice === 'vault' ? { ...row, content: body } : row
  const generated = generateInsightNote(currentRow)
  const merged = assembleNote(currentRow, body)
  await writeInsightNote(db, fs, conflict.insightId, generated.note.path, merged.content, merged.contentHash, merged.bodyHash, resolvedDeps)
  removeVaultConflict(conflict.insightId)
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

export function clearVaultStateForTests(): void {
  storageRemove(JOURNAL_KEY)
  storageRemove(PENDING_KEY)
  storageRemove(CONFLICTS_KEY)
}

async function writeCurrentInsightState(
  db: Db,
  insightId: string,
  kind: VaultWriteKind | 'reconcile',
  fs: VaultFs,
  deps: Required<VaultWriteThroughDeps>,
): Promise<void> {
  const row = getInsightRow(db, insightId)
  if (!row) return

  if (kind === 'reject' || row.verificationStatus === 'rejected' || row.privacyTier === 'never_export') {
    await moveInsightToRejected(db, row, fs, deps)
    return
  }

  if (!isExportable(row)) return

  const notes = generateNotesForInsight(db, insightId)
  await fs.write(notes.insight.path, notes.insight.content)
  recordVaultSync(db, insightId, {
    contentHash: notes.insight.hash,
    bodyHash: hashBody(row.content),
    syncedAt: deps.now(),
  })
  await fs.write(notes.topic.path, notes.topic.content)
  await fs.write(notes.index.path, notes.index.content)
  appendJournal(makeJournalEntry(deps, kind, insightId, generateInsightNote(row).slug, notes.insight.path, 'written', row.vaultContentHash, notes.insight.hash))
}

async function moveInsightToRejected(
  db: Db,
  row: VaultInsightRow,
  fs: VaultFs,
  deps: Required<VaultWriteThroughDeps>,
): Promise<void> {
  const generated = generateInsightNote(row)
  const sourcePath = generated.note.path
  const rejectedPath = sourcePath.replace('me.md/Insights/', 'me.md/Rejected/')
  const existing = await fs.read(sourcePath)

  if (existing !== null) {
    await fs.move(sourcePath, rejectedPath)
    await fs.write(rejectedPath, stampRejected(existing, row))
  }

  clearVaultSync(db, row.id)
  await writeSupportNotes(db, fs)
  appendJournal(makeJournalEntry(deps, 'reject', row.id, generated.slug, rejectedPath, 'moved-rejected', row.vaultContentHash, null))
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
  const supportNotes = result.notes.filter(note => !note.path.startsWith('me.md/Insights/'))
  for (const note of supportNotes) {
    await fs.write(note.path, note.content)
  }
}

async function drainPendingWrites(
  db: Db,
  fs: VaultFs,
  deps: Required<VaultWriteThroughDeps>,
): Promise<void> {
  const pending = getPendingVaultWrites()
  const stillPending: string[] = []

  for (const insightId of pending) {
    try {
      await writeCurrentInsightState(db, insightId, 'reconcile', fs, deps)
    } catch {
      stillPending.push(insightId)
      appendJournal(makeJournalEntry(deps, 'reconcile', insightId, null, null, 'error', null, null))
    }
  }

  setPendingVaultWrites(stillPending)
}

async function readInsightDiskContent(
  fs: VaultFs,
  expectedPath: string,
  insightId: string,
): Promise<{ path: string; content: string | null }> {
  const expected = await fs.read(expectedPath)
  if (expected !== null) {
    // Guard against an unrelated file occupying the expected path: the id must match.
    const expectedId = frontmatterId(expected)
    if (expectedId === null || expectedId === insightId) {
      return { path: expectedPath, content: expected }
    }
  }

  const names = await fs.list(INSIGHTS_DIR)
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const path = `${INSIGHTS_DIR}/${name}`
    if (path === expectedPath) continue
    const content = await fs.read(path)
    if (content !== null && frontmatterId(content) === insightId) {
      return { path, content }
    }
  }

  return { path: expectedPath, content: null }
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

function getExportableInsightRows(db: Db): VaultInsightRow[] {
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
      eq(insights.verificationStatus, 'verified'),
      eq(insights.privacyTier, 'exportable'),
    ))
    .all()
}

function stampRejected(existingContent: string, row: VaultInsightRow): string {
  const merged = assembleNote(row, extractInsightBodyRaw(existingContent))
  return merged.content.replace('\nsource: "me.md"', '\nstatus: "rejected"\nsource: "me.md"')
}

function frontmatterId(content: string): string | null {
  const parsed = parseNote(content)
  const id = parsed.frontmatter.find(([key]) => key === 'id')?.[1]
  if (!id) return null
  return id.replace(/^"(.*)"$/, '$1')
}

function isExportable(row: VaultInsightRow): boolean {
  return row.verificationStatus === 'verified' && row.privacyTier === 'exportable'
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
