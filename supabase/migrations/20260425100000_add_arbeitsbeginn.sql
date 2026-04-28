-- Arbeitsbeginn (when employee actually started working) — used for Rüstzeit/Anfahrt calculation:
-- Rüstzeit = Ankunft Baustelle − Arbeitsbeginn
ALTER TABLE leistungsberichte ADD COLUMN IF NOT EXISTS arbeitsbeginn time;

COMMENT ON COLUMN leistungsberichte.arbeitsbeginn IS
'Tatsächlicher Arbeitsbeginn (z.B. zuhause/Werkstatt). Differenz zu ankunft_zeit ergibt Rüstzeit/Anfahrt.';
