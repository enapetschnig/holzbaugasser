-- Beschäftigungsausmaß: Monatliche Normalarbeitszeit pro Mitarbeiter
-- NULL = Standard-Berechnung (Mo-Do 8h, Fr 7h)
-- Wert = überschreibt Standard (z.B. 80h für Teilzeit)
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS monats_soll_stunden NUMERIC(5,1);
