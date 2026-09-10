/*
# Integration Engine — capability expansion (Fase 2)

## Summary
Data-only migration. No table, policy, index or function changes: the Fase 2
engine introduced capability keys that migration 042 did not seed, and
`integration_providers.capabilities` is the source of truth the engine gates
every operation on. An unseeded key reads as `false`, which would silently
disable a feature rather than fail loudly — so the catalogue is brought in line
with the engine's vocabulary here.

## Keys added
- read_locations   — provider exposes addresses/bins inside a deposit
- read_brands      — provider exposes a brand list
- read_categories  — provider exposes a category tree
- write_transfer   — atomic move between two deposits (not two adjustments)
- write_movement   — typed movement document, for ledger-style ERPs

`capabilities` is jsonb, so this needs no schema change — only a merge into the
existing objects, which `||` does while preserving anything already set.

## Why marketplaces get fewer of these
A marketplace holds one sellable balance per listing. It has no deposits to
transfer between and no movement ledger to post to, so declaring those keys
would let the engine offer operations that cannot exist. Marketplaces get
read_categories (they do have category trees) and nothing else from this batch.

## Reminder
Every provider row remains `status: 'planned'`. No real API is implemented in
this phase; these flags describe what each API is known to offer, and gate what
a connector will be permitted to attempt once it exists.
*/

-- ERPs: full deposit and movement vocabulary.
UPDATE integration_providers
   SET capabilities = capabilities || jsonb_build_object(
         'read_locations',  true,
         'read_brands',     true,
         'read_categories', true,
         'write_transfer',  true,
         'write_movement',  true
       )
 WHERE kind = 'erp'
   AND key IN ('tiny','bling','omie','sap_b1','totvs','sankhya');

-- Custom ERP: the shape is unknown by definition, so only the conservative
-- additions. A concrete customer integration can widen its own row later.
UPDATE integration_providers
   SET capabilities = capabilities || jsonb_build_object(
         'read_locations',  true,
         'read_categories', true
       )
 WHERE key = 'custom_erp';

-- Marketplaces: category trees only. See the note above.
UPDATE integration_providers
   SET capabilities = capabilities || jsonb_build_object(
         'read_categories', true
       )
 WHERE kind = 'marketplace';
