import type { Config } from 'drizzle-kit';

export default {
  schema: './src/models/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL || './data/memd.db',
  },
} satisfies Config;
