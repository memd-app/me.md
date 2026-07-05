import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import initSqlJs from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import * as schema from '@/db/schema'
import { CREATE_TABLES_SQL } from '@/db/database'
import { generateObsidianNotes } from '../obsidianExport'
import {
  SYNC_ROOT_FOLDER,
  assignTitles,
  filterVaultPaths,
  groupByTopFolder,
  isOwnExport,
  isPlaceholderNote,
  isSkippedDirectory,
  stripFrontmatter,
  type VaultNoteFile,
} from '../obsidianImport'

vi.mock('@/db/persistence', () => ({
  scheduleSave: vi.fn(),
}))

describe('obsidian import service', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>

  beforeAll(async () => {
    const SQL = await initSqlJs()
    const sqlDb = new SQL.Database()
    sqlDb.run('PRAGMA foreign_keys = ON;')
    sqlDb.run(CREATE_TABLES_SQL)
    db = drizzle(sqlDb, { schema })
  })

  beforeEach(() => {
    db.run('DELETE FROM assessment_results')
    db.run('DELETE FROM assessment_attempts')
    db.run('DELETE FROM insights')
    db.run('DELETE FROM topics')
    db.run('DELETE FROM users')
    db.run("INSERT OR IGNORE INTO users (id, name) VALUES ('local-user', 'Test User')")
  })

  function note(path: string, name = path.split('/').pop()?.replace(/\.md$/i, '') ?? path): VaultNoteFile {
    return {
      path,
      name,
      size: 100,
      read: () => Promise.resolve('I prefer direct, explicit feedback when working on software projects.'),
    }
  }

  describe('path filtering', () => {
    it('skips hidden directories and the top-level sync folder while keeping markdown notes', () => {
      expect(isSkippedDirectory('.obsidian', true)).toBe(true)
      expect(isSkippedDirectory('.hidden', false)).toBe(true)
      expect(isSkippedDirectory(SYNC_ROOT_FOLDER, true)).toBe(true)
      expect(isSkippedDirectory(SYNC_ROOT_FOLDER, false)).toBe(false)

      expect(filterVaultPaths([
        'Notes/idea.md',
        'root-note.md',
        'me.md/Insights/ins-abc.md',
        'Projects/me.md/note.md',
        '.obsidian/app.json',
        '.trash/old.md',
        'Daily/.hidden/x.md',
        '.secret.md',
        'image.png',
        'doc.MD',
      ])).toEqual([
        'Notes/idea.md',
        'root-note.md',
        'Projects/me.md/note.md',
        'doc.MD',
      ])
    })
  })

  it('keeps the import sync root constant aligned with Obsidian export', () => {
    expect(generateObsidianNotes(db).rootFolder).toBe(SYNC_ROOT_FOLDER)
  })

  describe('stripFrontmatter', () => {
    it('strips normal YAML frontmatter and preserves body content after the closing fence', () => {
      expect(stripFrontmatter('---\ntitle: Test\n---\n# Heading\nBody')).toEqual({
        frontmatter: 'title: Test',
        body: '# Heading\nBody',
      })
    })

    it('handles CRLF fences', () => {
      expect(stripFrontmatter('---\r\nsource: me.md\r\n---\r\nBody\r\n')).toEqual({
        frontmatter: 'source: me.md',
        body: 'Body\r\n',
      })
    })

    it('treats an unclosed fence as ordinary body text', () => {
      const raw = '---\ntitle: Missing close\nBody'
      expect(stripFrontmatter(raw)).toEqual({ frontmatter: null, body: raw })
    })

    it('supports an ellipsis closing fence', () => {
      expect(stripFrontmatter('---\ntitle: Test\n...\nBody')).toEqual({
        frontmatter: 'title: Test',
        body: 'Body',
      })
    })

    it('returns an empty body when the note only contains frontmatter', () => {
      expect(stripFrontmatter('---\ntitle: Test\n---')).toEqual({
        frontmatter: 'title: Test',
        body: '',
      })
    })
  })

  describe('isOwnExport', () => {
    it('detects me.md source frontmatter', () => {
      expect(isOwnExport('title: Test\nsource: "me.md"')).toBe(true)
      expect(isOwnExport('title: Test\nsource: me.md')).toBe(true)
      expect(isOwnExport(null)).toBe(false)
      expect(isOwnExport('source: other.md')).toBe(false)
    })
  })

  describe('isPlaceholderNote', () => {
    it('skips empty, heading-only, short, and template-heavy notes', () => {
      expect(isPlaceholderNote('')).toBe(true)
      expect(isPlaceholderNote(' \n\t ')).toBe(true)
      expect(isPlaceholderNote('# Heading\n## Follow-up\n---')).toBe(true)
      expect(isPlaceholderNote('a'.repeat(39))).toBe(true)
      expect(isPlaceholderNote([
        '- {{date}}',
        '- <% tp.file.title %>',
        '- {{time}} <% tp.user.name %>',
        'A short real line',
      ].join('\n'))).toBe(true)
    })

    it('keeps substantive notes even when they contain an occasional template token', () => {
      expect(isPlaceholderNote('I prefer systems that explain tradeoffs clearly. '.repeat(5))).toBe(false)
      // Terse atomic/Zettelkasten notes above the 40-char floor must survive.
      expect(isPlaceholderNote('Direct feedback beats diplomatic hedging.')).toBe(false)
      expect(isPlaceholderNote([
        'I use weekly planning notes to track important decisions and tradeoffs.',
        'I prefer concise summaries before detailed execution notes.',
        '{{tag}}',
        'I revisit old assumptions when a project changes direction.',
        'I write implementation notes that can survive context changes.',
        'I keep verification commands close to the work they validate.',
      ].join('\n'))).toBe(false)
    })
  })

  it('groups notes by top folder with the vault root first', () => {
    const groups = groupByTopFolder([
      note('Zeta/later.md'),
      note('root-note.md'),
      note('Alpha/first.md'),
      note('Alpha/second.md'),
    ])

    expect(groups.map(group => ({
      folder: group.folder,
      paths: group.files.map(file => file.path),
    }))).toEqual([
      { folder: '', paths: ['root-note.md'] },
      { folder: 'Alpha', paths: ['Alpha/first.md', 'Alpha/second.md'] },
      { folder: 'Zeta', paths: ['Zeta/later.md'] },
    ])
  })

  it('disambiguates duplicate basenames by using the relative path without extension', () => {
    const files = [
      note('Projects/Ideas.md', 'Ideas'),
      note('Archive/Ideas.md', 'Ideas'),
      note('Daily/Today.md', 'Today'),
    ]

    expect(assignTitles(files)).toEqual(new Map([
      ['Projects/Ideas.md', 'Projects/Ideas'],
      ['Archive/Ideas.md', 'Archive/Ideas'],
      ['Daily/Today.md', 'Today'],
    ]))
  })
})
