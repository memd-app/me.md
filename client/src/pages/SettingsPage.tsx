import { useState, useRef, useCallback, useMemo } from 'react'
import { useUser } from '@/contexts/UserContext'
import { useDatabase } from '@/contexts/DatabaseContext'
import { useTheme } from '@/contexts/ThemeContext'
import { downloadDatabase, downloadForMCP, importDatabaseFile } from '@/db/persistence'
import { callAnthropic } from '@/services/anthropic'
import { formatFullDate } from '@/utils/dateFormat'
import { getAllInsights, editInsight } from '@/services/insights'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'

// ============================================
// Privacy Tab Component
// ============================================
interface PrivacyInsightItem {
  id: string
  content: string
  privacyTier: string
  verificationStatus: string
  topicTitle: string | null
  confidenceScore: number | null
}

function PrivacyTab() {
  const db = useDatabase()
  const { user } = useUser()
  const [insights, setInsights] = useState<PrivacyInsightItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [filter, setFilter] = useState<'all' | 'exportable' | 'never_export'>('all')
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const loadInsights = useCallback(async () => {
    if (!user?.id || loaded) return
    setLoading(true)
    try {
      const result = getAllInsights(db, 'verified')
      const verified = result.insights
        .map((i: any) => ({
          id: i.id,
          content: i.content,
          privacyTier: i.privacyTier || 'exportable',
          verificationStatus: i.verificationStatus,
          topicTitle: i.topicTitle || null,
          confidenceScore: i.confidenceScore,
        }))
      setInsights(verified)
      setLoaded(true)
    } catch (err) {
      console.error('Failed to load insights for privacy:', err)
    } finally {
      setLoading(false)
    }
  }, [db, user?.id, loaded])

  // Load on first render
  if (!loaded && !loading) {
    loadInsights()
  }

  const togglePrivacyTier = async (insightId: string, currentTier: string) => {
    const newTier = currentTier === 'exportable' ? 'never_export' : 'exportable'
    setTogglingId(insightId)
    setStatus(null)
    try {
      await editInsight(db, insightId, { privacyTier: newTier })
      setInsights(prev => prev.map(i =>
        i.id === insightId ? { ...i, privacyTier: newTier } : i
      ))
      setStatus({
        type: 'success',
        message: `Insight marked as "${newTier === 'never_export' ? 'Never Export' : 'Exportable'}"`,
      })
      setTimeout(() => setStatus(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update'
      setStatus({ type: 'error', message })
    } finally {
      setTogglingId(null)
    }
  }

  const filteredInsights = filter === 'all'
    ? insights
    : insights.filter(i => i.privacyTier === filter)

  const exportableCount = insights.filter(i => i.privacyTier === 'exportable').length
  const neverExportCount = insights.filter(i => i.privacyTier === 'never_export').length

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Privacy Settings</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          Control which verified insights are included in exports. Items marked as &quot;Never Export&quot; will be
          excluded from all export formats, MCP access, and profile sharing.
        </p>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{insights.length}</p>
            <p className="text-xs text-gray-500 dark:text-gray-300">Total Verified</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-green-700 dark:text-green-300">{exportableCount}</p>
            <p className="text-xs text-green-600 dark:text-green-400">Exportable</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{neverExportCount}</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">Never Export</p>
          </div>
        </div>

        {/* Status message */}
        {status && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${
            status.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
          }`}>
            {status.message}
          </div>
        )}

        {/* Filter buttons */}
        <div className="flex gap-2 mb-4">
          {(['all', 'exportable', 'never_export'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === f
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {f === 'all' ? `All (${insights.length})` :
               f === 'exportable' ? `Exportable (${exportableCount})` :
               `Never Export (${neverExportCount})`}
            </button>
          ))}
        </div>

        {/* Insights list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse flex items-center gap-3 py-3">
                <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-6 w-12 bg-gray-200 dark:bg-gray-700 rounded-full flex-shrink-0" />
              </div>
            ))}
          </div>
        ) : filteredInsights.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-300">
              {insights.length === 0
                ? 'No verified insights yet. Verify insights to manage their privacy settings.'
                : 'No insights match this filter.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-dark-border">
            {filteredInsights.map((insight) => (
              <div key={insight.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 dark:text-gray-100 line-clamp-2">
                      {insight.content}
                    </p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-300">
                      {insight.topicTitle && <span>Topic: {insight.topicTitle}</span>}
                      {insight.confidenceScore != null && <span>Confidence: {insight.confidenceScore}%</span>}
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                        insight.privacyTier === 'never_export'
                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                          : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                      }`}>
                        {insight.privacyTier === 'never_export' ? 'Never Export' : 'Exportable'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => togglePrivacyTier(insight.id, insight.privacyTier)}
                    disabled={togglingId === insight.id}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                      insight.privacyTier === 'exportable' ? 'bg-green-500' : 'bg-amber-500'
                    } ${togglingId === insight.id ? 'opacity-50' : ''}`}
                    role="switch"
                    aria-checked={insight.privacyTier === 'exportable'}
                    title={insight.privacyTier === 'exportable' ? 'Click to mark as Never Export' : 'Click to mark as Exportable'}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        insight.privacyTier === 'exportable' ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Export exclusion info */}
      <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
        <p className="text-sm text-amber-800 dark:text-amber-200">
          <strong>How it works:</strong> Items marked as &quot;Never Export&quot; are automatically excluded from:
          profile exports (Markdown and JSON), clipboard copy, MCP tool access, and the context testing sandbox.
          Only verified insights with the &quot;Exportable&quot; tier are shared.
        </p>
      </div>
    </div>
  )
}

// ============================================
// Profile fields config
// ============================================
interface EditableField {
  key: 'name' | 'email' | 'dateOfBirth' | 'location' | 'occupation' | 'gender'
  label: string
  type?: string
}

const PROFILE_FIELDS: EditableField[] = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'dateOfBirth', label: 'Date of Birth', type: 'date' },
  { key: 'location', label: 'Location' },
  { key: 'occupation', label: 'Occupation' },
  { key: 'gender', label: 'Gender' },
]

// ============================================
// Main Settings Page
// ============================================
export default function SettingsPage() {
  const { user, updateUser, getApiKey, setApiKey } = useUser()
  const { theme, setTheme } = useTheme()
  const [activeTab, setActiveTab] = useState('profile')

  // Profile editing state
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // API key state
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false)
  const [apiKeyStatus, setApiKeyStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [testingKey, setTestingKey] = useState(false)

  // Database state
  const [dbStatus, setDbStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Session length
  const [sessionLength, setSessionLength] = useState<number>(user?.sessionLengthDefault ?? 15)

  const tabs = [
    { id: 'profile', label: 'Profile' },
    { id: 'apikey', label: 'API Key' },
    { id: 'database', label: 'Database' },
    { id: 'preferences', label: 'Preferences' },
    { id: 'privacy', label: 'Privacy' },
  ]

  // Load API key on tab switch
  if (activeTab === 'apikey' && !apiKeyLoaded) {
    const existing = getApiKey()
    if (existing) setApiKeyInput(existing)
    setApiKeyLoaded(true)
  }

  // Track unsaved changes
  const isDirty = useMemo(() => {
    if (editingField !== null && editValue.trim() !== '') return true
    return false
  }, [editingField, editValue])

  useUnsavedChangesWarning(isDirty)

  // ---- Profile helpers ----

  const startEditing = (field: string, currentValue: string) => {
    setEditingField(field)
    setEditValue(currentValue || '')
    setSaveStatus(null)
  }

  const cancelEditing = () => {
    setEditingField(null)
    setEditValue('')
  }

  const saveField = (fieldKey: string) => {
    if (!user) return
    const trimmed = editValue.trim()
    updateUser({ [fieldKey]: trimmed || null })
    setEditingField(null)
    setEditValue('')

    const fieldLabel = PROFILE_FIELDS.find(f => f.key === fieldKey)?.label || fieldKey
    setSaveStatus({ type: 'success', message: `${fieldLabel} updated successfully` })
    setTimeout(() => setSaveStatus(null), 3000)
  }

  const formatDisplayValue = (field: EditableField, value: string | null | undefined): string => {
    if (!value || value === 'Unknown' || value === 'unspecified') return 'Not set'
    if (field.key === 'dateOfBirth') {
      const formatted = formatFullDate(value + 'T00:00:00')
      return formatted || value
    }
    if (field.key === 'gender') {
      return value.charAt(0).toUpperCase() + value.slice(1)
    }
    return value
  }

  // ---- API Key helpers ----

  const handleSaveApiKey = () => {
    const trimmed = apiKeyInput.trim()
    if (!trimmed) {
      setApiKeyStatus({ type: 'error', message: 'Please enter an API key' })
      return
    }
    setApiKey(trimmed)
    setApiKeyStatus({ type: 'success', message: 'API key saved to localStorage' })
    setTimeout(() => setApiKeyStatus(null), 3000)
  }

  const handleClearApiKey = () => {
    localStorage.removeItem('memd_api_key')
    setApiKeyInput('')
    setApiKeyStatus({ type: 'success', message: 'API key removed' })
    setTimeout(() => setApiKeyStatus(null), 3000)
  }

  const handleTestApiKey = async () => {
    const trimmed = apiKeyInput.trim()
    if (!trimmed) {
      setApiKeyStatus({ type: 'error', message: 'Save an API key first' })
      return
    }
    // Ensure the key is saved before testing
    setApiKey(trimmed)
    setTestingKey(true)
    setApiKeyStatus(null)
    try {
      const result = await callAnthropic({
        messages: [{ role: 'user', content: 'Say "API key works!" in 3 words or less.' }],
        maxTokens: 20,
      })
      setApiKeyStatus({ type: 'success', message: `API key is valid. Response: "${result}"` })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'API call failed'
      setApiKeyStatus({ type: 'error', message: `API key test failed: ${message}` })
    } finally {
      setTestingKey(false)
    }
  }

  // ---- Database helpers ----

  const handleExportDb = () => {
    try {
      downloadDatabase()
      setDbStatus({ type: 'success', message: 'Database exported as memd-backup.db' })
      setTimeout(() => setDbStatus(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed'
      setDbStatus({ type: 'error', message })
    }
  }

  const handleExportForMCP = () => {
    try {
      downloadForMCP()
      setDbStatus({ type: 'success', message: 'Database exported as memd.db for MCP server' })
      setTimeout(() => setDbStatus(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed'
      setDbStatus({ type: 'error', message })
    }
  }

  const handleImportDb = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setDbStatus(null)
    try {
      await importDatabaseFile(file)
      setDbStatus({ type: 'success', message: 'Database imported. Reloading page to apply changes...' })
      // Reload to reinitialize the database from IndexedDB
      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      setDbStatus({ type: 'error', message })
      setImporting(false)
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleClearAllData = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to clear ALL data? This will delete your entire database including all topics, sessions, insights, and settings. This action cannot be undone.'
    )
    if (!confirmed) return

    const doubleConfirm = window.confirm(
      'This is your last chance. All data will be permanently deleted. Continue?'
    )
    if (!doubleConfirm) return

    try {
      // Clear IndexedDB
      const DB_STORE = 'memd_store'
      const req = indexedDB.deleteDatabase(DB_STORE)
      req.onsuccess = () => {
        // Clear localStorage items
        localStorage.removeItem('memd_api_key')
        localStorage.removeItem('memd_theme')
        setDbStatus({ type: 'success', message: 'All data cleared. Reloading...' })
        setTimeout(() => window.location.reload(), 1000)
      }
      req.onerror = () => {
        setDbStatus({ type: 'error', message: 'Failed to clear database' })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to clear data'
      setDbStatus({ type: 'error', message })
    }
  }

  // ---- Preferences helpers ----

  const handleSessionLengthChange = (newLength: number) => {
    setSessionLength(newLength)
    updateUser({ sessionLengthDefault: newLength })
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-300">
          Manage your profile, API key, database, and preferences
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-dark-border mb-6 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ============================================ */}
      {/* Profile Tab */}
      {/* ============================================ */}
      {activeTab === 'profile' && (
        <div className="space-y-6">
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Profile Information</h2>

            {/* Status message */}
            {saveStatus && (
              <div className={`mb-4 p-3 rounded-lg text-sm ${
                saveStatus.type === 'success'
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
              }`}>
                {saveStatus.message}
              </div>
            )}

            {user ? (
              <div className="divide-y divide-gray-100 dark:divide-dark-border">
                {PROFILE_FIELDS.map((field) => {
                  const value = user[field.key] as string | null
                  return (
                    <div key={field.key} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <label className="block text-sm font-medium text-gray-500 dark:text-gray-300 mb-1">
                            {field.label}
                          </label>

                          {editingField === field.key ? (
                            <div className="flex items-center gap-2">
                              {field.key === 'gender' ? (
                                <select
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  className="input-field w-auto min-w-[200px]"
                                >
                                  <option value="">Select gender</option>
                                  <option value="male">Male</option>
                                  <option value="female">Female</option>
                                  <option value="non-binary">Non-binary</option>
                                  <option value="other">Other</option>
                                  <option value="prefer-not-to-say">Prefer not to say</option>
                                </select>
                              ) : (
                                <input
                                  type={field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text'}
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  className="input-field max-w-sm"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveField(field.key)
                                    if (e.key === 'Escape') cancelEditing()
                                  }}
                                />
                              )}
                              <button
                                onClick={() => saveField(field.key)}
                                disabled={!editValue.trim()}
                                className="btn-primary text-sm px-3 py-1.5"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEditing}
                                className="btn-secondary text-sm px-3 py-1.5"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <p className="text-gray-900 dark:text-gray-100">
                              {formatDisplayValue(field, value)}
                            </p>
                          )}
                        </div>

                        {editingField !== field.key && (
                          <button
                            onClick={() => startEditing(field.key, value || '')}
                            className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium ml-4"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-gray-500 dark:text-gray-300">No profile data available.</p>
            )}
          </div>

          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>Local-only app:</strong> All your data is stored in your browser. There are no accounts or
              passwords. Use the Database tab to export backups.
            </p>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* API Key Tab */}
      {/* ============================================ */}
      {activeTab === 'apikey' && (
        <div className="space-y-6">
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Anthropic API Key</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Your API key is stored in localStorage and never sent to any server except Anthropic&apos;s API
              (via the Vite dev proxy). Get your key from{' '}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 dark:text-primary-400 underline hover:text-primary-700 dark:hover:text-primary-300"
              >
                console.anthropic.com
              </a>.
            </p>

            {/* Status message */}
            {apiKeyStatus && (
              <div className={`mb-4 p-3 rounded-lg text-sm ${
                apiKeyStatus.type === 'success'
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
              }`}>
                {apiKeyStatus.message}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label htmlFor="api-key-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  API Key
                </label>
                <input
                  id="api-key-input"
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

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleSaveApiKey}
                  className="btn-primary text-sm px-4 py-2"
                >
                  Save Key
                </button>
                <button
                  onClick={handleTestApiKey}
                  disabled={testingKey}
                  className="btn-secondary text-sm px-4 py-2"
                >
                  {testingKey ? 'Testing...' : 'Test API Key'}
                </button>
                <button
                  onClick={handleClearApiKey}
                  className="text-sm px-4 py-2 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  Clear Key
                </button>
              </div>
            </div>
          </div>

          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              <strong>Security note:</strong> Your API key is stored only in your browser&apos;s localStorage. It is
              never saved to the database or transmitted anywhere except to Anthropic when making AI calls.
              Clearing browser data will remove it.
            </p>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* Database Tab */}
      {/* ============================================ */}
      {activeTab === 'database' && (
        <div className="space-y-6">
          {/* Export section */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Export Data</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Download your entire database as a SQLite file. Use this for backups or to transfer your data.
            </p>

            {/* Status message */}
            {dbStatus && (
              <div className={`mb-4 p-3 rounded-lg text-sm ${
                dbStatus.type === 'success'
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
              }`}>
                {dbStatus.message}
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleExportDb}
                className="btn-primary text-sm px-4 py-2"
              >
                Export Database
              </button>
              <button
                onClick={handleExportForMCP}
                className="btn-secondary text-sm px-4 py-2"
              >
                Export for MCP
              </button>
            </div>
          </div>

          {/* Import section */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Import Data</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Restore from a previously exported .db file. This will replace all current data.
            </p>

            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".db,.sqlite,.sqlite3"
                onChange={handleImportDb}
                disabled={importing}
                className="block w-full text-sm text-gray-500 dark:text-gray-300
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-lg file:border-0
                  file:text-sm file:font-medium
                  file:bg-primary-50 file:text-primary-600
                  dark:file:bg-primary-900/20 dark:file:text-primary-400
                  hover:file:bg-primary-100 dark:hover:file:bg-primary-900/30
                  file:cursor-pointer file:transition-colors"
              />
              {importing && (
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-300">Importing database...</p>
              )}
            </div>
          </div>

          {/* Danger zone */}
          <div className="card border-red-200 dark:border-red-800">
            <h2 className="text-lg font-semibold text-red-700 dark:text-red-400 mb-2">Danger Zone</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Permanently delete all data including your database, API key, and theme preferences.
              This cannot be undone.
            </p>
            <button
              onClick={handleClearAllData}
              className="text-sm px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Clear All Data
            </button>
          </div>

          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>MCP export tip:</strong> The &quot;Export for MCP&quot; button downloads the database as
              &quot;memd.db&quot;. Place this file at <code className="bg-blue-100 dark:bg-blue-800/40 px-1 rounded">~/.memd/memd.db</code> for
              the MCP server to read. Run <code className="bg-blue-100 dark:bg-blue-800/40 px-1 rounded">npm run mcp</code> to
              start the MCP server.
            </p>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* Preferences Tab */}
      {/* ============================================ */}
      {activeTab === 'preferences' && (
        <div className="space-y-6">
          {/* Theme */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Theme</h2>
            <div className="flex gap-3">
              <button
                onClick={() => setTheme('light')}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg border-2 transition-colors ${
                  theme === 'light'
                    ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-dark-border hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <svg className="w-5 h-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                </svg>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Light</span>
              </button>
              <button
                onClick={() => setTheme('dark')}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg border-2 transition-colors ${
                  theme === 'dark'
                    ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-dark-border hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <svg className="w-5 h-5 text-indigo-500" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Dark</span>
              </button>
            </div>
          </div>

          {/* Session length */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Default Session Length</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Set the default duration for interview sessions (in minutes).
            </p>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={5}
                max={60}
                step={5}
                value={sessionLength}
                onChange={(e) => handleSessionLengthChange(Number(e.target.value))}
                className="flex-1 accent-primary-600"
              />
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 min-w-[60px] text-right">
                {sessionLength} min
              </span>
            </div>
            <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-1 px-1">
              <span>5 min</span>
              <span>30 min</span>
              <span>60 min</span>
            </div>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* Privacy Tab */}
      {/* ============================================ */}
      {activeTab === 'privacy' && (
        <PrivacyTab />
      )}
    </div>
  )
}
