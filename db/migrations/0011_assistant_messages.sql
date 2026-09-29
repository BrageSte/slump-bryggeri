-- Shared assistant thread for each batch. Proposed actions stay inert until a brewer logs them.
CREATE TABLE assistant_messages (
  id TEXT PRIMARY KEY,
  brewery_id TEXT NOT NULL REFERENCES breweries (id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  actions TEXT CHECK (actions IS NULL OR json_valid(actions)),
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX assistant_messages_thread_idx
  ON assistant_messages (brewery_id, batch_id, created_at);
