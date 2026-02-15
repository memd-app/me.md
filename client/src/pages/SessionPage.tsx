import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  quickReplies: string | null;
  suggestsCompletion: boolean;
  isBookmarked: boolean;
  isVoiceInput: boolean;
  createdAt: string;
}

interface Session {
  id: string;
  topicId: string;
  userId: string;
  status: string;
  isMiniSession: boolean;
  timeSpentSeconds: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface Topic {
  id: string;
  title: string;
  description: string | null;
  status: string;
}

interface Note {
  id: string;
  sessionId: string;
  topicId: string;
  userId: string;
  title: string | null;
  contentFullAnalysis: string | null;
  contentBriefSummary: string | null;
  contentDecisionFramework: string | null;
  contentJson: string | null;
  selectedFormat: string;
  createdAt: string;
  updatedAt: string;
}

interface Insight {
  id: string;
  content: string;
  confidenceScore: number;
  verificationStatus: string;
}

type NoteFormat = 'full_analysis' | 'brief_summary' | 'decision_framework' | 'json';

const FORMAT_LABELS: Record<NoteFormat, string> = {
  full_analysis: 'Full Analysis',
  brief_summary: 'Brief Summary',
  decision_framework: 'Decision Framework',
  json: 'JSON Data',
};

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [session, setSession] = useState<Session | null>(null);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isDistilling, setIsDistilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [noteInsights, setNoteInsights] = useState<Insight[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<NoteFormat>('full_analysis');
  const [showDistillation, setShowDistillation] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom of messages
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Fetch session data
  useEffect(() => {
    if (!user || !id) return;

    const fetchSession = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/sessions/${id}`, {
          headers: { 'x-user-id': user.id },
        });

        if (!res.ok) {
          throw new Error('Failed to load session');
        }

        const data = await res.json();
        setSession(data.session);
        setTopic(data.topic);
        setMessages(data.messages || []);

        // If session is completed, try to load existing note
        if (data.session.status === 'completed') {
          fetchNote(data.session.id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load session');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSession();
  }, [user, id]);

  // Fetch existing note for a session
  const fetchNote = async (sessionId: string) => {
    if (!user) return;
    try {
      const res = await fetch(`/api/notes/session/${sessionId}`, {
        headers: { 'x-user-id': user.id },
      });
      if (res.ok) {
        const data = await res.json();
        setNote(data.note);
        setNoteInsights(data.insights || []);
        setSelectedFormat((data.note.selectedFormat || 'full_analysis') as NoteFormat);
        setShowDistillation(true);
      }
    } catch {
      // No note found, that's OK
    }
  };

  // Finish & Distill
  const handleFinishAndDistill = async () => {
    if (!user || !session) return;

    setIsDistilling(true);
    setError(null);

    try {
      const res = await fetch(`/api/sessions/${session.id}/distill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ format: 'full_analysis' }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to distill session');
      }

      const data = await res.json();
      setNote(data.note);
      setNoteInsights(data.insights || []);
      setSelectedFormat((data.note.selectedFormat || 'full_analysis') as NoteFormat);
      setShowDistillation(true);

      // Update session status locally
      if (data.session) {
        setSession(data.session);
      } else {
        setSession(prev => prev ? { ...prev, status: 'completed', completedAt: new Date().toISOString() } : null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to distill session');
    } finally {
      setIsDistilling(false);
    }
  };

  // Change note format
  const handleFormatChange = async (format: NoteFormat) => {
    setSelectedFormat(format);

    if (!user || !session || !note) return;

    try {
      await fetch(`/api/sessions/${session.id}/distill/regenerate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ format }),
      });
    } catch {
      // Silent update - format is changed locally anyway
    }
  };

  // Get note content by format
  const getNoteContent = (): string => {
    if (!note) return '';
    switch (selectedFormat) {
      case 'full_analysis':
        return note.contentFullAnalysis || 'No content available';
      case 'brief_summary':
        return note.contentBriefSummary || 'No content available';
      case 'decision_framework':
        return note.contentDecisionFramework || 'No content available';
      case 'json':
        return note.contentJson || '{}';
      default:
        return note.contentFullAnalysis || 'No content available';
    }
  };

  // Send a message
  const sendMessage = async (content: string) => {
    if (!user || !session || !content.trim() || isSending) return;

    const trimmedContent = content.trim();
    setInputValue('');
    setIsSending(true);
    setError(null);

    // Optimistically add user message
    const tempUserMessage: Message = {
      id: `temp-${Date.now()}`,
      sessionId: session.id,
      role: 'user',
      content: trimmedContent,
      quickReplies: null,
      suggestsCompletion: false,
      isBookmarked: false,
      isVoiceInput: false,
      createdAt: new Date().toISOString(),
    };

    setMessages(prev => [...prev, tempUserMessage]);

    try {
      const res = await fetch(`/api/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ content: trimmedContent }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to send message');
      }

      const data = await res.json();

      // Replace temp user message with real one and add AI response
      setMessages(prev => {
        const withoutTemp = prev.filter(m => m.id !== tempUserMessage.id);
        return [...withoutTemp, data.userMessage, data.aiMessage];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      // Remove optimistic message on error
      setMessages(prev => prev.filter(m => m.id !== tempUserMessage.id));
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputValue);
  };

  // Handle keyboard shortcuts (Enter to send, Shift+Enter for newline)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputValue);
    }
  };

