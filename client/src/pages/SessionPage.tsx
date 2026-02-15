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
  const recognitionRef = useRef<SpeechRecognition | null>(null);
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

  // Pause session
  const handlePauseSession = async () => {
    if (!user || !session) return;

    setIsPausing(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${session.id}/pause`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to pause session');
      }

      const data = await res.json();
      setSession(data.session);
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
      const res = await fetch(`/api/sessions/${session.id}/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to resume session');
      }

      const data = await res.json();
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

  // Regenerate note content in current format from session messages
  const handleRegenerateContent = async () => {
    if (!user || !session || !note || isRegenerating) return;

    setIsRegenerating(true);
    setRegenerateSuccess(false);
    setError(null);

    try {
      const res = await fetch(`/api/sessions/${session.id}/distill/regenerate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ format: selectedFormat, regenerateContent: true }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to regenerate note');
      }

      const data = await res.json();
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

      const res = await fetch(`/api/notes/${note.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify(updatePayload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save note');
      }

      const data = await res.json();
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
    if (!user || !session || !content.trim() || isSending) return;

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

    try {
      const abortController = new AbortController();
      streamAbortRef.current = abortController;

      const res = await fetch(`/api/sessions/${session.id}/messages/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ content: trimmedContent, isVoiceInput: isVoice }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to send message');
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('Streaming not supported');
      }

      const decoder = new TextDecoder();
      let accumulatedContent = '';
      let buffer = '';

      // Process the SSE stream
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events (lines ending with \n\n)
        const events = buffer.split('\n\n');
        buffer = events.pop() || ''; // Keep incomplete event in buffer

        for (const eventStr of events) {
          const lines = eventStr.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));

                if (data.type === 'user_message') {
                  // Replace temp user message with the real one
                  setMessages(prev => prev.map(m =>
                    m.id === tempUserMessage.id ? data.message : m
                  ));
                } else if (data.type === 'ai_chunk') {
                  accumulatedContent += data.chunk;
                  setStreamingContent(accumulatedContent);
                  setIsStreaming(true);
                } else if (data.type === 'ai_complete') {
                  // Replace streaming content with the final complete message
                  setStreamingContent('');
                  setIsStreaming(false);
                  setMessages(prev => [...prev, data.message]);
                } else if (data.type === 'error') {
                  throw new Error(data.error || 'Streaming error');
                }
              } catch (parseErr) {
                // Ignore JSON parse errors for incomplete data
                if (parseErr instanceof SyntaxError) continue;
                throw parseErr;
              }
            }
          }
        }
      }

      // Fallback: if stream ended without ai_complete
      if (isStreaming) {
        setStreamingContent('');
        setIsStreaming(false);
      }

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setError('Something went wrong while generating the AI response. Please try again.');
      // Keep the user message visible but store content for retry
      setFailedMessageContent(trimmedContent);
      setStreamingContent('');
      setIsStreaming(false);
    } finally {
      setIsSending(false);
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

    try {
      const abortController = new AbortController();
      streamAbortRef.current = abortController;

      // The user message was already stored on the server from the first attempt.
      // We need to re-send to get the AI response. Use the non-streaming fallback
      // endpoint which creates both user message + AI response.
      // But since the user message may already exist, we use the stream endpoint
      // which handles the full flow. Let's re-fetch the session to get the latest
      // messages first, then only request a retry of the AI generation.

      // First, refresh messages to see if the user message was actually saved
      const sessionRes = await fetch(`/api/sessions/${session.id}`, {
        headers: { 'x-user-id': user.id },
      });

      if (sessionRes.ok) {
        const sessionData = await sessionRes.json();
        const serverMessages: Message[] = sessionData.messages || [];
        setMessages(serverMessages);

        // Check if the last message is from the user (meaning AI response failed)
        const lastMsg = serverMessages[serverMessages.length - 1];
        if (lastMsg && lastMsg.role === 'user') {
          // AI response failed - need to regenerate it
          // Use the retry endpoint
          const retryRes = await fetch(`/api/sessions/${session.id}/messages/retry`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': user.id,
            },
            signal: abortController.signal,
          });

          if (!retryRes.ok) {
            const data = await retryRes.json();
            throw new Error(data.error || 'Failed to retry');
          }

          const retryData = await retryRes.json();
          setMessages(prev => [...prev, retryData.aiMessage]);
          setFailedMessageContent(null);
        } else {
          // The user message wasn't saved, resend it
          const res = await fetch(`/api/sessions/${session.id}/messages/stream`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': user.id,
            },
            body: JSON.stringify({ content: failedMessageContent }),
            signal: abortController.signal,
          });

          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to send message');
          }

          const reader = res.body?.getReader();
          if (!reader) throw new Error('Streaming not supported');

          const decoder = new TextDecoder();
          let accumulatedContent = '';
          let bufferStr = '';

          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            bufferStr += decoder.decode(value, { stream: true });
            const events = bufferStr.split('\n\n');
            bufferStr = events.pop() || '';

            for (const eventStr of events) {
              const lines = eventStr.split('\n');
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    if (data.type === 'user_message') {
                      setMessages(prev => [...prev, data.message]);
                    } else if (data.type === 'ai_chunk') {
                      accumulatedContent += data.chunk;
                      setStreamingContent(accumulatedContent);
                      setIsStreaming(true);
                    } else if (data.type === 'ai_complete') {
                      setStreamingContent('');
                      setIsStreaming(false);
                      setMessages(prev => [...prev, data.message]);
                    } else if (data.type === 'error') {
                      throw new Error(data.error || 'Streaming error');
                    }
                  } catch (parseErr) {
                    if (parseErr instanceof SyntaxError) continue;
                    throw parseErr;
                  }
                }
              }
            }
          }
          setFailedMessageContent(null);
        }
      } else {
        throw new Error('Failed to fetch session state');
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError('Retry failed. Please check your connection and try again.');
    } finally {
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
  const toggleBookmark = async (message: Message) => {
    if (!user || !session) return;

    const isCurrentlyBookmarked = message.isBookmarked;

    // Optimistic update
    setMessages(prev => prev.map(m =>
      m.id === message.id ? { ...m, isBookmarked: !isCurrentlyBookmarked } : m
    ));

    try {
      if (isCurrentlyBookmarked) {
        // Remove bookmark
        const res = await fetch(`/api/bookmarks/${message.id}`, {
          method: 'DELETE',
          headers: { 'x-user-id': user.id },
        });
        if (!res.ok) throw new Error('Failed to remove bookmark');
      } else {
        // Add bookmark
        const res = await fetch('/api/bookmarks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': user.id,
          },
          body: JSON.stringify({
            messageId: message.id,
            sessionId: session.id,
          }),
        });
        if (!res.ok) throw new Error('Failed to add bookmark');
      }
    } catch {
      // Revert optimistic update
      setMessages(prev => prev.map(m =>
        m.id === message.id ? { ...m, isBookmarked: isCurrentlyBookmarked } : m
      ));
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
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="min-w-0">
              {/* Breadcrumb navigation */}
              <nav className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 mb-0.5">
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

        {/* Format selector with regenerate and edit buttons */}
        <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-dark-border shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 overflow-x-auto">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 shrink-0">Format:</span>
              {(Object.entries(FORMAT_LABELS) as [NoteFormat, string][]).map(([format, label]) => (
                <button
                  key={format}
                  onClick={() => handleFormatChange(format)}
                  disabled={isRegenerating || isSavingNote}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors shrink-0 ${
                    selectedFormat === format
                      ? 'bg-primary-600 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Edit button */}
              {!isEditingNote && (
                <button
                  onClick={handleStartEdit}
                  disabled={isRegenerating}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                  disabled={isRegenerating}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Regenerate note content in current format from session messages"
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
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Re-analyzing session messages
                </p>
              </div>
            </div>
          )}

          {/* Edit mode: Markdown textarea editor */}
          {isEditingNote && !isRegenerating && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
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
              <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
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
    <div className={`flex flex-col ${isFullscreen ? 'fixed inset-0 z-[60] bg-gray-50 dark:bg-dark-bg' : 'h-full max-w-4xl mx-auto -m-6'}`}>
      {/* Session header with breadcrumb */}
      <div className="flex items-center justify-between px-6 py-3 bg-white dark:bg-dark-surface border-b border-gray-200 dark:border-dark-border shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {!isFullscreen && (
            <Link
              to={`/app/topics/${topic.id}`}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0"
              title="Back to topic"
            >
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
          )}
          <div className="min-w-0">
            {/* Breadcrumb navigation - hidden in fullscreen */}
            {!isFullscreen && (
              <nav className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 mb-0.5">
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
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isSessionActive ? 'bg-green-500 animate-pulse' : isSessionPaused ? 'bg-amber-500' : 'bg-gray-400'}`} />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {isFullscreen ? `${topic.title} — ` : ''}
                {isSessionActive ? 'Interview Session' : isSessionPaused ? 'Session Paused' : 'Session Completed'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-gray-400 dark:text-gray-500">
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
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            )}
          </button>
          {/* Pause button */}
          {isSessionActive && (
            <button
              onClick={handlePauseSession}
              disabled={isPausing || isSending || isDistilling}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPausing ? (
                <>
                  <div className="animate-spin w-3.5 h-3.5 border-2 border-amber-300 border-t-amber-600 rounded-full" />
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
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-600 hover:bg-primary-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
      <div className={`flex-1 overflow-y-auto px-6 py-4 space-y-4 ${isFullscreen ? 'max-w-4xl mx-auto w-full' : ''}`}>
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
              <div className={`text-xs font-medium mb-1 flex items-center gap-1 ${
                message.role === 'user'
                  ? 'text-primary-200'
                  : 'text-gray-500 dark:text-gray-400'
              }`}>
                {message.role === 'user' ? 'You' : 'AI Interviewer'}
                {message.isVoiceInput && (
                  <span className="inline-flex" aria-label="Voice input">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  </span>
                )}
              </div>

              {/* Message content */}
              <div className={`text-sm leading-relaxed ${
                message.role === 'user' ? 'text-white' : ''
              }`}>
                {renderContent(message.content)}
              </div>

              {/* Timestamp and bookmark */}
              <div className={`flex items-center justify-between mt-2 ${
                message.role === 'user'
                  ? 'text-primary-300'
                  : 'text-gray-400 dark:text-gray-500'
              }`}>
                <span className="text-xs">
                  {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {/* Bookmark button - only show for real messages (not temp) */}
                {!message.id.startsWith('temp-') && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleBookmark(message);
                    }}
                    className={`ml-2 p-0.5 rounded transition-colors ${
                      message.isBookmarked
                        ? message.role === 'user'
                          ? 'text-yellow-300 hover:text-yellow-200'
                          : 'text-yellow-500 hover:text-yellow-600 dark:text-yellow-400 dark:hover:text-yellow-300'
                        : message.role === 'user'
                          ? 'text-primary-300 hover:text-yellow-300 opacity-60 hover:opacity-100'
                          : 'text-gray-300 dark:text-gray-600 hover:text-yellow-500 dark:hover:text-yellow-400 opacity-60 hover:opacity-100'
                    }`}
                    title={message.isBookmarked ? 'Remove bookmark' : 'Bookmark this message'}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill={message.isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Streaming AI response bubble */}
        {isStreaming && streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%] bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                AI Interviewer
              </div>
              <div className="text-sm leading-relaxed">
                {renderContent(streamingContent)}
                <span className="inline-block w-1.5 h-4 bg-primary-500 dark:bg-primary-400 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
              </div>
            </div>
          </div>
        )}

        {/* Thinking indicator when sending but not yet streaming */}
        {(isSending || isRetrying) && !isStreaming && (
          <div className="flex justify-start">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                {isRetrying ? 'AI Interviewer (Retrying...)' : 'AI Interviewer'}
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
      {quickReplies.length > 0 && isSessionActive && !isSending && !isDistilling && !isSessionPaused && (
        <div className={`px-6 py-2 flex flex-wrap gap-2 shrink-0 ${isFullscreen ? 'max-w-4xl mx-auto w-full' : ''}`}>
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
                className="text-red-400 hover:text-red-600 dark:hover:text-red-300 ml-2 shrink-0"
                title="Dismiss"
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
        <div className={`px-6 py-4 bg-white dark:bg-dark-surface border-t border-gray-200 dark:border-dark-border shrink-0 ${isFullscreen ? 'max-w-4xl mx-auto w-full' : ''}`}>
          <form onSubmit={handleSubmit} className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={isRecording ? 'Listening... speak now' : 'Type your response...'}
                rows={1}
                className={`input-field resize-none min-h-[44px] max-h-32 py-2.5 pr-3 ${isRecording ? 'ring-2 ring-red-400 dark:ring-red-500 border-red-300 dark:border-red-600' : ''}`}
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
                className={`flex items-center justify-center w-11 h-11 p-0 shrink-0 rounded-xl transition-all ${
                  isRecording
                    ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse shadow-lg shadow-red-500/25'
                    : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300'
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
              className="btn-primary flex items-center justify-center w-11 h-11 p-0 shrink-0 rounded-xl"
              title="Send message"
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
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">
              Press Enter to send, Shift+Enter for new line{isSpeechSupported ? ', or use the microphone' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
