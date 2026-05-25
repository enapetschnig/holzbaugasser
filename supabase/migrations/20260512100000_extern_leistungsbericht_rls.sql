-- ============================================================
-- Extern darf jetzt Mitarbeiter zu Leistungsberichten hinzufügen.
-- Vorher: extern konnte nur eigene time_entries verwalten (user_id = auth.uid()).
-- Jetzt: extern darf time_entries für beliebige user_ids verwalten,
--        aber NUR für entry_typ='leistungsbericht' (Standard-LB).
-- Werkstatt/LKW/Projektleiter-Zeiterfassung bleiben für extern gesperrt
-- (Page-Gates in MatrixBerichtForm + ProjektleiterTimeTracking).
--
-- Idempotent re-applizierbar.
-- ============================================================

DROP POLICY IF EXISTS "Extern can insert own time_entries" ON public.time_entries;
DROP POLICY IF EXISTS "Extern can update own time_entries" ON public.time_entries;
DROP POLICY IF EXISTS "Extern can delete own time_entries" ON public.time_entries;
DROP POLICY IF EXISTS "Extern can insert time_entries" ON public.time_entries;
DROP POLICY IF EXISTS "Extern can update time_entries" ON public.time_entries;
DROP POLICY IF EXISTS "Extern can delete time_entries" ON public.time_entries;
DROP POLICY IF EXISTS "Extern can view all time_entries" ON public.time_entries;

CREATE POLICY "Extern can view all time_entries"
  ON public.time_entries FOR SELECT
  USING (public.has_role(auth.uid(), 'extern'));

CREATE POLICY "Extern can insert time_entries"
  ON public.time_entries FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'extern')
    AND entry_typ = 'leistungsbericht'
  );

CREATE POLICY "Extern can update time_entries"
  ON public.time_entries FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'extern')
    AND entry_typ = 'leistungsbericht'
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'extern')
    AND entry_typ = 'leistungsbericht'
  );

CREATE POLICY "Extern can delete time_entries"
  ON public.time_entries FOR DELETE
  USING (
    public.has_role(auth.uid(), 'extern')
    AND entry_typ = 'leistungsbericht'
  );
