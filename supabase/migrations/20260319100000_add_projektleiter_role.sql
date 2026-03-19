-- Neue Rolle: Projektleiter
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'projektleiter';

-- Projektleiter kann alle time_entries sehen
CREATE POLICY "Projektleiter can view all time entries"
  ON public.time_entries FOR SELECT
  USING (has_role(auth.uid(), 'projektleiter'::app_role));

-- Projektleiter kann Projekte verwalten
CREATE POLICY "Projektleiter can manage projects"
  ON public.projects FOR ALL
  USING (has_role(auth.uid(), 'projektleiter'::app_role))
  WITH CHECK (has_role(auth.uid(), 'projektleiter'::app_role));
