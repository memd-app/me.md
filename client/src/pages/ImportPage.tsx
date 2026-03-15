import { useState, useMemo, FormEvent } from 'react';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { Link } from 'react-router-dom';
import { importUrls, importText, importFile, importChatGPT, importLinkedIn, importResume, processImport } from '@/services/import';

type ImportMethod = 'chatgpt' | 'url' | 'text' | 'file' | 'linkedin' | 'resume';

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

  // LinkedIn state
  const [linkedinJson, setLinkedinJson] = useState('');
  const [isProcessingLinkedin, setIsProcessingLinkedin] = useState(false);
  const [linkedinError, setLinkedinError] = useState('');

  // Resume state
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [resumeError, setResumeError] = useState('');

  // Track unsaved changes in import forms
  const isImportDirty = useMemo(() => {
    return (
      chatgptOutput.trim() !== '' ||
      chatgptTitle.trim() !== '' ||
      urlInput.trim() !== '' ||
      pasteText.trim() !== '' ||
      pasteTitle.trim() !== '' ||
      linkedinJson.trim() !== ''
    );
  }, [chatgptOutput, chatgptTitle, urlInput, pasteText, pasteTitle, linkedinJson]);

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

  const handleLinkedinSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLinkedinError('');
    const trimmed = linkedinJson.trim();
    if (!trimmed) { setLinkedinError('Please paste your LinkedIn export data'); return; }

    setIsProcessingLinkedin(true);
    try {
      const userId = user?.id;
      if (!userId) { setLinkedinError('Not authenticated'); return; }
      const data = importLinkedIn(db, trimmed);
      setImportResults((prev) => [...prev, { id: data.id, source: 'linkedin', status: 'success', title: data.title, summary: data.summary }]);
      setLinkedinJson('');
    } catch (err) {
      setLinkedinError(err instanceof Error ? err.message : 'Failed to import LinkedIn data');
    } finally {
      setIsProcessingLinkedin(false);
    }
  };

  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResumeError('');
    setIsUploadingResume(true);
    try {
      const userId = user?.id;
      if (!userId) { setResumeError('Not authenticated'); return; }
      const data = await importResume(db, file);
      setImportResults((prev) => [...prev, { id: data.id, source: 'resume', status: 'success', title: data.title, summary: data.summary }]);
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : 'Failed to import resume');
    } finally {
      setIsUploadingResume(false);
      e.target.value = '';
    }
  };

  const methods: { key: ImportMethod; label: string; icon: string; description: string }[] = [
    { key: 'chatgpt', label: 'ChatGPT Memory', icon: '\uD83E\uDD16', description: 'Extract memories from ChatGPT' },
    { key: 'linkedin', label: 'LinkedIn', icon: '\uD83D\uDCBC', description: 'Import LinkedIn data export' },
    { key: 'resume', label: 'Resume / CV', icon: '\uD83D\uDCC4', description: 'Upload a PDF resume' },
    { key: 'url', label: 'URL', icon: '\uD83D\uDD17', description: 'Import from a web page' },
    { key: 'text', label: 'Paste Text', icon: '\uD83D\uDCDD', description: 'Paste text content' },
    { key: 'file', label: 'Upload File', icon: '\uD83D\uDCC1', description: 'Upload a document' },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Import Context</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-300">
          Import existing personal context to accelerate your knowledge building
        </p>
      </div>

      {/* Method Selection */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        {methods.map((method) => (
          <button
            key={method.key}
            onClick={() => setActiveMethod(method.key)}
            className={`p-3 rounded-xl border-2 text-left transition-all ${
              activeMethod === method.key
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 shadow-sm'
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <span className="text-2xl block mb-1">{method.icon}</span>
            <span className={`text-sm font-semibold block ${
              activeMethod === method.key
                ? 'text-primary-700 dark:text-primary-300'
                : 'text-gray-900 dark:text-white'
            }`}>
              {method.label}
            </span>
            <span className={`text-xs block mt-0.5 ${
              activeMethod === method.key
                ? 'text-primary-600 dark:text-primary-400'
                : 'text-gray-500 dark:text-gray-400'
            }`}>
              {method.description}
            </span>
          </button>
        ))}
      </div>

      {/* ChatGPT Memory Extraction */}
      {activeMethod === 'chatgpt' && (
        <div className="space-y-6">
          {/* Step 1: Copy prompt */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-blue-700 dark:text-blue-300">1</span>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">Copy this prompt to ChatGPT</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  Open <a href="https://chat.openai.com" target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 hover:underline">chat.openai.com</a> and paste this prompt into your conversation. ChatGPT will summarize what it knows about you.
                </p>
              </div>
            </div>

            <div className="relative">
              <pre className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700">
                {CHATGPT_EXTRACTION_PROMPT}
              </pre>
              <button
                onClick={handleCopyPrompt}
                className={`absolute top-2 right-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  promptCopied
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-300 dark:border-green-700'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm'
                }`}
                aria-label={promptCopied ? 'Prompt copied to clipboard' : 'Copy prompt to clipboard'}
              >
                {promptCopied ? (
                  <span className="flex items-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Step 2: Paste response */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-blue-700 dark:text-blue-300">2</span>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">Paste ChatGPT&apos;s response</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  After ChatGPT generates its summary, copy the entire response and paste it below.
                </p>
              </div>
            </div>

            <form onSubmit={handleChatgptSubmit} className="space-y-4">
              <div>
                <label htmlFor="chatgpt-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
                <label htmlFor="chatgpt-output" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {chatgptOutput.trim().length} characters
                  </p>
                )}
              </div>

              {chatgptError && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm" role="alert">
                  {chatgptError}
                </div>
              )}

              <button
                type="submit"
                disabled={isProcessingChatgpt || !chatgptOutput.trim()}
                className="btn-primary w-full py-2.5"
              >
                {isProcessingChatgpt ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Processing...
                  </span>
                ) : (
                  'Import ChatGPT Context'
                )}
              </button>
            </form>
          </div>

          {/* Info card */}
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>How it works:</strong> The prompt asks ChatGPT to extract structured information about you from your conversation history. This provides a rich starting point for your me.md profile, covering personality, preferences, goals, and more.
            </p>
          </div>
        </div>
      )}

      {/* URL Import */}
      {activeMethod === 'url' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Import from URL</h3>
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
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Processing...
                </span>
              ) : (
                'Add URL'
              )}
            </button>
          </form>

          {urlError && (
            <p className="mt-2 text-sm text-red-500" role="alert">{urlError}</p>
          )}
        </div>
      )}

      {/* Text Import */}
      {activeMethod === 'text' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Paste Text</h3>
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
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Processing...
                </span>
              ) : (
                'Import Text'
              )}
            </button>
          </form>

          {pasteError && (
            <p className="mt-2 text-sm text-red-500" role="alert">{pasteError}</p>
          )}
        </div>
      )}

      {/* File Upload */}
      {activeMethod === 'file' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Upload File</h3>
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
              className={`flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                isUploadingFile
                  ? 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 cursor-wait'
                  : 'border-gray-300 dark:border-gray-600 hover:border-primary-400 dark:hover:border-primary-500 hover:bg-gray-50 dark:hover:bg-gray-800/50'
              }`}
            >
              {isUploadingFile ? (
                <div className="flex flex-col items-center gap-2">
                  <svg className="animate-spin w-8 h-8 text-primary-600" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span className="text-sm text-gray-600 dark:text-gray-300">Uploading and processing...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span className="text-sm text-gray-600 dark:text-gray-300">
                    Click to select a file
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    .txt, .md, .csv, .json, .pdf
                  </span>
                </div>
              )}
            </label>
          </div>

          {fileError && (
            <p className="mt-2 text-sm text-red-500" role="alert">{fileError}</p>
          )}
        </div>
      )}

      {/* LinkedIn Import */}
      {activeMethod === 'linkedin' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Import LinkedIn Data</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            Go to <a href="https://www.linkedin.com/mypreferences/d/download-my-data" target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 hover:underline">LinkedIn Data Export</a>, request your data, then paste the JSON content from any of the downloaded files (e.g., Profile.json, Positions.json).
          </p>

          <form onSubmit={handleLinkedinSubmit} className="space-y-3">
            <textarea
              value={linkedinJson}
              onChange={(e) => { setLinkedinJson(e.target.value); if (linkedinError) setLinkedinError(''); }}
              className="input-field w-full min-h-[200px] resize-y font-mono text-sm"
              placeholder='Paste LinkedIn JSON data here...&#10;&#10;{"Profile": {"First Name": "...", "Headline": "..."}}'
              disabled={isProcessingLinkedin}
              rows={8}
            />
            {linkedinJson.trim().length > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{linkedinJson.trim().length} characters</p>
            )}
            <button type="submit" disabled={isProcessingLinkedin || !linkedinJson.trim()} className="btn-primary w-full py-2.5">
              {isProcessingLinkedin ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                  Processing...
                </span>
              ) : 'Import LinkedIn Data'}
            </button>
          </form>

          {linkedinError && <p className="mt-2 text-sm text-red-500" role="alert">{linkedinError}</p>}

          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-xs text-blue-800 dark:text-blue-200">
              <strong>Tip:</strong> You can also combine multiple LinkedIn JSON files by merging them into a single JSON object. The importer looks for Profile, Positions, Skills, Education, and Certifications data.
            </p>
          </div>
        </div>
      )}

      {/* Resume / CV Import */}
      {activeMethod === 'resume' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Upload Resume / CV</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            Upload your resume as a PDF. Text will be extracted and processed for insights about your experience, skills, and expertise.
          </p>

          <div className="space-y-3">
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleResumeUpload}
              className="hidden"
              id="resume-file-upload"
              disabled={isUploadingResume}
            />
            <label
              htmlFor="resume-file-upload"
              className={`flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                isUploadingResume
                  ? 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 cursor-wait'
                  : 'border-gray-300 dark:border-gray-600 hover:border-primary-400 dark:hover:border-primary-500 hover:bg-gray-50 dark:hover:bg-gray-800/50'
              }`}
            >
              {isUploadingResume ? (
                <div className="flex flex-col items-center gap-2">
                  <svg className="animate-spin w-8 h-8 text-primary-600" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                  <span className="text-sm text-gray-600 dark:text-gray-300">Extracting text from resume...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  <span className="text-sm text-gray-600 dark:text-gray-300">Click to upload your resume (PDF)</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Max 5MB</span>
                </div>
              )}
            </label>
          </div>

          {resumeError && <p className="mt-2 text-sm text-red-500" role="alert">{resumeError}</p>}

          <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <p className="text-xs text-amber-800 dark:text-amber-200">
              <strong>Note:</strong> Text-based PDFs work best. Image-only or scanned PDFs may not extract well. For best results, use a PDF exported from a word processor.
            </p>
          </div>
        </div>
      )}

      {/* Import Results */}
      {importResults.length > 0 && (
        <div className="mt-6 space-y-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Imported Content ({importResults.length})
          </h3>
          {importResults.map((result, idx) => (
            <div
              key={result.id || idx}
              className={`rounded-xl border ${
                result.status === 'success'
                  ? result.isProcessed
                    ? 'bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-800'
                    : 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800'
                  : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
              }`}
            >
              <div className="p-4">
                {result.status === 'success' ? (
                  <>
                    <div className="flex items-center gap-2 mb-1">
                      <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="font-medium text-sm text-gray-900 dark:text-white">
                        {result.title || 'Untitled'}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300">
                        {result.source === 'chatgpt' ? 'ChatGPT' : result.source === 'linkedin' ? 'LinkedIn' : result.source === 'resume' ? 'Resume' : result.source === 'url' ? 'URL' : result.source === 'text' ? 'Text' : 'File'}
                      </span>
                      {result.sectionCount != null && result.sectionCount > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300">
                          {result.sectionCount} sections
                        </span>
                      )}
                      {result.isProcessed && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300">
                          {result.extractedInsights?.length || 0} insights extracted
                        </span>
                      )}
                    </div>
                    {result.summary && !result.isProcessed && (
                      <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-3 mt-1">
                        {result.summary}
                      </p>
                    )}

                    {/* Process button - shown when not yet processed */}
                    {!result.isProcessed && !result.isProcessing && (
                      <button
                        onClick={() => handleProcessImport(idx)}
                        className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Extract Insights for Verification
                      </button>
                    )}

                    {/* Processing spinner */}
                    {result.isProcessing && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-primary-600 dark:text-primary-400">
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Extracting personal insights...
                      </div>
                    )}

                    {/* Process error */}
                    {result.processError && (
                      <p className="mt-2 text-sm text-red-500">{result.processError}</p>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <div>
                      <span className="text-sm text-red-700 dark:text-red-400">
                        Failed: {result.title || 'Unknown'}
                      </span>
                      {result.error && (
                        <p className="text-xs text-red-500 mt-0.5">{result.error}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Extracted Insights Panel */}
              {result.isProcessed && result.extractedInsights && result.extractedInsights.length > 0 && (
                <div className="border-t border-purple-200 dark:border-purple-800 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                      Extracted Insights ({result.extractedInsights.length})
                    </h4>
                    <div className="flex gap-2">
                      {result.topicCreated && (
                        <Link
                          to={`/app/topics`}
                          className="text-xs px-2 py-1 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 hover:bg-primary-200 dark:hover:bg-primary-900/50 transition-colors"
                        >
                          View Topic
                        </Link>
                      )}
                      <Link
                        to="/app/verify"
                        className="text-xs px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                      >
                        Go to Verification Queue
                      </Link>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {result.extractedInsights.map((insight, iIdx) => (
                      <div
                        key={insight.id || iIdx}
                        className="flex items-start gap-2 p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                            ?
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 dark:text-gray-200 leading-snug">
                            {insight.content}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                              Confidence: {insight.confidenceScore}%
                            </span>
                            <span className="text-[10px] px-1 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
                              Pending verification
                            </span>
                            <span className="text-[10px] px-1 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 capitalize">
                              {insight.suggestedCategory}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                      <strong>Next step:</strong> These insights are now in your{' '}
                      <Link to="/app/verify" className="underline hover:text-amber-900 dark:hover:text-amber-100">
                        verification queue
                      </Link>
                      . Review each one to confirm, edit, or reject it. Only verified insights will appear in your profile export.
                    </p>
                  </div>
                </div>
              )}

              {/* No insights extracted message */}
              {result.isProcessed && (!result.extractedInsights || result.extractedInsights.length === 0) && (
                <div className="border-t border-gray-200 dark:border-gray-700 p-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    No personal insights could be extracted from this content. Try importing content that contains personal statements, beliefs, preferences, or experiences.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}