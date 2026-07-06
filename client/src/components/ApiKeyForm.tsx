import { useEffect, useState } from 'react'
import { useUser } from '@/contexts/UserContext'
import { callAnthropic } from '@/services/anthropic'
import { Button } from '@/components/ui'

function StatusLine({ status }: { status: { type: 'success' | 'error'; message: string } | null }) {
  if (!status) return null
  return (
    <p
      role="status"
      className={`mb-4 text-sm ${
        status.type === 'success' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300'
      }`}
    >
      {status.message}
    </p>
  )
}

interface ApiKeyFormProps {
  idPrefix?: string
  className?: string
}

export default function ApiKeyForm({ idPrefix = 'api-key', className = '' }: ApiKeyFormProps) {
  const { getApiKey, setApiKey } = useUser()
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [apiKeyStatus, setApiKeyStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [testingKey, setTestingKey] = useState(false)

  useEffect(() => {
    const existing = getApiKey()
    if (existing) setApiKeyInput(existing)
  }, [getApiKey])

  const handleSaveApiKey = () => {
    const trimmed = apiKeyInput.trim()
    if (!trimmed) {
      setApiKeyStatus({ type: 'error', message: 'Enter an Anthropic API key first.' })
      return
    }
    setApiKey(trimmed)
    setApiKeyStatus({ type: 'success', message: 'Anthropic API key saved in this browser.' })
    setTimeout(() => setApiKeyStatus(null), 3000)
  }

  const handleClearApiKey = () => {
    localStorage.removeItem('memd_api_key')
    setApiKeyInput('')
    setApiKeyStatus({ type: 'success', message: 'Anthropic API key removed.' })
    setTimeout(() => setApiKeyStatus(null), 3000)
  }

  const handleTestApiKey = async () => {
    const trimmed = apiKeyInput.trim()
    if (!trimmed) {
      setApiKeyStatus({ type: 'error', message: 'Save an Anthropic API key first.' })
      return
    }
    setApiKey(trimmed)
    setTestingKey(true)
    setApiKeyStatus(null)
    try {
      await callAnthropic({
        messages: [{ role: 'user', content: 'Reply with "API key works" in three words or fewer.' }],
        maxTokens: 20,
      })
      setApiKeyStatus({ type: 'success', message: 'Anthropic API key is valid.' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'API call failed'
      setApiKeyStatus({ type: 'error', message: `API key test failed: ${message}` })
    } finally {
      setTestingKey(false)
    }
  }

  return (
    <div className={`space-y-4 max-w-lg ${className}`}>
      <StatusLine status={apiKeyStatus} />

      <div>
        <label htmlFor={`${idPrefix}-input`} className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
          API key
        </label>
        <input
          id={`${idPrefix}-input`}
          type="password"
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
          placeholder="sk-ant-..."
          className="input-field w-full"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveApiKey()
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={handleSaveApiKey}>Save key</Button>
        <Button variant="secondary" onClick={handleTestApiKey} loading={testingKey}>
          {testingKey ? 'Testing…' : 'Test API key'}
        </Button>
        <button
          onClick={handleClearApiKey}
          className="text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-ink dark:hover:text-gray-100 transition-colors"
        >
          Clear key
        </button>
      </div>
    </div>
  )
}
