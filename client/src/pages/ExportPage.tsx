import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase, useVaultSyncStatus } from '@/contexts/DatabaseContext';
import { useToast } from '@/contexts/ToastContext';
import { getExportStatus, exportAsMarkdown, exportAsJson } from '@/services/profile';
import { generateObsidianNotes } from '@/services/obsidianExport';
import { isFileSystemAccessSupported, pickVaultDirectory } from '@/services/obsidianSync';
import {
  getVaultAttention,
  getVaultConflicts,
  reconcileVault,
  resolveVaultAttention,
  resolveVaultConflict,
  type ReconcileReport,
  type VaultAttentionItem,
  type VaultConflict,
} from '@/services/vaultWriteThrough';
import { createStoreZip } from '@/services/zipStore';
import { getVaultDisplayName, loadVaultHandle, saveVaultHandle } from '@/services/vaultHandle';
import { getGraphStats } from '@/services/insights';
import { PageHeader } from '@/components/ui';

type ExportFormat = 'markdown' | 'json' | 'both';
type GraphStats = ReturnType<typeof getGraphStats>;

function formatSyncSummary(summary: ReconcileReport): string {
  const segments = [
    summary.created > 0 ? `${summary.created} created` : null,
    summary.updated > 0 ? `${summary.updated} updated` : null,
    summary.pulled > 0 ? `${summary.pulled} pulled` : null,
    summary.recreated > 0 ? `${summary.recreated} recreated` : null,
    summary.materialized > 0 ? `${summary.materialized} materialized` : null,
    summary.approvedFromVault > 0 ? `${summary.approvedFromVault} approved in vault` : null,
    summary.rejectedFromVault > 0 ? `${summary.rejectedFromVault} rejected in vault` : null,
    summary.pendingPulled > 0 ? `${summary.pendingPulled} pending pulled` : null,
    summary.dismissed > 0 ? `${summary.dismissed} dismissed` : null,
    summary.attention > 0 ? `${summary.attention} attention` : null,
    summary.conflicts > 0 ? `${summary.conflicts} conflict${summary.conflicts === 1 ? '' : 's'}` : null,
  ].filter(Boolean)

  return segments.length > 0
    ? `Synced to me.md: ${segments.join(', ')}.`
    : 'Synced to me.md: no changes.'
}

