-- Better Auth core tables (email OTP sign-in).
-- Generated from Better Auth 1.7 getMigrations() with plural table names and snake_case
-- columns; the mapping lives in worker/auth/auth.ts and must stay in sync with this file.

CREATE TABLE users (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL,
  image TEXT,
  created_at DATE NOT NULL,
  updated_at DATE NOT NULL
);

CREATE TABLE sessions (
  id TEXT NOT NULL PRIMARY KEY,
  expires_at DATE NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at DATE NOT NULL,
  updated_at DATE NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE accounts (
  id TEXT NOT NULL PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at DATE,
  refresh_token_expires_at DATE,
  scope TEXT,
  password TEXT,
  created_at DATE NOT NULL,
  updated_at DATE NOT NULL
);

CREATE TABLE verifications (
  id TEXT NOT NULL PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at DATE NOT NULL,
  created_at DATE NOT NULL,
  updated_at DATE NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX accounts_user_id_idx ON accounts (user_id);
CREATE INDEX verifications_identifier_idx ON verifications (identifier);
