-- ============================================================
-- Leistungsbericht-System: Tabellen für digitale Zeiterfassung
-- ============================================================

-- 1. Leistungsberichte (Kopfdaten)
CREATE TABLE public.leistungsberichte (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  erstellt_von UUID REFERENCES auth.users(id) NOT NULL,
  projekt_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  datum DATE NOT NULL,
  objekt TEXT,
  ankunft_zeit TIME WITHOUT TIME ZONE NOT NULL,
  abfahrt_zeit TIME WITHOUT TIME ZONE NOT NULL,
  pause_von TIME WITHOUT TIME ZONE,
  pause_bis TIME WITHOUT TIME ZONE,
  pause_minuten INTEGER DEFAULT 0,
  lkw_stunden NUMERIC(4,2) DEFAULT 0,
  wetter TEXT,
  schmutzzulage_alle BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(erstellt_von, projekt_id, datum)
);

ALTER TABLE public.leistungsberichte ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_leistungsberichte_updated_at
  BEFORE UPDATE ON public.leistungsberichte
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Leistungsbericht Tätigkeiten (Position 1-8)
CREATE TABLE public.leistungsbericht_taetigkeiten (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bericht_id UUID REFERENCES public.leistungsberichte(id) ON DELETE CASCADE NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 8),
  bezeichnung TEXT NOT NULL,
  UNIQUE(bericht_id, position)
);

ALTER TABLE public.leistungsbericht_taetigkeiten ENABLE ROW LEVEL SECURITY;

-- 3. Leistungsbericht Mitarbeiter (Teilnehmer + Flags)
CREATE TABLE public.leistungsbericht_mitarbeiter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bericht_id UUID REFERENCES public.leistungsberichte(id) ON DELETE CASCADE NOT NULL,
  mitarbeiter_id UUID REFERENCES auth.users(id) NOT NULL,
  ist_fahrer BOOLEAN DEFAULT false,
  ist_werkstatt BOOLEAN DEFAULT false,
  schmutzzulage BOOLEAN DEFAULT false,
  summe_stunden NUMERIC(5,2) DEFAULT 0,
  UNIQUE(bericht_id, mitarbeiter_id)
);

ALTER TABLE public.leistungsbericht_mitarbeiter ENABLE ROW LEVEL SECURITY;

-- 4. Leistungsbericht Stunden (die Matrix: Mitarbeiter x Tätigkeit)
CREATE TABLE public.leistungsbericht_stunden (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bericht_id UUID REFERENCES public.leistungsberichte(id) ON DELETE CASCADE NOT NULL,
  mitarbeiter_id UUID REFERENCES auth.users(id) NOT NULL,
  taetigkeit_id UUID REFERENCES public.leistungsbericht_taetigkeiten(id) ON DELETE CASCADE NOT NULL,
  stunden NUMERIC(4,2) NOT NULL DEFAULT 0,
  UNIQUE(bericht_id, mitarbeiter_id, taetigkeit_id)
);

ALTER TABLE public.leistungsbericht_stunden ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS Policies
-- ============================================================

-- Leistungsberichte: Admin + Vorarbeiter CRUD, Mitarbeiter SELECT eigene
CREATE POLICY "Admin/Vorarbeiter can manage leistungsberichte"
  ON public.leistungsberichte FOR ALL
  USING (
    public.has_role(auth.uid(), 'administrator')
    OR public.has_role(auth.uid(), 'vorarbeiter')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'administrator')
    OR public.has_role(auth.uid(), 'vorarbeiter')
  );

CREATE POLICY "Mitarbeiter can view own leistungsberichte"
  ON public.leistungsberichte FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.leistungsbericht_mitarbeiter lm
      WHERE lm.bericht_id = id AND lm.mitarbeiter_id = auth.uid()
    )
  );

-- Tätigkeiten: Admin + Vorarbeiter CRUD, alle authenticated SELECT
CREATE POLICY "Admin/Vorarbeiter can manage taetigkeiten"
  ON public.leistungsbericht_taetigkeiten FOR ALL
  USING (
    public.has_role(auth.uid(), 'administrator')
    OR public.has_role(auth.uid(), 'vorarbeiter')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'administrator')
    OR public.has_role(auth.uid(), 'vorarbeiter')
  );

CREATE POLICY "Authenticated can view taetigkeiten"
  ON public.leistungsbericht_taetigkeiten FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Mitarbeiter-Tabelle: Admin + Vorarbeiter CRUD, Mitarbeiter SELECT eigene
CREATE POLICY "Admin/Vorarbeiter can manage bericht_mitarbeiter"
  ON public.leistungsbericht_mitarbeiter FOR ALL
  USING (
    public.has_role(auth.uid(), 'administrator')
    OR public.has_role(auth.uid(), 'vorarbeiter')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'administrator')
    OR public.has_role(auth.uid(), 'vorarbeiter')
  );

CREATE POLICY "Mitarbeiter can view own bericht_mitarbeiter"
  ON public.leistungsbericht_mitarbeiter FOR SELECT
  USING (mitarbeiter_id = auth.uid());

-- Stunden-Matrix: Admin + Vorarbeiter CRUD, Mitarbeiter SELECT eigene
CREATE POLICY "Admin/Vorarbeiter can manage bericht_stunden"
  ON public.leistungsbericht_stunden FOR ALL
  USING (
    public.has_role(auth.uid(), 'administrator')
    OR public.has_role(auth.uid(), 'vorarbeiter')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'administrator')
    OR public.has_role(auth.uid(), 'vorarbeiter')
  );

CREATE POLICY "Mitarbeiter can view own bericht_stunden"
  ON public.leistungsbericht_stunden FOR SELECT
  USING (mitarbeiter_id = auth.uid());

-- Realtime aktivieren
ALTER PUBLICATION supabase_realtime ADD TABLE public.leistungsberichte;
