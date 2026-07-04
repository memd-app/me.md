import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

const COLLAPSE_KEY = 'memd_sidebar_collapsed';

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');

  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  // Cmd/Ctrl+B toggles the sidebar, like most editors
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleCollapsed]);

  return (
    <div className="flex h-screen bg-paper dark:bg-dark-bg">
      {/* Skip to main content link - first focusable element for keyboard users */}
      <a
        href="#main-content"
        className="skip-to-content"
      >
        Skip to main content
      </a>

      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
      />

      {/* Floating reopen control when the sidebar is collapsed (desktop) */}
      {collapsed && (
        <button
          onClick={toggleCollapsed}
          className="hidden lg:flex fixed left-3 top-3 z-30 items-center justify-center w-9 h-9 rounded-md border border-rule dark:border-dark-border bg-paper dark:bg-dark-bg text-gray-500 dark:text-gray-400 hover:text-ink dark:hover:text-gray-100 hover:border-primary-500 transition-colors"
          aria-label="Open sidebar"
          aria-expanded={false}
          aria-controls="sidebar-nav"
          title="Open sidebar (⌘B)"
        >
          <svg className="w-4.5 h-4.5 w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </button>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar (mobile) */}
        <header
          className="lg:hidden flex items-center justify-between px-4 py-3 bg-paper dark:bg-dark-bg border-b border-rule dark:border-dark-border"
          aria-label="Mobile header"
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2.5 rounded-md hover:bg-panel dark:hover:bg-dark-card min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Open navigation menu"
            aria-expanded={sidebarOpen}
            aria-controls="sidebar-nav"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-serif italic text-lg font-semibold text-ink dark:text-gray-100" aria-hidden="true">
            me<span className="text-primary-500 not-italic">.</span>md
          </span>
          <div className="w-10" aria-hidden="true" /> {/* Spacer for centering */}
        </header>

        {/* Page content */}
        <main
          id="main-content"
          role="main"
          className="flex-1 overflow-y-auto p-4 sm:p-6 overflow-x-hidden"
          aria-label="Page content"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
