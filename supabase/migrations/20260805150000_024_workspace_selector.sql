/*
# Workspace selector — schema

## Summary
Backs the new "Selecione seu Workspace" screen: optional per-company
icon/description for the picker cards, and a last-accessed timestamp per
membership (for the "Último acesso" label and to eventually sort by
recency). No new isolation surface — switch_active_company() already
validates company_members membership before ever changing profiles.company_id;
this migration only adds columns it reads/writes.

## Changes
1. companies.icon (text, nullable) — optional emoji shown on the workspace card.
2. companies.description (text, nullable) — optional one-line description.
3. company_members.last_accessed_at (timestamptz, nullable).
4. switch_active_company() — CREATE OR REPLACE, adds one UPDATE statement to
   stamp last_accessed_at on the target membership. Same signature, same
   validation logic as before — existing callers unaffected.
*/

ALTER TABLE companies ADD COLUMN IF NOT EXISTS icon text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE company_members ADD COLUMN IF NOT EXISTS last_accessed_at timestamptz;

CREATE OR REPLACE FUNCTION public.switch_active_company(
  target_company_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role
  FROM company_members
  WHERE user_id = auth.uid() AND company_id = target_company_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'User is not a member of this company';
  END IF;

  UPDATE profiles
  SET company_id = target_company_id, role = v_role, updated_at = now()
  WHERE id = auth.uid();

  UPDATE company_members
  SET last_accessed_at = now()
  WHERE user_id = auth.uid() AND company_id = target_company_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.switch_active_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.switch_active_company(uuid) TO authenticated;
