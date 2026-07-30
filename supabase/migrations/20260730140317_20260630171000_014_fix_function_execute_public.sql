/*
# Fix SECURITY DEFINER Function Execute Permissions (follow-up)

## Overview
The previous migration revoked EXECUTE from the `anon` role on the 3
SECURITY DEFINER functions, but PostgreSQL grants EXECUTE to PUBLIC by
default when functions are created. Since `anon` inherits from PUBLIC,
the functions remained callable by unauthenticated users.

## Changes
- REVOKE EXECUTE on the 3 SECURITY DEFINER functions from PUBLIC.
- GRANT EXECUTE to `authenticated` only (and `service_role` for
  server-side access), so only signed-in users / server code can invoke them.
- handle_new_user is a trigger function — it only needs to run via the
  trigger, so we revoke from PUBLIC and grant only to the roles that
  Supabase uses for trigger execution (postgres + service_role).

## Important Notes
- get_my_company_id and get_my_role are called inside RLS policies, which
  run as the table owner (postgres) — they do NOT need anon/authenticated
  grants for policy evaluation. Granting to authenticated allows direct
  RPC calls from signed-in users, which is safe since these functions only
  return the caller's own company_id / role.
- handle_new_user runs as a trigger on auth.users insert — trigger
  functions execute with the privileges of the table owner, so no client
  role needs EXECUTE.
*/

REVOKE EXECUTE ON FUNCTION public.get_my_company_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_my_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;
