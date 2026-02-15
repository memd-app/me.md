import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function ExportPage() {
  const { user } = useAuth();
  const [exportingMd, setExportingMd] = useState(false);
  const [exportingJson, setExportingJson] = useState(false);
  const [copying, setCopying] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleExportMarkdown = async () => {
    if (!user) return;
    try {
      setExportingMd(true);
      setStatus(null);
      const res = await fetch('/api/profile/export/markdown', {
        headers: { 'x-user-id': user.id },
      });
      if (!res.ok) throw new Error('Failed to export profile');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${user.name.replace(/[^a-zA-Z0-9]/g, '_')}_me.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus({ type: 'success', message: 'Markdown file downloaded successfully!' });
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to export' });
    } finally {
      setExportingMd(false);
    }
  };

  const handleExportJson = async () => {
    if (!user) return;
    try {
      setExportingJson(true);
      setStatus(null);
      const res = await fetch('/api/profile/export/json', {
        headers: { 'x-user-id': user.id },
      });
      if (!res.ok) throw new Error('Failed to export profile');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${user.name.replace(/[^a-zA-Z0-9]/g, '_')}_profile.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus({ type: 'success', message: 'JSON file downloaded successfully!' });
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to export' });
    } finally {
      setExportingJson(false);
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

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Export</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Export your verified profile as me.md or JSON
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

      {/* Export options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-start gap-3 mb-4">
            <span className="text-2xl">📝</span>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Markdown (me.md)
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Export your verified profile as a portable markdown file
              </p>
            </div>
          </div>
          <button
            onClick={handleExportMarkdown}
            disabled={exportingMd}
            className="btn-primary w-full"
          >
            {exportingMd ? 'Downloading...' : 'Download me.md'}
          </button>
        </div>

        <div className="card">
          <div className="flex items-start gap-3 mb-4">
            <span className="text-2xl">📦</span>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                JSON Data
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Export structured data for use with AI tools and APIs
              </p>
            </div>
          </div>
          <button
            onClick={handleExportJson}
            disabled={exportingJson}
            className="btn-secondary w-full"
          >
            {exportingJson ? 'Downloading...' : 'Download JSON'}
          </button>
        </div>
      </div>

      {/* Copy to clipboard */}
      <div className="card mt-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Copy to Clipboard
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Copy your profile directly to paste into any AI tool
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
      <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
        <p className="text-sm text-amber-800 dark:text-amber-200">
          <strong>Privacy:</strong> Items marked as &quot;never export&quot; in your privacy settings will be automatically excluded from all exports.
        </p>
      </div>
    </div>
  );
}
