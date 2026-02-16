import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-dark-bg">
      {/* Skip to main content link - first focusable element for keyboard users */}
      <a
        href="#main-content"
        className="skip-to-content"
      >
        Skip to main content
      </a>

      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar (mobile) */}
        <header
          className="lg:hidden flex items-center justify-between px-4 py-3 bg-white dark:bg-dark-surface border-b border-gray-200 dark:border-dark-border"
          aria-label="Mobile header"
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Open navigation menu"
            aria-expanded={sidebarOpen}
            aria-controls="sidebar-nav"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-lg font-bold text-primary-600" aria-hidden="true">me.md</span>
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
