-- Storage bucket for deleted user time entry backups
INSERT INTO storage.buckets (id, name, public)
VALUES ('deleted-users', 'deleted-users', false)
ON CONFLICT (id) DO NOTHING;

-- Only admins can read/write to this bucket
CREATE POLICY "Admins can upload deleted user backups"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'deleted-users'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'administrator'
    )
  );

CREATE POLICY "Admins can read deleted user backups"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'deleted-users'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'administrator'
    )
  );
