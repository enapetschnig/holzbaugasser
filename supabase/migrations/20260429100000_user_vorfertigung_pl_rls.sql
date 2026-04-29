-- ============================================================
-- Mitarbeiter / Vorarbeiter / Projektleiter / Admin dürfen ihre
-- EIGENEN time_entries vom Typ 'vorfertigung' oder 'projektleiter'
-- selber verwalten (insert/update/delete).
--
-- Hintergrund: Für die Block-Zeiterfassung Vorfertigung/LKW und die
-- Projektleiter-Zeiterfassung tragen die User selbst ihre Stunden ein.
-- Bisher konnten nur Admin/Vorarbeiter eigene/fremde Einträge anlegen
-- (Leistungsbericht-Workflow), Mitarbeiter nur Absenzen.
-- ============================================================

CREATE POLICY "Users can insert own vorfertigung or pl entries"
  ON public.time_entries FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND entry_typ IN ('vorfertigung', 'projektleiter')
  );

CREATE POLICY "Users can update own vorfertigung or pl entries"
  ON public.time_entries FOR UPDATE
  USING (
    auth.uid() = user_id
    AND entry_typ IN ('vorfertigung', 'projektleiter')
  )
  WITH CHECK (
    auth.uid() = user_id
    AND entry_typ IN ('vorfertigung', 'projektleiter')
  );

CREATE POLICY "Users can delete own vorfertigung or pl entries"
  ON public.time_entries FOR DELETE
  USING (
    auth.uid() = user_id
    AND entry_typ IN ('vorfertigung', 'projektleiter')
  );
