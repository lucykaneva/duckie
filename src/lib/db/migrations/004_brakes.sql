-- B9: session-level engine state, the turn log's row source, and planted-misconception concepts.
-- schema.sql already includes this for fresh databases. Run once on an older one:
--   npm run db:migrate -- src/lib/db/migrations/004_brakes.sql

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS engine JSONB;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'student'
  CHECK (source IN ('student', 'silence', 'steer'));
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS plants_misconception BOOLEAN NOT NULL DEFAULT false;
