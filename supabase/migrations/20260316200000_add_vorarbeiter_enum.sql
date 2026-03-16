-- Teil 1: Enum erweitern (muss in eigener Transaktion sein)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'vorarbeiter';
