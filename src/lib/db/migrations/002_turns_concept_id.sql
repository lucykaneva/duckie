-- B7: remember which concept the duck's move was about.
-- schema.sql already includes this column for fresh databases; run this once
-- on a database created before B7:
--   npm run db:migrate -- src/lib/db/migrations/002_turns_concept_id.sql

ALTER TABLE turns ADD COLUMN IF NOT EXISTS concept_id TEXT REFERENCES concepts (id);
