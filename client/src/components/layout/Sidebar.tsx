import { useEffect, useRef, useState, type RefObject } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useUser } from '@/contexts/UserContext';
import { getPendingInsightsCount } from '@/services/insights';

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

const navGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { to: '/app/about', label: 'About me' },
      { to: '/app/dashboard', label: 'Desk' },
      { to: '/app/review', label: 'Review', badge: true },
      { to: '/app/chat', label: 'Converse' },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { to: '/app/topics', label: 'Interviews' },
      { to: '/app/import', label: 'Import' },
      { to: '/app/notes', label: 'Notes' },
      { to: '/app/personality', label: 'Personality' },
      { to: '/app/export', label: 'Vault' },
    ],
  },
];

const NAV_GROUPS_KEY = 'memd_nav_collapsed_groups';
const KNOWN_GROUP_LABELS = new Set(['Knowledge']);

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  searchInputRef?: RefObject<HTMLInputElement>;
}

export default function Sidebar({ isOpen, onClose, collapsed = false, onToggleCollapse, searchInputRef }: SidebarProps) {
  const db = useDatabase();
  const { user } = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [searchValue, setSearchValue] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(NAV_GROUPS_KEY) || '{}');
      const cleaned: Record<string, boolean> = {};
      for (const k of Object.keys(raw)) if (KNOWN_GROUP_LABELS.has(k)) cleaned[k] = !!raw[k];
      if (!('Knowledge' in cleaned) && (raw.Library || raw.Explore)) cleaned.Knowledge = true;
      localStorage.setItem(NAV_GROUPS_KEY, JSON.stringify(cleaned));
      return cleaned;
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

  useEffect(() => {
    if (!user) return;
    try {
      setPendingCount(getPendingInsightsCount(db));
    } catch {
      // Leave the previous count in place if the database is briefly unavailable.
    }
  }, [location.pathname, user, db]);

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
          {/* Masthead */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-rule dark:border-dark-border">
            <NavLink to="/app/dashboard" className="flex items-center" onClick={onClose} aria-label="me.md — go to your desk">
              <span className="font-serif italic text-2xl font-semibold text-ink dark:text-gray-100">
                me<span className="text-primary-500 not-italic">.</span>md
              </span>
            </NavLink>

            <div className="flex items-center gap-0.5">
              <NavLink
                to="/app/profile"
                onClick={onClose}
                aria-label="Open your profile"
                title="Your profile"
                className={({ isActive }) =>
                  `flex items-center justify-center w-8 h-8 rounded-full font-serif text-sm transition-colors ${
                    isActive
                      ? 'bg-ink text-paper dark:bg-gray-100 dark:text-dark-bg ring-2 ring-primary-500'
                      : 'bg-ink text-paper dark:bg-gray-100 dark:text-dark-bg hover:ring-2 hover:ring-primary-500/40'
                  }`
                }
              >
                <span aria-hidden="true">{user?.name?.charAt(0).toUpperCase() || '?'}</span>
              </NavLink>

              <NavLink
                to="/app/settings"
                onClick={onClose}
                aria-label="Settings"
                title="Settings"
                className={({ isActive }) =>
                  `flex items-center justify-center w-8 h-8 rounded-md transition-colors ${
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
          </div>

          {/* Search */}
          <div className="px-4 py-3 border-b border-rule dark:border-dark-border">
            <div className="relative">
              <svg className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={searchInputRef}
                type="search"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const q = searchValue.trim();
                    if (!q) return;
                    navigate(`/app/search?q=${encodeURIComponent(q)}`);
                    onClose();
                  }
                }}
                placeholder="Search"
                aria-label="Search topics, insights, sessions, and notes"
                aria-keyshortcuts="Meta+K Control+K"
                className="w-full bg-transparent border-0 border-b border-rule dark:border-dark-border focus:border-primary-500 dark:focus:border-primary-400 pl-6 pr-2 py-1.5 text-sm text-ink dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-600 placeholder:uppercase placeholder:text-[11px] placeholder:tracking-[0.12em] focus:outline-none focus:ring-0 transition-colors"
              />
            </div>
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
                      <span className="text-[11px] uppercase tracking-[0.12em] font-sans font-semibold text-gray-600 dark:text-gray-400 group-hover/heading:text-gray-600 dark:group-hover/heading:text-gray-400 transition-colors">
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
                      {group.items.map((item) => (
                        <li key={item.to} role="listitem">
                          <NavLink
                            to={item.to}
                            end={item.end}
                            onClick={onClose}
                            aria-label={item.label}
                            className={({ isActive }) =>
                              `group flex items-center gap-2 pl-2.5 pr-3 py-1 rounded-md border-l-2 font-sans text-[13.5px] transition-colors duration-150 ${
                                isActive
                                  ? 'border-primary-500 bg-panel dark:bg-dark-card text-ink dark:text-gray-100 font-semibold'
                                  : 'border-transparent text-gray-600 dark:text-gray-400 font-medium hover:bg-panel/60 dark:hover:bg-dark-card/60 hover:text-ink dark:hover:text-gray-100'
                              }`
                            }
                          >
                            <span className="flex-1">{item.label}</span>
                            {item.badge && pendingCount > 0 && (
                              <span className="text-[11px] tabular-nums text-gray-400 dark:text-gray-600 shrink-0" aria-label={`${pendingCount} awaiting review`}>
                                {pendingCount}
                              </span>
                            )}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </nav>
        </div>
      </aside>
    </>
  );
}
