import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import * as schema from '@/db/schema'
import { CREATE_TABLES_SQL } from '@/db/database'
import { insights, verificationHistory } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { generateInsightNote, stableHash } from '../obsidianExport'
import { hashBody } from '../vaultReconcile'
import type { VaultFs } from '../vaultFs'
import {
  clearVaultStateForTests,
  enqueueVaultPendingWrites,
  getPendingVaultWrites,
  getVaultAttention,
  getVaultConflicts,
  getVaultJournal,
  reconcileVault,
  resolveVaultAttention,
  runVaultWriteThrough,
  setPendingVaultWrites,
  type VaultWriteThroughDeps,
} from '../vaultWriteThrough'

vi.mock('@/db/persistence', () => ({
  scheduleSave: vi.fn(),
}))

class FakeVaultFs implements VaultFs {
  readonly files = new Map<string, string>()
  readonly paths: string[] = []
  readonly writeCounts = new Map<string, number>()
  failWritesAfter: number | null = null

  async read(path: string): Promise<string | null> {
    this.record(path)
    return this.files.get(path) ?? null
  }

  async write(path: string, content: string): Promise<void> {
    this.record(path)
    if (this.failWritesAfter !== null) {
      if (this.failWritesAfter <= 0) throw new Error(`Injected write failure for ${path}`)
      this.failWritesAfter -= 1
    }
    this.writeCounts.set(path, (this.writeCounts.get(path) ?? 0) + 1)
    this.files.set(path, content)
  }

  async list(dirPath: string): Promise<string[]> {
    this.record(dirPath)
    const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`
    return Array.from(this.files.keys())
      .filter(path => path.startsWith(prefix))
      .map(path => path.slice(prefix.length).split('/')[0])
      .filter((name, index, names) => name && names.indexOf(name) === index)
  }

  async move(fromPath: string, toPath: string): Promise<void> {
    this.record(fromPath)
    this.record(toPath)
    const content = this.files.get(fromPath)
    if (content === undefined) return
    this.files.set(toPath, content)
    this.files.delete(fromPath)
  }

  private record(path: string): void {
    this.paths.push(path)
    if (path !== 'me.md' && !path.startsWith('me.md/')) {
      throw new Error(`Path escaped vault root: ${path}`)
    }
  }
}

function installLocalStorage(): void {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value) }),
    removeItem: vi.fn((key: string) => { store.delete(key) }),
    clear: vi.fn(() => { store.clear() }),
  })
}

function makeHandle(permission: PermissionState = 'granted'): FileSystemDirectoryHandle {
  return {
    queryPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => permission),
  } as unknown as FileSystemDirectoryHandle
}

function latestJournalOutcome(): string | undefined {
  const journal = getVaultJournal()
  return journal[journal.length - 1]?.outcome
}

function depsFor(fs: FakeVaultFs, handle = makeHandle()): VaultWriteThroughDeps {
  return {
    loadVaultHandle: async () => handle,
    createVaultFs: () => fs,
    ensurePermission: async () => true,
    now: () => '2026-07-06T12:00:00.000Z',
  }
}

function sqlValue(value: string | number | null): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return String(value)
  return `'${value.replace(/'/g, "''")}'`
}

