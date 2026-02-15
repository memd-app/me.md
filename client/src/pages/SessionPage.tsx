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

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [session, setSession] = useState<Session | null>(null);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load session');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSession();
  }, [user, id]);

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

  // Render markdown-like bold text
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
          <span className="text-4xl block mb-3">😕</span>
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
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Interview Session
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {messages.filter(m => m.role === 'user').length} messages
          </span>
        </div>
      </div>

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

        <div ref={messagesEndRef} />
      </div>

      {/* Quick replies */}
      {quickReplies.length > 0 && isSessionActive && !isSending && (
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
      {isSessionActive && (
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
