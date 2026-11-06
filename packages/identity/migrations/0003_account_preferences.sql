CREATE TABLE user_preferences (
  user_id TEXT NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT CHECK (display_name IS NULL OR (length(display_name) BETWEEN 1 AND 80)),
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  language TEXT NOT NULL DEFAULT 'system' CHECK (language IN ('system', 'en', 'es'))
) STRICT;
