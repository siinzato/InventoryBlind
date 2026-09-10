/*
# Storage Upload Hardening — warehouse-floorplans & rca-evidence

## Problem
Both storage buckets (created in migrations 032 and 033) were inserted with
only id/name/public set — no allowed_mime_types, no file_size_limit. Nothing
server-side stopped a SVG (stored-XSS vector: embedded <script>, rendered
when the file is displayed via its signed URL) or an arbitrarily large file
from being uploaded. The client-side <input accept> attribute is a UI hint
only, not enforcement, and for both buckets it either explicitly allowed SVG
(floorplans) or allowed it implicitly via the "image" wildcard (rca-evidence).

Both buckets were already correctly private with signed-URL retrieval and
tenant/role-scoped RLS — only the mime/size layer was missing.

## Fix
Set allowed_mime_types and file_size_limit directly on both bucket rows.
Supabase Storage enforces these server-side on every upload request,
independent of any client-side check — this closes the gap even if the
frontend is bypassed entirely (curl, modified client, etc).

- warehouse-floorplans: PNG/JPEG only (SVG removed), 10 MB limit.
- rca-evidence: PNG/JPEG/PDF only (SVG removed), 15 MB limit.

No RLS policy, table, or frontend logic touched by this migration.
*/

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png', 'image/jpeg'],
    file_size_limit = 10485760
WHERE id = 'warehouse-floorplans';

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'application/pdf'],
    file_size_limit = 15728640
WHERE id = 'rca-evidence';
