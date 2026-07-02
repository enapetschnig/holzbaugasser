-- ============================================================
-- Zweigleisige Urlaubsverwaltung:
--   modus 'monatlich'  = Arbeiter    — monatliche Gutschrift (days_per_month,
--                                      Bestandsverhalten, Default für ALLE)
--   modus 'jaehrlich'  = Angestellter — Jahres-Kontingent (jahres_kontingent)
--                                      einmal pro Jahr am frei wählbaren
--                                      Stichtag (= next_credit_date, nach jeder
--                                      Gutschrift +1 Jahr fortgeschrieben)
--
-- Rein additiv: alle Bestandszeilen bekommen modus='monatlich' (= exakt die
-- heutige Engine), jahres_kontingent bleibt NULL. KEIN Backfill, KEIN UPDATE
-- auf Bestandsdaten — bestehende Urlaubskonten ändern sich nicht.
-- ============================================================

ALTER TABLE public.leave_balances
  ADD COLUMN IF NOT EXISTS modus TEXT NOT NULL DEFAULT 'monatlich';

ALTER TABLE public.leave_balances
  ADD COLUMN IF NOT EXISTS jahres_kontingent NUMERIC;

ALTER TABLE public.leave_balances
  DROP CONSTRAINT IF EXISTS leave_balances_modus_check;
ALTER TABLE public.leave_balances
  ADD CONSTRAINT leave_balances_modus_check CHECK (modus IN ('monatlich', 'jaehrlich'));

COMMENT ON COLUMN public.leave_balances.modus IS
  'monatlich = Arbeiter (days_per_month), jaehrlich = Angestellter (jahres_kontingent am Stichtag = next_credit_date, danach +1 Jahr)';
COMMENT ON COLUMN public.leave_balances.jahres_kontingent IS
  'Nur bei modus=jaehrlich: Tage, die am Stichtag gutgeschrieben werden';

-- MA-seitig ausgelöste Vorgänge (Auto-Kontoanlage aus Absence.tsx, selbst
-- getriggerte Gutschrift/Jahres-Rollover) müssen auditierbar sein — leave_log
-- hatte bisher nur Admin-ALL + User-SELECT, User-Inserts schlugen fehl.
DROP POLICY IF EXISTS "Users can insert own leave_log" ON public.leave_log;
CREATE POLICY "Users can insert own leave_log" ON public.leave_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Doku: leave_log.action zusätzlich 'jahres_gutschrift' und 'uebertrag' (TEXT, keine Enum-Änderung).
