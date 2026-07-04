import { NavLink } from 'react-router-dom';

interface PageTab {
  to: string;
  label: string;
  /** Exact-match the route (NavLink `end`) */
  end?: boolean;
  count?: number;
}

/**
 * Editorial tab row for sibling destinations that live together
 * (Notes/Bookmarks, the Personality section): small-caps links with an
 * amber underline on the active tab, sitting on a shared hairline.
 */
export default function PageTabs({ tabs, className = '' }: { tabs: PageTab[]; className?: string }) {
  return (
    <nav
      className={`flex items-center gap-6 border-b border-rule dark:border-dark-border mb-6 ${className}`.trim()}
      aria-label="Section tabs"
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            `-mb-px pb-2 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold border-b-2 transition-colors ${
              isActive
                ? 'text-primary-600 dark:text-primary-400 border-primary-500 dark:border-primary-400'
                : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-ink dark:hover:text-gray-100'
            }`
          }
        >
          {tab.label}
          {typeof tab.count === 'number' && tab.count > 0 && (
            <span className="ml-1 font-normal normal-case tracking-normal text-gray-400 dark:text-gray-600">
              ({tab.count})
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
