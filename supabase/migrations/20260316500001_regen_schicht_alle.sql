-- Regen für alle Toggle auf Leistungsbericht-Kopf
ALTER TABLE public.leistungsberichte
  ADD COLUMN IF NOT EXISTS regen_schicht_alle BOOLEAN DEFAULT false;
