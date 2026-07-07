import { useState, useRef, useMemo, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useUser } from '@/contexts/UserContext'
import { useTheme } from '@/contexts/ThemeContext'
import { downloadDatabase, downloadForMCP, importDatabaseFile } from '@/db/persistence'
import { getStorageDurability, type StorageDurability } from '@/services/storage'
import { formatFullDate } from '@/utils/dateFormat'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import ApiKeyForm from '@/components/ApiKeyForm'
import { PageHeader, SectionHeading, Button } from '@/components/ui'

// ============================================
// Settings tab row — internal state, not routes
// ============================================
const SETTINGS_TABS = [
  { id: 'profile', label: 'Account' },
  { id: 'apikey', label: 'API Key' },
  { id: 'database', label: 'Database' },
  { id: 'preferences', label: 'Preferences' },
] as const

type SettingsTabId = (typeof SETTINGS_TABS)[number]['id']

const DATABASE_BACKUP_HASH = '#database-backup'

const STORAGE_STATUS_COPY: Record<Exclude<StorageDurability, 'unknown'>, string> = {
  persistent: 'Storage: persistent. The browser will not evict this data under disk pressure.',
  'best-effort': 'Storage: best-effort. The browser may clear this data under disk pressure — download a backup or connect a vault.',
}

function getInitialSettingsTab(): SettingsTabId {
  if (typeof window !== 'undefined' && window.location.hash === DATABASE_BACKUP_HASH) {
    return 'database'
  }
  return 'profile'
}

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

function StorageDurabilityLine({ durability }: { durability: StorageDurability }) {
  if (durability === 'unknown') return null
  return (
    <div className="mb-4">
      <p className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1">
        Storage
      </p>
      <p className="text-sm text-gray-600 dark:text-gray-300 max-w-2xl">
        {STORAGE_STATUS_COPY[durability]}
      </p>
    </div>
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
  const location = useLocation()
  const { user, updateUser } = useUser()
  const { theme, setTheme } = useTheme()
  const [activeTab, setActiveTab] = useState<SettingsTabId>(() => getInitialSettingsTab())

  // Profile editing state
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Database state
  const [dbStatus, setDbStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [storageDurability, setStorageDurability] = useState<StorageDurability>('unknown')
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // UI-only: puts "Clear all data" into its red confirmation treatment
  // while the native confirm() dialogs are open — the handler itself is
  // unchanged (DESIGN.md: destructive actions stay quiet text, turning
  // red only at the confirmation step).
  const [isConfirmingClear, setIsConfirmingClear] = useState(false)

  // Session length
  const [sessionLength, setSessionLength] = useState<number>(user?.sessionLengthDefault ?? 15)

  // Track unsaved changes
  const isDirty = useMemo(() => {
    if (editingField !== null && editValue.trim() !== '') return true
    return false
  }, [editingField, editValue])

  useUnsavedChangesWarning(isDirty)

  useEffect(() => {
    let cancelled = false
    void getStorageDurability().then((durability) => {
      if (!cancelled) setStorageDurability(durability)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (location.hash === DATABASE_BACKUP_HASH) {
      setActiveTab('database')
    }
  }, [location.hash])

  useEffect(() => {
    if (activeTab !== 'database' || location.hash !== DATABASE_BACKUP_HASH) return
    const scrollToBackup = () => {
      document.getElementById('database-backup')?.scrollIntoView({ block: 'start' })
    }

    if (typeof window.requestAnimationFrame !== 'function') {
      scrollToBackup()
      return
    }

    const frame = window.requestAnimationFrame(scrollToBackup)
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, location.hash])

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
    setSaveStatus({ type: 'success', message: `${fieldLabel} updated` })
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
        subtitle="Account, API key, database, and preferences."
      />

      <SettingsTabs active={activeTab} onChange={setActiveTab} />

      {/* ============================================ */}
      {/* Profile Tab */}
      {/* ============================================ */}
      {activeTab === 'profile' && (
        <div>
          <SectionHeading className="mb-4">Account information</SectionHeading>

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
            to export backups. Privacy tiers are set on each insight in Review; items marked &ldquo;never export&rdquo;
            are excluded from exports automatically.
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

          <ApiKeyForm />

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
          <div id="database-backup">
            <SectionHeading className="mb-3">Export data</SectionHeading>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Download your entire database as a SQLite file. Use this for backups or to transfer your data.
              Clearing browsing data deletes the local database, so keep a backup outside the browser.
            </p>

            <StorageDurabilityLine durability={storageDurability} />

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

    </div>
  )
}
