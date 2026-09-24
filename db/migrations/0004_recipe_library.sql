-- Recipe library: public reference recipes shared by all breweries (read-only for users).
-- Loaded from db/seeds/recipe-library.sql; copying a recipe into a brewery creates a normal
-- recipe whose recipe_sources row keeps the original source data.

CREATE TABLE recipe_library (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  source_url TEXT,
  name TEXT NOT NULL,
  tagline TEXT,
  category TEXT NOT NULL,
  abv REAL,
  ibu REAL,
  og REAL,
  fg REAL,
  ebc REAL,
  batch_size_l REAL NOT NULL,
  search_text TEXT NOT NULL,
  data TEXT NOT NULL,
  source_data TEXT NOT NULL,
  warnings TEXT NOT NULL DEFAULT '[]',
  imported_at INTEGER NOT NULL
);
CREATE INDEX recipe_library_category_idx ON recipe_library (category, name);
