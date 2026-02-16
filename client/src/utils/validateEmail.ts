/**
 * Shared email format validation utility.
 * Uses a consistent regex across all forms:
 * registration, login, settings, waitlist, etc.
 *
 * The regex checks for:
 * - At least one non-whitespace, non-@ character before @
 * - An @ symbol
 * - At least one non-whitespace, non-@ character after @ (domain)
 * - A dot separator in the domain
 * - At least one non-whitespace, non-@ character after the dot (TLD)
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates an email address format.
 * @param email - The email string to validate
 * @returns true if the email format is valid, false otherwise
 */
export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

/**
 * Validates an email and returns an error message if invalid.
 * @param email - The email string to validate
 * @returns Error message string if invalid, null if valid
 */
export function validateEmail(email: string): string | null {
  if (!email || !email.trim()) {
    return 'Email address is required';
  }
  if (!isValidEmail(email)) {
    return 'Please enter a valid email address';
  }
  return null;
}
