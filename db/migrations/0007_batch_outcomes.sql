-- Actual results per batch, or per fermentation variant (batch split), recorded when the beer is packaged.
-- Every value is the brewery's own: NULL means "ikke målt", never a recipe target.
CREATE TABLE batch_outcomes (
  id TEXT PRIMARY KEY,
  brewery_id TEXT NOT NULL REFERENCES breweries (id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  split_id TEXT REFERENCES batch_splits (id),
  og REAL,
  og_source TEXT CHECK (og_source IN ('sg', 'brix', 'manual')),
  fg REAL,
  fg_source TEXT CHECK (fg_source IN ('sg', 'brix', 'manual')),
  packaged_volume_l REAL,
  packaged_on TEXT,
  packaging TEXT CHECK (packaging IN ('cans', 'keg', 'bottles', 'other')),
  carbonation_vols REAL,
  tasting_notes TEXT,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  next_time TEXT,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users (id),
  updated_at INTEGER NOT NULL
);

-- One result per variant; the whole batch (split_id NULL) counts as its own variant.
CREATE UNIQUE INDEX batch_outcomes_variant_idx ON batch_outcomes (batch_id, IFNULL(split_id, ''));
