-- Open Leistungsbericht RLS for all authenticated users
-- (previously restricted to Admin/Vorarbeiter/Projektleiter)
-- UI-level role checks handle access control.

DROP POLICY IF EXISTS "Admin/Vorarbeiter can manage leistungsberichte" ON leistungsberichte;
DROP POLICY IF EXISTS "Projektleiter can manage leistungsberichte" ON leistungsberichte;
DROP POLICY IF EXISTS "Mitarbeiter can view own leistungsberichte" ON leistungsberichte;
CREATE POLICY "Authenticated can manage leistungsberichte" ON leistungsberichte
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admin/Vorarbeiter can manage bericht_mitarbeiter" ON leistungsbericht_mitarbeiter;
DROP POLICY IF EXISTS "Projektleiter can manage bericht_mitarbeiter" ON leistungsbericht_mitarbeiter;
DROP POLICY IF EXISTS "Mitarbeiter can view own bericht_mitarbeiter" ON leistungsbericht_mitarbeiter;
CREATE POLICY "Authenticated can manage bericht_mitarbeiter" ON leistungsbericht_mitarbeiter
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admin/Vorarbeiter can manage bericht_stunden" ON leistungsbericht_stunden;
DROP POLICY IF EXISTS "Projektleiter can manage bericht_stunden" ON leistungsbericht_stunden;
DROP POLICY IF EXISTS "Mitarbeiter can view own bericht_stunden" ON leistungsbericht_stunden;
CREATE POLICY "Authenticated can manage bericht_stunden" ON leistungsbericht_stunden
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admin/Vorarbeiter can manage taetigkeiten" ON leistungsbericht_taetigkeiten;
DROP POLICY IF EXISTS "Projektleiter can manage bericht_taetigkeiten" ON leistungsbericht_taetigkeiten;
DROP POLICY IF EXISTS "Authenticated can view taetigkeiten" ON leistungsbericht_taetigkeiten;
CREATE POLICY "Authenticated can manage bericht_taetigkeiten" ON leistungsbericht_taetigkeiten
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admin/Vorarbeiter can manage bericht_geraete" ON leistungsbericht_geraete;
DROP POLICY IF EXISTS "Authenticated can view bericht_geraete" ON leistungsbericht_geraete;
CREATE POLICY "Authenticated can manage bericht_geraete" ON leistungsbericht_geraete
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admin/Vorarbeiter can manage bericht_materialien" ON leistungsbericht_materialien;
DROP POLICY IF EXISTS "Authenticated can view bericht_materialien" ON leistungsbericht_materialien;
CREATE POLICY "Authenticated can manage bericht_materialien" ON leistungsbericht_materialien
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
