-- Delete all existing disturbances (Regieberichte) and related data
-- Related tables (disturbance_materials, disturbance_workers, disturbance_photos)
-- cascade automatically via ON DELETE CASCADE

DELETE FROM public.disturbances;
