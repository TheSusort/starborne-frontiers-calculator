-- Add admin INSERT and UPDATE policies for ship_templates
-- Previously, inserts/updates were only possible through SECURITY DEFINER RPCs
-- This enables direct admin access for the template editor UI
-- Uses public.is_admin() helper to avoid recursion on users table.

CREATE POLICY "Admins can insert ship templates"
  ON public.ship_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update ship templates"
  ON public.ship_templates
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
