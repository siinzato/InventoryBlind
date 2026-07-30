/*
# Company ID Defaults — Operational Tables

## Summary
Preventive fix for R1: products, import_history, full_operations and
full_operation_items had company_id as text, nullable, with no DEFAULT.
This set a default of get_my_company_id() and enforces NOT NULL so new
rows can never be inserted without a company.
*/

ALTER TABLE public.products
  ALTER COLUMN company_id SET DEFAULT public.get_my_company_id(),
  ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE public.import_history
  ALTER COLUMN company_id SET DEFAULT public.get_my_company_id(),
  ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE public.full_operations
  ALTER COLUMN company_id SET DEFAULT public.get_my_company_id(),
  ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE public.full_operation_items
  ALTER COLUMN company_id SET DEFAULT public.get_my_company_id(),
  ALTER COLUMN company_id SET NOT NULL;
