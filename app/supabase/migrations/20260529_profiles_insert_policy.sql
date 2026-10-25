-- Allow signed-in users to create their own profile if email confirmation is disabled.
-- The app also creates profiles through a service-role server action so this
-- continues to work when Supabase email verification is enabled.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Users insert own profile'
  ) THEN
    CREATE POLICY "Users insert own profile"
    ON public.profiles
    FOR INSERT
    WITH CHECK (auth.uid() = id);
  END IF;
END $$;
