-- Add admin INSERT and UPDATE policies for ship_templates
-- Previously, inserts/updates were only possible through SECURITY DEFINER RPCs
-- This enables direct admin access for the template editor UI

CREATE POLICY "Admins can insert ship templates"
  ON public.ship_templates
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()::text
      AND users.is_admin = true
    )
  );

CREATE POLICY "Admins can update ship templates"
  ON public.ship_templates
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()::text
      AND users.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()::text
      AND users.is_admin = true
    )
  );
