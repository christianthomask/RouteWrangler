import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://routewrangler:routewrangler@localhost:5432/routewrangler',
  },
  strict: true,
  verbose: true,
});
