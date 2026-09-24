ALTER TABLE measurements ADD COLUMN entered_value REAL;
ALTER TABLE measurements ADD COLUMN entered_unit TEXT;

UPDATE measurements
SET entered_value = value,
    entered_unit = unit;

ALTER TABLE breweries ADD COLUMN unit_preference TEXT NOT NULL DEFAULT 'metric'
  CHECK (unit_preference IN ('metric', 'us_volume', 'mixed'));
