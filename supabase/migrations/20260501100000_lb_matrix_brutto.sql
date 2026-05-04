-- ============================================================
-- Leistungsbericht: Brutto-Eingabe + Auto-Pause-Abzug
-- ============================================================
-- Flag pro Bericht ob die Stunden-Matrix in BRUTTO oder NETTO eingegeben wurde.
--
-- Alte Berichte (vor diese Migration): matrix_brutto = false (Default).
--   → Matrix war Netto-Eingabe, summe_stunden = sum direkt.
-- Neue Berichte (nach Umstellung): matrix_brutto = true (vom UI gesetzt).
--   → Matrix ist Brutto-Eingabe, summe_stunden = sum - pause (netto).
--
-- Werkstatt/LKW (bericht_typ='werk'/'lkw') ist nicht betroffen — die haben
-- ihre eigene Brutto-Logik schon seit Anfang an.

ALTER TABLE public.leistungsberichte
  ADD COLUMN IF NOT EXISTS matrix_brutto boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.leistungsberichte.matrix_brutto IS
  'true = Stunden-Matrix wurde in Brutto-Stunden eingegeben (Pause wird beim Save auto-abgezogen). false = Legacy: Matrix in Netto-Stunden, kein Pause-Abzug.';
