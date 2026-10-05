-- The assistant also has one shared thread for the whole brewery (recipes, equipment, history), so a
-- message no longer has to belong to a batch: batch_id becomes optional and NULL marks the brewery thread.
-- SQLite cannot drop NOT NULL in place, so the table is rebuilt. Nothing references assistant_messages.
CREATE TABLE assistant_messages_new (
  id TEXT PRIMARY KEY,
  brewery_id TEXT NOT NULL REFERENCES breweries (id) ON DELETE CASCADE,
  batch_id TEXT REFERENCES batches (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  actions TEXT CHECK (actions IS NULL OR json_valid(actions)),
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  citations TEXT CHECK (citations IS NULL OR json_valid(citations))
);

INSERT INTO assistant_messages_new (id, brewery_id, batch_id, role, content, actions, created_by, created_at, citations)
SELECT id, brewery_id, batch_id, role, content, actions, created_by, created_at, citations
FROM assistant_messages;

DROP TABLE assistant_messages;
ALTER TABLE assistant_messages_new RENAME TO assistant_messages;

CREATE INDEX assistant_messages_thread_idx
  ON assistant_messages (brewery_id, batch_id, created_at);
