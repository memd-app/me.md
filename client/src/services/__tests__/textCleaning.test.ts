import { describe, expect, it } from 'vitest'
import { cleanTitle, extractJson, isDeclarativeStatement } from '../textCleaning'

describe('text cleaning service', () => {
  describe('cleanTitle', () => {
    it('strips markdown syntax, emoji, wiki-links, checkboxes, pipes, and frontmatter', () => {
      const raw = [
        '---',
        'title: Raw title',
        '---',
        '- [x] | `About` [[You|your patterns]] ✅',
      ].join('\n')

      expect(cleanTitle(raw, 'Untitled page')).toBe('About your patterns')
    })
  })

  describe('isDeclarativeStatement', () => {
    it('rejects table rows, headings, task lines, and questions', () => {
      expect(isDeclarativeStatement('| `About` | [[You]] |')).toBe(false)
      expect(isDeclarativeStatement('## What does done look like')).toBe(false)
      expect(isDeclarativeStatement('- [ ] Add the lesson to the note')).toBe(false)
      expect(isDeclarativeStatement('_What does done look like?_')).toBe(false)
    })
  })

  describe('extractJson', () => {
    it('extracts fenced JSON arrays from prose-wrapped responses', () => {
      const parsed = extractJson<Array<{ content: string }>>([
        'Here is the result:',
        '```json',
        '[{"content":"Values direct feedback"}]',
        '```',
        'No other changes.',
      ].join('\n'))

      expect(parsed).toEqual([{ content: 'Values direct feedback' }])
    })
  })
})
