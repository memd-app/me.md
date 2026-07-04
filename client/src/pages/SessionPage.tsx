import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useToast } from '@/contexts/ToastContext';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { formatFullDate, formatDateTime, formatTime } from '@/utils/dateFormat';
import { getSession, getMultiBucketSuggestions, pauseSession, resumeSession, sendMessage as sendMessageService, retryMessage, saveMultiBucketConnections } from '@/services/sessions';
import { distillSession, getNoteForSession, regenerateNote, updateNote } from '@/services/notes';
import { createBookmark, deleteBookmark } from '@/services/bookmarks';

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

interface ResearchSource {
  type: 'ai_knowledge' | 'reference_url';
  title: string;
  url?: string;
  snippet: string;
}

interface ResearchData {
  topicTitle?: string;
  summary?: string;
  keyFindings?: string[];
  suggestedAngles?: string[];
  relevantConcepts?: string[];
  sources?: ResearchSource[];
  researchedAt?: string;
}

interface Session {
  id: string;
  topicId: string;
  userId: string;
  status: string;
  isMiniSession: boolean;
  suggestedDurationMinutes: number | null;
  timeSpentSeconds: number;
  researchData: string | null;
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

const ACTIVE_NOTE_FORMATS: NoteFormat[] = ['full_analysis', 'json'];
const LEGACY_NOTE_FORMATS: NoteFormat[] = ['brief_summary', 'decision_framework'];

function hasNoteContent(note: Note, format: NoteFormat): boolean {
  switch (format) {
    case 'full_analysis':
      return !!note.contentFullAnalysis?.trim();
    case 'brief_summary':
      return !!note.contentBriefSummary?.trim();
    case 'decision_framework':
      return !!note.contentDecisionFramework?.trim();
    case 'json':
      return !!note.contentJson?.trim();
    default:
      return false;
  }
}

function getAvailableNoteFormats(note: Note): NoteFormat[] {
  return [
    ...ACTIVE_NOTE_FORMATS,
    ...LEGACY_NOTE_FORMATS.filter(format => hasNoteContent(note, format)),
  ];
}

function getInitialNoteFormat(note: Note): NoteFormat {
  const selected = (note.selectedFormat || 'full_analysis') as NoteFormat;
  return getAvailableNoteFormats(note).includes(selected) ? selected : 'full_analysis';
}

function canRegenerateFormat(format: NoteFormat): boolean {
  return format === 'full_analysis' || format === 'json';
}

// Distillation progress step labels - defined outside component to avoid re-creation
const DISTILL_STEPS = [
  { label: 'Analyzing conversation...', description: 'Reading through your session messages' },
  { label: 'Extracting key insights...', description: 'Identifying important themes and patterns' },
  { label: 'Generating notes...', description: 'Creating structured notes in multiple formats' },
  { label: 'Finding connections...', description: 'Discovering links to other topics' },
  { label: 'Finalizing...', description: 'Wrapping up your distilled session' },
];

const DISTILL_STEP_DURATIONS = [1500, 2500, 3000, 2000, 2000]; // ms per step

// Timeout for AI operations (30 seconds)
const AI_TIMEOUT_MS = 30000;

// Pure render function for message content (bold + newlines) - defined outside component for stability
function renderMessageContent(content: string) {
  const parts = content.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part.split('\n').map((line, j, arr) => (
      <span key={`${i}-${j}`}>
        {line}
        {j < arr.length - 1 && <br />}
      </span>
    ));
  });
}

