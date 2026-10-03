-- Study Duck schema (Tiger Data / Postgres). Run on an empty database.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  name TEXT NOT NULL
);

CREATE TABLE sections (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses (id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('test', 'project'))
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES sections (id),
  filename TEXT NOT NULL,
  raw_text TEXT,
  page_count INTEGER,
  -- awaiting_pages (image pages still being transcribed), extracting, ready, error
  status TEXT NOT NULL DEFAULT 'awaiting_pages'
    CHECK (status IN ('awaiting_pages', 'extracting', 'ready', 'error')),
  error TEXT,
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per page. text is NULL while an image page waits for its transcription.
CREATE TABLE document_pages (
  document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('text', 'vision')),
  text TEXT,
  PRIMARY KEY (document_id, page)
);

CREATE TABLE concepts (
  id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES sections (id),
  topic TEXT NOT NULL,
  name TEXT NOT NULL,
  slide INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('explain', 'trace', 'predict')),
  misconceptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  check_prompt TEXT,
  fallback_questions JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE concept_secrets (
  concept_id TEXT PRIMARY KEY REFERENCES concepts (id),
  reference_code TEXT,
  expected_answer TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES sections (id),
  topic TEXT NOT NULL,
  confidence INTEGER CHECK (confidence BETWEEN 1 AND 5),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT
);

CREATE TABLE concept_state (
  session_id TEXT NOT NULL REFERENCES sessions (id),
  concept_id TEXT NOT NULL REFERENCES concepts (id),
  state TEXT NOT NULL CHECK (
    state IN (
      'not_yet',
      'owned',
      'assisted',
      'explained_to',
      'misconception',
      'skipped'
    )
  ),
  score REAL NOT NULL DEFAULT 0,
  level_reached TEXT,
  moves INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  skipped BOOLEAN NOT NULL DEFAULT FALSE,
  celebrated BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (session_id, concept_id)
);

CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  n INTEGER NOT NULL,
  text TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  score_after REAL,
  level TEXT,
  move_kind TEXT,
  line TEXT,
  -- The concept the duck's move was about. The next turn starts from it (B7).
  concept_id TEXT REFERENCES concepts (id),
  UNIQUE (session_id, n)
);

CREATE TABLE recall (
  user_id TEXT NOT NULL REFERENCES users (id),
  concept_id TEXT NOT NULL REFERENCES concepts (id),
  state_after TEXT NOT NULL,
  interval_days INTEGER NOT NULL,
  due_date DATE NOT NULL,
  successes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, concept_id)
);

CREATE TABLE learner_profile (
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

INSERT INTO users (id, name) VALUES ('u_demo', 'Demo student');
