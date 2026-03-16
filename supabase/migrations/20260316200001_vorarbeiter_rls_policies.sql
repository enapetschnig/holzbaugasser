-- ============================================================
-- 3-Rollen-System: RLS Policies für Vorarbeiter
-- ============================================================

-- 1. Time Entries: Mitarbeiter darf KEINE eigenen mehr erstellen
DROP POLICY IF EXISTS "Users can insert own time entries" ON public.time_entries;
DROP POLICY IF EXISTS "Users can update own time entries" ON public.time_entries;
DROP POLICY IF EXISTS "Users can delete own time entries" ON public.time_entries;

-- Alte Admin-spezifische Policies entfernen (werden durch neue Admin+Vorarbeiter ersetzt)
DROP POLICY IF EXISTS "Admins can insert time entries" ON public.time_entries;
DROP POLICY IF EXISTS "Admins can update all time entries" ON public.time_entries;
DROP POLICY IF EXISTS "Admins can delete all time entries" ON public.time_entries;

-- Neue Policies: Nur Admin + Vorarbeiter dürfen Time Entries verwalten
CREATE POLICY "Admin or Vorarbeiter can insert time entries"
  ON public.time_entries FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'administrator')
    OR public.has_role(auth.uid(), 'vorarbeiter')
  );

CREATE POLICY "Admin or Vorarbeiter can update time entries"
  ON public.time_entries FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'administrator')
    OR public.has_role(auth.uid(), 'vorarbeiter')
  );

CREATE POLICY "Admin or Vorarbeiter can delete time entries"
  ON public.time_entries FOR DELETE
  USING (
    public.has_role(auth.uid(), 'administrator')
    OR public.has_role(auth.uid(), 'vorarbeiter')
  );

-- Vorarbeiter kann alle Time Entries sehen
CREATE POLICY "Vorarbeiter can view all time entries"
  ON public.time_entries FOR SELECT
  USING (public.has_role(auth.uid(), 'vorarbeiter'));

-- 2. Projects: Nur Admin + Vorarbeiter dürfen erstellen
DROP POLICY IF EXISTS "Authenticated users can insert projects" ON public.projects;

CREATE POLICY "Admin or Vorarbeiter can insert projects"
  ON public.projects FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'administrator')
    OR public.has_role(auth.uid(), 'vorarbeiter')
  );

-- 3. Disturbances: Nur Admin
DROP POLICY IF EXISTS "Users can insert own disturbances" ON public.disturbances;
DROP POLICY IF EXISTS "Users can update own disturbances" ON public.disturbances;
DROP POLICY IF EXISTS "Users can delete own disturbances" ON public.disturbances;

CREATE POLICY "Only admins can insert disturbances"
  ON public.disturbances FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Only admins can update disturbances"
  ON public.disturbances FOR UPDATE
  USING (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Only admins can delete disturbances"
  ON public.disturbances FOR DELETE
  USING (public.has_role(auth.uid(), 'administrator'));

-- Disturbance Materials: Nur Admin
DROP POLICY IF EXISTS "Users can insert own disturbance materials" ON public.disturbance_materials;
DROP POLICY IF EXISTS "Users can update own disturbance materials" ON public.disturbance_materials;
DROP POLICY IF EXISTS "Users can delete own disturbance materials" ON public.disturbance_materials;

CREATE POLICY "Only admins can insert disturbance materials"
  ON public.disturbance_materials FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Only admins can update disturbance materials"
  ON public.disturbance_materials FOR UPDATE
  USING (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Only admins can delete disturbance materials"
  ON public.disturbance_materials FOR DELETE
  USING (public.has_role(auth.uid(), 'administrator'));

-- Disturbance Workers: Nur Admin
DROP POLICY IF EXISTS "Users can insert disturbance workers for own disturbances" ON public.disturbance_workers;
DROP POLICY IF EXISTS "Users can update disturbance workers for own disturbances" ON public.disturbance_workers;
DROP POLICY IF EXISTS "Users can delete disturbance workers for own disturbances" ON public.disturbance_workers;

CREATE POLICY "Only admins can insert disturbance workers"
  ON public.disturbance_workers FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Only admins can update disturbance workers"
  ON public.disturbance_workers FOR UPDATE
  USING (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Only admins can delete disturbance workers"
  ON public.disturbance_workers FOR DELETE
  USING (public.has_role(auth.uid(), 'administrator'));

-- Disturbance Photos: Nur Admin
DROP POLICY IF EXISTS "Users can insert own disturbance photos" ON public.disturbance_photos;
DROP POLICY IF EXISTS "Users can delete own disturbance photos" ON public.disturbance_photos;

CREATE POLICY "Only admins can insert disturbance photos"
  ON public.disturbance_photos FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Only admins can delete disturbance photos"
  ON public.disturbance_photos FOR DELETE
  USING (public.has_role(auth.uid(), 'administrator'));

-- 4. Week Settings: Vorarbeiter kann auch alle sehen/verwalten
CREATE POLICY "Vorarbeiter can view all week settings"
  ON public.week_settings FOR SELECT
  USING (public.has_role(auth.uid(), 'vorarbeiter'));

CREATE POLICY "Vorarbeiter can insert week settings"
  ON public.week_settings FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'vorarbeiter'));

CREATE POLICY "Vorarbeiter can update week settings"
  ON public.week_settings FOR UPDATE
  USING (public.has_role(auth.uid(), 'vorarbeiter'));

-- 5. Time Entry Workers: Vorarbeiter darf auch verwalten
CREATE POLICY "Vorarbeiter can view all time entry workers"
  ON public.time_entry_workers FOR SELECT
  USING (public.has_role(auth.uid(), 'vorarbeiter'));

CREATE POLICY "Vorarbeiter can insert time entry workers"
  ON public.time_entry_workers FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'vorarbeiter'));

CREATE POLICY "Vorarbeiter can delete time entry workers"
  ON public.time_entry_workers FOR DELETE
  USING (public.has_role(auth.uid(), 'vorarbeiter'));
