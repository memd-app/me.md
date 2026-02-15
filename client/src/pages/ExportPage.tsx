import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

type ExportFormat = 'markdown' | 'json' | 'both';

export default function ExportPage() {
  const { user } = useAuth();
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('markdown');
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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

  const handleExport = async () => {
    if (!user) return;
    try {
      setExporting(true);
      setStatus(null);
      const safeName = user.name.replace(/[^a-zA-Z0-9]/g, '_');

      if (selectedFormat === 'markdown' || selectedFormat === 'both') {
        await downloadFile('/api/profile/export/markdown', `${safeName}_me.md`);
      }

      if (selectedFormat === 'json' || selectedFormat === 'both') {
        // Small delay between downloads so browser handles both
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
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to export' });
    } finally {
      setExporting(false);
    }
  };

  const handleCopyToClipboard = async () => {
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
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to copy' });
    } finally {
      setCopying(false);
    }
  };

  const formatOptions: { value: ExportFormat; label: string; icon: string; description: string }[] = [
    {
      value: 'markdown',
      label: 'Markdown',
      icon: '📝',
      description: 'Export as a portable me.md file',
    },
    {
      value: 'json',
      label: 'JSON',
      icon: '📦',
      description: 'Structured data for AI tools and APIs',
    },
    {
      value: 'both',
      label: 'Both',
      icon: '📋',
      description: 'Download both Markdown and JSON files',
    },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Export Profile</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Export your verified profile as Markdown, JSON, or both formats
        </p>
      </div>

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
                  : 'text-gray-500 dark:text-gray-400'
              }`}>
                {option.description}
              </p>
              {/* Selection indicator */}
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
            <p className="text-sm text-gray-600 dark:text-gray-400">
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
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Copy your profile as markdown directly to paste into any AI tool
            </p>
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
    </div>
  );
}
