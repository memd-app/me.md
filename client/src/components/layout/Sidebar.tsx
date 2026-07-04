import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { assessmentAttempts } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { LOCAL_USER_ID } from '@/contexts/UserContext';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  badge?: boolean;
}

const navItems: NavItem[] = [
  { to: '/app/dashboard', label: 'Desk' },
  { to: '/app/topics', label: 'Topics' },
  { to: '/app/session/new', label: 'Interview' },
  { to: '/app/review', label: 'Review' },
  { to: '/app/graph', label: 'Graph' },
  { to: '/app/notes', label: 'Notes' },
  // Temporary until the Notes/Bookmarks merge slice — must stay reachable
  { to: '/app/bookmarks', label: 'Bookmarks' },
  { to: '/app/personality', label: 'Personality' },
  { to: '/app/search', label: 'Search' },
  { to: '/app/sandbox', label: 'Sandbox' },
  { to: '/app/settings', label: 'Settings' },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user } = useUser();
  const db = useDatabase();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [hasNeverTakenTest, setHasNeverTakenTest] = useState(false);

  // Check if user has ever taken the personality assessment (from local DB)
  useEffect(() => {
    if (!user) return;
    try {
      const attempts = db.select().from(assessmentAttempts)
        .where(eq(assessmentAttempts.userId, LOCAL_USER_ID))
        .all();
      const hasCompleted = attempts.some((a: { status: string | null }) => a.status === 'completed');
      setHasNeverTakenTest(!hasCompleted);
    } catch {
      // ignore - table may not exist yet
    }
  }, [user, db]);

  // Compute nav items with badge info
  const navItemsWithBadge = navItems.map(item => ({
    ...item,
    badge: item.to === '/app/personality' && hasNeverTakenTest,
  }));

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
          fixed top-0 left-0 z-50 h-full w-60
          bg-paper dark:bg-dark-bg border-r border-rule dark:border-dark-border
          transform transition-transform duration-200 ease-in-out
          lg:translate-x-0 lg:static lg:z-auto
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex flex-col h-full">
          {/* Wordmark */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-rule dark:border-dark-border">
            <NavLink to="/app/dashboard" className="flex items-center" onClick={onClose} aria-label="me.md - Go to your desk">
              <span className="font-serif italic text-2xl font-semibold text-ink dark:text-gray-100">
                me<span className="text-primary-500 not-italic">.</span>md
              </span>
            </NavLink>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="lg:hidden p-1 rounded-md hover:bg-panel dark:hover:bg-dark-card"
              aria-label="Close navigation menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto py-5 px-3" role="navigation" aria-label="Main navigation">
            <ul className="space-y-0.5" role="list">
              {navItemsWithBadge.map((item) => (
                <li key={item.to} role="listitem">
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onClose}
                    aria-label={item.badge ? `${item.label} (not taken yet)` : item.label}
                    className={({ isActive }) =>
                      `group flex items-center gap-3 px-3 py-2 rounded-md font-sans text-[12px] font-medium uppercase tracking-[0.08em] transition-colors duration-150 ${
                        isActive
                          ? 'bg-panel dark:bg-dark-card text-ink dark:text-gray-100'
                          : 'text-gray-600 dark:text-gray-400 hover:bg-panel/60 dark:hover:bg-dark-card/60 hover:text-ink dark:hover:text-gray-100'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          aria-hidden="true"
                          className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                            isActive ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-700 group-hover:bg-primary-300'
                          }`}
                        />
                        <span className="flex-1">{item.label}</span>
                        {item.badge && (
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse"
                            aria-label="Not taken yet"
                          />
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* User section — links to the profile reading surface */}
          <div className="border-t border-rule dark:border-dark-border p-4" role="region" aria-label="User account">
            <NavLink
              to="/app/profile"
              onClick={onClose}
              aria-label="Open your profile"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors ${
                  isActive ? 'bg-panel dark:bg-dark-card' : 'hover:bg-panel/60 dark:hover:bg-dark-card/60'
                }`
              }
            >
              <div
                className="w-8 h-8 rounded-full bg-ink dark:bg-gray-100 flex items-center justify-center font-serif text-sm text-paper dark:text-dark-bg"
                aria-hidden="true"
              >
                {user?.name?.charAt(0).toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink dark:text-gray-100 truncate">
                  {user?.name || 'User'}
                </p>
                <p className="text-[11px] uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400 truncate">
                  Your profile
                </p>
              </div>
            </NavLink>
          </div>
        </div>
      </aside>
    </>
  );
}
