import { useState, useRef, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useUser } from '@/contexts/UserContext'
import { useDatabase } from '@/contexts/DatabaseContext'
import { useTheme } from '@/contexts/ThemeContext'
import { downloadDatabase, downloadForMCP, importDatabaseFile } from '@/db/persistence'
import { callAnthropic } from '@/services/anthropic'
import { formatFullDate } from '@/utils/dateFormat'
import { getAllInsights, editInsight } from '@/services/insights'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { PageHeader, SectionHeading, EmptyState, Badge, Button } from '@/components/ui'

// ============================================
// Settings tab row — internal state, not routes
// ============================================
const SETTINGS_TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'apikey', label: 'API Key' },
  { id: 'database', label: 'Database' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'privacy', label: 'Privacy' },
] as const

type SettingsTabId = (typeof SETTINGS_TABS)[number]['id']

/**
 * The editorial small-caps tab row with an amber underline on the active
 * tab — same visual language as `ui/PageTabs`, but driven by local state
 * since these sections are not sibling routes.
 */
function SettingsTabs({ active, onChange }: { active: SettingsTabId; onChange: (id: SettingsTabId) => void }) {
  return (
    <nav
      className="flex items-center gap-6 border-b border-rule dark:border-dark-border mb-8 overflow-x-auto"
      aria-label="Settings sections"
      role="tablist"
    >
      {SETTINGS_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`-mb-px pb-2 whitespace-nowrap text-[11px] uppercase tracking-[0.08em] font-sans font-semibold border-b-2 transition-colors ${
            active === tab.id
              ? 'text-primary-600 dark:text-primary-400 border-primary-500 dark:border-primary-400'
              : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-ink dark:hover:text-gray-100'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}

/** A quiet status line — amber for success, ink for error. No boxes or pills. */
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

/** Hairline-topped aside for supplementary notes — replaces the old colored info panels. */
function Aside({ children }: { children: ReactNode }) {
  return (
    <p className="mt-8 pt-4 border-t border-rule dark:border-dark-border text-sm text-gray-600 dark:text-gray-300 max-w-2xl">
      {children}
    </p>
  )
}

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
        message: `Insight marked as "${newTier === 'never_export' ? 'Never export' : 'Exportable'}"`,
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

  const FILTERS: { id: typeof filter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: insights.length },
    { id: 'exportable', label: 'Exportable', count: exportableCount },
    { id: 'never_export', label: 'Never export', count: neverExportCount },
  ]

  return (
    <div>
      <SectionHeading className="mb-3">Privacy settings</SectionHeading>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-6 max-w-2xl">
        Control which verified insights are included in exports. Items marked &ldquo;Never export&rdquo; are
        excluded from all export formats, MCP access, and profile sharing.
      </p>

      {/* Stats trio — serif-italic numerals over small-caps labels */}
      <div className="flex flex-wrap gap-y-4 mb-6">
        {[
          { value: insights.length, label: 'Total verified' },
          { value: exportableCount, label: 'Exportable' },
          { value: neverExportCount, label: 'Never export' },
        ].map((item, idx) => (
          <div
            key={item.label}
            className={`min-w-[130px] px-6 first:pl-0 ${idx !== 2 ? 'border-r border-rule dark:border-dark-border' : ''}`}
          >
            <p className="font-serif italic font-medium text-2xl leading-none text-gray-900 dark:text-white">
              {item.value}
            </p>
            <p className="mt-1.5 text-[11px] tracking-[0.08em] uppercase font-sans font-semibold text-gray-500 dark:text-gray-400">
              {item.label}
            </p>
          </div>
        ))}
      </div>

      <StatusLine status={status} />

      {/* Filter row — small-caps, amber underline on active */}
      <div className="flex items-center gap-5 mb-4 border-b border-rule dark:border-dark-border">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`-mb-px pb-2 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold border-b-2 transition-colors ${
              filter === f.id
                ? 'text-primary-600 dark:text-primary-400 border-primary-500 dark:border-primary-400'
                : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-ink dark:hover:text-gray-100'
            }`}
          >
            {f.label}{' '}
            <span className="font-normal normal-case tracking-normal text-gray-400 dark:text-gray-600">
              ({f.count})
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3 py-2" aria-hidden="true">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
          ))}
        </div>
      ) : filteredInsights.length === 0 ? (
        <EmptyState
          message={
            insights.length === 0
              ? 'No verified insights yet. Verify insights to manage their privacy settings.'
              : 'No insights match this filter.'
          }
          className="py-8"
        />
      ) : (
        <div className="divide-y divide-rule dark:divide-dark-border">
          {filteredInsights.map((insight) => (
            <div key={insight.id} className="py-4 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-serif text-gray-900 dark:text-gray-100 line-clamp-2">
                    {insight.content}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                    {insight.topicTitle && <span>{insight.topicTitle}</span>}
                    {insight.confidenceScore != null && (
                      <>
                        <span aria-hidden="true">&middot;</span>
                        <span>{insight.confidenceScore}% confidence</span>
                      </>
                    )}
                    <span aria-hidden="true">&middot;</span>
                    <Badge
                      variant={insight.privacyTier === 'never_export' ? 'neutral' : 'verified'}
                      label={insight.privacyTier === 'never_export' ? 'Never export' : 'Exportable'}
                    />
                  </div>
                </div>
                <button
                  onClick={() => togglePrivacyTier(insight.id, insight.privacyTier)}
                  disabled={togglingId === insight.id}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-dark-bg ${
                    insight.privacyTier === 'exportable' ? 'bg-primary-500 dark:bg-primary-400' : 'bg-gray-200 dark:bg-dark-border'
                  } ${togglingId === insight.id ? 'opacity-50' : ''}`}
                  role="switch"
                  aria-checked={insight.privacyTier === 'exportable'}
                  title={insight.privacyTier === 'exportable' ? 'Click to mark as Never export' : 'Click to mark as Exportable'}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-dark-bg transition-transform ${
                      insight.privacyTier === 'exportable' ? 'translate-x-[18px]' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Aside>
        <span className="font-semibold text-gray-700 dark:text-gray-300">How it works: </span>
        Items marked &ldquo;Never export&rdquo; are automatically excluded from profile exports (Markdown and
        JSON), clipboard copy, and MCP tool access. Only verified insights with
        the &ldquo;Exportable&rdquo; tier are shared.
      </Aside>
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
  const [activeTab, setActiveTab] = useState<SettingsTabId>('profile')

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
  // UI-only: puts "Clear all data" into its red confirmation treatment
  // while the native confirm() dialogs are open — the handler itself is
  // unchanged (DESIGN.md: destructive actions stay quiet text, turning
  // red only at the confirmation step).
  const [isConfirmingClear, setIsConfirmingClear] = useState(false)

  // Session length
  const [sessionLength, setSessionLength] = useState<number>(user?.sessionLengthDefault ?? 15)

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
    setIsConfirmingClear(true)
    try {
      const confirmed = window.confirm(
        'Are you sure you want to clear ALL data? This will delete your entire database including all topics, sessions, insights, and settings. This action cannot be undone.'
      )
      if (!confirmed) return

      const doubleConfirm = window.confirm(
        'This is your last chance. All data will be permanently deleted. Continue?'
      )
      if (!doubleConfirm) return

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
    } finally {
      setIsConfirmingClear(false)
    }
  }

  // ---- Preferences helpers ----

  const handleSessionLengthChange = (newLength: number) => {
    setSessionLength(newLength)
    updateUser({ sessionLengthDefault: newLength })
  }

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Settings"
        subtitle="Manage your profile, API key, database, and preferences."
      />

      <SettingsTabs active={activeTab} onChange={setActiveTab} />

      {/* ============================================ */}
      {/* Profile Tab */}
      {/* ============================================ */}
      {activeTab === 'profile' && (
        <div>
          <SectionHeading className="mb-4">Profile information</SectionHeading>

          <StatusLine status={saveStatus} />

          {user ? (
            <div className="divide-y divide-rule dark:divide-dark-border">
              {PROFILE_FIELDS.map((field) => {
                const value = user[field.key] as string | null
                return (
                  <div key={field.key} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <label className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                          {field.label}
                        </label>

                        {editingField === field.key ? (
                          <div className="flex flex-wrap items-center gap-2">
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
                            <Button size="sm" onClick={() => saveField(field.key)} disabled={!editValue.trim()}>
                              Save
                            </Button>
                            <Button size="sm" variant="secondary" onClick={cancelEditing}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <p className="font-serif text-gray-900 dark:text-gray-100">
                            {formatDisplayValue(field, value)}
                          </p>
                        )}
                      </div>

                      {editingField !== field.key && (
                        <button
                          onClick={() => startEditing(field.key, value || '')}
                          className="shrink-0 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-primary-600 dark:text-primary-400 hover:text-ink dark:hover:text-gray-100 transition-colors"
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
            <p className="text-gray-500 dark:text-gray-400">No profile data available.</p>
          )}

          <Aside>
            <span className="font-semibold text-gray-700 dark:text-gray-300">Local-only app. </span>
            All your data is stored in your browser — there are no accounts or passwords. Use the Database tab
            to export backups.
          </Aside>
        </div>
      )}

      {/* ============================================ */}
      {/* API Key Tab */}
      {/* ============================================ */}
      {activeTab === 'apikey' && (
        <div>
          <SectionHeading className="mb-3">Anthropic API key</SectionHeading>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-6 max-w-2xl">
            Your API key is stored in localStorage and sent only to Anthropic&apos;s API, directly from your
            browser. Get your key from{' '}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-600 dark:text-primary-400 underline hover:text-ink dark:hover:text-gray-100"
            >
              console.anthropic.com
            </a>.
          </p>

          <StatusLine status={apiKeyStatus} />

          <div className="space-y-4 max-w-lg">
            <div>
              <label htmlFor="api-key-input" className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                API key
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

          <Aside>
            <span className="font-semibold text-gray-700 dark:text-gray-300">Security note: </span>
            Your API key is stored only in your browser&apos;s localStorage. It is never saved to the database
            or transmitted anywhere except to Anthropic when making AI calls. Clearing browser data will
            remove it.
          </Aside>
        </div>
      )}

      {/* ============================================ */}
      {/* Database Tab */}
      {/* ============================================ */}
      {activeTab === 'database' && (
        <div className="space-y-10">
          {/* Export section */}
          <div>
            <SectionHeading className="mb-3">Export data</SectionHeading>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Download your entire database as a SQLite file. Use this for backups or to transfer your data.
            </p>

            <StatusLine status={dbStatus} />

            <div className="flex flex-wrap gap-4">
              <Button onClick={handleExportDb}>Export database</Button>
              <Button variant="secondary" onClick={handleExportForMCP}>Export for MCP</Button>
            </div>
          </div>

          {/* Import section */}
          <div>
            <SectionHeading className="mb-3">Import data</SectionHeading>
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
                className="block w-full text-sm text-gray-500 dark:text-gray-400
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-medium
                  file:bg-primary-50 file:text-primary-600
                  dark:file:bg-primary-900/20 dark:file:text-primary-400
                  hover:file:bg-primary-100 dark:hover:file:bg-primary-900/30
                  file:cursor-pointer file:transition-colors"
              />
              {importing && (
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Importing database…</p>
              )}
            </div>
          </div>

          {/* Clear all data */}
          <div>
            <SectionHeading className="mb-3">Clear all data</SectionHeading>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 max-w-xl">
              Permanently delete all data including your database, API key, and theme preferences. This cannot
              be undone.
            </p>
            <button
              onClick={handleClearAllData}
              className={`text-sm font-medium transition-colors ${
                isConfirmingClear
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
              }`}
            >
              Clear all data
            </button>
          </div>

          <Aside>
            <span className="font-semibold text-gray-700 dark:text-gray-300">MCP export tip: </span>
            The &ldquo;Export for MCP&rdquo; button downloads the database as &ldquo;memd.db&rdquo;. Place this
            file at{' '}
            <code className="font-mono text-xs bg-panel dark:bg-dark-card px-1 rounded">~/.memd/memd.db</code>{' '}
            for the MCP server to read. Run{' '}
            <code className="font-mono text-xs bg-panel dark:bg-dark-card px-1 rounded">npm run mcp</code> to
            start the MCP server.
          </Aside>
        </div>
      )}

      {/* ============================================ */}
      {/* Preferences Tab */}
      {/* ============================================ */}
      {activeTab === 'preferences' && (
        <div className="space-y-10">
          {/* Theme */}
          <div>
            <SectionHeading className="mb-4">Theme</SectionHeading>
            <div className="inline-flex rounded-md border border-rule dark:border-dark-border overflow-hidden">
              <button
                onClick={() => setTheme('light')}
                className={`px-5 py-2 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold transition-colors ${
                  theme === 'light'
                    ? 'bg-panel dark:bg-dark-card text-primary-600 dark:text-primary-400'
                    : 'text-gray-500 dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
                }`}
              >
                Light
              </button>
              <button
                onClick={() => setTheme('dark')}
                className={`px-5 py-2 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold border-l border-rule dark:border-dark-border transition-colors ${
                  theme === 'dark'
                    ? 'bg-panel dark:bg-dark-card text-primary-600 dark:text-primary-400'
                    : 'text-gray-500 dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
                }`}
              >
                Dark
              </button>
            </div>
          </div>

          {/* Session length */}
          <div>
            <SectionHeading className="mb-3">Default session length</SectionHeading>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Set the default duration for interview sessions (in minutes).
            </p>
            <div className="flex items-center gap-4 max-w-md">
              <input
                type="range"
                min={5}
                max={60}
                step={5}
                value={sessionLength}
                onChange={(e) => handleSessionLengthChange(Number(e.target.value))}
                className="flex-1 accent-primary-600"
              />
              <span className="font-serif italic text-lg text-gray-900 dark:text-white min-w-[70px] text-right">
                {sessionLength} min
              </span>
            </div>
            <div className="flex justify-between text-[11px] uppercase tracking-[0.06em] font-sans text-gray-400 dark:text-gray-600 mt-2 max-w-md">
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
