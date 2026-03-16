-- Change time_entries FK from CASCADE to SET NULL
-- So time entries are preserved when a user is deleted (for project time tracking)

-- First make user_id nullable
ALTER TABLE public.time_entries ALTER COLUMN user_id DROP NOT NULL;

-- Drop the existing FK constraint and re-create with SET NULL
ALTER TABLE public.time_entries DROP CONSTRAINT IF EXISTS time_entries_user_id_fkey;
ALTER TABLE public.time_entries
  ADD CONSTRAINT time_entries_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
