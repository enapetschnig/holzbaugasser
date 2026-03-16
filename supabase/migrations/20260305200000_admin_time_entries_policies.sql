-- Allow admins to insert, update, and delete time entries for any user
CREATE POLICY "Admins can insert time entries"
  ON public.time_entries FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'administrator'
    )
  );

CREATE POLICY "Admins can update all time entries"
  ON public.time_entries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'administrator'
    )
  );

CREATE POLICY "Admins can delete all time entries"
  ON public.time_entries FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'administrator'
    )
  );
