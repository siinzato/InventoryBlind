-- Fix: RLS infinite recursion — replace recursive subqueries with
-- existing SECURITY DEFINER functions (get_my_company_id, get_my_role)
-- that bypass RLS for inner lookups.

-- profiles policies
DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;

CREATE POLICY "profiles_select" ON profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR company_id::text = get_my_company_id()
  );

CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE TO authenticated
  USING (
    id = auth.uid()
    OR (company_id::text = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin']))
  )
  WITH CHECK (
    id = auth.uid()
    OR (company_id::text = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin']))
  );

-- companies policies
DROP POLICY IF EXISTS "companies_select" ON companies;
DROP POLICY IF EXISTS "companies_update" ON companies;

CREATE POLICY "companies_select" ON companies
  FOR SELECT TO authenticated
  USING (id::text = get_my_company_id());

CREATE POLICY "companies_update" ON companies
  FOR UPDATE TO authenticated
  USING (id::text = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin']))
  WITH CHECK (id::text = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin']));
