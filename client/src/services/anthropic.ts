const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'
const DEFAULT_MODEL = 'claude-sonnet-5'

export class AnthropicError extends Error {
  constructor(
    message: string,
    public status?: number,
    public type?: string
  ) {
    super(message)
    this.name = 'AnthropicError'
  }
}

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string
}

interface CallOptions {
  messages: AnthropicMessage[]
  system?: string
  model?: string
  maxTokens?: number
  signal?: AbortSignal
}

function getApiKey(): string {
  const key = localStorage.getItem('memd_api_key')
  if (!key) throw new AnthropicError('API key not configured. Set it in Settings.')
  return key
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
    // Opts into CORS on api.anthropic.com — required for direct browser
    // calls. The key is user-supplied and stored in localStorage, so the
    // usual shared-secret concern doesn't apply, but it is still readable
    // by anything with access to this origin (extensions, DevTools).
    'anthropic-dangerous-direct-browser-access': 'true',
  }
}

function buildBody(options: CallOptions, stream = false): string {
  const model = options.model ?? DEFAULT_MODEL
  // Sonnet 5 runs adaptive thinking by default, which would eat into the
  // small max_tokens budgets used here; keep the pre-migration behavior.
  // Fable/Mythos-class models reject an explicit "disabled", so omit it there.
  const supportsDisabledThinking = !/fable|mythos/.test(model)
  return JSON.stringify({
    model,
    max_tokens: options.maxTokens ?? 1024,
    ...(supportsDisabledThinking ? { thinking: { type: 'disabled' } } : {}),
    system: options.system,
    messages: options.messages,
    stream,
  })
}

export async function callAnthropic(options: CallOptions): Promise<string> {
  const apiKey = getApiKey()
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: buildBody(options),
    signal: options.signal,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new AnthropicError(
      body.error?.message ?? `API error ${res.status}`,
      res.status,
      body.error?.type,
    )
  }

  const data = await res.json()
  const textBlocks = data.content?.filter((b: any) => b.type === 'text') ?? []
  return textBlocks.map((b: any) => b.text).join('\n\n')
}

export async function* streamAnthropic(
  options: CallOptions
): AsyncGenerator<string, string, undefined> {
  const apiKey = getApiKey()
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: buildBody(options, true),
    signal: options.signal,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new AnthropicError(
      body.error?.message ?? `API error ${res.status}`,
      res.status,
      body.error?.type,
    )
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue

      try {
        const event = JSON.parse(data)
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const chunk = event.delta.text
          fullText += chunk
          yield chunk
        } else if (event.type === 'error') {
          // Mid-stream API errors (e.g. overloaded_error) must not be
          // silently swallowed as a successful-but-truncated response.
          throw new AnthropicError(
            event.error?.message ?? 'Stream error',
            undefined,
            event.error?.type,
          )
        }
      } catch (err) {
        if (err instanceof AnthropicError) throw err
        // Skip non-JSON lines
      }
    }
  }

  return fullText
}

export function isApiKeyConfigured(): boolean {
  const key = localStorage.getItem('memd_api_key')
  return !!key && key.trim() !== ''
}
