-- Fix RLS policies to allow anon access (for development/demo)
-- Drop existing policies
DROP POLICY IF EXISTS "select_import_history" ON import_history;
DROP POLICY IF EXISTS "insert_import_history" ON import_history;
DROP POLICY IF EXISTS "update_import_history" ON import_history;
DROP POLICY IF EXISTS "select_import_products_audit" ON import_products_audit;
DROP POLICY IF EXISTS "insert_import_products_audit" ON import_products_audit;
DROP POLICY IF EXISTS "delete_import_products_audit" ON import_products_audit;

-- Create new policies allowing both authenticated and anon
CREATE POLICY "select_import_history" ON import_history FOR SELECT
  TO authenticated, anon USING (true);

CREATE POLICY "insert_import_history" ON import_history FOR INSERT
  TO authenticated, anon WITH CHECK (true);

CREATE POLICY "update_import_history" ON import_history FOR UPDATE
  TO authenticated, anon USING (true) WITH CHECK (true);

CREATE POLICY "delete_import_history" ON import_history FOR DELETE
  TO authenticated, anon USING (true);

CREATE POLICY "select_import_products_audit" ON import_products_audit FOR SELECT
  TO authenticated, anon USING (true);

CREATE POLICY "insert_import_products_audit" ON import_products_audit FOR INSERT
  TO authenticated, anon WITH CHECK (true);

CREATE POLICY "delete_import_products_audit" ON import_products_audit FOR DELETE
  TO authenticated, anon USING (true);

-- Also fix products table RLS if needed
DROP POLICY IF EXISTS "select_products" ON products;
DROP POLICY IF EXISTS "insert_products" ON products;
DROP POLICY IF EXISTS "update_products" ON products;
DROP POLICY IF EXISTS "delete_products" ON products;

CREATE POLICY "select_products" ON products FOR SELECT
  TO authenticated, anon USING (true);

CREATE POLICY "insert_products" ON products FOR INSERT
  TO authenticated, anon WITH CHECK (true);

CREATE POLICY "update_products" ON products FOR UPDATE
  TO authenticated, anon USING (true) WITH CHECK (true);

CREATE POLICY "delete_products" ON products FOR DELETE
  TO authenticated, anon USING (true);