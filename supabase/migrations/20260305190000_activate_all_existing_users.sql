-- Activate all existing users that are currently inactive
-- This fixes users who registered before the auto-activation migration
UPDATE public.profiles SET is_active = true WHERE is_active = false OR is_active IS NULL;
