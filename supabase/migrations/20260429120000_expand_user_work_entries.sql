-- Mitarbeiter (und alle anderen Rollen) dürfen ihre EIGENEN time_entries
-- für Leistungsbericht / Vorfertigung / Projektleiter selber verwalten.
-- Vorher war das auf 'vorfertigung'/'projektleiter' beschränkt — jetzt
-- darf der Mitarbeiter auch seinen eigenen Leistungsbericht schreiben.

DROP POLICY IF EXISTS "Users can insert own vorfertigung or pl entries" ON public.time_entries;
DROP POLICY IF EXISTS "Users can update own vorfertigung or pl entries" ON public.time_entries;
DROP POLICY IF EXISTS "Users can delete own vorfertigung or pl entries" ON public.time_entries;

CREATE POLICY "Users can insert own work time entries"
  ON public.time_entries FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND entry_typ IN ('leistungsbericht', 'vorfertigung', 'projektleiter')
  );

CREATE POLICY "Users can update own work time entries"
  ON public.time_entries FOR UPDATE
  USING (
    auth.uid() = user_id
    AND entry_typ IN ('leistungsbericht', 'vorfertigung', 'projektleiter')
  )
  WITH CHECK (
    auth.uid() = user_id
    AND entry_typ IN ('leistungsbericht', 'vorfertigung', 'projektleiter')
  );

CREATE POLICY "Users can delete own work time entries"
  ON public.time_entries FOR DELETE
  USING (
    auth.uid() = user_id
    AND entry_typ IN ('leistungsbericht', 'vorfertigung', 'projektleiter')
  );
