-- Fix: handle_new_user und ensure_user_profile verwenden jetzt
-- ON CONFLICT (user_id) statt ON CONFLICT (user_id, role)
-- weil der Constraint auf UNIQUE(user_id) geändert wurde.

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
  _is_admin BOOLEAN;
BEGIN
  _vorname := COALESCE(NEW.raw_user_meta_data ->> 'vorname', '');
  _nachname := COALESCE(NEW.raw_user_meta_data ->> 'nachname', '');
  _is_admin := NEW.email IN ('fabian.gasser@holzbau-gasser.at', 'napetschnig.chris@gmail.com');

  INSERT INTO public.profiles (id, vorname, nachname, is_active)
  VALUES (NEW.id, _vorname, _nachname, _is_admin)
  ON CONFLICT (id) DO NOTHING;

  _role := CASE WHEN _is_admin THEN 'administrator'::app_role ELSE 'mitarbeiter'::app_role END;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _role)
  ON CONFLICT (user_id) DO NOTHING;

  IF NOT _is_admin THEN
    INSERT INTO public.notifications (user_id, type, title, message, is_read)
    SELECT ur.user_id, 'neue_registrierung', 'Neue Registrierung',
      _vorname || ' ' || _nachname || ' wartet auf Freischaltung', false
    FROM public.user_roles ur WHERE ur.role = 'administrator';
  END IF;

  RETURN NEW;
END;
$$;
