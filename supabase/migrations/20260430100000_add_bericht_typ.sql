-- ============================================================
-- Werk- und LKW-Berichte (Matrix-basiert) als neue Bericht-Typen
-- ============================================================
-- Erlaubt zwei zusätzliche bericht_typ-Werte: 'werk' und 'lkw'.
-- Standard-Leistungsbericht behält bericht_typ='leistungsbericht'.
-- Werk/LKW-Berichte haben kein Header-Projekt (projekt_id NULL),
-- aber jede Zeile (leistungsbericht_taetigkeiten) verweist auf ein
-- Projekt via neuer projekt_id-Spalte.

-- 1. Discriminator-Spalte auf leistungsberichte
ALTER TABLE public.leistungsberichte
  ADD COLUMN IF NOT EXISTS bericht_typ varchar NOT NULL DEFAULT 'leistungsbericht';

CREATE INDEX IF NOT EXISTS idx_lb_bericht_typ ON public.leistungsberichte(bericht_typ);

-- 2. Unique-Constraint anpassen: bericht_typ einbeziehen
-- NULLS NOT DISTINCT, damit Werk/LKW (mit projekt_id=NULL) nur einmal pro
-- (User, Typ, Datum) existieren kann — Multi-Projekt geschieht innerhalb des Berichts.
ALTER TABLE public.leistungsberichte
  DROP CONSTRAINT IF EXISTS leistungsberichte_erstellt_von_projekt_id_datum_key;

ALTER TABLE public.leistungsberichte
  ADD CONSTRAINT leistungsberichte_user_typ_projekt_datum_key
  UNIQUE NULLS NOT DISTINCT (erstellt_von, bericht_typ, projekt_id, datum);

-- 3. projekt_id auf leistungsbericht_taetigkeiten — für Werk/LKW-Zeilen
ALTER TABLE public.leistungsbericht_taetigkeiten
  ADD COLUMN IF NOT EXISTS projekt_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lb_taetigkeiten_projekt_id
  ON public.leistungsbericht_taetigkeiten(projekt_id);

-- 4. RLS für time_entries: 'werk' und 'lkw' zu den User-Work-Policies hinzufügen
DROP POLICY IF EXISTS "Users can insert own work time entries" ON public.time_entries;
DROP POLICY IF EXISTS "Users can update own work time entries" ON public.time_entries;
DROP POLICY IF EXISTS "Users can delete own work time entries" ON public.time_entries;

CREATE POLICY "Users can insert own work time entries"
  ON public.time_entries FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND entry_typ IN ('leistungsbericht', 'vorfertigung', 'projektleiter', 'werk', 'lkw')
  );

CREATE POLICY "Users can update own work time entries"
  ON public.time_entries FOR UPDATE
  USING (
    auth.uid() = user_id
    AND entry_typ IN ('leistungsbericht', 'vorfertigung', 'projektleiter', 'werk', 'lkw')
  )
  WITH CHECK (
    auth.uid() = user_id
    AND entry_typ IN ('leistungsbericht', 'vorfertigung', 'projektleiter', 'werk', 'lkw')
  );

CREATE POLICY "Users can delete own work time entries"
  ON public.time_entries FOR DELETE
  USING (
    auth.uid() = user_id
    AND entry_typ IN ('leistungsbericht', 'vorfertigung', 'projektleiter', 'werk', 'lkw')
  );
