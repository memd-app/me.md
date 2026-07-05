import { useState, useMemo, FormEvent } from 'react';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { Link } from 'react-router-dom';
import { importUrls, importText, importFile, importChatGPT, processImport } from '@/services/import';
import { PageHeader, SectionHeading, Badge } from '@/components/ui';
import ObsidianImportPanel from '@/components/import/ObsidianImportPanel';
import type { NoteResult } from '@/services/obsidianImport';

type ImportMethod = 'chatgpt' | 'url' | 'text' | 'file' | 'obsidian';

interface ExtractedInsight {
  id: string;
  content: string;
  confidenceScore: number;
  verificationStatus: string;
  suggestedCategory: string;
}

interface ImportResult {
  id: string;
  source: ImportMethod;
  status: 'success' | 'error';
  title?: string;
  summary?: string;
  error?: string;
  sectionCount?: number;
  // Processing state
  isProcessing?: boolean;
  isProcessed?: boolean;
  extractedInsights?: ExtractedInsight[];
  topicCreated?: { id: string; title: string };
  processError?: string;
}

const CHATGPT_EXTRACTION_PROMPT = `I'd like you to help me extract a comprehensive summary of everything you know about me from our conversation history. Please organize your response using the following sections, using **bold headers** for each:

**Personal Background:** Name, age, location, occupation, education, family situation

**Communication Style:** How I tend to communicate, my tone preferences, formality level, common phrases I use

**Values & Beliefs:** Core values, principles I live by, things I care deeply about

**Interests & Hobbies:** What I enjoy doing, topics I'm passionate about, how I spend my free time

**Professional Life:** Career goals, work style, professional skills, industry knowledge

**Decision-Making Style:** How I typically approach decisions, risk tolerance, what factors I weigh

**Strengths & Weaknesses:** Self-identified or observed strengths and areas for growth

**Goals & Aspirations:** Short-term and long-term goals, dreams, what success looks like to me

**Preferences:** Communication preferences, tool preferences, aesthetic preferences, lifestyle choices

**Personality Traits:** Observable personality characteristics, temperament, social tendencies

Please be thorough and specific. Include concrete examples where possible. If you don't have information for a section, note that it's unknown rather than making assumptions.`;

/** Quiet numbered editorial marker — DESIGN.md "numbered editorial markers". */
function StepMarker({ step }: { step: number }) {
  return (
    <span className="font-sans text-[11px] tracking-[0.08em] text-ink/40 dark:text-[#7A7264] tabular-nums pt-1 shrink-0">
      {String(step).padStart(2, '0')}
    </span>
  );
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
  );
}

