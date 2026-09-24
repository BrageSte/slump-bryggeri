-- Recipes (versioned, immutable documents), batches with frozen snapshots, and the brew log.

CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  brewery_id TEXT NOT NULL REFERENCES breweries (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  style TEXT,
  current_version_id TEXT,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX recipes_brewery_idx ON recipes (brewery_id, updated_at);

-- What the recipe originally looked like (book, web page, BeerXML ...). Never overwritten.
CREATE TABLE recipe_sources (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  original_text TEXT,
  url TEXT,
  attachment_id TEXT,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL
);

-- Normalized recipe document (JSON, see src/domain/model/recipe.ts). Every save is a new version.
-- kind = 'adaptation' marks a version calculated for this brewery's equipment profile.
CREATE TABLE recipe_versions (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('normalized', 'adaptation')),
  parent_version_id TEXT REFERENCES recipe_versions (id),
  source_id TEXT REFERENCES recipe_sources (id),
  equipment_profile_id TEXT REFERENCES equipment_profiles (id),
  data TEXT NOT NULL,
  change_note TEXT,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  UNIQUE (recipe_id, version)
);

CREATE TRIGGER recipe_versions_immutable
BEFORE UPDATE ON recipe_versions
BEGIN
  SELECT RAISE(ABORT, 'recipe versions are immutable; create a new version');
END;

CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  brewery_id TEXT NOT NULL REFERENCES breweries (id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  name TEXT NOT NULL,
  recipe_id TEXT NOT NULL REFERENCES recipes (id),
  recipe_version_id TEXT NOT NULL REFERENCES recipe_versions (id),
  status TEXT NOT NULL CHECK (status IN ('planned', 'brewing', 'fermenting', 'conditioning', 'completed')),
  current_stage TEXT,
  stage_started_at INTEGER,
  brew_date TEXT,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  deleted_at INTEGER,
  UNIQUE (brewery_id, number)
);
CREATE INDEX batches_brewery_status_idx ON batches (brewery_id, status);

-- Frozen copies taken when the batch is created. Later recipe or calibration changes
-- never alter the history of an existing batch.
CREATE TABLE batch_recipe_snapshots (
  batch_id TEXT PRIMARY KEY REFERENCES batches (id) ON DELETE CASCADE,
  recipe_version_id TEXT NOT NULL REFERENCES recipe_versions (id),
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE batch_equipment_snapshots (
  batch_id TEXT PRIMARY KEY REFERENCES batches (id) ON DELETE CASCADE,
  equipment_profile_id TEXT REFERENCES equipment_profiles (id),
  profile_version INTEGER,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TRIGGER batch_recipe_snapshots_immutable
BEFORE UPDATE ON batch_recipe_snapshots
BEGIN
  SELECT RAISE(ABORT, 'batch recipe snapshots are immutable');
END;

CREATE TRIGGER batch_equipment_snapshots_immutable
BEFORE UPDATE ON batch_equipment_snapshots
BEGIN
  SELECT RAISE(ABORT, 'batch equipment snapshots are immutable');
END;

-- A batch can be split into several fermentation variants (e.g. Sunset Tropical / Sunset Pine).
CREATE TABLE batch_splits (
  id TEXT PRIMARY KEY,
  brewery_id TEXT NOT NULL REFERENCES breweries (id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  vessel TEXT,
  equipment_id TEXT REFERENCES equipment (id),
  volume_l REAL,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX batch_splits_batch_idx ON batch_splits (batch_id);

-- The brew log. `type` is an open vocabulary (mash_started, ingredient_added, comment, custom ...)
-- so new brewing steps never require a schema change. Typed details live in child tables.
CREATE TABLE brew_events (
  id TEXT PRIMARY KEY,
  brewery_id TEXT NOT NULL REFERENCES breweries (id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  split_id TEXT REFERENCES batch_splits (id),
  type TEXT NOT NULL,
  stage TEXT,
  occurred_at INTEGER NOT NULL,
  data TEXT,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX brew_events_batch_time_idx ON brew_events (batch_id, occurred_at, created_at);

CREATE TABLE measurements (
  id TEXT PRIMARY KEY,
  brewery_id TEXT NOT NULL REFERENCES breweries (id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  split_id TEXT REFERENCES batch_splits (id),
  event_id TEXT NOT NULL UNIQUE REFERENCES brew_events (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  stage TEXT,
  measured_at INTEGER NOT NULL,
  sample_temp_c REAL,
  instrument TEXT,
  comment TEXT,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX measurements_batch_kind_idx ON measurements (batch_id, kind, measured_at);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  brewery_id TEXT NOT NULL REFERENCES breweries (id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  event_id TEXT NOT NULL UNIQUE REFERENCES brew_events (id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted_at INTEGER
);

-- Files stored in R2. Every object is tied to a brewery (and usually a batch).
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  brewery_id TEXT NOT NULL REFERENCES breweries (id) ON DELETE CASCADE,
  batch_id TEXT REFERENCES batches (id) ON DELETE CASCADE,
  recipe_id TEXT REFERENCES recipes (id) ON DELETE CASCADE,
  event_id TEXT REFERENCES brew_events (id) ON DELETE SET NULL,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  caption TEXT,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX attachments_batch_idx ON attachments (batch_id);
