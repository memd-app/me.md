import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType, duration?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

let toastCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback((message: string, type: ToastType = 'success', duration = 4000) => {
    const id = `toast-${++toastCounter}-${Date.now()}`;
    const toast: Toast = { id, type, message, duration };
    setToasts((prev) => [...prev, toast]);

    if (duration > 0) {
      const timer = setTimeout(() => {
        removeToast(id);
      }, duration);
      timersRef.current.set(id, timer);
    }

    return id;
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// Toast container renders at the top-right of the viewport
function ToastContainer({ toasts, removeToast }: { toasts: Toast[]; removeToast: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const bgColors: Record<ToastType, string> = {
    success: 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700',
    error: 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700',
    info: 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700',
    warning: 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-700',
  };

  const textColors: Record<ToastType, string> = {
    success: 'text-green-800 dark:text-green-200',
    error: 'text-red-800 dark:text-red-200',
    info: 'text-blue-800 dark:text-blue-200',
    warning: 'text-amber-800 dark:text-amber-200',
  };

  const icons: Record<ToastType, string> = {
    success: '\u2713',
    error: '\u2717',
    info: '\u2139',
    warning: '\u26A0',
  };

  return (
    <div
      role="alert"
      className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg transition-all duration-300 animate-slide-in ${bgColors[toast.type]}`}
    >
      <span className={`text-lg font-bold flex-shrink-0 ${textColors[toast.type]}`} aria-hidden="true">
        {icons[toast.type]}
      </span>
      <p className={`text-sm font-medium flex-1 ${textColors[toast.type]}`}>
        {toast.message}
      </p>
      <button
        onClick={onDismiss}
        className={`flex-shrink-0 ml-2 text-lg leading-none opacity-60 hover:opacity-100 transition-opacity ${textColors[toast.type]}`}
        aria-label="Dismiss notification"
      >
        &times;
      </button>
    </div>
  );
}
