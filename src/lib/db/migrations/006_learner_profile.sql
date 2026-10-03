-- B13: learner profile (already in schema.sql for fresh databases).
--   npm run db:migrate -- src/lib/db/migrations/006_learner_profile.sql

CREATE TABLE IF NOT EXISTS learner_profile (
  user_id TEXT PRIMARY KEY REFERENCES users (id),
  calibration TEXT,
  pace TEXT,
  nagginess TEXT,
  teaching_habits JSONB NOT NULL DEFAULT '[]'::jsonb,
  tone TEXT,
  config_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  duck_learned JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
