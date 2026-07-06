import { describe, expect, it } from 'vitest'
import { computeNextActive, resolveTriageIntent, type KeyGuardContext } from '../reviewKeyboard'

const allowedContext: KeyGuardContext = {
  key: 'ArrowRight',
  hasActiveCard: true,
  isEditing: false,
  isConfirmOpen: false,
  isBulkRunning: false,
  targetIsFormField: false,
}

describe('review keyboard triage', () => {
  describe('resolveTriageIntent', () => {
    it('maps arrows to triage intents when all guards pass', () => {
      expect(resolveTriageIntent({ ...allowedContext, key: 'ArrowRight' })).toBe('approve')
      expect(resolveTriageIntent({ ...allowedContext, key: 'ArrowLeft' })).toBe('reject')
      expect(resolveTriageIntent({ ...allowedContext, key: 'ArrowUp' })).toBe('edit')
      expect(resolveTriageIntent({ ...allowedContext, key: 'ArrowDown' })).toBe('next')
    })

    it('ignores keys when any guard blocks triage', () => {
      expect(resolveTriageIntent({ ...allowedContext, hasActiveCard: false })).toBeNull()
      expect(resolveTriageIntent({ ...allowedContext, isEditing: true })).toBeNull()
      expect(resolveTriageIntent({ ...allowedContext, isConfirmOpen: true })).toBeNull()
      expect(resolveTriageIntent({ ...allowedContext, isBulkRunning: true })).toBeNull()
      expect(resolveTriageIntent({ ...allowedContext, targetIsFormField: true })).toBeNull()
    })

    it('leaves non-triage keys to native behavior', () => {
      for (const key of ['PageUp', ' ', 'Tab', 'a', 'Home', 'End']) {
        expect(resolveTriageIntent({ ...allowedContext, key })).toBeNull()
      }
    })
  })

  describe('computeNextActive', () => {
    it('moves removal actions to the next sibling', () => {
      expect(computeNextActive(['a', 'b', 'c'], 'b', 'approve')).toBe('c')
      expect(computeNextActive(['a', 'b', 'c'], 'b', 'reject')).toBe('c')
      expect(computeNextActive(['a', 'b', 'c'], 'b', 'remove')).toBe('c')
    })

    it('moves removal from the last item to the new last item', () => {
      expect(computeNextActive(['a', 'b', 'c'], 'c', 'approve')).toBe('b')
    })

    it('returns null when the only item is removed', () => {
      expect(computeNextActive(['a'], 'a', 'reject')).toBeNull()
    })

    it('moves next to the following item and clamps at the end', () => {
      expect(computeNextActive(['a', 'b', 'c'], 'a', 'next')).toBe('b')
      expect(computeNextActive(['a', 'b', 'c'], 'c', 'next')).toBe('c')
    })

    it('keeps the active id unchanged for edit', () => {
      expect(computeNextActive(['a', 'b'], 'a', 'edit')).toBe('a')
    })

    it('treats an absent active id as absent', () => {
      expect(computeNextActive(['a', 'b'], 'missing', 'next')).toBe('a')
      expect(computeNextActive(['a', 'b'], 'missing', 'remove')).toBe('a')
      expect(computeNextActive([], 'missing', 'next')).toBeNull()
      expect(computeNextActive([], 'missing', 'remove')).toBeNull()
    })
  })
})
