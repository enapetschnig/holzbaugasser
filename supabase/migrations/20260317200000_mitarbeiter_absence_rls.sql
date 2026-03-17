-- Mitarbeiter dürfen eigene Abwesenheits-Einträge erstellen (Urlaub, Krankenstand, etc.)
CREATE POLICY "Mitarbeiter can insert own absence entries"
  ON public.time_entries FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND taetigkeit IN ('Urlaub', 'Krankenstand', 'Fortbildung', 'Feiertag', 'Schule', 'Weiterbildung')
  );

-- Mitarbeiter dürfen eigene Abwesenheiten löschen (z.B. Urlaub stornieren)
CREATE POLICY "Mitarbeiter can delete own absence entries"
  ON public.time_entries FOR DELETE
  USING (
    auth.uid() = user_id
    AND taetigkeit IN ('Urlaub', 'Krankenstand', 'Fortbildung', 'Feiertag', 'Schule', 'Weiterbildung')
  );

-- Mitarbeiter dürfen eigenes Urlaubskonto verwalten
CREATE POLICY "Users can upsert own leave balance"
  ON public.leave_balances FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own leave balance"
  ON public.leave_balances FOR UPDATE
  USING (auth.uid() = user_id);
