/*
# Seed AZ Company and Add company_id to All Tables

## Summary
1. Adds company_id column to all tables that need it (products, inventory_brands, etc.)
2. Seeds AZ company
3. Updates all rows to belong to AZ company
4. Creates auto-profile trigger for new auth users
*/

-- ─── Add company_id wherever it doesn't exist ────────────────────────────────

ALTER TABLE inventory_brands      ADD COLUMN IF NOT EXISTS company_id text;
ALTER TABLE top_vendas            ADD COLUMN IF NOT EXISTS company_id text;
ALTER TABLE custom_kpis           ADD COLUMN IF NOT EXISTS company_id text;
ALTER TABLE inventory_snapshots   ADD COLUMN IF NOT EXISTS company_id text;
ALTER TABLE inventory_brand_history ADD COLUMN IF NOT EXISTS company_id text;
ALTER TABLE products              ADD COLUMN IF NOT EXISTS company_id text;

-- import history tables
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'import_history') THEN
    ALTER TABLE import_history ADD COLUMN IF NOT EXISTS company_id text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'import_history_items') THEN
    ALTER TABLE import_history_items ADD COLUMN IF NOT EXISTS company_id text;
  END IF;
END $$;

-- ─── Seed AZ company ──────────────────────────────────────────────────────────

INSERT INTO companies (id, name, slug, plan, settings)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'AZ',
  'az',
  'enterprise',
  '{"is_seed": true}'
)
ON CONFLICT (id) DO NOTHING;

-- ─── Associate all data to AZ ─────────────────────────────────────────────────

UPDATE inventory_brands         SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE top_vendas               SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE custom_kpis              SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE inventory_snapshots      SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE inventory_brand_history  SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE products                 SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE full_operations          SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE full_operation_items     SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'import_history') THEN
    UPDATE import_history SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
  END IF;
END $$;

-- ─── Auto-create profile trigger ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_name       text;
  v_company_id uuid;
  v_role       text;
BEGIN
  v_name       := NEW.raw_user_meta_data->>'name';
  v_role       := COALESCE(NEW.raw_user_meta_data->>'role', 'owner');

  BEGIN
    v_company_id := (NEW.raw_user_meta_data->>'company_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_company_id := NULL;
  END;

  INSERT INTO profiles (id, name, email, company_id, role)
  VALUES (NEW.id, v_name, NEW.email, v_company_id, v_role)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
