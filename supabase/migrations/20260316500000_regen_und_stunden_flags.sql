-- ============================================================
-- Regen/Wetterschicht Flag + Stunden-basierte Flags
-- ============================================================

-- Regen/Wetterschicht Flag
ALTER TABLE public.leistungsbericht_mitarbeiter
  ADD COLUMN IF NOT EXISTS regen_schicht BOOLEAN DEFAULT false;

-- Stunden-basierte Flags für Split-Tage (z.B. 4F/4R)
-- NULL = Flag gilt für alle Stunden (summe_stunden)
-- Wert = Flag gilt nur für diese Stunden
ALTER TABLE public.leistungsbericht_mitarbeiter
  ADD COLUMN IF NOT EXISTS fahrer_stunden NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS werkstatt_stunden NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS schmutzzulage_stunden NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS regen_stunden NUMERIC(4,2);

-- Regen für alle Toggle auf Leistungsbericht-Kopf
ALTER TABLE public.leistungsberichte
  ADD COLUMN IF NOT EXISTS regen_schicht_alle BOOLEAN DEFAULT false;
