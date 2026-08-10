/*
# Company ID Defaults — Legacy Inventory Tables

## Summary
Preventive fix, same pattern as 020_company_id_defaults.sql: inventory_brands,
top_vendas, custom_kpis, inventory_snapshots and inventory_brand_history had
company_id as text, nullable, with no DEFAULT — the 5 tables 020 did not
already cover. RLS already isolates these tables correctly (a NULL company_id
row can never match get_my_company_id() for any user), so this closes a
data-integrity gap, not a cross-tenant leak: it guarantees a future insert
can never silently create a company-less, invisible-to-everyone row, exactly
as 020 already guarantees for products/import_history/full_operations/
full_operation_items. No policy changes — every existing SELECT/INSERT/
UPDATE/DELETE policy on these tables already requires company_id =
get_my_company_id(); verified zero existing rows have a NULL company_id
before writing this migration.
*/

ALTER TABLE public.inventory_brands
  ALTER COLUMN company_id SET DEFAULT public.get_my_company_id(),
  ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE public.top_vendas
  ALTER COLUMN company_id SET DEFAULT public.get_my_company_id(),
  ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE public.custom_kpis
  ALTER COLUMN company_id SET DEFAULT public.get_my_company_id(),
  ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE public.inventory_snapshots
  ALTER COLUMN company_id SET DEFAULT public.get_my_company_id(),
  ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE public.inventory_brand_history
  ALTER COLUMN company_id SET DEFAULT public.get_my_company_id(),
  ALTER COLUMN company_id SET NOT NULL;
