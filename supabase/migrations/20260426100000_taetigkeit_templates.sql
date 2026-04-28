-- Vorlagen für Tätigkeiten im Leistungsbericht
-- Admin verwaltet die Liste, alle Authenticated können auswählen.
-- Custom-Eingabe (Freitext) bleibt parallel möglich — die Tabelle ist nur eine Vorschlagsliste.

CREATE TABLE IF NOT EXISTS taetigkeit_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bezeichnung text NOT NULL UNIQUE,
  sort_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE taetigkeit_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view templates"
  ON taetigkeit_templates FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admin can manage templates"
  ON taetigkeit_templates FOR ALL
  USING (has_role(auth.uid(), 'administrator'::app_role))
  WITH CHECK (has_role(auth.uid(), 'administrator'::app_role));

-- Initial-Daten
INSERT INTO taetigkeit_templates (bezeichnung, sort_order) VALUES
  ('Abbund', 10),
  ('Vorfertigung im Werk', 20),
  ('Streicharbeit', 30),
  ('Dachstuhl aufstellen', 40),
  ('Kaltdach', 50),
  ('Holzbau aufstellen', 60),
  ('Carport aufstellen', 70),
  ('Dämmarbeit', 80),
  ('Holzverschalung', 90),
  ('Fassade', 100),
  ('Abbrucharbeit', 110),
  ('Lieferung', 120),
  ('Baustelle aufräumen', 130),
  ('Baustelle einrichten', 140),
  ('Werk/Lager allgemein', 150),
  ('Baubesprechung', 160),
  ('Regiearbeit', 170),
  ('Reparaturarbeit', 180),
  ('Stehzeiten', 190),
  ('Ladetätigkeit', 200),
  ('Terrasse', 210),
  ('Möbelbau', 220),
  ('Tischlerwerkstätte', 230)
ON CONFLICT (bezeichnung) DO NOTHING;