// Memoized manuscript entry — numbered exchange with small-caps speaker label
// (Modern Editorial; replaces the chat-bubble treatment)
const MessageBubble = memo(function MessageBubble({
  message,
  exchangeNumber,
  onToggleBookmark,
}: {
  message: Message;
  exchangeNumber: number;
  onToggleBookmark: (message: Message) => void;
}) {
  const isUser = message.role === 'user';
  return (
    <div
      className="group flex gap-4"
      role="article"
      aria-label={`${isUser ? 'Your' : 'Interviewer'} message`}
    >
      {/* Exchange marker */}
      <span
        className="w-7 shrink-0 pt-1 text-right font-sans text-[11px] tabular-nums text-gray-400 dark:text-gray-600 select-none"
        aria-hidden="true"
      >
        {String(exchangeNumber).padStart(2, '0')}
      </span>

      <div className={`flex-1 min-w-0 ${message.isBookmarked ? 'border-l-2 border-primary-400 dark:border-primary-500 pl-4' : ''}`}>
        {/* Speaker label + voice + bookmark control */}
        <div className="flex items-center gap-2 mb-1.5">
          <span
            className={`text-[11px] uppercase tracking-[0.08em] font-medium font-sans ${
              isUser ? 'text-gray-500 dark:text-gray-400' : 'text-primary-600 dark:text-primary-400'
            }`}
          >
            {isUser ? 'You' : 'Interviewer'}
          </span>
          {message.isVoiceInput && (
            <span className="inline-flex text-gray-400 dark:text-gray-600" aria-label="Voice input">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </span>
          )}
          {!message.id.startsWith('temp-') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleBookmark(message);
              }}
              className={`p-0.5 rounded transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 ${
                message.isBookmarked
                  ? 'text-primary-500 hover:text-primary-600 dark:text-primary-400'
                  : 'text-gray-300 dark:text-gray-700 opacity-40 group-hover:opacity-100 hover:text-primary-500 dark:hover:text-primary-400'
              }`}
              title={message.isBookmarked ? 'Remove bookmark' : 'Bookmark this message'}
              aria-label={message.isBookmarked ? 'Remove bookmark from this message' : 'Bookmark this message'}
              aria-pressed={message.isBookmarked}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={message.isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
            </button>
          )}
        </div>

        {/* Prose */}
        <div
          className={`font-serif text-[17px] leading-[1.7] break-words overflow-hidden ${
            isUser ? 'text-ink dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'
          }`}
          title={formatTime(message.createdAt)}
        >
          {renderMessageContent(message.content)}
        </div>
      </div>
    </div>
  );
});

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useUser();
  const db = useDatabase();
  const { addToast } = useToast();
  const [session, setSession] = useState<Session | null>(null);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isDistilling, setIsDistilling] = useState(false);
  const [distillStep, setDistillStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [noteInsights, setNoteInsights] = useState<Insight[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<NoteFormat>('full_analysis');
  const [showDistillation, setShowDistillation] = useState(false);
  const [showResearchPanel, setShowResearchPanel] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [failedMessageContent, setFailedMessageContent] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceInputPending, setIsVoiceInputPending] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerateSuccess, setRegenerateSuccess] = useState(false);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteSaveSuccess, setNoteSaveSuccess] = useState(false);
  const [suggestedConnections, setSuggestedConnections] = useState<Array<{ targetTopicId: string; topicTitle: string; relevanceScore: number }>>([]);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<string>>(new Set());
  const [isSavingConnections, setIsSavingConnections] = useState(false);
  const [connectionsSaved, setConnectionsSaved] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isSendingRef = useRef(false); // Synchronous guard against double-send

  // Progress through distill steps while distilling
  useEffect(() => {
    if (!isDistilling) {
      setDistillStep(0);
      return;
    }
    // Advance through steps on a timer (the actual API call runs in parallel)
    let currentStep = 0;
    setDistillStep(0);

    const advance = () => {
      currentStep++;
      if (currentStep < DISTILL_STEPS.length) {
        setDistillStep(currentStep);
        timer = setTimeout(advance, DISTILL_STEP_DURATIONS[currentStep]);
      }
    };

    let timer = setTimeout(advance, DISTILL_STEP_DURATIONS[0]);
    return () => clearTimeout(timer);
  }, [isDistilling]);

  // Prevent parent main area from scrolling - SessionPage handles its own scroll
  useEffect(() => {
    const mainEl = document.getElementById('main-content');
    if (mainEl) {
      const prev = mainEl.style.overflow;
      mainEl.style.overflow = 'hidden';
      return () => { mainEl.style.overflow = prev; };
    }
  }, []);

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
        const data = getSession(db, id!);
        if (!data) {
          throw new Error('This session does not exist or has been deleted. Please go back and start a new session.');
        }
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
        const data = getNoteForSession(db, sessionId);
        setNote(data.note);
        setNoteInsights(data.insights || []);
        setSelectedFormat(getInitialNoteFormat(data.note));
        setShowDistillation(true);

        // Also fetch multi-bucket cross-topic suggestions
        fetchMultiBucketSuggestions(sessionId);
    } catch {
      // No note found, that's OK
    }
  };

  // Fetch multi-bucket cross-topic suggestions for a session
  const fetchMultiBucketSuggestions = async (sessionId: string) => {
    if (!user) return;
    try {
        const data = getMultiBucketSuggestions(db, sessionId);
        if (data.suggestedConnections && data.suggestedConnections.length > 0) {
          setSuggestedConnections(data.suggestedConnections);
          // Pre-select already-saved connections
          if (data.savedTargetIds && data.savedTargetIds.length > 0) {
            setSelectedConnectionIds(new Set(data.savedTargetIds));
            setConnectionsSaved(true);
          } else {
            setSelectedConnectionIds(new Set());
            setConnectionsSaved(false);
          }
        }
    } catch {
      // Silently fail - multi-bucket is optional
    }
  };

  // Finish & Distill
  const handleFinishAndDistill = async () => {
    if (!user || !session) return;

    setIsDistilling(true);
    setError(null);

    try {
      const distillData = await distillSession(db, session.id, 'full_analysis');
      if (!distillData) {
        throw new Error('Failed to distill session');
      }

      const data = distillData;
      setNote(data.note);
      setNoteInsights(data.insights || []);
      setSelectedFormat(getInitialNoteFormat(data.note));
      setShowDistillation(true);

      // Set suggested cross-topic connections from multi-bucket extraction
      if (data.suggestedConnections && data.suggestedConnections.length > 0) {
        setSuggestedConnections(data.suggestedConnections);
        setSelectedConnectionIds(new Set());
        setConnectionsSaved(false);
      }

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

  // Toggle cross-topic connection selection
  const toggleConnection = (topicId: string) => {
    setSelectedConnectionIds(prev => {
      const next = new Set(prev);
      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        next.add(topicId);
      }
      return next;
    });
  };

  // Save selected cross-topic connections
  const handleSaveConnections = async () => {
    if (!user || !session || selectedConnectionIds.size === 0) return;

    setIsSavingConnections(true);
    try {
      const connectionsToSave = suggestedConnections
        .filter(c => selectedConnectionIds.has(c.targetTopicId))
        .map(c => ({
          targetTopicId: c.targetTopicId,
          relevanceScore: c.relevanceScore,
        }));

      saveMultiBucketConnections(db, session.id, connectionsToSave);
      setConnectionsSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save cross-topic connections');
    } finally {
      setIsSavingConnections(false);
    }
  };

  // Pause session
  const handlePauseSession = async () => {
    if (!user || !session) return;

    setIsPausing(true);
    setError(null);
    try {
      const updatedSession = pauseSession(db, session.id);
      setSession(updatedSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause session');
    } finally {
      setIsPausing(false);
    }
  };

  // Resume session
  const handleResumeSession = async () => {
    if (!user || !session) return;

    setIsResuming(true);
    setError(null);
    try {
      const data = resumeSession(db, session.id);
      setSession(data.session);
      // Add the gap-aware greeting message to the messages list
      if (data.greetingMessage) {
        setMessages(prev => [...prev, data.greetingMessage]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume session');
    } finally {
      setIsResuming(false);
    }
  };

  // Change note format
  const handleFormatChange = async (format: NoteFormat) => {
    setSelectedFormat(format);
    setIsEditingNote(false); // Exit edit mode when changing format

    if (!user || !session || !note) return;

    try {
      await regenerateNote(db, session.id, format);
    } catch {
      // Silent update - format is changed locally anyway
    }
  };

  // Regenerate note content in current format from session messages
  const handleRegenerateContent = async () => {
    if (!user || !session || !note || isRegenerating || !canRegenerateFormat(selectedFormat)) return;

    setIsRegenerating(true);
    setRegenerateSuccess(false);
    setError(null);

    try {
      const data = await regenerateNote(db, session.id, selectedFormat, true);
      setNote(data.note);
      setRegenerateSuccess(true);
      setIsEditingNote(false);

      // Auto-dismiss success message after 3 seconds
      setTimeout(() => setRegenerateSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate note');
    } finally {
      setIsRegenerating(false);
    }
  };

  // Start editing note content
  const handleStartEdit = () => {
    setEditContent(getNoteContent());
    setIsEditingNote(true);
    setNoteSaveSuccess(false);
  };

  // Cancel editing
  const handleCancelEdit = () => {
    setIsEditingNote(false);
    setEditContent('');
  };

  // Save edited note content
  const handleSaveNote = async () => {
    if (!user || !note || isSavingNote) return;

    setIsSavingNote(true);
    setNoteSaveSuccess(false);
    setError(null);

    try {
      // Build update payload with the appropriate content field
      const updatePayload: Record<string, string> = {};
      switch (selectedFormat) {
        case 'full_analysis':
          updatePayload.contentFullAnalysis = editContent;
          break;
        case 'brief_summary':
          updatePayload.contentBriefSummary = editContent;
          break;
        case 'decision_framework':
          updatePayload.contentDecisionFramework = editContent;
          break;
        case 'json':
          updatePayload.contentJson = editContent;
          break;
      }

      const data = updateNote(db, note.id, updatePayload);
      setNote(data.note);
      setIsEditingNote(false);
      setEditContent('');
      setNoteSaveSuccess(true);

      // Auto-dismiss success message after 3 seconds
      setTimeout(() => setNoteSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save note');
    } finally {
      setIsSavingNote(false);
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

  // Download note as markdown file
  const handleDownloadNote = () => {
    if (!note) return;
    const content = getNoteContent();
    const title = note.title || 'Untitled Note';
    // Build markdown header with metadata
    const topicTitle = topic?.title || 'Unknown Topic';
    const createdDate = note.createdAt ? formatFullDate(note.createdAt) : '';
    const formatLabel = FORMAT_LABELS[selectedFormat] || 'Full Analysis';

    let markdownContent: string;
    if (selectedFormat === 'json') {
      // Wrap JSON in a code block for markdown
      markdownContent = `# ${title}\n\n**Topic:** ${topicTitle}  \n**Format:** ${formatLabel}  \n**Date:** ${createdDate}\n\n---\n\n\`\`\`json\n${content}\n\`\`\`\n`;
    } else {
      markdownContent = `# ${title}\n\n**Topic:** ${topicTitle}  \n**Format:** ${formatLabel}  \n**Date:** ${createdDate}\n\n---\n\n${content}\n`;
    }

    // Create blob and trigger download
    const blob = new Blob([markdownContent], { type: 'text/markdown; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    // Sanitize filename
    const safeTitle = title.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_').substring(0, 50);
    link.download = `${safeTitle}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Copy note content to clipboard
  const handleCopyNote = async () => {
    if (!note) return;
    const content = getNoteContent();
    try {
      await navigator.clipboard.writeText(content);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = content;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  // Voice input via Web Speech API
  const isSpeechSupported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const startRecording = useCallback(() => {
    if (!isSpeechSupported) return;

    const SpeechRecognitionClass = (window as unknown as { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) return;

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';
    let interimTranscript = '';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      finalTranscript = '';
      interimTranscript = '';
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      // Show the transcription in real-time in the input field
      const currentText = finalTranscript + interimTranscript;
      setInputValue(prev => {
        // If the user already had text before starting voice, prepend it
        const prefix = prev && !isRecording ? prev + ' ' : '';
        return prefix + currentText;
      });
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Speech recognition error:', event.error);
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsRecording(false);
      if (finalTranscript) {
        setIsVoiceInputPending(true);
      }
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    setIsVoiceInputPending(false);
  }, [isSpeechSupported]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      // The onend handler will set isRecording to false and isVoiceInputPending to true
    }
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, []);

  // Handle Escape key to exit fullscreen mode
  useEffect(() => {
    if (!isFullscreen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isFullscreen]);

  // Streaming AI response state
  const [streamingContent, setStreamingContent] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);
  const streamAbortRef = useRef<AbortController | null>(null);

  // Auto-scroll when streaming content changes
  useEffect(() => {
    if (isStreaming) {
      scrollToBottom();
    }
  }, [streamingContent, isStreaming, scrollToBottom]);

  // Send a message with SSE streaming
  const sendMessage = async (content: string, voiceInput?: boolean) => {
    // Validate: prevent empty messages with user feedback
    if (!content.trim()) {
      addToast('Please type a message before sending.', 'warning', 3000);
      return;
    }
    // Use ref for synchronous double-click protection (state updates are async)
    if (!user || !session || isSending || isSendingRef.current) return;
    isSendingRef.current = true;

    const trimmedContent = content.trim();
    const isVoice = voiceInput || isVoiceInputPending;
    setInputValue('');
    setIsSending(true);
    setIsStreaming(false);
    setStreamingContent('');
    setError(null);
    setIsVoiceInputPending(false);

    // Optimistically add user message
    const tempUserMessage: Message = {
      id: `temp-${Date.now()}`,
      sessionId: session.id,
      role: 'user',
      content: trimmedContent,
      quickReplies: null,
      suggestsCompletion: false,
      isBookmarked: false,
      isVoiceInput: isVoice,
      createdAt: new Date().toISOString(),
    };

    setMessages(prev => [...prev, tempUserMessage]);

    // Track whether the abort was triggered by timeout (vs user cancel)
    let didTimeout = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const abortController = new AbortController();
      streamAbortRef.current = abortController;

      // Set a timeout that will abort the request after AI_TIMEOUT_MS
      timeoutId = setTimeout(() => {
        didTimeout = true;
        abortController.abort();
      }, AI_TIMEOUT_MS);

      // Replace temp user message with the real one (service saves user message to DB)
      // We'll update after the generator starts
      let accumulatedContent = '';

      const generator = sendMessageService(db, session.id, trimmedContent, { isVoiceInput: isVoice });

      for await (const chunk of generator) {
        if (abortController.signal.aborted) break;

        // Reset timeout on each chunk received (AI is still responding)
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          didTimeout = true;
          abortController.abort();
        }, AI_TIMEOUT_MS);

        accumulatedContent += chunk;
        setStreamingContent(accumulatedContent);
        setIsStreaming(true);
      }

      // Stream completed - get updated messages from DB
      setStreamingContent('');
      setIsStreaming(false);

      // Refresh messages from DB to get the saved user + AI messages
      const refreshed = getSession(db, session.id);
      setMessages(refreshed.messages);

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Check if this was a timeout-triggered abort vs user-initiated cancel
        if (didTimeout) {
          setError('The AI response timed out (over 30 seconds). Your message has been saved — please try again.');
          setFailedMessageContent(trimmedContent);
          setStreamingContent('');
          setIsStreaming(false);
        }
        // User-initiated abort: silently return
        return;
      }
      setError('Something went wrong while generating the AI response. Please try again.');
      // Keep the user message visible but store content for retry
      setFailedMessageContent(trimmedContent);
      setStreamingContent('');
      setIsStreaming(false);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setIsSending(false);
      isSendingRef.current = false;
      streamAbortRef.current = null;
      inputRef.current?.focus();
    }
  };

  // Retry failed AI response
  const handleRetry = async () => {
    if (!failedMessageContent || !user || !session || isRetrying) return;

    setIsRetrying(true);
    setError(null);
    setStreamingContent('');
    setIsStreaming(false);

    // Track timeout for retry operations
    let retryDidTimeout = false;
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const abortController = new AbortController();
      streamAbortRef.current = abortController;

      // Set timeout for retry operation
      retryTimeoutId = setTimeout(() => {
        retryDidTimeout = true;
        abortController.abort();
      }, AI_TIMEOUT_MS);

      // Refresh messages from DB to see if the user message was actually saved
      const sessionData = getSession(db, session.id);
      const serverMessages: Message[] = sessionData.messages || [];
      setMessages(serverMessages);

      // Check if the last message is from the user (meaning AI response failed)
      const lastMsg = serverMessages[serverMessages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        // AI response failed - need to regenerate it using the retry service
        let accumulatedContent = '';
        const generator = retryMessage(db, session.id);

        for await (const chunk of generator) {
          if (abortController.signal.aborted) break;

          // Reset timeout on each chunk received
          if (retryTimeoutId) clearTimeout(retryTimeoutId);
          retryTimeoutId = setTimeout(() => {
            retryDidTimeout = true;
            abortController.abort();
          }, AI_TIMEOUT_MS);

          accumulatedContent += chunk;
          setStreamingContent(accumulatedContent);
          setIsStreaming(true);
        }

        setStreamingContent('');
        setIsStreaming(false);

        // Refresh messages from DB
        const refreshed = getSession(db, session.id);
        setMessages(refreshed.messages);
        setFailedMessageContent(null);
      } else {
        // The user message wasn't saved, resend it
        let accumulatedContent = '';
        const generator = sendMessageService(db, session.id, failedMessageContent!);

        for await (const chunk of generator) {
          if (abortController.signal.aborted) break;

          // Reset timeout on each chunk received
          if (retryTimeoutId) clearTimeout(retryTimeoutId);
          retryTimeoutId = setTimeout(() => {
            retryDidTimeout = true;
            abortController.abort();
          }, AI_TIMEOUT_MS);

          accumulatedContent += chunk;
          setStreamingContent(accumulatedContent);
          setIsStreaming(true);
        }

        setStreamingContent('');
        setIsStreaming(false);

        // Refresh messages from DB
        const refreshed = getSession(db, session.id);
        setMessages(refreshed.messages);
        setFailedMessageContent(null);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        if (retryDidTimeout) {
          setError('The AI response timed out (over 30 seconds). Your session is preserved — please try again.');
        }
        return;
      }
      setError('Retry failed. Please check your connection and try again.');
    } finally {
      if (retryTimeoutId) clearTimeout(retryTimeoutId);
      setIsRetrying(false);
      streamAbortRef.current = null;
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

  // Clear voice input pending when user types manually
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    // If user is typing manually (not via voice), clear the voice pending flag
    if (!isRecording) {
      setIsVoiceInputPending(false);
    }
  };

  // Toggle bookmark on a message
  const toggleBookmark = useCallback(async (message: Message) => {
    if (!user || !session) return;

    const isCurrentlyBookmarked = message.isBookmarked;

    // Optimistic update
    setMessages(prev => prev.map(m =>
      m.id === message.id ? { ...m, isBookmarked: !isCurrentlyBookmarked } : m
    ));

    try {
      if (isCurrentlyBookmarked) {
        // Remove bookmark
        deleteBookmark(db, message.id);
      } else {
        // Add bookmark
        createBookmark(db, message.id, session.id);
      }
    } catch {
      // Revert optimistic update
      setMessages(prev => prev.map(m =>
        m.id === message.id ? { ...m, isBookmarked: isCurrentlyBookmarked } : m
      ));
    }
  }, [user, session]);

  // Handle quick reply click
  const handleQuickReply = (reply: string) => {
    sendMessage(reply);
  };

  // Parse quick replies from JSON string
  // Parse research data from session
  const parseResearchData = (dataStr: string | null): ResearchData | null => {
    if (!dataStr) return null;
    try {
      const parsed = JSON.parse(dataStr);
      // Only return if it's a full research result (has summary field)
      if (parsed && typeof parsed.summary === 'string' && parsed.topicTitle) {
        return parsed as ResearchData;
      }
      return null;
    } catch {
      return null;
    }
  };

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner message="Loading session..." />
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="card text-center py-12" role="alert">
          <svg className="w-12 h-12 mx-auto text-gray-400 dark:text-gray-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Session not found
          </h2>
          <p className="text-gray-600 dark:text-gray-300 mb-4">
            {error || 'This session does not exist or has been deleted.'}
          </p>
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
  const isSessionPaused = session.status === 'paused';
  const userMessageCount = messages.filter(m => m.role === 'user').length;
  const suggestsCompletion = lastAssistantMessage?.suggestsCompletion || false;

  // Show distillation view
  if (showDistillation && note) {
    return (
      <div className="flex flex-col h-full max-w-4xl mx-auto -m-6">
        {/* Header with breadcrumb */}
        <div className="flex items-center justify-between px-6 py-3 bg-white dark:bg-dark-surface border-b border-gray-200 dark:border-dark-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setShowDistillation(false)}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0"
              title="Back to chat"
            >
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="min-w-0">
              {/* Breadcrumb navigation */}
              <nav className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-300 mb-0.5">
                <Link to="/app/topics" className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
                  Topics
                </Link>
                <span>/</span>
                <Link to={`/app/topics/${topic.id}`} className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors truncate max-w-[150px]" title={topic.title}>
                  {topic.title}
                </Link>
                <span>/</span>
                <span className="text-gray-600 dark:text-gray-300">Notes</span>
              </nav>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs text-gray-500 dark:text-gray-300">
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

        {/* Format selector with regenerate and edit buttons */}
        <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-dark-border shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 overflow-x-auto">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-300 shrink-0">Format:</span>
              {getAvailableNoteFormats(note).map((format) => (
                <button
                  key={format}
                  onClick={() => handleFormatChange(format)}
                  disabled={isRegenerating || isSavingNote}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors shrink-0 ${
                    selectedFormat === format
                      ? 'bg-primary-600 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {FORMAT_LABELS[format]}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Copy to clipboard button */}
              {!isEditingNote && (
                <button
                  onClick={handleCopyNote}
                  disabled={isRegenerating || copySuccess}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    copySuccess
                      ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                  title="Copy note content to clipboard"
                >
                  {copySuccess ? (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Copied
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              )}
              {/* Download as markdown button */}
              {!isEditingNote && (
                <button
                  onClick={handleDownloadNote}
                  disabled={isRegenerating}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Download note as markdown file"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download .md
                </button>
              )}
              {/* Edit button */}
              {!isEditingNote && (
                <button
                  onClick={handleStartEdit}
                  disabled={isRegenerating}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Edit note content"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit
                </button>
              )}
              {/* Save and Cancel buttons during editing */}
              {isEditingNote && (
                <>
                  <button
                    onClick={handleCancelEdit}
                    disabled={isSavingNote}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveNote}
                    disabled={isSavingNote}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSavingNote ? (
                      <>
                        <div className="animate-spin w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Save
                      </>
                    )}
                  </button>
                </>
              )}
              {/* Regenerate button */}
              {!isEditingNote && (
                <button
                  onClick={handleRegenerateContent}
                  disabled={isRegenerating || !canRegenerateFormat(selectedFormat)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={canRegenerateFormat(selectedFormat) ? 'Regenerate note content in current format from session messages' : 'Regeneration is only available for Full Analysis and JSON'}
                >
                  {isRegenerating ? (
                    <>
                      <div className="animate-spin w-3 h-3 border-2 border-amber-300 border-t-amber-600 rounded-full" />
                      Regenerating...
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Regenerate
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
          {/* Success messages */}
          {regenerateSuccess && (
            <div className="mt-2 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Note regenerated successfully in {FORMAT_LABELS[selectedFormat]} format. Previous content of other formats is preserved.
            </div>
          )}
          {noteSaveSuccess && (
            <div className="mt-2 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Note saved successfully.
            </div>
          )}
        </div>

        {/* Note content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* Regenerating overlay */}
          {isRegenerating && (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <div className="animate-spin inline-block w-8 h-8 border-4 border-amber-200 border-t-amber-600 rounded-full mb-3" />
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  Regenerating {FORMAT_LABELS[selectedFormat]}...
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-300 mt-1">
                  Re-analyzing session messages
                </p>
              </div>
            </div>
          )}

          {/* Edit mode: Markdown textarea editor */}
          {isEditingNote && !isRegenerating && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-300">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span>Editing {FORMAT_LABELS[selectedFormat]} — {selectedFormat === 'json' ? 'Edit JSON data' : 'Markdown supported'}</span>
              </div>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-[calc(100vh-320px)] min-h-[400px] p-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 text-sm font-mono leading-relaxed resize-y focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:focus:ring-primary-400 dark:focus:border-primary-400 outline-none"
                placeholder={selectedFormat === 'json' ? 'Enter JSON content...' : 'Enter markdown content...'}
                spellCheck={selectedFormat !== 'json'}
              />
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-300">
                <span>{editContent.length} characters</span>
                <span>Press Save to persist changes</span>
              </div>
            </div>
          )}

          {/* View mode: Rendered content */}
          {!isEditingNote && !isRegenerating && (
            <>
              {selectedFormat === 'json' ? (
                <pre className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg text-sm font-mono text-gray-800 dark:text-gray-200 overflow-x-auto whitespace-pre-wrap">
                  {getNoteContent()}
                </pre>
              ) : (
                <div className="prose dark:prose-invert max-w-none">
                  {renderMarkdown(getNoteContent())}
                </div>
              )}
            </>
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
              <p className="text-sm text-gray-500 dark:text-gray-300 mb-4">
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
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
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

          {/* Cross-topic connections (multi-bucket extraction) */}
          {suggestedConnections.length > 0 && (
            <div className="mt-8 border-t border-gray-200 dark:border-gray-700 pt-6">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                Suggested Cross-Topic Links ({suggestedConnections.length})
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-300 mb-4">
                This session content is relevant to other topics. Select the connections you want to save.
              </p>

              {connectionsSaved ? (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-4 py-3 rounded-lg">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Cross-topic connections saved successfully.
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    {suggestedConnections.map((conn) => (
                      <label
                        key={conn.targetTopicId}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedConnectionIds.has(conn.targetTopicId)
                            ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-surface hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedConnectionIds.has(conn.targetTopicId)}
                          onChange={() => toggleConnection(conn.targetTopicId)}
                          className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate block">
                            {conn.topicTitle}
                          </span>
                        </div>
                        <div className="shrink-0">
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  conn.relevanceScore >= 60
                                    ? 'bg-green-500'
                                    : conn.relevanceScore >= 35
                                    ? 'bg-amber-500'
                                    : 'bg-gray-400'
                                }`}
                                style={{ width: `${conn.relevanceScore}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 dark:text-gray-300 w-8 text-right">
                              {conn.relevanceScore}%
                            </span>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      onClick={handleSaveConnections}
                      disabled={selectedConnectionIds.size === 0 || isSavingConnections}
                      className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSavingConnections ? 'Saving...' : `Save ${selectedConnectionIds.size} Connection${selectedConnectionIds.size !== 1 ? 's' : ''}`}
                    </button>
                    <button
                      onClick={() => {
                        const allIds = new Set(suggestedConnections.map(c => c.targetTopicId));
                        setSelectedConnectionIds(prev => prev.size === allIds.size ? new Set() : allIds);
                      }}
                      className="text-sm text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                    >
                      {selectedConnectionIds.size === suggestedConnections.length ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${isFullscreen ? 'fixed inset-0 z-[60] bg-paper dark:bg-dark-bg' : 'h-[calc(100vh-4rem)] sm:h-full max-w-4xl mx-auto -m-4 sm:-m-6'}`}>
      {/* Session header with breadcrumb */}
      <div className="flex items-center justify-between px-3 sm:px-6 py-2 sm:py-3 bg-paper dark:bg-dark-bg border-b border-rule dark:border-dark-border shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {!isFullscreen && (
            <Link
              to={`/app/topics/${topic.id}`}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
              title="Back to topic"
              aria-label="Go back to topic"
            >
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
          )}
          <div className="min-w-0">
            {/* Breadcrumb navigation - hidden in fullscreen and on mobile */}
            {!isFullscreen && (
              <nav className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-300 mb-0.5">
                <Link to="/app/topics" className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
                  Topics
                </Link>
                <span>/</span>
                <Link to={`/app/topics/${topic.id}`} className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors truncate max-w-[150px]" title={topic.title}>
                  {topic.title}
                </Link>
                <span>/</span>
                <span className="text-gray-600 dark:text-gray-300">Session</span>
              </nav>
            )}
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSessionActive ? 'bg-primary-500 animate-pulse' : isSessionPaused ? 'bg-primary-400' : 'bg-gray-400'}`} />
              <span className="hidden sm:inline text-[11px] uppercase tracking-[0.08em] font-medium text-gray-500 dark:text-gray-400 shrink-0">
                {isSessionActive ? 'Interview session' : isSessionPaused ? 'Paused' : 'Completed'}
              </span>
              <h1 className="font-serif italic text-base sm:text-lg leading-tight text-ink dark:text-gray-100 truncate">
                {topic.title}
              </h1>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {/* Research mode badge */}
          {session.researchData && parseResearchData(session.researchData) && (
            <button
              onClick={() => setShowResearchPanel(!showResearchPanel)}
              className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] font-medium rounded-md border border-rule dark:border-dark-border text-gray-600 dark:text-gray-400 hover:border-primary-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors cursor-pointer"
              title="Research-driven session — click to view research sources"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Research
            </button>
          )}
          {/* Suggested duration badge */}
          {session.suggestedDurationMinutes && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] font-medium rounded-md border border-rule dark:border-dark-border text-gray-600 dark:text-gray-400" title={`Suggested duration: ${session.suggestedDurationMinutes} minutes`}>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {session.suggestedDurationMinutes} min
            </span>
          )}
          <span className="hidden sm:inline text-xs text-gray-500 dark:text-gray-300">
            {messages.filter(m => m.role === 'user').length} messages
          </span>
          {/* Fullscreen toggle button */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Focus mode'}
            aria-label={isFullscreen ? 'Exit fullscreen mode' : 'Enter focus mode'}
          >
            {isFullscreen ? (
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            )}
          </button>
          {/* Pause button */}
          {isSessionActive && (
            <button
              onClick={handlePauseSession}
              disabled={isPausing || isSending || isDistilling}
              className="btn-secondary flex items-center gap-2 px-3 py-1.5 text-sm"
              aria-label="Pause session"
            >
              {isPausing ? (
                <>
                  <div className="animate-spin w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full" />
                  Pausing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Pause
                </>
              )}
            </button>
          )}
          {/* Resume button */}
          {isSessionPaused && (
            <button
              onClick={handleResumeSession}
              disabled={isResuming}
              className="btn-primary flex items-center gap-2 px-3 py-1.5 text-sm"
              aria-label="Resume session"
            >
              {isResuming ? (
                <>
                  <div className="animate-spin w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full" />
                  Resuming...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Resume
                </>
              )}
            </button>
          )}
          {/* Finish & Distill button */}
          {isSessionActive && userMessageCount >= 1 && (
            <button
              onClick={handleFinishAndDistill}
              disabled={isDistilling}
              className="btn-primary flex items-center gap-2 px-3 py-1.5 text-sm"
              aria-label="Finish session and distill notes"
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
              className="btn-secondary flex items-center gap-2 px-3 py-1.5 text-sm"
              aria-label="View distilled notes"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              View Notes
            </button>
          )}
        </div>
      </div>

      {/* Research sources panel (collapsible) */}
      {showResearchPanel && session.researchData && (() => {
        const research = parseResearchData(session.researchData);
        if (!research) return null;
        return (
          <div className="px-4 sm:px-6 py-3 bg-purple-50 dark:bg-purple-900/10 border-b border-purple-200 dark:border-purple-800 shrink-0 overflow-y-auto max-h-64">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-purple-800 dark:text-purple-300 flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Research Sources
              </h3>
              <button
                onClick={() => setShowResearchPanel(false)}
                className="p-1 rounded hover:bg-purple-200 dark:hover:bg-purple-800/30 transition-colors"
                title="Close research panel"
              >
                <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Research summary */}
            {research.summary && (
              <p className="text-xs text-purple-700 dark:text-purple-300 mb-2 line-clamp-3">
                {research.summary}
              </p>
            )}
            {/* Key concepts */}
            {research.relevantConcepts && research.relevantConcepts.length > 0 && (
              <div className="mb-2">
                <span className="text-xs font-medium text-purple-600 dark:text-purple-400">Key concepts: </span>
                <span className="text-xs text-purple-700 dark:text-purple-300">
                  {research.relevantConcepts.join(', ')}
                </span>
              </div>
            )}
            {/* Sources list */}
            {research.sources && research.sources.length > 0 && (
              <div className="space-y-1.5">
                {research.sources.map((source, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      source.type === 'reference_url'
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                    }`}>
                      {source.type === 'reference_url' ? 'URL' : 'AI'}
                    </span>
                    <div className="min-w-0">
                      {source.url ? (
                        <a href={/^https?:\/\//i.test(source.url) ? source.url : '#'} target="_blank" rel="noopener noreferrer" className="text-purple-700 dark:text-purple-300 hover:underline font-medium">
                          {source.title}
                        </a>
                      ) : (
                        <span className="text-purple-700 dark:text-purple-300 font-medium">{source.title}</span>
                      )}
                      {source.snippet && (
                        <p className="text-purple-600/80 dark:text-purple-400/80 mt-0.5 line-clamp-2">{source.snippet}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {research.researchedAt && (
              <p className="text-[10px] text-purple-500 dark:text-purple-500 mt-2">
                Researched at {new Date(research.researchedAt).toLocaleString()}
              </p>
            )}
          </div>
        );
      })()}

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

      {/* Session paused banner */}
      {isSessionPaused && (
        <div className="px-6 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-amber-700 dark:text-amber-300">
                This session is paused. Click Resume to continue your conversation.
              </span>
            </div>
            <button
              onClick={handleResumeSession}
              disabled={isResuming}
              className="text-sm font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 underline shrink-0 ml-4"
            >
              {isResuming ? 'Resuming...' : 'Resume Session'}
            </button>
          </div>
        </div>
      )}

      {/* Session completed banner */}
      {isSessionCompleted && (
        <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-dark-border shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm text-gray-600 dark:text-gray-300">
                This session has been completed and distilled.
                {session.completedAt && ` Completed ${formatDateTime(session.completedAt)}`}
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
      <div className={`flex-1 overflow-y-auto px-3 sm:px-8 py-6 space-y-7 ${isFullscreen ? 'max-w-3xl mx-auto w-full' : ''}`} role="log" aria-label="Interview transcript" aria-live="polite">
        {messages.map((message, i) => (
          <MessageBubble
            key={message.id}
            message={message}
            exchangeNumber={i + 1}
            onToggleBookmark={toggleBookmark}
          />
        ))}

        {/* Streaming AI response bubble */}
        {isStreaming && streamingContent && (
          <div className="flex gap-4" aria-live="polite" aria-label="AI is responding">
            <span className="w-7 shrink-0 pt-1 text-right font-sans text-[11px] text-gray-300 dark:text-gray-700 select-none" aria-hidden="true">··</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-[0.08em] font-medium font-sans text-primary-600 dark:text-primary-400 mb-1.5">
                Interviewer
              </div>
              <div className="font-serif text-[17px] leading-[1.7] text-gray-700 dark:text-gray-300">
                {renderMessageContent(streamingContent)}
                <span className="inline-block w-1.5 h-4 bg-primary-500 dark:bg-primary-400 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
              </div>
            </div>
          </div>
        )}

        {/* Thinking indicator when sending but not yet streaming */}
        {(isSending || isRetrying) && !isStreaming && (
          <div className="flex gap-4">
            <span className="w-7 shrink-0 pt-1 text-right font-sans text-[11px] text-gray-300 dark:text-gray-700 select-none" aria-hidden="true">··</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-[0.08em] font-medium font-sans text-primary-600 dark:text-primary-400 mb-1.5">
                {isRetrying ? 'Interviewer · retrying' : 'Interviewer'}
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {/* Distilling progress indicator */}
        {isDistilling && (
          <div className="flex justify-center px-4" role="status" aria-live="polite" aria-label="Distillation in progress">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl px-6 py-5 w-full max-w-md shadow-sm">
              {/* Header with spinner */}
              <div className="flex items-center gap-3 mb-4">
                <div className="animate-spin w-6 h-6 border-[3px] border-emerald-200 dark:border-emerald-800 border-t-emerald-600 dark:border-t-emerald-400 rounded-full shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                    Generating your notes
                  </p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    This may take a moment
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-emerald-100 dark:bg-emerald-900/40 rounded-full h-1.5 mb-4 overflow-hidden">
                <div
                  className="bg-emerald-500 dark:bg-emerald-400 h-1.5 rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${Math.min(((distillStep + 1) / DISTILL_STEPS.length) * 100, 100)}%` }}
                />
              </div>

              {/* Step list */}
              <div className="space-y-2">
                {DISTILL_STEPS.map((step, index) => (
                  <div key={index} className="flex items-start gap-2.5">
                    {/* Step status icon */}
                    <div className="mt-0.5 shrink-0">
                      {index < distillStep ? (
                        /* Completed step - checkmark */
                        <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : index === distillStep ? (
                        /* Current step - animated dot */
                        <div className="w-4 h-4 flex items-center justify-center">
                          <div className="w-2 h-2 bg-emerald-500 dark:bg-emerald-400 rounded-full animate-pulse" />
                        </div>
                      ) : (
                        /* Pending step - empty circle */
                        <div className="w-4 h-4 flex items-center justify-center">
                          <div className="w-2 h-2 border border-emerald-300 dark:border-emerald-700 rounded-full" />
                        </div>
                      )}
                    </div>
                    {/* Step text */}
                    <div className="min-w-0">
                      <p className={`text-xs leading-snug ${
                        index < distillStep
                          ? 'text-emerald-600 dark:text-emerald-500 line-through'
                          : index === distillStep
                            ? 'text-emerald-800 dark:text-emerald-200 font-medium'
                            : 'text-emerald-400 dark:text-emerald-600'
                      }`}>
                        {step.label}
                      </p>
                      {index === distillStep && (
                        <p className="text-[11px] text-emerald-500 dark:text-emerald-400 mt-0.5">
                          {step.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick replies */}
      {quickReplies.length > 0 && isSessionActive && !isSending && !isDistilling && !isSessionPaused && (
        <div className={`px-3 sm:px-8 py-2 sm:pl-[4.75rem] flex flex-wrap gap-2 shrink-0 ${isFullscreen ? 'max-w-3xl mx-auto w-full' : ''}`} role="group" aria-label="Quick reply options">
          {quickReplies.map((reply, index) => (
            <button
              key={index}
              onClick={() => handleQuickReply(reply)}
              disabled={isSending}
              className="px-4 py-2.5 min-h-[44px] text-sm font-sans rounded-md border border-gray-200 dark:border-dark-border bg-transparent text-gray-700 dark:text-gray-300 hover:border-primary-500 hover:text-primary-700 dark:hover:text-primary-400 hover:bg-panel/50 dark:hover:bg-dark-card/50 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
              aria-label={`Quick reply: ${reply}`}
            >
              {reply}
            </button>
          ))}
        </div>
      )}

      {/* Error banner with retry button */}
      {error && (
        <div className={`px-6 py-2 shrink-0 ${isFullscreen ? 'max-w-4xl mx-auto w-full' : ''}`}>
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <span>{error}</span>
              </div>
              <button
                onClick={() => { setError(null); setFailedMessageContent(null); }}
                className="text-red-400 hover:text-red-600 dark:hover:text-red-300 ml-2 shrink-0 focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
                title="Dismiss"
                aria-label="Dismiss error message"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {failedMessageContent && (
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={handleRetry}
                  disabled={isRetrying || isSending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                  aria-label="Retry sending message"
                >
                  {isRetrying ? (
                    <>
                      <div className="animate-spin w-3.5 h-3.5 border-2 border-red-300 border-t-red-600 rounded-full" />
                      Retrying...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Retry
                    </>
                  )}
                </button>
                <span className="text-xs text-red-500 dark:text-red-400">
                  Your messages are preserved. Click retry to regenerate the AI response.
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Input area */}
      {isSessionActive && !isDistilling && (
        <div className={`px-3 sm:px-8 py-3 sm:py-4 bg-paper dark:bg-dark-bg border-t border-rule dark:border-dark-border shrink-0 ${isFullscreen ? 'max-w-3xl mx-auto w-full' : ''}`}>
          <form onSubmit={handleSubmit} className="flex items-end gap-2 sm:gap-3">
            <div className="flex-1 relative">
              <label htmlFor="session-message-input" className="sr-only">Type your response</label>
              <textarea
                id="session-message-input"
                ref={inputRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={isRecording ? 'Listening… speak now' : 'Take your time…'}
                rows={1}
                className={`input-field resize-none min-h-[44px] max-h-32 py-2.5 pr-3 font-serif text-[16px] placeholder:italic placeholder:font-serif ${isRecording ? 'ring-2 ring-red-400 dark:ring-red-500 border-red-300 dark:border-red-600' : ''}`}
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
            {/* Voice input / microphone button */}
            {isSpeechSupported && (
              <button
                type="button"
                onClick={toggleRecording}
                disabled={isSending}
                className={`flex items-center justify-center w-11 h-11 p-0 shrink-0 rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                  isRecording
                    ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse shadow-lg shadow-red-500/25'
                    : 'border border-rule dark:border-dark-border bg-transparent hover:border-primary-500 text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
                title={isRecording ? 'Stop recording' : 'Voice input'}
                aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
              >
                {isRecording ? (
                  /* Stop icon (square) when recording */
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  /* Microphone icon when idle */
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                )}
              </button>
            )}
            <button
              type="submit"
              disabled={!inputValue.trim() || isSending}
              className="btn-primary flex items-center justify-center w-11 h-11 !p-0 shrink-0 !rounded-full focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
              title="Send message"
              aria-label="Send message"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>
          {/* Recording indicator */}
          {isRecording && (
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
              </span>
              <span className="text-xs font-medium text-red-500 dark:text-red-400">
                Recording... click the stop button or press Enter to send
              </span>
            </div>
          )}
          {/* Voice input indicator */}
          {isVoiceInputPending && !isRecording && inputValue.trim() && (
            <div className="flex items-center justify-center gap-2 mt-2">
              <svg className="w-3.5 h-3.5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <span className="text-xs text-primary-500 dark:text-primary-400">
                Voice input captured — press Enter or click Send
              </span>
            </div>
          )}
          {!isRecording && !isVoiceInputPending && (
            <p className="text-xs text-gray-500 dark:text-gray-300 mt-2 text-center">
              Press Enter to send, Shift+Enter for new line{isSpeechSupported ? ', or use the microphone' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
