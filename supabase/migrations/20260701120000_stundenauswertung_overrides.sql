-- ============================================================
-- Interne Korrektur-Ebene für die Stundenauswertung.
--
-- Hintergrund: Das Bearbeiten einer Zelle in der großen
-- Stundenauswertungsliste hat bisher time_entries gelöscht/ersetzt
-- (auch projekt-/berichtsverknüpfte → Projektstunden weg) und
-- leistungsbericht_mitarbeiter geschrieben (→ Leistungsbericht verändert).
--
-- Diese Tabelle entkoppelt das: eine Korrektur pro (Mitarbeiter, Tag)
-- gilt NUR intern (Stundenauswertung-Grid, Excel-Export, Zeitkonto/
-- Überstunden). time_entries (Projektzeilen) und leistungsbericht_*
-- bleiben unangetastet — die ändert man weiterhin nur über den
-- Leistungsbericht selbst.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.stundenauswertung_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  datum date NOT NULL,
  typ text NOT NULL DEFAULT 'arbeit',          -- 'arbeit' | 'absenz'
  stunden numeric(5,2) NOT NULL DEFAULT 0,     -- Arbeits- ODER Abwesenheits-Stunden des Tages
  absenz_typ text,                             -- z.B. 'Urlaub','Krankenstand','Arzt' (nur bei typ='absenz')
  ist_fahrer boolean NOT NULL DEFAULT false,
  ist_werkstatt boolean NOT NULL DEFAULT false,
  schmutzzulage boolean NOT NULL DEFAULT false,
  regen_schicht boolean NOT NULL DEFAULT false,
  fahrer_stunden numeric,
  werkstatt_stunden numeric,
  schmutzzulage_stunden numeric,
  regen_stunden numeric,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, datum)
);

CREATE INDEX IF NOT EXISTS idx_stundenauswertung_overrides_datum
  ON public.stundenauswertung_overrides(datum);

COMMENT ON TABLE public.stundenauswertung_overrides IS
  'Interne Stunden-Korrektur pro (Mitarbeiter, Tag) für die Stundenauswertung. Wirkt nur intern (Grid, Excel, Zeitkonto), NICHT auf Leistungsbericht oder Projektstunden.';

ALTER TABLE public.stundenauswertung_overrides ENABLE ROW LEVEL SECURITY;

-- Nur Admins lesen/schreiben — die Korrektur ist ein internes Admin-Werkzeug.
CREATE POLICY "Admins can view stundenauswertung_overrides"
  ON public.stundenauswertung_overrides FOR SELECT
  USING (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can insert stundenauswertung_overrides"
  ON public.stundenauswertung_overrides FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can update stundenauswertung_overrides"
  ON public.stundenauswertung_overrides FOR UPDATE
  USING (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can delete stundenauswertung_overrides"
  ON public.stundenauswertung_overrides FOR DELETE
  USING (public.has_role(auth.uid(), 'administrator'));
