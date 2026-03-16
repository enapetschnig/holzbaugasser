-- ============================================================
-- Leistungsbericht Ergänzungen: Geräteeinsatz, Materialien, etc.
-- ============================================================

-- 1. Neue Spalten auf leistungsberichte
ALTER TABLE public.leistungsberichte
  ADD COLUMN IF NOT EXISTS anmerkungen TEXT,
  ADD COLUMN IF NOT EXISTS fertiggestellt BOOLEAN DEFAULT false;

-- 2. Geräteeinsatz (LKW, Kran, etc.)
CREATE TABLE public.leistungsbericht_geraete (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bericht_id UUID REFERENCES public.leistungsberichte(id) ON DELETE CASCADE NOT NULL,
  geraet TEXT NOT NULL,
  stunden NUMERIC(4,2) DEFAULT 0
);

ALTER TABLE public.leistungsbericht_geraete ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/Vorarbeiter can manage bericht_geraete"
  ON public.leistungsbericht_geraete FOR ALL
  USING (
    public.has_role(auth.uid(), 'administrator')
    OR public.has_role(auth.uid(), 'vorarbeiter')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'administrator')
    OR public.has_role(auth.uid(), 'vorarbeiter')
  );

CREATE POLICY "Authenticated can view bericht_geraete"
  ON public.leistungsbericht_geraete FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 3. Verbrauchte Materialien
CREATE TABLE public.leistungsbericht_materialien (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bericht_id UUID REFERENCES public.leistungsberichte(id) ON DELETE CASCADE NOT NULL,
  bezeichnung TEXT NOT NULL,
  menge TEXT
);

ALTER TABLE public.leistungsbericht_materialien ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/Vorarbeiter can manage bericht_materialien"
  ON public.leistungsbericht_materialien FOR ALL
  USING (
    public.has_role(auth.uid(), 'administrator')
    OR public.has_role(auth.uid(), 'vorarbeiter')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'administrator')
    OR public.has_role(auth.uid(), 'vorarbeiter')
  );

CREATE POLICY "Authenticated can view bericht_materialien"
  ON public.leistungsbericht_materialien FOR SELECT
  USING (auth.uid() IS NOT NULL);
