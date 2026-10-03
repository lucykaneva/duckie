-- B11: the decision log records how each line was produced (judge ok or fell back, wording source, leak blocks).
-- schema.sql already includes this for fresh databases. Run once on an older one:
--   npm run db:migrate -- src/lib/db/migrations/005_turn_meta.sql

ALTER TABLE turns ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
