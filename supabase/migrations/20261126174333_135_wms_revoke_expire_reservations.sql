-- 135 — Fecha a varredura de reservas para a tela.
--
-- ── O que estava errado ───────────────────────────────────────────────────────
-- A 134 declarou `REVOKE ALL ON FUNCTION wms_expire_reservations() FROM public, anon` e
-- `GRANT ... TO service_role`, e isso NÃO bastou: medido chamando a função pela sessão
-- autenticada do app, ela executou.
--
-- A causa é o `ALTER DEFAULT PRIVILEGES` do Supabase no schema public, que concede
-- EXECUTE em toda função nova para `anon` e `authenticated`. O revoke em `public` tira o
-- PUBLIC e o revoke em `anon` tira o anon — `authenticated` recebeu o privilégio por
-- conta própria, no momento do CREATE, e seguiu com ele.
--
-- ── Por que importa ───────────────────────────────────────────────────────────
-- A varredura liquida reserva vencida de QUALQUER onda da empresa. Ela não é ação de
-- tela: rodar por engano devolve saldo que outra onda já contava como seu. É manutenção,
-- e manutenção é do cron, não do operador.
--
-- Lição para toda RPC nova neste projeto: negar por omissão não existe aqui. O padrão
-- correto é revogar de `public, anon, authenticated` e conceder só a quem deve.

REVOKE ALL ON FUNCTION public.wms_expire_reservations() FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.wms_expire_reservations() TO service_role;
