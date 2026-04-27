-- Add 'extern' role to app_role enum
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'extern';

-- RLS: Extern users can manage their own time_entries (PL-style: Stundenblöcke pro Projekt)
CREATE POLICY "Extern can insert own time_entries"
  ON time_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id AND has_role(auth.uid(), 'extern'::app_role));

CREATE POLICY "Extern can update own time_entries"
  ON time_entries FOR UPDATE
  USING (auth.uid() = user_id AND has_role(auth.uid(), 'extern'::app_role))
  WITH CHECK (auth.uid() = user_id AND has_role(auth.uid(), 'extern'::app_role));

CREATE POLICY "Extern can delete own time_entries"
  ON time_entries FOR DELETE
  USING (auth.uid() = user_id AND has_role(auth.uid(), 'extern'::app_role));
