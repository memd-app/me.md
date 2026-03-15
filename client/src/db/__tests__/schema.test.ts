import { describe, it, expect } from 'vitest'
import * as schema from '../schema'

describe('database schema', () => {
  it('exports all required tables', () => {
    const requiredTables = [
      'users', 'topics', 'sessions', 'messages', 'notes',
      'insights', 'verificationHistory', 'conceptNodes', 'conceptEdges',
      'topicConnections', 'useCaseTemplates', 'bookmarks',
      'insightConflicts', 'importedFiles', 'assessmentAttempts',
      'assessmentAnswers', 'assessmentResults', 'mcpAccessPermissions',
    ]
    for (const table of requiredTables) {
      expect(schema).toHaveProperty(table)
    }
  })

  it('does NOT export auth-only tables', () => {
    expect(schema).not.toHaveProperty('passwordResetTokens')
    expect(schema).not.toHaveProperty('sessionTokens')
    expect(schema).not.toHaveProperty('waitlistSignups')
  })

  it('users table has no firebaseUid or passwordHash columns', () => {
    const columns = Object.keys(schema.users)
    expect(columns).not.toContain('firebaseUid')
    expect(columns).not.toContain('passwordHash')
  })
})
