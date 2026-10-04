-- A chapter can hold more than one upload. New ideas are added; old ones stay,
-- because practice sessions still point at the old concept ids.

ALTER TABLE concepts ADD COLUMN IF NOT EXISTS document_id TEXT REFERENCES documents (id) ON DELETE SET NULL;

-- Attach existing ideas to the chapter's one ready file, when it has exactly one.
UPDATE concepts c
SET document_id = d.id
FROM (
  SELECT section_id, min(id) AS id
  FROM documents
  WHERE status = 'ready'
  GROUP BY section_id
  HAVING count(*) = 1
) d
WHERE c.section_id = d.section_id
  AND c.document_id IS NULL;
