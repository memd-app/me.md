import { useState, useEffect, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';

type ExportFormat = 'markdown' | 'json' | 'both';
type ExportAction = 'download' | 'clipboard';

export default function ExportPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('markdown');
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Export readiness state
  const [exportStatus, setExportStatus] = useState<{ hasVerifiedData: boolean; verifiedInsightCount: number; topicCount: number } | null>(null);
  const [loadingExportStatus, setLoadingExportStatus] = useState(true);

  // Authentication verification state
  const [isVerified, setIsVerified] = useState(false);
  const [showVerifyDialog, setShowVerifyDialog] = useState(false);
  const [verifyPassword, setVerifyPassword] = useState('');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [pendingAction, setPendingAction] = useState<ExportAction | null>(null);

  // Check export readiness on mount
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();

    const checkExportStatus = async () => {
      try {
        const res = await fetch('/api/profile/export/status', {
          headers: { 'x-user-id': user.id },
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          if (!controller.signal.aborted) {
            setExportStatus(data);
          }
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

  const downloadFile = async (endpoint: string, filename: string) => {
    if (!user) return;
    const res = await fetch(endpoint, {
      headers: { 'x-user-id': user.id },
    });
    if (!res.ok) throw new Error(`Failed to export profile`);
    const blob = await res.blob();
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
      const safeName = user.name.replace(/[^a-zA-Z0-9]/g, '_');

      if (selectedFormat === 'markdown' || selectedFormat === 'both') {
        await downloadFile('/api/profile/export/markdown', `${safeName}_me.md`);
      }

      if (selectedFormat === 'json' || selectedFormat === 'both') {
        if (selectedFormat === 'both') {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        await downloadFile('/api/profile/export/json', `${safeName}_profile.json`);
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
      const res = await fetch('/api/profile/export/markdown', {
        headers: { 'x-user-id': user.id },
      });
      if (!res.ok) throw new Error('Failed to fetch profile');
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setStatus({ type: 'success', message: 'Profile copied to clipboard!' });
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to copy. Please try again.' });
    } finally {
      setCopying(false);
    }
  };

  const requireVerification = (action: ExportAction) => {
    // Check if there's verified data to export
    if (exportStatus && !exportStatus.hasVerifiedData) {
      addToast('No verified insights available to export. Complete interview sessions and verify insights first.', 'warning', 5000);
      setStatus({
        type: 'error',
        message: 'Nothing to export yet. To build your exportable profile: 1) Create topics and complete interview sessions, 2) Review and verify your insights on the Verification page, 3) Ensure verified insights have the "exportable" privacy tier.',
      });
      return;
    }

    if (isVerified) {
      // Already verified this session
      if (action === 'download') {
        performExport();
      } else {
        performCopy();
      }
      return;
    }
    setPendingAction(action);
    setShowVerifyDialog(true);
    setVerifyPassword('');
    setVerifyError(null);
  };

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setVerifyError(null);
    setVerifying(true);

    try {
      const res = await fetch('/api/auth/verify-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ password: verifyPassword }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Verification failed. Please check your password and try again.');
      }

      // Mark as verified for this session
      setIsVerified(true);
      setShowVerifyDialog(false);
      setVerifyPassword('');

      // Execute the pending action
      if (pendingAction === 'download') {
        performExport();
      } else if (pendingAction === 'clipboard') {
        performCopy();
      }
      setPendingAction(null);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Verification failed. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const handleCancelVerify = () => {
    setShowVerifyDialog(false);
    setVerifyPassword('');
    setVerifyError(null);
    setPendingAction(null);
  };

  const handleExport = () => requireVerification('download');
  const handleCopyToClipboard = () => requireVerification('clipboard');

  const formatOptions: { value: ExportFormat; label: string; icon: string; description: string }[] = [
    {
      value: 'markdown',
      label: 'Markdown',
      icon: '\uD83D\uDCDD',
      description: 'Export as a portable me.md file',
    },
    {
      value: 'json',
      label: 'JSON',
      icon: '\uD83D\uDCE6',
      description: 'Structured data for AI tools and APIs',
    },
    {
      value: 'both',
      label: 'Both',
      icon: '\uD83D\uDCCB',
      description: 'Download both Markdown and JSON files',
    },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Export Profile</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-300">
          Export your verified profile as Markdown, JSON, or both formats
        </p>
      </div>

      {/* No verified data warning */}
      {!loadingExportStatus && exportStatus && !exportStatus.hasVerifiedData && (
        <div className="mb-6 p-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                No verified data to export
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Your profile export will be empty because you don&apos;t have any verified, exportable insights yet. To build your profile:
              </p>
              <ol className="text-sm text-amber-700 dark:text-amber-300 mt-2 ml-4 list-decimal space-y-1">
                <li>
                  <Link to="/app/topics" className="underline hover:text-amber-900 dark:hover:text-amber-100">Create topics</Link> and complete interview sessions
                </li>
                <li>
                  <Link to="/app/verify" className="underline hover:text-amber-900 dark:hover:text-amber-100">Verify your insights</Link> on the Verification page
                </li>
                <li>Ensure verified insights have the &quot;exportable&quot; privacy tier</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Export readiness summary */}
      {!loadingExportStatus && exportStatus && exportStatus.hasVerifiedData && (
        <div className="mb-6 p-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 flex items-center gap-2">
          <svg className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <p className="text-sm text-green-700 dark:text-green-300">
            <strong>{exportStatus.verifiedInsightCount} verified insight{exportStatus.verifiedInsightCount !== 1 ? 's' : ''}</strong> across {exportStatus.topicCount} topic{exportStatus.topicCount !== 1 ? 's' : ''} ready to export.
          </p>
        </div>
      )}

      {/* Status message */}
      {status && (
        <div
          className={`mb-6 p-4 rounded-lg border ${
            status.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
          }`}
        >
          <p className="text-sm">{status.message}</p>
        </div>
      )}

      {/* Verification status banner */}
      {isVerified && (
        <div className="mb-6 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 flex items-center gap-2">
          <svg className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <p className="text-sm text-green-700 dark:text-green-300">
            <strong>Identity verified.</strong> You can export freely during this session.
          </p>
        </div>
      )}

      {/* Format selection */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
          Select Export Format
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {formatOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setSelectedFormat(option.value)}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                selectedFormat === option.value
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400 ring-1 ring-blue-500 dark:ring-blue-400'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">{option.icon}</span>
                <span className={`font-semibold ${
                  selectedFormat === option.value
                    ? 'text-blue-700 dark:text-blue-300'
                    : 'text-gray-900 dark:text-white'
                }`}>
                  {option.label}
                </span>
              </div>
              <p className={`text-sm ${
                selectedFormat === option.value
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-300'
              }`}>
                {option.description}
              </p>
              {selectedFormat === option.value && (
                <div className="mt-2 flex items-center gap-1">
                  <svg className="w-4 h-4 text-blue-500 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Selected</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Export button */}
      <div className="card mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
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
            {!isVerified && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                Requires identity verification
              </p>
            )}
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="btn-primary"
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
      </div>

      {/* Copy to clipboard */}
      <div className="card mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Copy to Clipboard
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Copy your profile as markdown directly to paste into any AI tool
            </p>
            {!isVerified && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                Requires identity verification
              </p>
            )}
          </div>
          <button
            onClick={handleCopyToClipboard}
            disabled={copying}
            className="btn-secondary"
          >
            {copying ? 'Copying...' : 'Copy Profile'}
          </button>
        </div>
      </div>

      {/* Privacy note */}
      <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
        <p className="text-sm text-amber-800 dark:text-amber-200">
          <strong>Privacy:</strong> Items marked as &quot;never export&quot; in your privacy settings will be automatically excluded from all exports. Only verified insights with &quot;exportable&quot; privacy tier are included.
        </p>
      </div>

      {/* Authentication Verification Dialog */}
      {showVerifyDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true" aria-labelledby="verify-dialog-title">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <h3 id="verify-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-white">
                  Verify Your Identity
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-300">
                  Export requires authentication confirmation
                </p>
              </div>
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              To protect your data, please enter your password to confirm your identity before exporting.
            </p>

            {verifyError && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
                {verifyError}
              </div>
            )}

            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <label htmlFor="verify-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Password
                </label>
                <input
                  id="verify-password"
                  type="password"
                  required
                  value={verifyPassword}
                  onChange={(e) => { setVerifyPassword(e.target.value); if (verifyError) setVerifyError(null); }}
                  className="input-field"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  autoFocus
                />
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={handleCancelVerify}
                  className="btn-secondary"
                  disabled={verifying}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={verifying || !verifyPassword}
                  className="btn-primary"
                >
                  {verifying ? 'Verifying...' : 'Verify & Export'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
