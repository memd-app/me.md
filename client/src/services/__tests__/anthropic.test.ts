import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callAnthropic } from '../anthropic'

describe('anthropic client', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue('test-api-key'),
      setItem: vi.fn(),
    })
  })

  it('sends correct headers and body for non-streaming call', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: 'Hello!' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await callAnthropic({
      messages: [{ role: 'user', content: 'Hi' }],
      system: 'You are helpful.',
    })

    expect(result).toBe('Hello!')
    expect(mockFetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'x-api-key': 'test-api-key',
        'anthropic-version': '2023-06-01',
      }),
    }))
  })

  it('throws AnthropicError when API key is missing', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
    })

    await expect(callAnthropic({
      messages: [{ role: 'user', content: 'Hi' }],
    })).rejects.toThrow('API key not configured')
  })
})
