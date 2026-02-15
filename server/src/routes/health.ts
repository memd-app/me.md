import { Router } from 'express';
import { sqlite } from '../config/database.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  try {
    // Test database connection by running a simple query
    const result = sqlite.prepare('SELECT 1 as ok').get() as { ok: number } | undefined;
    const dbConnected = result?.ok === 1;

    // Get list of tables
    const tables = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as Array<{ name: string }>;

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: {
        connected: dbConnected,
        tables: tables.map(t => t.name),
        tableCount: tables.length,
      },
      version: '0.1.0',
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      database: {
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
});
