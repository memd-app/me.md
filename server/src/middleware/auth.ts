import { Request, Response, NextFunction } from 'express';
import { db, sqlite } from '../config/database.js';
import { users } from '../models/schema.js';
import { eq } from 'drizzle-orm';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// Secret key for HMAC token signing. In production, use a persistent env var.
const TOKEN_SECRET = process.env.TOKEN_SECRET || randomBytes(32).toString('hex');

// Token expiration: 7 days in milliseconds
const TOKEN_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Generate a secure session token for a user.
 * Token format: <random>.<hmac_signature>
 * Stored in the session_tokens table with user_id and expiration.
 */
export function generateSessionToken(userId: string): { token: string; expiresAt: string } {
  const tokenPayload = randomBytes(32).toString('hex');
  const signature = createHmac('sha256', TOKEN_SECRET).update(tokenPayload).digest('hex');
  const token = `${tokenPayload}.${signature}`;

  const expiresAt = new Date(Date.now() + TOKEN_EXPIRATION_MS).toISOString();

  // Hash the token for storage (we never store raw tokens)
  const tokenHash = createHmac('sha256', TOKEN_SECRET).update(token).digest('hex');

  // Store token in the database
  sqlite.prepare(
    'INSERT INTO session_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
  ).run(randomBytes(16).toString('hex'), userId, tokenHash, expiresAt);

  return { token, expiresAt };
}

/**
 * Validate a token's HMAC signature.
 * Returns false if the token format is wrong or the HMAC doesn't match.
 */
function validateTokenSignature(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payload, providedSignature] = parts;
  if (!payload || !providedSignature) return false;

  const expectedSignature = createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');

  // Use timing-safe comparison
  try {
    const sigBuffer = Buffer.from(providedSignature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    if (sigBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Look up a session token in the database.
 * Returns the user_id if token is valid and not expired, null otherwise.
 */
function lookupToken(token: string): string | null {
  const tokenHash = createHmac('sha256', TOKEN_SECRET).update(token).digest('hex');

  const row = sqlite.prepare(
    'SELECT user_id, expires_at FROM session_tokens WHERE token_hash = ?'
  ).get(tokenHash) as { user_id: string; expires_at: string } | undefined;

  if (!row) return null;

  // Check expiration
  const now = new Date();
  const expiresAt = new Date(row.expires_at);
  if (now > expiresAt) {
    // Clean up expired token
    sqlite.prepare('DELETE FROM session_tokens WHERE token_hash = ?').run(tokenHash);
    return null;
  }

  return row.user_id;
}

/**
 * Revoke all session tokens for a user (e.g., on logout or account deletion).
 */
export function revokeUserTokens(userId: string): void {
  sqlite.prepare('DELETE FROM session_tokens WHERE user_id = ?').run(userId);
}

/**
 * Revoke a specific session token.
 */
export function revokeToken(token: string): void {
  const tokenHash = createHmac('sha256', TOKEN_SECRET).update(token).digest('hex');
  sqlite.prepare('DELETE FROM session_tokens WHERE token_hash = ?').run(tokenHash);
}

/**
 * Express middleware that authenticates requests using Bearer tokens.
 *
 * Checks the Authorization header for a Bearer token.
 * Falls back to x-user-id header for backward compatibility during transition.
 *
 * On success, sets req.userId (and keeps x-user-id header populated for route handlers).
 * On failure, returns 401.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Extract Bearer token from Authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    // Step 1: Validate HMAC signature (catches corrupted tokens)
    if (!validateTokenSignature(token)) {
      res.status(401).json({ error: 'Invalid authentication token' });
      return;
    }

    // Step 2: Look up token in database (catches expired/revoked/wrong-project tokens)
    const userId = lookupToken(token);
    if (!userId) {
      res.status(401).json({ error: 'Authentication token expired or invalid' });
      return;
    }

    // Step 3: Verify user still exists
    const user = db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    // Set user ID on request for route handlers
    (req as any).userId = userId;
    // Also set x-user-id header for backward compatibility with existing route handlers
    req.headers['x-user-id'] = userId;
    next();
    return;
  }

  // Fallback: check x-user-id header (backward compatibility)
  const headerUserId = req.headers['x-user-id'] as string || req.query.userId as string;
  if (headerUserId) {
    // Verify user exists
    const user = db.select({ id: users.id }).from(users).where(eq(users.id, headerUserId)).get();
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    (req as any).userId = headerUserId;
    req.headers['x-user-id'] = headerUserId;
    next();
    return;
  }

  res.status(401).json({ error: 'Not authenticated' });
}

/**
 * Clean up expired session tokens periodically.
 */
export function cleanupExpiredTokens(): void {
  const now = new Date().toISOString();
  const result = sqlite.prepare('DELETE FROM session_tokens WHERE expires_at < ?').run(now);
  if (result.changes > 0) {
    console.log(`[me.md:auth] Cleaned up ${result.changes} expired session token(s)`);
  }
}
