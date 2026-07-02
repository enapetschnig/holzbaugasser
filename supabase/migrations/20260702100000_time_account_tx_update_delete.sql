-- ============================================================
-- Zeitkonto-Transaktionen: fehlende UPDATE/DELETE-Policies + Unique-Schutz.
--
-- Hintergrund: time_account_transactions hatte nur SELECT- und INSERT-Policies.
-- Der Zeitkonto-Sync (syncOvertimeBalances) korrigiert Monats-Buchungen aber
-- idempotent per UPDATE (Nacherfassung, interne Korrekturen) und entfernt
-- stehengebliebene Buchungen per DELETE (laufender Monat, Monat vor Eintritt).
-- Ohne Policies waren diese Calls STILLE No-Ops (0 Zeilen, kein Fehler) —
-- Monats-Buchungen waren faktisch write-once und Korrekturen kamen nie an.
--
-- Zusätzlich: Unique-Index auf die automatischen "Überstunden {Monat}"-
-- Buchungen (eine pro Mitarbeiter+Monat), damit parallele Syncs (2 Admins/
-- 2 Tabs) keine Duplikate erzeugen können. Manuelle Buchungen (Gutschrift/
-- Abzug/ZA genommen) dürfen sich weiterhin beliebig wiederholen — daher
-- partieller Index nur auf die Auto-Buchungen.
-- ============================================================

CREATE POLICY "Admins can update transactions"
  ON public.time_account_transactions FOR UPDATE
  USING (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can delete transactions"
  ON public.time_account_transactions FOR DELETE
  USING (public.has_role(auth.uid(), 'administrator'));

CREATE UNIQUE INDEX IF NOT EXISTS uniq_time_account_tx_auto_monat
  ON public.time_account_transactions (user_id, change_type)
  WHERE change_type LIKE 'Überstunden %';

-- Mitarbeiter dürfen ihre EIGENE (leere) Zeitkonto-Zeile anlegen — Fallback im
-- ZA-Flow (Absence.tsx) für Alt-User, die vor dem Auto-Create-Trigger registriert
-- wurden. Ohne die Policy würde der ZA-Abzug bei fehlender Zeile fehlschlagen.
CREATE POLICY "Users can insert own time account"
  ON public.time_accounts FOR INSERT
  WITH CHECK (user_id = auth.uid());
