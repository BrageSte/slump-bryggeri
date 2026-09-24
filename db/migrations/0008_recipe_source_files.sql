-- Imported recipe files (BeerSmith .bsmx) are kept as the recipe's source: the unchanged file in
-- original_text, its file name, and what the importer read from it besides the recipe (JSON: the
-- BeerSmith equipment snapshot, water plan, warnings and the measured fields it left out).
ALTER TABLE recipe_sources ADD COLUMN filename TEXT;
ALTER TABLE recipe_sources ADD COLUMN data TEXT;

-- A source records what the recipe originally looked like; it is never overwritten.
CREATE TRIGGER recipe_sources_immutable
BEFORE UPDATE ON recipe_sources
BEGIN
  SELECT RAISE(ABORT, 'recipe sources are immutable');
END;