export default function ImportPage() {
  const { user } = useUser();
  const db = useDatabase();
  const [activeMethod, setActiveMethod] = useState<ImportMethod>('chatgpt');
  const [importResults, setImportResults] = useState<ImportResult[]>([]);

  // ChatGPT state
  const [chatgptOutput, setChatgptOutput] = useState('');
  const [chatgptTitle, setChatgptTitle] = useState('');
  const [isProcessingChatgpt, setIsProcessingChatgpt] = useState(false);
  const [chatgptError, setChatgptError] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);

  // URL state
  const [urlInput, setUrlInput] = useState('');
  const [isProcessingUrl, setIsProcessingUrl] = useState(false);
  const [urlError, setUrlError] = useState('');

  // Text state
  const [pasteText, setPasteText] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [isProcessingText, setIsProcessingText] = useState(false);
  const [pasteError, setPasteError] = useState('');

  // File state
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [fileError, setFileError] = useState('');
  const [isObsidianBusy, setIsObsidianBusy] = useState(false);

  // Track unsaved changes in import forms
  const isImportDirty = useMemo(() => {
    return (
      chatgptOutput.trim() !== '' ||
      chatgptTitle.trim() !== '' ||
      urlInput.trim() !== '' ||
      pasteText.trim() !== '' ||
      pasteTitle.trim() !== '' ||
      isObsidianBusy
    );
  }, [chatgptOutput, chatgptTitle, urlInput, pasteText, pasteTitle, isObsidianBusy]);

  useUnsavedChangesWarning(isImportDirty);

  // Process an imported file to extract insights
  const handleProcessImport = async (resultIdx: number) => {
    const result = importResults[resultIdx];
    if (!result || !result.id || result.isProcessed || result.isProcessing) return;

    const userId = user?.id;
    if (!userId) return;

    // Mark as processing
    setImportResults((prev) =>
      prev.map((r, i) => (i === resultIdx ? { ...r, isProcessing: true, processError: undefined } : r))
    );

    try {
      const data = await processImport(db, result.id);

      setImportResults((prev) =>
        prev.map((r, i) =>
          i === resultIdx
            ? {
                ...r,
                isProcessing: false,
                isProcessed: true,
                extractedInsights: data.insights || [],
                topicCreated: data.topicCreated,
              } as ImportResult
            : r
        )
      );
    } catch (err) {
      setImportResults((prev) =>
        prev.map((r, i) =>
          i === resultIdx
            ? { ...r, isProcessing: false, processError: err instanceof Error ? err.message : 'Failed to process' }
            : r
        )
      );
    }
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(CHATGPT_EXTRACTION_PROMPT);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = CHATGPT_EXTRACTION_PROMPT;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setPromptCopied(true);
        setTimeout(() => setPromptCopied(false), 2000);
      } catch {
        setChatgptError('Failed to copy prompt. Please select and copy it manually.');
      }
      document.body.removeChild(textArea);
    }
  };

  const handleChatgptSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setChatgptError('');

    const trimmed = chatgptOutput.trim();
    if (!trimmed) {
      setChatgptError('Please paste the ChatGPT response');
      return;
    }

    if (trimmed.length < 20) {
      setChatgptError('The response seems too short. Please paste the full ChatGPT output.');
      return;
    }

    setIsProcessingChatgpt(true);

    try {
      const userId = user?.id;
      if (!userId) {
        setChatgptError('Not authenticated');
        return;
      }

      const data = importChatGPT(db, trimmed, chatgptTitle.trim() || undefined);

      setImportResults((prev) => [
        ...prev,
        {
          id: data.id,
          source: 'chatgpt',
          status: 'success',
          title: data.title || 'ChatGPT Memory Extraction',
          summary: data.summary,
          sectionCount: data.sectionCount,
        },
      ]);

      setChatgptOutput('');
      setChatgptTitle('');
    } catch (err) {
      setChatgptError(err instanceof Error ? err.message : 'Failed to import ChatGPT context');
    } finally {
      setIsProcessingChatgpt(false);
    }
  };

  const handleUrlSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setUrlError('');

    const trimmedUrl = urlInput.trim();
    if (!trimmedUrl) {
      setUrlError('Please enter a URL');
      return;
    }

    try {
      const parsed = new URL(trimmedUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setUrlError('Only http and https URLs are supported');
        return;
      }
    } catch {
      setUrlError('Please enter a valid URL (e.g., https://example.com)');
      return;
    }

    setIsProcessingUrl(true);

    try {
      const userId = user?.id;
      if (!userId) {
        setUrlError('Not authenticated');
        return;
      }

      const data = await importUrls(db, [trimmedUrl]);

      if (data.results && data.results.length > 0) {
        setImportResults((prev) => [
          ...prev,
          ...data.results.map((r: { id: string; url: string; status: 'success' | 'error'; title?: string; summary?: string; error?: string }) => ({
            ...r,
            source: 'url' as const,
          })),
        ]);
      }

      setUrlInput('');
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : 'Failed to process URL');
    } finally {
      setIsProcessingUrl(false);
    }
  };

  const handleTextSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setPasteError('');

    const trimmedText = pasteText.trim();
    if (!trimmedText) {
      setPasteError('Please enter some text');
      return;
    }

    if (trimmedText.length < 10) {
      setPasteError('Please enter at least 10 characters');
      return;
    }

    setIsProcessingText(true);

    try {
      const userId = user?.id;
      if (!userId) {
        setPasteError('Not authenticated');
        return;
      }

      const data = importText(db, trimmedText, pasteTitle.trim() || undefined);

      setImportResults((prev) => [
        ...prev,
        {
          id: data.id,
          source: 'text',
          status: 'success',
          title: data.title || 'Pasted text',
          summary: data.summary,
        },
      ]);

      setPasteText('');
      setPasteTitle('');
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : 'Failed to import text');
    } finally {
      setIsProcessingText(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError('');
    setIsUploadingFile(true);

    try {
      const userId = user?.id;
      if (!userId) {
        setFileError('Not authenticated');
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        setFileError('File too large. Maximum size is 5MB.');
        return;
      }

      const data = await importFile(db, file);

      setImportResults((prev) => [
        ...prev,
        {
          id: data.id,
          source: 'file',
          status: 'success',
          title: data.title || data.filename || 'Uploaded file',
          summary: data.summary,
        },
      ]);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Failed to upload file');
      setImportResults((prev) => [
        ...prev,
        {
          id: '',
          source: 'file',
          status: 'error',
          title: file.name,
          error: err instanceof Error ? err.message : 'Failed to upload file',
        },
      ]);
    } finally {
      setIsUploadingFile(false);
      // Reset file input
      e.target.value = '';
    }
  };

  const handleObsidianImported = (results: NoteResult[]) => {
    setImportResults((prev) => [
      ...prev,
      ...results.map((result) => ({
        id: result.importId || '',
        source: 'obsidian' as const,
        status: 'success' as const,
        title: result.title,
        summary: `Imported from Obsidian vault: ${result.path}`,
        isProcessed: true,
        extractedInsights: result.insights || [],
        topicCreated: result.topicCreated,
      })),
    ]);
  };

  const methods: { key: ImportMethod; label: string; description: string }[] = [
    { key: 'chatgpt', label: 'ChatGPT Memory', description: 'Extract memories from ChatGPT' },
    { key: 'url', label: 'URL', description: 'Import from a web page' },
    { key: 'text', label: 'Paste Text', description: 'Paste text content' },
    { key: 'file', label: 'Upload File', description: 'Upload a document' },
    { key: 'obsidian', label: 'Obsidian Vault', description: 'Import notes from your Obsidian vault' },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        kicker="Library"
        title="Import"
        subtitle="Bring in what you've already written — it gives the interviewer a head start."
      />

      {/* Method tabs — small-caps amber-underline row */}
      <div
        className="flex flex-wrap gap-x-8 gap-y-2 border-b border-rule dark:border-dark-border mb-8"
        role="tablist"
        aria-label="Import method"
      >
        {methods.map((method) => (
          <button
            key={method.key}
            type="button"
            role="tab"
            aria-selected={activeMethod === method.key}
            aria-controls={`import-panel-${method.key}`}
            id={`import-tab-${method.key}`}
            onClick={() => setActiveMethod(method.key)}
            className={`pb-3 pt-1 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold border-b-2 transition-colors ${
              activeMethod === method.key
                ? 'border-primary-500 text-ink dark:text-gray-100'
                : 'border-transparent text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400'
            }`}
            title={method.description}
          >
            {method.label}
          </button>
        ))}
      </div>

      {/* ChatGPT Memory Extraction */}
      {activeMethod === 'chatgpt' && (
        <div id="import-panel-chatgpt" role="tabpanel" aria-labelledby="import-tab-chatgpt" className="space-y-10">
          {/* Step 1: Copy prompt */}
          <div>
            <div className="flex items-start gap-4 mb-4">
              <StepMarker step={1} />
              <div>
                <h3 className="font-serif text-lg text-ink dark:text-gray-100">Copy this prompt to ChatGPT</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  Open{' '}
                  <a
                    href="https://chat.openai.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    chat.openai.com
                  </a>{' '}
                  and paste this prompt into your conversation. ChatGPT will summarize what it knows about you.
                </p>
              </div>
            </div>

            <div className="relative ml-8">
              <pre className="bg-panel dark:bg-dark-card rounded-md p-4 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto border border-rule dark:border-dark-border">
                {CHATGPT_EXTRACTION_PROMPT}
              </pre>
              <button
                onClick={handleCopyPrompt}
                className={`absolute top-2 right-2 px-3 py-1.5 rounded-md text-[11px] uppercase tracking-[0.08em] font-sans font-semibold transition-colors bg-white dark:bg-dark-card border ${
                  promptCopied
                    ? 'border-primary-500 dark:border-primary-400 text-primary-600 dark:text-primary-400'
                    : 'border-rule dark:border-dark-border text-gray-600 dark:text-gray-300 hover:border-primary-400 dark:hover:border-primary-500 hover:text-primary-600 dark:hover:text-primary-400'
                }`}
                aria-label={promptCopied ? 'Prompt copied to clipboard' : 'Copy prompt to clipboard'}
              >
                {promptCopied ? (
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Step 2: Paste response */}
          <div>
            <div className="flex items-start gap-4 mb-4">
              <StepMarker step={2} />
              <div>
                <h3 className="font-serif text-lg text-ink dark:text-gray-100">Paste ChatGPT&apos;s response</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  After ChatGPT generates its summary, copy the entire response and paste it below.
                </p>
              </div>
            </div>

            <form onSubmit={handleChatgptSubmit} className="space-y-4 ml-8">
              <div>
                <label htmlFor="chatgpt-title" className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                  Title (optional)
                </label>
                <input
                  id="chatgpt-title"
                  type="text"
                  value={chatgptTitle}
                  onChange={(e) => setChatgptTitle(e.target.value)}
                  className="input-field w-full"
                  placeholder="e.g., My ChatGPT Memory - February 2026"
                  disabled={isProcessingChatgpt}
                />
              </div>

              <div>
                <label htmlFor="chatgpt-output" className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                  ChatGPT Response
                </label>
                <textarea
                  id="chatgpt-output"
                  value={chatgptOutput}
                  onChange={(e) => {
                    setChatgptOutput(e.target.value);
                    if (chatgptError) setChatgptError('');
                  }}
                  className="input-field w-full min-h-[200px] resize-y font-mono text-sm"
                  placeholder="Paste the full ChatGPT response here...&#10;&#10;**Personal Background:** ...&#10;**Communication Style:** ...&#10;**Values & Beliefs:** ..."
                  disabled={isProcessingChatgpt}
                  rows={10}
                />
                {chatgptOutput.trim().length > 0 && (
                  <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                    {chatgptOutput.trim().length} characters
                  </p>
                )}
              </div>

              {chatgptError && (
                <p className="text-sm text-red-600 dark:text-red-400" role="alert">{chatgptError}</p>
              )}

              <button
                type="submit"
                disabled={isProcessingChatgpt || !chatgptOutput.trim()}
                className="btn-primary w-full py-2.5"
              >
                {isProcessingChatgpt ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner />
                    Processing&hellip;
                  </span>
                ) : (
                  'Import ChatGPT Context'
                )}
              </button>
            </form>
          </div>

          {/* Info note */}
          <div className="bg-panel dark:bg-dark-card border border-rule dark:border-dark-border rounded-md px-4 py-3.5">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              <span className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-primary-600 dark:text-primary-400 mb-1">
                How it works
              </span>
              The prompt asks ChatGPT to extract structured information about you from your conversation history. This provides a rich starting point for your me.md profile, covering personality, preferences, goals, and more.
            </p>
          </div>
        </div>
      )}

      {/* URL Import */}
      {activeMethod === 'url' && (
        <div id="import-panel-url" role="tabpanel" aria-labelledby="import-tab-url" className="card">
          <h3 className="font-serif text-lg text-ink dark:text-gray-100 mb-2">Import from URL</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            Add links to your blog, portfolio, LinkedIn, or any page about you
          </p>

          <form onSubmit={handleUrlSubmit} className="flex gap-2">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                setUrlError('');
              }}
              className="input-field flex-1"
              placeholder="https://example.com/about-me"
              disabled={isProcessingUrl}
            />
            <button
              type="submit"
              disabled={isProcessingUrl || !urlInput.trim()}
              className="btn-primary px-4 py-2 whitespace-nowrap"
            >
              {isProcessingUrl ? (
                <span className="flex items-center gap-2">
                  <Spinner />
                  Processing&hellip;
                </span>
              ) : (
                'Add URL'
              )}
            </button>
          </form>

          {urlError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">{urlError}</p>
          )}
        </div>
      )}

      {/* Text Import */}
      {activeMethod === 'text' && (
        <div id="import-panel-text" role="tabpanel" aria-labelledby="import-tab-text" className="card">
          <h3 className="font-serif text-lg text-ink dark:text-gray-100 mb-2">Paste Text</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            Paste text about yourself - a bio, interests, resume excerpt, or anything that describes you
          </p>

          <form onSubmit={handleTextSubmit} className="space-y-3">
            <input
              type="text"
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              className="input-field w-full"
              placeholder="Title (optional) - e.g., My Bio, Personal Interests"
              disabled={isProcessingText}
            />
            <textarea
              value={pasteText}
              onChange={(e) => {
                setPasteText(e.target.value);
                setPasteError('');
              }}
              className="input-field w-full min-h-[150px] resize-y"
              placeholder="Paste your text here..."
              disabled={isProcessingText}
              rows={6}
            />
            {pasteText.trim().length > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {pasteText.trim().length} characters
              </p>
            )}
            <button
              type="submit"
              disabled={isProcessingText || !pasteText.trim()}
              className="btn-primary w-full py-2"
            >
              {isProcessingText ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner />
                  Processing&hellip;
                </span>
              ) : (
                'Import Text'
              )}
            </button>
          </form>

          {pasteError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">{pasteError}</p>
          )}
        </div>
      )}

      {/* File Upload */}
      {activeMethod === 'file' && (
        <div id="import-panel-file" role="tabpanel" aria-labelledby="import-tab-file" className="card">
          <h3 className="font-serif text-lg text-ink dark:text-gray-100 mb-2">Upload File</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            Upload a text file, markdown, CSV, JSON, or PDF (max 5MB)
          </p>

          <div className="space-y-3">
            <input
              type="file"
              accept=".txt,.md,.csv,.json,.pdf,text/plain,text/markdown,text/csv,application/json,application/pdf"
              onChange={handleFileUpload}
              className="hidden"
              id="import-file-upload"
              disabled={isUploadingFile}
            />
            <label
              htmlFor="import-file-upload"
              className={`flex flex-col items-center justify-center w-full h-40 border border-dashed rounded-md cursor-pointer transition-colors ${
                isUploadingFile
                  ? 'border-rule dark:border-dark-border cursor-wait'
                  : 'border-rule dark:border-dark-border hover:border-primary-400 dark:hover:border-primary-500 hover:bg-panel/60 dark:hover:bg-dark-card/60'
              }`}
            >
              {isUploadingFile ? (
                <div className="flex flex-col items-center gap-2">
                  <Spinner className="w-6 h-6 text-primary-500" />
                  <span className="text-sm text-gray-600 dark:text-gray-300">Uploading and processing...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <svg className="w-6 h-6 text-gray-400 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span className="text-sm text-gray-600 dark:text-gray-300">
                    Click to select a file
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.08em] font-sans text-gray-400 dark:text-gray-600">
                    .txt · .md · .csv · .json · .pdf
                  </span>
                </div>
              )}
            </label>
          </div>

          {fileError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">{fileError}</p>
          )}
        </div>
      )}

      {activeMethod === 'obsidian' && (
        <div id="import-panel-obsidian" role="tabpanel" aria-labelledby="import-tab-obsidian" className="space-y-10">
          <ObsidianImportPanel
            db={db}
            userId={user?.id}
            onImported={handleObsidianImported}
            onBusyChange={setIsObsidianBusy}
          />
        </div>
      )}

      {/* Import Results — hairline rows, typographic status */}
      {importResults.length > 0 && (
        <div className="mt-10">
          <SectionHeading className="mb-2">Imported ({importResults.length})</SectionHeading>
          <div className="divide-y divide-rule dark:divide-dark-border">
            {importResults.map((result, idx) => (
              <div key={result.id || idx} className="py-5">
                {result.status === 'success' ? (
                  <>
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="verified" label="Imported" />
                        <span className="font-serif text-ink dark:text-gray-100 truncate">
                          {result.title || 'Untitled'}
                        </span>
                      </div>
                      <span className="text-[11px] uppercase tracking-[0.08em] font-sans font-medium text-gray-400 dark:text-gray-600 shrink-0 whitespace-nowrap">
                        {result.source === 'chatgpt' ? 'ChatGPT' : result.source === 'url' ? 'URL' : result.source === 'text' ? 'Text' : result.source === 'obsidian' ? 'Obsidian' : 'File'}
                        {result.sectionCount != null && result.sectionCount > 0 && ` · ${result.sectionCount} sections`}
                        {result.isProcessed && ` · ${result.extractedInsights?.length || 0} insights`}
                      </span>
                    </div>

                    {result.summary && !result.isProcessed && (
                      <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-3 max-w-2xl">
                        {result.summary}
                      </p>
                    )}

                    {/* Process button - shown when not yet processed */}
                    {!result.isProcessed && !result.isProcessing && (
                      <button
                        onClick={() => handleProcessImport(idx)}
                        className="mt-3 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-primary-600 dark:text-primary-400 hover:text-ink dark:hover:text-gray-100 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Extract Insights for Review
                      </button>
                    )}

                    {/* Processing spinner */}
                    {result.isProcessing && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-primary-600 dark:text-primary-400">
                        <Spinner />
                        Extracting personal insights&hellip;
                      </div>
                    )}

                    {/* Process error */}
                    {result.processError && (
                      <p className="mt-2 text-sm text-red-600 dark:text-red-400">{result.processError}</p>
                    )}
                  </>
                ) : (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-red-600 dark:text-red-400">
                        Failed
                      </span>
                      <span className="text-sm text-gray-600 dark:text-gray-300 truncate">
                        {result.title || 'Unknown'}
                      </span>
                    </div>
                    {result.error && (
                      <p className="text-xs text-red-600 dark:text-red-400">{result.error}</p>
                    )}
                  </div>
                )}

                {/* Extracted Insights Panel */}
                {result.isProcessed && result.extractedInsights && result.extractedInsights.length > 0 && (
                  <div className="mt-4 pl-4 border-l-2 border-rule dark:border-dark-border">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                      <p className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400">
                        Extracted insights ({result.extractedInsights.length})
                      </p>
                      <div className="flex items-center gap-4">
                        {result.topicCreated && (
                          <Link
                            to="/app/topics"
                            className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-primary-600 dark:text-primary-400 hover:text-ink dark:hover:text-gray-100 transition-colors"
                          >
                            View Topic
                          </Link>
                        )}
                        <Link
                          to="/app/review"
                          className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-primary-600 dark:text-primary-400 hover:text-ink dark:hover:text-gray-100 transition-colors"
                        >
                          Go to Review
                        </Link>
                      </div>
                    </div>

                    <div className="space-y-3 max-h-80 overflow-y-auto">
                      {result.extractedInsights.map((insight, iIdx) => (
                        <div key={insight.id || iIdx} className="pb-3 border-b border-rule dark:border-dark-border last:border-b-0 last:pb-0">
                          <p className="text-sm text-gray-800 dark:text-gray-200 leading-snug mb-1.5">
                            {insight.content}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <Badge variant="pending" confidence={insight.confidenceScore} />
                            <span className="text-gray-300 dark:text-gray-700" aria-hidden="true">&middot;</span>
                            <span className="text-[10.5px] uppercase tracking-[0.08em] font-sans font-medium text-gray-500 dark:text-gray-400">
                              {insight.suggestedCategory}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 bg-panel dark:bg-dark-card border border-rule dark:border-dark-border rounded-md px-3 py-2.5">
                      <p className="text-xs text-gray-700 dark:text-gray-300">
                        <span className="font-sans font-semibold text-[10.5px] uppercase tracking-[0.08em] text-primary-600 dark:text-primary-400 mr-1">
                          Next step
                        </span>
                        These insights are now in your{' '}
                        <Link to="/app/review" className="underline hover:text-primary-600 dark:hover:text-primary-400">
                          review queue
                        </Link>
                        . Confirm, edit, or reject each one. Only verified insights will appear in your profile export.
                      </p>
                    </div>
                  </div>
                )}

                {/* No insights extracted message */}
                {result.isProcessed && (!result.extractedInsights || result.extractedInsights.length === 0) && (
                  <p className="mt-3 text-sm text-gray-600 dark:text-gray-400 pl-4 border-l-2 border-rule dark:border-dark-border">
                    No personal insights could be extracted from this content. Try importing content that contains personal statements, beliefs, preferences, or experiences.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
