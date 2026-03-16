-- Materials catalog (central list managed by admin)
CREATE TABLE IF NOT EXISTS public.materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  einheit TEXT DEFAULT 'Stück',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

-- Everyone can read materials
CREATE POLICY "Alle können Materialien lesen"
  ON public.materials FOR SELECT
  USING (true);

-- Only admins can insert/update/delete
CREATE POLICY "Admins können Materialien verwalten"
  ON public.materials FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'administrator'
    )
  );

-- Ensure material_entries RLS allows all authenticated users to insert
-- (they need to log material usage when booking time)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'material_entries' AND policyname = 'Mitarbeiter können Material buchen'
  ) THEN
    CREATE POLICY "Mitarbeiter können Material buchen"
      ON public.material_entries FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'material_entries' AND policyname = 'Alle können Material-Einträge lesen'
  ) THEN
    CREATE POLICY "Alle können Material-Einträge lesen"
      ON public.material_entries FOR SELECT
      USING (true);
  END IF;
END $$;
