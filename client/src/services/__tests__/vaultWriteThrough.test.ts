import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import * as schema from '@/db/schema'
import { CREATE_TABLES_SQL } from '@/db/database'
import { insights, verificationHistory } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { stableHash } from '../obsidianExport'
import { hashBody } from '../vaultReconcile'
import type { VaultFs } from '../vaultFs'
import {
  clearVaultStateForTests,
  getPendingVaultWrites,
  getVaultConflicts,
  getVaultJournal,
  reconcileVault,
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

  async read(path: string): Promise<string | null> {
    this.record(path)
    return this.files.get(path) ?? null
  }

  async write(path: string, content: string): Promise<void> {
    this.record(path)
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
        '2026-07-05T10:00:00.000Z',
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
})

function generatedDiskNote(id: string, body: string): string {
  return [
    '---',
    'title: "Body"',
    'topic: "Work"',
    'confidence: 86',
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
