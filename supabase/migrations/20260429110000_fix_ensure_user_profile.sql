-- Fix: ensure_user_profile verwendete ON CONFLICT (user_id, role), aber der
-- Constraint auf user_roles wurde in 20260317100000 zu UNIQUE(user_id) geändert.
-- Dadurch lief jeder INSERT in einen Plan-Fehler, der die ganze Function rollte.
-- Folge: Neu-User behielten weder Profil noch Rolle → Login-Loop, RLS-Fehler.

CREATE OR REPLACE FUNCTION public.ensure_user_profile()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_user_id uuid;
  user_email text;
  user_meta jsonb;
  assigned_role app_role;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = current_user_id) THEN
    RETURN json_build_object('success', true, 'action', 'existing');
  END IF;

  SELECT email, raw_user_meta_data
  INTO user_email, user_meta
  FROM auth.users
  WHERE id = current_user_id;

  IF user_email IN (
    'office@moebel-eder.at',
    'napetschnig.chris@gmail.com',
    'office@elektro-brodnig.at',
    'hallo@epowergmbh.at',
    'fabian.gasser@holzbau-gasser.at'
  ) THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'mitarbeiter';
  END IF;

  INSERT INTO public.profiles (id, vorname, nachname, is_active)
  VALUES (
    current_user_id,
    COALESCE(user_meta->>'vorname', ''),
    COALESCE(user_meta->>'nachname', ''),
    true
  )
  ON CONFLICT (id) DO NOTHING;

  -- Constraint ist UNIQUE(user_id), nicht (user_id, role)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (current_user_id, assigned_role)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN json_build_object(
    'success', true,
    'action', 'created',
    'role', assigned_role
  );
END;
$function$;

-- Backfill: für alle bestehenden auth.users ohne Profil/Rolle die Daten anlegen.
INSERT INTO public.profiles (id, vorname, nachname, is_active)
SELECT u.id,
       COALESCE(u.raw_user_meta_data->>'vorname', ''),
       COALESCE(u.raw_user_meta_data->>'nachname', ''),
       true
FROM auth.users u
WHERE u.id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id,
       CASE
         WHEN u.email IN (
           'office@moebel-eder.at',
           'napetschnig.chris@gmail.com',
           'office@elektro-brodnig.at',
           'hallo@epowergmbh.at',
           'fabian.gasser@holzbau-gasser.at'
         ) THEN 'administrator'::app_role
         ELSE 'mitarbeiter'::app_role
       END
FROM auth.users u
WHERE u.id NOT IN (SELECT user_id FROM public.user_roles WHERE user_id IS NOT NULL)
ON CONFLICT (user_id) DO NOTHING;
