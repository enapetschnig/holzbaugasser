-- Projektleiter Time Tracking: erweitert time_entries um Block-Zeiten
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS start_zeit time,
  ADD COLUMN IF NOT EXISTS end_zeit time,
  ADD COLUMN IF NOT EXISTS pause_minuten integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS entry_typ varchar NOT NULL DEFAULT 'leistungsbericht';

-- Index for faster queries by entry type
CREATE INDEX IF NOT EXISTS idx_time_entries_entry_typ ON time_entries(entry_typ);
CREATE INDEX IF NOT EXISTS idx_time_entries_user_datum_typ ON time_entries(user_id, datum, entry_typ);

-- Comment to document the discriminator
COMMENT ON COLUMN time_entries.entry_typ IS 'Discriminator: leistungsbericht | projektleiter | absenz';
COMMENT ON COLUMN time_entries.start_zeit IS 'Block-Startzeit (nur bei entry_typ=projektleiter)';
COMMENT ON COLUMN time_entries.end_zeit IS 'Block-Endzeit (nur bei entry_typ=projektleiter)';
COMMENT ON COLUMN time_entries.pause_minuten IS 'Pause in Minuten (nur bei entry_typ=projektleiter)';