  // Handle quick reply click
  const handleQuickReply = (reply: string) => {
    sendMessage(reply);
  };

  // Parse quick replies from JSON string
  const parseQuickReplies = (repliesStr: string | null): string[] => {
    if (!repliesStr) return [];
    try {
      return JSON.parse(repliesStr);
    } catch {
      return [];
    }
  };

  // Render markdown-like content
  const renderMarkdown = (content: string) => {
    const lines = content.split('\n');
    return lines.map((line, lineIdx) => {
      // Headers
      if (line.startsWith('### ')) {
        return <h3 key={lineIdx} className="text-base font-semibold text-gray-900 dark:text-white mt-4 mb-2">{line.slice(4)}</h3>;
      }
      if (line.startsWith('## ')) {
        return <h2 key={lineIdx} className="text-lg font-bold text-gray-900 dark:text-white mt-6 mb-3 border-b border-gray-200 dark:border-gray-700 pb-2">{line.slice(3)}</h2>;
      }
      if (line.startsWith('# ')) {
        return <h1 key={lineIdx} className="text-xl font-bold text-gray-900 dark:text-white mb-4">{line.slice(2)}</h1>;
      }
      // Blockquotes
      if (line.startsWith('> ')) {
        return (
          <blockquote key={lineIdx} className="border-l-4 border-primary-400 dark:border-primary-600 pl-4 py-1 my-2 text-gray-700 dark:text-gray-300 italic bg-primary-50/50 dark:bg-primary-900/10 rounded-r-lg">
            {renderInline(line.slice(2))}
          </blockquote>
        );
      }
      // List items
      if (line.startsWith('- ')) {
        return (
          <li key={lineIdx} className="ml-4 text-gray-700 dark:text-gray-300 list-disc my-1">
            {renderInline(line.slice(2))}
          </li>
        );
      }
      // Numbered list items
      if (/^\d+\.\s/.test(line)) {
        const content = line.replace(/^\d+\.\s/, '');
        return (
          <li key={lineIdx} className="ml-4 text-gray-700 dark:text-gray-300 list-decimal my-1">
            {renderInline(content)}
          </li>
        );
      }
      // Empty lines
      if (line.trim() === '') {
        return <div key={lineIdx} className="h-2" />;
      }
      // Regular text
      return <p key={lineIdx} className="text-gray-700 dark:text-gray-300 my-1">{renderInline(line)}</p>;
    });
  };

