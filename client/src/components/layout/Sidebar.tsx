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

interface NavGroup {
  label: string | null;
  items: NavItem[];
}

// The daily loop stays always visible; the library and explore groups
// can be collapsed (persisted per group).
const navGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { to: '/app/dashboard', label: 'Desk' },
      { to: '/app/session/new', label: 'Interview' },
      { to: '/app/review', label: 'Review' },
      { to: '/app/chat', label: 'Converse' },
    ],
  },
  {
    label: 'Library',
    items: [
      { to: '/app/topics', label: 'Topics' },
      { to: '/app/notes', label: 'Notes' },
      { to: '/app/import', label: 'Import' },
      { to: '/app/graph', label: 'Graph' },
    ],
  },
  {
    label: 'Explore',
    items: [
      { to: '/app/personality', label: 'Personality' },
      { to: '/app/search', label: 'Search' },
    ],
  },
];

const NAV_GROUPS_KEY = 'memd_nav_collapsed_groups';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function Sidebar({ isOpen, onClose, collapsed = false, onToggleCollapse }: SidebarProps) {
  const { user } = useUser();
  const db = useDatabase();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [hasNeverTakenTest, setHasNeverTakenTest] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(NAV_GROUPS_KEY) || '{}');
    } catch {
      return {};
    }
  });

  const toggleGroup = (label: string) => {
    setCollapsedGroups(prev => {
      const next = { ...prev, [label]: !prev[label] };
      localStorage.setItem(NAV_GROUPS_KEY, JSON.stringify(next));
      return next;
    });
  };

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
          ${collapsed ? 'lg:hidden' : 'lg:translate-x-0 lg:static lg:z-auto'}
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
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="hidden lg:flex items-center justify-center w-8 h-8 rounded-md text-gray-400 dark:text-gray-600 hover:text-ink dark:hover:text-gray-100 hover:bg-panel dark:hover:bg-dark-card transition-colors"
                aria-label="Collapse sidebar"
                aria-expanded={!collapsed}
                aria-controls="sidebar-nav"
                title="Collapse sidebar (⌘B)"
              >
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M9 4v16" />
                </svg>
              </button>
            )}
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
          <nav className="flex-1 overflow-y-auto py-4 px-3" role="navigation" aria-label="Main navigation">
            {navGroups.map((group) => {
              const isCollapsed = group.label ? !!collapsedGroups[group.label] : false;
              return (
                <div key={group.label ?? 'main'} className="mb-1.5">
                  {group.label && (
                    <button
                      onClick={() => toggleGroup(group.label!)}
                      className="group/heading w-full flex items-center gap-2 px-3 pt-4 pb-1.5"
                      aria-expanded={!isCollapsed}
                      aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${group.label} section`}
                    >
                      <span className="text-[10px] uppercase tracking-[0.12em] font-sans font-semibold text-gray-400 dark:text-gray-600 group-hover/heading:text-gray-600 dark:group-hover/heading:text-gray-400 transition-colors">
                        {group.label}
                      </span>
                      <span className="flex-1 border-t border-rule dark:border-dark-border" aria-hidden="true" />
                      <svg
                        className={`w-3 h-3 text-gray-300 dark:text-gray-700 group-hover/heading:text-gray-500 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                        fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  )}
                  {!isCollapsed && (
                    <ul className="space-y-0.5" role="list">
                      {group.items.map((item) => {
                        const badge = item.to === '/app/personality' && hasNeverTakenTest;
                        return (
                          <li key={item.to} role="listitem">
                            <NavLink
                              to={item.to}
                              end={item.end}
                              onClick={onClose}
                              aria-label={badge ? `${item.label} (not taken yet)` : item.label}
                              className={({ isActive }) =>
                                `group flex items-center gap-3 px-3 py-1.5 rounded-md font-sans text-[13.5px] font-medium transition-colors duration-150 ${
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
                                  {badge && (
                                    <span
                                      className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse"
                                      aria-label="Not taken yet"
                                    />
                                  )}
                                </>
                              )}
                            </NavLink>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </nav>

          {/* User section — profile link + settings, side by side */}
          <div className="border-t border-rule dark:border-dark-border p-4 flex items-center gap-1" role="region" aria-label="User account">
            <NavLink
              to="/app/profile"
              onClick={onClose}
              aria-label="Open your profile"
              className={({ isActive }) =>
                `flex flex-1 min-w-0 items-center gap-3 rounded-md px-2 py-1.5 transition-colors ${
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
            <NavLink
              to="/app/settings"
              onClick={onClose}
              aria-label="Settings"
              title="Settings"
              className={({ isActive }) =>
                `flex items-center justify-center w-9 h-9 shrink-0 rounded-md transition-colors ${
                  isActive
                    ? 'bg-panel dark:bg-dark-card text-ink dark:text-gray-100'
                    : 'text-gray-400 dark:text-gray-600 hover:text-ink dark:hover:text-gray-100 hover:bg-panel/60 dark:hover:bg-dark-card/60'
                }`
              }
            >
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </NavLink>
          </div>
        </div>
      </aside>
    </>
  );
}
