-- Urlaubsverwaltung: Automatischer monatlicher Zuwachs + Verlauf

-- Neue Spalten für monatliche Gutschrift
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS days_per_month NUMERIC DEFAULT 2.08;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS next_credit_date DATE;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS last_credit_date DATE;

-- Verlaufs-Tabelle (Audit-Log)
CREATE TABLE IF NOT EXISTS public.leave_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  year INTEGER NOT NULL,
  action TEXT NOT NULL, -- 'gutschrift', 'kontingent_angelegt', 'kontingent_geaendert', 'einstellung_geaendert'
  days NUMERIC,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.leave_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can manage leave_log" ON public.leave_log
  FOR ALL USING (has_role(auth.uid(), 'administrator'::app_role));

CREATE POLICY "Users can view own leave_log" ON public.leave_log
  FOR SELECT USING (auth.uid() = user_id);
