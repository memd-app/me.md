import type { Config } from 'drizzle-kit';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  schema: path.join(__dirname, 'src', 'models', 'schema.ts'),
  out: path.join(__dirname, 'drizzle'),
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL || path.join(__dirname, 'data', 'memd.db'),
  },
} satisfies Config;
