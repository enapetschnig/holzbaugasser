-- FK-Constraints auf SET NULL ändern damit User-Löschung funktioniert
-- Ohne diese Änderung blockieren FK-Constraints das Löschen von auth.users

ALTER TABLE leistungsberichte ALTER COLUMN erstellt_von DROP NOT NULL;
ALTER TABLE leistungsbericht_mitarbeiter ALTER COLUMN mitarbeiter_id DROP NOT NULL;
ALTER TABLE leistungsbericht_stunden ALTER COLUMN mitarbeiter_id DROP NOT NULL;

ALTER TABLE leistungsberichte DROP CONSTRAINT IF EXISTS leistungsberichte_erstellt_von_fkey;
ALTER TABLE leistungsberichte ADD CONSTRAINT leistungsberichte_erstellt_von_fkey
  FOREIGN KEY (erstellt_von) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE leistungsbericht_mitarbeiter DROP CONSTRAINT IF EXISTS leistungsbericht_mitarbeiter_mitarbeiter_id_fkey;
ALTER TABLE leistungsbericht_mitarbeiter ADD CONSTRAINT leistungsbericht_mitarbeiter_mitarbeiter_id_fkey
  FOREIGN KEY (mitarbeiter_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE leistungsbericht_stunden DROP CONSTRAINT IF EXISTS leistungsbericht_stunden_mitarbeiter_id_fkey;
ALTER TABLE leistungsbericht_stunden ADD CONSTRAINT leistungsbericht_stunden_mitarbeiter_id_fkey
  FOREIGN KEY (mitarbeiter_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE invitation_logs ALTER COLUMN gesendet_von DROP NOT NULL;
ALTER TABLE invitation_logs DROP CONSTRAINT IF EXISTS invitation_logs_gesendet_von_fkey;
ALTER TABLE invitation_logs ADD CONSTRAINT invitation_logs_gesendet_von_fkey
  FOREIGN KEY (gesendet_von) REFERENCES auth.users(id) ON DELETE SET NULL;
