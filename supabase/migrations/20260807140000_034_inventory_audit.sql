/*
# Auditoria de Estoque — Auditoria Cruzada (approval trail)

## Summary
Adds an optional approval step on top of the existing count/recount chain
(inventory_count_records.count_number + linked_count_id, from 021_count_management.sql)
so "Auditoria Cruzada" can show quem contou / quem recontou / quem aprovou without
touching the counting flow itself (ImportCountTab/FullChecking/NFeCountingView keep
working exactly as before — nothing writes these columns except the new audit panel).

1. Schema addition (additive, nullable — no backfill needed)
- inventory_count_records.approved_by (uuid) — auth.uid() of whoever approved the count
  in the new Auditoria Cruzada panel.
- inventory_count_records.approved_at (timestamptz) — when that happened.

2. Security
- No new RLS policy needed: the existing "inv_count_records_update" policy
  (020_count_management.sql) already allows company-scoped UPDATE, which is what the
  new approve action performs (it only ever sets these two columns).
*/

ALTER TABLE inventory_count_records ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE inventory_count_records ADD COLUMN IF NOT EXISTS approved_at timestamptz;