describe('vault write-through orchestration', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>

  beforeAll(async () => {
    const SQL = await initSqlJs()
    const sqlDb = new SQL.Database()
    sqlDb.run('PRAGMA foreign_keys = ON;')
    sqlDb.run(CREATE_TABLES_SQL)
    db = drizzle(sqlDb, { schema })
  })

  beforeEach(() => {
    installLocalStorage()
    clearVaultStateForTests()
    db.run('DELETE FROM verification_history')
    db.run('DELETE FROM insights')
    db.run('DELETE FROM topics')
    db.run('DELETE FROM users')
    db.run("INSERT OR IGNORE INTO users (id, name) VALUES ('local-user', 'Test User')")
    db.run("INSERT INTO topics (id, user_id, title) VALUES ('topic-work', 'local-user', 'Work')")
  })

  function insertInsight(params: {
    id: string
    content: string
    verificationStatus?: string
    privacyTier?: string
    vaultContentHash?: string | null
    vaultBodyHash?: string | null
    vaultSyncedAt?: string | null
    verifiedAt?: string | null
  }): void {
    db.run(`
      INSERT INTO insights (
        id,
        user_id,
        topic_id,
        content,
        confidence_score,
        verification_status,
        privacy_tier,
        verified_at,
        updated_at,
        vault_content_hash,
        vault_body_hash,
        vault_synced_at
      )
      VALUES (
        ${sqlValue(params.id)},
        'local-user',
        'topic-work',
        ${sqlValue(params.content)},
        86,
        ${sqlValue(params.verificationStatus ?? 'verified')},
        ${sqlValue(params.privacyTier ?? 'exportable')},
        ${sqlValue(params.verifiedAt ?? '2026-07-05T10:00:00.000Z')},
        '2026-07-05T10:00:00.000Z',
        ${sqlValue(params.vaultContentHash ?? null)},
        ${sqlValue(params.vaultBodyHash ?? null)},
        ${sqlValue(params.vaultSyncedAt ?? null)}
      )
    `)
  }

  it('write-through creates insight, topic, and index notes and records hashes', async () => {
    insertInsight({ id: 'ins-alpha123', content: 'I prefer crisp project notes.' })
    const fs = new FakeVaultFs()

    await runVaultWriteThrough(db, 'ins-alpha123', 'verify', depsFor(fs))

    const insightPath = Array.from(fs.files.keys()).find(path => path.startsWith('me.md/Insights/'))
    expect(insightPath).toBeDefined()
    expect(fs.files.has('me.md/Topics/Topic - Work.md')).toBe(true)
    expect(fs.files.has('me.md/Me - Index.md')).toBe(true)
    const row = db.select().from(insights).where(eq(insights.id, 'ins-alpha123')).get()
    expect(row?.vaultContentHash).toBe(stableHash(fs.files.get(insightPath!) ?? ''))
    expect(row?.vaultBodyHash).toBe(hashBody('I prefer crisp project notes.'))
    expect(row?.vaultSyncedAt).toBe('2026-07-06T12:00:00.000Z')
    expect(fs.paths.every(path => path === 'me.md' || path.startsWith('me.md/'))).toBe(true)
  })

  it('enqueueVaultPendingWrites materializes unverified exportable insights and skips unmanaged rows', async () => {
    insertInsight({ id: 'ins-pending1', content: 'Pending body.', verificationStatus: 'unverified', verifiedAt: null })
    insertInsight({ id: 'ins-private1', content: 'Private pending.', verificationStatus: 'unverified', privacyTier: 'never_export', verifiedAt: null })
    insertInsight({ id: 'ins-verified1', content: 'Verified body.' })
    const fs = new FakeVaultFs()

    enqueueVaultPendingWrites(db, ['ins-pending1', 'ins-private1', 'ins-verified1'], depsFor(fs))
    await waitForMicrotasks()

    const pendingPath = Array.from(fs.files.keys()).find(path => path.startsWith('me.md/Pending/'))
    expect(pendingPath).toBeDefined()
    expect(fs.files.get(pendingPath!)).toContain('status: "pending"')
    expect(fs.files.get(pendingPath!)).toContain('id: "ins-pending1"')
    expect(Array.from(fs.files.keys()).filter(path => path.startsWith('me.md/Pending/'))).toHaveLength(1)
    const row = db.select().from(insights).where(eq(insights.id, 'ins-pending1')).get()
    expect(row?.vaultContentHash).toBe(stableHash(fs.files.get(pendingPath!) ?? ''))
    expect(row?.vaultBodyHash).toBe(hashBody('Pending body.'))
    expect(latestJournalOutcome()).toBe('materialized')
  })

  it('enqueueVaultPendingWrites defers the batch without prompting when vault access is unavailable', async () => {
    insertInsight({ id: 'ins-pending1', content: 'Pending body.', verificationStatus: 'unverified', verifiedAt: null })
    insertInsight({ id: 'ins-pending2', content: 'Another pending body.', verificationStatus: 'unverified', verifiedAt: null })
    const fs = new FakeVaultFs()

    enqueueVaultPendingWrites(db, ['ins-pending1', 'ins-pending2'], {
      ...depsFor(fs),
      loadVaultHandle: async () => null,
    })
    await waitForMicrotasks()

    expect(getPendingVaultWrites()).toEqual([])
    expect(getVaultJournal().map(entry => entry.outcome)).toContain('deferred:no-vault')

    enqueueVaultPendingWrites(db, ['ins-pending1', 'ins-pending2'], depsFor(fs, makeHandle('prompt')))
    await waitForMicrotasks()

    expect(getPendingVaultWrites()).toEqual(['ins-pending1', 'ins-pending2'])
    expect(getVaultJournal().map(entry => entry.outcome)).toContain('deferred:permission')
  })

  it('journals no-vault write-through without throwing', async () => {
    insertInsight({ id: 'ins-alpha123', content: 'I prefer crisp project notes.' })
    const fs = new FakeVaultFs()

    await runVaultWriteThrough(db, 'ins-alpha123', 'verify', {
      ...depsFor(fs),
      loadVaultHandle: async () => null,
    })

    expect(latestJournalOutcome()).toBe('deferred:no-vault')
    expect(getPendingVaultWrites()).toEqual([])
  })

  it('queues write-through when permission is stale', async () => {
    insertInsight({ id: 'ins-alpha123', content: 'I prefer crisp project notes.' })
    const fs = new FakeVaultFs()
    const handle = makeHandle('prompt')

    await runVaultWriteThrough(db, 'ins-alpha123', 'verify', depsFor(fs, handle))

    expect(getPendingVaultWrites()).toEqual(['ins-alpha123'])
    expect(latestJournalOutcome()).toBe('deferred:permission')
  })

  it('reject moves an existing note to Rejected and clears vault hashes', async () => {
    insertInsight({ id: 'ins-alpha123', content: 'I prefer crisp project notes.' })
    const fs = new FakeVaultFs()
    await runVaultWriteThrough(db, 'ins-alpha123', 'verify', depsFor(fs))
    const insightPath = Array.from(fs.files.keys()).find(path => path.startsWith('me.md/Insights/'))!

    db.update(insights).set({ verificationStatus: 'rejected' }).where(eq(insights.id, 'ins-alpha123')).run()
    await runVaultWriteThrough(db, 'ins-alpha123', 'reject', depsFor(fs))

    expect(fs.files.has(insightPath)).toBe(false)
    const rejectedPath = insightPath.replace('me.md/Insights/', 'me.md/Rejected/')
    expect(fs.files.get(rejectedPath)).toContain('status: "rejected"')
    const row = db.select().from(insights).where(eq(insights.id, 'ins-alpha123')).get()
    expect(row?.vaultContentHash).toBeNull()
    expect(row?.vaultBodyHash).toBeNull()
    expect(row?.vaultSyncedAt).toBeNull()
    expect(latestJournalOutcome()).toBe('moved-rejected')
  })

  it('reject without an existing disk note is a no-op', async () => {
    insertInsight({ id: 'ins-alpha123', content: 'I prefer crisp project notes.', verificationStatus: 'rejected' })
    const fs = new FakeVaultFs()

    await runVaultWriteThrough(db, 'ins-alpha123', 'reject', depsFor(fs))

    expect(Array.from(fs.files.keys()).filter(path => path.startsWith('me.md/Rejected/'))).toEqual([])
    expect(latestJournalOutcome()).toBe('moved-rejected')
  })

  it('reconcile app-wins writes a changed database body to disk', async () => {
    const baseBody = 'Base body.'
    const baseNote = [
      '---',
      'title: "Base body"',
      'topic: "Work"',
      'confidence: 86',
      'source: "me.md"',
      'id: "ins-alpha123"',
      '---',
      '',
      baseBody,
      '',
      'Topic: [[Topic - Work]]',
      '',
    ].join('\n')
    insertInsight({
      id: 'ins-alpha123',
      content: 'App changed body.',
      vaultContentHash: stableHash(baseNote),
      vaultBodyHash: hashBody(baseBody),
      vaultSyncedAt: '2026-07-05T10:00:00.000Z',
    })
    const fs = new FakeVaultFs()
    fs.files.set('me.md/Insights/ins-alpha123-base-body.md', baseNote)

    const report = await reconcileVault(db, makeHandle(), {
      ...depsFor(fs),
      ensurePermission: async () => true,
    })

    expect(report.updated).toBe(1)
    const written = Array.from(fs.files.entries())
      .find(([path, content]) => path.startsWith('me.md/Insights/') && content.includes('App changed body.'))
    expect(written?.[1]).toContain('App changed body.')
  })

  it('reconcile vault-wins pulls a changed disk body into the database', async () => {
    const baseBody = 'Base body.'
    const diskNote = [
      '---',
      'title: "Base body"',
      'topic: "Work"',
      'confidence: 86',
      'source: "me.md"',
      'id: "ins-alpha123"',
      '---',
      '',
      'Vault changed body.',
      '',
      'Topic: [[Topic - Work]]',
      '',
    ].join('\n')
    insertInsight({
      id: 'ins-alpha123',
      content: baseBody,
      vaultContentHash: 'old-content-hash',
      vaultBodyHash: hashBody(baseBody),
      vaultSyncedAt: '2026-07-05T10:00:00.000Z',
    })
    const fs = new FakeVaultFs()
    fs.files.set('me.md/Insights/ins-alpha123-base-body.md', diskNote)

    const report = await reconcileVault(db, makeHandle(), depsFor(fs))

    expect(report.pulled).toBe(1)
    const row = db.select().from(insights).where(eq(insights.id, 'ins-alpha123')).get()
    expect(row?.content).toBe('Vault changed body.')
    const history = db.select().from(verificationHistory).where(eq(verificationHistory.insightId, 'ins-alpha123')).all()
    expect(history.map(item => item.action)).toContain('vault_sync')
  })

  it('reconcile stores a conflict and touches neither side when both bodies changed', async () => {
    const baseBody = 'Base body.'
    const diskNote = generatedDiskNote('ins-alpha123', 'Vault changed body.')
    insertInsight({
      id: 'ins-alpha123',
      content: 'App changed body.',
      vaultContentHash: 'old-content-hash',
      vaultBodyHash: hashBody(baseBody),
      vaultSyncedAt: '2026-07-05T10:00:00.000Z',
    })
    const fs = new FakeVaultFs()
    fs.files.set('me.md/Insights/ins-alpha123-app-changed-body.md', diskNote)

    const report = await reconcileVault(db, makeHandle(), depsFor(fs))

    expect(report.conflicts).toBe(1)
    expect(getVaultConflicts()).toMatchObject([{
      insightId: 'ins-alpha123',
      appBody: 'App changed body.',
      vaultBody: 'Vault changed body.',
    }])
    expect(fs.files.get('me.md/Insights/ins-alpha123-app-changed-body.md')).toBe(diskNote)
  })

  it('reconcile recreates a deleted disk note from the database', async () => {
    insertInsight({
      id: 'ins-alpha123',
      content: 'Still verified.',
      vaultContentHash: 'old-content-hash',
      vaultBodyHash: hashBody('Still verified.'),
      vaultSyncedAt: '2026-07-05T10:00:00.000Z',
    })
    const fs = new FakeVaultFs()

    const report = await reconcileVault(db, makeHandle(), depsFor(fs))

    expect(report.recreated).toBe(1)
    expect(Array.from(fs.files.keys()).some(path => path.startsWith('me.md/Insights/'))).toBe(true)
  })

  it('reconcile drains pending writes before comparing notes', async () => {
    insertInsight({ id: 'ins-alpha123', content: 'I prefer crisp project notes.' })
    setPendingVaultWrites(['ins-alpha123'])
    const fs = new FakeVaultFs()

    const report = await reconcileVault(db, makeHandle(), depsFor(fs))

    expect(getPendingVaultWrites()).toEqual([])
    expect(report.deferred).toBe(0)
    expect(Array.from(fs.files.keys()).some(path => path.startsWith('me.md/Insights/'))).toBe(true)
  })

  it('legacy reconcile materializes pending backlog idempotently after partial write failure', async () => {
    for (let index = 0; index < 30; index += 1) {
      insertInsight({
        id: `ins-pending-${index}`,
        content: `Pending body ${index}.`,
        verificationStatus: 'unverified',
        verifiedAt: null,
      })
    }
    const fs = new FakeVaultFs()
    fs.failWritesAfter = 25

    const first = await reconcileVault(db, makeHandle(), depsFor(fs))
    const firstWritten = Array.from(fs.files.keys()).filter(path => path.startsWith('me.md/Pending/'))
    expect(first.materialized).toBe(25)
    expect(firstWritten).toHaveLength(25)
    const firstCounts = new Map(fs.writeCounts)

    fs.failWritesAfter = null
    const second = await reconcileVault(db, makeHandle(), depsFor(fs))

    expect(second.materialized).toBe(5)
    expect(Array.from(fs.files.keys()).filter(path => path.startsWith('me.md/Pending/'))).toHaveLength(30)
    for (const path of firstWritten) {
      expect(fs.writeCounts.get(path)).toBe(firstCounts.get(path))
    }
  })

  it('reconcile applies a Pending to Insights drag as verification and preserves edited vault body', async () => {
    insertInsight({
      id: 'ins-alpha123',
      content: 'Original pending body.',
      verificationStatus: 'unverified',
      vaultBodyHash: hashBody('Original pending body.'),
      vaultSyncedAt: '2026-07-05T10:00:00.000Z',
      verifiedAt: null,
    })
    const fs = new FakeVaultFs()
    const row = getInsightRowForTest('ins-alpha123')
    const pending = generateInsightNote(row, 'pending')
    const edited = pending.note.content.replace('Original pending body.', 'Edited in Obsidian.')
    const approvedPath = pending.note.path.replace('me.md/Pending/', 'me.md/Insights/')
    fs.files.set(approvedPath, edited)

    const report = await reconcileVault(db, makeHandle(), depsFor(fs))

    expect(report.approvedFromVault).toBe(1)
    const updated = db.select().from(insights).where(eq(insights.id, 'ins-alpha123')).get()
    expect(updated?.verificationStatus).toBe('verified')
    expect(updated?.verifiedAt).toBeTruthy()
    expect(updated?.content).toBe('Edited in Obsidian.')
    expect(fs.files.get(approvedPath)).toContain('status: "verified"')
    expect(fs.files.get(approvedPath)).toContain('Edited in Obsidian.')
    const history = db.select().from(verificationHistory).where(eq(verificationHistory.insightId, 'ins-alpha123')).all()
    expect(history.map(item => item.action)).toEqual(expect.arrayContaining(['vault_sync', 'verified']))
  })

  it('reconcile pulls edits from a pending note left in Pending', async () => {
    insertInsight({
      id: 'ins-alpha123',
      content: 'Original pending body.',
      verificationStatus: 'unverified',
      vaultContentHash: 'old-content-hash',
      vaultBodyHash: hashBody('Original pending body.'),
      vaultSyncedAt: '2026-07-05T10:00:00.000Z',
      verifiedAt: null,
    })
    const fs = new FakeVaultFs()
    const pending = generateInsightNote(getInsightRowForTest('ins-alpha123'), 'pending')
    fs.files.set(pending.note.path, pending.note.content.replace('Original pending body.', 'Edited but still pending.'))

    const report = await reconcileVault(db, makeHandle(), depsFor(fs))

    expect(report.pendingPulled).toBe(1)
    const updated = db.select().from(insights).where(eq(insights.id, 'ins-alpha123')).get()
    expect(updated?.verificationStatus).toBe('unverified')
    expect(updated?.content).toBe('Edited but still pending.')
    expect(fs.files.get(pending.note.path)).toContain('status: "pending"')
  })

  it('reconcile applies Pending and Insights drags to Rejected as rejection', async () => {
    insertInsight({ id: 'ins-pending1', content: 'Pending body.', verificationStatus: 'unverified', verifiedAt: null })
    insertInsight({ id: 'ins-verified1', content: 'Verified body.' })
    const fs = new FakeVaultFs()
    for (const [id, status] of [['ins-pending1', 'pending'], ['ins-verified1', 'verified']] as const) {
      const row = getInsightRowForTest(id)
      const note = generateInsightNote(row, status).note
      fs.files.set(note.path.replace(status === 'pending' ? 'me.md/Pending/' : 'me.md/Insights/', 'me.md/Rejected/'), note.content)
    }

    const report = await reconcileVault(db, makeHandle(), depsFor(fs))

    expect(report.rejectedFromVault).toBe(2)
    expect(db.select().from(insights).where(eq(insights.id, 'ins-pending1')).get()?.verificationStatus).toBe('rejected')
    expect(db.select().from(insights).where(eq(insights.id, 'ins-verified1')).get()?.verificationStatus).toBe('rejected')
    expect(db.select().from(insights).where(eq(insights.id, 'ins-verified1')).get()?.vaultSyncedAt).toBeNull()
    for (const content of fs.files.values()) {
      if (content.includes('ins-pending1') || content.includes('ins-verified1')) {
        expect(content).toContain('status: "rejected"')
      }
    }
  })

  it('surfaces a dismissed pending note and resolves it by reject or re-materialize', async () => {
    insertInsight({
      id: 'ins-alpha123',
      content: 'Materialized then removed.',
      verificationStatus: 'unverified',
      vaultContentHash: 'old-content-hash',
      vaultBodyHash: hashBody('Materialized then removed.'),
      vaultSyncedAt: '2026-07-05T10:00:00.000Z',
      verifiedAt: null,
    })
    const fs = new FakeVaultFs()

    const report = await reconcileVault(db, makeHandle(), depsFor(fs))

    expect(report.dismissed).toBe(1)
    const item = getVaultAttention().find(attention => attention.kind === 'dismissed-in-vault')
    expect(item?.insightId).toBe('ins-alpha123')
    expect(db.select().from(insights).where(eq(insights.id, 'ins-alpha123')).get()?.verificationStatus).toBe('unverified')

    await resolveVaultAttention(db, makeHandle(), item!, 're-materialize', depsFor(fs))
    expect(Array.from(fs.files.keys()).some(path => path.startsWith('me.md/Pending/'))).toBe(true)
    expect(getVaultAttention()).toEqual([])

    fs.files.clear()
    await reconcileVault(db, makeHandle(), depsFor(fs))
    const rejectItem = getVaultAttention().find(attention => attention.kind === 'dismissed-in-vault')!
    await resolveVaultAttention(db, makeHandle(), rejectItem, 'confirm-reject', depsFor(fs))
    expect(db.select().from(insights).where(eq(insights.id, 'ins-alpha123')).get()?.verificationStatus).toBe('rejected')
  })

  it('journals duplicate notes, picks Insights over Pending, and leaves the loser untouched', async () => {
    insertInsight({ id: 'ins-alpha123', content: 'Verified body.' })
    const fs = new FakeVaultFs()
    const row = getInsightRowForTest('ins-alpha123')
    const verified = generateInsightNote(row, 'verified').note
    const pending = generateInsightNote(row, 'pending').note
    fs.files.set(verified.path, verified.content)
    fs.files.set(pending.path, pending.content)

    const report = await reconcileVault(db, makeHandle(), depsFor(fs))

    expect(report.attention).toBe(1)
    expect(getVaultJournal().map(entry => entry.outcome)).toContain('duplicate-note')
    expect(getVaultAttention()).toMatchObject([{ insightId: 'ins-alpha123', kind: 'duplicate-note' }])
    expect(fs.files.has(pending.path)).toBe(true)
  })

  it('resolves a backward verified to Pending move by reopening the insight', async () => {
    insertInsight({ id: 'ins-alpha123', content: 'Verified body.' })
    const fs = new FakeVaultFs()
    const row = getInsightRowForTest('ins-alpha123')
    const pending = generateInsightNote(row, 'pending').note
    fs.files.set(pending.path, pending.content)

    const report = await reconcileVault(db, makeHandle(), depsFor(fs))
    expect(report.attention).toBe(1)
    const item = getVaultAttention().find(attention => attention.kind === 'backward-move')!

    await resolveVaultAttention(db, makeHandle(), item, 'apply-move', depsFor(fs))

    const updated = db.select().from(insights).where(eq(insights.id, 'ins-alpha123')).get()
    expect(updated?.verificationStatus).toBe('unverified')
    expect(updated?.verifiedAt).toBeNull()
    expect(fs.files.get(pending.path)).toContain('status: "pending"')
    const history = db.select().from(verificationHistory).where(eq(verificationHistory.insightId, 'ins-alpha123')).all()
    expect(history.map(item => item.action)).toContain('reopened')
  })

  it('app-side approve and reject move a materialized pending note without leaving a stale Pending copy', async () => {
    insertInsight({
      id: 'ins-alpha123',
      content: 'Pending body.',
      verificationStatus: 'unverified',
      vaultBodyHash: hashBody('Pending body.'),
      vaultSyncedAt: '2026-07-05T10:00:00.000Z',
      verifiedAt: null,
    })
    const fs = new FakeVaultFs()
    const row = getInsightRowForTest('ins-alpha123')
    const pending = generateInsightNote(row, 'pending').note
    fs.files.set(pending.path, pending.content)

    db.update(insights).set({ verificationStatus: 'verified', verifiedAt: '2026-07-06T11:00:00.000Z' }).where(eq(insights.id, 'ins-alpha123')).run()
    await runVaultWriteThrough(db, 'ins-alpha123', 'verify', depsFor(fs))

    const insightsPath = Array.from(fs.files.keys()).find(path => path.startsWith('me.md/Insights/') && path.endsWith('.md'))
    expect(insightsPath).toBeDefined()
    expect(fs.files.has(pending.path)).toBe(false)

    db.update(insights).set({ verificationStatus: 'rejected' }).where(eq(insights.id, 'ins-alpha123')).run()
    await runVaultWriteThrough(db, 'ins-alpha123', 'reject', depsFor(fs))

    expect(fs.files.has(insightsPath!)).toBe(false)
    expect(Array.from(fs.files.keys()).some(path => path.startsWith('me.md/Rejected/'))).toBe(true)
  })

  function getInsightRowForTest(id: string) {
    const row = db.select({
      id: insights.id,
      content: insights.content,
      confidenceScore: insights.confidenceScore,
      verifiedAt: insights.verifiedAt,
      updatedAt: insights.updatedAt,
      topicId: insights.topicId,
      topicTitle: schema.topics.title,
    }).from(insights)
      .leftJoin(schema.topics, eq(insights.topicId, schema.topics.id))
      .where(eq(insights.id, id))
      .get()
    if (!row) throw new Error(`Missing test insight ${id}`)
    return row
  }
})

function generatedDiskNote(id: string, body: string): string {
  return [
    '---',
    'title: "Body"',
    'topic: "Work"',
    'confidence: 86',
    'status: "verified"',
    'source: "me.md"',
    `id: "${id}"`,
    '---',
    '',
    body,
    '',
    'Topic: [[Topic - Work]]',
    '',
  ].join('\n')
}

async function waitForMicrotasks(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}
