import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useDatabase } from '@/contexts/DatabaseContext'
import { isAIAvailable } from '@/services/ai'
import {
  type ChatMode,
  type ChatMessage,
  buildChatContext,
  streamChatResponse,
} from '@/services/chat'
import { PageHeader, EmptyState } from '@/components/ui'

// Pure render function for message content (bold + newlines) - copied locally from SessionPage.
function renderMessageContent(content: string) {
  const parts = content.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return part.split('\n').map((line, j, arr) => (
      <span key={`${i}-${j}`}>
        {line}
        {j < arr.length - 1 && <br />}
      </span>
    ))
  })
}

function MessageEntry({
  marker,
  role,
  mode,
  content,
}: {
  marker: string
  role: ChatMessage['role']
  mode: ChatMode
  content: string
}) {
  const isUser = role === 'user'
  const speaker = isUser ? 'YOU' : mode === 'assistant' ? 'ASSISTANT' : 'ME'

  return (
    <div
      className="group flex gap-4"
      role="article"
      aria-label={`${isUser ? 'Your' : speaker} message`}
    >
      <span
        className="w-7 shrink-0 pt-1 text-right font-sans text-[11px] tabular-nums text-gray-400 dark:text-gray-600 select-none"
        aria-hidden="true"
      >
        {marker}
      </span>
      <div className="flex-1 min-w-0">
        <div
          className={`text-[11px] uppercase tracking-[0.08em] font-medium font-sans mb-1.5 ${
            isUser ? 'text-gray-500 dark:text-gray-400' : 'text-primary-600 dark:text-primary-400'
          }`}
        >
          {speaker}
        </div>
        <div
          className={`font-serif text-[17px] leading-[1.7] break-words ${
            isUser ? 'text-ink dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'
          }`}
        >
          {renderMessageContent(content)}
        </div>
      </div>
    </div>
  )
}

