-- projekt_id nullable machen damit Admin-Edit-Dialog
-- minimale Berichte ohne Projekt erstellen kann
ALTER TABLE public.leistungsberichte ALTER COLUMN projekt_id DROP NOT NULL;
