-- Token usage of the brewing assistant per brewery and day (UTC), for the daily request cap
-- and the cost shown in the app. Counts only; questions and answers are not stored.
CREATE TABLE assistant_usage (
  brewery_id TEXT NOT NULL REFERENCES breweries (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  model TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (brewery_id, day, model)
);
