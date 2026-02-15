import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-dark-bg">
      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar (mobile) */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white dark:bg-dark-surface border-b border-gray-200 dark:border-dark-border">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Open menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-lg font-bold text-primary-600">me.md</span>
          <div className="w-10" /> {/* Spacer for centering */}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
