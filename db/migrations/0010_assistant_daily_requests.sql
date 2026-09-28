-- Atomically reserve one assistant request per brewery and UTC day before calling Anthropic.
CREATE TABLE assistant_daily_requests (
  brewery_id TEXT NOT NULL REFERENCES breweries (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (brewery_id, day)
);
