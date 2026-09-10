/*
# Fix signup — create_company_onboarding() RPC

## Problem (P0 — blocks every new signup)
AuthPage.tsx's signup flow does, in this order:
  1. supabase.from('companies').insert({ name, slug, plan })   -- while UNAUTHENTICATED
  2. supabase.auth.signUp({ ..., options: { data: { company_id, role: 'owner' } } })

Step 1 runs before step 2, so it executes as the anon role — companies_insert
is `TO authenticated`, so anon never even matches the policy and the insert
is denied outright ("new row violates row-level security policy for table
companies"). It would also fail even if authenticated: the insert payload
never sets owner_id, and companies_insert requires owner_id = auth.uid().

Step 2 is dead code today: migration 015 (fix_privilege_escalation, applied
earlier for good reason — any signup payload could previously self-elevate
to role='owner' with an arbitrary company_id) rewrote handle_new_user() to
ignore raw_user_meta_data.company_id/role entirely. Every new profile is now
created with company_id=NULL, role='viewer', unconditionally. The frontend
was never updated to match, so no code path has assigned a company to a new
signup since that migration landed.

## Fix
A single SECURITY DEFINER RPC that a freshly-authenticated, company-less
user calls once, right after auth.signUp() resolves:
  1. requires auth.uid() (must be called authenticated)
  2. requires the caller's own profile has no company yet (prevents
     re-onboarding / hijacking an existing account, same guard already used
     by link_user_to_company())
  3. creates the company (owner_id = auth.uid(), so companies_insert's
     existing WITH CHECK would be satisfied even though this function
     bypasses it by running as table owner, same as every other onboarding
     RPC in this schema)
  4. sets the caller's own profile.company_id/role — server-controlled, the
     client can never pass role/company_id directly (same posture as
     update_member_role() and switch_active_company())
  5. inserts the matching company_members row so company-switching
     (022_company_members_and_gocase.sql) and the workspace selector see a
     consistent, single membership immediately
  6. returns the new company's id/slug

All 3 writes happen inside one PL/pgSQL function body — if any statement
raises, Postgres rolls back the whole call, so a user can never end up with
a company but no membership, or a membership but no company.

No RLS policy on companies/profiles/company_members is loosened. The
existing companies_insert/select/update policies are untouched — this
function never needs them because SECURITY DEFINER functions run as their
owner (the migration role), which already bypasses RLS on tables it owns,
exactly like handle_new_user(), link_user_to_company(), update_member_role()
and switch_active_company() already do.
*/

CREATE OR REPLACE FUNCTION public.create_company_onboarding(
  p_company_name text,
  p_user_name text DEFAULT NULL
)
-- Deliberately NOT named company_id/company_slug: profiles, companies and
-- company_members all have a real company_id column, and a PL/pgSQL OUT
-- parameter sharing that name makes every bare "company_id" reference in
-- the function body ambiguous (caught live: "column reference company_id
-- is ambiguous" on the company_members INSERT's ON CONFLICT target).
RETURNS TABLE(out_company_id uuid, out_company_slug text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_current_company uuid;
  v_slug text;
  v_new_company_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF trim(coalesce(p_company_name, '')) = '' THEN
    RAISE EXCEPTION 'Company name is required';
  END IF;

  SELECT p.company_id INTO v_current_company
  FROM profiles p
  WHERE p.id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found for this user';
  END IF;

  IF v_current_company IS NOT NULL THEN
    RAISE EXCEPTION 'User already linked to a company';
  END IF;

  -- Slugify the company name, then force uniqueness with a short random
  -- suffix (companies.slug is UNIQUE; two "Minha Empresa" signups must not
  -- collide).
  v_slug := lower(regexp_replace(trim(p_company_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := regexp_replace(v_slug, '^-+|-+$', '', 'g');
  IF v_slug = '' THEN
    v_slug := 'empresa';
  END IF;
  v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  INSERT INTO companies (name, slug, owner_id, plan)
  VALUES (trim(p_company_name), v_slug, v_uid, 'starter')
  RETURNING id INTO v_new_company_id;

  UPDATE profiles
  SET company_id = v_new_company_id,
      role = 'owner',
      name = COALESCE(NULLIF(trim(p_user_name), ''), name),
      updated_at = now()
  WHERE id = v_uid;

  INSERT INTO company_members (user_id, company_id, role)
  VALUES (v_uid, v_new_company_id, 'owner')
  ON CONFLICT (user_id, company_id) DO NOTHING;

  RETURN QUERY SELECT v_new_company_id, v_slug;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_company_onboarding(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_company_onboarding(text, text) TO authenticated;