function countLine(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

function StatColumn({
  title,
  rows,
  empty,
}: {
  title: string
  rows: Array<{ label: string; count: number }>
  empty: string
}) {
  return (
    <section className="border-t border-b border-rule dark:border-dark-border py-5">
      <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-4">{title}</h3>
      {rows.length > 0 ? (
        <dl className="space-y-3">
          {rows.map(row => (
            <div key={row.label} className="flex items-baseline justify-between gap-4">
              <dt className="text-sm font-medium text-gray-700 dark:text-gray-300">{row.label}</dt>
              <dd className="font-serif italic text-xl text-gray-950 dark:text-white">{row.count}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">{empty}</p>
      )}
    </section>
  )
}

function GraphStatsBlock({ stats }: { stats: GraphStats }) {
  if (stats.verifiedTotal === 0) {
    return (
      <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">
        No verified insights are ready for Obsidian graph links yet.
      </p>
    )
  }

  return (
    <section className="mt-6">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
        {countLine(stats.verifiedTotal, 'verified insight')} · {countLine(stats.topicTotal, 'topic')}
      </p>
      <div className="grid gap-8 lg:grid-cols-2">
        <StatColumn
          title="Insight kinds"
          rows={stats.byKind.map(item => ({ label: item.label, count: item.count }))}
          empty="No kind data yet."
        />
        <StatColumn
          title="Topics by size"
          rows={stats.topicSizes.map(item => ({ label: item.title, count: item.count }))}
          empty="No topic links yet."
        />
      </div>
    </section>
  )
}

export default function ExportPage() {
  const { user } = useUser();
  const db = useDatabase();
  const { vaultReconnectNeeded, setVaultReconnectNeeded } = useVaultSyncStatus();
  const { addToast } = useToast();
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('markdown');
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [conflicts, setConflicts] = useState<VaultConflict[]>(() => getVaultConflicts());
  const [attention, setAttention] = useState<VaultAttentionItem[]>(() => getVaultAttention());
  const [vaultName, setVaultName] = useState<string | null>(null);
  const [isLoadingVaultName, setIsLoadingVaultName] = useState(true);
  const fsaSupported = isFileSystemAccessSupported();
  const graphStats = useMemo(() => getGraphStats(db), [db]);

  // Export readiness state
  const [exportStatus, setExportStatus] = useState<{ hasVerifiedData: boolean; verifiedInsightCount: number; topicCount: number } | null>(null);
  const [loadingExportStatus, setLoadingExportStatus] = useState(true);

  // Check export readiness on mount
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();

    const checkExportStatus = async () => {
      try {
        const data = getExportStatus(db);
        if (!controller.signal.aborted) {
          setExportStatus(data);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // Silent fail - export will still work, just without the warning
      } finally {
        if (!controller.signal.aborted) {
          setLoadingExportStatus(false);
        }
      }
    };

    checkExportStatus();
    return () => controller.abort();
  }, [user]);

  useEffect(() => {
    setConflicts(getVaultConflicts());
    setAttention(getVaultAttention());
  }, []);

  useEffect(() => {
    let active = true;
    getVaultDisplayName()
      .then(name => {
        if (active) setVaultName(name);
      })
      .catch(error => {
        console.warn('[me.md:export] Could not read persisted vault handle', error);
        if (active) setVaultName(null);
      })
      .finally(() => {
        if (active) setIsLoadingVaultName(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadContent = (content: string, filename: string, mimeType = 'text/plain') => {
    downloadBlob(new Blob([content], { type: mimeType }), filename);
  };

  const performExport = async () => {
    if (!user) return;
    try {
      setExporting(true);
      setStatus(null);
      const safeName = (user.name || 'user').replace(/[^a-zA-Z0-9]/g, '_');

      if (selectedFormat === 'markdown' || selectedFormat === 'both') {
        const mdContent = exportAsMarkdown(db);
        downloadContent(mdContent, `${safeName}_me.md`, 'text/markdown');
      }

      if (selectedFormat === 'json' || selectedFormat === 'both') {
        const jsonData = exportAsJson(db);
        downloadContent(JSON.stringify(jsonData, null, 2), `${safeName}_profile.json`, 'application/json');
      }

      const formatLabel =
        selectedFormat === 'both'
          ? 'Markdown and JSON files downloaded'
          : selectedFormat === 'markdown'
          ? 'Markdown file downloaded'
          : 'JSON file downloaded';

      setStatus({ type: 'success', message: formatLabel });
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to export. Please check your connection and try again.' });
    } finally {
      setExporting(false);
    }
  };

  const performCopy = async () => {
    if (!user) return;
    try {
      setCopying(true);
      setStatus(null);
      const text = exportAsMarkdown(db);
      await navigator.clipboard.writeText(text);
      setStatus({ type: 'success', message: 'Profile copied to clipboard' });
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to copy. Please try again.' });
    } finally {
      setCopying(false);
    }
  };

  const isAbortError = (err: unknown) => (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: unknown }).name === 'AbortError'
  );

  const handleSync = async () => {
    try {
      setSyncing(true);
      setStatus(null);

      let handle = await loadVaultHandle();
      if (!handle) handle = await pickVaultDirectory();
      if (!handle) return;

      await saveVaultHandle(handle);
      const summary = await reconcileVault(db, handle);
      setVaultReconnectNeeded(false);
      setVaultName(handle.name);
      setConflicts(getVaultConflicts());
      setAttention(getVaultAttention());
      setStatus({
        type: 'success',
        message: formatSyncSummary(summary),
      });
    } catch (err) {
      if (isAbortError(err)) return;
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to sync to the vault. Please try again.',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleResolveConflict = async (conflict: VaultConflict, choice: 'app' | 'vault') => {
    try {
      setSyncing(true);
      setStatus(null);

      let handle = await loadVaultHandle();
      if (!handle) handle = await pickVaultDirectory();
      if (!handle) return;

      await saveVaultHandle(handle);
      await resolveVaultConflict(db, handle, conflict, choice);
      setVaultReconnectNeeded(false);
      setConflicts(getVaultConflicts());
      setAttention(getVaultAttention());
      setStatus({
        type: 'success',
        message: choice === 'app' ? 'Kept the app version and updated the vault.' : 'Kept the vault version and updated the app.',
      });
    } catch (err) {
      if (isAbortError(err)) return;
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to resolve the vault conflict. Please try again.',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleResolveAttention = async (item: VaultAttentionItem, choice: string) => {
    try {
      setSyncing(true);
      setStatus(null);

      let handle = await loadVaultHandle();
      if (!handle) handle = await pickVaultDirectory();
      if (!handle) return;

      await saveVaultHandle(handle);
      await resolveVaultAttention(db, handle, item, choice);
      setVaultReconnectNeeded(false);
      setConflicts(getVaultConflicts());
      setAttention(getVaultAttention());
      setStatus({ type: 'success', message: 'Vault attention item resolved.' });
    } catch (err) {
      if (isAbortError(err)) return;
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to resolve the vault attention item. Please try again.',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleZip = () => {
    if (!hasExportableData()) return;

    try {
      setZipping(true);
      setStatus(null);
      const result = generateObsidianNotes(db);
      const zip = createStoreZip(result.notes.map(note => ({ path: note.path, content: note.content })));
      downloadBlob(zip, 'me.md-vault.zip');
      setStatus({ type: 'success', message: 'Obsidian vault zip downloaded.' });
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to prepare the Obsidian vault zip. Please try again.',
      });
    } finally {
      setZipping(false);
    }
  };

  const openObsidianIndex = () => {
    if (!vaultName) return;
    const vault = encodeURIComponent(vaultName);
    const file = encodeURIComponent('me.md/Me - Index');
    window.location.href = `obsidian://open?vault=${vault}&file=${file}`;
  };

  const hasExportableData = () => {
    // Check if there's verified data to export
    if (exportStatus && !exportStatus.hasVerifiedData) {
      addToast('No verified insights available to export. Complete interview sessions and verify insights first.', 'warning', 5000);
      setStatus({
        type: 'error',
        message: 'Nothing to export yet — your profile is built from verified insights with the "exportable" privacy tier. The checklist above walks through the three steps.',
      });
      return false;
    }
    return true;
  };

  const handleExport = () => {
    if (hasExportableData()) {
      performExport();
    }
  };

  const handleCopyToClipboard = () => {
    if (hasExportableData()) {
      performCopy();
    }
  };

  const formatOptions: { value: ExportFormat; label: string; description: string }[] = [
    {
      value: 'markdown',
      label: 'Markdown',
      description: 'Export as a portable me.md file',
    },
    {
      value: 'json',
      label: 'JSON',
      description: 'Complete data export: insights, topics, notes, and sessions',
    },
    {
      value: 'both',
      label: 'Both',
      description: 'Download both Markdown and JSON files',
    },
  ];

  const attentionDetail = (item: VaultAttentionItem) => {
    if (item.kind === 'duplicate-note') return item.detail.duplicatePaths?.join(', ') || 'Duplicate note'
    if (item.kind === 'dismissed-in-vault') return item.detail.lastKnownPath || 'Missing pending note'
    return `${item.detail.dbStatus ?? 'current'} → ${item.detail.fromStatus ?? 'unknown'}`
  };

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        kicker="Export & sync"
        title="Vault"
        subtitle="Your verified profile as Markdown or JSON — and Obsidian, if you keep a vault."
      />

      {/* No verified data warning — bg-panel note, typographic not colored */}
      {!loadingExportStatus && exportStatus && !exportStatus.hasVerifiedData && (
        <div className="mb-8 bg-panel dark:bg-dark-card border border-rule dark:border-dark-border rounded-md px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-primary-600 dark:text-primary-400 mb-2">
            No verified data to export
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Your profile export will be empty because you don&apos;t have any verified, exportable insights yet. To build your profile:
          </p>
          <ol className="text-sm text-gray-700 dark:text-gray-300 mt-2 ml-4 list-decimal space-y-1">
            <li>
              <Link to="/app/topics" className="underline hover:text-primary-600 dark:hover:text-primary-400">Create topics</Link> and complete interview sessions
            </li>
            <li>
              <Link to="/app/review" className="underline hover:text-primary-600 dark:hover:text-primary-400">Verify your insights</Link> in Review
            </li>
            <li>Ensure verified insights have the &quot;exportable&quot; privacy tier</li>
          </ol>
        </div>
      )}

      {/* Export readiness summary — quiet typographic line, no colored box */}
      {!loadingExportStatus && exportStatus && exportStatus.hasVerifiedData && (
        <p className="mb-8 text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <svg className="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>
            <strong className="text-ink dark:text-gray-100">{exportStatus.verifiedInsightCount} verified insight{exportStatus.verifiedInsightCount !== 1 ? 's' : ''}</strong> across {exportStatus.topicCount} topic{exportStatus.topicCount !== 1 ? 's' : ''} ready to export.
          </span>
        </p>
      )}

      {/* Status message */}
      {status && (
        <p
          className={`mb-8 text-sm ${
            status.type === 'success'
              ? 'text-ink dark:text-gray-100'
              : 'text-red-600 dark:text-red-400'
          }`}
          role={status.type === 'error' ? 'alert' : undefined}
        >
          {status.message}
        </p>
      )}

      {/* Format selection — quiet selectable cards, amber ring on selection */}
      <div className="mb-8">
        <h2 className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-3">
          Export format
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {formatOptions.map((option) => {
            const isSelected = selectedFormat === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelectedFormat(option.value)}
                aria-pressed={isSelected}
                className={`text-left p-5 rounded-md border bg-transparent transition-colors ${
                  isSelected
                    ? 'border-primary-500 dark:border-primary-400 ring-1 ring-primary-500/30'
                    : 'border-rule dark:border-dark-border hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <span className="font-serif text-base text-ink dark:text-gray-100">
                    {option.label}
                  </span>
                  <span
                    className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? 'border-primary-500 bg-primary-500'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                    aria-hidden="true"
                  >
                    {isSelected && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {option.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Export button */}
      <div className="border-t border-rule dark:border-dark-border py-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-serif text-lg text-ink dark:text-gray-100">
            Download{' '}
            {selectedFormat === 'both'
              ? 'Both Files'
              : selectedFormat === 'markdown'
              ? 'Markdown File'
              : 'JSON File'}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {selectedFormat === 'both'
              ? 'Downloads me.md and profile.json'
              : selectedFormat === 'markdown'
              ? 'Downloads your profile as me.md'
              : 'Downloads structured profile data as JSON'}
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="btn-primary shrink-0"
        >
          {exporting
            ? 'Downloading...'
            : selectedFormat === 'both'
            ? 'Download Both'
            : selectedFormat === 'markdown'
            ? 'Download me.md'
            : 'Download JSON'}
        </button>
      </div>

      {/* Copy to clipboard */}
      <div className="border-t border-rule dark:border-dark-border py-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-serif text-lg text-ink dark:text-gray-100">
            Copy to clipboard
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Copy your profile as markdown directly to paste into any AI tool
          </p>
        </div>
        <button
          onClick={handleCopyToClipboard}
          disabled={copying}
          className="btn-secondary shrink-0"
        >
          {copying ? 'Copying...' : 'Copy Profile'}
        </button>
      </div>

      {/* Obsidian */}
      <div>
        <div className="border-t border-rule dark:border-dark-border py-6">
          <h2 className="font-serif text-lg text-ink dark:text-gray-100">
            Obsidian graph
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300 max-w-2xl">
            Every verified insight is a note in your vault, linked to its topic and the index. Obsidian&apos;s graph view draws the picture from those links.
          </p>
          {isLoadingVaultName ? (
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading Obsidian vault…</p>
          ) : vaultName ? (
            <>
              <button
                type="button"
                onClick={openObsidianIndex}
                className="btn-secondary mt-5"
              >
                Open Me - Index in Obsidian
              </button>
              <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                If the button does not resolve, open Obsidian and go to me.md/Me - Index.
              </p>
            </>
          ) : (
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              Connect an Obsidian vault here to see these links in Obsidian&apos;s graph view.
            </p>
          )}
          <GraphStatsBlock stats={graphStats} />
        </div>

        {fsaSupported && (
          <div className="border-t border-rule dark:border-dark-border py-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-serif text-lg text-ink dark:text-gray-100">
                  Sync to Obsidian Vault
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Reconcile verified insight notes with your vault. Updates in place; rejected notes move to Rejected.
                </p>
                {vaultReconnectNeeded && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Reconnect vault to sync.
                  </p>
                )}
              </div>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="btn-primary shrink-0"
              >
                {syncing ? 'Syncing...' : 'Sync to Vault'}
              </button>
            </div>

            {conflicts.length > 0 && (
              <div className="mt-6 border-t border-rule dark:border-dark-border pt-5">
                <h3 className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-3">
                  Vault conflicts
                </h3>
                <div className="divide-y divide-rule dark:divide-dark-border">
                  {conflicts.map((conflict) => (
                    <div key={conflict.insightId} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink dark:text-gray-100 truncate">
                            {conflict.slug}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {conflict.path}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleResolveConflict(conflict, 'app')}
                            disabled={syncing}
                            className="btn-secondary text-sm"
                          >
                            Keep app
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResolveConflict(conflict, 'vault')}
                            disabled={syncing}
                            className="btn-primary text-sm"
                          >
                            Keep vault
                          </button>
                        </div>
                      </div>
                      <details className="mt-3 text-sm">
                        <summary className="cursor-pointer text-gray-600 dark:text-gray-300">
                          Compare bodies
                        </summary>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1">
                              App
                            </p>
                            <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-700 dark:text-gray-300 border border-rule dark:border-dark-border rounded-md p-3 max-h-48 overflow-auto">{conflict.appBody}</pre>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1">
                              Vault
                            </p>
                            <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-700 dark:text-gray-300 border border-rule dark:border-dark-border rounded-md p-3 max-h-48 overflow-auto">{conflict.vaultBody}</pre>
                          </div>
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {attention.length > 0 && (
              <div className="mt-6 border-t border-rule dark:border-dark-border pt-5">
                <h3 className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-3">
                  Needs attention
                </h3>
                <div className="divide-y divide-rule dark:divide-dark-border">
                  {attention.map((item) => (
                    <div key={`${item.insightId}:${item.kind}`} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink dark:text-gray-100 truncate">
                            {item.slug}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {attentionDetail(item)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {item.kind === 'dismissed-in-vault' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleResolveAttention(item, 'confirm-reject')}
                                disabled={syncing}
                                className="btn-secondary text-sm"
                              >
                                Confirm reject
                              </button>
                              <button
                                type="button"
                                onClick={() => handleResolveAttention(item, 're-materialize')}
                                disabled={syncing}
                                className="btn-primary text-sm"
                              >
                                Re-materialize
                              </button>
                            </>
                          )}
                          {item.kind === 'backward-move' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleResolveAttention(item, 'keep-current')}
                                disabled={syncing}
                                className="btn-secondary text-sm"
                              >
                                Keep current status
                              </button>
                              <button
                                type="button"
                                onClick={() => handleResolveAttention(item, 'apply-move')}
                                disabled={syncing}
                                className="btn-primary text-sm"
                              >
                                Apply move
                              </button>
                            </>
                          )}
                          {item.kind === 'duplicate-note' && (
                            <button
                              type="button"
                              onClick={() => handleResolveAttention(item, 'dismiss')}
                              disabled={syncing}
                              className="btn-secondary text-sm"
                            >
                              Dismiss
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="border-t border-rule dark:border-dark-border py-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-serif text-lg text-ink dark:text-gray-100">
              Download Obsidian Vault
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              A zip of the same Markdown notes — works in any browser. Unzip into your vault.
            </p>
          </div>
          <button
            onClick={handleZip}
            disabled={zipping}
            className="btn-secondary shrink-0"
          >
            {zipping ? 'Preparing…' : 'Download .zip'}
          </button>
        </div>
      </div>

      {/* Privacy note */}
      <div className="mt-2 bg-panel dark:bg-dark-card border border-rule dark:border-dark-border rounded-md px-5 py-4">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          <span className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-primary-600 dark:text-primary-400 mb-1">
            Privacy
          </span>
          Items marked as &quot;never export&quot; in your privacy settings will be automatically excluded from all exports. Only verified insights with &quot;exportable&quot; privacy tier are included.
        </p>
      </div>

    </div>
  );
}
