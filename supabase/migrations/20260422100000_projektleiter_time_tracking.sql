-- Projektleiter Time Tracking: Discriminator-Spalte für time_entries
-- Bestehende Spalten start_time, end_time, pause_minutes, project_id werden wiederverwendet
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS entry_typ varchar NOT NULL DEFAULT 'leistungsbericht';

-- Index für schnelle Queries nach Eintragstyp
CREATE INDEX IF NOT EXISTS idx_time_entries_entry_typ ON time_entries(entry_typ);
CREATE INDEX IF NOT EXISTS idx_time_entries_user_datum_typ ON time_entries(user_id, datum, entry_typ);

COMMENT ON COLUMN time_entries.entry_typ IS 'Discriminator: leistungsbericht | projektleiter | absenz';
