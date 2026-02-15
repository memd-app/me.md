import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { db } from './config/database.js';
import { healthRouter } from './routes/health.js';

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

// Routes
app.use('/api/health', healthRouter);

// TODO: Add remaining routes as they are implemented
// app.use('/api/auth', authRouter);
// app.use('/api/users', usersRouter);
// app.use('/api/topics', topicsRouter);
// app.use('/api/sessions', sessionsRouter);
// app.use('/api/messages', messagesRouter);
// app.use('/api/notes', notesRouter);
// app.use('/api/insights', insightsRouter);
// app.use('/api/graph', graphRouter);
// app.use('/api/profile', profileRouter);
// app.use('/api/sandbox', sandboxRouter);
// app.use('/api/search', searchRouter);
// app.use('/api/dashboard', dashboardRouter);
// app.use('/api/bookmarks', bookmarksRouter);
// app.use('/api/mcp', mcpRouter);
// app.use('/api/templates', templatesRouter);
// app.use('/api/import', importRouter);
// app.use('/api/export', exportRouter);

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`[me.md] Server running on http://localhost:${PORT}`);
  console.log(`[me.md] Database connected: ${db ? 'yes' : 'no'}`);
  console.log(`[me.md] Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
