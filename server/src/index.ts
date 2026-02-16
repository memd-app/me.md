import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { db } from './config/database.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { topicsRouter } from './routes/topics.js';
import { usersRouter } from './routes/users.js';
import { importRouter } from './routes/import.js';
import { sessionsRouter } from './routes/sessions.js';
import { searchRouter } from './routes/search.js';
import { notesRouter } from './routes/notes.js';
import { insightsRouter, checkReVerificationDue } from './routes/insights.js';
import { dashboardRouter } from './routes/dashboard.js';
import { graphRouter } from './routes/graph.js';
import { profileRouter } from './routes/profile.js';
import { mcpRouter } from './routes/mcp.js';
import { bookmarksRouter } from './routes/bookmarks.js';
import { conflictsRouter } from './routes/conflicts.js';
import { templatesRouter } from './routes/templates.js';
import { sandboxRouter } from './routes/sandbox.js';
import { authMiddleware, cleanupExpiredTokens } from './middleware/auth.js';
import { apiRateLimiter, authRateLimiter } from './middleware/rateLimit.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting - apply to all API routes
app.use('/api', apiRateLimiter);

// Stricter rate limiting for auth endpoints
app.use('/api/auth', authRateLimiter);

// Public routes (no auth required)
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);

// Protected routes (auth middleware validates Bearer token or x-user-id)
app.use('/api/topics', authMiddleware, topicsRouter);
app.use('/api/users', authMiddleware, usersRouter);
app.use('/api/import', authMiddleware, importRouter);
app.use('/api/sessions', authMiddleware, sessionsRouter);

app.use('/api/notes', authMiddleware, notesRouter);

// TODO: Add remaining routes as they are implemented
// app.use('/api/messages', messagesRouter);
app.use('/api/insights', authMiddleware, insightsRouter);
app.use('/api/graph', authMiddleware, graphRouter);
app.use('/api/profile', authMiddleware, profileRouter);
app.use('/api/sandbox', authMiddleware, sandboxRouter);
app.use('/api/search', authMiddleware, searchRouter);
app.use('/api/dashboard', authMiddleware, dashboardRouter);

// Bookmarks route (must be before /api catch-all notesRouter)
app.use('/api/bookmarks', authMiddleware, bookmarksRouter);

// Conflicts route
app.use('/api/conflicts', authMiddleware, conflictsRouter);

// Templates route (before catch-all notesRouter)
app.use('/api/templates', authMiddleware, templatesRouter);

// Distillation routes (mounted under /api AFTER all more specific routes to prevent /:id catch-all conflicts)
app.use('/api', authMiddleware, notesRouter);
app.use('/api/mcp', authMiddleware, mcpRouter);
// app.use('/api/export', exportRouter);

// Error handling middleware — always returns user-friendly messages, never raw stack traces
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({
    error: 'The server encountered an unexpected error. Please try again in a moment. If the problem persists, contact support.',
  });
});

app.listen(PORT, () => {
  console.log(`[me.md] Server running on http://localhost:${PORT}`);
  console.log(`[me.md] Database connected: ${db ? 'yes' : 'no'}`);
  console.log(`[me.md] Environment: ${process.env.NODE_ENV || 'development'}`);

  // Run re-verification check on startup
  try {
    const count = checkReVerificationDue();
    console.log(`[me.md] Re-verification check on startup: ${count} insight(s) due for re-verification`);
  } catch (err) {
    console.error('[me.md] Re-verification startup check failed:', err);
  }

  // Run re-verification check every 15 minutes
  setInterval(() => {
    try {
      checkReVerificationDue();
    } catch (err) {
      console.error('[me.md] Periodic re-verification check failed:', err);
    }
  }, 15 * 60 * 1000);

  // Clean up expired session tokens on startup and every hour
  try {
    cleanupExpiredTokens();
  } catch (err) {
    console.error('[me.md] Session token cleanup failed:', err);
  }
  setInterval(() => {
    try {
      cleanupExpiredTokens();
    } catch (err) {
      console.error('[me.md] Periodic session token cleanup failed:', err);
    }
  }, 60 * 60 * 1000);
});

export default app;
