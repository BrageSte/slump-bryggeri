ALTER TABLE measurements ADD COLUMN entered_value REAL;
ALTER TABLE measurements ADD COLUMN entered_unit TEXT;

UPDATE measurements
SET entered_value = value,
    entered_unit = unit;
