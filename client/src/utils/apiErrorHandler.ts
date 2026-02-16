/**
 * API error handling utilities.
 *
 * Provides helpers that convert raw fetch / server errors into
 * user-friendly messages suitable for display in the UI.
 */

/**
 * A structured API error that carries both a user-facing message
 * and the original HTTP status code (when available).
 */
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Convert an HTTP status code + optional server message to a
 * user-friendly error string.
 */
export function friendlyErrorForStatus(status: number, serverMessage?: string): string {
  switch (status) {
    case 400:
      return serverMessage || 'The request was invalid. Please check your input and try again.';
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 403:
      return 'You don\'t have permission to perform this action.';
    case 404:
      return serverMessage || 'The requested item could not be found. It may have been deleted.';
    case 409:
      return serverMessage || 'A conflict occurred. The item may already exist.';
    case 429:
      return 'Too many requests. Please wait a moment and try again.';
    case 500:
      return 'The server encountered an unexpected error. Please try again in a moment. If the problem persists, contact support.';
    case 502:
    case 503:
    case 504:
      return 'The server is temporarily unavailable. Please try again in a few minutes.';
    default:
      if (status >= 500) {
        return 'A server error occurred. Please try again later. If the problem persists, contact support.';
      }
      return serverMessage || 'Something went wrong. Please try again.';
  }
}

/**
 * Process a fetch Response that is not ok, and throw an ApiError
 * with a user-friendly message.
 *
 * Usage:
 *   const res = await fetch(url);
 *   if (!res.ok) throw await toApiError(res);
 */
export async function toApiError(res: Response): Promise<ApiError> {
  let serverMessage: string | undefined;
  try {
    const body = await res.json();
    serverMessage = body.error || body.message;
  } catch {
    // Could not parse JSON — that's fine, we'll fall back to status-based messages
  }

  // For 500 errors, always use our friendly message regardless of what the server says
  if (res.status >= 500) {
    return new ApiError(friendlyErrorForStatus(res.status), res.status);
  }

  return new ApiError(
    friendlyErrorForStatus(res.status, serverMessage),
    res.status,
  );
}

/**
 * Extract a user-friendly error message from any caught error.
 *
 * Works with:
 * - ApiError (our custom class)
 * - TypeError / network failures from fetch
 * - Standard Error objects
 * - Unknown values
 */
export function extractErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) {
    return err.message;
  }

  if (err instanceof TypeError) {
    // TypeError from fetch usually means network failure
    if (err.message === 'Failed to fetch' || err.message.includes('NetworkError')) {
      return 'Unable to connect to the server. Please check your internet connection and try again.';
    }
  }

  if (err instanceof DOMException && err.name === 'AbortError') {
    return ''; // Aborted requests should not show errors
  }

  if (err instanceof Error) {
    const lower = err.message.toLowerCase();
    // Replace any technical error messages that leaked through
    if (
      lower.includes('unexpected token') ||
      lower.includes('syntax error') ||
      lower.includes('cannot read properties') ||
      lower.includes('undefined is not')
    ) {
      return 'An unexpected error occurred. Please try again. If the problem persists, contact support.';
    }
    return err.message;
  }

  return fallback;
}
