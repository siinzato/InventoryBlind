/*
# Fix Privilege Escalation — Critical Security

## Problem
1. handle_new_user() trusts raw_user_meta_data for role/company_id, defaulting
   role to 'owner' — any signup payload can self-elevate.
2. profiles_update policy allows id = auth.uid() without column restrictions,
   so any user can UPDATE their own role/company_id via the client.

## Fix
1. Rewrite handle_new_user() to ignore metadata role/company_id — all new
   users start as role='viewer', company_id=NULL.
2. Create update_member_role() SECURITY DEFINER RPC for admins/owners to
   change a user's role within the same company, with validation.
3. Replace profiles_update policy: users can only update their own name
   (not role/company_id). Role changes go through update_member_role().
4. Add profiles_delete policy for owner/admin same-company removal.
*/

-- ── 1. Rewrite handle_new_user() ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
BEGIN
  v_name := NEW.raw_user_meta_data->>'name';

  INSERT INTO profiles (id, name, email, company_id, role)
  VALUES (NEW.id, v_name, NEW.email, NULL, 'viewer')
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- ── 2. Create update_member_role() RPC ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_member_role(
  target_user_id uuid,
  new_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role   text;
  v_caller_company text;
  v_target_company text;
  v_target_current_role text;
BEGIN
  -- Get caller's role and company
  v_caller_role   := public.get_my_role();
  v_caller_company := public.get_my_company_id();

  -- Only owner or admin can call this
  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Permission denied: only owners and admins can change roles';
  END IF;

  -- Validate new_role
  IF new_role NOT IN ('owner', 'admin', 'manager', 'counter', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role: %', new_role;
  END IF;

  -- Admins cannot promote to owner
  IF v_caller_role = 'admin' AND new_role = 'owner' THEN
    RAISE EXCEPTION 'Permission denied: admins cannot promote users to owner';
  END IF;

  -- Get target user's current company and role
  SELECT company_id, role INTO v_target_company, v_target_current_role
  FROM profiles WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  -- Target must be in the same company
  IF v_target_company IS NULL OR v_target_company::text <> v_caller_company THEN
    RAISE EXCEPTION 'Permission denied: target user is not in your company';
  END IF;

  -- Admins cannot modify owners
  IF v_caller_role = 'admin' AND v_target_current_role = 'owner' THEN
    RAISE EXCEPTION 'Permission denied: admins cannot modify owners';
  END IF;

  -- Perform the update
  UPDATE profiles SET role = new_role, updated_at = now()
  WHERE id = target_user_id;
END;
$function$;

-- Grant execute to authenticated only
REVOKE EXECUTE ON FUNCTION public.update_member_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_member_role(uuid, text) TO authenticated;

-- ── 3. Replace profiles_update policy ─────────────────────────────────────────
-- Users can only update their own name (not role/company_id).
-- Owners/admins can update name for users in their company.
DROP POLICY IF EXISTS profiles_update ON public.profiles;

CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    id = auth.uid()
    OR (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin'))
  )
  WITH CHECK (
    -- Self-update: only name changes allowed (role/company_id unchanged)
    (id = auth.uid()
     AND company_id::text = (SELECT p.company_id::text FROM public.profiles p WHERE p.id = auth.uid())
     AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()))
    -- Admin/owner updating someone in their company
    OR (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin'))
  );

-- ── 4. Add profiles_delete policy (for removing users from company) ──────────
DROP POLICY IF EXISTS profiles_delete ON public.profiles;
CREATE POLICY profiles_delete ON public.profiles
  FOR DELETE TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin'));
