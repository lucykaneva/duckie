-- B8: upload status and per-page text.
-- schema.sql already includes this for fresh databases. Run once on an older one:
--   npm run db:migrate -- src/lib/db/migrations/003_documents_extraction.sql

ALTER TABLE documents ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'awaiting_pages'
  CHECK (status IN ('awaiting_pages', 'extracting', 'ready', 'error'));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE documents ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS document_pages (
  document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('text', 'vision')),
  text TEXT,
  PRIMARY KEY (document_id, page)
);