export default function ChatPage() {
  const db = useDatabase()
  const [mode, setMode] = useState<ChatMode>('assistant')
  // Per-mode histories, kept in component state. NO DB persistence in v1 (future work).
  const [histories, setHistories] = useState<Record<ChatMode, ChatMessage[]>>({ assistant: [], me: [] })
  const [inputValue, setInputValue] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // FUTURE WORK: refresh this when verified insights change without requiring a reload.
  const context = useMemo(() => buildChatContext(db), [db])
  const messages = histories[mode]

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort()
    }
  }, [])

  const send = useCallback(async () => {
    const content = inputValue.trim()
    if (!content || isStreaming) return
    setError(null)
    setInputValue('')

    const userMsg: ChatMessage = { role: 'user', content }
    const nextHistory = [...histories[mode], userMsg]
    setHistories((prev) => ({ ...prev, [mode]: nextHistory }))

    const controller = new AbortController()
    streamAbortRef.current = controller
    setIsStreaming(true)
    setStreamingContent('')

    let acc = ''
    try {
      for await (const chunk of streamChatResponse(mode, context.text, nextHistory, controller.signal)) {
        acc += chunk
        setStreamingContent(acc)
      }
      if (acc.trim().length === 0) throw new Error('empty')
      setHistories((prev) => ({ ...prev, [mode]: [...prev[mode], { role: 'assistant', content: acc }] }))
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled by leaving the page; keep the user message and suppress the banner.
      } else {
        setError('Something went wrong generating the reply. Your message is kept — try again.')
      }
    } finally {
      setIsStreaming(false)
      setStreamingContent('')
      streamAbortRef.current = null
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [inputValue, isStreaming, histories, mode, context.text])

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    send()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const autoGrow = (e: FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement
    target.style.height = 'auto'
    target.style.height = Math.min(target.scrollHeight, 128) + 'px'
  }

  const header = (
    <PageHeader
      kicker="Converse"
      title="Talk with your knowledge"
      subtitle={
        mode === 'assistant'
          ? <>An assistant that knows you, grounded in your verified insights.</>
          : <>Your own voice, reflected back from what you've verified.</>
      }
    />
  )

  if (!isAIAvailable()) {
    return (
      <div className="max-w-3xl mx-auto flex flex-col h-full">
        {header}
        <EmptyState
          kicker="Converse"
          message={<>Add your Anthropic API key to start a conversation with your verified knowledge.</>}
          action={<Link to="/app/settings" className="btn-primary inline-block">Go to Settings</Link>}
        />
      </div>
    )
  }

  if (!context.hasVerifiedData) {
    return (
      <div className="max-w-3xl mx-auto flex flex-col h-full">
        {header}
        <EmptyState
          kicker="Converse"
          message={<>You don't have any verified knowledge yet. Verify a few insights and they'll ground this conversation.</>}
          action={<Link to="/app/review" className="btn-primary inline-block">Go to Review</Link>}
        />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col h-full">
      {header}

      <nav
        className="flex items-center gap-6 border-b border-rule dark:border-dark-border mb-6"
        role="tablist"
        aria-label="Conversation mode"
      >
        {(['assistant', 'me'] as ChatMode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            disabled={isStreaming}
            onClick={() => { setError(null); setMode(m); }}
            className={`-mb-px pb-2 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold border-b-2 transition-colors ${
              mode === m
                ? 'text-primary-600 dark:text-primary-400 border-primary-500 dark:border-primary-400'
                : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-ink dark:hover:text-gray-100'
            }`}
          >
            {m === 'assistant' ? 'Assistant' : 'Me'}
          </button>
        ))}
      </nav>

      {context.truncated && (
        <p className="text-[11px] text-gray-400 dark:text-gray-600 font-sans mb-4">
          Your verified knowledge is large; this conversation uses the first portion of it.
        </p>
      )}

      {error && (
        <div
          className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm"
          role="alert"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-600 dark:hover:text-red-300 ml-2 shrink-0 focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
              title="Dismiss"
              aria-label="Dismiss error message"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div
        role="log"
        aria-label="Conversation transcript"
        aria-live="polite"
        className="flex-1 overflow-y-auto space-y-7"
      >
        {messages.length === 0 && !isStreaming && (
          <EmptyState
            className="min-h-full"
            message={
              mode === 'assistant'
                ? <>Ask me anything about what you've verified.</>
                : <>Ask yourself something.</>
            }
          />
        )}

        {messages.map((message, index) => (
          <MessageEntry
            key={`${message.role}-${index}`}
            marker={String(index + 1).padStart(2, '0')}
            role={message.role}
            mode={mode}
            content={message.content}
          />
        ))}

        {isStreaming && streamingContent && (
          <div className="flex gap-4" aria-live="polite" aria-label="Converse is responding">
            <span
              className="w-7 shrink-0 pt-1 text-right font-sans text-[11px] tabular-nums text-gray-400 dark:text-gray-600 select-none"
              aria-hidden="true"
            >
              ··
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-[0.08em] font-medium font-sans text-primary-600 dark:text-primary-400 mb-1.5">
                {mode === 'assistant' ? 'ASSISTANT' : 'ME'}
              </div>
              <div className="font-serif text-[17px] leading-[1.7] text-gray-700 dark:text-gray-300 break-words">
                {renderMessageContent(streamingContent)}
                <span className="inline-block w-1.5 h-4 bg-primary-500 dark:bg-primary-400 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
              </div>
            </div>
          </div>
        )}

        <div ref={transcriptEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex items-end gap-2 sm:gap-3 border-t border-rule dark:border-dark-border pt-4 shrink-0">
        <div className="flex-1">
          <label htmlFor="chat-input" className="sr-only">Type your message</label>
          <textarea
            id="chat-input"
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Take your time…"
            rows={1}
            className="input-field resize-none min-h-[44px] max-h-32 py-2.5 pr-3 font-serif text-[16px] placeholder:italic placeholder:font-serif"
            onInput={autoGrow}
            disabled={isStreaming}
          />
        </div>
        <button
          type="submit"
          disabled={!inputValue.trim() || isStreaming}
          className="btn-primary flex items-center justify-center w-11 h-11 !p-0 shrink-0 !rounded-full focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
          title="Send message"
          aria-label="Send message"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </form>
      <p className="text-xs text-gray-500 dark:text-gray-300 mt-2 text-center">
        Press Enter to send, Shift+Enter for new line
      </p>
    </div>
  )
}
