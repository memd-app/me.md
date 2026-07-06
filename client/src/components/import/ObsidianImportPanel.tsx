import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import type * as schema from '@/db/schema'
import { ensurePermission, isFileSystemAccessSupported, pickVaultDirectory } from '@/services/obsidianSync'
import { loadVaultHandle, saveVaultHandle } from '@/services/vaultHandle'
import {
  groupByTopFolder,
  runObsidianImport,
  scanUploadedFiles,
  scanVaultDirectory,
  type NoteResult,
  type NoteSkipReason,
  type ObsidianImportProgress,
  type VaultNoteFile,
} from '@/services/obsidianImport'

type Db = SQLJsDatabase<typeof schema>
type Stage = 'idle' | 'scanning' | 'scoping' | 'importing' | 'done'

const SKIP_REASON_LABELS: Partial<Record<NoteSkipReason, string>> = {
  unchanged: 'Unchanged — already imported',
}

interface ObsidianImportPanelProps {
  db: Db
  userId?: string
  onImported: (results: NoteResult[]) => void
  onBusyChange?: (busy: boolean) => void
}

function StepMarker({ step }: { step: number }) {
  return (
    <span className="font-sans text-[11px] tracking-[0.08em] text-ink/40 dark:text-[#7A7264] tabular-nums pt-1 shrink-0">
      {String(step).padStart(2, '0')}
    </span>
  )
}

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

