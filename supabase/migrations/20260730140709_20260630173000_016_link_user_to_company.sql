/*
# Create link_user_to_company() RPC

## Problem
linkToAZ() in the frontend does a direct UPDATE on profiles setting
company_id and role. With the new profiles_update policy, self-updating
company_id/role is blocked. We need a server-side function to link a
user to a company securely.

## Fix
Create link_user_to_company(target_company_id) SECURITY DEFINER that:
- Links the calling user to the specified company
- Sets role to 'viewer' (never 'owner' from client)
- Only works if the user has no company_id yet (prevents hijacking)
- Verifies the company exists
*/

CREATE OR REPLACE FUNCTION public.link_user_to_company(
  target_company_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_company text;
BEGIN
  -- Get caller's current company_id
  SELECT company_id::text INTO v_current_company
  FROM profiles WHERE id = auth.uid();

  -- Prevent re-linking if already in a company
  IF v_current_company IS NOT NULL THEN
    RAISE EXCEPTION 'User already linked to a company';
  END IF;

  -- Verify target company exists
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = target_company_id) THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  -- Link user to company as viewer
  UPDATE profiles
  SET company_id = target_company_id, role = 'viewer', updated_at = now()
  WHERE id = auth.uid();
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.link_user_to_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_user_to_company(uuid) TO authenticated;
