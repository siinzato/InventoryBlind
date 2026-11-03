-- ═══════════════════════════════════════════════════════════════════════════
-- Limpeza pós-aplicação de 085/086/090, encontrada pelo advisor de segurança
-- do Supabase logo depois de aplicar essas 3 migrations no banco remoto.
-- Nenhuma das duas era explorável (detalhado abaixo), mas ambas eram higiene
-- incorreta e é melhor corrigir agora do que deixar acumular.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. returns_check_origin_channel_connection() (090) foi criada SECURITY
--    DEFINER, o que o advisor aponta como executável via RPC por anon e
--    authenticated com privilégio elevado. Na prática, é uma função de
--    trigger — chamá-la fora de um trigger falha imediatamente ("trigger
--    functions can only be called as triggers"), então não há exploração
--    real. Ainda assim, o padrão já estabelecido pelo projeto para este
--    tipo de trigger de guarda cross-tenant (integration_connections_
--    check_fiscal_entity, migration 087) é NÃO usar SECURITY DEFINER — a
--    função roda com o privilégio de quem já está inserindo/atualizando a
--    linha, e integration_connections já é legível por RLS para qualquer
--    membro do workspace, então não precisa de elevação. Alinhando ao mesmo
--    padrão em vez de inventar um REVOKE novo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.returns_check_origin_channel_connection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.origin_channel_connection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM integration_connections
    WHERE id = NEW.origin_channel_connection_id AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'A conta de canal informada não pertence a esta empresa.';
  END IF;
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. return_items_decide_destination(uuid,text,text) — a assinatura de 3
--    parâmetros original (083/084) nunca foi removida quando a migration 085
--    acrescentou p_sync_to_erp/p_connection_id: CREATE OR REPLACE com uma
--    lista de parâmetros diferente cria uma sobrecarga nova no Postgres, não
--    substitui a antiga (mesmo comportamento que a migration 090 já tratou
--    para returns_create_from_nfe_xml, com DROP FUNCTION antes do CREATE).
--    Confirmado por grep que o único chamador no cliente
--    (reverseLogisticsService.ts, decideDestination) sempre envia os 5
--    parâmetros nomeados — a sobrecarga de 3 está morta, inalcançável pelo
--    app, mas ainda executável por qualquer authenticated via RPC bruta
--    (rodando a lógica pré-085, sem sincronização com ERP nem
--    erp_sync_adjustment_id). Removendo a sobrecarga morta.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.return_items_decide_destination(uuid, text, text);
