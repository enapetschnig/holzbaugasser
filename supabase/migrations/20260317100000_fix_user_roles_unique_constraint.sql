-- Fix: user_roles braucht UNIQUE(user_id) statt UNIQUE(user_id, role)
-- damit upsert mit onConflict: "user_id" funktioniert.
-- Ein Benutzer soll nur eine Rolle haben.
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_key UNIQUE (user_id);