export default function ObsidianImportPanel({
  db,
  userId,
  onImported,
  onBusyChange,
}: ObsidianImportPanelProps) {
  const [stage, setStage] = useState<Stage>('idle')
  const [storedHandle, setStoredHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [files, setFiles] = useState<VaultNoteFile[]>([])
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<ObsidianImportProgress | null>(null)
  const [results, setResults] = useState<NoteResult[]>([])
  const [error, setError] = useState('')
  const [isStopping, setIsStopping] = useState(false)
  const cancelRef = useRef(false)
  const fsaSupported = isFileSystemAccessSupported()

  const groups = useMemo(() => groupByTopFolder(files), [files])
  const selectedFiles = useMemo(
    () => files.filter((file) => selectedFolders.has(topFolder(file.path))),
    [files, selectedFolders],
  )

  useEffect(() => {
    onBusyChange?.(stage === 'importing')
  }, [onBusyChange, stage])

  useEffect(() => {
    if (!fsaSupported) return

    let isMounted = true
    loadVaultHandle()
      .then((handle) => {
        if (isMounted) setStoredHandle(handle)
      })
      .catch((loadError) => {
        if (isMounted) setError(errorMessage(loadError, 'Could not load the saved vault handle.'))
      })

    return () => {
      isMounted = false
    }
  }, [fsaSupported])

  async function scanHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    if (!userId) {
      setError('Not authenticated')
      return
    }

    setError('')
    setResults([])
    setProgress(null)
    setStage('scanning')

    try {
      if (!(await ensurePermission(handle))) {
        setError('Permission to read the vault was denied.')
        setStage('idle')
        return
      }

      await saveVaultHandle(handle)
      setStoredHandle(handle)

      const scanned = await scanVaultDirectory(handle)
      setFiles(scanned)
      setSelectedFolders(new Set(groupByTopFolder(scanned).map(group => group.folder)))
      setStage('scoping')
    } catch (scanError) {
      setError(errorMessage(scanError, 'Could not scan the vault. Choose the folder again and retry.'))
      setStage('idle')
    }
  }

  async function handleChooseFolder(): Promise<void> {
    if (!userId) {
      setError('Not authenticated')
      return
    }

    setError('')

    try {
      const handle = await pickVaultDirectory()
      if (!handle) return
      await scanHandle(handle)
    } catch (pickError) {
      setError(errorMessage(pickError, 'Could not open the vault folder.'))
      setStage('idle')
    }
  }

  function handleUploadedFiles(event: ChangeEvent<HTMLInputElement>): void {
    if (!userId) {
      setError('Not authenticated')
      event.target.value = ''
      return
    }

    const selected = event.target.files
    if (!selected) return

    const scanned = scanUploadedFiles(selected)
    setError('')
    setResults([])
    setProgress(null)
    setFiles(scanned)
    setSelectedFolders(new Set(groupByTopFolder(scanned).map(group => group.folder)))
    setStage('scoping')
    event.target.value = ''
  }

  function toggleFolder(folder: string): void {
    setSelectedFolders((current) => {
      const next = new Set(current)
      if (next.has(folder)) {
        next.delete(folder)
      } else {
        next.add(folder)
      }
      return next
    })
  }

  async function startImport(): Promise<void> {
    if (!userId) {
      setError('Not authenticated')
      return
    }

    if (selectedFiles.length === 0) return

    setError('')
    setResults([])
    setProgress(null)
    setIsStopping(false)
    cancelRef.current = false
    setStage('importing')

    try {
      const completed = await runObsidianImport(db, selectedFiles, {
        isCancelled: () => cancelRef.current,
        onProgress: setProgress,
        onNoteDone: (result) => {
          setResults((current) => [...current, result])
        },
      })

      const imported = completed.filter((result) => result.status === 'imported')
      if (imported.length > 0) onImported(imported)
    } catch (importError) {
      setError(errorMessage(importError, 'Could not import notes from this vault.'))
    } finally {
      setStage('done')
      setIsStopping(false)
    }
  }

  function resetToScope(): void {
    cancelRef.current = false
    setIsStopping(false)
    setProgress(null)
    setResults([])
    setError('')
    setStage('scoping')
  }

  function handleRescan(): void {
    cancelRef.current = false
    setIsStopping(false)
    setProgress(null)
    setResults([])
    setError('')

    if (fsaSupported && storedHandle) {
      void scanHandle(storedHandle)
      return
    }

    setStage('idle')
  }

  if (stage === 'scoping') {
    return (
      <div className="space-y-8">
        <StepHeader
          step={2}
          title="Choose folders to import"
          description="Pick the top-level Obsidian folders whose markdown notes should enter the review queue."
        />

        {files.length === 0 ? (
          <div className="ml-8 space-y-3">
            <p className="font-serif text-lg text-ink dark:text-gray-100">No markdown notes found in this vault.</p>
            <button
              type="button"
              onClick={() => setStage('idle')}
              className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-primary-600 dark:text-primary-400 hover:text-ink dark:hover:text-gray-100 transition-colors"
            >
              Back to connect vault
            </button>
          </div>
        ) : (
          <div className="ml-8 space-y-5">
            <div className="divide-y divide-rule dark:divide-dark-border">
              {groups.map((group) => (
                <label key={group.folder || 'vault-root'} className="flex items-center gap-3 py-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedFolders.has(group.folder)}
                    onChange={() => toggleFolder(group.folder)}
                    className="h-4 w-4 rounded border-rule text-primary-600 focus:ring-primary-500 dark:border-dark-border dark:bg-dark-card"
                  />
                  <span className="font-serif text-ink dark:text-gray-100 flex-1">
                    {group.folder || 'Vault root'}
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.08em] font-sans font-medium text-gray-400 dark:text-gray-600 tabular-nums">
                    {group.files.length} {group.files.length === 1 ? 'note' : 'notes'}
                  </span>
                </label>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-rule dark:border-dark-border pt-4">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                <span className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1">
                  {selectedFiles.length} notes selected
                </span>
                Each note is analyzed individually with your Anthropic API key; large selections take time and tokens.
              </p>
              <button
                type="button"
                onClick={() => void startImport()}
                disabled={selectedFiles.length === 0}
                className="btn-primary whitespace-nowrap"
              >
                Import {selectedFiles.length} {selectedFiles.length === 1 ? 'note' : 'notes'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (stage === 'importing') {
    const current = progress?.current ?? 0
    const total = progress?.total ?? selectedFiles.length
    const percent = total > 0 ? Math.min(100, (current / total) * 100) : 0

    return (
      <div className="space-y-8">
        <StepHeader
          step={3}
          title="Importing notes"
          description="Notes are imported and analyzed one at a time."
        />

        <div className="ml-8 space-y-5">
          <div className="flex items-center gap-3">
            <Spinner className="w-5 h-5 text-primary-500" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <span className="text-[11px] uppercase tracking-[0.08em] font-sans font-medium text-gray-400 dark:text-gray-600 tabular-nums">
                  {String(current).padStart(2, '0')} / {String(total).padStart(2, '0')}
                </span>
                <span className="font-serif text-ink dark:text-gray-100 truncate">
                  {progress?.filename || 'Preparing import'}
                </span>
              </div>
              <div className="h-px bg-rule dark:bg-dark-border">
                <div
                  className="h-0.5 bg-primary-500 transition-[width] duration-150"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              cancelRef.current = true
              setIsStopping(true)
            }}
            disabled={isStopping}
            className="btn-secondary"
          >
            {isStopping ? (
              <>
                Stopping after current note&hellip;
              </>
            ) : (
              'Stop'
            )}
          </button>
        </div>
      </div>
    )
  }

  if (stage === 'done') {
    const importedCount = results.filter(result => result.status === 'imported').length
    const skippedCount = results.filter(result => result.status === 'skipped').length
    const failedCount = results.filter(result => result.status === 'failed').length
    const detailRows = results.filter(result => result.status !== 'imported' || result.truncated)

    return (
      <div className="space-y-8">
        <StepHeader
          step={3}
          title="Import complete"
          description="Imported notes are already in the shared import results below."
        />

        <div className="ml-8 space-y-5">
          <p className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400">
            Imported {importedCount} &middot; Skipped {skippedCount} &middot; Failed {failedCount}
          </p>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
          )}

          {detailRows.length > 0 && (
            <details className="border-t border-rule dark:border-dark-border pt-3">
              <summary className="cursor-pointer text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400">
                Review skipped, failed, and truncated notes
              </summary>
              <div className="mt-3 divide-y divide-rule dark:divide-dark-border">
                {detailRows.map((result, index) => (
                  <div key={`${result.path}-${index}`} className="py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-gray-600 dark:text-gray-300 truncate">{result.path}</span>
                      <span className="text-[11px] uppercase tracking-[0.08em] font-sans font-medium text-gray-500 dark:text-gray-400 shrink-0">
                        {result.truncated ? 'Truncated' : result.skipReason ? SKIP_REASON_LABELS[result.skipReason] ?? result.skipReason : result.status}
                      </span>
                    </div>
                    {result.error && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{result.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={resetToScope} className="btn-primary">
              Import more
            </button>
            <button type="button" onClick={handleRescan} className="btn-secondary">
              Rescan vault
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <StepHeader
        step={1}
        title="Connect Obsidian vault"
        description="Use the vault folder from sync or choose a folder to scan markdown notes."
      />

      <div className="ml-8 space-y-4">
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
        )}

        {fsaSupported ? (
          <div className="flex flex-col sm:flex-row gap-3">
            {storedHandle && (
              <button
                type="button"
                onClick={() => void scanHandle(storedHandle)}
                disabled={stage === 'scanning'}
                className="btn-primary"
              >
                {stage === 'scanning' ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner />
                    Scanning...
                  </span>
                ) : (
                  <>
                    Use synced vault &mdash; {handleName(storedHandle)}
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleChooseFolder()}
              disabled={stage === 'scanning'}
              className={storedHandle ? 'btn-secondary' : 'btn-primary'}
            >
              {storedHandle ? 'Choose a different folder' : 'Choose folder'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              id="obsidian-folder-upload"
              type="file"
              multiple
              onChange={handleUploadedFiles}
              className="hidden"
              {...({ webkitdirectory: '' } as object)}
            />
            <label
              htmlFor="obsidian-folder-upload"
              className="flex flex-col items-center justify-center w-full h-40 border border-dashed rounded-md cursor-pointer transition-colors border-rule dark:border-dark-border hover:border-primary-400 dark:hover:border-primary-500 hover:bg-panel/60 dark:hover:bg-dark-card/60"
            >
              <span className="font-serif text-ink dark:text-gray-100">Choose vault folder</span>
              <span className="mt-2 text-[11px] uppercase tracking-[0.08em] font-sans text-gray-400 dark:text-gray-600">
                Markdown files only
              </span>
            </label>
          </div>
        )}
      </div>
    </div>
  )
}

function StepHeader({
  step,
  title,
  description,
}: {
  step: number
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-4">
      <StepMarker step={step} />
      <div>
        <h3 className="font-serif text-lg text-ink dark:text-gray-100">{title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{description}</p>
      </div>
    </div>
  )
}

function topFolder(path: string): string {
  const segments = path.split('/').filter(Boolean)
  return segments.length > 1 ? segments[0] : ''
}

function handleName(handle: FileSystemDirectoryHandle): string {
  return 'name' in handle && typeof handle.name === 'string' ? handle.name : 'vault'
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
