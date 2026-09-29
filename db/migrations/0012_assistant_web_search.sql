-- Store web-search billing counts with token usage and citations with their assistant answers.
ALTER TABLE assistant_usage ADD COLUMN web_search_requests INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assistant_messages ADD COLUMN citations TEXT CHECK (citations IS NULL OR json_valid(citations));