  // Render inline markdown (bold, code)
  const renderInline = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-semibold text-gray-900 dark:text-white">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i} className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-sm font-mono text-primary-600 dark:text-primary-400">{part.slice(1, -1)}</code>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  // Render markdown-like bold text (for chat messages)
  const renderContent = (content: string) => {
    // Split by **text** for bold
    const parts = content.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        );
      }
      // Handle newlines
      return part.split('\n').map((line, j, arr) => (
        <span key={`${i}-${j}`}>
          {line}
          {j < arr.length - 1 && <br />}
        </span>
      ));
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin inline-block w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full mb-3" />
          <p className="text-gray-600 dark:text-gray-400">Loading session...</p>
        </div>
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="card text-center py-12">
          <span className="text-4xl block mb-3">Not found</span>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Session not found
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <Link to="/app/topics" className="btn-primary inline-block">
            Back to Topics
          </Link>
        </div>
      </div>
    );
  }

  if (!session || !topic) return null;

  // Get quick replies from the last assistant message
  const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');
  const quickReplies = lastAssistantMessage ? parseQuickReplies(lastAssistantMessage.quickReplies) : [];
  const isSessionActive = session.status === 'active';
  const isSessionCompleted = session.status === 'completed';
  const userMessageCount = messages.filter(m => m.role === 'user').length;
  const suggestsCompletion = lastAssistantMessage?.suggestsCompletion || false;

  // Show distillation view
  if (showDistillation && note) {
    return (
      <div className="flex flex-col h-full max-w-4xl mx-auto -m-6">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 bg-white dark:bg-dark-surface border-b border-gray-200 dark:border-dark-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setShowDistillation(false)}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0"
              title="Back to chat"
            >
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-gray-900 dark:text-white truncate">
                {note.title || `Session Notes: ${topic.title}`}
              </h1>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Distilled Notes
                </span>
              </div>
            </div>
          </div>
          <Link
            to={`/app/topics/${topic.id}`}
            className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
          >
            View Topic
          </Link>
        </div>

        {/* Format selector */}
        <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-dark-border shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 shrink-0">Format:</span>
            {(Object.entries(FORMAT_LABELS) as [NoteFormat, string][]).map(([format, label]) => (
              <button
                key={format}
                onClick={() => handleFormatChange(format)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors shrink-0 ${
                  selectedFormat === format
                    ? 'bg-primary-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Note content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {selectedFormat === 'json' ? (
            <pre className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg text-sm font-mono text-gray-800 dark:text-gray-200 overflow-x-auto whitespace-pre-wrap">
              {getNoteContent()}
            </pre>
          ) : (
            <div className="prose dark:prose-invert max-w-none">
              {renderMarkdown(getNoteContent())}
            </div>
          )}

          {/* Extracted insights */}
          {noteInsights.length > 0 && (
            <div className="mt-8 border-t border-gray-200 dark:border-gray-700 pt-6">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Extracted Insights ({noteInsights.length})
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                These insights need to be verified in the Verification queue before being added to your profile.
              </p>
              <div className="space-y-3">
                {noteInsights.map((insight) => (
                  <div
                    key={insight.id}
                    className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-surface"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-gray-800 dark:text-gray-200 text-sm flex-1">
                        {insight.content}
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          insight.confidenceScore >= 75
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                            : insight.confidenceScore >= 55
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                        }`}>
                          {insight.confidenceScore}%
                        </span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          Unverified
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto -m-6">
      {/* Session header */}
      <div className="flex items-center justify-between px-6 py-3 bg-white dark:bg-dark-surface border-b border-gray-200 dark:border-dark-border shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to={`/app/topics/${topic.id}`}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0"
            title="Back to topic"
          >
            <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-gray-900 dark:text-white truncate">
              {topic.title}
            </h1>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isSessionActive ? 'bg-green-500' : 'bg-gray-400'}`} />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {isSessionActive ? 'Interview Session' : 'Session Completed'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {messages.filter(m => m.role === 'user').length} messages
          </span>
          {/* Finish & Distill button */}
          {isSessionActive && userMessageCount >= 1 && (
            <button
              onClick={handleFinishAndDistill}
              disabled={isDistilling}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDistilling ? (
                <>
                  <div className="animate-spin w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full" />
                  Distilling...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Finish & Distill
                </>
              )}
            </button>
          )}
          {/* View Notes button when completed */}
          {isSessionCompleted && note && (
            <button
              onClick={() => setShowDistillation(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-600 hover:bg-primary-700 text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              View Notes
            </button>
          )}
        </div>
      </div>

      {/* Completion suggestion banner */}
      {isSessionActive && suggestsCompletion && !isDistilling && (
        <div className="px-6 py-3 bg-emerald-50 dark:bg-emerald-900/20 border-b border-emerald-200 dark:border-emerald-800 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-emerald-700 dark:text-emerald-300">
                We've covered a lot of ground! You can finish and distill your session, or continue exploring.
              </span>
            </div>
            <button
              onClick={handleFinishAndDistill}
              className="text-sm font-medium text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100 underline shrink-0 ml-4"
            >
              Finish & Distill
            </button>
          </div>
        </div>
      )}

      {/* Session completed banner */}
      {isSessionCompleted && (
        <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-dark-border shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                This session has been completed and distilled.
                {session.completedAt && ` Completed ${new Date(session.completedAt).toLocaleString()}`}
              </span>
            </div>
            {note && (
              <button
                onClick={() => setShowDistillation(true)}
                className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline shrink-0 ml-4"
              >
                View distilled notes
              </button>
            )}
          </div>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] ${
                message.role === 'user'
                  ? 'bg-primary-600 text-white rounded-2xl rounded-br-md px-4 py-3'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-2xl rounded-bl-md px-4 py-3'
              }`}
            >
              {/* Role indicator */}
              <div className={`text-xs font-medium mb-1 ${
                message.role === 'user'
                  ? 'text-primary-200'
                  : 'text-gray-500 dark:text-gray-400'
              }`}>
                {message.role === 'user' ? 'You' : 'AI Interviewer'}
              </div>

              {/* Message content */}
              <div className={`text-sm leading-relaxed ${
                message.role === 'user' ? 'text-white' : ''
              }`}>
                {renderContent(message.content)}
              </div>

              {/* Timestamp */}
              <div className={`text-xs mt-2 ${
                message.role === 'user'
                  ? 'text-primary-300'
                  : 'text-gray-400 dark:text-gray-500'
              }`}>
                {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}

        {/* Typing indicator when sending */}
        {isSending && (
          <div className="flex justify-start">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                AI Interviewer
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {/* Distilling indicator */}
        {isDistilling && (
          <div className="flex justify-center">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl px-6 py-4 text-center">
              <div className="animate-spin inline-block w-6 h-6 border-3 border-emerald-200 border-t-emerald-600 rounded-full mb-2" />
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                Distilling your session...
              </p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                Extracting insights and generating notes
              </p>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick replies */}
      {quickReplies.length > 0 && isSessionActive && !isSending && !isDistilling && (
        <div className="px-6 py-2 flex flex-wrap gap-2 shrink-0">
          {quickReplies.map((reply, index) => (
            <button
              key={index}
              onClick={() => handleQuickReply(reply)}
              disabled={isSending}
              className="px-3 py-1.5 text-sm rounded-full border border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors disabled:opacity-50"
            >
              {reply}
            </button>
          ))}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="px-6 py-2 shrink-0">
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-600 ml-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Input area */}
      {isSessionActive && !isDistilling && (
        <div className="px-6 py-4 bg-white dark:bg-dark-surface border-t border-gray-200 dark:border-dark-border shrink-0">
          <form onSubmit={handleSubmit} className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your response..."
                rows={1}
                className="input-field resize-none min-h-[44px] max-h-32 py-2.5 pr-3"
                style={{
                  height: 'auto',
                  minHeight: '44px',
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 128) + 'px';
                }}
                disabled={isSending}
              />
            </div>
            <button
              type="submit"
              disabled={!inputValue.trim() || isSending}
              className="btn-primary flex items-center justify-center w-11 h-11 p-0 shrink-0 rounded-xl"
              title="Send message"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      )}
    </div>
  );
}
