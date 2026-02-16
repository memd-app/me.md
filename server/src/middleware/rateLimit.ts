import rateLimit from 'express-rate-limit';

/**
 * General API rate limiter.
 * Limits each IP to 100 requests per 15-minute window.
 * Returns 429 Too Many Requests with retry information when exceeded.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: 'draft-7', // Return rate limit info in `RateLimit-*` headers (draft-7 standard)
  legacyHeaders: true, // Also send `X-RateLimit-*` headers for backward compatibility
  message: {
    error: 'Too many requests',
    message: 'You have exceeded the rate limit. Please try again later.',
    retryAfterUnit: 'seconds',
  },
  statusCode: 429,
  // Uses default keyGenerator which properly handles IPv4 and IPv6 via req.ip
});

/**
 * Stricter rate limiter for auth endpoints (login, register, password reset).
 * Limits each IP to 20 requests per 15-minute window.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: 20, // Limit each IP to 20 auth requests per window
  standardHeaders: 'draft-7',
  legacyHeaders: true,
  message: {
    error: 'Too many requests',
    message: 'Too many authentication attempts. Please try again later.',
    retryAfterUnit: 'seconds',
  },
  statusCode: 429,
  // Uses default keyGenerator which properly handles IPv4 and IPv6 via req.ip
});
