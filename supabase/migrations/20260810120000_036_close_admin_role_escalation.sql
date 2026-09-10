/*
# Close admin -> owner privilege escalation via raw profiles UPDATE

## Problem
Migration 015 rewrote profiles_update so a self-update cannot change role/
company_id, but the admin/owner branch (for editing teammates) was left
without that same restriction:

  WITH CHECK (
    (id = auth.uid() AND ... AND role = <unchanged>)
    OR (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin'))
  )

The second branch lets any admin (not just owner) run, directly from the
client, e.g.:
  supabase.from('profiles').update({ role: 'owner' }).eq('id', <any-id>)
including their own row, or an existing owner's row — bypassing every rule
enforced by update_member_role() (admins cannot promote to owner, admins
cannot modify owners). Not exploitable below admin: manager/lead/counter/
viewer are already blocked by both branches.

## Fix
Restrict the admin/owner branch the same way the self branch already is:
role and company_id must stay unchanged for that row. All role changes
must go through update_member_role(), which is SECURITY DEFINER and
therefore unaffected by this tightened RLS policy — it keeps working
exactly as before, with its existing validation intact.

No frontend change. No other table or policy touched. update_member_role()
itself is not modified.
*/

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
    -- Admin/owner updating someone in their company: role/company_id must stay
    -- unchanged here too — actual role changes go through update_member_role()
    OR (company_id::text = get_my_company_id()
        AND get_my_role() IN ('owner','admin')
        AND company_id::text = (SELECT p.company_id::text FROM public.profiles p WHERE p.id = profiles.id)
        AND role = (SELECT p.role FROM public.profiles p WHERE p.id = profiles.id))
  );
