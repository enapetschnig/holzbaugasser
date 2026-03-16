-- Cleanup: Delete all projects and all users except Christoph Napetschnig

-- 1. Delete all projects
DELETE FROM public.projects;

-- 2. Delete time entries for all users except Christoph Napetschnig
DELETE FROM public.time_entries
WHERE user_id NOT IN (
  SELECT id FROM public.profiles
  WHERE vorname = 'Christoph' AND nachname = 'Napetschnig'
);

-- 3. Delete employees for all users except Christoph Napetschnig
DELETE FROM public.employees
WHERE user_id NOT IN (
  SELECT id FROM public.profiles
  WHERE vorname = 'Christoph' AND nachname = 'Napetschnig'
);

-- 4. Delete notifications for all users except Christoph Napetschnig
DELETE FROM public.notifications
WHERE user_id NOT IN (
  SELECT id FROM public.profiles
  WHERE vorname = 'Christoph' AND nachname = 'Napetschnig'
);

-- 5. Delete user_roles for all users except Christoph Napetschnig
DELETE FROM public.user_roles
WHERE user_id NOT IN (
  SELECT id FROM public.profiles
  WHERE vorname = 'Christoph' AND nachname = 'Napetschnig'
);

-- 6. Delete profiles for all users except Christoph Napetschnig
DELETE FROM public.profiles
WHERE NOT (vorname = 'Christoph' AND nachname = 'Napetschnig');

-- 7. Delete auth users except Christoph Napetschnig
-- (profiles FK should already be clean, but clean auth.users too)
DELETE FROM auth.users
WHERE id NOT IN (
  SELECT id FROM public.profiles
  WHERE vorname = 'Christoph' AND nachname = 'Napetschnig'
);
