-- Seed once: a later deployment or store reconstruction must preserve an owner's choice.
CREATE TABLE IF NOT EXISTS docs_ai_settings (
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
) STRICT;

INSERT INTO docs_ai_settings (id, enabled) VALUES (1, 1)
  ON CONFLICT (id) DO NOTHING;
