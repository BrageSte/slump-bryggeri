-- Breweries (workspaces), membership, invites, equipment and versioned equipment profiles.
-- All timestamps are unix epoch milliseconds.

CREATE TABLE breweries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE brewery_members (
  brewery_id TEXT NOT NULL REFERENCES breweries (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (brewery_id, user_id)
);
CREATE INDEX brewery_members_user_idx ON brewery_members (user_id);

CREATE TABLE brewery_invites (
  id TEXT PRIMARY KEY,
  brewery_id TEXT NOT NULL REFERENCES breweries (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  invited_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  accepted_by TEXT REFERENCES users (id),
  revoked_at INTEGER
);
CREATE INDEX brewery_invites_email_idx ON brewery_invites (email);
CREATE UNIQUE INDEX brewery_invites_open_uniq ON brewery_invites (brewery_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Physical components (mash tun, kettle, fermenters, pump, chiller ...).
CREATE TABLE equipment (
  id TEXT PRIMARY KEY,
  brewery_id TEXT NOT NULL REFERENCES breweries (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  capacity_l REAL,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX equipment_brewery_idx ON equipment (brewery_id);

-- A complete, versioned calibration profile. Editing creates a new version;
-- exactly one version per brewery is active.
CREATE TABLE equipment_profiles (
  id TEXT PRIMARY KEY,
  brewery_id TEXT NOT NULL REFERENCES breweries (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  change_note TEXT,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  UNIQUE (brewery_id, version)
);
CREATE UNIQUE INDEX equipment_profiles_one_active ON equipment_profiles (brewery_id) WHERE is_active = 1;

CREATE TABLE equipment_profile_values (
  profile_id TEXT NOT NULL REFERENCES equipment_profiles (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'calibration', 'default')),
  note TEXT,
  PRIMARY KEY (profile_id, key)
);

-- Profile versions are immutable once written: only the active flag may change.
CREATE TRIGGER equipment_profile_values_immutable
BEFORE UPDATE ON equipment_profile_values
BEGIN
  SELECT RAISE(ABORT, 'equipment profile values are immutable; create a new profile version');
END;

CREATE TRIGGER equipment_profiles_immutable
BEFORE UPDATE OF brewery_id, version, name, change_note, created_by, created_at ON equipment_profiles
BEGIN
  SELECT RAISE(ABORT, 'equipment profiles are immutable; create a new profile version');
END;
