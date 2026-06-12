-- ============================================================
-- time_entries werden mit ihrem Leistungsbericht verknüpft.
--
-- Hintergrund: bisher gab es KEINE Verknüpfung — alle Cleanup-Pfade
-- mussten über (user_id, datum, project_id, entry_typ) raten, welche
-- time_entries zu welchem Bericht gehören. Das führte zu gegenseitigem
-- Löschen bei Mehrfach-Berichten und verwaisten Einträgen beim
-- Bericht-Löschen (~34 inkonsistente User-Tage seit Mai 2026).
--
-- Rein additiv: bestehende Zeilen bleiben unverändert (bericht_id=NULL),
-- nur neue Speicherungen setzen die Verknüpfung. ON DELETE CASCADE räumt
-- time_entries automatisch auf, wenn der Bericht gelöscht wird.
-- ============================================================

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS bericht_id uuid REFERENCES public.leistungsberichte(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_time_entries_bericht_id ON public.time_entries(bericht_id);

COMMENT ON COLUMN public.time_entries.bericht_id IS
  'Verknüpfung zum Leistungsbericht (LB/Werk/LKW), der diesen Eintrag erzeugt hat. NULL = Alt-Eintrag vor Einführung oder bericht-loser Eintrag (Absenz, PL-Block, Vorfertigung).';
