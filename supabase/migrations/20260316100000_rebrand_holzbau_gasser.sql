-- Rebrand: Update admin email from Holzknecht to Holzbau Gasser
-- fabian.gasser@holzbau-gasser.at becomes administrator on registration

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _vorname TEXT;
  _nachname TEXT;
  _role app_role;
BEGIN
  _vorname := COALESCE(NEW.raw_user_meta_data ->> 'vorname', '');
  _nachname := COALESCE(NEW.raw_user_meta_data ->> 'nachname', '');

  INSERT INTO public.profiles (id, vorname, nachname)
  VALUES (NEW.id, _vorname, _nachname)
  ON CONFLICT (id) DO NOTHING;

  -- Determine role
  _role := CASE
    WHEN NEW.email = 'fabian.gasser@holzbau-gasser.at' THEN 'administrator'::app_role
    WHEN NEW.email = 'napetschnig.chris@gmail.com' THEN 'administrator'::app_role
    ELSE 'mitarbeiter'::app_role
  END;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Update app_settings default email for disturbance reports
UPDATE public.app_settings
SET value = 'fabian.gasser@holzbau-gasser.at'
WHERE key = 'disturbance_report_email';
