-- ============================================================
-- Projektleiter darf Leistungsberichte (LB / Werkstatt / LKW)
-- bearbeiten — analog zum Vorarbeiter.
--
-- Hintergrund: UI gibt dem Projektleiter den Edit-Button für
-- Leistungsberichte frei. Beim Save werden time_entries gelöscht
-- und neu angelegt. Diese Policies waren bisher in keiner Migration
-- versioniert (nur live in der DB). Idempotent re-applizierbar.
-- ============================================================

-- time_entries
DROP POLICY IF EXISTS "Projektleiter can view all time entries" ON public.time_entries;
DROP POLICY IF EXISTS "Projektleiter can insert time_entries" ON public.time_entries;
DROP POLICY IF EXISTS "Projektleiter can update time_entries" ON public.time_entries;
DROP POLICY IF EXISTS "Projektleiter can delete time_entries" ON public.time_entries;

CREATE POLICY "Projektleiter can view all time entries"
  ON public.time_entries FOR SELECT
  USING (public.has_role(auth.uid(), 'projektleiter'));

CREATE POLICY "Projektleiter can insert time_entries"
  ON public.time_entries FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'projektleiter'));

CREATE POLICY "Projektleiter can update time_entries"
  ON public.time_entries FOR UPDATE
  USING (public.has_role(auth.uid(), 'projektleiter'));

CREATE POLICY "Projektleiter can delete time_entries"
  ON public.time_entries FOR DELETE
  USING (public.has_role(auth.uid(), 'projektleiter'));

-- time_entry_workers (Vorfertigung-Blöcke etc.)
DROP POLICY IF EXISTS "Projektleiter can view all time entry workers" ON public.time_entry_workers;
DROP POLICY IF EXISTS "Projektleiter can insert time entry workers" ON public.time_entry_workers;
DROP POLICY IF EXISTS "Projektleiter can delete time entry workers" ON public.time_entry_workers;

CREATE POLICY "Projektleiter can view all time entry workers"
  ON public.time_entry_workers FOR SELECT
  USING (public.has_role(auth.uid(), 'projektleiter'));

CREATE POLICY "Projektleiter can insert time entry workers"
  ON public.time_entry_workers FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'projektleiter'));

CREATE POLICY "Projektleiter can delete time entry workers"
  ON public.time_entry_workers FOR DELETE
  USING (public.has_role(auth.uid(), 'projektleiter'));
