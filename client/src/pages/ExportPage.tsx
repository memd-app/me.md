import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useToast } from '@/contexts/ToastContext';
import { getExportStatus, exportAsMarkdown, exportAsJson } from '@/services/profile';
import { PageHeader } from '@/components/ui';

type ExportFormat = 'markdown' | 'json' | 'both';

export default function ExportPage() {
  const { user } = useUser();
  const db = useDatabase();
  const { addToast } = useToast();
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('markdown');
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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

  const downloadContent = (content: string, filename: string, mimeType = 'text/plain') => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
          ? 'Markdown and JSON files downloaded successfully!'
          : selectedFormat === 'markdown'
          ? 'Markdown file downloaded successfully!'
          : 'JSON file downloaded successfully!';

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
      setStatus({ type: 'success', message: 'Profile copied to clipboard!' });
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to copy. Please try again.' });
    } finally {
      setCopying(false);
    }
  };

  const hasExportableData = () => {
    // Check if there's verified data to export
    if (exportStatus && !exportStatus.hasVerifiedData) {
      addToast('No verified insights available to export. Complete interview sessions and verify insights first.', 'warning', 5000);
      setStatus({
        type: 'error',
        message: 'Nothing to export yet. To build your exportable profile: 1) Create topics and complete interview sessions, 2) Review and verify your insights on the Verification page, 3) Ensure verified insights have the "exportable" privacy tier.',
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

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        kicker="Export"
        title="Export Profile"
        subtitle="Export your verified profile as Markdown, JSON, or both formats"
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
              <Link to="/app/review" className="underline hover:text-primary-600 dark:hover:text-primary-400">Verify your insights</Link> on the Verification page
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
          Select Export Format
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
            Copy to Clipboard
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
