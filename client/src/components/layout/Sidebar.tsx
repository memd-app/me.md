import { useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const navItems = [
  { to: '/app', label: 'Dashboard', icon: '📊', end: true },
  { to: '/app/topics', label: 'Topics', icon: '📋' },
  { to: '/app/session/new', label: 'New Session', icon: '💬' },
  { to: '/app/notes', label: 'Notes', icon: '📝' },
  { to: '/app/graph', label: 'Knowledge Graph', icon: '🔗' },
  { to: '/app/profile', label: 'Profile', icon: '👤' },
  { to: '/app/verify', label: 'Verification', icon: '✅' },
  { to: '/app/sandbox', label: 'Sandbox', icon: '🧪' },
  { to: '/app/bookmarks', label: 'Bookmarks', icon: '⭐' },
  { to: '/app/search', label: 'Search', icon: '🔍' },
  { to: '/app/export', label: 'Export', icon: '📤' },
  { to: '/app/settings', label: 'Settings', icon: '⚙️' },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  // Trap focus in sidebar when open on mobile + handle Escape key
  useEffect(() => {
    if (isOpen) {
      // Focus the close button when sidebar opens on mobile
      closeButtonRef.current?.focus();

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        id="sidebar-nav"
        role="complementary"
        aria-label="Application sidebar"
        className={`
          fixed top-0 left-0 z-50 h-full w-64
          bg-white dark:bg-dark-surface border-r border-gray-200 dark:border-dark-border
          transform transition-transform duration-200 ease-in-out
          lg:translate-x-0 lg:static lg:z-auto
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-dark-border">
            <NavLink to="/app" className="flex items-center gap-2" onClick={onClose} aria-label="me.md - Go to dashboard">
              <span className="text-xl font-bold text-primary-600">me.md</span>
            </NavLink>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="lg:hidden p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label="Close navigation menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto py-4 px-3" role="navigation" aria-label="Main navigation">
            <ul className="space-y-1" role="list">
              {navItems.map((item) => (
                <li key={item.to} role="listitem">
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onClose}
                    aria-label={item.label}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
                        isActive
                          ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-100'
                      }`
                    }
                  >
                    <span className="text-base" aria-hidden="true">{item.icon}</span>
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* User section */}
          <div className="border-t border-gray-200 dark:border-dark-border p-4" role="region" aria-label="User account">
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center text-sm font-medium text-primary-700 dark:text-primary-300"
                aria-hidden="true"
              >
                {user?.name?.charAt(0).toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {user?.name || 'User'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-300 truncate">
                  {user?.email || ''}
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg transition-colors"
              aria-label="Sign out of your account"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
