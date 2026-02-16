/**
 * Shared date formatting utilities for me.md
 *
 * All functions use the user's local timezone via the browser's
 * Intl.DateTimeFormat / Date.toLocaleString APIs.
 * Dates from the server are ISO 8601 (UTC) and are automatically
 * converted to the user's timezone when displayed.
 */

/**
 * Relative time formatting (e.g., "Just now", "5m ago", "2h ago", "3d ago")
 * Falls back to short date for older dates.
 */
export function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return typeof dateStr === 'string' ? dateStr : '';
  }
}

/**
 * Short date format (e.g., "Jan 15, 2025")
 * Omits year if same as current year.
 */
export function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    const now = new Date();
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return typeof dateStr === 'string' ? dateStr : '';
  }
}

/**
 * Full date format (e.g., "January 15, 2025")
 */
export function formatFullDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return typeof dateStr === 'string' ? dateStr : '';
  }
}

/**
 * Date and time format (e.g., "Jan 15, 2025, 2:30 PM")
 */
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return typeof dateStr === 'string' ? dateStr : '';
  }
}

/**
 * Time only format (e.g., "2:30 PM")
 */
export function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return typeof dateStr === 'string' ? dateStr : '';
  }
}

/**
 * Activity feed format (e.g., "Mon, Jan 15 at 2:30 PM")
 * Includes weekday for recent items.
 */
export function formatActivityDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    const now = new Date();
    const datePart = date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
    const timePart = date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    return `${datePart} at ${timePart}`;
  } catch {
    return typeof dateStr === 'string' ? dateStr : '';
  }
}

/**
 * Format for MCP/settings dates - returns "Never" for null values
 */
export function formatSettingsDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  return formatDateTime(dateStr);
}
